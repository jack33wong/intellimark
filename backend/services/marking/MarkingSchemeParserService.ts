import crypto from 'crypto';
import { ModelProvider } from '../../utils/ModelProvider.js';
import UsageTracker from '../../utils/UsageTracker.js';
import { getFirestore } from '../../config/firebase.js';
import { ImageUtils } from '../../utils/ImageUtils.js';
import { QuestionDetectionService } from './questionDetectionService.js';
import { getBaseQuestionNumber } from '../../utils/TextNormalizationUtils.js';

export interface AutoPersistenceAuditContext {
    userId?: string;
    sessionId?: string;
    sourceFileName?: string;
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
    "subject": "Exact subject name (e.g. Mathematics, Biology, Chemistry, Physics, Geography, History, Computer Science)",
    "qualification": "GCSE (9-1) | A-Level | IGCSE",
    "paperCode": "Paper code if visible, else 'Uploaded'",
    "tier": "Higher | Foundation | N/A",
    "exam_series": "Exam series if visible, else 'N/A'"
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
        hash.update(`v1:${base64Images.length}:`);
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
            void this.saveOfficialSchemeToDatabase(memCached, auditContext);
            return JSON.parse(JSON.stringify(memCached));
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
                        this.memoryCache.set(cacheKey, data.parsedScheme);
                        void this.saveOfficialSchemeToDatabase(data.parsedScheme, auditContext);
                        return JSON.parse(JSON.stringify(data.parsedScheme));
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

            const parsedObj = JSON.parse(content);
            console.log(`✅ [MarkingSchemeParser] Successfully parsed custom scheme.`);

            if (parsedObj && parsedObj.questions && Object.keys(parsedObj.questions).length > 0) {
                if (this.memoryCache.size > 100) {
                    const firstKey = this.memoryCache.keys().next().value;
                    if (firstKey) this.memoryCache.delete(firstKey);
                }
                this.memoryCache.set(cacheKey, parsedObj);

                // Fire-and-forget write to Firestore cache & official past-paper database catalog
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
                    void this.saveOfficialSchemeToDatabase(parsedObj, auditContext);
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
     * for a non-Mathematics and non-English Language subject (e.g. Biology, Chemistry, Physics,
     * Geography, History, Computer Science, Economics, Psychology, Business, English Literature).
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

        // Do not overwrite curated Mathematics or English Language schemes
        if (!subject || /\b(math|maths|mathematics)\b/i.test(subject)) return false;
        if (/\benglish\s+language\b/i.test(subject) || /^8700|^1en0|^j351/i.test(paperCode)) return false;

        if (!questions || typeof questions !== 'object' || Object.keys(questions).length < 3) return false;
        return true;
    }

    /**
     * Persists an official non-Maths/non-English-Language past paper marking scheme
     * into the Firestore `markingSchemes` collection so future uploads of the same paper
     * are automatically graded without requiring the user to re-upload the mark scheme.
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

            const details = parsedObj.examDetails;
            const board = String(details.board || '').trim();
            const paperCode = String(details.paperCode || '').trim().toUpperCase();
            const examSeries = String(details.exam_series || details.date || 'Unknown').trim();
            const subject = String(details.subject || '').trim();
            const qualification = String(details.qualification || 'GCSE (9-1)').trim();
            const tier = String(details.tier || 'N/A').trim();

            const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
            const docId = `official_${slug(board)}_${slug(paperCode)}_${slug(examSeries)}`;

            const existingDoc = await db.collection('markingSchemes').doc(docId).get();
            if (existingDoc.exists) {
                const existingData = existingDoc.data();
                // If already saved with at least as many questions and audit trail fields exist, skip redundant write
                const existingQCount = Object.keys(existingData?.questions || {}).length;
                const newQCount = Object.keys(parsedObj.questions || {}).length;
                if (existingQCount >= newQCount && existingData?.subQuestionMaxScores && existingData?.persistenceType) {
                    return docId;
                }
            }

            const subQuestionMaxScores: Record<string, number> = parsedObj.subQuestionMaxScores || {};
            const totalMarks = Object.values(subQuestionMaxScores).reduce((sum: number, v: any) => sum + (Number(v) || 0), 0);
            const uniqueBaseQuestions = new Set(
                Object.keys(parsedObj.questions || {}).map(k => getBaseQuestionNumber(k) || k)
            );

            const normalizedExamDetails = {
                board,
                qualification,
                paperCode,
                tier,
                paper: paperCode,
                date: examSeries,
                exam_series: examSeries,
                subject
            };

            const nowIso = new Date().toISOString();
            const existingCreatedAt = existingDoc.exists ? existingDoc.data()?.createdAt : null;
            const existingUploadedAt = existingDoc.exists ? existingDoc.data()?.uploadedAt : null;

            await db.collection('markingSchemes').doc(docId).set({
                examDetails: normalizedExamDetails,
                questions: parsedObj.questions,
                subQuestionMaxScores,
                generalMarkingGuidance: parsedObj.generalMarkingGuidance || '',
                totalQuestions: uniqueBaseQuestions.size,
                totalMarks: totalMarks || 100,
                persistenceType: 'auto',
                isAutoPersisted: true,
                autoCataloged: true,
                persistenceAudit: {
                    persistenceType: 'auto',
                    source: 'marking_pipeline',
                    persistedAt: nowIso,
                    triggeredByUserId: auditContext?.userId || null,
                    triggeredBySessionId: auditContext?.sessionId || null,
                    sourceFileName: auditContext?.sourceFileName || null,
                    extractionModel: 'gemini-3.7-flash'
                },
                uploadedAt: existingUploadedAt || nowIso,
                createdAt: existingCreatedAt || nowIso,
                updatedAt: nowIso
            }, { merge: true });

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
        extractedQuestions: Array<{ questionNumber?: string | null; text?: string }>,
        auditContext?: AutoPersistenceAuditContext
    ): Promise<void> {
        try {
            if (!this.isOfficialPastPaperScheme(parsedScheme)) return;
            if (!Array.isArray(extractedQuestions) || extractedQuestions.length < 3) return;

            const db = getFirestore();
            if (!db) return;

            const details = parsedScheme.examDetails;
            const board = String(details.board || '').trim();
            const paperCode = String(details.paperCode || '').trim().toUpperCase();
            const examSeries = String(details.exam_series || details.date || 'Unknown').trim();
            const subject = String(details.subject || '').trim();
            const qualification = String(details.qualification || 'GCSE (9-1)').trim();
            const tier = String(details.tier || 'N/A').trim();

            const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
            const docId = `official_paper_${slug(board)}_${slug(paperCode)}_${slug(examSeries)}`;

            const existingSnap = await db.collection('fullExamPapers').doc(docId).get();
            if (existingSnap.exists) {
                const existingData = existingSnap.data();
                const existingQuestions = existingData?.questions || {};
                const existingCount = Array.isArray(existingQuestions) ? existingQuestions.length : Object.keys(existingQuestions).length;
                if (existingCount >= extractedQuestions.length && existingData?.persistenceType) {
                    return;
                }
            }

            const subQuestionMaxScores: Record<string, number> = parsedScheme.subQuestionMaxScores || {};
            const totalPaperMarks = Object.values(subQuestionMaxScores).reduce((sum: number, v: any) => sum + (Number(v) || 0), 0) || 100;

            // Group extracted question texts by base question number
            const questionsMap: Record<string, any> = {};
            for (const q of extractedQuestions) {
                const rawNum = String(q.questionNumber || '').trim();
                const qText = String(q.text || '').trim();
                if (!rawNum || !qText) continue;
                const baseNum = getBaseQuestionNumber(rawNum) || rawNum;
                if (!questionsMap[baseNum]) {
                    // Sum marks for this base question from subQuestionMaxScores
                    const baseRegex = new RegExp(`^0*${baseNum}([^0-9]|$)`, 'i');
                    const qMarks = Object.entries(subQuestionMaxScores)
                        .filter(([k]) => baseRegex.test(k))
                        .reduce((s, [, m]) => s + (Number(m) || 0), 0);
                    questionsMap[baseNum] = {
                        number: baseNum,
                        question_number: baseNum,
                        text: qText,
                        question_text: qText,
                        marks: qMarks || undefined,
                        sub_questions: []
                    };
                } else if (!questionsMap[baseNum].question_text.includes(qText)) {
                    questionsMap[baseNum].question_text += `\n${qText}`;
                    questionsMap[baseNum].text = questionsMap[baseNum].question_text;
                }

                if (rawNum !== baseNum) {
                    const existingSub = questionsMap[baseNum].sub_questions.find((sq: any) => sq.question_number === rawNum);
                    if (!existingSub) {
                        questionsMap[baseNum].sub_questions.push({
                            part: rawNum,
                            number: rawNum,
                            question_number: rawNum,
                            text: qText,
                            question_text: qText,
                            marks: subQuestionMaxScores[rawNum] || undefined
                        });
                    }
                }
            }

            const questionsArray = Object.values(questionsMap).sort((a: any, b: any) => {
                const numA = parseInt(String(a.question_number), 10);
                const numB = parseInt(String(b.question_number), 10);
                if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
                return String(a.question_number).localeCompare(String(b.question_number));
            });

            if (questionsArray.length < 2) return;

            const nowIso = new Date().toISOString();
            const existingCreatedAt = existingSnap.exists ? existingSnap.data()?.createdAt : null;
            const existingUploadedAt = existingSnap.exists ? existingSnap.data()?.uploadedAt : null;

            const metadataBlock = {
                exam_board: board,
                board,
                qualification,
                exam_code: paperCode,
                paper_code: paperCode,
                exam_series: examSeries,
                tier,
                subject,
                total_marks: totalPaperMarks
            };

            await db.collection('fullExamPapers').doc(docId).set({
                exam: metadataBlock,
                metadata: metadataBlock,
                questions: questionsArray,
                totalQuestions: questionsArray.length,
                totalMarks: totalPaperMarks,
                persistenceType: 'auto',
                isAutoPersisted: true,
                autoCataloged: true,
                persistenceAudit: {
                    persistenceType: 'auto',
                    source: 'marking_pipeline',
                    persistedAt: nowIso,
                    triggeredByUserId: auditContext?.userId || null,
                    triggeredBySessionId: auditContext?.sessionId || null,
                    sourceFileName: auditContext?.sourceFileName || null,
                    extractionModel: 'gemini-3.7-flash'
                },
                uploadedAt: existingUploadedAt || nowIso,
                createdAt: existingCreatedAt || nowIso,
                updatedAt: nowIso
            }, { merge: true });

            QuestionDetectionService.invalidatePapersCache();
            console.log(`📄 [AUTO-CATALOG] Saved ${questionsArray.length} question stems to Firestore fullExamPapers/${docId}!`);
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
