/**
 * Question Detection Service
 * Matches extracted question text with exam papers in the database
 * Refactored for:
 * 1. Question-Level Detection (Block Matching)
 * 2. Performance (Singleton Caching)
 * 3. Robustness (Containment Logic for Context Matches)
 */

import { getFirestore } from '../../config/firebase.js';
import { normalizeTextForComparison, normalizeSubQuestionPart, generateGenericTitleFromText } from '../../utils/TextNormalizationUtils.js';
import * as stringSimilarity from 'string-similarity';

// --- Constants ---
const COMMON_STOP_WORDS = new Set([
  'the', 'and', 'is', 'in', 'it', 'of', 'to', 'for', 'a', 'an', 'on', 'with', 'at', 'by',
  'from', 'up', 'down', 'out', 'that', 'this', 'write', 'down', 'answer', 'total', 'marks', 'question', 'show', 'give', 'your', 'reason', 'explain', 'state',
  'describe', 'value', 'table', 'graph', 'grid', 'space', 'left', 'blank',
  'work', 'find', 'calculate', 'solve', 'simplify', 'evaluate', 'complete', 'fill', 'draw', 'label'
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

      const isRescueMode = isNarrowSearch && primaryPapers.length <= 2;

      // 3. Metadata Setup
      const currentPoolSize = searchPool.reduce((sum, paper) => {
        const questions = paper.questions || {};
        return sum + (Array.isArray(questions) ? questions.length : Object.keys(questions).length);
      }, 0);

      if (cleanPaperHint) {
        // console.log(`[DETECTION] Q${questionNumberHint || '?'} -> Using paper hint: "${cleanPaperHint}" (Pool: ${searchPool.length} papers, ${currentPoolSize} candidates)`);
      } else {
        // console.log(`[DETECTION] Q${questionNumberHint || '?'} -> Global search (Pool: ${searchPool.length} papers, ${currentPoolSize} candidates)`);
      }

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

      // Log the top candidate for debugging
      if (candidates.length > 0) {
        const top = candidates[0];
        // console.log(`[DETECTION DEBUG] Q${questionNumberHint || '??'} Top Candidate: ${top.paper.metadata.exam_board} - ${top.paper.metadata.exam_code} Q${top.questionNumber}${top.subQuestionNumber || ''} (Score: ${top.score.toFixed(3)})`);
        // console.log(`[DETECTION DEBUG] Q${questionNumberHint || '??'} Input Text: "${extractedQuestionText.substring(0, 100)}..."`);
        // console.log(`[DETECTION DEBUG] Q${questionNumberHint || '??'} DB Text:    "${top.databaseText.substring(0, 100)}..."`);
      }

      // Populate Audit Trail (Top 5)
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

          if (isRelativeWinner && !isRescueMode && winner.score < strictThreshold) {
            console.log(`[DETECTION] 🏆 Relative Winner Accepted: ${winner.score.toFixed(3)} vs Runner-up ${runnerUp?.score.toFixed(3)}`);
          }

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

      if (hintBase && currentBase && hintBase !== currentBase) {
        continue;
      }

      // 2. CONSTRUCT AGGREGATE DB TEXT
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
          subQuestionNumber: '',
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
    dbSubPart: string | null,
    isRescueMode: boolean
  ): { total: number, text: number, numeric: number, structure: number, semanticCheck: boolean } {

    // 1. Text Similarity (WITH CONTAINMENT BOOST)
    // We check if one text is largely contained in the other to handle the Context Injection scenario.
    // E.g. "100 people... Complete Venn" (Input) vs "Complete Venn" (DB) -> High Match
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

      // Minimal debug for numeric match
      if (numericScore > 0 && numericScore < 1.0) {
        // console.log(`[NUMERIC DEBUG] Input Nums: [${inputNums.slice(0, 10).join(', ')}]`);
        // console.log(`[NUMERIC DEBUG] DB Nums:    [${dbNums.slice(0, 10).join(', ')}]`);
        // console.log(`[NUMERIC DEBUG] Intersection: ${intersection.length} / ${Math.max(inputNums.length, dbNums.length)} = ${numericScore.toFixed(3)}`);
      }
    } else if (dbNums.length === 0 && inputNums.length === 0) {
      numericScore = 0.5;
    }

    // 4. Structural Match
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

    // FIX: Don't strip unknown LaTeX commands, just remove the backslash so they count as keywords (e.g. "alpha", "beta")
    clean = clean.replace(/\\/g, ' ').replace(/[^a-z0-9\s]/g, '').trim();
    return new Set(clean.split(/\s+/).filter(w => w.length > 3 && !COMMON_STOP_WORDS.has(w)));
  }

  private constructMatchResult(candidate: MatchCandidate, isRescueMode: boolean): ExamPaperMatch {
    const { paper, questionData, questionNumber, databaseText, score } = candidate;
    const meta = paper.metadata || {};
    const parentMarks = questionData.marks || 0;

    const board = meta.exam_board || meta.board;
    const code = meta.exam_code || meta.code;
    const series = meta.exam_series || meta.series;
    const tier = meta.tier;
    const subject = meta.subject;
    const qualification = meta.qualification || meta.subject;

    // Extract sub-question max scores AND texts from database JSON
    const subQuestionMaxScores: { [key: string]: number } = {};
    const subQuestionTexts: { [key: string]: string } = {};
    const subQuestions = questionData.sub_questions || questionData.subQuestions || [];
    if (Array.isArray(subQuestions)) {
      subQuestions.forEach((sq: any) => {
        const part = sq.question_part || sq.part || sq.label || sq.sub_question_number || sq.number;
        if (part) {
          if (sq.marks !== undefined) {
            subQuestionMaxScores[String(part)] = Number(sq.marks);
          }
          if (sq.question_text || sq.text) {
            subQuestionTexts[String(part)] = sq.question_text || sq.text;
          }
        }
      });
    }

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

  // [UPDATED] Robust Similarity with Containment Boost
  public calculateSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;

    // 1. Precise Match Check
    const norm1 = normalizeTextForComparison(str1);
    const norm2 = normalizeTextForComparison(str2);
    if (norm1 === norm2) return 1.0;

    // 2. Keyword Match (Fuzzy Containment)
    const keys1 = this.getKeywords(str1);
    const keys2 = this.getKeywords(str2);

    // We check if the shorter set of keywords is contained in the longer set
    const shorterKeys = keys1.size < keys2.size ? keys1 : keys2;
    const longerKeys = keys1.size >= keys2.size ? keys1 : keys2;

    if (shorterKeys.size >= 2) {
      let matches = 0;
      const matchedWords: string[] = [];
      const missingWords: string[] = [];

      for (const word of shorterKeys) {
        if (longerKeys.has(word)) {
          matches++;
          matchedWords.push(word);
        } else {
          missingWords.push(word);
        }
      }

      const matchRate = matches / shorterKeys.size;

      // LOG THE FUZZY ATTEMPT
      if (matchRate > 0.45) {
        // console.log(`[SIMILARITY DEBUG] Fuzzy Rate: ${matchRate.toFixed(2)} (${matches}/${shorterKeys.size})`);
      }

      // FAILURE ANALYSIS (2025-01-21):
      // A 100% match on 3 common math keys (e.g. "fraction", "root", "form") is NOT enough to prove identity.
      // Small generic questions (e.g. "Work out the value") often strip down to just these few keys.
      // We must require a minimum complexity (key count) to trust a pure keyword containment match.
      const MIN_KEYS_FOR_OVERRIDE = 5;

      if (shorterKeys.size < MIN_KEYS_FOR_OVERRIDE) {
        // console.log(`[SIMILARITY SAFETY] Key count (${shorterKeys.size}) < ${MIN_KEYS_FOR_OVERRIDE}. Ignoring containment override.`);
        // Fall through to Dice Coefficient
      } else {
        if (matchRate >= 0.80) {
          // [SENIOR PROTOCOL] Log why we are returning a high score
          console.log(`[SIMILARITY OVERRIDE] 98% because MatchRate=${matchRate.toFixed(2)} in Keys=[${Array.from(shorterKeys).join(',')}]`);
          return 0.98;
        }
        if (matchRate >= 0.60) {
          console.log(`[SIMILARITY OVERRIDE] 85% because MatchRate=${matchRate.toFixed(2)}`);
          return 0.85;
        }
      }
    }

    // 3. Fallback to Dice
    const dice = stringSimilarity.compareTwoStrings(norm1, norm2);
    return dice;
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

        const questions = markingScheme.questions;
        const baseNum = qNum.match(/^\d+/)?.[0] || qNum;
        const mainQ = questions[qNum];

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

      examPaperGroups.set(paperKey, {
        examBoard: board,
        examCode: code,
        examSeries: series,
        tier: tier,
        subject: subject,
        // paperTitle logic consolidated
        paperTitle: `${board} ${subject} ${code} (${series})${tier ? ` ${tier}` : ''}`,
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

    // markingScheme: adapt plain text if it exists (for compatibility)
    let markingSchemeEntries = [];
    if (match.markingScheme?.questionMarks) {
      // Complex object case - handling by conversion or direct assign
      markingSchemeEntries = [{ mark: 'Model', answer: 'See scheme details' }];
    } else if (dr.detectionResult.markingScheme && typeof dr.detectionResult.markingScheme === 'string') {
      markingSchemeEntries = [{ mark: 'Model', answer: dr.detectionResult.markingScheme }];
    }

    paperGroup.questions.push({
      questionNumber: String(questionNumber),
      questionText: questionText,
      marks: marks,
      markingScheme: markingSchemeEntries
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

  // Paper Title: Use the first paper's details
  const p = examPapers[0];
  const board = p.examBoard === 'Pearson Edexcel' ? 'Edexcel' : p.examBoard;

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

  return `${board} ${p.subject} ${p.examCode} (${p.examSeries})${qRange} ${totalMarks} marks`;
}

/**
 * Simple total marks calculator
 */
export function calculateTotalMarks(detectionResults: any[]): number {
  return detectionResults.reduce((sum, dr) => sum + (dr.detectionResult?.match?.marks || 0), 0);
}

export const questionDetectionService = QuestionDetectionService.getInstance();
