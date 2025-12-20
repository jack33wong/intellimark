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

        detectionStats.questionDetails.push({
          questionNumber: question.questionNumber,
          detected: true,
          similarity,
          hasMarkingScheme,
          matchedPaperTitle: detectionResult.match?.markingScheme?.examDetails?.paper || detectionResult.hintMetadata?.matchedPaperTitle
        });

        detectionResults.push({ question, detectionResult });
      } else {
        detectionStats.notDetected++;
        detectionStats.questionDetails.push({
          questionNumber: question.questionNumber,
          detected: false,
          hasMarkingScheme: false
        });
      }

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

    // ALL-OR-NOTHING CHECK (Scenario 1)
    // If a unique hint was given (1 paper pool) and we didn't find 100% of questions, the hint is likely wrong.
    const hintInfo = detectionStats.hintInfo;
    const isScenario1 = hintInfo && hintInfo.matchedPapersCount === 1;

    if (isScenario1 && detectionStats.detected < detectionStats.totalQuestions) {
      console.log(`\x1b[31m[HINT] ⚠️ Unique Hint Adherence Failed! Only ${detectionStats.detected}/${detectionStats.totalQuestions} questions found in "${hintInfo.hintUsed}".\x1b[0m`);
      console.log(`\x1b[33m[HINT] Discarding hint and restarting detection GLOBALLY for document consistency...\x1b[0m`);

      // Restart detection without the hint (Scenario 3)
      return this.orchestrateMarkingSchemeLookup(individualQuestions, null);
    }

    // BATCH CONSISTENCY: Paper Locking
    // Identify the "Winner Paper" (the one that matched the most questions with high confidence)
    const paperCounts = new Map<string, { count: number; examPaper: any; paperTitle: string }>();
    for (const { detectionResult } of detectionResults) {
      if (detectionResult.found && detectionResult.match) {
        const title = detectionResult.match.paperTitle || 'Unknown';
        if (!paperCounts.has(title)) {
          paperCounts.set(title, {
            count: 0,
            examPaper: detectionResult.match.examPaper,
            paperTitle: title
          });
        }
        // Only count strong matches for voting
        if ((detectionResult.match.confidence || 0) >= 0.70) {
          paperCounts.get(title)!.count++;
        }
      }
    }

    let winner: { paperTitle: string; examPaper: any } | null = null;
    let maxCount = 0;
    paperCounts.forEach((v, k) => {
      if (v.count > maxCount) {
        maxCount = v.count;
        winner = { paperTitle: v.paperTitle, examPaper: v.examPaper };
      }
    });

    // If we have a clear winner (>60% of strong matches OR at least 4 strong matches in a small batch), lock it!
    const WINNER_THRESHOLD = individualQuestions.length > 5 ? individualQuestions.length * 0.6 : 4;
    if (winner && (maxCount >= WINNER_THRESHOLD)) {
      console.log(`\x1b[32m[HINT] 🔒 Paper Lock: "${winner.paperTitle}" detected as winner (${maxCount}/${individualQuestions.length} votes). Locking consistency...\x1b[0m`);

      for (const item of detectionResults) {
        const currentTitle = item.detectionResult.match?.paperTitle;
        const confidence = item.detectionResult.match?.confidence || 0;

        // If question matched a DIFFERENT paper, or was weak, try to re-match it with the winner paper ONLY
        if (currentTitle !== winner.paperTitle || confidence < 0.75) {
          const reMatch = await questionDetectionService.matchQuestionWithExamPaper(
            item.question.text,
            winner.examPaper,
            item.question.questionNumber
          );

          // If we found a reasonable match in the winner paper, swap it!
          // We are more lenient here (0.4) because we WANT it to be consistent with the winner
          if (reMatch && (reMatch.confidence || 0) >= 0.40) {
            item.detectionResult.match = reMatch;
            item.detectionResult.found = true;
            if (item.detectionResult.hintMetadata) {
              item.detectionResult.hintMetadata.isWeakMatch = (reMatch.confidence || 0) < 0.7;
            }

            const ms = await questionDetectionService.findCorrespondingMarkingScheme(reMatch);
            if (ms) reMatch.markingScheme = ms;

            // Update statistics to reflect the consistent match
            const statEntry = detectionStats.questionDetails.find(q => q.questionNumber === item.question.questionNumber);
            if (statEntry) {
              statEntry.similarity = reMatch.confidence;
              statEntry.hasMarkingScheme = !!ms;
              statEntry.matchedPaperTitle = winner.paperTitle;
            }
          }
        }
      }
    }

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
      const baseQuestionNumber = groupKey.split('_')[0];
      const examBoard = group[0].examBoard;
      const paperCode = group[0].paperCode;

      const hasSubQuestions = group.some(item => isSubQuestion(item.originalQuestionNumber));

      if (hasSubQuestions && group.length > 1) {
        // Group sub-questions: merge marking schemes
        const firstItem = group[0];
        const parentQuestionMarks = firstItem.detectionResult.match?.parentQuestionMarks;

        if (!parentQuestionMarks) {
          throw new Error(`Parent question marks not found for grouped sub-questions Q${baseQuestionNumber}. Expected structure: match.parentQuestionMarks`);
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

        for (const item of group) {
          const displayQNum = item.originalQuestionNumber || item.actualQuestionNumber;

          // Extract just the sub-question label (e.g., "11a" -> "a") for deduplication
          const match = displayQNum.match(/([a-z]+|[ivx]+)$/i);
          const subLabel = match ? match[1].toLowerCase() : displayQNum.toLowerCase();

          // Skip if we've already processed this sub-question (prevents duplicate marks)
          if (processedSubLabels.has(subLabel)) {
            continue;
          }
          processedSubLabels.add(subLabel);

          // Extract answer for this sub-question
          const subQAnswer = item.detectionResult.match?.answer ||
            item.detectionResult.match?.markingScheme?.answer ||
            item.detectionResult.match?.markingScheme?.questionMarks?.answer ||
            undefined;

          if (subQAnswer && typeof subQAnswer === 'string') {
            // Always capture answer, even if 'cao' (we'll handle 'cao' replacement in MarkingInstructionService)
            subQuestionAnswers.push(subQAnswer);
            subQuestionAnswersMap.set(subLabel, subQAnswer);
          } else {
            subQuestionAnswers.push('');
          }

          // Extract marks array
          let marksArray: any[] = [];
          const markingScheme = item.detectionResult.match?.markingScheme;
          let questionMarks: any = null;

          if (markingScheme) {
            questionMarks = markingScheme.questionMarks;

            if (questionMarks) {
              if (Array.isArray(questionMarks.marks)) {
                marksArray = questionMarks.marks;
              } else if (Array.isArray(questionMarks)) {
                marksArray = questionMarks;
              } else if (questionMarks.marks && Array.isArray(questionMarks.marks)) {
                marksArray = questionMarks.marks;
              } else if (typeof questionMarks === 'object' && 'marks' in questionMarks) {
                const marksValue = questionMarks.marks;
                if (Array.isArray(marksValue)) {
                  marksArray = marksValue;
                } else if (marksValue && typeof marksValue === 'object' && Array.isArray(marksValue.marks)) {
                  marksArray = marksValue.marks;
                }
              }
            }
          }

          if (marksArray.length === 0) {
            console.warn(`[MERGE WARNING] No marks extracted for sub-question ${displayQNum} in group Q${baseQuestionNumber}`);
          }

          subQuestionMarksMap.set(displayQNum, marksArray);
          mergedMarks.push(...marksArray);

          // NEW: Extract max score directly from database (simple number from sub_questions[].marks)
          const maxScore = item.detectionResult.match?.marks; // This is the max score (e.g., 1, 2)
          if (typeof maxScore === 'number') {
            subQuestionMaxScoresMap.set(subLabel, maxScore);
          }

          combinedQuestionTexts.push(item.question.text);
          const dbQuestionText = item.detectionResult.match?.databaseQuestionText || '';
          if (dbQuestionText) {
            combinedDatabaseQuestionTexts.push(dbQuestionText);
          }
          questionNumbers.push(displayQNum);
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
        const firstMatch = firstItem.detectionResult.match;
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
  static logDetectionStatistics(detectionStats: DetectionStatistics): void {
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

      if (deepSearchActive) {
        const rescuedList = rescuedQuestions && rescuedQuestions.length > 0 ? `: ${rescuedQuestions.join(', ')}` : '';
        console.log(`   ${yellow}[HINT] Rescue Mode: Required for ${rescuedQuestions?.length || 0} question(s)${rescuedList}${reset}`);
        console.log(`   ${green}[HINT] Impact: Automated Rescue! Found via Deep Search across all ${poolSize} questions [+]${reset}`);
      } else {
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

