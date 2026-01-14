/**
 * Marking Scheme Orchestration Service
 * Handles question detection, grouping, and marking scheme lookup/merging
 * * * CRITICAL FIXES INCLUDED:
 * 1. Frontend Crash Fix: Injects dummy metadata for 'Generic' questions so frontend doesn't break.
 * 2. Annotation Fix: Manually merges and labels sub-question rubrics.
 * 3. Page Index Fix: Propagates sourceImageIndex to ensure correct page ordering.
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

  static async orchestrateMarkingSchemeLookup(
    individualQuestions: Array<{ text: string; questionNumber?: string | null; sourceImageIndex?: number }>,
    classificationResult: any,
    examPaperHint?: string | null
  ): Promise<MarkingSchemeOrchestrationResult> {
    const markingSchemesMap: Map<string, any> = new Map();

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

    // --- STEP 1: GROUP QUESTIONS (Anchor Strategy) ---
    const questionGroups = new Map<string, typeof individualQuestions>();

    for (const q of individualQuestions) {
      const baseNum = getBaseQuestionNumber(q.questionNumber) || 'General';
      if (!questionGroups.has(baseNum)) {
        questionGroups.set(baseNum, []);
      }
      questionGroups.get(baseNum)!.push(q);
    }

    // --- STEP 2: DETECT PER GROUP ---
    const detectionResults: Array<{
      question: { text: string; questionNumber?: string | null; sourceImageIndex?: number };
      detectionResult: any;
    }> = [];

    const detectionStats: DetectionStatistics = {
      totalQuestions: individualQuestions.length,
      detected: 0, notDetected: 0, withMarkingScheme: 0, withoutMarkingScheme: 0,
      bySimilarityRange: { high: 0, medium: 0, low: 0 },
      questionDetails: [], hintInfo: undefined
    };

    for (const [baseNum, group] of questionGroups.entries()) {
      const anchorText = group.map(q => q.text).join('\n\n');

      const groupDetectionResult = await questionDetectionService.detectQuestion(
        anchorText,
        baseNum,
        examPaperHint
      );

      for (const question of group) {
        detectionResults.push({
          question,
          detectionResult: groupDetectionResult
        });

        const similarity = groupDetectionResult.match?.confidence || 0;
        const hasScheme = !!groupDetectionResult.match?.markingScheme;

        if (groupDetectionResult.found) {
          detectionStats.detected++;
          if (hasScheme) detectionStats.withMarkingScheme++; else detectionStats.withoutMarkingScheme++;
          if (similarity >= 0.9) detectionStats.bySimilarityRange.high++;
          else if (similarity >= 0.7) detectionStats.bySimilarityRange.medium++;
          else if (similarity >= 0.4) detectionStats.bySimilarityRange.low++;
        } else {
          detectionStats.notDetected++;
        }

        detectionStats.questionDetails.push({
          questionNumber: question.questionNumber,
          detected: groupDetectionResult.found,
          similarity,
          hasMarkingScheme: hasScheme,
          matchedPaperTitle: groupDetectionResult.match?.paperTitle
        });
      }

      if (groupDetectionResult.hintMetadata && !detectionStats.hintInfo) {
        detectionStats.hintInfo = { ...groupDetectionResult.hintMetadata, rescuedQuestions: [] };
      }
    }

    // --- STEP 3: RECOVERY LOGIC ---
    const hintInfo = detectionStats.hintInfo;
    if (hintInfo) {
      const hintUsed = hintInfo.hintUsed || '';
      const matchedPapersCount = hintInfo.matchedPapersCount || 0;
      const detectedCount = detectionStats.detected;
      const totalCount = detectionStats.totalQuestions;
      const detectionRate = totalCount > 0 ? detectedCount / totalCount : 0;

      const distinctPapers = new Set(detectionStats.questionDetails
        .filter(q => q.detected && q.matchedPaperTitle)
        .map(q => q.matchedPaperTitle)
      );

      let shouldRestart = false;
      let restartReason = '';

      if (detectedCount > 0 && distinctPapers.size > 1) {
        shouldRestart = true;
        restartReason = `Frankenstein result detected (${distinctPapers.size} papers found)`;
      }
      else if (matchedPapersCount === 1 && detectionRate < 0.8) {
        shouldRestart = true;
        restartReason = `Low adherence to unique hint (${detectedCount}/${totalCount} found)`;
      }
      else if (matchedPapersCount > 1 && detectionRate < 0.5) {
        shouldRestart = true;
        restartReason = `Poor match density in hinted pool`;
      }

      if (shouldRestart && examPaperHint !== null) {
        console.log(`\x1b[31m[HINT] ⚠️ Hint Adherence Failed! ${restartReason}. Restarting GLOBALLY...\x1b[0m`);
        return this.orchestrateMarkingSchemeLookup(individualQuestions, classificationResult, null);
      }
    }

    // --- STEP 4: CONSENSUS RULE ---
    const paperCounts = new Map<string, number>();
    const paperToMatch = new Map<string, any>();

    detectionResults.forEach(dr => {
      if (dr.detectionResult.match?.paperTitle) {
        const title = dr.detectionResult.match.paperTitle;
        paperCounts.set(title, (paperCounts.get(title) || 0) + 1);
        if (!paperToMatch.has(title)) paperToMatch.set(title, dr.detectionResult.match);
      }
    });

    let dominantPaper: string | null = null;
    const totalVotes = Array.from(paperCounts.values()).reduce((a, b) => a + b, 0);

    for (const [title, count] of paperCounts.entries()) {
      if (count / totalVotes >= 0.8) {
        dominantPaper = title;
        break;
      }
    }

    const hasConflicts = paperCounts.size > 1;
    const hasGaps = detectionStats.notDetected > 0;

    if (dominantPaper && (hasConflicts || hasGaps)) {
      console.log(`\x1b[32m[HINT] 🏛️ Consensus Reached! Forcing all questions to "${dominantPaper}"\x1b[0m`);
      const dominantMatchBase = paperToMatch.get(dominantPaper);
      const processedGroups = new Set<string>();

      for (const dr of detectionResults) {
        const baseNum = getBaseQuestionNumber(dr.question.questionNumber);

        const isWrongPaper = dr.detectionResult.match?.paperTitle !== dominantPaper;
        const isGap = !dr.detectionResult.found;

        if ((isWrongPaper || isGap) && !processedGroups.has(baseNum)) {
          processedGroups.add(baseNum);

          const forcedHint = `${dominantMatchBase.board} ${dominantMatchBase.paperCode} ${dominantMatchBase.examSeries} ${dominantMatchBase.tier}`;

          const rescuedResult = await questionDetectionService.detectQuestion(dr.question.text, dr.question.questionNumber, forcedHint);

          if (rescuedResult.found && rescuedResult.match?.paperTitle === dominantPaper) {
            console.log(`   └─ Rescued Group Q${baseNum} -> ${dominantPaper}`);
            detectionResults
              .filter(d => getBaseQuestionNumber(d.question.questionNumber) === baseNum)
              .forEach(d => d.detectionResult = rescuedResult);
          }
        }
      }
    }

    // --- STEP 5: MERGE & FORMAT OUTPUT (GENERIC KEY MISMATCH FIX) ---

    const groupedResults = new Map<string, Array<{
      question: { text: string; questionNumber?: string | null; sourceImageIndex?: number };
      detectionResult: any;
      actualQuestionNumber: string;
      originalQuestionNumber: string | null | undefined;
      examBoard: string;
      paperCode: string;
    }>>();

    // 0. Pre-processing: Convert "Not Found" to "Mock Match"
    for (const item of detectionResults) {
      if (!item.detectionResult.match) {
        // [CRITICAL FIX] Use the ACTUAL question number (e.g. "12") instead of default "1"
        // This ensures the AI Prompt Generator finds the rubric using the correct key.
        const qNum = item.question.questionNumber || 'General';

        // Standard Generic Rubric
        const genericRubric = [
          { mark: 'M1', guidance: 'Method mark: Correct approach or substitution.' },
          { mark: 'A1', guidance: 'Accuracy mark: Correct final answer.' },
          { mark: 'B1', guidance: 'Independent mark: Correct statement or property.' }
        ];

        // Populate sub-marks with the CORRECT key
        const subQMarks = { [qNum]: genericRubric };

        item.detectionResult.match = {
          board: 'Unknown',
          qualification: 'General',
          paperCode: 'Generic Question',
          examSeries: 'N/A',
          tier: 'N/A',
          subject: 'General',
          paperTitle: 'General Question (No Past Paper Match)',
          questionNumber: qNum,
          confidence: 0,
          markingScheme: {
            questionMarks: {
              marks: genericRubric,
              subQuestionMarks: subQMarks // Now keyed correctly as {"12": [...]}
            },
            generalMarkingGuidance: "Standard generic marking applies."
          }
        };
        item.detectionResult.found = true;
      }
    }

    // 1. Grouping Loop
    for (const { question, detectionResult } of detectionResults) {
      const actualQuestionNumber = detectionResult.match.questionNumber;
      const questionNumberForGrouping = question.questionNumber || actualQuestionNumber;
      const baseQuestionNumber = getBaseQuestionNumber(questionNumberForGrouping);

      const board = detectionResult.match.board || 'Unknown';
      const code = detectionResult.match.paperCode || 'Unknown';
      const groupKey = `${baseQuestionNumber}_${board}_${code}`;

      if (!groupedResults.has(groupKey)) groupedResults.set(groupKey, []);

      groupedResults.get(groupKey)!.push({
        question, detectionResult, actualQuestionNumber,
        originalQuestionNumber: question.questionNumber,
        examBoard: board,
        paperCode: code
      });
    }

    // 2. Merge Logic
    for (const [groupKey, group] of groupedResults.entries()) {
      const baseQuestionNumber = groupKey.split('_')[0];
      const examBoard = group[0].examBoard;
      const paperCode = group[0].paperCode;

      // Get page index from first item (fixes "Page null")
      const groupSourceImageIndex = group[0].question.sourceImageIndex ?? 0;

      const masterMatch = group[0].detectionResult.match;
      const parentScheme = masterMatch?.markingScheme?.questionMarks;

      const hasSubQuestions = group.some(item => isSubQuestion(item.originalQuestionNumber));

      // CASE A: COMPOSITE SCHEME (Includes our Mocked Generics)
      // Since our Mock Match has 'subQuestionMarks' populated, it enters here.
      if (parentScheme && (parentScheme.isComposite || parentScheme.subQuestionMarks)) {

        const questionNumbers = group.map(item => item.originalQuestionNumber || item.actualQuestionNumber);

        const subQMarksMap: any = parentScheme.subQuestionMarks || {};

        // Safety: If subQMarks is empty but marks exists, fill it (Catch-all)
        if (parentScheme.marks && Object.keys(subQMarksMap).length === 0) {
          questionNumbers.forEach(qNum => {
            if (qNum) subQMarksMap[qNum] = parentScheme.marks;
          });
        }

        // Force-fill if keys mismatch (e.g. input "12a" vs rubric "12")
        // This handles cases where our Generic Mock used "12" but the input was "12a"
        if (paperCode === 'Generic Question') {
          questionNumbers.forEach(qNum => {
            if (qNum && !subQMarksMap[qNum]) {
              subQMarksMap[qNum] = parentScheme.marks;
            }
          });
        }

        const rawAns = parentScheme.answer || '';
        const subAns = rawAns.includes('\n') ? rawAns.split('\n') : [rawAns];

        const uniqueKey = `${baseQuestionNumber}_${examBoard}_${paperCode}`;
        markingSchemesMap.set(uniqueKey, {
          questionMarks: {
            marks: parentScheme.marks,
            subQuestionMarks: subQMarksMap
          },
          totalMarks: masterMatch.marks || 5,
          parentQuestionMarks: masterMatch.parentQuestionMarks || 5,
          questionNumber: baseQuestionNumber,
          questionDetection: group[0].detectionResult,
          databaseQuestionText: masterMatch.databaseQuestionText || '',
          subQuestionNumbers: questionNumbers,
          subQuestionAnswers: subAns,
          isGeneric: (paperCode === 'Generic Question'),
          sourceImageIndex: groupSourceImageIndex
        });
        continue;
      }

      // CASE B: STANDARD MERGE
      if (hasSubQuestions && parentScheme && !Array.isArray(parentScheme)) {
        const questionNumbers: string[] = [];
        const subQuestionMarksMap = new Map<string, any[]>();
        const subQuestionAnswers: string[] = [];
        const mergedMarks: any[] = [];

        let subPartsSource: any = parentScheme;
        if (parentScheme.sub_questions) subPartsSource = parentScheme.sub_questions;
        else if (parentScheme.subQuestions) subPartsSource = parentScheme.subQuestions;
        else if (parentScheme.parts) subPartsSource = parentScheme.parts;

        group.forEach(item => {
          const subLabel = (item.originalQuestionNumber || '').match(/([a-z]+|[ivx]+)$/i)?.[1].toLowerCase() || '';
          const normalizedSubLabel = normalizeSubQuestionPart(subLabel);
          const fullQNum = `${baseQuestionNumber}${normalizedSubLabel}`;

          let targetScheme = null;

          if (Array.isArray(subPartsSource)) {
            targetScheme = subPartsSource.find((s: any) => {
              const p = s.question_part || s.part || s.label || s.sub_question_number || s.number;
              return normalizeSubQuestionPart(String(p)) === normalizedSubLabel;
            });
          } else {
            const key = Object.keys(subPartsSource).find(k =>
              k === fullQNum || k === normalizedSubLabel || k.toLowerCase().endsWith(normalizedSubLabel)
            );
            if (key) targetScheme = subPartsSource[key];
          }

          if (!targetScheme && parentScheme.marks) targetScheme = parentScheme;

          if (targetScheme) {
            questionNumbers.push(fullQNum);

            let partMarks: any[] = [];
            if (Array.isArray(targetScheme)) partMarks = targetScheme;
            else if (Array.isArray(targetScheme.marks)) partMarks = targetScheme.marks;
            else if (Array.isArray(targetScheme.questionMarks)) partMarks = targetScheme.questionMarks;

            subQuestionMarksMap.set(fullQNum, partMarks);

            const ans = targetScheme.answer || (targetScheme.questionMarks && targetScheme.questionMarks.answer);
            if (ans) subQuestionAnswers.push(`(${normalizedSubLabel}) ${ans}`);

            const labelledMarks = partMarks.map((m: any) => ({
              ...m,
              mark: m.mark,
              guidance: `[Part ${normalizedSubLabel}] ${m.guidance || m.comments || ''}`
            }));
            mergedMarks.push(...labelledMarks);
          }
        });

        if (questionNumbers.length > 0) {
          const uniqueKey = `${baseQuestionNumber}_${examBoard}_${paperCode}`;
          markingSchemesMap.set(uniqueKey, {
            questionMarks: {
              marks: mergedMarks,
              subQuestionMarks: Object.fromEntries(subQuestionMarksMap)
            },
            totalMarks: masterMatch.marks || 0,
            parentQuestionMarks: masterMatch.parentQuestionMarks || 0,
            questionNumber: baseQuestionNumber,
            questionDetection: group[0].detectionResult,
            databaseQuestionText: masterMatch.databaseQuestionText,
            subQuestionNumbers: questionNumbers,
            subQuestionAnswers: subQuestionAnswers,
            isGeneric: false,
            sourceImageIndex: groupSourceImageIndex
          });
          continue;
        }
      }

      // CASE C: SINGLE QUESTION
      const item = group[0];
      const uniqueKey = `${item.actualQuestionNumber}_${examBoard}_${paperCode}`;
      markingSchemesMap.set(uniqueKey, {
        questionMarks: item.detectionResult.match.markingScheme?.questionMarks || item.detectionResult.match.markingScheme,
        totalMarks: item.detectionResult.match.marks || 5, // Default for generic
        parentQuestionMarks: item.detectionResult.match.marks || 5,
        questionNumber: item.actualQuestionNumber,
        questionDetection: item.detectionResult,
        questionText: item.question.text,
        databaseQuestionText: item.detectionResult.match?.databaseQuestionText || '',
        generalMarkingGuidance: item.detectionResult.match?.markingScheme?.generalMarkingGuidance,
        sourceImageIndex: groupSourceImageIndex
      });
    }

    // Update classification result
    for (const { question, detectionResult } of detectionResults) {
      if (detectionResult.found && detectionResult.match?.questionNumber) {
        const detectedQuestionNumber = detectionResult.match.questionNumber;
        const matchingQuestion = classificationResult.questions.find((q: any) =>
          q === question || (q.text && question.text && q.text.includes(question.text.substring(0, 20)))
        );
        if (matchingQuestion && !matchingQuestion.questionNumber) {
          matchingQuestion.questionNumber = detectedQuestionNumber;
        }
      }
    }

    return {
      markingSchemesMap,
      detectionStats,
      updatedClassificationResult: classificationResult,
      detectionResults
    };
  }

  static logDetectionStatistics(detectionStats: DetectionStatistics, detectionResults?: any[]): void {
    if (detectionResults) logDetectionAudit(detectionResults);

    console.log(`\n📊 [QUESTION DETECTION STATISTICS]`);
    console.log(`   Total questions: ${detectionStats.totalQuestions}`);
    console.log(`   Detected: ${detectionStats.detected}/${detectionStats.totalQuestions}`);
    console.log(`   Not detected: ${detectionStats.notDetected}`);

    if (detectionStats.hintInfo) {
      console.log(`   [HINT] Hint Used: "${detectionStats.hintInfo.hintUsed}"`);
      console.log(`   [HINT] Matched Papers: ${detectionStats.hintInfo.matchedPapersCount}`);
    }
  }
}
