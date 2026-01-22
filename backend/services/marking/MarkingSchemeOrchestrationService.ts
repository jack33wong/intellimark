/**
 * Marking Scheme Orchestration Service
 * Handles question detection, grouping, and marking scheme lookup/merging
 * * * CRITICAL FIX: ENSURE CONTEXT PROPAGATION
 * 1. Guarantees that if the Group Anchor Text matches, all sub-questions inherit that match.
 * 2. Prevents "Weak Match" errors on short sub-questions (e.g. "Complete diagram").
 * 3. Keeps "Sequential Rubric" and "Dynamic Totals".
 */

import { logDetectionAudit } from './MarkingHelpers.js';
import { questionDetectionService } from './questionDetectionService.js';
import { getBaseQuestionNumber, normalizeSubQuestionPart } from '../../utils/TextNormalizationUtils.js';

// --- CONFIGURATION ---
const GENERIC_EXAMINER_INSTRUCTION = `
⚠️ NO OFFICIAL MARKING SCHEME AVAILABLE (GENERIC MODE).
1. You are the CHIEF EXAMINER. Determine the marking criteria based on the question text.
2. GRADING STRATEGY:
   - Use M1, M2, M3... for sequential Method steps (correct approach).
   - Use A1, A2, A3... for sequential Accuracy steps (correct values).
   - Use B1, B2, B3... for Independent statements/reasons.
   - Use M0/A0/B0 ONLY to explicitly flag incorrect steps.
3. SCORING LIMITS:
   - If a specific max mark is detected (e.g. [3]), try to align with it.
   - HOWEVER, if the student shows valid work exceeding that limit, AWARD THE MARKS.
   - Do not cap the score artificially. Prioritize correct mathematics.
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
    question: { text: string; questionNumber?: string | null; sourceImageIndex?: number; parentText?: string; studentWork?: string };
    detectionResult: any;
  }>;
}

export class MarkingSchemeOrchestrationService {

  // [HELPER] Smart Estimate from Text
  private static smartEstimateMaxMarks(text: string): number {
    if (!text) return 0;
    const patterns = [
      /\(\s*Total\s*for\s*Question\s*\d+\s*is\s*(\d+)\s*marks?\s*\)/i,
      /\(\s*Total\s*(\d+)\s*marks?\s*\)/i,
      /\[\s*(\d+)\s*marks?\s*\]/i,
      /Total\s*:?\s*(\d+)\s*marks?/i,
      /\(\s*(\d+)\s*marks?\s*\)/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const marks = parseInt(match[1], 10);
        if (!isNaN(marks) && marks > 0 && marks <= 50) return marks;
      }
    }
    return 0;
  }

  // [HELPER] Generate Sequential Rubric
  private static generateSequentialRubric(detectedMax: number): any[] {
    const rubric = [];
    const count = detectedMax > 0 ? detectedMax + 3 : 10;

    for (let i = 1; i <= count; i++) {
      rubric.push({
        mark: `M${i}`, value: 1,
        guidance: 'Method: Correct approach, substitution, or rearrangement.',
        comments: 'Method mark', notes: 'Method', details: 'Method'
      });
    }
    for (let i = 1; i <= count; i++) {
      rubric.push({
        mark: `A${i}`, value: 1,
        guidance: 'Accuracy: Correct final answer or intermediate precision.',
        comments: 'Accuracy mark', notes: 'Accuracy', details: 'Accuracy'
      });
    }
    for (let i = 1; i <= count; i++) {
      rubric.push({
        mark: `B${i}`, value: 1,
        guidance: 'Independent: Correct statement, definition, or property.',
        comments: 'Independent mark', notes: 'Independent', details: 'Independent'
      });
    }

    rubric.push({ mark: 'M0', value: 0, guidance: 'Method: Incorrect approach.', comments: 'Method lost' });
    rubric.push({ mark: 'A0', value: 0, guidance: 'Accuracy: Incorrect value.', comments: 'Accuracy lost' });
    rubric.push({ mark: 'B0', value: 0, guidance: 'Independent: Invalid statement.', comments: 'Mark lost' });

    return rubric;
  }

  static async orchestrateMarkingSchemeLookup(
    individualQuestions: Array<{ text: string; questionNumber?: string | null; sourceImageIndex?: number; parentText?: string; studentWork?: string }>,
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

    // --- STEP 0: BUILD CLEAN TEXT MAP & PARENT MAP ---
    const cleanQuestionsMap = new Map<string, string>();
    const parentTextMap = new Map<string, string>();

    // Use either pages structure (original classification) or flat questions (merged result)
    const questionsToProcess: any[] = [];
    if (classificationResult && classificationResult.pages) {
      classificationResult.pages.forEach((p: any) => {
        if (p.questions) questionsToProcess.push(...p.questions);
      });
    } else if (classificationResult && classificationResult.questions) {
      questionsToProcess.push(...classificationResult.questions);
    }

    questionsToProcess.forEach((q: any) => {
      const qNum = q.questionNumber;
      if (qNum && q.text) {
        cleanQuestionsMap.set(qNum, q.text);
        const baseNum = getBaseQuestionNumber(qNum);
        if (!parentTextMap.has(baseNum)) {
          parentTextMap.set(baseNum, q.text);
        }
      }
      // Deeply check sub-questions for the map
      const processSubQs = (subs: any[]) => {
        subs.forEach((sq: any) => {
          const subPart = sq.part || sq.label || '';
          if (subPart) {
            const fullKey = qNum ? `${qNum}${subPart}`.toLowerCase() : subPart.toLowerCase();
            if (sq.text) cleanQuestionsMap.set(fullKey, sq.text);
          }
          if (sq.subQuestions) processSubQs(sq.subQuestions);
        });
      };
      if (q.subQuestions) processSubQs(q.subQuestions);
    });


    // --- STEP 1: PREPARE QUESTIONS (CONTEXT INJECTION) ---
    const questionGroups = new Map<string, typeof individualQuestions>();

    for (const q of individualQuestions) {
      const baseNum = getBaseQuestionNumber(q.questionNumber) || 'General';

      if (q.questionNumber) {
        // A. SMART SWAP
        const cleanText = cleanQuestionsMap.get(q.questionNumber) ||
          cleanQuestionsMap.get(q.questionNumber.toLowerCase());

        let effectiveText = (cleanText && cleanText.length > 5) ? cleanText : q.text;

        // console.log(`[DETECTION DEBUG] Q${q.questionNumber} - Initial Text: "${effectiveText.substring(0, 50)}..."`);

        if (q.studentWork) {
          effectiveText = `${effectiveText}\n\n${q.studentWork}`;
          //  console.log(`[DETECTION DEBUG] Q${q.questionNumber} - Added Student Work: "${q.studentWork.substring(0, 30)}..."`);
        }

        // B. CONTEXT INJECTION (Avoid repeating if parent text is already in the questio text)
        if (isSubQuestion(q.questionNumber)) {
          const parentContext = parentTextMap.get(baseNum);
          if (parentContext && parentContext.trim() !== effectiveText.trim()) {
            // Only inject if it's not already there
            if (!effectiveText.toLowerCase().includes(parentContext.toLowerCase().substring(0, 30))) {
              effectiveText = `${parentContext}\n\n${effectiveText}`;
            }
          }
        }

        // IMPORTANT: Update the question object itself so subsequent logs use this rich text
        q.text = effectiveText;
        // console.log(`[DETECTION DEBUG] Q${q.questionNumber} - Final Contextual Text: "${effectiveText.substring(0, 80)}..."`);
      }

      if (!questionGroups.has(baseNum)) questionGroups.set(baseNum, []);
      questionGroups.get(baseNum)!.push(q);
    }

    // --- STEP 2: DETECT PER GROUP ---
    const detectionResults: Array<{
      question: { text: string; questionNumber?: string | null; sourceImageIndex?: number; parentText?: string; studentWork?: string };
      detectionResult: any;
    }> = [];

    const detectionStats: DetectionStatistics = {
      totalQuestions: individualQuestions.length,
      detected: 0, notDetected: 0, withMarkingScheme: 0, withoutMarkingScheme: 0,
      bySimilarityRange: { high: 0, medium: 0, low: 0 },
      questionDetails: [], hintInfo: undefined
    };

    for (const [baseNum, group] of questionGroups.entries()) {
      // IMPROVED GROUP ANCHOR: Combine all unique question text fragments into one dense query
      // This ensures keywords from Q10a, Q10b, Q10bi are all available to match against the DB record
      const uniqueFragments = new Set<string>();
      group.forEach(q => {
        if (q.text) {
          // Add the question text
          uniqueFragments.add(q.text.trim());
        }
      });

      // Build a dense anchor that captures all context without excessive repetition
      // We sort fragments by length to put the most descriptive ones first
      const sortedFragments = Array.from(uniqueFragments).sort((a, b) => b.length - a.length);

      // we want to avoid repeating the intro ("100 people...") while ensuring 
      // the unique part ("Complete the Venn diagram") is preserved.
      let combinedAnchor = sortedFragments[0] || '';
      for (let i = 1; i < sortedFragments.length; i++) {
        const frag = sortedFragments[i];
        if (frag.length < 5) continue;

        // Smarter overlap check: If the fragment is largely NOT already in the combined text, add it.
        // We check if the last 50% of the fragment is present.
        const tailLength = Math.min(frag.length, 40);
        const tail = frag.substring(frag.length - tailLength);

        if (!combinedAnchor.toLowerCase().includes(tail.toLowerCase().trim())) {
          combinedAnchor += `\n\n${frag}`;
        }
      }

      // console.log(`[DETECTION DEBUG] Group ${baseNum} Combined Anchor: "${combinedAnchor.substring(0, 150)}..."`);

      const groupDetectionResult = await questionDetectionService.detectQuestion(
        combinedAnchor,
        baseNum,
        examPaperHint
      );

      for (const question of group) {
        // [FIX] Ensure the result reflects the GROUP match, not individual failures
        // If the group matched (confidence > 0), assume sub-questions are part of it
        const effectiveResult = { ...groupDetectionResult };

        // If group matched but individual score is low (which shouldn't happen with context),
        // we force it to trust the group match.
        if (effectiveResult.found && effectiveResult.match) {
          effectiveResult.message = `Matched via Group ${baseNum}`;
        }

        detectionResults.push({ question, detectionResult: effectiveResult });

        const similarity = effectiveResult.match?.confidence || 0;
        const hasScheme = !!effectiveResult.match?.markingScheme;

        if (effectiveResult.found) {
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
          detected: effectiveResult.found,
          similarity,
          hasMarkingScheme: hasScheme,
          matchedPaperTitle: effectiveResult.match?.paperTitle
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
      // FIX V41: Only enforce consensus if we have meaningful agreement (>1 question)
      // or if this single paper accounts for the majority of specific questions on the page
      if (count / totalVotes >= 0.8 && (count > 1 || paperCounts.size === 1)) {
        dominantPaper = title;
        break;
      }
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

    // --- STEP 5: MERGE & FORMAT OUTPUT (SEQUENTIAL & DYNAMIC) ---

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
        const detectedMarks = this.smartEstimateMaxMarks(item.question.text);
        const sequentialRubric = this.generateSequentialRubric(detectedMarks);
        const subQMarks = { [qNum]: sequentialRubric };

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
          marks: detectedMarks,
          parentQuestionMarks: detectedMarks,
          isGeneric: true, // NEW: Explicitly flag as generic
          markingScheme: {
            questionMarks: {
              marks: sequentialRubric,
              subQuestionMarks: subQMarks
            },
            generalMarkingGuidance: GENERIC_EXAMINER_INSTRUCTION
          }
        };
        // [FIX] Setting found to false ensures this is treated as a non-past paper 
        // in session titles and metadata, while still allowing the generic marking scheme to be used.
        item.detectionResult.found = false;
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
          totalMarks: masterMatch.marks || 0, // [FIX] 0 allows dynamic total
          parentQuestionMarks: masterMatch.parentQuestionMarks || 0,
          questionNumber: baseQuestionNumber,
          questionDetection: group[0].detectionResult,
          databaseQuestionText: masterMatch.databaseQuestionText || '',
          subQuestionNumbers: questionNumbers,
          subQuestionAnswers: subAns,
          subQuestionMaxScores: masterMatch.subQuestionMaxScores,
          subQuestionTexts: masterMatch.subQuestionTexts,
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
            subQuestionMaxScores: masterMatch.subQuestionMaxScores,
            subQuestionTexts: masterMatch.subQuestionTexts,
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
        totalMarks: item.detectionResult.match.marks || 0,
        parentQuestionMarks: item.detectionResult.match.marks || 0,
        questionNumber: item.actualQuestionNumber,
        questionDetection: item.detectionResult,
        questionText: item.question.text,
        databaseQuestionText: item.detectionResult.match?.databaseQuestionText || '',
        subQuestionMaxScores: item.detectionResult.match?.subQuestionMaxScores,
        subQuestionTexts: item.detectionResult.match?.subQuestionTexts,
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
