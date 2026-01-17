/**
 * Marking Scheme Orchestration Service
 * Handles question detection, grouping, and marking scheme lookup/merging
 * * * CRITICAL FIX: SEQUENTIAL RUBRIC & SAFE CEILING
 * 1. Replaces duplicates with SEQUENTIAL CODES (M1-M6, A1-A6) to fix log/limit errors.
 * 2. Adds NEGATIVE CODES (M0, A0, B0) for expert corrections.
 * 3. Sets Total Marks to a SAFE CEILING (20) to prevent capping valid marks.
 */

import { logDetectionAudit } from './MarkingHelpers.js';
import { questionDetectionService } from './questionDetectionService.js';
import { getBaseQuestionNumber, normalizeSubQuestionPart } from '../../utils/TextNormalizationUtils.js';

// --- CONFIGURATION ---
const GENERIC_EXAMINER_INSTRUCTION = `
⚠️ NO OFFICIAL MARKING SCHEME AVAILABLE (GENERIC MODE).
1. You are the CHIEF EXAMINER.
2. GRADING STRATEGY:
   - Use M1, M2, M3... for sequential Method steps (correct approach).
   - Use A1, A2, A3... for sequential Accuracy steps (correct values).
   - Use B1, B2, B3... for Independent statements/reasons.
   - Use M0/A0/B0 ONLY to explicitly flag incorrect steps.
3. LIMITS:
   - Ignore the 'Total 20' ceiling. It is just a buffer.
   - Determine the actual value of the question yourself (e.g., if it's worth 4 marks, award 4 marks).
   - Do NOT award more marks than the question is logically worth.
`;

export interface DetectionStatistics {
  totalQuestions: number;
  detected: number;
  notDetected: number;
  withMarkingScheme: number;
  withoutMarkingScheme: number;
  bySimilarityRange: { high: number; medium: number; low: number; };
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

  // [HELPER] Smart Estimate from Text (Used for guidance, not hard limit)
  // [HELPER] Smart Estimate from Text (Used for guidance, not hard limit)
  private static smartEstimateMaxMarks(text: string, questionNumber?: string | null): number | null {
    if (!text) return null;

    // Normalize text (simplify whitespace)
    const normalizedText = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
    console.log(`[DEBUG] smartEstimateMaxMarks processing text (len=${text.length}) for Q${questionNumber || '?'}`);

    // 0. TARGETED SEARCH (If Question Number is known) - Critical for full page OCR
    if (questionNumber) {
      const exactQPattern = new RegExp(`Total\\s+(?:for\\s+Question\\s+)?${questionNumber}\\s+(?:is\\s+)?(\\d+)\\s*marks?`, 'i');
      const exactMatch = normalizedText.match(exactQPattern);
      if (exactMatch) {
        console.log(`[DEBUG] Found targeted max marks for Q${questionNumber}: ${exactMatch[1]}`);
        return parseInt(exactMatch[1], 10);
      }
    }

    // 1. Explicit Footer: "(Total X marks)" or "(Total for Question X is Y marks)"
    // We prioritize these as they are standard format
    const footerPatterns = [
      /\(\s*Total\s+for\s+Question\s+\d+\s+is\s+(\d+)\s+marks?\s*\)/i, // Explicit full footer
      /\(\s*Total\s+(?:is\s+)?(\d+)\s+marks?\s*\)/i,                    // Standard (Total 4 marks)
      /Total\s+for\s+Question\s+\d+\s+is\s+(\d+)\s+marks?/i             // Missing parens
    ];

    for (const pattern of footerPatterns) {
      const match = normalizedText.match(pattern);
      if (match) {
        console.log(`[DEBUG] Found footer max marks: ${match[1]}`);
        return parseInt(match[1], 10);
      }
    }

    // 2. Loose / Fallback Patterns
    const loosePatterns = [
      /\[\s*(\d+)\s*marks?\s*\]/i,         // [4 marks]
      /\bTotal\s*:?\s*(\d+)\s*marks?/i,    // Total: 4 marks
      /\(\s*(\d+)\s*marks?\s*\)/i          // (4 marks) - risky, hence last
    ];
    for (const pattern of loosePatterns) {
      const match = normalizedText.match(pattern);
      if (match && match[1]) {
        const marks = parseInt(match[1], 10);
        // Sanity check: Generic questions usually 1-20 marks.
        if (!isNaN(marks) && marks > 0 && marks <= 50) return marks;
      }
    }

    return null; // Return null if not found (caller handles default)
  }

  // [HELPER] Generate Sequential Rubric (M1, M2... M6)
  // Fixes "Duplicated marking scheme" and "Dropped excess token".
  private static generateSequentialRubric(detectedMax: number): any[] {
    const rubric = [];
    // Ensure we have enough tokens even for large questions.
    // REDUCED BUFFER: If detectedMax is 4, we give exactly 4 slots. If 0, we give 4.
    const count = detectedMax > 0 ? detectedMax : 4;

    // Sequential Method Marks
    for (let i = 1; i <= count; i++) {
      rubric.push({
        mark: `M${i}`, value: 1,
        guidance: 'Method: Correct approach, substitution, or rearrangement.',
        comments: 'Method mark', notes: 'Method', details: 'Method'
      });
    }
    // Sequential Accuracy Marks
    for (let i = 1; i <= count; i++) {
      rubric.push({
        mark: `A${i}`, value: 1,
        guidance: 'Accuracy: Correct final answer or intermediate precision.',
        comments: 'Accuracy mark', notes: 'Accuracy', details: 'Accuracy'
      });
    }
    // Sequential Independent Marks
    for (let i = 1; i <= count; i++) {
      rubric.push({
        mark: `B${i}`, value: 1,
        guidance: 'Independent: Correct statement, definition, or property.',
        comments: 'Independent mark', notes: 'Independent', details: 'Independent'
      });
    }

    // Negative Marks (Single instance is enough as they don't sum up)
    rubric.push({ mark: 'M0', value: 0, guidance: 'Method: Incorrect approach.', comments: 'Method lost' });
    rubric.push({ mark: 'A0', value: 0, guidance: 'Accuracy: Incorrect value.', comments: 'Accuracy lost' });
    rubric.push({ mark: 'B0', value: 0, guidance: 'Independent: Invalid statement.', comments: 'Mark lost' });

    return rubric;
  }

  static async orchestrateMarkingSchemeLookup(
    individualQuestions: Array<{ text: string; questionNumber?: string | null; sourceImageIndex?: number }>,
    classificationResult: any,
    examPaperHint?: string | null,
    extractedOcrText?: string // New Parameter for reliable max mark searching
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

    // --- STEP 1: GROUP QUESTIONS ---
    const questionGroups = new Map<string, typeof individualQuestions>();
    for (const q of individualQuestions) {
      const baseNum = getBaseQuestionNumber(q.questionNumber) || 'General';
      if (!questionGroups.has(baseNum)) questionGroups.set(baseNum, []);
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
      const groupDetectionResult = await questionDetectionService.detectQuestion(anchorText, baseNum, examPaperHint);

      for (const question of group) {
        detectionResults.push({ question, detectionResult: groupDetectionResult });

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
        shouldRestart = true; restartReason = `Frankenstein result detected`;
      } else if (matchedPapersCount === 1 && detectionRate < 0.8) {
        shouldRestart = true; restartReason = `Low adherence to unique hint`;
      } else if (matchedPapersCount > 1 && detectionRate < 0.5) {
        shouldRestart = true; restartReason = `Poor match density`;
      }

      if (shouldRestart && examPaperHint !== null) {
        console.log(`\x1b[31m[HINT] ⚠️ Hint Adherence Failed! ${restartReason}. Restarting...\x1b[0m`);
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
      if (count / totalVotes >= 0.8) { dominantPaper = title; break; }
    }

    if (dominantPaper && (paperCounts.size > 1 || detectionStats.notDetected > 0)) {
      console.log(`\x1b[32m[HINT] 🏛️ Consensus Reached! Forcing to "${dominantPaper}"\x1b[0m`);
      const dominantMatchBase = paperToMatch.get(dominantPaper);
      const processedGroups = new Set<string>();

      for (const dr of detectionResults) {
        const baseNum = getBaseQuestionNumber(dr.question.questionNumber);
        if ((dr.detectionResult.match?.paperTitle !== dominantPaper || !dr.detectionResult.found) && !processedGroups.has(baseNum)) {
          processedGroups.add(baseNum);
          const forcedHint = `${dominantMatchBase.board} ${dominantMatchBase.paperCode} ${dominantMatchBase.examSeries} ${dominantMatchBase.tier}`;
          const rescuedResult = await questionDetectionService.detectQuestion(dr.question.text, dr.question.questionNumber, forcedHint);
          if (rescuedResult.found && rescuedResult.match?.paperTitle === dominantPaper) {
            console.log(`   └─ Rescued Group Q${baseNum} -> ${dominantPaper}`);
            detectionResults.filter(d => getBaseQuestionNumber(d.question.questionNumber) === baseNum).forEach(d => d.detectionResult = rescuedResult);
          }
        }
      }
    }

    // --- STEP 5: MERGE & FORMAT OUTPUT (SEQUENTIAL RUBRIC FIX) ---

    const groupedResults = new Map<string, Array<{
      question: { text: string; questionNumber?: string | null; sourceImageIndex?: number };
      detectionResult: any;
      actualQuestionNumber: string;
      originalQuestionNumber: string | null | undefined;
      examBoard: string;
      paperCode: string;
    }>>();

    // 0. Pre-processing: Create "Virtual Matches" for Generic Questions
    for (const item of detectionResults) {
      if (!item.detectionResult.match) {
        const qNum = item.question.questionNumber || '1';

        // 1. Smart Mark Estimation
        const detectedMarks = this.smartEstimateMaxMarks(item.question.text);

        // 2. Generate SEQUENTIAL Rubric (M1, M2... M6)
        // This prevents "Dropped Token" errors and looks clean in logs.
        const sequentialRubric = this.generateSequentialRubric(detectedMarks);

        const subQMarks = { [qNum]: sequentialRubric };

        // 3. Set a SAFE CEILING for Total Marks (e.g., 20)
        // If we found a mark total in the text (e.g. "Total 4 marks"), use it!
        // Otherwise, use 20 to allow the AI full freedom.
        const safeCeiling = detectedMarks > 0 ? detectedMarks : 20;

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
          marks: safeCeiling,
          parentQuestionMarks: safeCeiling,
          markingScheme: {
            questionMarks: {
              marks: sequentialRubric,
              subQuestionMarks: subQMarks
            },
            generalMarkingGuidance: GENERIC_EXAMINER_INSTRUCTION
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
      const groupSourceImageIndex = group[0].question.sourceImageIndex ?? 0;

      const masterMatch = group[0].detectionResult.match;
      const parentScheme = masterMatch?.markingScheme?.questionMarks;

      const hasSubQuestions = group.some(item => isSubQuestion(item.originalQuestionNumber));

      // CASE A: COMPOSITE OR GENERIC SCHEME
      if (parentScheme && (parentScheme.isComposite || parentScheme.subQuestionMarks)) {
        const questionNumbers = group.map(item => item.originalQuestionNumber || item.actualQuestionNumber);
        const subQMarksMap: any = parentScheme.subQuestionMarks || {};

        if (parentScheme.marks && Object.keys(subQMarksMap).length === 0) {
          questionNumbers.forEach(qNum => { if (qNum) subQMarksMap[qNum] = parentScheme.marks; });
        }

        if (paperCode === 'Generic Question') {
          questionNumbers.forEach(qNum => {
            if (qNum && !subQMarksMap[qNum]) subQMarksMap[qNum] = parentScheme.marks;
          });
        }

        const rawAns = parentScheme.answer || '';
        const subAns = rawAns.includes('\n') ? rawAns.split('\n') : [rawAns];

        const uniqueKey = `${baseQuestionNumber}_${examBoard}_${paperCode}`;
        markingSchemesMap.set(uniqueKey, {
          questionMarks: { marks: parentScheme.marks, subQuestionMarks: subQMarksMap },
          totalMarks: masterMatch.marks || 20, // Keep safe ceiling
          parentQuestionMarks: masterMatch.parentQuestionMarks || 20,
          questionNumber: baseQuestionNumber,
          questionDetection: group[0].detectionResult,
          databaseQuestionText: masterMatch.databaseQuestionText || '',
          subQuestionNumbers: questionNumbers,
          subQuestionAnswers: subAns,
          isGeneric: (paperCode === 'Generic Question'),
          generalMarkingGuidance: masterMatch.markingScheme.generalMarkingGuidance,
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
            questionMarks: { marks: mergedMarks, subQuestionMarks: Object.fromEntries(subQuestionMarksMap) },
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
        totalMarks: (paperCode === 'Generic Question')
          ? (MarkingSchemeOrchestrationService.smartEstimateMaxMarks(extractedOcrText || '', item.actualQuestionNumber) || MarkingSchemeOrchestrationService.smartEstimateMaxMarks(item.question.text || '', item.actualQuestionNumber) || 20)
          : (item.detectionResult.match.marks || 20),
        parentQuestionMarks: (paperCode === 'Generic Question')
          ? (MarkingSchemeOrchestrationService.smartEstimateMaxMarks(extractedOcrText || '', item.actualQuestionNumber) || MarkingSchemeOrchestrationService.smartEstimateMaxMarks(item.question.text || '', item.actualQuestionNumber) || 20)
          : (item.detectionResult.match.marks || 20),
        questionNumber: item.actualQuestionNumber,
        questionDetection: item.detectionResult,
        questionText: item.question.text,
        databaseQuestionText: item.detectionResult.match?.databaseQuestionText || '',
        generalMarkingGuidance: item.detectionResult.match?.markingScheme?.generalMarkingGuidance,
        sourceImageIndex: groupSourceImageIndex,
        isGeneric: (paperCode === 'Generic Question')
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
