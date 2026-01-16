/**
 * Question Detection Service
 * Matches extracted question text with exam papers in the database
 * Refactored for:
 * 1. Question-Level Detection (Block Matching)
 * 2. Performance (Singleton Caching)
 * 3. Robustness (Math-aware Keywords)
 */

import { getFirestore } from '../../config/firebase.js';
import { normalizeTextForComparison, normalizeSubQuestionPart } from '../../utils/TextNormalizationUtils.js';
import * as stringSimilarity from 'string-similarity';

// --- Constants ---
const COMMON_STOP_WORDS = new Set([
  'the', 'and', 'is', 'in', 'it', 'of', 'to', 'for', 'a', 'an', 'on', 'with', 'at', 'by',
  'from', 'up', 'down', 'out', 'that', 'this', 'write', 'down', 'calculate', 'find', 'work',
  'answer', 'total', 'marks', 'question', 'show', 'give', 'your', 'reason', 'explain', 'state',
  'describe', 'complete', 'value', 'table', 'graph', 'grid', 'diagram', 'space', 'left', 'blank'
]);

// Semantic mapping for LaTeX commands to English keywords
const LATEX_SEMANTIC_MAP: { [key: string]: string } = {
  'frac': 'fraction', 'sqrt': 'root', 'approx': 'estimate', 'pi': 'circle',
  'angle': 'angle', 'triangle': 'triangle', 'int': 'integral', 'sum': 'sum',
  'lim': 'limit', 'vec': 'vector', 'sin': 'sine', 'cos': 'cosine', 'tan': 'tangent'
};

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
function getShortSubjectName(qualification: string): string {
  const subjectMap: { [key: string]: string } = {
    'MATHEMATICS': 'MATHS', 'PHYSICS': 'PHYSICS', 'CHEMISTRY': 'CHEMISTRY', 'BIOLOGY': 'BIOLOGY',
    'ENGLISH': 'ENGLISH', 'ENGLISH LITERATURE': 'ENG LIT', 'HISTORY': 'HISTORY', 'GEOGRAPHY': 'GEOGRAPHY',
    'FRENCH': 'FRENCH', 'SPANISH': 'SPANISH', 'GERMAN': 'GERMAN', 'COMPUTER SCIENCE': 'COMP SCI',
    'ECONOMICS': 'ECONOMICS', 'PSYCHOLOGY': 'PSYCHOLOGY', 'SOCIOLOGY': 'SOCIOLOGY', 'BUSINESS STUDIES': 'BUSINESS',
    'ART': 'ART', 'DESIGN AND TECHNOLOGY': 'D&T', 'MUSIC': 'MUSIC', 'PHYSICAL EDUCATION': 'PE',
    'CHEM': 'CHEMISTRY', 'PHYS': 'PHYSICS'
  };
  return subjectMap[qualification.toUpperCase()] || qualification;
}

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

      // "Rescue Mode" is active if we have narrowed down to a very specific pool (≤ 2 papers)
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
        // Pass rescue mode to scoring logic
        const paperCandidates = this.findCandidatesInPaper(cleanText, paper, cleanQHint, isRescueMode);
        candidates = candidates.concat(paperCandidates);
      }

      // 5. Ranking & Sorting
      candidates.sort((a, b) => b.score - a.score);

      // Populate Audit Trail (Top 5)
      hintMetadata.auditTrail = candidates.slice(0, 5).map((c, idx) => ({
        rank: idx + 1,
        candidateId: `${c.paper.metadata.exam_code} Q${c.questionNumber}`,
        score: parseFloat(c.score.toFixed(3)),
        scoreBreakdown: `Txt:${c.scoreDetails.text.toFixed(2)} Num:${c.scoreDetails.numeric.toFixed(2)} Str:${c.scoreDetails.structure.toFixed(2)} Sem:${c.scoreDetails.semanticCheck ? 'PASS' : 'FAIL'}`,
        reason: c.scoreDetails.semanticCheck ? 'Valid' : 'Semantic Fail'
      }));

      // 6. Thresholding & Selection
      if (candidates.length > 0) {
        const winner = candidates[0];

        // Strict Global Thresholds for "Full Question" blocks
        const strictThreshold = 0.80;
        const rescueThreshold = 0.35;

        const requiredThreshold = isRescueMode ? rescueThreshold : strictThreshold;
        const minimumTextScore = isRescueMode ? 0.15 : 0.30;

        if (winner.score >= requiredThreshold && winner.scoreDetails.text >= minimumTextScore) {

          if (winner.score < 0.80) hintMetadata.thresholdRelaxed = true;
          hintMetadata.isWeakMatch = winner.score < 0.7;

          // Construct Result
          const matchResult = this.constructMatchResult(winner, isRescueMode);

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

  // --- BLOCK MATCHING LOGIC (No Sub-Question Loops) ---
  private findCandidatesInPaper(
    inputQueryText: string,
    paper: any,
    hintQNum: string | null,
    isRescueMode: boolean
  ): MatchCandidate[] {
    const candidates: MatchCandidate[] = [];
    const questions = paper.questions || {};

    // Normalize to array
    const questionIterator = Array.isArray(questions)
      ? questions.map(q => ({ num: String(q.question_number || q.number), data: q }))
      : Object.entries(questions).map(([k, v]) => ({ num: String((v as any).question_number || k), data: v }));

    for (const { num: qNum, data: qData } of questionIterator) {
      // 1. Base Number Check (Fast Filter)
      // Since input is grouped by "1", we only look at "1".
      const hintBase = hintQNum ? hintQNum.match(/^\d+/)?.[0] : null;
      const currentBase = qNum.match(/^\d+/)?.[0];

      if (hintBase && currentBase && hintBase !== currentBase) {
        continue;
      }

      // 2. CONSTRUCT AGGREGATE DB TEXT (The "Anchor")
      // We combine Main Text + All Sub-question Texts into one block.
      // This creates a "Full Question Context" matching the input group.
      let fullDbText = (qData.question_text || qData.text || qData.question || '') + ' ';

      const subQuestions = qData.sub_questions || qData.subQuestions || [];
      if (Array.isArray(subQuestions)) {
        fullDbText += subQuestions.map((sq: any) =>
          (sq.text || sq.question || sq.question_text || sq.sub_question || '')
        ).join(' ');
      }

      // 3. COMPARE BLOCKS
      const scoreDetails = this.calculateHybridScore(inputQueryText, fullDbText, hintQNum, qNum, null, isRescueMode);

      // 4. THRESHOLD
      if (scoreDetails.total > 0.15) {
        candidates.push({
          paper,
          questionData: qData,
          questionNumber: qNum,
          subQuestionNumber: '', // Parent match
          databaseText: fullDbText.trim(),
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
    dbSubPart: string | null, // Unused in Block Match but kept for interface
    isRescueMode: boolean
  ): { total: number, text: number, numeric: number, structure: number, semanticCheck: boolean } {

    // 1. Text Similarity
    const textScore = this.calculateSimilarity(inputText, dbText);

    // 2. Semantic Anchoring (Math-Aware)
    const inputKeywords = this.getKeywords(inputText);
    const dbKeywords = this.getKeywords(dbText);

    let semanticCheck = false;
    if (inputKeywords.size < 2 || dbKeywords.size < 2) {
      semanticCheck = true;
    } else {
      for (const w of inputKeywords) {
        if (dbKeywords.has(w)) {
          semanticCheck = true;
          break;
        }
      }
    }

    // 3. Numeric Fingerprinting
    const inputNums = (inputText.match(/\d+(\.\d+)?/g) || []);
    const dbNums = (dbText.match(/\d+(\.\d+)?/g) || []);
    let numericScore = 0;
    if (dbNums.length > 0 && inputNums.length > 0) {
      const setDb = new Set(dbNums);
      const intersection = inputNums.filter(n => setDb.has(n));
      numericScore = intersection.length / Math.max(inputNums.length, dbNums.length);
    } else if (dbNums.length === 0 && inputNums.length === 0) {
      numericScore = 0.5;
    }

    // 4. Structural Match (Only Check Base Number)
    let structureScore = 0.5;
    if (hint) {
      const hintBase = hint.match(/^\d+/)?.[0];
      const dbBase = dbQNum.match(/^\d+/)?.[0];
      if (hintBase === dbBase) structureScore = 1.0;
    }

    // Weighting
    let total = 0;
    const textFloor = isRescueMode ? 0.15 : 0.25;
    const effectiveStructureScore = (textScore < textFloor && numericScore < 0.5) ? 0 : structureScore;

    if (effectiveStructureScore >= 0.9) {
      total = (textScore * 0.45) + (numericScore * 0.25) + (effectiveStructureScore * 0.30);
    } else {
      total = (textScore * 0.60) + (numericScore * 0.30) + (effectiveStructureScore * 0.10);
    }

    if (!isRescueMode && !semanticCheck) {
      total = total * 0.4;
    }

    return { total, text: textScore, numeric: numericScore, structure: effectiveStructureScore, semanticCheck };
  }

  private getKeywords(text: string): Set<string> {
    if (!text) return new Set();
    let clean = text.toLowerCase();

    Object.entries(LATEX_SEMANTIC_MAP).forEach(([cmd, replacement]) => {
      const regex = new RegExp(`\\\\${cmd}`, 'g');
      clean = clean.replace(regex, ` ${replacement} `);
    });

    clean = clean.replace(/\\[a-z]+/g, ' ').replace(/[^a-z0-9\s]/g, '').trim();
    return new Set(clean.split(/\s+/).filter(w => w.length > 3 && !COMMON_STOP_WORDS.has(w)));
  }

  private constructMatchResult(candidate: MatchCandidate, isRescueMode: boolean): ExamPaperMatch {
    const { paper, questionData, questionNumber, databaseText, score } = candidate;
    const meta = paper.metadata || {}; // Ensure meta is not null
    const parentMarks = questionData.marks || 0;

    // Robust extraction with fallbacks based on user feedback
    // DB uses 'exam_code' and 'code'
    const board = meta.exam_board || meta.board;
    const code = meta.exam_code || meta.code;
    const series = meta.exam_series || meta.series;
    const tier = meta.tier; // usually just 'tier'
    const subject = meta.subject;
    const qualification = meta.qualification || meta.subject;

    return {
      board: board,
      qualification: qualification,
      paperCode: code,
      examSeries: series,
      tier: tier,
      subject: subject,
      questionNumber: questionNumber,
      subQuestionNumber: undefined, // Block match is always parent
      marks: parentMarks,
      parentQuestionMarks: parentMarks,
      confidence: score,
      paperTitle: `${board} - ${code} - ${series}${tier ? `, ${tier}` : ''}`,
      examPaper: paper,
      databaseQuestionText: databaseText,
      isRescued: isRescueMode && score < 0.8
    };
  }

  private sanitizeQuestionHint(hint: string | undefined | null): string | null {
    if (!hint) return null;
    if (hint === '1') return null;
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
    if (!str1 || !str2) return 0;
    const norm1 = normalizeTextForComparison(str1);
    const norm2 = normalizeTextForComparison(str2);
    if (norm1 === norm2) return 1.0;
    if (norm1.length < 50 || norm2.length < 50) {
      if (norm1.includes(norm2) || norm2.includes(norm1)) {
        const shorter = norm1.length < norm2.length ? norm1 : norm2;
        const longer = norm1.length >= norm2.length ? norm1 : norm2;
        return Math.max(0.7, shorter.length / longer.length);
      }
    }
    const dice = stringSimilarity.compareTwoStrings(norm1, norm2);
    const ngram = this.calculateNgramSimilarity(norm1, norm2, 3);
    return Math.max(dice, ngram);
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
        const qNum = String(examPaperMatch.questionNumber).trim().replace(/^0+/, '');

        // Block Match logic: We assume the match is at parent level "1"
        // so we fetch Q1 from scheme.
        const questions = markingScheme.questions;
        const baseNum = qNum.match(/^\d+/)?.[0] || qNum;
        const mainQ = questions[qNum];

        if (mainQ && (mainQ.sub_questions || mainQ.subQuestions || mainQ.parts)) {
          // It's a parent that already has children inside it - use as is
          questionMarks = mainQ;
        } else {
          // Check for sibling keys (e.g. "20a", "20b" when we only have "20")
          const subKeys = Object.keys(questions).filter(k => {
            const m = k.match(/^(\d+)([a-z]+|\(?[ivx]+\)?)$/i);
            return m && m[1] === baseNum;
          }).sort();

          if (subKeys.length > 0) {
            // We found siblings or parts for this base number
            // If mainQ exists but has no children, and siblings exist, it's better to return a composite
            if (subKeys.length > 1 || (subKeys.length === 1 && subKeys[0] !== qNum)) {
              questionMarks = {
                isComposite: true,
                marks: [],
                subQuestionMarks: Object.fromEntries(
                  subKeys.map(k => [k, questions[k]])
                )
              };
            } else {
              // Only one key and it's either qNum or the only variant - use it
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

export const questionDetectionService = QuestionDetectionService.getInstance();

/**
 * UTILITY: Build Exam Paper Structure for Frontend "Exam Tab"
 * Groups individual detection results by their parent paper.
 */
export function buildExamPaperStructure(detectionResults: any[]) {
  const paperGroups = new Map<string, any>();
  let totalMarks = 0;

  detectionResults.forEach(dr => {
    const match = dr.detectionResult.match;
    if (!match) return;

    const paperKey = `${match.board}_${match.paperCode}_${match.examSeries}`;
    if (!paperGroups.has(paperKey)) {
      paperGroups.set(paperKey, {
        examBoard: match.board,
        examCode: match.paperCode,
        examSeries: match.examSeries,
        tier: match.tier || '',
        subject: match.subject || '',
        paperTitle: match.paperTitle,
        questions: [],
        totalMarks: 0
      });
    }

    const group = paperGroups.get(paperKey);
    // Add question if not already in this paper group
    const existingQ = group.questions.find((q: any) => q.questionNumber === match.questionNumber);
    if (!existingQ) {
      group.questions.push({
        questionNumber: match.questionNumber,
        questionText: match.databaseQuestionText || dr.question.text,
        marks: match.marks || 0,
        markingScheme: match.markingScheme?.questionMarks?.marks || []
      });
      group.totalMarks += (match.marks || 0);
      totalMarks += (match.marks || 0);
    }
  });

  const examPapers = Array.from(paperGroups.values());
  return {
    examPapers,
    multipleExamPapers: examPapers.length > 1,
    totalMarks
  };
}

/**
 * UTILITY: Generate Session Title from Detection Results
 * Creates a descriptive title like "Edexcel 1MA1/1F Nov 2023 Q1 to Q5"
 */
export function generateSessionTitleFromDetectionResults(detectionResults: any[], mode: 'Question' | 'Marking' = 'Marking'): string {
  if (!detectionResults || detectionResults.length === 0) return 'New Session';

  const validMatches = detectionResults.filter(dr => dr.detectionResult.found && dr.detectionResult.match);

  // Check if matches are just "Generic Question" mocks (not real past papers)
  const isGenericMatch = validMatches.some(dr => dr.detectionResult.match?.paperCode === 'Generic Question');

  if (validMatches.length === 0 || isGenericMatch) {
    // Fallback to non-past paper title logic if no matches found or if generic
    // Use parentText (main question) if available, else fallback to sub-question text
    const firstQ = detectionResults[0]?.question;
    const firstText = (firstQ as any)?.parentText || firstQ?.text;
    const cleanText = (firstText || '').trim().replace(/\n/g, ' ').replace(/\s+/g, ' ');
    const truncatedText = cleanText.length > 30 ? cleanText.substring(0, 30) + '...' : cleanText;
    return truncatedText ? `${mode} - ${truncatedText}` : `${mode} - New Session`;
  }


  // Find dominant paper
  const paperCounts = new Map<string, number>();
  validMatches.forEach(dr => {
    const title = dr.detectionResult.match.paperTitle;
    paperCounts.set(title, (paperCounts.get(title) || 0) + 1);
  });

  const topPaper = Array.from(paperCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];
  const firstMatch = validMatches.find(dr => dr.detectionResult.match.paperTitle === topPaper).detectionResult.match;

  // Get question range
  const qNums = validMatches
    .filter(dr => dr.detectionResult.match.paperTitle === topPaper)
    .map(dr => {
      const base = getBaseQuestionNumber(dr.question.questionNumber);
      return parseInt(base, 10);
    })
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b);

  let qRange = '';
  if (qNums.length === 1) {
    qRange = `Q${qNums[0]}`;
  } else if (qNums.length > 1) {
    const min = qNums[0];
    const max = qNums[qNums.length - 1];
    qRange = min === max ? `Q${min}` : `Q${min} to Q${max}`;
  }

  let board = firstMatch.board;
  if (board === 'Pearson Edexcel') board = 'Edexcel';

  return `${firstMatch.examSeries} ${firstMatch.paperCode} ${board} ${qRange}`.trim();
}

/**
 * UTILITY: Calculate total marks for a paper match
 */
export function calculateTotalMarks(match: any): number {
  if (!match) return 0;
  return match.marks || match.parentQuestionMarks || 0;
}

/**
 * Helper to get base question number for sorting/titling without importing utils to avoid cycles
 */
function getBaseQuestionNumber(qNum: string | null | undefined): string {
  if (!qNum) return '';
  const match = String(qNum).match(/^\d+/);
  return match ? match[0] : '';
}
