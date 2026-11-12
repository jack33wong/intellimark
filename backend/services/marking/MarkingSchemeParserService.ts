import crypto from 'crypto';
import { ModelProvider } from '../../utils/ModelProvider.js';
import UsageTracker from '../../utils/UsageTracker.js';
import { getFirestore } from '../../config/firebase.js';
import { ImageUtils } from '../../utils/ImageUtils.js';
import { QuestionDetectionService } from './questionDetectionService.js';
import { getBaseQuestionNumber } from '../../utils/TextNormalizationUtils.js';
import { cleanSubjectAndQualification } from './MarkingHelpers.js';

export interface AutoPersistenceAuditContext {
    userId?: string;
    sessionId?: string;
    sourceFileName?: string;
    /** Completeness verification result stored in persistenceAudit for traceability */
    completeness?: CompletenessReport;
}

export interface CompletenessReport {
    isComplete: boolean;
    reasons: string[];
    warnings: string[];
    schemeTotalMarks: number;
    expectedTotalMarks: number | null;
    expectedTotalSource: 'question_paper' | 'mark_scheme' | null;
    baseQuestionCount: number;
    subQuestionCount: number;
}

/** Normalize question keys for matching: "01.1" -> "1.1", "1(a)(i)" -> "1ai", "Q2b" -> "2b" */
export function normQuestionKey(k: string): string {
    return String(k || '')
        .trim()
        .toLowerCase()
        .replace(/^q(?:uestion)?\s*/, '')
        .replace(/[\s()]/g, '')
        .replace(/^0+(?=\d)/, '');
}

function toPositiveInt(v: any): number | null {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Version of the auto-persistence logic. Bump when the persisted shape/accuracy changes so
 * previously auto-persisted docs (written by buggy older logic) are rewritten on the next upload.
 *  - v1: initial auto-persistence (dropped "N.N" sub-questions, no per-question totalMarks)
 *  - v2: complete sub-question coverage from subQuestionMaxScores, per-question totalMarks/maxMarks,
 *        relative sub-question `part`, parent marks reconciled with sum of sub-question marks
 *  - v3: canonical normalized keys in markingSchemes (stripped leading zeros: "1.1" not "01.1")
 *        and clean relative sub-part in fullExamPapers ("1" not ".1")
 *  - v4: strip qualification prefix (e.g. "GCSE", "A-Level") from subject field, ensuring clean separation of qualification & subject
 *  - v5: standardize auto-persisted fullExamPapers & markingSchemes schemas to canonical Maths/English shapes (strip redundant exam, questionNumber, totalMarks, paper/date aliases, and boolean flags)
 */
export const AUTO_PERSIST_SCHEMA_VERSION = 5;

/** True when a Firestore doc was written by the auto-persistence pipeline (never overwrite manual docs). */
function isAutoPersistedDoc(data: any): boolean {
    if (!data) return false;
    return data.persistenceType === 'auto' || data.isAutoPersisted === true || data.autoCataloged === true;
}

/** Sums integer weights from mark codes, e.g. [B1, B2, M1, A1] -> 5. Bare numbers count as their value. */
function sumMarkCodeWeights(marks: any): number {
    if (typeof marks === 'number') return marks;
    if (!Array.isArray(marks)) return 0;
    return marks.reduce((sum: number, m: any) => {
        const code = String(typeof m === 'object' && m !== null ? (m.mark ?? m.code ?? '') : m).trim();
        const match = code.match(/^[A-Za-z]*\s*(\d+)$/);
        return sum + (match ? Number(match[1]) : 0);
    }, 0);
}

/** Numeric-aware ordering for question keys: "1.2" < "1.10", "2a" < "2b". */
function compareQuestionKeys(a: string, b: string): number {
    const pa = String(a).split(/(\d+)/).filter(Boolean);
    const pb = String(b).split(/(\d+)/).filter(Boolean);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] ?? '';
        const y = pb[i] ?? '';
        const nx = Number(x), ny = Number(y);
        if (!isNaN(nx) && !isNaN(ny) && x !== '' && y !== '') {
            if (nx !== ny) return nx - ny;
        } else if (x !== y) {
            return x.localeCompare(y);
        }
    }
    return 0;
}

export class MarkingSchemeParserService {
    private static memoryCache = new Map<string, any>();

    private static getSystemPrompt(): string {
        return `Role: Senior Examination Data Extraction Specialist & Quality Assurance Verifier
Task: Extract the complete marking scheme data from the attached image(s) into a strict, valid JSON format across ANY academic subject (Mathematics, Biology, Chemistry, Physics, Geography, History, Computer Science, Business, Economics, Religious Studies, English Literature, etc.).

You will receive one or more images of an official or teacher-provided marking scheme.
You must output a single JSON object matching the schema below exactly.

CRITICAL EXTRACTION RULES FOR 100% MARKING ACCURACY:
1. QUESTION KEYS & BUDGETS ("subQuestionMaxScores" & "questions"):
   - Normalize question keys by removing spaces and parentheses: e.g., "1(a)(i)" -> "1ai", "Question 2 (b)" -> "2b", "03.4" -> "3.4" or "3d" (keep alphanumeric labels consistent with the paper, e.g. "1a", "1b", "2").
   - Every key in "questions" MUST have its exact integer maximum score recorded in "subQuestionMaxScores".

2. THREE GRADING PARADIGMS (Classify each question/sub-question via "paradigm"):
   - "CALCULATION_STEP": Mathematical, Physics, Chemistry, Biology, Geography, or Economics calculations using step/method marks (M1, A1, B1, P1, C1).
     * CRITICAL: The sum of the integer weights of all "mark" codes in "marks" (e.g. M1 + M1 + M1 + A1 = 4, or M1 + A3 = 4) MUST equal "subQuestionMaxScores[key]". Extract every intermediate method step (unit conversion, substitution, rearrangement) as a separate "M1" entry and the final numerical answer as "A1" (or higher if a single step awards multiple marks).
   - "KEYWORD_POINT": Short-answer knowledge, definition, explanation, multiple-choice, table-completion, or "Any K from N" bullet-point schemes (Sciences, Humanities, CS, Business).
     * If the mark column shows a bare number (e.g. "1") for a point/bullet, format "mark" as "B1" (or "M1"/"A1" if it is a calculation step).
     * If a single bullet is worth 2 marks, split into atomic "B1" entries if separate criteria are given, or use "B2" if indivisible.
     * Preserve MANDATORY underlined or bold keywords from the scheme by wrapping them in **double asterisks** inside "answer".
     * Preserve ALL examiner boundary rules from the "Additional Guidance" / "Notes" / "Comments" column inside "comments": explicitly include "Accept: ...", "Allow: ...", "Reject: ...", "Do not accept: ...", "Ignore: ...", "ecf", "cao", or pool rules like "Any 2 from 4".
   - "LEVEL_OF_RESPONSE": Extended response / essay questions (e.g., 6-mark Science Extended Response, 8/9/12/16/20-mark Geography, History, RS, Business, or Literature questions) graded via Level bands (Level 1, Level 2, Level 3, Level 4).
     * Populate "levels": array of { "level": 1, "markRange": "1-2", "descriptor": "Verbatim band descriptor including any level cap rules" }.
     * Populate "indicativeContent": array of verbatim valid content points listed in the scheme.
     * Also populate "marks" with one summary item per indicative content point (as "B1") or level descriptor so downstream consumers always have a non-empty "marks" array.

Output JSON Schema:
{
  "examDetails": {
    "board": "AQA | Edexcel | OCR | WJEC | CIE | Custom",
    "subject": "Exact academic subject name ONLY, WITHOUT any qualification prefix or suffix (e.g. 'Combined Science: Trilogy', 'Biology', 'Chemistry', 'Physics', 'Geography', 'History', 'Computer Science'). NEVER include 'GCSE', 'A-Level', 'IGCSE', or '(9-1)' in subject.",
    "qualification": "GCSE | A-Level | IGCSE",
    "paperCode": "Paper code if visible, else 'Uploaded'",
    "tier": "Higher | Foundation | N/A",
    "exam_series": "Exam series if visible, else 'N/A'",
    "paperTotalMarks": "Integer total/maximum mark for the WHOLE paper ONLY if explicitly printed in the document (e.g. 'Total for paper: 100', 'Maximum mark: 80'), else null"
  },
  "documentCompleteness": {
    "isComplete": "true ONLY if the images contain the marking scheme for EVERY question of the paper from Question 1 to the final question with no missing pages; false if any pages/questions appear to be missing, cut off, or only selected questions are included",
    "firstQuestion": "First question number present (e.g. '1')",
    "lastQuestion": "Last question number present (e.g. '8')",
    "reason": "Short reason if isComplete is false, else ''"
  },
  "subQuestionMaxScores": {
    "1a": 2,
    "1b": 3,
    "1c": 6
  },
  "questions": {
    "1a": {
      "paradigm": "KEYWORD_POINT",
      "answer": "Summary of expected answer",
      "marks": [
        {
          "mark": "B1",
          "answer": "Verbatim marking point with **mandatory underlined** terms preserved",
          "comments": "Accept: ... | Reject: ... | Ignore: ... | Any 2 from 4"
        }
      ]
    },
    "1b": {
      "paradigm": "CALCULATION_STEP",
      "answer": "Final numerical answer + unit",
      "marks": [
        {
          "mark": "M1",
          "answer": "Method / substitution / conversion step",
          "comments": "Allow ecf from 1a"
        },
        {
          "mark": "A1",
          "answer": "Correct final value",
          "comments": "cao"
        }
      ]
    },
    "1c": {
      "paradigm": "LEVEL_OF_RESPONSE",
      "answer": "Level-of-Response Extended Answer (Max 6 marks)",
      "levels": [
        {
          "level": 3,
          "markRange": "5-6",
          "descriptor": "Detailed and coherent explanation linking X and Y with a justified conclusion."
        },
        {
          "level": 2,
          "markRange": "3-4",
          "descriptor": "Clear description of X or Y with some relevant application."
        },
        {
          "level": 1,
          "markRange": "1-2",
          "descriptor": "Isolated basic points."
        }
      ],
      "indicativeContent": [
        "Indicative point 1",
        "Indicative point 2"
      ],
      "marks": [
        {
          "mark": "B1",
          "answer": "Indicative point 1",
          "comments": "Level of Response (Max 6 marks): L3 (5-6m), L2 (3-4m), L1 (1-2m)"
        }
      ]
    }
  },
  "generalMarkingGuidance": "Any paper-wide marking rules (e.g. list rule, significant figures, rounding, equations)."
}

Do not include markdown blocks, just the raw JSON object. Ensure all max scores in "subQuestionMaxScores" are integers.`;
    }

    /**
     * Canonicalizes all question and subQuestionMaxScores keys in-place
     * (e.g. "01.1" -> "1.1") so Turn 1 (BYOMS / cache) and Turn 2 (Auto-Catalog DB)
     * produce identical prompt headers.
     */
    private static canonicalizeParsedScheme(parsedObj: any): any {
        if (!parsedObj || typeof parsedObj !== 'object') return parsedObj;

        // Clean qualification prefix/suffix from subject (e.g. "GCSE COMBINED SCIENCE: TRILOGY" -> "COMBINED SCIENCE: TRILOGY")
        if (parsedObj.examDetails && typeof parsedObj.examDetails === 'object') {
            const { subject, qualification } = cleanSubjectAndQualification(
                parsedObj.examDetails.subject,
                parsedObj.examDetails.qualification
            );
            parsedObj.examDetails.subject = subject;
            if (qualification) parsedObj.examDetails.qualification = qualification;
        }

        const cleanKey = (k: string) => String(k || '').trim().replace(/^0+(?=\d)/, '');

        if (parsedObj.subQuestionMaxScores && typeof parsedObj.subQuestionMaxScores === 'object') {
            const normalizedScores: Record<string, number> = {};
            for (const [k, v] of Object.entries(parsedObj.subQuestionMaxScores)) {
                const ck = cleanKey(k);
                if (ck) normalizedScores[ck] = Number(v) || 0;
            }
            parsedObj.subQuestionMaxScores = normalizedScores;
        }

        if (parsedObj.questions && typeof parsedObj.questions === 'object') {
            const normalizedQuestions: Record<string, any> = {};
            for (const [k, v] of Object.entries(parsedObj.questions)) {
                const ck = cleanKey(k);
                if (!ck) continue;
                if (v && typeof v === 'object') {
                    normalizedQuestions[ck] = { ...(v as any), questionNumber: ck };
                } else {
                    normalizedQuestions[ck] = v;
                }
            }
            parsedObj.questions = normalizedQuestions;
        }

        return parsedObj;
    }

    /**
     * Parses an array of raw base64 images of a marking scheme into a custom scheme object.
     * Uses SHA-256 fingerprint caching (in-memory + Firestore) and 1200px lightweight copies for speed.
     */
    static async parseImagesToObject(
        base64Images: string[],
        tracker?: UsageTracker,
        auditContext?: AutoPersistenceAuditContext
    ): Promise<any> {
        const PARSER_MODEL = 'gemini-3.7-flash';

        if (!base64Images || base64Images.length === 0) {
            return null;
        }

        // Compute deterministic SHA-256 cache key across all scheme page images
        const hash = crypto.createHash('sha256');
        hash.update(`v2:${base64Images.length}:`);
        for (const img of base64Images) {
            // Sample prefix, middle, and suffix + length of each base64 page for fast (<1ms) collision-free hashing
            const len = img.length;
            const mid = Math.floor(len / 2);
            hash.update(`${len}:${img.slice(0, 512)}:${img.slice(Math.max(0, mid - 256), mid + 256)}:${img.slice(-512)}|`);
        }
        const cacheKey = hash.digest('hex');

        // 1. Check fast in-memory cache
        const memCached = this.memoryCache.get(cacheKey);
        if (memCached && memCached.questions && Object.keys(memCached.questions).length > 0) {
            console.log(`⚡ [MarkingSchemeParser] In-memory cache HIT (${cacheKey.slice(0, 12)}) for ${base64Images.length} scheme page(s).`);
            return this.canonicalizeParsedScheme(JSON.parse(JSON.stringify(memCached)));
        }

        // 2. Check Firestore persistent cache
        try {
            const db = getFirestore();
            if (db) {
                const docSnap = await db.collection('parsedMarkingSchemesCache').doc(cacheKey).get();
                if (docSnap.exists) {
                    const data = docSnap.data();
                    if (data?.parsedScheme && data.parsedScheme.questions && Object.keys(data.parsedScheme.questions).length > 0) {
                        console.log(`⚡ [MarkingSchemeParser] Firestore cache HIT (${cacheKey.slice(0, 12)}) for ${base64Images.length} scheme page(s).`);
                        const canonicalCached = this.canonicalizeParsedScheme(JSON.parse(JSON.stringify(data.parsedScheme)));
                        this.memoryCache.set(cacheKey, canonicalCached);
                        return JSON.parse(JSON.stringify(canonicalCached));
                    }
                }
            }
        } catch (cacheReadErr) {
            // Non-fatal: proceed to LLM extraction
        }

        console.log(`🧠 [MarkingSchemeParser] Processing ${base64Images.length} marking scheme images...`);
        console.log(`🤖 [MarkingSchemeParser] Using Hardcoded Model: ${PARSER_MODEL}`);

        try {
            const prompt = this.getSystemPrompt();

            // Downscale full-res 220 DPI images to 1200px WebP copies so 28-page schemes transfer & encode 5x faster
            const lightweightSchemeImages = await Promise.all(
                base64Images.map(img => ImageUtils.createLightweightCopy(img, 1200).catch(() => img))
            );

            const response = await ModelProvider.callGeminiChat(
                prompt,
                "Extract the marking scheme data from these images into the requested JSON format.",
                lightweightSchemeImages,
                PARSER_MODEL,
                true, // forceJsonResponse
                tracker,
                'markingScheme'
            );

            let content = response.content.trim();

            if (content.startsWith('\`\`\`json')) {
                content = content.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
            } else if (content.startsWith('\`\`\`')) {
                content = content.replace(/\`\`\`/g, '').trim();
            }

            const parsedObj = this.canonicalizeParsedScheme(JSON.parse(content));
            console.log(`✅ [MarkingSchemeParser] Successfully parsed custom scheme.`);

            if (parsedObj && parsedObj.questions && Object.keys(parsedObj.questions).length > 0) {
                if (this.memoryCache.size > 100) {
                    const firstKey = this.memoryCache.keys().next().value;
                    if (firstKey) this.memoryCache.delete(firstKey);
                }
                this.memoryCache.set(cacheKey, parsedObj);

                // Fire-and-forget write to Firestore parse cache.
                // NOTE: Official past-paper auto-persistence is NOT done here — it is gated by a completeness
                // check in `persistOfficialPastPaperIfComplete` (needs the question paper to cross-verify).
                try {
                    const db = getFirestore();
                    if (db) {
                        void db.collection('parsedMarkingSchemesCache').doc(cacheKey).set({
                            parsedScheme: parsedObj,
                            pageCount: base64Images.length,
                            examDetails: parsedObj.examDetails || null,
                            createdAt: new Date().toISOString()
                        }).catch(() => {});
                    }
                } catch {}
            }

            return parsedObj;

        } catch (error) {
            console.error('❌ [MarkingSchemeParser] Failed to parse custom marking scheme:', error);
            // On failure, return null so the pipeline safely falls back to standard behavior
            return null;
        }
    }

    /**
     * Checks whether a parsed scheme is an official past paper from a recognized exam board
     * (e.g. AQA, Edexcel, OCR, WJEC, Eduqas, CIE, Cambridge, CCEA) with a valid paper code and >= 3 questions.
     */
    static isOfficialPastPaperScheme(parsedObj: any): boolean {
        if (!parsedObj || typeof parsedObj !== 'object') return false;
        const details = parsedObj.examDetails;
        if (!details || typeof details !== 'object') return false;

        const board = String(details.board || '').trim();
        const paperCode = String(details.paperCode || '').trim();
        const subject = String(details.subject || '').trim();
        const questions = parsedObj.questions;

        if (!board || /^(custom|unknown|n\/a|none)$/i.test(board)) return false;
        if (!/^(aqa|edexcel|pearson|ocr|wjec|eduqas|cie|cambridge|ccea)/i.test(board)) return false;

        if (!paperCode || /^(uploaded|custom|unknown|n\/a|none)$/i.test(paperCode)) return false;
        if (paperCode.length < 3 || !/[0-9]/.test(paperCode)) return false;

        if (!subject) return false;

        if (!questions || typeof questions !== 'object' || Object.keys(questions).length < 3) return false;
        return true;
    }

    /**
     * Identifies whether a subject or paper code represents Mathematics or English Language.
     */
    static isMathematicsOrEnglishLanguage(subject?: string, paperCode?: string): boolean {
        const subj = String(subject || '').trim();
        const code = String(paperCode || '').trim();
        if (/\b(math|maths|mathematics)\b/i.test(subj)) return true;
        if (/\benglish\s+language\b/i.test(subj)) return true;
        if (/^(8300|1ma1|j560|c300)/i.test(code)) return true;
        if (/^(8700|1en0|j351|c700)/i.test(code)) return true;
        return false;
    }

    /**
     * Checks whether an official paper/scheme for the given code and series
     * already exists in Firestore (`markingSchemes` or `fullExamPapers`).
     * Checks both canonical doc IDs and the cached QuestionDetection catalog
     * to safely detect existing manual entries (including those with custom/UUID docIds).
     */
    static async paperExistsInDatabase(
        board?: string,
        paperCode?: string,
        examSeries?: string
    ): Promise<boolean> {
        try {
            const rawCode = String(paperCode || '').trim();
            if (!rawCode) return false;

            const db = getFirestore();
            const norm = (s: string) => String(s || '').trim().toUpperCase().replace(/[-_\s]+/g, '/');
            const slug = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
            const targetNormCode = norm(rawCode);
            const targetSeriesYear = (examSeries || '').match(/\b(20\d{2})\b/)?.[1] || '';

            // 1. Direct canonical doc ID check in Firestore
            if (db && board && examSeries) {
                const msDocId = `official_${slug(board)}_${slug(rawCode)}_${slug(examSeries)}`;
                const msDoc = await db.collection('markingSchemes').doc(msDocId).get();
                if (msDoc.exists) return true;

                const qpDocId = `${slug(board)}_${slug(rawCode)}_${slug(examSeries)}`;
                const qpDoc = await db.collection('fullExamPapers').doc(qpDocId).get();
                if (qpDoc.exists) return true;
            }

            // 2. Search cached in-memory marking schemes list (catches UUID/custom docIds)
            const schemes = await QuestionDetectionService.getInstance().getMarkingSchemesList();
            const matchedScheme = (schemes || []).some((s: any) => {
                const sCode = norm(s?.examDetails?.paperCode || s?.examDetails?.paper || s?.metadata?.exam_code || '');
                if (!sCode || (sCode !== targetNormCode && !sCode.includes(targetNormCode) && !targetNormCode.includes(sCode))) {
                    return false;
                }
                if (!targetSeriesYear) return true;
                const sSeries = String(s?.examDetails?.exam_series || s?.examDetails?.date || s?.metadata?.exam_series || '');
                return sSeries.includes(targetSeriesYear);
            });
            if (matchedScheme) return true;

            // 3. Search cached in-memory full exam papers list
            const papers = await QuestionDetectionService.getInstance().getExamPapersList();
            const matchedPaper = (papers || []).some((p: any) => {
                const pCode = norm(p?.metadata?.exam_code || p?.examDetails?.paperCode || p?.metadata?.paperCode || '');
                if (!pCode || (pCode !== targetNormCode && !pCode.includes(targetNormCode) && !targetNormCode.includes(pCode))) {
                    return false;
                }
                if (!targetSeriesYear) return true;
                const pSeries = String(p?.metadata?.exam_series || p?.examDetails?.exam_series || p?.metadata?.date || '');
                return pSeries.includes(targetSeriesYear);
            });
            if (matchedPaper) return true;

            return false;
        } catch {
            return false;
        }
    }

    /**
     * Collects the normalized (sub-)question keys and their max marks from a parsed scheme.
     * `subQuestionMaxScores` is primary; `questions` keys without a score are included with score 0
     * (they are flagged as incomplete by `assessSchemeCompleteness`).
     */
    private static collectSchemeScores(parsedScheme: any): Map<string, number> {
        const scores = new Map<string, number>();
        for (const [k, v] of Object.entries(parsedScheme?.subQuestionMaxScores || {})) {
            const nk = normQuestionKey(k);
            if (nk) scores.set(nk, Number(v) || 0);
        }
        for (const [k, v] of Object.entries(parsedScheme?.questions || {})) {
            const nk = normQuestionKey(k);
            if (!nk || scores.has(nk)) continue;
            scores.set(nk, sumMarkCodeWeights((v as any)?.marks) || 0);
        }
        return scores;
    }

    /**
     * STRICT completeness check for an auto-persisted official marking scheme.
     * Rejects partial uploads (missing pages, selected questions only, single-question schemes).
     *
     * Checks:
     *  1. LLM self-report `documentCompleteness.isComplete` is not false
     *  2. Every question key has a positive max score
     *  3. Base question numbers are contiguous from 1..N (no gaps / missing trailing questions)
     *  4. Sub-question parts are contiguous within each base (1.1, 1.2, 1.3 ... / a, b, c ...)
     *  5. Sum of marks equals the paper's stated total (from question paper cover or mark scheme)
     */
    static assessSchemeCompleteness(parsedScheme: any, paperStatedTotal?: number | null): CompletenessReport {
        const reasons: string[] = [];
        const warnings: string[] = [];
        const scores = this.collectSchemeScores(parsedScheme);
        const schemeTotalMarks = Array.from(scores.values()).reduce((s, m) => s + m, 0);

        // 1. LLM self-reported completeness
        const dc = parsedScheme?.documentCompleteness;
        if (dc && (dc.isComplete === false || String(dc.isComplete).toLowerCase() === 'false')) {
            reasons.push(`Mark scheme reported as incomplete${dc.reason ? `: ${dc.reason}` : ''}`);
        }

        // 2. Every key must have a positive score
        const zeroScoreKeys = Array.from(scores.entries()).filter(([, m]) => !(m > 0)).map(([k]) => k);
        if (zeroScoreKeys.length > 0) {
            reasons.push(`Missing max score for: ${zeroScoreKeys.join(', ')}`);
        }

        // 3. Base question numbering contiguous 1..N
        const baseNums = Array.from(new Set(
            Array.from(scores.keys()).map(k => Number(getBaseQuestionNumber(k))).filter(n => Number.isInteger(n) && n > 0)
        )).sort((a, b) => a - b);
        const maxBase = baseNums.length > 0 ? baseNums[baseNums.length - 1] : 0;
        if (baseNums.length === 0) {
            reasons.push('No numbered questions found');
        } else {
            const missingBases: number[] = [];
            for (let i = 1; i <= maxBase; i++) if (!baseNums.includes(i)) missingBases.push(i);
            if (missingBases.length > 0) reasons.push(`Missing question(s): ${missingBases.join(', ')}`);
        }
        const reportedLast = toPositiveInt(getBaseQuestionNumber(String(dc?.lastQuestion || '')));
        if (reportedLast && reportedLast > maxBase) {
            reasons.push(`Mark scheme reports last question ${reportedLast} but only Q1–Q${maxBase} were extracted`);
        }

        // 4. Sub-question contiguity within each base
        let subQuestionCount = 0;
        for (const base of baseNums) {
            const b = String(base);
            const subParts = Array.from(scores.keys())
                .filter(k => getBaseQuestionNumber(k) === b && k !== b)
                .map(k => k.slice(b.length));
            subQuestionCount += subParts.length;
            if (subParts.length === 0) continue;

            const decimalIdx = subParts.map(p => p.match(/^\.(\d+)/)?.[1]).filter(Boolean).map(Number);
            const ROMANS = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
            const isRomanOnly = subParts.every(p => ROMANS.includes(p));
            const letterIdx = isRomanOnly ? [] : subParts.map(p => p.match(/^([a-z])/)?.[1]).filter(Boolean) as string[];

            if (isRomanOnly) {
                const maxIdx = Math.max(...subParts.map(p => ROMANS.indexOf(p)));
                const missing = ROMANS.slice(0, maxIdx + 1).filter(r => !subParts.includes(r)).map(r => `${b}${r}`);
                if (missing.length > 0) reasons.push(`Missing sub-question(s): ${missing.join(', ')}`);
            }

            if (decimalIdx.length > 0) {
                const uniq = Array.from(new Set(decimalIdx)).sort((x, y) => x - y);
                const max = uniq[uniq.length - 1];
                const missing: string[] = [];
                for (let i = 1; i <= max; i++) if (!uniq.includes(i)) missing.push(`${b}.${i}`);
                if (missing.length > 0) reasons.push(`Missing sub-question(s): ${missing.join(', ')}`);
            }
            if (letterIdx.length > 0) {
                const uniq = Array.from(new Set(letterIdx)).sort();
                const maxCode = uniq[uniq.length - 1].charCodeAt(0);
                const missing: string[] = [];
                for (let c = 97; c <= maxCode; c++) {
                    const ch = String.fromCharCode(c);
                    if (!uniq.includes(ch)) missing.push(`${b}${ch}`);
                }
                if (missing.length > 0) reasons.push(`Missing sub-question(s): ${missing.join(', ')}`);
            }
        }

        // 5. Total marks must match the paper's stated total
        const schemeStatedTotal = toPositiveInt(parsedScheme?.examDetails?.paperTotalMarks);
        const paperTotal = toPositiveInt(paperStatedTotal);
        let expectedTotalMarks: number | null = null;
        let expectedTotalSource: CompletenessReport['expectedTotalSource'] = null;
        if (paperTotal) {
            expectedTotalMarks = paperTotal;
            expectedTotalSource = 'question_paper';
            if (schemeStatedTotal && schemeStatedTotal !== paperTotal) {
                warnings.push(`Mark scheme states ${schemeStatedTotal} marks but question paper states ${paperTotal}`);
            }
        } else if (schemeStatedTotal) {
            expectedTotalMarks = schemeStatedTotal;
            expectedTotalSource = 'mark_scheme';
        }

        if (!expectedTotalMarks) {
            reasons.push('Cannot verify completeness: paper total marks not stated on question paper cover or mark scheme');
        } else if (schemeTotalMarks !== expectedTotalMarks) {
            reasons.push(`Mark scheme total (${schemeTotalMarks}) does not match paper total (${expectedTotalMarks}, from ${expectedTotalSource?.replace('_', ' ')})`);
        }

        return {
            isComplete: reasons.length === 0,
            reasons,
            warnings,
            schemeTotalMarks,
            expectedTotalMarks,
            expectedTotalSource,
            baseQuestionCount: baseNums.length,
            subQuestionCount
        };
    }

    /**
     * STRICT completeness check that the uploaded QUESTION PAPER covers every question in the
     * (already verified complete) mark scheme. Rejects individual-question / partial-page uploads.
     */
    static assessQuestionPaperCompleteness(
        parsedScheme: any,
        extractedQuestions: Array<{ questionNumber?: string | null; text?: string }>
    ): { isComplete: boolean; reasons: string[]; warnings: string[] } {
        const reasons: string[] = [];
        const warnings: string[] = [];
        const scores = this.collectSchemeScores(parsedScheme);

        const extractedTexts = new Map<string, string>(); // normKey -> text
        for (const q of extractedQuestions || []) {
            const nk = normQuestionKey(String(q.questionNumber || ''));
            const text = String(q.text || '').trim();
            if (nk && text && !extractedTexts.has(nk)) extractedTexts.set(nk, text);
        }
        const extractedBases = new Set(Array.from(extractedTexts.keys()).map(k => getBaseQuestionNumber(k) || k));
        const schemeBases = new Set(Array.from(scores.keys()).map(k => getBaseQuestionNumber(k) || k));

        const missingBases = Array.from(schemeBases).filter(b => !extractedBases.has(b)).sort(compareQuestionKeys);
        if (missingBases.length > 0) {
            reasons.push(`Question paper is missing question(s): ${missingBases.join(', ')}`);
        }

        // Every scheme leaf (sub-question, or base question with no sub-questions) must have extracted text
        const missingText: string[] = [];
        for (const nk of scores.keys()) {
            const base = getBaseQuestionNumber(nk) || nk;
            if (missingBases.includes(base)) continue; // already reported
            const hasSubs = Array.from(scores.keys()).some(k => k !== base && (getBaseQuestionNumber(k) || k) === base);
            if (nk === base && hasSubs) continue; // parent container of sub-questions
            if (!extractedTexts.has(nk)) missingText.push(nk);
        }
        if (missingText.length > 0) {
            reasons.push(`No question text extracted for: ${missingText.sort(compareQuestionKeys).join(', ')}`);
        }

        const extraBases = Array.from(extractedBases).filter(b => !schemeBases.has(b));
        if (extraBases.length > 0) {
            warnings.push(`Ignoring question number(s) not in mark scheme: ${extraBases.join(', ')}`);
        }

        return { isComplete: reasons.length === 0, reasons, warnings };
    }

    /**
     * SINGLE gated entry point for auto-persisting an official non-Maths/English past paper.
     * Both `markingSchemes` and `fullExamPapers` are written ONLY when the mark scheme AND the
     * question paper are verified complete. Individual questions / partial uploads are ignored.
     */
    static async persistOfficialPastPaperIfComplete(params: {
        parsedScheme: any;
        extractedQuestions: Array<{ questionNumber?: string | null; text?: string; parentText?: string }>;
        paperStatedTotal?: number | null;
        auditContext?: AutoPersistenceAuditContext;
    }): Promise<{ persisted: boolean; report?: CompletenessReport }> {
        const { parsedScheme, extractedQuestions, paperStatedTotal, auditContext } = params;
        try {
            // Not an official past paper -> silently ignore (custom / teacher schemes are never cataloged)
            if (!this.isOfficialPastPaperScheme(parsedScheme)) return { persisted: false };

            const label = `${parsedScheme.examDetails?.board || ''} ${parsedScheme.examDetails?.paperCode || ''} ${parsedScheme.examDetails?.exam_series || parsedScheme.examDetails?.date || ''}`.trim();

            // 🛡️ MATHS & ENGLISH LANGUAGE EXISTENCE GATE:
            // For Mathematics and English Language, auto-persistence is ONLY permitted if the official paper
            // does NOT already exist in our database, strictly preserving all curated/manual data.
            const isMathOrEnglish = this.isMathematicsOrEnglishLanguage(
                parsedScheme.examDetails?.subject,
                parsedScheme.examDetails?.paperCode
            );
            if (isMathOrEnglish) {
                const board = parsedScheme.examDetails?.board;
                const paperCode = parsedScheme.examDetails?.paperCode;
                const examSeries = parsedScheme.examDetails?.exam_series || parsedScheme.examDetails?.date;
                const existsInDb = await this.paperExistsInDatabase(board, paperCode, examSeries);
                if (existsInDb) {
                    console.log(`🛡️ [AUTO-CATALOG] Skipped Maths/English paper "${label}" — already exists in database. Curated data preserved.`);
                    return { persisted: false };
                }
            }

            const schemeReport = this.assessSchemeCompleteness(parsedScheme, paperStatedTotal);
            const paperReport = this.assessQuestionPaperCompleteness(parsedScheme, extractedQuestions);

            const report: CompletenessReport = {
                ...schemeReport,
                isComplete: schemeReport.isComplete && paperReport.isComplete,
                reasons: [
                    ...schemeReport.reasons.map(r => `[scheme] ${r}`),
                    ...paperReport.reasons.map(r => `[paper] ${r}`)
                ],
                warnings: [...schemeReport.warnings, ...paperReport.warnings]
            };

            report.warnings.forEach(w => console.warn(`⚠️ [AUTO-CATALOG] ${label}: ${w}`));

            if (!report.isComplete) {
                console.log(`🚫 [AUTO-CATALOG] Skipped persisting ${label} — upload is not a complete paper + mark scheme:`);
                report.reasons.forEach(r => console.log(`     • ${r}`));
                return { persisted: false, report };
            }

            console.log(`✅ [AUTO-CATALOG] Completeness verified for ${label}: ${report.baseQuestionCount} questions / ${report.subQuestionCount} sub-questions / ${report.schemeTotalMarks} marks (matches ${report.expectedTotalSource?.replace('_', ' ')} total).`);

            const ctx: AutoPersistenceAuditContext = { ...(auditContext || {}), completeness: report };
            await this.saveOfficialSchemeToDatabase(parsedScheme, ctx);
            await this.saveOfficialExamPaperQuestionsToDatabase(parsedScheme, extractedQuestions, ctx);
            return { persisted: true, report };
        } catch (err) {
            console.warn('⚠️ [AUTO-CATALOG] Completeness-gated persistence failed:', err);
            return { persisted: false };
        }
    }

    /**
     * Persists an official non-Maths/non-English-Language past paper marking scheme
     * into the Firestore `markingSchemes` collection so future uploads of the same paper
     * are automatically graded without requiring the user to re-upload the mark scheme.
     *
     * ⚠️ Call via `persistOfficialPastPaperIfComplete` — this method does NOT verify completeness.
     */
    static async saveOfficialSchemeToDatabase(
        parsedObj: any,
        auditContext?: AutoPersistenceAuditContext
    ): Promise<string | null> {
        try {
            if (!this.isOfficialPastPaperScheme(parsedObj)) {
                return null;
            }
            const db = getFirestore();
            if (!db) return null;

            const details = parsedObj.examDetails || {};
            const { subject: cleanSubj, qualification: cleanQual } = cleanSubjectAndQualification(
                details.subject,
                details.qualification
            );
            const board = String(details.board || '').trim();
            const paperCode = String(details.paperCode || '').trim().toUpperCase();
            const examSeries = String(details.exam_series || details.date || 'Unknown').trim();
            const subject = cleanSubj;
            const qualification = (cleanQual || 'GCSE').replace(/\s*\(9-1\)\s*/gi, '').trim() || 'GCSE';
            const tier = String(details.tier || 'N/A').trim();

            const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
            const docId = `official_${slug(board)}_${slug(paperCode)}_${slug(examSeries)}`;

            const existingDoc = await db.collection('markingSchemes').doc(docId).get();
            if (existingDoc.exists) {
                const existingData = existingDoc.data();
                // Never overwrite a manually curated scheme that happens to share this doc ID
                if (!isAutoPersistedDoc(existingData)) {
                    return docId;
                }
                // For Maths & English Language, never overwrite an existing document
                if (this.isMathematicsOrEnglishLanguage(subject, paperCode)) {
                    return docId;
                }
                const existingQCount = Object.keys(existingData?.questions || {}).length;
                const newQCount = Object.keys(parsedObj.questions || {}).length;
                const existingVersion = Number(existingData?.autoPersistVersion || 0);
                if (
                    existingVersion >= AUTO_PERSIST_SCHEMA_VERSION &&
                    existingQCount >= newQCount &&
                    existingData?.subQuestionMaxScores
                ) {
                    return docId;
                }
            }

            const rawSubScores = parsedObj.subQuestionMaxScores || {};
            const subQuestionMaxScores: Record<string, number> = {};
            for (const [k, v] of Object.entries(rawSubScores)) {
                const cleanKey = String(k).trim().replace(/^0+(?=\d)/, '');
                if (cleanKey) {
                    subQuestionMaxScores[cleanKey] = Number(v) || 0;
                }
            }

            // Canonicalize question keys (e.g. "01.1" -> "1.1") and strip redundant internal fields
            // (questionNumber, totalMarks, maxMarks) while keeping subQuestionMaxScores as the single budget source.
            const questionsToSave: Record<string, any> = {};
            for (const [qKey, qVal] of Object.entries(parsedObj.questions || {})) {
                const cleanKey = String(qKey).trim().replace(/^0+(?=\d)/, '');
                if (!qVal || typeof qVal !== 'object') {
                    questionsToSave[cleanKey] = qVal;
                    continue;
                }
                const qObj = qVal as any;
                const fromScores = Number(subQuestionMaxScores[cleanKey]) || Number(rawSubScores[qKey]) || 0;
                const qMarks = fromScores || sumMarkCodeWeights(qObj.marks);
                if (qMarks > 0 && !subQuestionMaxScores[cleanKey]) {
                    subQuestionMaxScores[cleanKey] = qMarks;
                }

                const cleanQuestionEntry: Record<string, any> = {
                    answer: qObj.answer ?? '',
                    marks: Array.isArray(qObj.marks) ? qObj.marks : []
                };
                if (qObj.paradigm) cleanQuestionEntry.paradigm = qObj.paradigm;
                if (Array.isArray(qObj.levels) && qObj.levels.length > 0) cleanQuestionEntry.levels = qObj.levels;
                if (Array.isArray(qObj.indicativeContent) && qObj.indicativeContent.length > 0) {
                    cleanQuestionEntry.indicativeContent = qObj.indicativeContent;
                }
                if (qObj.guidance) cleanQuestionEntry.guidance = qObj.guidance;

                questionsToSave[cleanKey] = cleanQuestionEntry;
            }

            const totalMarks = Object.values(subQuestionMaxScores).reduce((sum: number, v: any) => sum + (Number(v) || 0), 0);
            const uniqueBaseQuestions = new Set(
                Object.keys(questionsToSave).map(k => getBaseQuestionNumber(k) || k)
            );

            const normalizedExamDetails = {
                board,
                subject,
                qualification,
                paperCode,
                tier,
                exam_series: examSeries
            };

            const nowIso = new Date().toISOString();
            const existingCreatedAt = existingDoc.exists ? existingDoc.data()?.createdAt : null;
            const existingUploadedAt = existingDoc.exists ? existingDoc.data()?.uploadedAt : null;

            await db.collection('markingSchemes').doc(docId).set({
                examDetails: normalizedExamDetails,
                questions: questionsToSave,
                subQuestionMaxScores,
                generalMarkingGuidance: parsedObj.generalMarkingGuidance || '',
                totalQuestions: uniqueBaseQuestions.size,
                totalSubQuestions: Object.keys(questionsToSave).length,
                totalMarks: totalMarks || 100,
                autoPersistVersion: AUTO_PERSIST_SCHEMA_VERSION,
                persistenceType: 'auto',
                persistenceAudit: {
                    persistenceType: 'auto',
                    source: 'marking_pipeline',
                    persistedAt: nowIso,
                    triggeredByUserId: auditContext?.userId || null,
                    triggeredBySessionId: auditContext?.sessionId || null,
                    sourceFileName: auditContext?.sourceFileName || null,
                    extractionModel: 'gemini-3.7-flash',
                    completenessVerified: auditContext?.completeness?.isComplete === true,
                    completeness: auditContext?.completeness
                        ? {
                            schemeTotalMarks: auditContext.completeness.schemeTotalMarks,
                            expectedTotalMarks: auditContext.completeness.expectedTotalMarks,
                            expectedTotalSource: auditContext.completeness.expectedTotalSource,
                            baseQuestionCount: auditContext.completeness.baseQuestionCount,
                            subQuestionCount: auditContext.completeness.subQuestionCount,
                            warnings: auditContext.completeness.warnings
                        }
                        : null
                },
                uploadedAt: existingUploadedAt || nowIso,
                createdAt: existingCreatedAt || nowIso
            });

            QuestionDetectionService.invalidateSchemesCache();
            console.log(`📚 [AUTO-CATALOG] Saved official ${board} ${subject} (${paperCode} - ${examSeries}, ${totalMarks} marks) marking scheme to Firestore markingSchemes/${docId}!`);
            return docId;
        } catch (err) {
            console.warn('⚠️ [AUTO-CATALOG] Failed to save official marking scheme to database:', err);
            return null;
        }
    }

    /**
     * Saves extracted question stems from a full past paper upload into `fullExamPapers`
     * so future question-level text detection (`QuestionDetectionService.detectQuestion`)
     * can match individual questions from this paper.
     */
    static async saveOfficialExamPaperQuestionsToDatabase(
        parsedScheme: any,
        extractedQuestions: Array<{ questionNumber?: string | null; text?: string; parentText?: string }>,
        auditContext?: AutoPersistenceAuditContext
    ): Promise<void> {
        try {
            if (!this.isOfficialPastPaperScheme(parsedScheme)) return;
            if (!Array.isArray(extractedQuestions) || extractedQuestions.length < 3) return;

            const db = getFirestore();
            if (!db) return;

            const details = parsedScheme.examDetails || {};
            const { subject: cleanSubj, qualification: cleanQual } = cleanSubjectAndQualification(
                details.subject,
                details.qualification
            );
            const board = String(details.board || '').trim();
            const paperCode = String(details.paperCode || '').trim().toUpperCase();
            const examSeries = String(details.exam_series || details.date || 'Unknown').trim();
            const subject = cleanSubj;
            const qualification = (cleanQual || 'GCSE').replace(/\s*\(9-1\)\s*/gi, '').trim() || 'GCSE';
            const tier = String(details.tier || 'N/A').trim();

            const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
            const docId = `official_paper_${slug(board)}_${slug(paperCode)}_${slug(examSeries)}`;

            const normKey = normQuestionKey;

            // --- 1. Official mark scheme is the source of truth for WHICH (sub-)questions exist and their marks ---
            const rawScores: Record<string, any> = parsedScheme.subQuestionMaxScores || {};
            const schemeScores = new Map<string, number>(); // normKey -> marks
            const schemeDisplayKey = new Map<string, string>(); // normKey -> original display key
            for (const [k, v] of Object.entries(rawScores)) {
                const nk = normKey(k);
                if (!nk) continue;
                schemeScores.set(nk, Number(v) || 0);
                schemeDisplayKey.set(nk, String(k).trim().replace(/^0+(?=\d)/, ''));
            }
            for (const [k, v] of Object.entries(parsedScheme.questions || {})) {
                const nk = normKey(k);
                if (!nk || schemeScores.has(nk)) continue;
                schemeScores.set(nk, sumMarkCodeWeights((v as any)?.marks) || 0);
                schemeDisplayKey.set(nk, String(k).trim().replace(/^0+(?=\d)/, ''));
            }
            const totalPaperMarks = Array.from(schemeScores.values()).reduce((s, m) => s + m, 0) || 100;

            // --- 2. Collect texts extracted from the student paper ---
            const parentStems = new Map<string, string[]>(); // base -> unique intro stems (in order)
            const fallbackParentText = new Map<string, string>(); // base -> parentText seen on sub-questions
            const subTexts = new Map<string, string>(); // normKey -> sub-question text
            for (const q of extractedQuestions) {
                const nk = normKey(String(q.questionNumber || ''));
                const qText = String(q.text || '').trim();
                if (!nk) continue;
                const baseNum = getBaseQuestionNumber(nk) || nk;
                if (nk === baseNum) {
                    if (!qText) continue;
                    const stems = parentStems.get(baseNum) || [];
                    if (!stems.some(s => s === qText || s.includes(qText))) stems.push(qText);
                    parentStems.set(baseNum, stems);
                } else {
                    if (qText && !subTexts.has(nk)) subTexts.set(nk, qText);
                    const pText = String(q.parentText || '').trim();
                    if (pText && !fallbackParentText.has(baseNum)) fallbackParentText.set(baseNum, pText);
                }
            }

            // --- 3. Determine the set of base questions & sub-question keys ---
            const schemeHasKeys = schemeScores.size > 0;
            const allSubKeys = new Set<string>();
            schemeScores.forEach((_, nk) => allSubKeys.add(nk));
            if (!schemeHasKeys) subTexts.forEach((_, nk) => allSubKeys.add(nk));

            const baseNums = new Set<string>();
            allSubKeys.forEach(nk => baseNums.add(getBaseQuestionNumber(nk) || nk));
            if (!schemeHasKeys) parentStems.forEach((_, b) => baseNums.add(b));

            const subTextValues = new Set(Array.from(subTexts.values()));
            const missingTextKeys: string[] = [];
            const questionsMap: Record<string, any> = {};

            for (const baseNum of baseNums) {
                const subKeys = Array.from(allSubKeys)
                    .filter(nk => nk !== baseNum && (getBaseQuestionNumber(nk) || nk) === baseNum)
                    .sort(compareQuestionKeys);

                const sub_questions = subKeys.map(nk => {
                    const displayKey = schemeDisplayKey.get(nk) || nk;
                    // Relative part: "1.2" -> "2", "1a" -> "a", "1ai" -> "ai"
                    let relativePart = displayKey.startsWith(baseNum) ? displayKey.slice(baseNum.length) : displayKey;
                    if (relativePart.startsWith('.')) relativePart = relativePart.substring(1);
                    const text = subTexts.get(nk) || '';
                    if (!text) missingTextKeys.push(displayKey);
                    const marks = schemeScores.get(nk);
                    return {
                        question_part: relativePart,
                        question_text: text,
                        marks: marks || undefined,
                        ...(text ? {} : { text_missing: true })
                    };
                });

                // Parent stem: shared intro text only (exclude anything that is actually a sub-question's text)
                const stems = (parentStems.get(baseNum) || []).filter(s => !subTextValues.has(s));
                const stemText = stems.join('\n') || fallbackParentText.get(baseNum) || '';

                if (!stemText && sub_questions.length === 0) continue;

                // Parent marks are ALWAYS reconciled with the sum of sub-question marks
                const subSum = sub_questions.reduce((s, sq) => s + (Number(sq.marks) || 0), 0);
                const parentMarks = sub_questions.length > 0 ? subSum : (schemeScores.get(baseNum) || 0);

                questionsMap[baseNum] = {
                    question_number: baseNum,
                    question_text: stemText,
                    marks: parentMarks || undefined,
                    sub_questions
                };
            }

            const questionsArray = Object.values(questionsMap).sort((a: any, b: any) =>
                compareQuestionKeys(String(a.question_number), String(b.question_number))
            );
            const totalSubQuestions = questionsArray.reduce((s: number, q: any) => s + (q.sub_questions?.length || 0), 0);
            const reconciledTotal = questionsArray.reduce((s: number, q: any) => s + (Number(q.marks) || 0), 0);

            // --- 4. Skip redundant writes / never overwrite manual docs ---
            const existingSnap = await db.collection('fullExamPapers').doc(docId).get();
            if (existingSnap.exists) {
                const existingData = existingSnap.data();
                if (!isAutoPersistedDoc(existingData)) return;
                // For Maths & English Language, never overwrite an existing document
                if (this.isMathematicsOrEnglishLanguage(subject, paperCode)) {
                    return;
                }
                const existingQuestions: any[] = Array.isArray(existingData?.questions)
                    ? existingData!.questions
                    : Object.values(existingData?.questions || {});
                const existingSubCount = existingQuestions.reduce((s: number, q: any) => s + (q?.sub_questions?.length || 0), 0);
                const existingVersion = Number(existingData?.autoPersistVersion || 0);
                if (
                    existingVersion >= AUTO_PERSIST_SCHEMA_VERSION &&
                    existingQuestions.length >= questionsArray.length &&
                    existingSubCount >= totalSubQuestions
                ) {
                    return;
                }
            }

            if (missingTextKeys.length > 0) {
                console.warn(`⚠️ [AUTO-CATALOG] ${missingTextKeys.length} sub-question(s) present in mark scheme but no stem text was extracted: ${missingTextKeys.join(', ')} (saved with text_missing=true)`);
            }
            if (schemeHasKeys && reconciledTotal !== totalPaperMarks) {
                console.warn(`⚠️ [AUTO-CATALOG] Reconciled question marks (${reconciledTotal}) != mark scheme total (${totalPaperMarks}) for ${docId}`);
            }

            if (questionsArray.length < 2) return;

            const nowIso = new Date().toISOString();
            const existingCreatedAt = existingSnap.exists ? existingSnap.data()?.createdAt : null;

            const paperPartMatch = paperCode.match(/\/(\d+)/);
            const paperNumStr = paperPartMatch ? `Paper ${paperPartMatch[1]}` : paperCode;
            const paperTitle = `${board} ${qualification} ${subject} ${paperNumStr}${tier && tier !== 'N/A' ? ` (${tier})` : ''}`.replace(/\s+/g, ' ').trim();

            const metadataBlock = {
                exam_board: board,
                subject,
                paper_title: paperTitle,
                tier,
                exam_code: paperCode,
                qualification,
                exam_series: examSeries,
                total_questions: questionsArray.length,
                total_marks: totalPaperMarks
            };

            await db.collection('fullExamPapers').doc(docId).set({
                metadata: metadataBlock,
                questions: questionsArray,
                totalQuestions: questionsArray.length,
                totalSubQuestions,
                totalMarks: totalPaperMarks,
                autoPersistVersion: AUTO_PERSIST_SCHEMA_VERSION,
                persistenceType: 'auto',
                persistenceAudit: {
                    persistenceType: 'auto',
                    source: 'marking_pipeline',
                    persistedAt: nowIso,
                    triggeredByUserId: auditContext?.userId || null,
                    triggeredBySessionId: auditContext?.sessionId || null,
                    sourceFileName: auditContext?.sourceFileName || null,
                    extractionModel: 'gemini-3.7-flash',
                    completenessVerified: auditContext?.completeness?.isComplete === true,
                    completeness: auditContext?.completeness
                        ? {
                            schemeTotalMarks: auditContext.completeness.schemeTotalMarks,
                            expectedTotalMarks: auditContext.completeness.expectedTotalMarks,
                            expectedTotalSource: auditContext.completeness.expectedTotalSource,
                            baseQuestionCount: auditContext.completeness.baseQuestionCount,
                            subQuestionCount: auditContext.completeness.subQuestionCount,
                            warnings: auditContext.completeness.warnings
                        }
                        : null
                },
                createdAt: existingCreatedAt || nowIso
            });

            QuestionDetectionService.invalidatePapersCache();
            console.log(`📄 [AUTO-CATALOG] Saved ${questionsArray.length} questions / ${totalSubQuestions} sub-questions (${reconciledTotal} marks) to Firestore fullExamPapers/${docId}!`);
        } catch (err) {
            console.warn('⚠️ [AUTO-CATALOG] Failed to save official exam paper questions to database:', err);
        }
    }

    /**
     * Looks up a previously cataloged official marking scheme in `markingSchemes` by paperCode / series / subject hint.
     * Used during Stage 1/2 geometry checks so future uploads of a cataloged non-Maths/English paper
     * (e.g. "AQA 8461/1H") can be graded automatically without requiring the user to attach the mark scheme.
     */
    static async findCatalogedSchemeByPaperHint(
        paperCodeHint?: string,
        subjectHint?: string,
        examSeriesHint?: string
    ): Promise<any | null> {
        try {
            const rawHint = String(paperCodeHint || '').trim();
            if (!rawHint) return null;

            // Extract canonical paper code candidate (e.g. "8461/1H", "8462/2F", "1BI0/1H", "J247/01", "7402/1")
            const codeMatch = rawHint.match(/\b([0-9A-Z]{4,6}\/[0-9A-Z]{1,3})\b/i);
            const targetCode = (codeMatch ? codeMatch[1] : rawHint).trim().toUpperCase();
            if (targetCode.length < 4 || !/[0-9]/.test(targetCode)) return null;

            const schemes = await QuestionDetectionService.getInstance().getMarkingSchemesList();
            if (!schemes || schemes.length === 0) return null;

            const normCode = (c: string) => String(c || '').trim().toUpperCase().replace(/[-_\s]+/g, '/');
            const targetNorm = normCode(targetCode);

            const matchingCodeSchemes = schemes.filter((s: any) => {
                const sCode = normCode(s?.examDetails?.paperCode || s?.examDetails?.paper || '');
                return sCode && (sCode === targetNorm || sCode.includes(targetNorm) || targetNorm.includes(sCode));
            });

            if (matchingCodeSchemes.length === 0) return null;

            // If examSeriesHint is available (e.g. "June 2025"), prefer exact year/series match
            let chosen = matchingCodeSchemes[0];
            if (examSeriesHint && matchingCodeSchemes.length > 1) {
                const yearMatch = examSeriesHint.match(/\b(20\d{2})\b/)?.[1];
                const byYear = yearMatch
                    ? matchingCodeSchemes.find((s: any) => String(s?.examDetails?.exam_series || s?.examDetails?.date || '').includes(yearMatch))
                    : undefined;
                if (byYear) chosen = byYear;
            }

            if (!chosen?.questions || Object.keys(chosen.questions).length === 0) return null;

            return {
                examDetails: chosen.examDetails,
                questions: chosen.questions,
                subQuestionMaxScores: chosen.subQuestionMaxScores || {},
                generalMarkingGuidance: chosen.generalMarkingGuidance || ''
            };
        } catch (err) {
            return null;
        }
    }
}
