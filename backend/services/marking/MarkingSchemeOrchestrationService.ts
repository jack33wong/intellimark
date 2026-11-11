/**
 * Marking Scheme Orchestration Service
 * Handles question detection, grouping, and marking scheme lookup/merging
 * * * CRITICAL FIX: ENSURE CONTEXT PROPAGATION
 * 1. Guarantees that if the Group Anchor Text matches, all sub-questions inherit that match.
 * 2. Prevents "Weak Match" errors on short sub-questions (e.g. "Complete diagram").
 * 3. Keeps "Sequential Rubric" and "Dynamic Totals".
 */

import { logDetectionAudit, getQuestionSortValue } from './MarkingHelpers.js';
import { questionDetectionService } from './questionDetectionService.js';
import { getBaseQuestionNumber, normalizeSubQuestionPart, combineQuestionAndPart } from '../../utils/TextNormalizationUtils.js';

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

  // [HELPER] Smart Estimate from Text (Supports Edexcel "(3 marks)", AQA "[3 marks]", and WJEC/OCR "[3]" / "[ 3 ]")
  private static smartEstimateMaxMarks(text: string): number {
    if (!text) return 0;
    const patterns = [
      /\(\s*Total\s*for\s*Question\s*\d+\s*is\s*(\d+)\s*marks?\s*\)/i,
      /\(\s*Total\s*(\d+)\s*marks?\s*\)/i,
      /\[\s*(\d+)\s*marks?\s*\]/i,
      /Total\s*:?\s*(\d+)\s*marks?/i,
      /\(\s*(\d+)\s*marks?\s*\)/i,
      /\[\s*(\d{1,2})\s*\]\s*$/m // Matches trailing [3] or [ 2 ] on WJEC/OCR/CIE questions
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
    examPaperHint?: string | null,
    inputMarkingScheme?: any,
    guardContaminatedStems?: boolean
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

    // Helper to detect if a candidate question.text actually duplicates that page's studentWorkLines
    const isContaminatedStem = (q: any): boolean => {
      if (!q || !q.text) return false;
      const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const stem = norm(q.text);
      if (stem.length < 15) return false;
      const work = norm((q.studentWorkLines || []).map((l: any) => l?.t || '').join(' ') || q.studentWork || '');
      return work.length > 0 && work.includes(stem.slice(0, 40));
    };

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
      const qNum = q.questionNumber ? String(q.questionNumber).trim().replace(/^0+(?=\d)/, '') : '';
      if (qNum && q.text) {
        if (!guardContaminatedStems || !isContaminatedStem(q)) {
          // Keep the first non-empty question stem in page order instead of overwriting with later continuation pages
          if (!cleanQuestionsMap.has(qNum)) {
            cleanQuestionsMap.set(qNum, q.text);
          }
          const baseNum = getBaseQuestionNumber(qNum);
          if (!parentTextMap.has(baseNum)) {
            parentTextMap.set(baseNum, q.text);
          }
        }
      }
      // Deeply check sub-questions for the map
      const processSubQs = (subs: any[]) => {
        subs.forEach((sq: any) => {
          const subPart = sq.part || sq.label || '';
          if (subPart) {
            // Use safe combiner so AQA decimal parts map correctly ("1" + ".1"/"1" -> "1.1", not "11"/"1")
            const fullKey = qNum ? combineQuestionAndPart(String(qNum), String(subPart)).toLowerCase() : String(subPart).toLowerCase();
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

        /* [UPSTREAM-FIX]: Concatenating student work here is redundant and harmful to detection.
           Student work is already passed to the AI in the classificationStudentWork section.
        if (q.studentWork) {
          effectiveText = `${effectiveText}\n\n${q.studentWork}`;
        }
        */

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

    const groupCombinedAnchors = new Map<string, string>();

    const cloneAndExtractSubQuestionMatch = (
      question: { questionNumber?: string | null },
      sourceResult: any,
      baseNum: string,
      isRescued: boolean = false
    ) => {
      const effectiveResult = { ...sourceResult };

      // [V28 FIX] DEEP CLONE MATCH to avoid shared state poisoning across sub-questions
      if (effectiveResult.match) {
        effectiveResult.match = { ...effectiveResult.match };
        if (isRescued) {
          effectiveResult.match.isRescued = true;
        }
        if (effectiveResult.match.markingScheme) {
          effectiveResult.match.markingScheme = { ...effectiveResult.match.markingScheme };
        }
      }

      // --- CLEANUP: Extract Clean Marking Scheme Array ---
      // If we have a composite object (raw DB dump), parse it now to save only relevant data.
      if (effectiveResult.found && effectiveResult.match?.markingScheme?.questionMarks?.isComposite) {
        const qNum = question.questionNumber || effectiveResult.match.questionNumber; // e.g. "5a"
        const composite = effectiveResult.match.markingScheme.questionMarks;

        if (qNum && composite.subQuestionMarks && composite.subQuestionMarks[qNum]) {
          // Found specific marks! Overwrite with simple array.
          const partData = composite.subQuestionMarks[qNum];
          effectiveResult.match.markingScheme.questionMarks = partData.marks || partData || [];
        } else {
          // Fallback: If specific marks are missing, default to empty to avoid saving "messy" data.
          effectiveResult.match.markingScheme.questionMarks = [];
        }
      }

      if (effectiveResult.found && effectiveResult.match) {
        effectiveResult.message = isRescued
          ? `Rescued via Group ${baseNum}`
          : `Matched via Group ${baseNum}`;
      }

      return effectiveResult;
    };

    for (const [baseNum, group] of questionGroups.entries()) {
      // IMPROVED GROUP ANCHOR: Combine all unique question text fragments into one dense query
      const uniqueFragments = new Set<string>();
      group.forEach(q => { if (q.text) uniqueFragments.add(q.text.trim()); });

      const fragments = Array.from(uniqueFragments);
      // Filter out redundant fragments that are already contained within other (larger) fragments
      // to keep the prompt clean while preserving the natural document order.
      const condensedFragments = fragments.filter((f, idx) => {
        if (f.length < 5) return false;
        return !fragments.some((other, otherIdx) =>
          idx !== otherIdx &&
          other.length >= f.length && // If lengths are equal and one includes another, they are identical or very similar
          other.toLowerCase().includes(f.toLowerCase())
        );
      });

      const combinedAnchor = condensedFragments.join('\n\n');
      groupCombinedAnchors.set(baseNum, combinedAnchor);

      // 👇 THE CLEAN INTERCEPTION SWITCH 👇
      let groupDetectionResult;

      // Build deterministic subQuestionTexts map for this baseNum group from extracted cleanQuestionsMap / group
      const extractedSubQuestionTexts: Record<string, string> = {};
      group.forEach(qItem => {
        const rawQNum = String(qItem.questionNumber || '').trim().replace(/^0+(?=\d)/, '');
        if (rawQNum && rawQNum !== baseNum && qItem.text) {
          const relativePart = rawQNum.startsWith(baseNum) ? rawQNum.slice(baseNum.length).replace(/^\./, '') : rawQNum;
          if (relativePart && !extractedSubQuestionTexts[relativePart]) {
            extractedSubQuestionTexts[relativePart] = qItem.text.trim();
          }
        }
      });

      if (inputMarkingScheme && inputMarkingScheme.questions) {
        // Dynamically reconcile the parent question total mark pool 
        // by summing up the parts that belong to the current baseNum group (e.g. 1a + 1b)
        let parentTotalMarks = 0;
        const subScores = inputMarkingScheme.subQuestionMaxScores || {};
        for (const [key, val] of Object.entries(subScores)) {
          const keyBase = getBaseQuestionNumber(key) || key.match(/^0*(\d+)/)?.[1] || key.replace(/\D/g, '');
          if (keyBase === baseNum) {
            parentTotalMarks += Number(val);
          }
        }

        groupDetectionResult = {
          found: true,
          match: {
            board: inputMarkingScheme.examDetails?.board || 'Custom',
            qualification: inputMarkingScheme.examDetails?.qualification || 'GCSE',
            paperCode: inputMarkingScheme.examDetails?.paperCode || 'Uploaded',
            examSeries: inputMarkingScheme.examDetails?.exam_series || 'N/A',
            tier: inputMarkingScheme.examDetails?.tier || 'N/A',
            subject: inputMarkingScheme.examDetails?.subject || 'Biology',
            paperTitle: 'Custom Uploaded Marking Scheme',
            questionNumber: baseNum,
            confidence: 1.0,
            marks: parentTotalMarks,
            subQuestionMaxScores: subScores, // Directly feeds the budget map downstream
            subQuestionTexts: Object.keys(extractedSubQuestionTexts).length > 0 ? extractedSubQuestionTexts : undefined,
            markingScheme: {
              allQuestions: inputMarkingScheme.questions, // Matches Database Payload mapping
              generalMarkingGuidance: inputMarkingScheme.generalMarkingGuidance || ""
            }
          }
        };
      } else {
        // Normal Database Path
        if (combinedAnchor.includes('MANUAL_REVIEW_REQUIRED_JSON_ERROR')) {
          // If the AI parsing completely failed, do NOT attempt to find a marking scheme
          // because searching the error message will lead to random/false positive matches.
          groupDetectionResult = { found: false };
        } else {
          groupDetectionResult = await questionDetectionService.detectQuestion(
            combinedAnchor,
            baseNum,
            examPaperHint
          );
        }
      }
      // 👆 END OF INTERCEPTION SWITCH 👆

      // 🔍 [DEBUG] Question Detection Result for the group
      if (process.env.LOG_QUESTION_DETECTION === 'true') {
        console.log(`\n🔍 [QUESTION DETECTION] Group Q${baseNum}:`);
        console.log(`   Found: ${groupDetectionResult.found}`);
        if (groupDetectionResult.match) {
          console.log(`   Paper: ${groupDetectionResult.match.paperCode} (${groupDetectionResult.match.paperTitle})`);
          console.log(`   Confidence: ${groupDetectionResult.match.confidence?.toFixed(3) || 'N/A'}`);
          console.log(`   Marks: ${groupDetectionResult.match.marks}`);
          console.log(`   Is Generic: ${groupDetectionResult.match.isGeneric || false}`);
        } else {
          console.log(`   Match: NULL - Will trigger Generic Mode`);
        }
        if (groupDetectionResult.hintMetadata?.auditTrail) {
          console.log(`   Top Candidates:`);
          groupDetectionResult.hintMetadata.auditTrail.slice(0, 3).forEach((c: any) => {
            console.log(`     ${c.rank}. ${c.candidateId}: ${c.score} (${c.scoreBreakdown})`);
          });
        }
      }

      for (const question of group) {
        const effectiveResult = cloneAndExtractSubQuestionMatch(question, groupDetectionResult, baseNum, false);

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

    // --- STEP 2.5: 1-TO-1 TARGET DE-DUPLICATION (The Unique Lock) ---
    // Lock by parent question group (baseNum) so sub-questions (e.g. 10, 10a, 10bi, 10bii)
    // share the lock for Q10 while still blocking different parent questions from claiming the same DB question.
    const targetClaims = new Map<string, { groupKey: string, score: number }>();
    
    // First pass: Find the highest scoring uploaded parent question group for each specific DB question
    for (const dr of detectionResults) {
      if (dr.detectionResult.found && dr.detectionResult.match) {
        const match = dr.detectionResult.match;
        const targetId = `${match.paperTitle || match.paperCode}_${match.questionNumber}`;
        const groupKey = getBaseQuestionNumber(dr.question.questionNumber) || String(dr.question.questionNumber);
        const currentBest = targetClaims.get(targetId);
        
        if (!currentBest || match.confidence > currentBest.score) {
          targetClaims.set(targetId, { 
            groupKey, 
            score: match.confidence 
          });
        }
      }
    }
    
    // Second pass: Invalidate "losers" from OTHER parent question groups who tried to claim an already-locked DB question
    for (const dr of detectionResults) {
      if (dr.detectionResult.found && dr.detectionResult.match) {
        const match = dr.detectionResult.match;
        const targetId = `${match.paperTitle || match.paperCode}_${match.questionNumber}`;
        const groupKey = getBaseQuestionNumber(dr.question.questionNumber) || String(dr.question.questionNumber);
        const bestClaim = targetClaims.get(targetId);
        
        if (bestClaim && bestClaim.groupKey !== groupKey) {
           if (process.env.LOG_QUESTION_DETECTION === 'true') {
             console.log(`   🔒 [1-TO-1 LOCK] Q${dr.question.questionNumber} (Group ${groupKey}) lost claim to ${targetId} (Beaten by Group Q${bestClaim.groupKey})`);
           }
           dr.detectionResult.found = false;
           dr.detectionResult.match = null;
           dr.detectionResult.message = "Lost 1-to-1 target lock collision";
        }
      }
    }

    // Re-calculate detection stats after the cull
    detectionStats.detected = detectionResults.filter(r => r.detectionResult.found).length;
    detectionStats.notDetected = detectionStats.totalQuestions - detectionStats.detected;
    detectionStats.questionDetails = detectionResults.map(r => ({
      questionNumber: r.question.questionNumber,
      detected: r.detectionResult.found,
      similarity: r.detectionResult.match?.confidence || 0,
      matchedPaperTitle: r.detectionResult.match?.paperTitle,
      hasMarkingScheme: !!r.detectionResult.match?.markingScheme
    }));

    // --- STEP 3 & 4: CONSENSUS RULE (Dynamic Proportional Gate) + HINT RECOVERY ---
    // Count DISTINCT unique parent DB questions matched per paper, and compare against
    // the number of uploaded parent question groups (questionGroups.size) so sub-questions
    // (e.g. 10a, 10bi, 10bii) neither penalize single-question uploads nor inflate vote counts.
    const paperUniqueQuestions = new Map<string, Set<string>>();
    const paperMaxConfidence = new Map<string, number>();
    const paperToMatch = new Map<string, any>();
    
    detectionResults.forEach(dr => {
      if (dr.detectionResult.found && dr.detectionResult.match?.paperTitle) {
        const title = dr.detectionResult.match.paperTitle;
        if (!paperUniqueQuestions.has(title)) paperUniqueQuestions.set(title, new Set());
        // Track the DB question number to ensure they are distinct parts of the paper
        paperUniqueQuestions.get(title)!.add(dr.detectionResult.match.questionNumber);
        const conf = dr.detectionResult.match.confidence || 0;
        if (conf > (paperMaxConfidence.get(title) || 0)) {
          paperMaxConfidence.set(title, conf);
        }
        if (!paperToMatch.has(title)) paperToMatch.set(title, dr.detectionResult.match);
      }
    });

    const paperCounts = paperUniqueQuestions;

    let dominantPaper: string | null = null;
    const totalParentQuestionsUploaded = questionGroups.size;
    const totalDistinctVotes = Array.from(paperUniqueQuestions.values()).reduce((sum, set) => sum + set.size, 0);

    if (process.env.LOG_QUESTION_DETECTION === 'true') {
      console.log(`\n🗳️ [CONSENSUS CHECK - DYNAMIC GATE] Total Uploaded Parent Questions: ${totalParentQuestionsUploaded} (Sub-items: ${detectionStats.totalQuestions})`);
    }

    for (const [title, uniqueQs] of paperUniqueQuestions.entries()) {
      const distinctCount = uniqueQs.size;
      const maxConf = paperMaxConfidence.get(title) || 0;
      let meetsDynamicGate = false;

      // The Dynamic Threshold Logic (measured in parent questions, with strict confidence guard for single matches)
      if (totalParentQuestionsUploaded <= 2) {
        // For 1-2 question uploads, a single matched question must also have high confidence (>= 0.75) to prevent false positives
        meetsDynamicGate = (distinctCount >= 2) || (distinctCount === 1 && maxConf >= 0.75);
      } else if (totalParentQuestionsUploaded <= 10) {
        meetsDynamicGate = distinctCount >= 2;
      } else {
        const ratio = distinctCount / totalParentQuestionsUploaded;
        meetsDynamicGate = (ratio >= 0.20) || (distinctCount >= 3);
      }

      // Check percentage of distinct parent question votes against competing papers
      const percentage = totalDistinctVotes > 0 ? (distinctCount / totalDistinctVotes) : 0;
      const meetsThreshold = percentage >= 0.8;

      if (process.env.LOG_QUESTION_DETECTION === 'true') {
        console.log(`   🔍 Checking "${title}":`);
        console.log(`      Distinct DB Questions Matched: ${distinctCount} (Max Conf: ${maxConf.toFixed(3)})`);
        console.log(`      Passes Dynamic Gate: ${meetsDynamicGate}`);
        console.log(`      Vote Dominance: ${(percentage * 100).toFixed(1)}% (need >= 80%)`);
      }

      if (meetsDynamicGate && meetsThreshold) {
        dominantPaper = title;
        if (process.env.LOG_QUESTION_DETECTION === 'true') {
          console.log(`   ✅ DOMINANT PAPER SET: "${dominantPaper}"`);
        }
        break;
      }
    }

    // --- STEP 3 RECOVERY FALLBACK (Only if examPaperHint was a weak footer guess, NOT an explicit full paper title) ---
    const isExplicitFullPaperSelection = Boolean(
      examPaperHint &&
      /\b(20\d{2}|june|november|may|january|summer|autumn|winter)\b/i.test(examPaperHint) &&
      /\b([0-9A-Z]{4,6}\/[0-9A-Z]{1,3}|8700|8300|1MA1|J560|J351|1EN0|9MA0|7357)\b/i.test(examPaperHint)
    );

    const hintInfo = detectionStats.hintInfo;
    if (hintInfo && Boolean(examPaperHint) && !isExplicitFullPaperSelection) {
      const matchedPapersCount = hintInfo.matchedPapersCount || 0;
      const detectedCount = detectionStats.detected;
      const totalCount = detectionStats.totalQuestions;
      const detectionRate = totalCount > 0 ? detectedCount / totalCount : 0;

      const shouldRestartGlobalSearch =
        !dominantPaper ||
        (matchedPapersCount === 1 && detectionRate < 0.8) ||
        (matchedPapersCount > 1 && detectionRate < 0.5);

      if (shouldRestartGlobalSearch) {
        if (process.env.LOG_QUESTION_DETECTION === 'true') {
          console.log(`   🔄 [HINT FALLBACK] Hint "${examPaperHint}" did not yield strong consensus (dominantPaper=${dominantPaper || 'NONE'}, detectionRate=${(detectionRate * 100).toFixed(1)}%). Restarting in Global Search...`);
        }
        return this.orchestrateMarkingSchemeLookup(individualQuestions, classificationResult, null, inputMarkingScheme);
      }
    }

    if (process.env.LOG_QUESTION_DETECTION === 'true') {
      console.log(`\n🚑 [RESCUE MODE CHECK]:`);
      console.log(`   Dominant paper: ${dominantPaper || 'NONE'}`);
      console.log(`   Multiple papers detected: ${paperCounts.size > 1}`);
      console.log(`   Failed detections: ${detectionStats.notDetected}`);
      console.log(`   Will trigger rescue: ${!!(dominantPaper && (paperCounts.size > 1 || detectionStats.notDetected > 0))}`);
    }

    if (dominantPaper && (paperCounts.size > 1 || detectionStats.notDetected > 0)) {
      const dominantMatchBase = paperToMatch.get(dominantPaper);
      const processedGroups = new Set<string>();

      if (process.env.LOG_QUESTION_DETECTION === 'true') {
        console.log(`\n🚑 [RESCUE MODE ACTIVATED] Attempting to rescue failed questions...`);
        console.log(`   Using forced hint from: ${dominantPaper}`);
      }

      for (const dr of detectionResults) {
        const baseNum = getBaseQuestionNumber(dr.question.questionNumber);
        const needsRescue = (dr.detectionResult.match?.paperTitle !== dominantPaper || !dr.detectionResult.found);
        const notProcessed = !processedGroups.has(baseNum);

        if (needsRescue && notProcessed) {
          const forcedHint = `${dominantMatchBase.board} ${dominantMatchBase.paperCode} ${dominantMatchBase.examSeries} ${dominantMatchBase.tier}`;
          const rescueAnchorText = groupCombinedAnchors.get(baseNum) || dr.question.text;

          if (process.env.LOG_QUESTION_DETECTION === 'true') {
            console.log(`\n   🔄 Attempting rescue for Q${dr.question.questionNumber} (Group ${baseNum}):`);
            console.log(`      Forced hint: "${forcedHint}"`);
          }

          const rescuedResult = await questionDetectionService.detectQuestion(rescueAnchorText, baseNum || dr.question.questionNumber, forcedHint);

          if (process.env.LOG_QUESTION_DETECTION === 'true') {
            console.log(`      Rescue result: ${rescuedResult.found ? '✅ SUCCESS' : '❌ STILL FAILED'}`);
            if (rescuedResult.found) {
              console.log(`      Rescued paper: ${rescuedResult.match?.paperTitle}`);
            }
          }

          // [UPSTREAM-FIX]: Only mark as processed IF the rescue actually found a match for the dominant paper!
          // This allows the loop to try the NEXT sub-question in the group if this one failed.
          if (rescuedResult.found && rescuedResult.match?.paperTitle === dominantPaper) {
            processedGroups.add(baseNum);
            detectionResults.filter(d => getBaseQuestionNumber(d.question.questionNumber) === baseNum)
              .forEach(d => {
                d.detectionResult = cloneAndExtractSubQuestionMatch(d.question, rescuedResult, baseNum, true);
                if (detectionStats.hintInfo?.rescuedQuestions && d.question.questionNumber) {
                  detectionStats.hintInfo.rescuedQuestions.push(String(d.question.questionNumber));
                }
              });

            if (process.env.LOG_QUESTION_DETECTION === 'true') {
              console.log(`      ✅ Applied rescue to all Q${baseNum} variants`);
            }
          }
        }
      }

      // 🔍 [RE-AUDIT]: Update detection stats after rescue pass to ensure logs/reporting are accurate
      const finalDetected = detectionResults.filter(r => r.detectionResult.found).length;
      detectionStats.detected = finalDetected;
      detectionStats.notDetected = detectionStats.totalQuestions - finalDetected;
      detectionStats.questionDetails = detectionResults.map(r => ({
        questionNumber: r.question.questionNumber,
        detected: r.detectionResult.found,
        similarity: r.detectionResult.match?.confidence,
        matchedPaperTitle: r.detectionResult.match?.paperTitle,
        hasMarkingScheme: !!r.detectionResult.match?.markingScheme
      }));
    }

    // --- STEP 4.5: TEARDOWN ROGUE MATCHES ---
    // If the document failed the Dynamic Gate (no dominant paper), 
    // invalidate any isolated coincidental matches to force Generic Mode.
    if (!dominantPaper && detectionStats.detected > 0) {
      if (process.env.LOG_QUESTION_DETECTION === 'true') {
        console.log(`   🚨 [TEARDOWN] Consensus failed. Stripping official identities from ${detectionStats.detected} rogue match(es).`);
      }
      
      for (const dr of detectionResults) {
        if (dr.detectionResult.found) {
          dr.detectionResult.found = false;
          dr.detectionResult.match = null;
          dr.detectionResult.message = "Match stripped: Document failed consensus gate";
        }
      }
      
      // Reset stats since everything is now Generic
      detectionStats.detected = 0;
      detectionStats.notDetected = detectionStats.totalQuestions;
      detectionStats.questionDetails = detectionResults.map(r => ({
        questionNumber: r.question.questionNumber,
        detected: false,
        similarity: 0,
        matchedPaperTitle: undefined,
        hasMarkingScheme: false
      }));
    }

    // --- STEP 5: MERGE & FORMAT OUTPUT (SIMPLIFIED PREFIX-FIRST) ---

    // 0. Pre-processing: Create "Virtual Matches" for Generic Questions
    for (const item of detectionResults) {
      if (!item.detectionResult.match) {
        const qNum = item.question.questionNumber || '1';
        const detectedMarks = this.smartEstimateMaxMarks(item.question.text);
        const sequentialRubric = this.generateSequentialRubric(detectedMarks);
        const subQMarks = { [qNum]: sequentialRubric };

        if (process.env.LOG_QUESTION_DETECTION === 'true') {
          console.log(`\n🔴 [GENERIC MODE ACTIVATED] Q${qNum}: No match found, creating fallback scheme with ${detectedMarks} marks`);
        }

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
        const subQMaxScores: any = {};
        questionNumbers.forEach(qNum => {
          if (qNum) {
            subQMarksMap[qNum] = parentScheme.marks;
            subQMaxScores[qNum] = masterMatch.marks || 0;
          }
        });

        const rawAns = parentScheme.answer || '';
        const subAns = rawAns.includes('\n') ? rawAns.split('\n') : [rawAns];

        markingSchemesMap.set(uniqueKey, {
          questionMarks: { marks: parentScheme.marks, subQuestionMarks: subQMarksMap },
          totalMarks: masterMatch.marks || 0, parentQuestionMarks: masterMatch.parentQuestionMarks || 0,
          questionNumber: baseQuestionNumber,
        subject: masterMatch.subject || masterMatch.markingScheme?.examDetails?.subject || undefined,
        examDetails: masterMatch.markingScheme?.examDetails || undefined,
        questionDetection: group[0].detectionResult,
        databaseQuestionText: masterMatch.databaseQuestionText || '',
          subQuestionNumbers: questionNumbers, subQuestionAnswers: subAns, isGeneric: true,
          subQuestionMaxScores: subQMaxScores,
          generalMarkingGuidance: masterMatch.markingScheme.generalMarkingGuidance, sourceImageIndex: groupSourceImageIndex
        });
        continue;
      }

      // CASE B: PAST PAPER (Prefix-First Strategy)
      const allPaperQuestions = masterMatch.markingScheme?.allQuestions || {};



      const subQuestionMarksMap: any = {};
      const subQuestionMetadataMap: Record<string, any> = {};
      const subQuestionGuidanceMap: Record<string, any> = {};
      const subQuestionNumbers: string[] = [];
      const subQuestionAnswers: string[] = [];
      const subQuestionAnswersMap: Record<string, string> = {};

      const baseNumRegex = new RegExp(`^0*${baseQuestionNumber}([^0-9]|$)`, 'i');

      // Prepare Final Max Scores Map (Start with existing or empty)
      const finalSubQuestionMaxScores = masterMatch.subQuestionMaxScores ? { ...masterMatch.subQuestionMaxScores } : {};

      Object.keys(allPaperQuestions).forEach(rawKey => {
        if (baseNumRegex.test(rawKey)) {
          const key = rawKey.trim().replace(/^0+(?=\d)/, '');
          const qObj = allPaperQuestions[rawKey];
          const partMarks = qObj?.marks || qObj;
          subQuestionMarksMap[key] = partMarks;
          if (qObj && typeof qObj === 'object' && !Array.isArray(qObj)) {
            subQuestionMetadataMap[key] = {
              paradigm: qObj.paradigm,
              levels: qObj.levels || qObj.levelDescriptors,
              indicativeContent: qObj.indicativeContent,
              answer: qObj.answer,
              guidance: qObj.guidance
            };
            if (Array.isArray(qObj.guidance) && qObj.guidance.length > 0) {
              subQuestionGuidanceMap[key] = qObj.guidance;
              const suffix = key.replace(/^\d+/, '');
              if (suffix && suffix !== key) {
                subQuestionGuidanceMap[suffix] = qObj.guidance;
              }
            }
          }
          subQuestionNumbers.push(key);
          const ans = qObj?.answer;
          if (ans) {
            subQuestionAnswers.push(`(${key}) ${ans}`);
            subQuestionAnswersMap[key] = ans;
          }

          const strippedKey = key.replace(/^0+/, '');
          const partLabel = strippedKey.replace(/^\d+/, '');
          const dotStrippedPart = partLabel.replace(/^\./, '');
          const normalizedPartLabel = normalizeSubQuestionPart(dotStrippedPart);

          let dbScore =
            masterMatch.subQuestionMaxScores?.[key] ??
            masterMatch.subQuestionMaxScores?.[rawKey] ??
            masterMatch.subQuestionMaxScores?.[strippedKey] ??
            masterMatch.subQuestionMaxScores?.[partLabel] ??
            masterMatch.subQuestionMaxScores?.[dotStrippedPart] ??
            masterMatch.subQuestionMaxScores?.[normalizedPartLabel] ??
            (typeof qObj?.totalMarks === 'number' ? qObj.totalMarks : undefined) ??
            (typeof qObj?.maxMarks === 'number' ? qObj.maxMarks : undefined);

          // [TRUTH RECONCILIATION] 
          if (strippedKey === baseQuestionNumber && masterMatch.marks !== undefined) {
            dbScore = masterMatch.marks;
          }

          if (dbScore !== undefined) {
            finalSubQuestionMaxScores[key] = dbScore;

            const isCalcPart = qObj?.paradigm === 'CALCULATION_STEP' || (
              Array.isArray(partMarks) &&
              partMarks.length > 0 &&
              qObj?.paradigm !== 'LEVEL_OF_RESPONSE' &&
              partMarks.some((m: any) => /^M\d+$/i.test(String(m?.mark || '').trim()))
            );
            if (isCalcPart && Array.isArray(partMarks) && partMarks.length > 0 && dbScore > 0) {
              const parseMarkWeight = (code: string): number => {
                const m = String(code || '').trim().match(/^[BMAPC](\d+)$/i);
                return m ? parseInt(m[1], 10) : 1;
              };
              const currentMarkSum = partMarks.reduce((sum: number, m: any) => sum + parseMarkWeight(m?.mark), 0);
              if (currentMarkSum > 0 && currentMarkSum < dbScore) {
                const deficit = dbScore - currentMarkSum;
                const lastIdx = partMarks.length - 1;
                const lastMarkObj = { ...partMarks[lastIdx] };
                const lastCode = String(lastMarkObj.mark || 'A1').trim();
                const prefixMatch = lastCode.match(/^([BMAPC])(\d+)$/i);
                const prefix = prefixMatch ? prefixMatch[1].toUpperCase() : 'A';
                const oldWeight = prefixMatch ? parseInt(prefixMatch[2], 10) : 1;
                const newWeight = oldWeight + deficit;
                lastMarkObj.mark = `${prefix}${newWeight}`;
                lastMarkObj.comments = [
                  lastMarkObj.comments,
                  `Award full ${dbScore} marks if final numerical answer is correct`
                ].filter(Boolean).join(' | ');
                subQuestionMarksMap[key] = [...partMarks.slice(0, lastIdx), lastMarkObj];
                console.log(`⚖️  [CALC-RECONCILE] Q${key}: upgraded final mark ${lastCode} -> ${lastMarkObj.mark} so calculation marks sum to ${dbScore} (was ${currentMarkSum}).`);
              }
            }
          } else if (Array.isArray(partMarks)) {
            // Sum mark weights (e.g. B1 + B2 + B1 = 4) instead of partMarks.length (3)
            const weightSum = partMarks.reduce((sum: number, m: any) => {
              const code = String(m?.mark || '').trim();
              const match = code.match(/^[A-Za-z]*\s*(\d+)$/);
              return sum + (match ? parseInt(match[1], 10) : 1);
            }, 0);
            finalSubQuestionMaxScores[key] = weightSum || partMarks.length;
          }

        }
      });

      // ✂️ [PARTIAL-UPLOAD TRIM]: If the student only uploaded some parts of a multi-part question
      // (e.g. a cropped photo of 2a–2c out of 2a–2h), restrict the scheme to the contiguous range of uploaded parts so the
      // question is graded out of the uploaded parts' max (3/5) instead of the full question total (3/30).
      // Guardrails:
      // 1. Do NOT trim on multi-question / full-paper uploads (questionGroups.size >= 3), where the Mapper may label
      //    a first or last sub-part (like 01.1 or 03.3) with the bare parent question number ("1" or "3").
      // 2. Do NOT trim when the group contains a bare parent question number detection ("1", "3"), since that
      //    detection represents an un-suffixed sub-part on the page.
      let trimmedTotalMarks: number | null = null;
      const isMultiQuestionPaperUpload = questionGroups.size >= 3;
      const hasBareParentDetection = group.some(
        item => String(item.question.questionNumber || '').trim() === baseQuestionNumber
      );
      if (subQuestionNumbers.length > 1 && !isMultiQuestionPaperUpload && !hasBareParentDetection) {
        const partOf = (k: string) => normalizeSubQuestionPart(String(k).replace(/^0*\d+/, '')).toLowerCase();
        // Extract specific sub-question parts (e.g. "a", "b", "c"), ignoring bare parent number ("2" -> "")
        const specificParts = Array.from(new Set(
          group
            .map(item => String(item.question.questionNumber || ''))
            .filter(q => getBaseQuestionNumber(q) === baseQuestionNumber)
            .map(partOf)
            .filter(p => p !== '')
        ));

        if (specificParts.length > 0) {
          const schemeOrder = [...subQuestionNumbers];
          const matchesDetected = (key: string) => {
            const sp = partOf(key);
            return !!sp && specificParts.some(dp => sp === dp || sp.startsWith(dp) || dp.startsWith(sp));
          };
          const matchedIdx = schemeOrder.map((k, idx) => (matchesDetected(k) ? idx : -1)).filter(idx => idx >= 0);
          if (matchedIdx.length > 0) {
            const first = Math.min(...matchedIdx);
            const last = Math.max(...matchedIdx);
            const keep = new Set(schemeOrder.slice(first, last + 1));
            const dropped = schemeOrder.filter(k => !keep.has(k));
            if (dropped.length > 0) {
              const keptSum = Array.from(keep).reduce((s, k) => s + (Number(finalSubQuestionMaxScores[k]) || 0), 0);
              if (keptSum > 0) {
                dropped.forEach(k => {
                  delete subQuestionMarksMap[k];
                  delete subQuestionMetadataMap[k];
                  delete subQuestionGuidanceMap[k];
                  delete subQuestionAnswersMap[k];
                  delete finalSubQuestionMaxScores[k];
                });
                const keptNumbers = schemeOrder.filter(k => keep.has(k));
                subQuestionNumbers.length = 0;
                subQuestionNumbers.push(...keptNumbers);
                const keptAnswers = subQuestionAnswers.filter(a => keptNumbers.some(k => a.startsWith(`(${k}) `)));
                subQuestionAnswers.length = 0;
                subQuestionAnswers.push(...keptAnswers);
                trimmedTotalMarks = keptSum;
                console.log(`✂️  [PARTIAL-UPLOAD TRIM] Q${baseQuestionNumber}: graded on uploaded parts [${keptNumbers.join(', ')}] = ${keptSum} marks (dropped ${dropped.length} un-uploaded part(s): ${dropped.join(', ')}).`);
              }
            }
          }
        }
      }

      if (trimmedTotalMarks !== null) {
        if (masterMatch) {
          masterMatch.marks = trimmedTotalMarks;
          masterMatch.parentQuestionMarks = trimmedTotalMarks;
        }
        group.forEach(item => {
          if (item.detectionResult?.match) {
            item.detectionResult.match.marks = trimmedTotalMarks;
            item.detectionResult.match.parentQuestionMarks = trimmedTotalMarks;
          }
        });
      }

      if (Object.keys(subQuestionMarksMap).length === 0) {
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
      }

      markingSchemesMap.set(uniqueKey, {
        questionMarks: {
          ...(typeof parentScheme === 'object' && !Array.isArray(parentScheme) ? parentScheme : {}),
          marks: parentScheme?.marks || parentScheme,
          subQuestionMarks: subQuestionMarksMap,
          subQuestionAnswersMap: subQuestionAnswersMap,
          subQuestionMetadata: subQuestionMetadataMap,
          subQuestionGuidanceMap: subQuestionGuidanceMap,
          guidance: parentScheme?.guidance || masterMatch.markingScheme?.guidance
        },
        totalMarks: trimmedTotalMarks !== null ? trimmedTotalMarks : (masterMatch.marks || parentScheme.totalMarks || (typeof parentScheme.marks === 'number' ? parentScheme.marks : 0) || 0),
        parentQuestionMarks: trimmedTotalMarks !== null ? trimmedTotalMarks : (masterMatch.parentQuestionMarks || masterMatch.marks || parentScheme.totalMarks || (typeof parentScheme.marks === 'number' ? parentScheme.marks : 0) || 0),
        questionNumber: baseQuestionNumber,
        subject: masterMatch.subject || masterMatch.markingScheme?.examDetails?.subject || undefined,
        examDetails: masterMatch.markingScheme?.examDetails || undefined,
        questionDetection: group[0].detectionResult,
        databaseQuestionText: masterMatch.databaseQuestionText || '',
        subQuestionNumbers: subQuestionNumbers.sort((a, b) =>
          a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
        ),
        subQuestionAnswers: subQuestionAnswers,
        subQuestionMaxScores: finalSubQuestionMaxScores,
        subQuestionTexts: (() => {
          const rawMap = masterMatch.subQuestionTexts || {};
          const cleanedMap: Record<string, string> = {};
          for (const [k, v] of Object.entries(rawMap)) {
            if (typeof v === 'string' && v.trim()) {
              // Strip trailing "[2 marks]" noise so DB stems and live stems are identical
              cleanedMap[k] = v.replace(/\s*\[\s*\d+\s*marks?\s*\]\s*$/i, '').trim();
            }
          }
          return Object.keys(cleanedMap).length > 0 ? cleanedMap : undefined;
        })(),
        subQuestionMetadata: subQuestionMetadataMap,
        subQuestionGuidanceMap: subQuestionGuidanceMap,
        guidance: parentScheme?.guidance || masterMatch.markingScheme?.guidance,
        isGeneric: false, generalMarkingGuidance: masterMatch.markingScheme.generalMarkingGuidance, sourceImageIndex: groupSourceImageIndex,
        scoringType: parentScheme?.scoringType,
        levels: parentScheme?.levels || parentScheme?.levelDescriptors,
        indicativeStandard: parentScheme?.indicativeStandard,
        aoContentBullets: parentScheme?.aoContentBullets,
        dualAoBreakdown: parentScheme?.dualAoBreakdown,
        sourceExtracts: parentScheme?.sourceExtracts,
        examinerReport: parentScheme?.examinerReport,
        assessmentObjectives: parentScheme?.assessmentObjectives
      });
    }

    // ========================= ⚓ [POINTER SYNCHRONIZATION] =========================
    // CRITICAL FIX (Design Bible 1.2): We must propagate the 'Truth' back to the master list.
    // If the Truth Stage (Stage 3) found the question on a specific page, we MUST update 
    // the sourceImageIndex so the Sorter (Stage 4) and Zone Detector (Stage 5) have the same Map.
    for (const { question, detectionResult } of detectionResults) {
      if (detectionResult.found && detectionResult.match?.questionNumber) {

        // [SAFETY FIX] Use Strict Location Matching (Global Page ID)
        // Do NOT use text.includes() as it causes "Generic Text Overlap" (Q5 vs Q11c 'Use your graph...')
        const matchingQuestion = classificationResult.questions.find((q: any) =>
          q === question ||
          (q.sourceImageIndex !== undefined && q.sourceImageIndex === question.sourceImageIndex)
        );

        if (matchingQuestion) {
          // [SOFT DISABLE]: User requested to keep logs but disable the actual override (Risk Management).
          // 1. Logically link the question number (Database Verification)
          // matchingQuestion.questionNumber = detectionResult.match.questionNumber;
          // console.log(`⚓ [SYNC-DISABLED] Safe Match Found on P${question.sourceImageIndex}. AI: Q${matchingQuestion.questionNumber} -> DB: ${detectionResult.match.questionNumber}. (Override prevented)`);

          /* [DISABLED] "Identity Helper" - Page Anchor Update
          // 2. Physical Anchor Update (Source of Ordering Chaos fix)
          // 🛡️ [LOGICAL ANCHOR]: Stick to the page with the LOWEST weight (Earliest logical part).
          // If we find Q11 on Page 1 (as "11a") and Page 0 (as "11c"), we should anchor to Page 1.
          if (question.sourceImageIndex !== undefined) {
            const currentIdx = matchingQuestion.sourceImageIndex;
            const newQNum = detectionResult.match.questionNumber || '';
            const currentQNum = matchingQuestion.questionNumber || '';

            const newWeight = getQuestionSortValue(newQNum);
            const currentWeight = currentIdx !== undefined ? getQuestionSortValue(currentQNum) : Infinity;

            if (currentIdx === undefined || newWeight < currentWeight) {
              if (currentIdx !== undefined) {
                console.log(`⚓ [SYNC] Q${matchingQuestion.questionNumber}: Lower weight ${newQNum}(${newWeight}) found at P${question.sourceImageIndex}. Moving anchor from P${currentIdx}.`);
              } else {
                console.log(`⚓ [SYNC] Anchoring Q${matchingQuestion.questionNumber} -> Physical Page ${question.sourceImageIndex} (Weight ${newWeight})`);
                matchingQuestion.sourceImageIndex = question.sourceImageIndex;
              }
              matchingQuestion.sourceImageIndex = question.sourceImageIndex;

              // 3. Propagate to sub-questions (Bible 1.2) - ONLY if we anchor/re-anchor the parent
              if (matchingQuestion.subQuestions && Array.isArray(matchingQuestion.subQuestions)) {
                matchingQuestion.subQuestions.forEach((sub: any) => {
                  sub.sourceImageIndex = question.sourceImageIndex;
                });
              }
            }
          }
          */
        }
      }
    }
    // ===============================================================================

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
