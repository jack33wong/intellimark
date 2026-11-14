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
  isGeneric?: boolean;
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
  subQuestionMaxScores?: { [key: string]: number };
}

export interface QuestionDetectionResult {
  found: boolean;
  isModifiedQuestion?: boolean;
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

  // Singleton Cache for Exam Papers & Marking Schemes
  private static cachedPapers: any[] | null = null;
  private static lastCacheTime: number = 0;
  private static papersFetchPromise: Promise<any[]> | null = null;
  private static cachedSchemes: any[] | null = null;
  private static lastSchemesCacheTime: number = 0;
  private static schemesFetchPromise: Promise<any[]> | null = null;
  private static cachedExaminerReports: any[] | null = null;
  private static lastExaminerReportsCacheTime: number = 0;
  private static examinerReportsFetchPromise: Promise<any[]> | null = null;
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

  public static invalidateSchemesCache(): void {
    QuestionDetectionService.cachedSchemes = null;
    QuestionDetectionService.lastSchemesCacheTime = 0;
  }

  public static invalidatePapersCache(): void {
    QuestionDetectionService.cachedPapers = null;
    QuestionDetectionService.lastCacheTime = 0;
  }

  public async getMarkingSchemesList(): Promise<any[]> {
    return this.getAllMarkingSchemes();
  }

  public async getExamPapersList(): Promise<any[]> {
    return this.getAllExamPapers();
  }

  public async detectQuestion(
    extractedQuestionText: string,
    questionNumberHint?: string | null,
    examPaperHint?: string | null,
    detectionOptions?: { allowCroppedQ1Exemption?: boolean }
  ): Promise<QuestionDetectionResult> {
    try {
      console.log('🚨 [HINT CHECK] Received Hint:', examPaperHint);
      // 1. Input Sanitization
      // console.log(`[DEBUG_INPUT_CAPTURE] detectQuestion Input for ${questionNumberHint}:`, extractedQuestionText);
      const cleanText = (extractedQuestionText || '').trim();
      const cleanQHint = this.sanitizeQuestionHint(questionNumberHint);
      const cleanPaperHint = (examPaperHint || '').trim();

      if (/general\s+rubric|no\s+official\s+marking\s+scheme|generic\s+mode/i.test(cleanPaperHint)) {
        return { found: false, message: 'Generic Rubric Mode active — skipping DB paper lookup' };
      }

      if (cleanText.length === 0 && !cleanQHint) {
        return { found: false, message: 'No question text provided' };
      }

      // 2. Paper Retrieval & Filtering (Cached)
      const allExamPapers = await this.getAllExamPapers();
      const primaryPapers = cleanPaperHint
        ? this.filterPapersByHint(allExamPapers, cleanPaperHint)
        : [];

      const hintSeries = cleanPaperHint ? this.extractSeriesHint(cleanPaperHint) : { year: null, season: null };
      if (cleanPaperHint && hintSeries.year && primaryPapers.length === 0) {
        return {
          found: false,
          message: `No exam paper found for specified series/year (${hintSeries.year})`,
          hintMetadata: {
            hintUsed: cleanPaperHint,
            matchedPapersCount: 0,
            thresholdRelaxed: false,
            deepSearchActive: false,
            poolSize: 0,
            auditTrail: []
          }
        };
      }

      const isNarrowSearch = primaryPapers.length > 0;
      const searchPool = isNarrowSearch ? primaryPapers : allExamPapers;

      const isRescueMode = isNarrowSearch && primaryPapers.length <= 2;
      const allowCroppedQ1Exemption = detectionOptions?.allowCroppedQ1Exemption ?? true;

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
        const paperCandidates = this.findCandidatesInPaper(cleanText, paper, cleanQHint, isRescueMode, allowCroppedQ1Exemption);
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
          // 🛡️ GLOBAL SEARCH PROTECTION
          // Prevent a random paper from hijacking the session just because it's the "best of the worst"
          // If it's a global search and relying on relative confidence, demand a minimum text score.
          if (!isNarrowSearch && isRelativeWinner && winner.score < strictThreshold) {
             shouldAccept = winner.scoreDetails.text >= 0.50; 
          } else {
             shouldAccept = (winner.score >= strictThreshold) || isRelativeWinner;
          }
        }

        const minimumTextScore = isRescueMode ? 0.15 : 0.25;
        // Distinguish teacher-modified question vs. OCR/extraction failure:
        // If extracted text is substantial (>= 100 chars) yet text similarity is still < 0.50,
        // the question was rewritten/modified — do NOT force-attach an outdated official scheme.
        const isLikelyModifiedQuestion = isRescueMode && cleanText.length >= 100 && winner.scoreDetails.text < 0.50;

        if (shouldAccept && winner.scoreDetails.text >= minimumTextScore && !isLikelyModifiedQuestion) {

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
            // Always merge markingScheme.subQuestionMaxScores (authoritative canonical keys e.g. "2.2": 4)
            // on top of any paper-derived subQuestionMaxScores (relative keys e.g. "2": 4)
            if (markingScheme.subQuestionMaxScores) {
              matchResult.subQuestionMaxScores = {
                ...(matchResult.subQuestionMaxScores || {}),
                ...markingScheme.subQuestionMaxScores
              };
            }
            // Ensure subject is always populated from the official markingScheme if missing on the paper
            if (!matchResult.subject && markingScheme.examDetails?.subject) {
              matchResult.subject = markingScheme.examDetails.subject;
            }
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
      const topCandidate = candidates[0];
      const isModified = Boolean(
        isRescueMode &&
        topCandidate &&
        cleanText.length >= 100 &&
        topCandidate.scoreDetails.text < 0.50
      );
      return {
        found: false,
        ...(isModified ? { isModifiedQuestion: true } : {}),
        message: isModified
          ? 'Question appears modified vs. official paper — falling back to generic rubric'
          : (candidates.length > 0 ? 'Matches found but below confidence threshold' : 'No matching questions found'),
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
    isRescueMode: boolean,
    allowCroppedQ1Exemption: boolean = true
  ): MatchCandidate[] {
    const candidates: MatchCandidate[] = [];
    const questions = paper.questions || {};

    const questionIterator = Array.isArray(questions)
      ? questions.map(q => ({ num: String(q.question_number || q.number), data: q }))
      : Object.entries(questions).map(([k, v]) => ({ num: String((v as any).question_number || k), data: v }));

    for (const { num: qNum, data: qData } of questionIterator) {
      // [REMOVED THE HARD SKIP CONTINUATION LOOP]
      // We no longer skip candidates based on mismatched numbers. 
      // We rely entirely on the scoring engine to filter them out safely.

      // 2. CONSTRUCT AGGREGATE DB TEXT
      const parentText = (qData.question_text || qData.text || qData.question || '').trim();
      let searchAggregateText = parentText + ' ';

      const subQuestions = qData.sub_questions || qData.subQuestions || [];
      if (Array.isArray(subQuestions)) {
        searchAggregateText += subQuestions.map((sq: any) =>
          (sq.text || sq.question || sq.question_text || sq.sub_question || '')
        ).join(' ');
      }

      // 3. COMPARE BLOCKS
      const scoreDetails = this.calculateHybridScore(inputQueryText, searchAggregateText, hintQNum, qNum, isRescueMode, allowCroppedQ1Exemption);

      // 4. THRESHOLD
      if (scoreDetails.total > 0.15) {
        candidates.push({
          paper,
          questionData: qData,
          questionNumber: qNum,
          subQuestionNumber: '',
          databaseText: parentText, 
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
    isRescueMode: boolean,
    allowCroppedQ1Exemption: boolean = true
  ): { total: number, text: number, numeric: number, structure: number, semanticCheck: boolean } {

    const details = SimilarityService.calculateQuestionHybridScore(inputText, dbText, isRescueMode);

    // 1. Standard Structural Match
    let structureScore = 0.5; // Neutral default
    
    // 🛡️ THE FIX: Define safeguard for hallucinated "1"s (single-question crops only) and track explicit conflicts
    const hintBase = hint ? hint.match(/^\d+/)?.[0]?.replace(/^0+(?=\d)/, '') : null;
    const isLikelyCroppedDefault = hintBase === "1" && allowCroppedQ1Exemption && !isRescueMode;
    let explicitNumberConflict = false; 

    if (hint) {
      const dbBase = dbQNum.match(/^\d+/)?.[0]?.replace(/^0+(?=\d)/, '');
      
      if (hintBase === dbBase) {
        structureScore = 1.0;
      } else if (isLikelyCroppedDefault) {
        // 🌟 OCR EXEMPTION: Give breathing room if the AI likely hallucinated "1" due to cropping
        structureScore = 0.5;
      } else {
        // The hint is NOT '1' and it does NOT match the DB. This is a definitive conflict.
        structureScore = 0.0;
        explicitNumberConflict = true; 
      }
    }

    const isDefinitiveTextMatch = details.text >= 0.85;
    let finalTotal = (details.total * 0.7) + (structureScore * 0.3);

    // 🛡️ [CONTENT-LOCK]: Stop math coincidence matching
    if (structureScore > 0.8 && details.text < 0.50) {
      finalTotal *= 0.4; 
    }

    // 🛡️ THE FIX: Strict Conflict Handling
    if (explicitNumberConflict) {
      if (!isRescueMode) {
        // HARD REJECT: In Global Search, a hard number mismatch (e.g. Q3 vs Q8) is a guaranteed fail.
        finalTotal = 0; 
      } else {
        // PENALTY: Heavily penalize in Rescue Mode to prevent overwriting other valid questions.
        finalTotal *= 0.1;
      }
    } else {
      // 🏆 CROWN THE WINNER (Only if NO explicit conflict exists)
      if (isDefinitiveTextMatch && structureScore === 0.0) {
        finalTotal = details.total; 
      }
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
    const rawMarks = questionData.marks ?? questionData.question_marks ?? questionData.max_marks ?? questionData.max_question_marks ?? questionData.total_marks ?? 0;
    const parentMarks = Number(rawMarks) || 0;

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
    if (hint === null || hint === undefined) return null;
    
    // Safely cast to string to handle unexpected types, then normalize
    let clean = String(hint).toLowerCase().trim();
    
    // 🛡️ Destroy stringified nulls, undefineds, or empty strings
    if (clean === 'null' || clean === 'undefined' || clean === '') {
      return null;
    }
    
    if (clean === 'l') clean = '1';
    clean = clean.replace(/^0+(?=\d)/, '');
    
    // 🛡️ CROPPED IMAGE SAFEGUARD: 
    // If the upstream mapper replaces null with a placeholder like "General" or "?",
    // destroy it. A valid question hint MUST contain at least one digit.
    if (!/\d/.test(clean)) {
      return null;
    }
    
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
  private extractSeriesHint(text: string): { year: string | null; season: string | null } {
    const lower = (text || '').toLowerCase();
    let year: string | null = null;
    const fullYearMatch = lower.match(/\b(20\d{2})\b/);
    if (fullYearMatch) {
      year = fullYearMatch[1];
    } else {
      const shortYearMatch = lower.match(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|summer|winter|autumn|spring)[-/\s]*(\d{2})\b/);
      if (shortYearMatch) {
        year = `20${shortYearMatch[1]}`;
      }
    }

    let season: string | null = null;
    if (/\b(june?|may|summer)\b/.test(lower)) season = 'summer';
    else if (/\bnov(?:ember)?\b/.test(lower)) season = 'november';
    else if (/\bjan(?:uary)?\b/.test(lower)) season = 'january';

    return { year, season };
  }

  private filterPapersByHint(papers: any[], hint: string): any[] {
    const normalizedHint = hint.toLowerCase().trim();
    if (!normalizedHint) return papers;
    
    const normalizeForSearch = (t: string) => {
      return (t || '').toLowerCase()
        .replace(/\bmathematics\b/g, 'maths')
        .replace(/\b(june|may|summer|jun)\b/g, 'summer')
        .replace(/\bnov\b/g, 'november')
        .replace(/\bjan\b/g, 'january')
        .replace(/([a-z]+)(20\d{2})\b/g, '$1 $2') // e.g. "jun2025" -> "jun 2025"
        .replace(/[-,/]/g, ' ')
        .trim();
    };

    // Extract explicit 4+ char paper code root if present in the hint (e.g. "8462" from "8462/1H", "1MA1" from "1MA1/2H")
    const codePrefixMatch = normalizedHint.match(/\b([0-9]{4}|[0-9][a-z]{2}[0-9]|[a-z][0-9]{3})(?:\/[0-9a-z]+)?\b/i);
    const requiredCodePrefix = codePrefixMatch ? codePrefixMatch[1].toLowerCase() : null;
    const { year: requiredYear, season: requiredSeason } = this.extractSeriesHint(normalizedHint);

    const processedHint = normalizeForSearch(normalizedHint);
    const rawKeywords = processedHint.split(/\s+/).filter(k => k.length > 0 && /[a-z0-9]/i.test(k));
    if (rawKeywords.length === 0) return [];

    // 1. Score each paper based on weighted keyword matches
    const scoredPapers = papers.map(paper => {
      const metadata = paper.metadata;
      if (!metadata) return { paper, score: 0 };

      // Hard-block cross-subject paper code collisions (e.g. hint "8462/1H" must NEVER match DB paper "8461/1H" on "/1H")
      if (requiredCodePrefix) {
        const dbCode = String(metadata.exam_code || metadata.paper_code || '').toLowerCase();
        if (dbCode && !dbCode.includes(requiredCodePrefix)) {
          return { paper, score: 0 };
        }
      }

      // Hard-block mismatched exam year/series when explicitly present in the hint (e.g. Jun26 must NEVER match June 2025)
      if (requiredYear || requiredSeason) {
        const dbSeries = this.extractSeriesHint(String(metadata.exam_series || paper.exam_series || ''));
        if (requiredYear && dbSeries.year && dbSeries.year !== requiredYear) {
          return { paper, score: 0 };
        }
        if (requiredSeason && dbSeries.season && dbSeries.season !== requiredSeason) {
          return { paper, score: 0 };
        }
      }
      
      // Explicitly include qualification to catch things like "GCSE"
      const combined = normalizeForSearch(
        `${metadata.qualification || ''} ${metadata.exam_board || ''} ${metadata.exam_code || ''} ${metadata.exam_series || ''} ${metadata.tier || ''} ${metadata.subject || ''}`
      );
      const pTokens = combined.split(/\s+/);

      let matchScore = 0;
      rawKeywords.forEach(keyword => {
        const isMatch = pTokens.some(pt => {
          if (pt === keyword) return true;
          if (/^\d+$/.test(pt) && /^\d+$/.test(keyword)) return parseInt(pt) === parseInt(keyword);
          // Only allow substring matching for longer words (>= 4 chars) so "1" or "f" doesn't match "2021" or "1ma1"
          return keyword.length >= 4 && pt.includes(keyword);
        });
        if (isMatch) {
          // Weight exact 4-digit year (e.g. 2025) and specific paper/tier codes (e.g. 1f, 2h, 8300, 1ma1) higher
          const isHighValueToken = /^20\d{2}$/.test(keyword) || /^\d+[fh]$/.test(keyword) || /\d/.test(keyword);
          matchScore += isHighValueToken ? 3 : 1;
        }
      });

      return { paper, score: matchScore };
    });

    if (scoredPapers.length === 0) return papers;

    // 2. Find the highest keyword match score across all papers
    const maxScore = Math.max(...scoredPapers.map(sp => sp.score));
    
    // 3. If literally zero papers matched the hint, return empty array so narrow search is false
    if (maxScore === 0) return [];

    // 4. Return only the papers that achieved the highest overlap score.
    // This allows words like "Tier" to simply be ignored without penalizing the correct paper.
    return scoredPapers
      .filter(sp => sp.score === maxScore)
      .map(sp => sp.paper);
  }

  private async getAllExamPapers(): Promise<any[]> {
    if (!this.db) return [];

    const now = Date.now();
    if (QuestionDetectionService.cachedPapers && (now - QuestionDetectionService.lastCacheTime < QuestionDetectionService.CACHE_TTL)) {
      return QuestionDetectionService.cachedPapers;
    }

    if (QuestionDetectionService.papersFetchPromise) {
      return QuestionDetectionService.papersFetchPromise;
    }

    QuestionDetectionService.papersFetchPromise = (async () => {
      try {
        const snapshot = await this.db.collection('fullExamPapers').get();
        const papers: any[] = [];
        snapshot.forEach((doc: any) => papers.push({ id: doc.id, ...doc.data() }));
        QuestionDetectionService.cachedPapers = papers;
        QuestionDetectionService.lastCacheTime = Date.now();
        return papers;
      } catch (e) {
        console.error('Error fetching papers', e);
        return [];
      } finally {
        QuestionDetectionService.papersFetchPromise = null;
      }
    })();

    return QuestionDetectionService.papersFetchPromise;
  }

  private async getAllMarkingSchemes(): Promise<any[]> {
    if (!this.db) return [];

    const now = Date.now();
    if (QuestionDetectionService.cachedSchemes && (now - QuestionDetectionService.lastSchemesCacheTime < QuestionDetectionService.CACHE_TTL)) {
      return QuestionDetectionService.cachedSchemes;
    }

    if (QuestionDetectionService.schemesFetchPromise) {
      return QuestionDetectionService.schemesFetchPromise;
    }

    QuestionDetectionService.schemesFetchPromise = (async () => {
      try {
        const snapshot = await this.db.collection('markingSchemes').get();
        const schemes: any[] = [];
        snapshot.forEach((doc: any) => schemes.push({ id: doc.id, ...doc.data() }));
        QuestionDetectionService.cachedSchemes = schemes;
        QuestionDetectionService.lastSchemesCacheTime = Date.now();
        return schemes;
      } catch (e) {
        console.error('Error fetching marking schemes', e);
        return [];
      } finally {
        QuestionDetectionService.schemesFetchPromise = null;
      }
    })();

    return QuestionDetectionService.schemesFetchPromise;
  }

  private async getAllExaminerReports(): Promise<any[]> {
    if (!this.db) return [];

    const now = Date.now();
    if (QuestionDetectionService.cachedExaminerReports && (now - QuestionDetectionService.lastExaminerReportsCacheTime < QuestionDetectionService.CACHE_TTL)) {
      return QuestionDetectionService.cachedExaminerReports;
    }

    if (QuestionDetectionService.examinerReportsFetchPromise) {
      return QuestionDetectionService.examinerReportsFetchPromise;
    }

    QuestionDetectionService.examinerReportsFetchPromise = (async () => {
      try {
        const snapshot = await this.db.collection('examinerReports').get();
        const reports: any[] = [];
        snapshot.forEach((doc: any) => reports.push({ id: doc.id, ...doc.data() }));
        QuestionDetectionService.cachedExaminerReports = reports;
        QuestionDetectionService.lastExaminerReportsCacheTime = Date.now();
        return reports;
      } catch (e) {
        console.error('Error fetching examiner reports', e);
        return [];
      } finally {
        QuestionDetectionService.examinerReportsFetchPromise = null;
      }
    })();

    return QuestionDetectionService.examinerReportsFetchPromise;
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
      const [schemes, examinerReports] = await Promise.all([
        this.getAllMarkingSchemes(),
        this.getAllExaminerReports()
      ]);
      
      let bestMatch: MarkingSchemeMatch | null = null;
      let bestScore = 0;
      
      for (const scheme of schemes) {
        const match = this.matchMarkingSchemeWithExamPaper(examPaperMatch, scheme, examinerReports);
        if (match) {
          const isExactPaper = examPaperMatch.paperCode === match.examDetails.paperCode;
          const score = isExactPaper ? match.confidence + 0.1 : match.confidence;
          if (score > bestScore) {
            bestMatch = match;
            bestScore = score;
          }
        }
      }

      if (process.env.LOG_QUESTION_DETECTION === 'true') {
        if (bestMatch) {
          console.log(`🚨 [DEBUG-SCHEME] EXAM PAPER MATCH: ${examPaperMatch.paperCode} Q${examPaperMatch.questionNumber} -> DOC ID: ${bestMatch.id}`);
        } else {
          console.log(`🚨 [DEBUG-SCHEME] No marking scheme match found for ${examPaperMatch.paperCode} Q${examPaperMatch.questionNumber}`);
        }
      }

      return bestMatch;
    } catch (error) {
      console.error('Error finding marking scheme', error);
      return null;
    }
  }

  private matchMarkingSchemeWithExamPaper(examPaperMatch: ExamPaperMatch, markingScheme: any, examinerReports: any[] = []): MarkingSchemeMatch | null {
    try {
      const examDetails = markingScheme.examDetails;
      if (!examDetails) return null;
      if (examPaperMatch.paperCode !== examDetails.paperCode) return null;
      const boardMatch = this.calculateSimilarity(examPaperMatch.board, examDetails.board || '');

      // [FIX] Series Equivalence: June/May/Summer
      const series1 = (examPaperMatch.examSeries || '').toLowerCase();
      const series2 = (examDetails.exam_series || '').toLowerCase();

      let seriesMatch = this.calculateSimilarity(series1, series2);

      const isSummer1 = /\b(june|may|summer)\b/.test(series1);
      const isSummer2 = /\b(june|may|summer)\b/.test(series2);

      const year1 = series1.match(/\d{4}/)?.[0];
      const year2 = series2.match(/\d{4}/)?.[0];

      if (isSummer1 && isSummer2) {
        if (year1 === year2 || !year1 || !year2) {
          // Exact summer match (same year or missing year)
          seriesMatch = Math.max(seriesMatch, 0.9);
        } else {
          // Year mismatch but both are summer - allow as weak match (0.5) 
          // to find papers across years if no better match exists.
          seriesMatch = Math.max(seriesMatch, 0.5);
        }
      }

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

        // Find matching external Examiner Report document if available
        const getSeriesSeason = (s: string): string | null => {
          if (/\b(june|jun|may|summer)\b/i.test(s)) return 'summer';
          if (/\b(november|nov|autumn|winter)\b/i.test(s)) return 'november';
          if (/\b(january|jan|march|mar|spring)\b/i.test(s)) return 'january';
          return null;
        };
        const season2 = getSeriesSeason(series2);
        const matchingExternalReport = examinerReports.find((rep: any) => {
          const repDetails = rep.examDetails || rep.metadata || {};
          const repCode = String(repDetails.paperCode || repDetails.exam_code || '').trim();
          if (repCode !== examDetails.paperCode) return false;
          const repSeries = String(repDetails.exam_series || repDetails.date || '').toLowerCase();
          const repYear = repSeries.match(/\d{4}/)?.[0];
          if (year2 && repYear && year2 !== repYear) return false;
          const repSeason = getSeriesSeason(repSeries);
          if (season2 && repSeason && season2 !== repSeason) return false;
          return true;
        });
        const externalQReport = matchingExternalReport?.questions?.[qNum] || matchingExternalReport?.questions?.[baseNum];

        const enrichedMainQ = mainQ && typeof mainQ === 'object' && !Array.isArray(mainQ)
          ? {
              ...mainQ,
              sourceExtracts: mainQ.sourceExtracts || markingScheme.sourceExtracts,
              examinerReport: mainQ.examinerReport || externalQReport || markingScheme.examinerReport?.[qNum] || markingScheme.examinerReport
            }
          : mainQ;

        if (enrichedMainQ && (enrichedMainQ.sub_questions || enrichedMainQ.subQuestions || enrichedMainQ.parts)) {
          questionMarks = enrichedMainQ;
        } else {
          const subKeys = Object.keys(questions).filter(k => {
            const m = k.match(/^0*(\d+)(?:\.\d+|\(?[a-z]+\)?)?$/i);
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
              questionMarks = enrichedMainQ || questions[subKeys[0]];
            }
          } else if (enrichedMainQ) {
            questionMarks = enrichedMainQ;
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
          generalMarkingGuidance: markingScheme.generalMarkingGuidance,
          subQuestionMaxScores: markingScheme.subQuestionMaxScores
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
    const rawTier = String(match.tier || '').trim();
    const tier = /^(n\/a|unknown|none)$/i.test(rawTier) ? '' : rawTier;
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
        qualification: match.qualification || match.level || '',
        // Pattern: Exam Series + Board Short + Subject Short + Tier
        paperTitle: `${series} ${boardPart} ${subjectPart}${tier ? ` ${tier}` : ''}`.replace(/\s+/g, ' ').trim(),
        questions: [],
        totalMarks: 0,
        _countedParentQuestions: new Set<string>(),
        isGeneric: match.isGeneric === true || match.paperCode === 'Generic Question'
      });
    }

    const paperGroup = examPaperGroups.get(paperKey);
    const questionNumber = dr.question.questionNumber || match.questionNumber;
    const marks = Number(match.marks) || 0;

    // Use database text if available, while preserving extracted OCR/classification text
    const extractedQuestionText = dr.question.text || '';
    const databaseQuestionText = match.databaseQuestionText || undefined;
    const questionText = databaseQuestionText || extractedQuestionText;

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
      extractedQuestionText,
      ...(databaseQuestionText ? { databaseQuestionText } : {}),
      ...(dr.question.sourceImageIndex !== undefined ? { sourceImageIndex: dr.question.sourceImageIndex } : {}),
      marks: marks,
      markingScheme: markingSchemeStr
    });

    // Add to paper total marks once per parent question (avoid multiplying parent marks across sub-questions)
    const parentQKey = String(match.questionNumber || getBaseQuestionNumber(String(questionNumber || '')) || questionNumber);
    if (!paperGroup._countedParentQuestions.has(parentQKey)) {
      paperGroup._countedParentQuestions.add(parentQKey);
      paperGroup.totalMarks += marks;
    }
  });

  const examPapers = Array.from(examPaperGroups.values()).map(({ _countedParentQuestions, ...rest }) => rest);
  const multipleExamPapers = examPapers.length > 1;

  // Total marks across all uniqueness
  const totalMarks = examPapers.reduce((sum, p) => sum + (Number(p.totalMarks) || 0), 0);

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

  // Support Rescue Logic: Find the first valid (non-generic) past paper in the batch
  const validPaper = examPapers.find(p => 
    !p.isGeneric && 
    p.examCode !== 'Generic Question' && 
    p.subject !== 'Generic Question' && 
    p.examBoard !== 'Unknown' && 
    p.examBoard !== 'N/A' &&
    p.examCode !== 'Unknown' &&
    p.examCode !== 'N/A'
  );

  const hasModifiedQuestion = detectionResults.some(
    dr => dr?.detectionResult?.isModifiedQuestion === true
  );

  if (validPaper) {
    // Pattern: (Modified) + Exam Series + Exam Code + Board Short + Subject Short + Tier
    const p = validPaper;
    const seriesPart = p.examSeries || '';
    const codePart = p.examCode || '';
    const boardPart = getShortExamBoard(p.examBoard);
    const subjectPart = getShortSubjectName(p.subject || '');
    const rawTier = String(p.tier || '').trim();
    const tierPart = /^(n\/a|unknown|none)$/i.test(rawTier) ? '' : rawTier;

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
    const modifiedPrefix = hasModifiedQuestion ? 'Modified ' : '';
    return `${modifiedPrefix}${baseTitle}${qRange} ${totalMarks} marks`.replace(/\s+/g, ' ').trim();
  }

  if (hasModifiedQuestion) {
    const allQNums = Array.from(new Set(
      detectionResults
        .map((dr: any) => parseInt(String(dr?.question?.questionNumber || dr?.detectionResult?.match?.questionNumber || ''), 10))
        .filter((n: number) => !isNaN(n))
    )).sort((a, b) => a - b);

    let qRange = '';
    if (allQNums.length === 1) {
      qRange = ` Q${allQNums[0]}`;
    } else if (allQNums.length > 1) {
      qRange = ` Q${allQNums[0]} to Q${allQNums[allQNums.length - 1]}`;
    }

    return `Modified Paper${qRange}`.replace(/\s+/g, ' ').trim();
  }

  // All papers are generic or unknown. Bypass the structured builder and use the question text for a cleaner title
  const firstQText = detectionResults[0]?.question?.text || '';
  return generateGenericTitleFromText(firstQText, mode);
}

/**
 * Simple total marks calculator
 */
export function calculateTotalMarks(detectionResults: any[]): number {
  return detectionResults.reduce((sum, dr) => sum + (Number(dr.detectionResult?.match?.marks) || 0), 0);
}

export const questionDetectionService = QuestionDetectionService.getInstance();
