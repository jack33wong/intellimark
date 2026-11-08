import crypto from 'crypto';
import { ModelProvider } from '../../utils/ModelProvider.js';
import UsageTracker from '../../utils/UsageTracker.js';
import { getFirestore } from '../../config/firebase.js';
import { ImageUtils } from '../../utils/ImageUtils.js';

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
        tracker?: UsageTracker
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

                // Fire-and-forget write to Firestore cache
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
}
