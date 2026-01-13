/**
 * Question Detection Service
 * Matches extracted question text with exam papers in the database
 * Refactored for:
 * 1. High-Precision Global Search (Semantic Anchoring + Gated Scoring)
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
  'frac': 'fraction',
  'sqrt': 'root',
  'approx': 'estimate',
  'pi': 'circle',
  'angle': 'angle',
  'triangle': 'triangle',
  'int': 'integral',
  'sum': 'sum',
  'lim': 'limit',
  'vec': 'vector'
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

  /**
   * Main Entry Point
   */
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
        const paperCandidates = this.findCandidatesInPaper(cleanText, paper, cleanQHint, isRescueMode);
        candidates = candidates.concat(paperCandidates);
      }

      // 5. Ranking & Sorting
      candidates.sort((a, b) => b.score - a.score);

      // Populate Audit Trail (Top 5)
      hintMetadata.auditTrail = candidates.slice(0, 5).map((c, idx) => ({
        rank: idx + 1,
        candidateId: `${c.paper.metadata.exam_code} Q${c.questionNumber}${c.subQuestionNumber}`,
        score: parseFloat(c.score.toFixed(3)),
        scoreBreakdown: `Txt:${c.scoreDetails.text.toFixed(2)} Num:${c.scoreDetails.numeric.toFixed(2)} Str:${c.scoreDetails.structure.toFixed(2)} Sem:${c.scoreDetails.semanticCheck ? 'PASS' : 'FAIL'}`,
        reason: c.scoreDetails.semanticCheck ? 'Valid' : 'Semantic Fail'
      }));

      // 6. Thresholding & Selection
      if (candidates.length > 0) {
        const winner = candidates[0];

        // --- DYNAMIC THRESHOLD LOGIC ---
        const isSubQ = !!winner.subQuestionNumber;

        // STRICT GLOBAL THRESHOLDS (Requested: 0.80 Main, 0.70 Sub)
        // These ensure non-past papers return "No Match" rather than hallucinations
        const strictThresholds = [0.80, 0.70];

        // Rescue Thresholds (Consensus Mode)
        const rescueThresholds = [0.40, 0.35];

        const [mainThresh, subThresh] = isRescueMode ? rescueThresholds : strictThresholds;
        const requiredThreshold = isSubQ ? subThresh : mainThresh;

        // Additional Safety for Global Search
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
            message: `Matched ${matchResult.paperCode} Q${matchResult.questionNumber}${matchResult.subQuestionNumber || ''}`,
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

  /**
   * Scans a single paper for all potential question matches
   */
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
      const qText = (qData.question_text || qData.text || qData.question || '');
      const subQuestions = qData.sub_questions || qData.subQuestions || [];

      // A. Hierarchical Filtering (Base Number Check)
      const hintBase = hintQNum ? hintQNum.match(/^\d+/)?.[0] : null;
      const currentBase = qNum.match(/^\d+/)?.[0];

      if (hintBase && currentBase && hintBase !== currentBase) {
        continue;
      }

      // B. Sub-Question Matching
      if (subQuestions.length > 0) {
        for (const subQ of subQuestions) {
          const partIdentifier = subQ.question_part || subQ.part || subQ.label || subQ.sub_question_number || subQ.number;
          if (!partIdentifier) continue;

          const subPart = String(partIdentifier);
          const subText = subQ.text || subQ.question || subQ.question_text || subQ.sub_question || '';

          const scoreDetails = this.calculateHybridScore(inputQueryText, subText, hintQNum, qNum, subPart, isRescueMode);

          if (scoreDetails.total > 0.15) {
            candidates.push({
              paper,
              questionData: qData,
              questionNumber: qNum,
              subQuestionNumber: subPart,
              databaseText: subText,
              score: scoreDetails.total,
              scoreDetails
            });
          }
        }
      }

      // C. Main Question Matching
      if (qText) {
        const scoreDetails = this.calculateHybridScore(inputQueryText, qText, hintQNum, qNum, null, isRescueMode);

        if (scoreDetails.total > 0.15) {
          candidates.push({
            paper,
            questionData: qData,
            questionNumber: qNum,
            subQuestionNumber: '',
            databaseText: qText,
            score: scoreDetails.total,
            scoreDetails
          });
        }
      }
    }

    return candidates;
  }

  /**
   * Advanced Weighted Scoring Engine with Semantic Anchoring
   */
  private calculateHybridScore(
    inputText: string,
    dbText: string,
    hint: string | null,
    dbQNum: string,
    dbSubPart: string | null,
    isRescueMode: boolean
  ): { total: number, text: number, numeric: number, structure: number, semanticCheck: boolean } {

    // 1. Text Similarity (Dice + N-Grams)
    const textScore = this.calculateSimilarity(inputText, dbText);

    // 2. Semantic Anchoring (Keyword Overlap)
    // Enhanced with Math-aware keyword extraction
    const inputKeywords = this.getKeywords(inputText);
    const dbKeywords = this.getKeywords(dbText);

    let semanticCheck = false;
    // Neutral pass for very short text
    if (inputKeywords.size < 2 || dbKeywords.size < 2) {
      semanticCheck = true;
    } else {
      // Check for at least ONE significant shared word
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

    // 4. Structural Match (Hint Validation)
    let structureScore = 0;
    if (hint) {
      const hintBase = hint.match(/^\d+/)?.[0];
      const hintPart = normalizeSubQuestionPart(hint.replace(/^\d+/, ''));
      const dbBase = dbQNum.match(/^\d+/)?.[0];
      const dbPart = normalizeSubQuestionPart(dbSubPart);

      if (hintBase === dbBase) {
        structureScore += 0.5;
        if (hintPart && dbPart) {
          if (hintPart === dbPart) structureScore += 0.5;
          else {
            // Soft match for roman/alpha confusion
            const hintNoRoman = hintPart.replace(/[ivx]+$/i, '');
            const hintRomanOnly = hintPart.replace(/^[a-z]/i, '');
            if (hintNoRoman === dbPart || hintRomanOnly === dbPart) structureScore += 0.4;
          }
        } else if (!hintPart && !dbPart) {
          structureScore += 0.5;
        }
      }
    } else {
      structureScore = 0.5;
    }

    // --- WEIGHTING STRATEGY ---
    let total = 0;

    // Gated Structure: Structure score is IGNORED if text is garbage (unless in Rescue Mode)
    const textFloor = isRescueMode ? 0.15 : 0.25;
    const effectiveStructureScore = (textScore < textFloor && numericScore < 0.5) ? 0 : structureScore;

    if (effectiveStructureScore >= 0.9) {
      // High Structure Confidence
      total = (textScore * 0.45) + (numericScore * 0.25) + (effectiveStructureScore * 0.30);
    } else {
      // Content-Heavy Weighting
      total = (textScore * 0.60) + (numericScore * 0.30) + (effectiveStructureScore * 0.10);
    }

    // Semantic Penalty
    // If not in Rescue Mode, and keywords don't match, reduce score by 60%
    if (!isRescueMode && !semanticCheck) {
      total = total * 0.4;
    }

    return { total, text: textScore, numeric: numericScore, structure: effectiveStructureScore, semanticCheck };
  }

  // Math-Aware Keyword Extraction
  private getKeywords(text: string): Set<string> {
    if (!text) return new Set();

    // Pre-processing to convert LaTeX logic to semantic English words
    let clean = text.toLowerCase();

    // Replace common LaTeX math commands with english anchors
    Object.entries(LATEX_SEMANTIC_MAP).forEach(([cmd, replacement]) => {
      // Matches \frac, \sqrt, etc.
      const regex = new RegExp(`\\\\${cmd}`, 'g');
      clean = clean.replace(regex, ` ${replacement} `);
    });

    clean = clean
      .replace(/\\[a-z]+/g, ' ') // Remove remaining latex commands
      .replace(/[^a-z0-9\s]/g, '') // Remove punctuation
      .trim();

    return new Set(clean.split(/\s+/).filter(w => w.length > 3 && !COMMON_STOP_WORDS.has(w)));
  }

  private constructMatchResult(candidate: MatchCandidate, isRescueMode: boolean): ExamPaperMatch {
    const { paper, questionData, questionNumber, subQuestionNumber, databaseText, score } = candidate;
    const meta = paper.metadata;

    const parentMarks = questionData.marks || 0;
    let specificMarks = subQuestionNumber ? 0 : parentMarks;

    if (subQuestionNumber) {
      const subs = questionData.sub_questions || questionData.subQuestions || [];
      const subQ = subs.find((s: any) => {
        const p = s.question_part || s.part || s.label || s.sub_question_number || s.number;
        return String(p) === subQuestionNumber;
      });
      if (subQ && subQ.marks !== undefined) specificMarks = subQ.marks;
    }

    return {
      board: meta.exam_board,
      qualification: meta.qualification || meta.subject,
      paperCode: meta.exam_code,
      examSeries: meta.exam_series,
      tier: meta.tier,
      subject: meta.subject,
      questionNumber: questionNumber,
      subQuestionNumber: subQuestionNumber || undefined,
      marks: specificMarks,
      parentQuestionMarks: parentMarks,
      confidence: score,
      paperTitle: `${meta.exam_board} - ${meta.exam_code} - ${meta.exam_series}${meta.tier ? `, ${meta.tier}` : ''}`,
      examPaper: paper,
      databaseQuestionText: databaseText,
      isRescued: isRescueMode && score < 0.8 // Flag if it was a sub-threshold rescue
    };
  }

  private sanitizeQuestionHint(hint: string | undefined | null): string | null {
    if (!hint) return null;
    if (hint === '1') return null;

    let clean = hint.toLowerCase().trim();
    if (clean === 'l') clean = '1';
    return clean;
  }

  // --- Public wrapper for legacy support / Orchestrator calls ---
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
      const threshold = isRescueMode ? 0.35 : 0.80; // Apply strict threshold here too
      if (winner.score >= threshold) {
        return this.constructMatchResult(winner, isRescueMode);
      }
      return this.constructMatchResult(winner, isRescueMode);
    }
    return null;
  }

  // --- Existing Helper Methods (Preserved) ---

  private filterPapersByHint(papers: any[], hint: string): any[] {
    const normalizedHint = hint.toLowerCase().trim();
    if (!normalizedHint) return papers;

    let processedHint = normalizedHint;
    if (processedHint.includes('edexcel') && processedHint.includes('may')) {
      processedHint = processedHint.replace(/\bmay\b/gi, 'june');
    } else if (processedHint.includes('may')) {
      processedHint = processedHint.replace(/\bmay\b/gi, 'june');
    }

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

    // Check Cache
    const now = Date.now();
    if (QuestionDetectionService.cachedPapers && (now - QuestionDetectionService.lastCacheTime < QuestionDetectionService.CACHE_TTL)) {
      return QuestionDetectionService.cachedPapers;
    }

    try {
      // console.log('[QuestionDetectionService] 🔄 Fetching papers from Firestore (Cache Miss/Expired)...');
      const snapshot = await this.db.collection('fullExamPapers').get();
      const papers: any[] = [];
      snapshot.forEach((doc: any) => papers.push({ id: doc.id, ...doc.data() }));

      // Update Cache
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
        let flatKey = qNum;
        if (examPaperMatch.subQuestionNumber) {
          const sub = normalizeSubQuestionPart(examPaperMatch.subQuestionNumber);
          flatKey = `${qNum}${sub}`;
        }

        const questions = markingScheme.questions;
        const mainQ = questions[flatKey];
        const altQ = questions[`${flatKey}alt`];

        if (mainQ && altQ) {
          questionMarks = { main: mainQ, alt: altQ, hasAlternatives: true };
        } else if (mainQ) {
          questionMarks = mainQ;
        } else if (altQ) {
          questionMarks = altQ;
        } else {
          if (!examPaperMatch.subQuestionNumber) {
            const subKeys = Object.keys(questions).filter(k => {
              const m = k.match(/^(\d+)([a-z]+)$/i);
              return m && m[1] === qNum;
            }).sort();

            if (subKeys.length > 0) {
              const compAnswers: string[] = [];
              const compMarks: any[] = [];
              const compGuidance: any[] = [];

              subKeys.forEach(k => {
                const s = questions[k];
                const lbl = k.replace(qNum, '');
                compAnswers.push(`(${lbl}) ${s.answer}`);
                if (s.marks) s.marks.forEach((m: any) => compMarks.push({ ...m, mark: `[${lbl}] ${m.mark}` }));
                if (s.guidance) compGuidance.push(...s.guidance);
              });

              questionMarks = {
                answer: compAnswers.join('\n'),
                marks: compMarks,
                guidance: compGuidance,
                isComposite: true
              };
              return {
                id: markingScheme.id,
                examDetails: markingScheme.examDetails,
                questionMarks,
                totalQuestions: Object.keys(questions).length,
                totalMarks: 0,
                confidence: 1.0,
                generalMarkingGuidance: markingScheme.generalMarkingGuidance
              };
            }
          }
          return null;
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

// --- Utils Exports (Preserved) ---

export function calculateTotalMarks(detectionResults: any[]): number {
  const marksMap = new Map<string, number>();
  detectionResults.forEach(dr => {
    const baseNum = String(dr.question.questionNumber).replace(/[a-z()]+$/i, '');
    if (!marksMap.has(baseNum)) {
      const parentMarks = dr.detectionResult.match?.parentQuestionMarks || 0;
      marksMap.set(baseNum, parentMarks);
    }
  });
  return Array.from(marksMap.values()).reduce((sum, marks) => sum + marks, 0);
}

export function extractStructuredMarks(scheme: any): Array<{ mark: string; answer: string; comments?: string }> {
  if (!scheme) return [];
  let marksArray: any[] = [];
  if (scheme.questionMarks) {
    if (Array.isArray(scheme.questionMarks.marks)) marksArray = scheme.questionMarks.marks;
    else if (Array.isArray(scheme.questionMarks)) marksArray = scheme.questionMarks;
    else if (scheme.questionMarks.isComposite && Array.isArray(scheme.questionMarks.marks)) marksArray = scheme.questionMarks.marks;
  } else if (Array.isArray(scheme.marks)) marksArray = scheme.marks;
  else if (Array.isArray(scheme)) marksArray = scheme;

  return marksArray.map((m: any) => ({
    mark: m.mark || '',
    answer: m.answer || '',
    comments: m.comments || m.guidance || undefined
  }));
}

export function buildExamPaperStructure(detectionResults: any[]): { examPapers: any[]; multipleExamPapers: boolean; totalMarks: number; } {
  const examPaperGroups = new Map<string, any>();
  detectionResults.forEach((qd) => {
    const detectionObj = qd.detection || qd.detectionResult;
    if (!detectionObj || !detectionObj.match) return;
    const match = detectionObj.match;
    const key = `${match.board}_${match.paperCode}_${match.examSeries}_${match.tier}`;

    if (!examPaperGroups.has(key)) {
      const metadata = extractExamMetadata(match);
      examPaperGroups.set(key, {
        examBoard: metadata.examBoard,
        examCode: metadata.examCode,
        examSeries: metadata.examSeries,
        tier: metadata.tier,
        subject: metadata.subject,
        paperTitle: `${match.board} ${match.qualification} ${match.paperCode} (${match.examSeries})`,
        questions: [],
        totalMarks: 0
      });
    }
    const examPaper = examPaperGroups.get(key)!;
    examPaper.questions.push({
      questionNumber: qd.classificationQuestionNumber || qd.question?.questionNumber || match.questionNumber || '',
      questionText: match.databaseQuestionText || qd.questionText,
      marks: match.marks || 0,
      markingScheme: extractStructuredMarks(match.markingScheme),
      questionIndex: qd.questionIndex,
      sourceImageIndex: qd.sourceImageIndex
    });
  });
  const totalMarks = calculateTotalMarks(detectionResults);
  examPaperGroups.forEach(ep => ep.totalMarks = totalMarks);
  return { examPapers: Array.from(examPaperGroups.values()), multipleExamPapers: examPaperGroups.size > 1, totalMarks };
}

export function generateSessionTitleFromDetectionResults(detectionResults: any[]): string {
  if (!detectionResults || detectionResults.length === 0) return 'Question - No exam paper detected';
  const { examPapers, totalMarks } = buildExamPaperStructure(detectionResults);
  if (examPapers.length === 0) return 'Question - No exam paper detected';
  if (examPapers.length > 1) {
    const allQs = examPapers.flatMap(ep => ep.questions.map(q => q.questionNumber));
    return `Past paper - ${allQs.map(q => `Q${q}`).join(', ')}`;
  }
  const examPaper = examPapers[0];
  if (examPaper.questions.length === 0) return 'Question - No questions detected';

  const qNums = examPaper.questions.map(q => parseInt(String(q.questionNumber).replace(/[a-z()]+$/i, ''), 10)).filter(n => !isNaN(n) && n > 0).sort((a, b) => a - b);
  const uniq = Array.from(new Set(qNums));
  let display: string;
  if (uniq.length === 0) display = 'Unknown';
  else if (uniq.length === 1) display = `Q${uniq[0]}`;
  else {
    const isSeq = uniq.every((n, i) => i === 0 || n === (uniq[i - 1] as number) + 1);
    display = isSeq ? `Q${uniq[0]} to Q${uniq[uniq.length - 1]}` : uniq.map(n => `Q${n}`).join(', ');
  }

  let { examBoard, subject, examCode, examSeries } = examPaper;
  if (examBoard === 'Pearson Edexcel') examBoard = 'Edexcel';
  if (subject && subject.toLowerCase() === 'mathematics') subject = 'Maths';

  if (examBoard && examCode && examSeries) return `${examSeries} ${examCode} ${examBoard} ${display} ${totalMarks} marks`;
  return `Past paper ${display} ${totalMarks} marks`;
}

export const questionDetectionService = QuestionDetectionService.getInstance();
