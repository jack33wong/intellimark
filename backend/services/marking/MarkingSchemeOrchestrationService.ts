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

        if (q.studentWork) {
          effectiveText = `${effectiveText}\n\n${q.studentWork}`;
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
      const uniqueFragments = new Set<string>();
      group.forEach(q => { if (q.text) uniqueFragments.add(q.text.trim()); });

      const sortedFragments = Array.from(uniqueFragments).sort((a, b) => b.length - a.length);
      let combinedAnchor = sortedFragments[0] || '';
      for (let i = 1; i < sortedFragments.length; i++) {
        const frag = sortedFragments[i];
        if (frag.length < 5) continue;
        const tailLength = Math.min(frag.length, 40);
        const tail = frag.substring(frag.length - tailLength);
        if (!combinedAnchor.toLowerCase().includes(tail.toLowerCase().trim())) {
          combinedAnchor += `\n\n${frag}`;
        }
      }

      const groupDetectionResult = await questionDetectionService.detectQuestion(
        combinedAnchor,
        baseNum,
        examPaperHint
      );

      for (const question of group) {
        const effectiveResult = { ...groupDetectionResult };

        // --- CLEANUP: Extract Clean Marking Scheme Array ---
        // If we have a composite object (raw DB dump), parse it now to save only relevant data.
        if (effectiveResult.found && effectiveResult.match?.markingScheme?.questionMarks?.isComposite) {
          const qNum = question.questionNumber; // e.g. "5a"
          const composite = effectiveResult.match.markingScheme.questionMarks;

          if (qNum && composite.subQuestionMarks && composite.subQuestionMarks[qNum]) {
            // found specific marks! Overwrite with simple array.
            // This ensures DB stores [{ mark: 'B1', ... }] instead of the huge object.
            effectiveResult.match.markingScheme.questionMarks = composite.subQuestionMarks[qNum].marks || [];
          } else {
            // Fallback: If specific marks are missing, default to empty to avoid saving "messy" data.
            effectiveResult.match.markingScheme.questionMarks = [];
          }
        }
        // ---------------------------------------------------

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
      if (count / totalVotes >= 0.8 && (count > 1 || paperCounts.size === 1)) {
        dominantPaper = title;
        break;
      }
    }

    if (dominantPaper && (paperCounts.size > 1 || detectionStats.notDetected > 0)) {
      const dominantMatchBase = paperToMatch.get(dominantPaper);
      const processedGroups = new Set<string>();

      for (const dr of detectionResults) {
        const baseNum = getBaseQuestionNumber(dr.question.questionNumber);
        if ((dr.detectionResult.match?.paperTitle !== dominantPaper || !dr.detectionResult.found) && !processedGroups.has(baseNum)) {
          processedGroups.add(baseNum);
          const forcedHint = `${dominantMatchBase.board} ${dominantMatchBase.paperCode} ${dominantMatchBase.examSeries} ${dominantMatchBase.tier}`;
          const rescuedResult = await questionDetectionService.detectQuestion(dr.question.text, dr.question.questionNumber, forcedHint);
          if (rescuedResult.found && rescuedResult.match?.paperTitle === dominantPaper) {
            detectionResults.filter(d => getBaseQuestionNumber(d.question.questionNumber) === baseNum).forEach(d => d.detectionResult = rescuedResult);
          }
        }
      }
    }

    // --- STEP 5: MERGE & FORMAT OUTPUT (SIMPLIFIED PREFIX-FIRST) ---

    // 0. Pre-processing: Create "Virtual Matches" for Generic Questions
    for (const item of detectionResults) {
      if (!item.detectionResult.match) {
        const qNum = item.question.questionNumber || '1';
        const detectedMarks = this.smartEstimateMaxMarks(item.question.text);
        const sequentialRubric = this.generateSequentialRubric(detectedMarks);
        const subQMarks = { [qNum]: sequentialRubric };

        item.detectionResult.match = {
          board: 'Unknown', qualification: 'General', paperCode: 'Generic Question', examSeries: 'N/A', tier: 'N/A', subject: 'General',
          paperTitle: 'General (No Match)', questionNumber: qNum, confidence: 0, marks: detectedMarks, parentQuestionMarks: detectedMarks, isGeneric: true,
          markingScheme: { questionMarks: { marks: sequentialRubric, subQuestionMarks: subQMarks }, generalMarkingGuidance: GENERIC_EXAMINER_INSTRUCTION }
        };
        item.detectionResult.found = false;
      }
    }

    // 1. Grouping Loop
    const groupedResults = new Map<string, any[]>();
    for (const { question, detectionResult } of detectionResults) {
      const actualQuestionNumber = detectionResult.match.questionNumber;
      const questionNumberForGrouping = question.questionNumber || actualQuestionNumber;
      const baseQuestionNumber = getBaseQuestionNumber(questionNumberForGrouping);
      const board = detectionResult.match.board || 'Unknown';
      const code = detectionResult.match.paperCode || 'Unknown';
      const groupKey = `${baseQuestionNumber}_${board}_${code}`;

      if (!groupedResults.has(groupKey)) groupedResults.set(groupKey, []);
      groupedResults.get(groupKey)!.push({ question, detectionResult, actualQuestionNumber, examBoard: board, paperCode: code });
    }

    // 2. Simplified Merge Logic
    for (const [groupKey, group] of groupedResults.entries()) {
      const baseQuestionNumber = groupKey.split('_')[0];
      const examBoard = group[0].examBoard;
      const paperCode = group[0].paperCode;
      const groupSourceImageIndex = group[0].question.sourceImageIndex ?? 0;
      const masterMatch = group[0].detectionResult.match;
      const parentScheme = masterMatch?.markingScheme?.questionMarks || masterMatch?.markingScheme;
      const uniqueKey = `${baseQuestionNumber}_${examBoard}_${paperCode}`;

      // CASE A: GENERIC QUESTION (Discovery Mode)
      if (paperCode === 'Generic Question') {
        const questionNumbers = group.map(item => item.question.questionNumber || item.actualQuestionNumber);
        const subQMarksMap: any = {};
        questionNumbers.forEach(qNum => { if (qNum) subQMarksMap[qNum] = parentScheme.marks; });

        const rawAns = parentScheme.answer || '';
        const subAns = rawAns.includes('\n') ? rawAns.split('\n') : [rawAns];

        markingSchemesMap.set(uniqueKey, {
          questionMarks: { marks: parentScheme.marks, subQuestionMarks: subQMarksMap },
          totalMarks: masterMatch.marks || 0, parentQuestionMarks: masterMatch.parentQuestionMarks || 0,
          questionNumber: baseQuestionNumber, questionDetection: group[0].detectionResult, databaseQuestionText: masterMatch.databaseQuestionText || '',
          subQuestionNumbers: questionNumbers, subQuestionAnswers: subAns, isGeneric: true,
          generalMarkingGuidance: masterMatch.markingScheme.generalMarkingGuidance, sourceImageIndex: groupSourceImageIndex
        });
        continue;
      }

      // CASE B: PAST PAPER (Prefix-First Strategy)
      const allPaperQuestions = masterMatch.markingScheme?.allQuestions || {};



      const subQuestionMarksMap: any = {};
      const subQuestionNumbers: string[] = [];
      const subQuestionAnswers: string[] = [];
      const subQuestionAnswersMap: Record<string, string> = {};

      const baseNumRegex = new RegExp(`^${baseQuestionNumber}([^0-9]|$)`, 'i');

      // Prepare Final Max Scores Map (Start with existing or empty)
      const finalSubQuestionMaxScores = masterMatch.subQuestionMaxScores ? { ...masterMatch.subQuestionMaxScores } : {};

      Object.keys(allPaperQuestions).forEach(key => {
        if (baseNumRegex.test(key)) {
          const partMarks = allPaperQuestions[key].marks || allPaperQuestions[key];
          subQuestionMarksMap[key] = partMarks;
          subQuestionNumbers.push(key);
          const ans = allPaperQuestions[key].answer;
          if (ans) {
            subQuestionAnswers.push(`(${key}) ${ans}`);
            subQuestionAnswersMap[key] = ans;
          }

          // [FIX] Propagate Max Score to the matched part
          const partLabel = key.replace(/^\d+/, '');
          if (!finalSubQuestionMaxScores[key]) {
            const scoreMatch = masterMatch.subQuestionMaxScores?.[key] ?? masterMatch.subQuestionMaxScores?.[partLabel];
            if (scoreMatch !== undefined) {
              finalSubQuestionMaxScores[key] = scoreMatch;
            } else if (typeof partMarks === 'number') {
              finalSubQuestionMaxScores[key] = partMarks;
            }
          }
          console.log(`   ✅ Matched Part: ${key} (${partMarks.length || 0} marks, Max: ${finalSubQuestionMaxScores[key] || '?'})`);
        }
      });

      if (Object.keys(subQuestionMarksMap).length === 0) {
        console.log(`   ⚠️ No parts matched prefix "${baseQuestionNumber}". Falling back to MasterMatch marks.`);
        subQuestionMarksMap[masterMatch.questionNumber] = parentScheme.marks || parentScheme;
        subQuestionNumbers.push(masterMatch.questionNumber);

        // 🔧 SIMPLE QUESTION FIX: Manually inject the max score for this flat question
        if (masterMatch.marks) {
          finalSubQuestionMaxScores[masterMatch.questionNumber] = masterMatch.marks;
        } else {
          // If somehow missing (e.g. Generic), we permit the naive sum downstream? No, we removed it. 
          // We must define it.
          finalSubQuestionMaxScores[masterMatch.questionNumber] = 0; // Will trigger generic handling or be overwritten
        }
      } else {
        console.log(`   📊 Final Map Keys: ${Object.keys(subQuestionMarksMap).join(', ')}`);
      }

      markingSchemesMap.set(uniqueKey, {
        questionMarks: {
          marks: parentScheme?.marks || parentScheme,
          subQuestionMarks: subQuestionMarksMap,
          subQuestionAnswersMap: subQuestionAnswersMap
        },
        totalMarks: masterMatch.marks || parentScheme.totalMarks || (typeof parentScheme.marks === 'number' ? parentScheme.marks : 0) || 0,
        parentQuestionMarks: masterMatch.parentQuestionMarks || masterMatch.marks || parentScheme.totalMarks || (typeof parentScheme.marks === 'number' ? parentScheme.marks : 0) || 0,
        questionNumber: baseQuestionNumber, questionDetection: group[0].detectionResult, databaseQuestionText: masterMatch.databaseQuestionText || '',
        subQuestionNumbers: subQuestionNumbers.sort(), subQuestionAnswers: subQuestionAnswers,
        subQuestionMaxScores: finalSubQuestionMaxScores, subQuestionTexts: masterMatch.subQuestionTexts,
        isGeneric: false, generalMarkingGuidance: masterMatch.markingScheme.generalMarkingGuidance, sourceImageIndex: groupSourceImageIndex
      });
    }

    // Update classification result
    for (const { question, detectionResult } of detectionResults) {
      if (detectionResult.found && detectionResult.match?.questionNumber) {
        const matchingQuestion = classificationResult.questions.find((q: any) =>
          q === question || (q.text && question.text && q.text.includes(question.text.substring(0, 20)))
        );
        if (matchingQuestion && !matchingQuestion.questionNumber) {
          matchingQuestion.questionNumber = detectionResult.match.questionNumber;
        }
      }
    }

    return { markingSchemesMap, detectionStats, updatedClassificationResult: classificationResult, detectionResults };
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
