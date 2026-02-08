/**
 * Question Detection Service
 * Matches extracted question text with exam papers in the database
 * Refactored for:
 * 1. Question-Level Detection (Block Matching)
 * 2. Performance (Singleton Caching)
 * 3. Robustness (Containment Logic for Context Matches)
 */

import { getFirestore } from '../../config/firebase.js';
import { normalizeTextForComparison, normalizeSubQuestionPart, generateGenericTitleFromText, getBaseQuestionNumber } from '../../utils/TextNormalizationUtils.js';
import { getShortSubjectName, getShortExamBoard } from './MarkingHelpers.js';
import * as stringSimilarity from 'string-similarity';

import { SimilarityService } from './SimilarityService.js';

// --- Type Definitions ---
export interface ExamPaperMatch {
  board: string;
  qualification: string;
  paperCode: string;
  examSeries: string;
  tier?: string;
  subject?: string;
  questionNumber?: string;
  subQuestionNumber?: string;
  marks?: number;
  parentQuestionMarks?: number;
  confidence?: number;
  paperTitle?: string;
  examPaper?: any;
  markingScheme?: MarkingSchemeMatch;
  databaseQuestionText?: string;
  subQuestionMaxScores?: { [key: string]: number };
  subQuestionTexts?: { [key: string]: string };
  isRescued?: boolean;
}

export interface MarkingSchemeMatch {
  id: string;
  examDetails: {
    board: string;
    qualification: string;
    paperCode: string;
    tier: string;
    paper: string;
    date: string;
    exam_series?: string;
    subject?: string;
  };
  questionMarks?: any;
  allQuestions?: any; // NEW: Full paper context for prefix lookup
  totalQuestions: number;
  totalMarks: number;
  confidence?: number;
  generalMarkingGuidance?: any;
}

export interface QuestionDetectionResult {
  found: boolean;
  match?: ExamPaperMatch;
  message?: string;
  markingScheme?: string;
  questionText?: string;
  hintMetadata?: {
    hintUsed: string;
    matchedPapersCount: number;
    matchedPaperTitle?: string;
    thresholdRelaxed: boolean;
    deepSearchActive?: boolean;
    poolSize?: number;
    isWeakMatch?: boolean;
    auditTrail?: Array<{
      rank: number;
      candidateId: string;
      score: number;
      scoreBreakdown: string;
      reason?: string;
    }>;
  };
}

interface MatchCandidate {
  paper: any;
  questionData: any;
  questionNumber: string;
  subQuestionNumber: string;
  databaseText: string;
  score: number;
  scoreDetails: {
    text: number;
    numeric: number;
    structure: number;
    semanticCheck: boolean;
  };
}

// --- Utilities ---
export function extractExamMetadata(match: ExamPaperMatch | null | undefined) {
  if (!match) return { examBoard: '', examCode: '', paperTitle: '', subject: '', tier: '', examSeries: '', questionNumber: '', subQuestionNumber: '', marks: undefined };
  return {
    examBoard: match.board || '',
    examCode: match.paperCode || '',
    paperTitle: match.qualification || '',
    subject: match.subject || '',
    tier: match.tier || '',
    examSeries: match.examSeries || '',
    questionNumber: match.questionNumber || '',
    subQuestionNumber: match.subQuestionNumber || '',
    marks: match.marks
  };
}

// --- Main Service ---
export class QuestionDetectionService {
  private static instance: QuestionDetectionService;
  private db: any;

  // Singleton Cache for Exam Papers
  private static cachedPapers: any[] | null = null;
  private static lastCacheTime: number = 0;
  private static readonly CACHE_TTL = 1000 * 60 * 60; // 1 Hour

  private constructor() {
    this.db = getFirestore();
  }

  public static getInstance(): QuestionDetectionService {
    if (!QuestionDetectionService.instance) {
      QuestionDetectionService.instance = new QuestionDetectionService();
    }
    return QuestionDetectionService.instance;
  }

  public async detectQuestion(
    extractedQuestionText: string,
    questionNumberHint?: string | null,
    examPaperHint?: string | null
  ): Promise<QuestionDetectionResult> {
    try {
      // 1. Input Sanitization
      // console.log(`[DEBUG_INPUT_CAPTURE] detectQuestion Input for ${questionNumberHint}:`, extractedQuestionText);
      const cleanText = (extractedQuestionText || '').trim();
      const cleanQHint = this.sanitizeQuestionHint(questionNumberHint);
      const cleanPaperHint = (examPaperHint || '').trim();

      if (cleanText.length === 0 && !cleanQHint) {
        return { found: false, message: 'No question text provided' };
      }

      // 2. Paper Retrieval & Filtering (Cached)
      const allExamPapers = await this.getAllExamPapers();
      const primaryPapers = cleanPaperHint
        ? this.filterPapersByHint(allExamPapers, cleanPaperHint)
        : [];

      const isNarrowSearch = primaryPapers.length > 0;
      const searchPool = isNarrowSearch ? primaryPapers : allExamPapers;

      const isRescueMode = isNarrowSearch && primaryPapers.length <= 2;

      // 3. Metadata Setup
      const currentPoolSize = searchPool.reduce((sum, paper) => {
        const questions = paper.questions || {};
        return sum + (Array.isArray(questions) ? questions.length : Object.keys(questions).length);
      }, 0);



      const hintMetadata: QuestionDetectionResult['hintMetadata'] = {
        hintUsed: isNarrowSearch ? cleanPaperHint : 'Global Search',
        matchedPapersCount: searchPool.length,
        matchedPaperTitle: (isNarrowSearch && searchPool.length === 1)
          ? `${searchPool[0].metadata.exam_board} - ${searchPool[0].metadata.exam_code}`
          : undefined,
        thresholdRelaxed: false,
        deepSearchActive: !isNarrowSearch,
        poolSize: currentPoolSize,
        auditTrail: []
      };

      if (searchPool.length === 0) {
        return { found: false, message: 'No exam papers found in database', hintMetadata };
      }

      // 4. Candidate Scoring & Collection
      let candidates: MatchCandidate[] = [];

      for (const paper of searchPool) {
        const paperCandidates = this.findCandidatesInPaper(cleanText, paper, cleanQHint, isRescueMode);
        candidates = candidates.concat(paperCandidates);
      }

      // 5. Ranking & Sorting
      candidates.sort((a, b) => b.score - a.score);



      hintMetadata.auditTrail = candidates.slice(0, 5).map((c, idx) => ({
        rank: idx + 1,
        candidateId: `${c.paper.metadata.exam_code} Q${c.questionNumber}`,
        score: parseFloat(c.score.toFixed(3)),
        scoreBreakdown: `Txt:${c.scoreDetails.text.toFixed(2)} Num:${c.scoreDetails.numeric.toFixed(2)} Str:${c.scoreDetails.structure.toFixed(2)} Sem:${c.scoreDetails.semanticCheck ? 'PASS' : 'FAIL'}`,
        reason: c.scoreDetails.semanticCheck ? 'Valid' : 'Semantic Fail'
      }));

      // 6. Thresholding & Selection (IMPROVED RELATIVE CONFIDENCE)
      if (candidates.length > 0) {
        const winner = candidates[0];
        const runnerUp = candidates.length > 1 ? candidates[1] : null;

        // Base Thresholds
        const strictThreshold = 0.80;
        const rescueThreshold = 0.35;

        // Relative Confidence Logic
        const isRelativeWinner = winner.score >= 0.65 && (!runnerUp || (winner.score - runnerUp.score > 0.15));

        let shouldAccept = false;

        if (isRescueMode) {
          shouldAccept = winner.score >= rescueThreshold;
        } else {
          shouldAccept = (winner.score >= strictThreshold) || isRelativeWinner;
        }

        const minimumTextScore = isRescueMode ? 0.15 : 0.25; // Relaxed slightly for context matches

        if (shouldAccept && winner.scoreDetails.text >= minimumTextScore) {

          if (winner.score < strictThreshold) hintMetadata.thresholdRelaxed = true;
          hintMetadata.isWeakMatch = winner.score < 0.7;

          /*
          if (isRelativeWinner && !isRescueMode && winner.score < strictThreshold) {
            console.log(`[DETECTION] 🏆 Relative Winner Accepted: ${winner.score.toFixed(3)} vs Runner-up ${runnerUp?.score.toFixed(3)}`);
          }
          */

          // Construct Result
          const matchResult = this.constructMatchResult(winner, isRescueMode || isRelativeWinner);

          // Attach Marking Scheme
          const markingScheme = await this.findCorrespondingMarkingScheme(matchResult);
          if (markingScheme) {
            matchResult.markingScheme = markingScheme;
          }

          return {
            found: true,
            match: matchResult,
            message: `Matched ${matchResult.paperCode} Q${matchResult.questionNumber}`,
            hintMetadata
          };
        }
      }

      // 7. Failure State
      hintMetadata.isWeakMatch = true;
      return {
        found: false,
        message: candidates.length > 0 ? 'Matches found but below confidence threshold' : 'No matching questions found',
        hintMetadata
      };

    } catch (error) {
      console.error('❌ Error in question detection:', error);
      return { found: false, message: `Detection failed: ${error instanceof Error ? error.message : 'Unknown'}` };
    }
  }

  // --- BLOCK MATCHING LOGIC ---
  private findCandidatesInPaper(
    inputQueryText: string,
    paper: any,
    hintQNum: string | null,
    isRescueMode: boolean
  ): MatchCandidate[] {
    const candidates: MatchCandidate[] = [];
    const questions = paper.questions || {};

    const questionIterator = Array.isArray(questions)
      ? questions.map(q => ({ num: String(q.question_number || q.number), data: q }))
      : Object.entries(questions).map(([k, v]) => ({ num: String((v as any).question_number || k), data: v }));

    for (const { num: qNum, data: qData } of questionIterator) {
      // 1. Base Number Check
      const hintBase = hintQNum ? hintQNum.match(/^\d+/)?.[0] : null;
      const currentBase = qNum.match(/^\d+/)?.[0];

      if (!isRescueMode && hintBase && currentBase && hintBase !== currentBase) {
        continue;
      }

      // 2. CONSTRUCT AGGREGATE DB TEXT (For Scoring Only)
      const parentText = (qData.question_text || qData.text || qData.question || '').trim();
      let searchAggregateText = parentText + ' ';

      const subQuestions = qData.sub_questions || qData.subQuestions || [];
      if (Array.isArray(subQuestions)) {
        searchAggregateText += subQuestions.map((sq: any) =>
          (sq.text || sq.question || sq.question_text || sq.sub_question || '')
        ).join(' ');
      }

      // 3. COMPARE BLOCKS
      const scoreDetails = this.calculateHybridScore(inputQueryText, searchAggregateText, hintQNum, qNum, null, isRescueMode);

      // 4. THRESHOLD
      if (scoreDetails.total > 0.15) {
        candidates.push({
          paper,
          questionData: qData,
          questionNumber: qNum,
          subQuestionNumber: '',
          databaseText: parentText, // [FIX]: Return ONLY the parent text, not the search join.
          score: scoreDetails.total,
          scoreDetails
        });
      }
    }

    return candidates;
  }

  private calculateHybridScore(
    inputText: string,
    dbText: string,
    hint: string | null,
    dbQNum: string,
    dbSubPart: string | null,
    isRescueMode: boolean
  ): { total: number, text: number, numeric: number, structure: number, semanticCheck: boolean } {

    // 🛡️ [REUSE]: Delegate to centralized SimilarityService (Strict Question Mode)
    const details = SimilarityService.calculateQuestionHybridScore(inputText, dbText, isRescueMode);

    // 4. Structural Match (Remains in Detection Service as it's specific to Paper search)
    let structureScore = 0.5; // Neutral for global search without hints
    if (hint) {
      const hintBase = hint.match(/^\d+/)?.[0];
      const dbBase = dbQNum.match(/^\d+/)?.[0];
      if (hintBase === dbBase) structureScore = 1.0;
      else structureScore = 0.0; // Hard fail if numbers differ
    }

    // [AND GATE LOGIC]: 
    // Final score is a mix, but we apply a "Kill Switch" if either side is too weak.
    let finalTotal = (details.total * 0.7) + (structureScore * 0.3);

    // 🛡️ [CONTENT-LOCK]: If text similarity is low (<0.4), 
    // don't let a matching Question Number (structureScore=1.0) push it into the success zone.
    // This implements the "AND" condition: Quality Text AND Correct Number.
    if (structureScore > 0.8 && details.text < 0.4) {
      finalTotal *= 0.4; // Drastic drop for generic labels like "Question 12"
    }

    // 🛡️ [GREAT PENALTY - HARD REJECT]: If hint is provided but doesn't match, strictly suppress.
    // [V30 FIX] Only apply if NOT in rescue mode.
    if (!isRescueMode && hint && structureScore < 0.8) {
      finalTotal = 0;
    } else if (hint && structureScore < 0.8) {
      // Still apply a small penalty in rescue mode to favor better matches,
      // but don't Hard Reject.
      finalTotal *= 0.1;
    }

    return {
      total: finalTotal,
      text: details.text,
      numeric: details.numeric,
      structure: structureScore,
      semanticCheck: details.semanticCheck
    };
  }

  private getKeywords(text: string): Set<string> {
    return SimilarityService.getKeywords(text);
  }

  private constructMatchResult(candidate: MatchCandidate, isRescueMode: boolean): ExamPaperMatch {
    const { paper, questionData, questionNumber, databaseText, score } = candidate;
    const meta = paper.metadata || {};
    const parentMarks = questionData.marks ?? questionData.question_marks ?? questionData.max_marks ?? questionData.max_question_marks ?? questionData.total_marks ?? 0;

    const board = meta.exam_board || meta.board;
    const code = meta.exam_code || meta.code;
    const series = meta.exam_series || meta.series;
    const tier = meta.tier;
    const subject = meta.subject;
    const qualification = meta.qualification || meta.subject;

    // Extract sub-question max scores AND texts from database JSON
    const subQuestionMaxScores: { [key: string]: number } = {};
    const subQuestionTexts: { [key: string]: string } = {};

    const extractSubPartsRecursive = (subs: any[], parentPart: string = '') => {
      if (!Array.isArray(subs)) return;

      subs.forEach((sq: any) => {
        const rawPart = sq.question_part || sq.part || sq.label || sq.sub_question_number || sq.question_number || sq.number || '';
        if (!rawPart) return;

        // Normalization: "(i)" -> "i", "a" -> "a"
        const cleanPart = normalizeSubQuestionPart(String(rawPart));
        const fullPart = parentPart ? `${parentPart}${cleanPart}` : cleanPart;

        const sqMarks = sq.marks ?? sq.question_marks ?? sq.max_marks ?? sq.max_question_marks ?? sq.total_marks;
        if (sqMarks !== undefined) {
          subQuestionMaxScores[fullPart] = Number(sqMarks);
        }
        if (sq.question_text || sq.text || sq.questionText) {
          subQuestionTexts[fullPart] = sq.question_text || sq.text || sq.questionText;
        }

        // Recursive call for nested sub-questions
        const nestedSubs = sq.sub_questions || sq.subQuestions || sq.parts || [];
        if (nestedSubs.length > 0) {
          extractSubPartsRecursive(nestedSubs, fullPart);
        }
      });
    };

    const subQuestions = questionData.sub_questions || questionData.subQuestions || [];
    extractSubPartsRecursive(subQuestions);

    return {
      board: board,
      qualification: qualification,
      paperCode: code,
      examSeries: series,
      tier: tier,
      subject: subject,
      questionNumber: questionNumber,
      subQuestionNumber: undefined,
      marks: parentMarks,
      parentQuestionMarks: parentMarks,
      confidence: score,
      paperTitle: `${board} - ${code} - ${series}${tier ? `, ${tier}` : ''}`,
      examPaper: paper,
      databaseQuestionText: databaseText,
      subQuestionMaxScores: Object.keys(subQuestionMaxScores).length > 0 ? subQuestionMaxScores : undefined,
      subQuestionTexts: Object.keys(subQuestionTexts).length > 0 ? subQuestionTexts : undefined,
      isRescued: isRescueMode && score < 0.8
    };
  }

  private sanitizeQuestionHint(hint: string | undefined | null): string | null {
    if (!hint) return null;
    let clean = hint.toLowerCase().trim();
    if (clean === 'l') clean = '1';
    return clean;
  }

  // --- Legacy Wrapper ---
  public async matchQuestionWithExamPaper(
    questionText: string,
    examPaper: any,
    questionNumberHint?: string | null,
    examPaperHint?: string | null
  ): Promise<ExamPaperMatch | null> {
    const meta = examPaper.metadata || {};
    const paperString = `${meta.exam_board} ${meta.exam_code} ${meta.exam_series} ${meta.tier}`.toLowerCase();
    const isRescueMode = examPaperHint ? paperString.includes(examPaperHint.toLowerCase().split(' ').slice(0, 2).join(' ')) : false;

    const candidates = this.findCandidatesInPaper(questionText, examPaper, questionNumberHint, isRescueMode);

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      const winner = candidates[0];
      const threshold = isRescueMode ? 0.35 : 0.80;
      if (winner.score >= threshold) {
        return this.constructMatchResult(winner, isRescueMode);
      }
      return this.constructMatchResult(winner, isRescueMode);
    }
    return null;
  }

  // --- Helper Methods ---
  private filterPapersByHint(papers: any[], hint: string): any[] {
    const normalizedHint = hint.toLowerCase().trim();
    if (!normalizedHint) return papers;
    let processedHint = normalizedHint;
    if (processedHint.includes('edexcel') && processedHint.includes('may')) processedHint = processedHint.replace(/\bmay\b/gi, 'june');
    else if (processedHint.includes('may')) processedHint = processedHint.replace(/\bmay\b/gi, 'june');

    const keywords = processedHint.replace(/[-,]/g, ' ').split(/\s+/).filter(k => k.length > 0 && /[a-z0-9]/i.test(k));
    if (keywords.length === 0) return papers;

    return papers.filter(paper => {
      const metadata = paper.metadata;
      if (!metadata) return false;
      const combined = `${metadata.exam_board} ${metadata.exam_code} ${metadata.exam_series} ${metadata.tier} ${metadata.subject}`.toLowerCase();
      return keywords.every(keyword => combined.includes(keyword));
    });
  }

  private async getAllExamPapers(): Promise<any[]> {
    if (!this.db) return [];

    const now = Date.now();
    if (QuestionDetectionService.cachedPapers && (now - QuestionDetectionService.lastCacheTime < QuestionDetectionService.CACHE_TTL)) {
      return QuestionDetectionService.cachedPapers;
    }

    try {
      const snapshot = await this.db.collection('fullExamPapers').get();
      const papers: any[] = [];
      snapshot.forEach((doc: any) => papers.push({ id: doc.id, ...doc.data() }));
      QuestionDetectionService.cachedPapers = papers;
      QuestionDetectionService.lastCacheTime = now;
      return papers;
    } catch (e) {
      console.error('Error fetching papers', e);
      return [];
    }
  }

  public calculateSimilarity(str1: string, str2: string): number {
    return SimilarityService.calculateSimilarity(str1, str2);
  }

  private calculateNgramSimilarity(text1: string, text2: string, n: number = 3): number {
    const ngrams1 = this.extractNgrams(text1, n);
    const ngrams2 = this.extractNgrams(text2, n);
    if (!ngrams1.length && !ngrams2.length) return 1.0;
    if (!ngrams1.length || !ngrams2.length) return 0.0;
    const set1 = new Set(ngrams1);
    const set2 = new Set(ngrams2);
    const intersection = [...set1].filter(x => set2.has(x)).length;
    const union = new Set([...set1, ...set2]).size;
    return union === 0 ? 1.0 : intersection / union;
  }

  private extractNgrams(text: string, n: number): string[] {
    const res: string[] = [];
    for (let i = 0; i <= text.length - n; i++) res.push(text.substring(i, i + n));
    return res;
  }

  public async findCorrespondingMarkingScheme(examPaperMatch: ExamPaperMatch): Promise<MarkingSchemeMatch | null> {
    try {
      if (!this.db) return null;
      const snapshot = await this.db.collection('markingSchemes').get();
      const schemes: any[] = [];
      snapshot.forEach((doc: any) => schemes.push({ id: doc.id, ...doc.data() }));
      let bestMatch: MarkingSchemeMatch | null = null;
      let bestScore = 0;
      for (const scheme of schemes) {
        const match = this.matchMarkingSchemeWithExamPaper(examPaperMatch, scheme);
        if (match) {
          const isExactPaper = examPaperMatch.paperCode === match.examDetails.paperCode;
          const score = isExactPaper ? match.confidence + 0.1 : match.confidence;
          if (score > bestScore) {
            bestMatch = match;
            bestScore = score;
          }
        }
      }
      return bestMatch;
    } catch (error) {
      console.error('Error finding marking scheme', error);
      return null;
    }
  }

  private matchMarkingSchemeWithExamPaper(examPaperMatch: ExamPaperMatch, markingScheme: any): MarkingSchemeMatch | null {
    try {
      const examDetails = markingScheme.examDetails;
      if (!examDetails) return null;
      if (examPaperMatch.paperCode !== examDetails.paperCode) return null;
      const boardMatch = this.calculateSimilarity(examPaperMatch.board, examDetails.board || '');
      const seriesMatch = this.calculateSimilarity(examPaperMatch.examSeries, examDetails.exam_series || '');
      const overallScore = (boardMatch + 1.0 + seriesMatch) / 3;
      if (overallScore > 0.7) {
        let questionMarks = null;
        if (!examPaperMatch.questionNumber || !markingScheme.questions) return null;
        const rawQNum = String(examPaperMatch.questionNumber || '').trim();
        const baseNum = getBaseQuestionNumber(rawQNum);

        // Use either the original qNum or the baseNum for lookup
        const qNum = rawQNum.replace(/^q\s*/i, '').replace(/^0+/, '');
        const questions = markingScheme.questions;
        const mainQ = questions[qNum] || questions[baseNum];

        if (mainQ && (mainQ.sub_questions || mainQ.subQuestions || mainQ.parts)) {
          questionMarks = mainQ;
        } else {
          const subKeys = Object.keys(questions).filter(k => {
            const m = k.match(/^(\d+)([a-z]+|\(?[ivx]+\)?)$/i);
            return m && m[1] === baseNum;
          }).sort();

          if (subKeys.length > 0) {
            if (subKeys.length > 1 || (subKeys.length === 1 && subKeys[0] !== qNum)) {
              questionMarks = {
                isComposite: true,
                marks: [],
                subQuestionMarks: Object.fromEntries(
                  subKeys.map(k => [k, questions[k]])
                )
              };
            } else {
              questionMarks = mainQ || questions[subKeys[0]];
            }
          } else if (mainQ) {
            questionMarks = mainQ;
          } else {
            return null;
          }
        }

        return {
          id: markingScheme.id,
          examDetails,
          questionMarks,
          allQuestions: markingScheme.questions, // NEW: Full paper context
          totalQuestions: markingScheme.totalQuestions || 0,
          totalMarks: markingScheme.totalMarks || 0,
          confidence: overallScore,
          generalMarkingGuidance: markingScheme.generalMarkingGuidance
        };
      }
      return null;
    } catch (e) { return null; }
  }
}

// --- Helper functions for session management and titles ---

/**
 * Build a structured exam paper display for the frontend
 */
export function buildExamPaperStructure(detectionResults: any[]) {
  if (!detectionResults || detectionResults.length === 0) {
    return {
      examPapers: [],
      multipleExamPapers: false,
      totalMarks: 0
    };
  }

  // Group detection results by unique exam paper
  const examPaperGroups = new Map<string, any>();

  detectionResults.forEach(dr => {
    const match = dr.detectionResult?.match;
    if (!match) return;

    const board = match.board || '';
    const code = match.paperCode || '';
    const series = match.examSeries || '';
    const tier = match.tier || '';
    const paperKey = `${board}_${code}_${series}_${tier}`;

    if (!examPaperGroups.has(paperKey)) {
      // Get subject from match
      const subject = match.subject || match.qualification || '';

      const boardPart = getShortExamBoard(board);
      const subjectPart = getShortSubjectName(subject || '');

      examPaperGroups.set(paperKey, {
        examBoard: board,
        examCode: code,
        examSeries: series,
        tier: tier,
        subject: subject,
        // Pattern: Exam Series + Board Short + Subject Short + Tier
        paperTitle: `${series} ${boardPart} ${subjectPart}${tier ? ` ${tier}` : ''}`.replace(/\s+/g, ' ').trim(),
        questions: [],
        totalMarks: 0,
        isGeneric: match.isGeneric === true || match.paperCode === 'Generic Question'
      });
    }

    const paperGroup = examPaperGroups.get(paperKey);
    const questionNumber = dr.question.questionNumber || match.questionNumber;
    const marks = match.marks || 0;

    // Use database text if available
    const questionText = match.databaseQuestionText || dr.question.text || '';

    // [V2 CLEAN FIX] Standardize markingScheme as string
    let markingSchemeStr = '';

    if (dr.detectionResult && dr.detectionResult.markingScheme) {
      if (typeof dr.detectionResult.markingScheme === 'string') {
        markingSchemeStr = dr.detectionResult.markingScheme;
      } else if (Array.isArray(dr.detectionResult.markingScheme)) {
        // Fallback: convert extracted array back to string if needed (should be rare in V2)
        markingSchemeStr = dr.detectionResult.markingScheme.map((s: any) => `- ${s.mark || 'Mark'}: ${s.answer}`).join('\n');
      }
    } else if (match.markingScheme?.markingSchemeText) {
      markingSchemeStr = match.markingScheme.markingSchemeText;
    }

    paperGroup.questions.push({
      questionNumber: String(questionNumber),
      questionText: questionText,
      marks: marks,
      markingScheme: markingSchemeStr
    });

    // Add to paper total marks
    paperGroup.totalMarks += marks;
  });

  const examPapers = Array.from(examPaperGroups.values());
  const multipleExamPapers = examPapers.length > 1;

  // Total marks across all uniqueness
  const totalMarks = examPapers.reduce((sum, p) => sum + p.totalMarks, 0);

  return {
    examPapers,
    multipleExamPapers,
    totalMarks
  };
}

/**
 * Generate a descriptive session title from detection results
 */
export function generateSessionTitleFromDetectionResults(detectionResults: any[], mode: 'Marking' | 'Question'): string {
  const { examPapers, totalMarks } = buildExamPaperStructure(detectionResults);

  if (examPapers.length === 0) {
    return `${mode} - ${new Date().toLocaleDateString()}`;
  }

  // NEW: Handle Generic Case (Bypass Ugly Structured Title)
  // If ALL papers are generic, use the question text for a cleaner title
  const allGeneric = examPapers.length > 0 && examPapers.every(p => p.isGeneric);
  if (allGeneric && detectionResults.length > 0) {
    const firstQText = detectionResults[0].question?.text || '';
    return generateGenericTitleFromText(firstQText, mode);
  }

  // Pattern: Exam Series + Exam Code + Board Short + Subject Short + Tier
  const p = examPapers[0];
  const seriesPart = p.examSeries || '';
  const codePart = p.examCode || '';
  const boardPart = getShortExamBoard(p.examBoard);
  const subjectPart = getShortSubjectName(p.subject || '');
  const tierPart = p.tier ? `${p.tier}` : '';

  // Question Range (Q1 to Q8)
  const qNums = p.questions
    .map((q: any) => parseInt(q.questionNumber))
    .filter((n: any) => !isNaN(n))
    .sort((a: any, b: any) => a - b);

  let qRange = '';
  if (qNums.length > 0) {
    if (qNums.length === 1) {
      qRange = ` Q${qNums[0]}`;
    } else {
      qRange = ` Q${qNums[0]} to Q${qNums[qNums.length - 1]}`;
    }
  }

  const baseTitle = `${seriesPart} ${codePart} ${boardPart} ${subjectPart} ${tierPart}`.replace(/\s+/g, ' ').trim();
  return `${baseTitle}${qRange} ${totalMarks} marks`.replace(/\s+/g, ' ').trim();
}

/**
 * Simple total marks calculator
 */
export function calculateTotalMarks(detectionResults: any[]): number {
  return detectionResults.reduce((sum, dr) => sum + (dr.detectionResult?.match?.marks || 0), 0);
}

export const questionDetectionService = QuestionDetectionService.getInstance();
