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
  }>;
}

export interface MarkingSchemeOrchestrationResult {
  markingSchemesMap: Map<string, any>;
  detectionStats: DetectionStatistics;
  updatedClassificationResult: any;
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
    individualQuestions: Array<{ text: string; questionNumber?: string | null }>,
    classificationResult: any
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
      question: { text: string; questionNumber?: string | null };
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
      questionDetails: []
    };

    // Call question detection for each individual question
    for (const question of individualQuestions) {
      const detectionResult = await questionDetectionService.detectQuestion(question.text, question.questionNumber);

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
          hasMarkingScheme
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
    }

    // Second pass: Group sub-questions by base question number and merge
    const groupedResults = new Map<string, Array<{
      question: { text: string; questionNumber?: string | null };
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

        for (const item of group) {
          const displayQNum = item.originalQuestionNumber || item.actualQuestionNumber;

          // Extract answer for this sub-question
          const subQAnswer = item.detectionResult.match?.answer ||
            item.detectionResult.match?.markingScheme?.answer ||
            item.detectionResult.match?.markingScheme?.questionMarks?.answer ||
            undefined;
          if (subQAnswer && typeof subQAnswer === 'string' && subQAnswer.toLowerCase() !== 'cao') {
            subQuestionAnswers.push(subQAnswer);
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
          subQuestionMarks: Object.fromEntries(subQuestionMarksMap)
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
              .where('metadata.exam_code', '==', firstMatch.paperCode)
              .where('metadata.exam_series', '==', firstMatch.examSeries)
              .get();

            const examPapers = examPapersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            const matchedExamPaper = examPapers.find((ep: any) => {
              const metadata = ep.metadata || {};
              return metadata.exam_board === firstMatch.board &&
                metadata.exam_code === firstMatch.paperCode &&
                metadata.exam_series === firstMatch.examSeries &&
                metadata.tier === firstMatch.tier;
            });

            if (matchedExamPaper) {
              const questions = matchedExamPaper.questions || [];
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

        const schemeWithTotalMarks = {
          questionMarks: mergedQuestionMarks,
          totalMarks: parentQuestionMarks,
          questionNumber: baseQuestionNumber,
          questionDetection: questionDetection,
          databaseQuestionText: fullDatabaseQuestionText,
          subQuestionNumbers: questionNumbers,
          subQuestionAnswers: subQuestionAnswers.filter(a => a !== '').length > 0 ? subQuestionAnswers : undefined,
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

        const schemeWithTotalMarks = {
          questionMarks: questionSpecificMarks,
          totalMarks: item.detectionResult.match.marks,
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
      updatedClassificationResult: classificationResult
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

