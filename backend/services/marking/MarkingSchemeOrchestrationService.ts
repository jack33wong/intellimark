/**
 * Marking Scheme Orchestration Service
 * Handles question detection, grouping, and marking scheme lookup/merging
 * 
 * This service orchestrates:
 * 1. Question detection for each individual question
 * 2. Grouping sub-questions by base question number
 * 3. Merging marking schemes for grouped sub-questions
 * 4. Statistics tracking
 * 5. Updating classification result with detected question numbers
 */

import { logDetectionAudit } from './MarkingHelpers.js';
import { questionDetectionService } from './questionDetectionService.js';
import { getBaseQuestionNumber, normalizeSubQuestionPart, formatFullQuestionText } from '../../utils/TextNormalizationUtils.js';
import * as stringSimilarity from 'string-similarity';
import { getFirestore } from '../../config/firebase.js';

export interface DetectionStatistics {
  totalQuestions: number;
  detected: number;
  notDetected: number;
  withMarkingScheme: number;
  withoutMarkingScheme: number;
  bySimilarityRange: {
    high: number;      // ≥ 0.90
    medium: number;   // 0.70-0.89
    low: number;      // 0.40-0.69
  };
  questionDetails: Array<{
    questionNumber: string | null | undefined;
    detected: boolean;
    similarity?: number;
    hasMarkingScheme: boolean;
    matchedPaperTitle?: string;
  }>;
  hintInfo?: {
    hintUsed: string;
    matchedPapersCount: number;
    matchedPaperTitle?: string;
    thresholdRelaxed: boolean;
    deepSearchActive?: boolean;
    poolSize?: number;
    rescuedQuestions?: string[];
  };
}

export interface MarkingSchemeOrchestrationResult {
  markingSchemesMap: Map<string, any>;
  detectionStats: DetectionStatistics;
  updatedClassificationResult: any;
  detectionResults: Array<{
    question: { text: string; questionNumber?: string | null; sourceImageIndex?: number };
    detectionResult: any;
  }>;
}

export class MarkingSchemeOrchestrationService {
  /**
   * Orchestrate question detection and marking scheme lookup
   * 
   * @param individualQuestions - Questions extracted from classification
   * @param classificationResult - Classification result to update with detected question numbers
   * @returns Map of marking schemes and detection statistics
   */
  static async orchestrateMarkingSchemeLookup(
    individualQuestions: Array<{ text: string; questionNumber?: string | null; sourceImageIndex?: number }>,
    classificationResult: any,
    examPaperHint?: string | null
  ): Promise<MarkingSchemeOrchestrationResult> {
    const markingSchemesMap: Map<string, any> = new Map();

    // Helper function to check if a question number is a sub-question
    const isSubQuestion = (questionNumber: string | null | undefined): boolean => {
      if (!questionNumber) return false;
      const qNumStr = String(questionNumber);
      const subQPartMatch = qNumStr.match(/^(\d+)(\(?[a-zivx]+\)?)?$/i);
      if (subQPartMatch && subQPartMatch[2]) {
        const normalizedPart = normalizeSubQuestionPart(subQPartMatch[2]);
        return normalizedPart.length > 0;
      }
      return false;
    };

    // First pass: Collect all detection results
    const detectionResults: Array<{
      question: { text: string; questionNumber?: string | null; sourceImageIndex?: number };
      detectionResult: any;
    }> = [];

    // Track detection statistics
    const detectionStats: DetectionStatistics = {
      totalQuestions: individualQuestions.length,
      detected: 0,
      notDetected: 0,
      withMarkingScheme: 0,
      withoutMarkingScheme: 0,
      bySimilarityRange: {
        high: 0,
        medium: 0,
        low: 0
      },
      questionDetails: [],
      hintInfo: undefined
    };

    let hintFailures = 0;

    // Call question detection for each individual question
    for (const question of individualQuestions) {
      const detectionResult = await questionDetectionService.detectQuestion(question.text, question.questionNumber, examPaperHint);

      const similarity = detectionResult.match?.confidence || 0;
      const hasMarkingScheme = detectionResult.match?.markingScheme !== null && detectionResult.match?.markingScheme !== undefined;

      // Track statistics
      if (detectionResult.found) {
        detectionStats.detected++;
        if (hasMarkingScheme) {
          detectionStats.withMarkingScheme++;
        } else {
          detectionStats.withoutMarkingScheme++;
        }

        // Categorize by similarity
        if (similarity >= 0.90) {
          detectionStats.bySimilarityRange.high++;
        } else if (similarity >= 0.70) {
          detectionStats.bySimilarityRange.medium++;
        } else if (similarity >= 0.40) {
          detectionStats.bySimilarityRange.low++;
        }

        // Determine best supported question number for logs
        let logQuestionNumber = question.questionNumber;
        if (detectionResult.match?.questionNumber) {
          logQuestionNumber = detectionResult.match.questionNumber;
          if (detectionResult.match.subQuestionNumber) {
            logQuestionNumber += detectionResult.match.subQuestionNumber;
          }
        }

        detectionStats.questionDetails.push({
          questionNumber: logQuestionNumber,
          detected: true,
          similarity,
          hasMarkingScheme,
          matchedPaperTitle: detectionResult.match?.paperTitle
        });

      } else {
        detectionStats.notDetected++;
        detectionStats.questionDetails.push({
          questionNumber: question.questionNumber,
          detected: false,
          hasMarkingScheme: false
        });
      }

      // --- CRITICAL FIX: Ensure all questions reach the pipeline ---
      detectionResults.push({ question, detectionResult });

      // Track failures for the 50% rule
      if (detectionResult.hintMetadata?.isWeakMatch || detectionResult.hintMetadata?.deepSearchActive) {
        hintFailures++;
      }

      // Update hint metadata to be more representative of the entire batch
      if (detectionResult.hintMetadata) {
        if (!detectionStats.hintInfo) {
          detectionStats.hintInfo = {
            ...detectionResult.hintMetadata,
            rescuedQuestions: []
          };
        } else if (!detectionStats.hintInfo.rescuedQuestions) {
          detectionStats.hintInfo.rescuedQuestions = [];
        }

        // If this specific question triggered deep search, mark it
        if (detectionResult.hintMetadata.deepSearchActive) {
          detectionStats.hintInfo.deepSearchActive = true;
          detectionStats.hintInfo.poolSize = detectionResult.hintMetadata.poolSize;

          const qLabel = question.questionNumber || '?';
          detectionStats.hintInfo.rescuedQuestions.push(qLabel);

          // Real-time rescue log removed to reduce noise as requested
        }

        // If any question had a matched paper title, preserve it
        if (detectionResult.hintMetadata.matchedPaperTitle && !detectionStats.hintInfo.matchedPaperTitle) {
          detectionStats.hintInfo.matchedPaperTitle = detectionResult.hintMetadata.matchedPaperTitle;
        }
      }
    }

    // --- RECOVERY LOGIC (Rescue Restart) ---
    // If a hint was given but results are poor, messy, or inconsistent, 
    // we discard the hint and restart detection GLOBALLY.

    const hintInfo = detectionStats.hintInfo;
    if (hintInfo) {
      const hintUsed = hintInfo.hintUsed || '';
      const matchedPapersCount = hintInfo.matchedPapersCount || 0;
      const detectedCount = detectionStats.detected;
      const totalCount = detectionStats.totalQuestions;
      const detectionRate = totalCount > 0 ? detectedCount / totalCount : 0;

      // Calculate how many distinct papers we've matched against
      const distinctPapers = new Set(detectionStats.questionDetails
        .filter(q => q.detected && q.matchedPaperTitle)
        .map(q => q.matchedPaperTitle)
      );

      let shouldRestart = false;
      let restartReason = '';

      // Scenario 1: Frankenstein Result (Inconsistent Papers)
      // Even if detection is high, if questions came from multiple papers in the hint-pool,
      // it's a "messy" match and a global search might find the ONE true paper.
      if (detectedCount > 0 && distinctPapers.size > 1) {
        shouldRestart = true;
        restartReason = `Frankenstein result detected (${distinctPapers.size} papers found: ${Array.from(distinctPapers).join(', ')})`;
      }

      // Scenario 2: Unique Hint Failure (Low Density)
      // If a specific code was given (1 paper pool) and we found < 80% of questions.
      else if (matchedPapersCount === 1 && detectionRate < 0.8) {
        shouldRestart = true;
        restartReason = `Low adherence to unique hint (${detectedCount}/${totalCount} found)`;
      }

      // Scenario 3: Multi-Paper Hint Failure (Very Low Density)
      // If a keyword like "Mathematics" was given (large pool) and we found < 50% of questions.
      else if (matchedPapersCount > 1 && detectionRate < 0.5) {
        shouldRestart = true;
        restartReason = `Poor match density in hinted pool (${detectedCount}/${totalCount} found)`;
      }

      // Scenario 4: All-or-Nothing check for unique hints (already covered by Scenario 2, but for clarity)
      else if (matchedPapersCount === 1 && detectedCount < totalCount) {
        // We keep this as a subset of scenario 2 but with stricter 100% requirement if preferred
        // For now, scenario 2 covers it with a 80% threshold.
      }

      if (shouldRestart && examPaperHint !== null) {
        console.log(`\x1b[31m[HINT] ⚠️ Hint Adherence Failed! ${restartReason}.\x1b[0m`);
        console.log(`\x1b[33m[HINT] Discarding hint "${hintUsed}" and restarting detection GLOBALLY for document consistency...\x1b[0m`);

        // Recursive call with null hint to trigger global search
        return this.orchestrateMarkingSchemeLookup(individualQuestions, classificationResult, null);
      }
    }

    // --- CONSENSUS RULE: Force dominant paper if >80% share the same paper ---
    const paperCounts = new Map<string, number>();
    const paperToMatch = new Map<string, any>();

    detectionResults.forEach(dr => {
      if (dr.detectionResult.match?.paperTitle) {
        const title = dr.detectionResult.match.paperTitle;
        paperCounts.set(title, (paperCounts.get(title) || 0) + 1);
        if (!paperToMatch.has(title)) {
          paperToMatch.set(title, dr.detectionResult.match);
        }
      }
    });

    let dominantPaper: string | null = null;
    const totalDetectedCount = Array.from(paperCounts.values()).reduce((a, b) => a + b, 0);

    for (const [title, count] of paperCounts.entries()) {
      if (count / totalDetectedCount >= 0.8) {
        dominantPaper = title;
        break;
      }
    }

    if (dominantPaper && paperCounts.size > 1) {
      console.log(`\x1b[32m[HINT] 🏛️ Consensus Reached! Forcing all questions to "${dominantPaper}" for consistency.\x1b[0m`);
      const dominantMatchBase = paperToMatch.get(dominantPaper);

      for (const dr of detectionResults) {
        if (dr.detectionResult.match?.paperTitle !== dominantPaper) {
          const oldTitle = dr.detectionResult.match?.paperTitle || 'Unknown';
          // Retry detection for this specific question FORCED to the dominant paper hint
          const forcedHint = `${dominantMatchBase.board} ${dominantMatchBase.paperCode} ${dominantMatchBase.examSeries} ${dominantMatchBase.tier}`;
          const rescuedResult = await questionDetectionService.detectQuestion(dr.question.text, dr.question.questionNumber, forcedHint);

          if (rescuedResult.found && rescuedResult.match?.paperTitle === dominantPaper) {
            console.log(`   └─ Rescued ${dr.question.questionNumber || '?'}: ${oldTitle} -> ${dominantPaper}`);
            dr.detectionResult = rescuedResult;
          }
        }
      }
    }

    // PASS COMPLETE: Results collected in detectionResults array.
    // In our "Simple Design", we don't do complex voting or locking.
    // The highest similarity match for each question found in the pool is what counts.

    // Second pass: Group sub-questions by base question number and merge
    const groupedResults = new Map<string, Array<{
      question: { text: string; questionNumber?: string | null; sourceImageIndex?: number };
      detectionResult: any;
      actualQuestionNumber: string;
      originalQuestionNumber: string | null | undefined;
      examBoard: string;
      paperCode: string;
    }>>();

    // Group detection results by base question number and exam paper
    for (const { question, detectionResult } of detectionResults) {
      if (!detectionResult.match) {
        // Handle non-detected questions: Group by base number to preserve context
        const baseId = getBaseQuestionNumber(question.questionNumber || '');
        const fallbackId = baseId || question.questionNumber || `Q${Math.random().toString(36).substring(2, 7)}`;
        const groupKey = `GENERIC_${fallbackId}`;

        if (!groupedResults.has(groupKey)) {
          groupedResults.set(groupKey, []);
        }

        groupedResults.get(groupKey)!.push({
          question,
          detectionResult,
          actualQuestionNumber: question.questionNumber || '',
          originalQuestionNumber: question.questionNumber,
          examBoard: 'Unknown',
          paperCode: 'Unknown'
        });
        continue;
      }

      const actualQuestionNumber = detectionResult.match.questionNumber;
      const originalQuestionNumber = question.questionNumber;
      const examBoard = detectionResult.match.board || 'Unknown';
      const paperCode = detectionResult.match.paperCode || 'Unknown';

      const questionNumberForGrouping = originalQuestionNumber || actualQuestionNumber;
      const baseQuestionNumber = getBaseQuestionNumber(questionNumberForGrouping);
      const groupKey = `${baseQuestionNumber}_${examBoard}_${paperCode}`;

      if (!groupedResults.has(groupKey)) {
        groupedResults.set(groupKey, []);
      }

      groupedResults.get(groupKey)!.push({
        question,
        detectionResult,
        actualQuestionNumber,
        originalQuestionNumber,
        examBoard,
        paperCode
      });
    }

    // Third pass: Merge grouped sub-questions or store single questions
    for (const [groupKey, group] of groupedResults.entries()) {
      // HANDLE GENERIC QUESTIONS (Detection Failed)
      if (groupKey.startsWith('GENERIC_')) {
        const item = group[0];
        const uniqueKey = groupKey; // Use the generated generic key

        // Merge texts if multiple sub-questions fell into this generic group
        // Use parentText (lead-in) as the foundation
        let mergedText = (item.question as any).parentText || '';

        // Group sub-parts with labels
        const subTexts = group.map(i => {
          const label = i.originalQuestionNumber || i.actualQuestionNumber || '?';
          return i.question.text ? `(${label}) ${i.question.text}` : '';
        }).filter(t => t.trim() !== '').join('\n\n');

        const finalQuestionText = mergedText ? `${mergedText}\n\n${subTexts}` : subTexts;

        markingSchemesMap.set(uniqueKey, {
          questionMarks: null, // No marking scheme
          totalMarks: 0,
          parentQuestionMarks: 0,
          questionNumber: item.originalQuestionNumber || item.actualQuestionNumber,
          questionDetection: item.detectionResult,
          questionText: finalQuestionText,
          databaseQuestionText: '',
          isGeneric: true // Use as flag for the generator to know this is a first-principles task
        });
        continue;
      }

      const baseQuestionNumber = groupKey.split('_')[0];
      const examBoard = group[0].examBoard;
      const paperCode = group[0].paperCode;

      // Enhanced sub-question detection:
      // 1. Check if ANY input question was labeled as a sub-question (e.g. "6a")
      // 2. Check if the matched database records for this group have sub-questions defined in the exam paper structure
      const hasSubQuestions = group.some(item => {
        if (isSubQuestion(item.originalQuestionNumber)) return true;

        // Check matched database record for this question
        const match = item.detectionResult.match;
        if (match && match.examPaper && match.questionNumber) {
          const questions = match.examPaper.questions;
          // Find the question data in the paper structure
          const questionData = Array.isArray(questions)
            ? questions.find((q: any) => String(q.question_number || q.number) === String(match.questionNumber))
            : (questions ? (questions as any)[match.questionNumber] : null);

          // If database record has sub-questions, we should treat this as a sub-question group
          if (questionData && (
            (questionData.sub_questions && Array.isArray(questionData.sub_questions) && questionData.sub_questions.length > 0) ||
            (questionData.subQuestions && Array.isArray(questionData.subQuestions) && questionData.subQuestions.length > 0)
          )) {
            return true;
          }
        }
        return false;
      });

      // Group sub-questions: merge marking schemes
      // We process as a group if multiple instances were detected OR if it's a main question that has sub-questions in DB
      if (hasSubQuestions) {
        // Group sub-questions: merge marking schemes
        const firstItem = group[0];
        const parentQuestionMarks = firstItem.detectionResult.match?.parentQuestionMarks || 0;

        if (parentQuestionMarks === 0 && firstItem.detectionResult.match?.questionNumber) {
          console.warn(`[MARKING SCHEME ORCHESTRATION] Parent question marks not found for grouped sub-questions Q${baseQuestionNumber}. Defaulting to 0.`);
          // This can happen if the database metadata is incomplete or if a 'wrong hint' matched a non-past paper.
        }

        // Merge marking schemes
        const mergedMarks: any[] = [];
        const combinedQuestionTexts: string[] = [];
        const combinedDatabaseQuestionTexts: string[] = [];
        const questionNumbers: string[] = [];
        const subQuestionAnswers: string[] = [];
        const subQuestionMarksMap = new Map<string, any[]>();
        const subQuestionAnswersMap = new Map<string, string>(); // NEW: Store answers for sub-questions (e.g., "a" -> "53000")
        const subQuestionMaxScoresMap = new Map<string, number>(); // NEW: Store max scores from database

        const processedSubLabels = new Set<string>(); // Track processed sub-questions to prevent duplicates
        const firstMatch = firstItem.detectionResult.match;

        // Create a map of existing group items for easy lookup
        const itemsBySubPart = new Map<string, typeof group[0]>();
        group.forEach(item => {
          // ROBUSTNESS: Prefer explicit subQuestionNumber from match, then fallback to parsing displayQNum
          const matchSubQ = item.detectionResult.match?.subQuestionNumber;
          let subLabel = '';

          if (matchSubQ) {
            subLabel = matchSubQ.toLowerCase();
          } else {
            const displayQNum = item.originalQuestionNumber || item.actualQuestionNumber;
            const subLabelMatch = displayQNum.match(/([a-z]+|[ivx]+)$/i);
            subLabel = subLabelMatch ? subLabelMatch[1].toLowerCase() : displayQNum.toLowerCase();
          }
          const normalizedSubLabel = normalizeSubQuestionPart(subLabel);
          itemsBySubPart.set(normalizedSubLabel, item);
        });

        // Get the full list of sub-questions from the database paper structure
        const dbSubParts = new Set<string>();
        const questionsSchema = firstMatch?.examPaper?.questions;
        if (questionsSchema) {
          const questionData = Array.isArray(questionsSchema)
            ? questionsSchema.find((q: any) => String(q.question_number || q.number) === baseQuestionNumber)
            : (questionsSchema ? (questionsSchema as any)[baseQuestionNumber] : null);

          if (questionData && (questionData.sub_questions || questionData.subQuestions)) {
            const dbSubQs = questionData.sub_questions || questionData.subQuestions || [];
            dbSubQs.forEach((sq: any) => {
              // ROBUSTNESS FIX: Check multiple possible fields
              const partId = sq.question_part || sq.part || sq.label || sq.sub_question_number || sq.number;
              const part = normalizeSubQuestionPart(partId || '');
              if (part) dbSubParts.add(part);
            });
          }
        }

        // RECOVERY: Also check the Marking Scheme keys for siblings
        // This handles cases where the examPaper structure is incomplete but the scheme has marks
        const subPartToOriginalKey = new Map<string, string>(); // NEW: Map normalized part to original key
        const paperMarkingScheme = group[0].detectionResult.match?.markingScheme;
        if (paperMarkingScheme?.questions) {
          const schemeKeys = Object.keys(paperMarkingScheme.questions);
          schemeKeys.forEach(key => {
            // Check if this key belongs to our current base question (e.g. "11b" or "11 (b)" for base "11")
            if (key.startsWith(baseQuestionNumber)) {
              const subPartText = key.substring(baseQuestionNumber.length).trim();
              const normalizedSubPart = normalizeSubQuestionPart(subPartText);
              if (normalizedSubPart) {
                dbSubParts.add(normalizedSubPart);
                subPartToOriginalKey.set(normalizedSubPart, key); // Store the actual key for fetching
              }
            }
          });
        }

        // Combine all discovered parts and process
        const allPartsToProcess = Array.from(new Set([...dbSubParts, ...itemsBySubPart.keys()]));
        allPartsToProcess.sort();

        for (const normalizedSubLabel of allPartsToProcess) {
          // Skip if we've already processed this sub-question (relevant for dbSubParts fallback)
          if (processedSubLabels.has(normalizedSubLabel)) {
            continue;
          }

          // REDUNDANCY FILTER: If we have actual sub-parts (e.g. i, ii, iii) in the database,
          // then any AI detection that is just the base number (e.g. "12") is redundant
          // and would cause double-counting of marks.
          if (normalizedSubLabel === baseQuestionNumber && dbSubParts.size > 0) {
            console.log(`[MARKING SCHEME ORCHESTRATION] ⚠️ Skipping redundant parent detection Q${normalizedSubLabel} because sub-parts exist.`);
            continue;
          }

          processedSubLabels.add(normalizedSubLabel);

          const item = itemsBySubPart.get(normalizedSubLabel);
          const displayQNum = `${baseQuestionNumber}${normalizedSubLabel}`;

          // RECOVERY LOGIC: If item is missing (not detected by mapper), fetch its scheme from the paper's marking scheme
          let marksArray: any[] = [];
          let subQAnswer = '';
          let subQMaxScore = 0;
          let subQQuestionText = '';

          if (item) {
            // NORMAL: use detected item's scheme
            const markingScheme = item.detectionResult.match?.markingScheme;
            subQAnswer = item.detectionResult.match?.answer ||
              markingScheme?.answer ||
              markingScheme?.questionMarks?.answer || '';
            subQQuestionText = item.detectionResult.match?.databaseQuestionText || '';

            // SCHEMA-FIRST MARKS: Look up max score from database structure for consistency
            if (questionsSchema) {
              const questionData = Array.isArray(questionsSchema)
                ? questionsSchema.find((q: any) => String(q.question_number || q.number) === baseQuestionNumber)
                : (questionsSchema ? (questionsSchema as any)[baseQuestionNumber] : null);
              const dbSubQs = questionData?.sub_questions || questionData?.subQuestions || [];
              // ROBUSTNESS FIX: Check multiple possible fields
              const dbSubQ = dbSubQs.find((sq: any) => {
                const partId = sq.question_part || sq.part || sq.label || sq.sub_question_number || sq.number;
                return normalizeSubQuestionPart(partId || '') === normalizedSubLabel;
              });
              if (dbSubQ && typeof dbSubQ.marks === 'number') {
                subQMaxScore = dbSubQ.marks;
              } else {
                // Fallback to detected marks if not in schema (should be rare)
                subQMaxScore = item.detectionResult.match?.marks || 0;
              }
            } else {
              subQMaxScore = item.detectionResult.match?.marks || 0;
            }

            if (markingScheme?.questionMarks) {
              const qMarks = markingScheme.questionMarks;
              marksArray = Array.isArray(qMarks.marks) ? qMarks.marks : (Array.isArray(qMarks) ? qMarks : []);
            }
          } else {
            // RECOVERY: sibling was missed by mapper
            console.log(`[MARKING SCHEME ORCHESTRATION] 🔄 Recovering missing sibling Q${displayQNum} from marking scheme.`);

            // Use the marking scheme from the first detected sibling as it represents the whole paper
            const paperMarkingScheme = group[0].detectionResult.match?.markingScheme;
            if (paperMarkingScheme?.questions) {
              const fullSchemeQuestions = paperMarkingScheme.questions;

              // Use the original key mapping we built earlier to ensure we match "11 (b)" vs "11b"
              const originalKey = subPartToOriginalKey.get(normalizedSubLabel) || displayQNum;
              const siblingScheme = fullSchemeQuestions[originalKey];

              if (siblingScheme) {
                marksArray = Array.isArray(siblingScheme.marks) ? siblingScheme.marks : [];
                subQAnswer = siblingScheme.answer || '';
                // Try to find text and max score in the exam paper structure
                if (questionsSchema) {
                  const questionData = Array.isArray(questionsSchema)
                    ? questionsSchema.find((q: any) => String(q.question_number || q.number) === baseQuestionNumber)
                    : (questionsSchema ? (questionsSchema as any)[baseQuestionNumber] : null);
                  const dbSubQs = questionData?.sub_questions || questionData?.subQuestions || [];
                  // ROBUSTNESS FIX: Check multiple possible fields
                  const dbSubQ = dbSubQs.find((sq: any) => {
                    const partId = sq.question_part || sq.part || sq.label || sq.sub_question_number || sq.number;
                    return normalizeSubQuestionPart(partId || '') === normalizedSubLabel;
                  });
                  if (dbSubQ) {
                    subQQuestionText = dbSubQ.text || dbSubQ.question || dbSubQ.question_text || '';
                    subQMaxScore = typeof dbSubQ.marks === 'number' ? dbSubQ.marks : 0;
                  }
                }
              }
            }
          }

          if (marksArray.length > 0 || subQAnswer || subQMaxScore > 0) {
            subQuestionAnswers.push(subQAnswer);
            subQuestionAnswersMap.set(normalizedSubLabel, subQAnswer);
            subQuestionMarksMap.set(displayQNum, marksArray);
            mergedMarks.push(...marksArray);
            subQuestionMaxScoresMap.set(normalizedSubLabel, subQMaxScore);

            if (item) {
              combinedQuestionTexts.push(item.question.text);
            }
            if (subQQuestionText) {
              combinedDatabaseQuestionTexts.push(subQQuestionText);
            }
            questionNumbers.push(displayQNum);
          }
        }

        // Create merged marking scheme
        const mergedQuestionMarks = {
          marks: mergedMarks,
          subQuestionMarks: Object.fromEntries(subQuestionMarksMap),
          subQuestionAnswersMap: Object.fromEntries(subQuestionAnswersMap)
        };

        const questionDetection = firstItem.detectionResult;

        // Get main question text from parent question in the exam paper
        let mainQuestionDatabaseText = '';
        if (firstMatch) {
          try {
            const db = getFirestore();
            if (!db) {
              throw new Error('Firestore not available');
            }

            const examPapersSnapshot = await db.collection('fullExamPapers')
              .where('metadata.exam_board', '==', firstMatch.board)
              .get();

            const examPapers = examPapersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            const matchedExamPaper = examPapers.find((ep: any) => {
              const metadata = ep.metadata || {};

              const dbBoard = (metadata.exam_board || '').trim().toLowerCase();
              const dbCode = (metadata.exam_code || '').trim().toLowerCase();
              const dbSeries = (metadata.exam_series || '').trim().toLowerCase();
              const dbTier = (metadata.tier || '').trim().toLowerCase();

              const targetBoard = (firstMatch.board || '').trim().toLowerCase();
              const targetCode = (firstMatch.paperCode || '').trim().toLowerCase();
              const targetSeries = (firstMatch.examSeries || '').trim().toLowerCase();
              const targetTier = (firstMatch.tier || '').trim().toLowerCase();

              // Handle "June" prefix variation for series
              const seriesMatch = dbSeries === targetSeries ||
                dbSeries === targetSeries.replace(/^june\s+/i, '') ||
                targetSeries === dbSeries.replace(/^june\s+/i, '');

              return dbBoard === targetBoard &&
                dbCode === targetCode &&
                seriesMatch &&
                dbTier === targetTier;
            });

            if (matchedExamPaper) {
              const questions = (matchedExamPaper as any).questions || [];
              const mainQuestion = Array.isArray(questions)
                ? questions.find((q: any) => {
                  const qNum = q.question_number || q.number;
                  return String(qNum) === String(baseQuestionNumber);
                })
                : questions[baseQuestionNumber];

              if (mainQuestion) {
                mainQuestionDatabaseText = mainQuestion.question_text || mainQuestion.text || mainQuestion.question || '';
              }
            }
          } catch (error) {
            console.warn(`[MARKING SCHEME ORCHESTRATION] Failed to get main question text for Q${baseQuestionNumber}:`, error);
          }
        }

        // Build FULL question text using common formatting function
        const fullDatabaseQuestionText = formatFullQuestionText(
          baseQuestionNumber,
          mainQuestionDatabaseText || '',
          questionNumbers,
          combinedDatabaseQuestionTexts
        );

        // FIX: Calculate total marks dynamically from the detected sub-questions
        // This ensures the max score matches the parts we are actually marking,
        // rather than the database's total which might include missing parts.
        const calculatedTotalMarks = Array.from(subQuestionMaxScoresMap.values()).reduce((a, b) => a + b, 0);
        const finalTotalMarks = calculatedTotalMarks > 0 ? calculatedTotalMarks : parentQuestionMarks;


        // Store merged marking scheme with totalMarks AND parentQuestionMarks for calculateOverallScore
        const schemeWithTotalMarks = {
          questionMarks: mergedQuestionMarks,
          totalMarks: finalTotalMarks,
          parentQuestionMarks: parentQuestionMarks, // Add for student score calculation (64/80)
          questionNumber: baseQuestionNumber,
          questionDetection: questionDetection,
          databaseQuestionText: fullDatabaseQuestionText,
          subQuestionNumbers: questionNumbers,
          subQuestionAnswers: subQuestionAnswers.filter(a => a !== '').length > 0 ? subQuestionAnswers : undefined,
          subQuestionMaxScores: Object.fromEntries(subQuestionMaxScoresMap), // NEW: Pass max scores from database
          generalMarkingGuidance: firstItem.detectionResult.match?.markingScheme?.generalMarkingGuidance // Preserve general guidance
        };

        const uniqueKey = `${baseQuestionNumber}_${examBoard}_${paperCode}`;
        markingSchemesMap.set(uniqueKey, schemeWithTotalMarks);

      } else {
        // Single question (not grouped): store as-is
        const item = group[0];

        if (!item.detectionResult.match?.markingScheme) {
          continue;
        }

        const actualQuestionNumber = item.actualQuestionNumber;
        const uniqueKey = `${actualQuestionNumber}_${examBoard}_${paperCode}`;

        let questionSpecificMarks = null;
        if (item.detectionResult.match.markingScheme.questionMarks) {
          questionSpecificMarks = item.detectionResult.match.markingScheme.questionMarks;
        } else {
          questionSpecificMarks = item.detectionResult.match.markingScheme;
        }

        // Store single-question marking scheme with totalMarks AND parentQuestionMarks for calculateOverallScore
        const schemeWithTotalMarks = {
          questionMarks: questionSpecificMarks,
          totalMarks: item.detectionResult.match.marks,
          parentQuestionMarks: item.detectionResult.match.marks, // Add for student score calculation (64/80)
          questionNumber: actualQuestionNumber,
          questionDetection: item.detectionResult,
          questionText: item.question.text,
          databaseQuestionText: item.detectionResult.match?.databaseQuestionText || '',
          generalMarkingGuidance: item.detectionResult.match?.markingScheme?.generalMarkingGuidance // Preserve general guidance
        };

        markingSchemesMap.set(uniqueKey, schemeWithTotalMarks);
      }
    }

    // Update classificationResult.questions with detected question numbers
    for (const { question, detectionResult } of detectionResults) {
      if (detectionResult.found && detectionResult.match?.questionNumber) {
        const detectedQuestionNumber = detectionResult.match.questionNumber;
        const matchingQuestion = classificationResult.questions.find((q: any) => {
          const textSimilarity = question.text && q.text
            ? stringSimilarity.compareTwoStrings(question.text.toLowerCase(), q.text.toLowerCase())
            : 0;
          return textSimilarity > 0.8;
        });

        if (matchingQuestion && (!matchingQuestion.questionNumber || matchingQuestion.questionNumber === 'null' || matchingQuestion.questionNumber === null)) {
          matchingQuestion.questionNumber = detectedQuestionNumber;
        }
      }
    }

    return {
      markingSchemesMap,
      detectionStats,
      updatedClassificationResult: classificationResult,
      detectionResults // Return raw detection results for granular processing (e.g. Question Mode)
    };
  }

  /**
   * Log detection statistics
   */
  static logDetectionStatistics(detectionStats: DetectionStatistics, detectionResults?: any[]): void {
    // 1. Log New Audit Table
    if (detectionResults) {
      logDetectionAudit(detectionResults);
    }

    const detectionRate = detectionStats.totalQuestions > 0
      ? ((detectionStats.detected / detectionStats.totalQuestions) * 100).toFixed(0)
      : '0';

    console.log(`\n📊 [QUESTION DETECTION STATISTICS]`);
    console.log(`   Total questions: ${detectionStats.totalQuestions}`);
    console.log(`   Detected: ${detectionStats.detected}/${detectionStats.totalQuestions} (${detectionRate}%)`);
    console.log(`   Not detected: ${detectionStats.notDetected}`);

    if (detectionStats.hintInfo) {
      const { hintUsed, matchedPapersCount, matchedPaperTitle, thresholdRelaxed, deepSearchActive, poolSize, rescuedQuestions } = detectionStats.hintInfo;
      const blue = '\x1b[34m';
      const green = '\x1b[32m';
      const yellow = '\x1b[33m';
      const reset = '\x1b[0m';

      console.log(`   ${blue}[HINT] Initial Match: ${matchedPapersCount} paper(s) found for hint "${hintUsed}"${reset}`);

      if (deepSearchActive && rescuedQuestions && rescuedQuestions.length > 0) {
        console.log(`   ${yellow}[HINT] Rescue Mode: Required for ${rescuedQuestions.length} question(s): ${rescuedQuestions.join(', ')}${reset}`);
        console.log(`   ${green}[HINT] Impact: Automated Rescue! Found via Deep Search across all ${poolSize} questions [+]${reset}`);
      } else if (deepSearchActive) {
        console.log(`   ${blue}[HINT] Search Pool: Global (Full Database) with ${poolSize} questions${reset}`);
      } else if (thresholdRelaxed) {
        if (poolSize !== undefined) {
          console.log(`   ${blue}[HINT] Search Pool: ${poolSize} questions within matched paper(s)${reset}`);
        }
        if (thresholdRelaxed) {
          console.log(`   ${green}[HINT] Impact: Threshold relaxed (0.50 → 0.35) due to specific selection [+]${reset}`);
        }
      }

      if (matchedPaperTitle) {
        console.log(`   ${blue}[HINT] Reference Paper: ${matchedPaperTitle}${reset}`);
      }
    }

    // Paper Distribution Summary
    const paperGroups = new Map<string, string[]>();
    detectionStats.questionDetails.forEach(q => {
      if (q.detected && q.matchedPaperTitle) {
        if (!paperGroups.has(q.matchedPaperTitle)) {
          paperGroups.set(q.matchedPaperTitle, []);
        }
        paperGroups.get(q.matchedPaperTitle)!.push(`Q${q.questionNumber || '?'}`);
      }
    });

    if (paperGroups.size > 0) {
      console.log(`   Paper Distribution:`);
      paperGroups.forEach((qs, title) => {
        const color = paperGroups.size > 1 ? '\x1b[31m' : '\x1b[32m'; // Red if split across papers, Green if consistent
        const reset = '\x1b[0m';
        console.log(`     - ${color}${title}${reset}: ${qs.join(', ')}`);
      });
      if (paperGroups.size > 1) {
        console.log(`   \x1b[31m⚠️  WARNING: Questions matched across ${paperGroups.size} different papers! "Frankenstein" result detected.\x1b[0m`);
      }
    }

    console.log(`   With marking scheme: ${detectionStats.withMarkingScheme}`);
    console.log(`   Without marking scheme: ${detectionStats.withoutMarkingScheme}`);
    console.log(`   Similarity ranges:`);
    console.log(`     ≥ 0.90: ${detectionStats.bySimilarityRange.high}/${detectionStats.detected} (${detectionStats.detected > 0 ? ((detectionStats.bySimilarityRange.high / detectionStats.detected) * 100).toFixed(0) : '0'}%)`);
    console.log(`     0.70-0.89: ${detectionStats.bySimilarityRange.medium}/${detectionStats.detected} (${detectionStats.detected > 0 ? ((detectionStats.bySimilarityRange.medium / detectionStats.detected) * 100).toFixed(0) : '0'}%)`);
    console.log(`     0.40-0.69: ${detectionStats.bySimilarityRange.low}/${detectionStats.detected} (${detectionStats.detected > 0 ? ((detectionStats.bySimilarityRange.low / detectionStats.detected) * 100).toFixed(0) : '0'}%)`);

    const questionsWithoutScheme = detectionStats.questionDetails
      .filter(q => q.detected && !q.hasMarkingScheme)
      .map(q => `Q${q.questionNumber || '?'}`)
      .join(', ');
    if (questionsWithoutScheme) {
      console.log(`   Questions without marking scheme: ${questionsWithoutScheme}`);
    }

    const lowSimilarityQuestions = detectionStats.questionDetails
      .filter(q => q.detected && q.similarity !== undefined && q.similarity < 0.70 && q.similarity >= 0.40)
      .map(q => `Q${q.questionNumber || '?'} (${q.similarity?.toFixed(3)})`)
      .join(', ');
    if (lowSimilarityQuestions) {
      const red = '\x1b[31m';
      const reset = '\x1b[0m';
      console.log(`   ${red}Low similarity questions (0.40-0.69): ${lowSimilarityQuestions}${reset}`);
    }

    console.log(`\n`);
  }
}

