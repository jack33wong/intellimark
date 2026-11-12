import { ModelProvider } from '../../utils/ModelProvider.js';
import { ModelType } from '../../types/index.js';
import { cleanSubjectAndQualification } from './MarkingHelpers.js';

export interface GeometryAnalysisResult {
    is_acceptable_quality: boolean;
    rejection_reason?: string;
    needs_rotation: number;
    is_two_page_spread: boolean;
    is_marking_scheme: boolean;
    is_supported_doc?: boolean;
    evidence_text_snippet?: string;
    detected_subject?: 'MATHS' | 'ENGLISH_LANGUAGE' | 'ENGLISH_LITERATURE' | 'UNSUPPORTED_SUBJECT' | 'NON_ACADEMIC';
    unsupported_subject_name?: string;
    paper_code_hint?: string;
    /** Total/maximum mark for the WHOLE paper if printed on this page (usually the cover). */
    paper_total_marks_hint?: number;
}

export const KNOWN_ACADEMIC_SUBJECTS = new Set([
    'biology', 'chemistry', 'physics', 'science', 'combined science', 'natural sciences',
    'history', 'geography', 'religious studies', 'philosophy', 'economics', 'business',
    'business studies', 'psychology', 'sociology', 'politics', 'government', 'law',
    'french', 'spanish', 'german', 'latin', 'mandarin', 'chinese', 'italian', 'russian',
    'english literature', 'music', 'art', 'drama', 'theatre', 'theatre studies',
    'computer science', 'computing', 'information technology', 'physical education', 'pe',
    'design and technology', 'dt', 'media studies', 'statistics', 'geology', 'environmental science'
]);

export function isRecognizedAcademicSubject(subjectName?: string): boolean {
    if (!subjectName || typeof subjectName !== 'string') return false;
    const clean = subjectName.trim().toLowerCase();
    if (clean.length < 2) return false;
    if (/^(other|unknown|none|this subject|general|n\/a|not educational|non-academic|parking|notice|rules|instructions|venue|candidate|exam info|exam information)$/i.test(clean)) {
        return false;
    }
    return Array.from(KNOWN_ACADEMIC_SUBJECTS).some(s => clean.includes(s) || s.includes(clean));
}

interface RawGeometryAnalysisResult {
    visual_observations: string;
    is_acceptable_quality: boolean;
    rejection_reason: string;
    is_two_page_spread: boolean;
    is_marking_scheme: boolean;
    is_supported_doc: boolean;
    evidence_text_snippet: string;
    detected_subject?: 'MATHS' | 'ENGLISH_LANGUAGE' | 'ENGLISH_LITERATURE' | 'UNSUPPORTED_SUBJECT' | 'NON_ACADEMIC';
    unsupported_subject_name?: string;
    paper_code_hint?: string;
    paper_total_marks_hint?: number | string | null;
}

export class ImageGeometryService {
    
    private static getSystemPrompt(): string {
        return `You are a strict Pre-flight Quality Inspector for an academic exam & homework grading system.
Your job is to analyze the provided image of student homework or exam booklet and return a strict JSON response containing quality, subject, and layout metadata.

# Requirements
1. visual_observations (string): A brief Chain-of-Thought scratchpad (maximum 40 words). Describe the general clarity of the text, the academic subject (Mathematics, GCSE English Language, etc.), and whether you see a physical spine or line dividing two distinct pages side-by-side. Do NOT transcribe the entire page.

2. is_acceptable_quality (boolean): Must be false if the image is extremely blurry, completely unreadable, photographed at an extreme skewed angle, or contains more than 2 pages squeezed into a single photo. Otherwise true.
3. is_two_page_spread (boolean): Must be true ONLY if the image is a wide/landscape capture showing two FULL, complete pages side-by-side (roughly 50% left page and 50% right page separated by a central spine/fold) where BOTH pages are meant to be read and graded. CRITICAL: If the photo is a single portrait page where the booklet spine or a partial edge/corner of the adjacent page is merely peeking into the left or right margin, you MUST return false.
4. is_marking_scheme (boolean): Must be true ONLY if the image is an official marking scheme, mark scheme table, or rubric containing explicit grading codes (e.g., M1, A1, B1, AO1, AO2, AO3, Level 4 Perceptive), mark scheme table columns (e.g., "Question | Answers | Extra information | Mark | AO / Spec. Ref."), examiner guidance phrases (e.g., "allow", "ignore", "do not accept", "any two from"), structural mark distributions, or evaluator notes. CRITICAL EXCEPTION: Standard exam cover pages or title pages containing student name fields, candidate signatures, and "For Examiner's Use" mark tally grids are NOT marking schemes; return false for these. CRITICAL: Do NOT eject pages that contain large maps, graphs, reading insert extracts (Source A / Source B), or diagrams. You must scan the entire page. If there are question numbers (e.g., '1.1.1', '01', '02', 'Q5'), reading extracts, or student answer spaces beneath the image, it is an active exam page and MUST be kept in the array. Do not assume a page is a marking scheme just because it lacks handwritten student work.
5. is_supported_doc (boolean): Verify that the document belongs to our **fully supported active subjects**:
   - **SUPPORTED ACTIVE SUBJECTS (MUST SET \`is_supported_doc: true\`)**:
     1. **Mathematics / Further Maths / Statistics / Numeracy** (GCSE, IGCSE, A-Level, homework, working, graphs, geometry). Set \`detected_subject: "MATHS"\`.
     2. **GCSE / IGCSE / A-Level English Language** (AQA 8700, Edexcel 1EN0, OCR J351, reading inserts Source A / Source B, comprehension, language/structure analysis, creative/transactional writing Q5). Set \`detected_subject: "ENGLISH_LANGUAGE"\`.
   - **UNSUPPORTED ACADEMIC SUBJECTS (MUST SET \`is_supported_doc: false\` AND \`detected_subject: "UNSUPPORTED_SUBJECT"\` / \`"ENGLISH_LITERATURE"\` as appropriate)**:
     - **GCSE English Literature** (AQA 8702, Edexcel 1ET0, Macbeth, A Christmas Carol, An Inspector Calls, poetry essays). Set \`detected_subject: "ENGLISH_LITERATURE"\`.
     - **Science Subjects** (Biology, Chemistry, Physics, Combined Science like AQA 8461/8464, Edexcel 1BI0/1SC0). Set \`detected_subject: "UNSUPPORTED_SUBJECT"\` and \`unsupported_subject_name: "Combined Science: Trilogy"\` (or Biology/Chemistry/Physics, WITHOUT any "GCSE" or "A-Level" prefix).
     - **Other Academic Humanities / Languages** (History, Geography, Computer Science, French, Spanish, etc.). Set \`detected_subject: "UNSUPPORTED_SUBJECT"\` and provide \`unsupported_subject_name\` (e.g. "Geography", "History", WITHOUT any "GCSE" or "A-Level" prefix).
   - **EXAM COVER PAGES**:
     - If the page is a standard exam booklet cover page (with exam board logos, candidate name/number boxes, and "Instructions for Candidates"), classify \`detected_subject\` and \`unsupported_subject_name\` according to the exam subject printed on the cover (e.g., \`"MATHS"\`, \`"ENGLISH_LANGUAGE"\`, or \`"UNSUPPORTED_SUBJECT"\` with \`"Biology"\`), NEVER \`"NON_ACADEMIC"\`.
   - **NON-ACADEMIC CONTENT (CRITICAL: MUST SET \`is_supported_doc: false\` AND \`detected_subject: "NON_ACADEMIC"\`)**:
     - Parking instructions, venue directions, arrival times/rules, checklists, receipts, invoices, banknotes, selfies, general non-educational documents, or random photos.
     - Set \`detected_subject: "NON_ACADEMIC"\`, \`unsupported_subject_name: ""\`, and \`rejection_reason: "Not educational exam content: Please upload an academic exam question or student homework."\`.
   - **ZERO-FALSE-ALARM GUARD FOR MATHS & ENGLISH LANGUAGE**:
     - If a Maths question uses a science context (e.g., bacteria growth rates, magnification, density, or physics word problems) or an English Language reading extract talks about nature or science, you **MUST** set \`is_supported_doc: true\` and \`detected_subject: "MATHS"\` or \`"ENGLISH_LANGUAGE"\`. Only reject when it is unmistakably an unsupported subject.

6. detected_subject ("MATHS" | "ENGLISH_LANGUAGE" | "ENGLISH_LITERATURE" | "UNSUPPORTED_SUBJECT" | "NON_ACADEMIC"):
   - Set to \`"ENGLISH_LANGUAGE"\` for English Language.
   - Set to \`"ENGLISH_LITERATURE"\` for English Literature.
   - Set to \`"UNSUPPORTED_SUBJECT"\` for academic Sciences, Humanities, or other academic subjects.
   - Set to \`"NON_ACADEMIC"\` for non-academic content (parking notices, venue guides, receipts, selfies, general non-exam notices).
   - Otherwise default to \`"MATHS"\`.

7. unsupported_subject_name (string): 
   - If \`detected_subject === "ENGLISH_LITERATURE"\`, set to \`"English Literature"\`.
   - If \`detected_subject === "UNSUPPORTED_SUBJECT"\`, set to the detected subject name (e.g., \`"Biology"\`, \`"Chemistry"\`, \`"Physics"\`, \`"History"\`, \`"Geography"\`). Otherwise \`""\`.

8. paper_code_hint (string): If a paper code or title is visible on the cover/header/footer (e.g., "8700/1", "8700/2", "8702/1", "8461/1H", "1MA1/1H", "AQA GCSE English Language Paper 1"), extract it briefly. Otherwise "".

8b. paper_total_marks_hint (integer | null): ONLY if this page explicitly prints the total/maximum mark for the WHOLE paper (typically the cover page, e.g. "The maximum mark for this paper is 100", "The total mark for this paper is 80", "Total for paper: 60 marks"), return that integer. Do NOT use per-question marks or mark tally grids. Otherwise null.

9. rejection_reason (string):
   - If \`detected_subject === "NON_ACADEMIC"\` or non-academic content:
     Return: \`"Not educational exam content: Please upload an academic exam question or student homework."\`
   - If \`detected_subject === "ENGLISH_LITERATURE"\`:
     Return: \`"GCSE English Literature (Macbeth, A Christmas Carol, An Inspector Calls) is currently in beta and launching soon! Right now, we fully support GCSE & A-Level Mathematics and GCSE English Language (8700 / 1EN0 / J351) with verified official mark schemes and grade boundaries."\`
   - If \`detected_subject === "UNSUPPORTED_SUBJECT"\` and \`unsupported_subject_name\`:
     Return: \`"Unsupported subject (" + unsupported_subject_name + "): Marking scheme required for this subject."\`
   - If \`is_acceptable_quality\` is false, provide a short, user-friendly quality reason.
   - If \`is_supported_doc\` is false for another reason (e.g. non-academic invoice/banknote/selfie), return: \`"Not educational exam content: Please upload an academic exam question or student homework."\`
   - Otherwise \`""\`.

10. evidence_text_snippet (string): If you set \`is_supported_doc\` to false, provide the first 20 words as proof. Otherwise omit or leave empty.

# Output Format
Return ONLY valid JSON matching this schema:
{
    "visual_observations": string,
    "is_acceptable_quality": boolean,
    "rejection_reason": string,
    "is_two_page_spread": boolean,
    "is_marking_scheme": boolean,
    "is_supported_doc": boolean,
    "detected_subject": "MATHS" | "ENGLISH_LANGUAGE" | "ENGLISH_LITERATURE" | "UNSUPPORTED_SUBJECT" | "NON_ACADEMIC",
    "unsupported_subject_name": string,
    "paper_code_hint": string,
    "paper_total_marks_hint": number | null,
    "evidence_text_snippet": string
}`;
    }

    /**
     * "Pre-flight Quality Inspector"
     * Analyzes every uploaded image BEFORE expensive OCR or classification begins.
     * Purpose:
     * 1. Detect and reject blurry, unreadable, or non-educational images (saves compute cost).
     * 2. Detect layout issues like two-page spreads.
     * 3. Detect if the user accidentally uploaded a marking scheme instead of student work.
     * 
     * @param base64Image The base64 image data to analyze
     * @param width The image width
     * @param height The image height
     * @param model The model to use (defaults to fast tier, but overridden internally)
     * @param tracker Optional usage tracker
     * @returns GeometryAnalysisResult
     */
    static async analyze(
        base64Image: string,
        width?: number,
        height?: number,
        model: ModelType | 'fast' | 'thinking' | 'pro' | 'auto' = 'fast',
        tracker?: any
    ): Promise<GeometryAnalysisResult> {
        try {
            const prompt = this.getSystemPrompt();
            
            // Print detailed prompt log if enabled
            if (process.env.LOG_GEOMETRY_SYSTEM_PROMPT === 'true') {
                console.log(`\n================ GEOMETRY SYSTEM PROMPT ================`);
                console.log(prompt);
                console.log(`========================================================\n`);
            }
            
            const response = await ModelProvider.callGeminiChat(
                prompt,
                "Analyze this image and return the JSON.",
                base64Image,
                // CRITICAL: We hardcode 'gemini-2.5-flash' here regardless of the user's selected tier (Pro/Auto).
                // Because this pre-flight check runs on EVERY single page, it acts as a cheap filter.
                // gemini-2.5-flash is extremely fast and cost-effective, preventing us from burning
                // expensive Pro or 3.7-flash tokens just to check if an image is blurry.
                'gemini-2.5-flash', 
                true, // forceJsonResponse
                tracker,
                'preFlight'
            );

            let content = response.content.trim();
            
            // Clean up markdown formatting if present
            if (content.startsWith('\`\`\`json')) {
                content = content.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
            } else if (content.startsWith('\`\`\`')) {
                content = content.replace(/\`\`\`/g, '').trim();
            }

            const parsed = JSON.parse(content) as RawGeometryAnalysisResult;
            
            // Print pretty JSON if enabled, otherwise print single line
            if (process.env.DEBUG_SEMANTIC_GEOMETRY === 'true') {
                if (process.env.LOG_GEOMETRY_SYSTEM_PROMPT === 'true') {
                    console.log(`\n🤖 [SEMANTIC GEOMETRY AI DEBUG] Pretty Response:\n${JSON.stringify(parsed, null, 2)}\n`);
                } else {
                    console.log(`🤖 [SEMANTIC GEOMETRY AI DEBUG] Response for image: ${JSON.stringify(parsed)}`);
                }
            }

            // Deterministic physical geometry guard: An upright side-by-side 2-page spread MUST be wider than it is tall.
            const isPhysicallyLandscape = (width && height) ? (width > height * 1.05) : true;

            // Strict Non-Academic / Administrative / Logistical Content Guard:
            // Parking directions, venue rules, arrival instructions, receipts, selfies, etc.
            // Note: Do NOT include "instructions for candidate" because standard GCSE/A-Level exam cover pages print that phrase.
            const observationText = `${parsed.visual_observations || ''} ${parsed.evidence_text_snippet || ''} ${parsed.rejection_reason || ''}`.toLowerCase();
            const hasRecognizedAcademicSubject =
                parsed.detected_subject === 'MATHS' ||
                parsed.detected_subject === 'ENGLISH_LANGUAGE' ||
                parsed.detected_subject === 'ENGLISH_LITERATURE' ||
                (parsed.detected_subject === 'UNSUPPORTED_SUBJECT' && isRecognizedAcademicSubject(parsed.unsupported_subject_name));

            const isNonAcademicContent =
                parsed.detected_subject === 'NON_ACADEMIC' ||
                (!hasRecognizedAcademicSubject &&
                    /parking|car park|arrival time|doors open|venue direction|desk card|receipt|invoice|banknote|selfie/i.test(observationText));

            if (isNonAcademicContent) {
                parsed.detected_subject = 'NON_ACADEMIC';
                parsed.is_supported_doc = false;
                parsed.unsupported_subject_name = '';
                parsed.rejection_reason = 'Not educational exam content: Please upload an academic exam question or student homework.';
            } else if (parsed.detected_subject === 'UNSUPPORTED_SUBJECT' && !isRecognizedAcademicSubject(parsed.unsupported_subject_name)) {
                // If it was flagged as unsupported subject but the subject is not a genuine academic discipline, classify as non-academic
                parsed.detected_subject = 'NON_ACADEMIC';
                parsed.is_supported_doc = false;
                parsed.unsupported_subject_name = '';
                parsed.rejection_reason = 'Not educational exam content: Please upload an academic exam question or student homework.';
            }

            // Double-guard: If the AI classified the subject as ENGLISH_LANGUAGE or MATHS, it is by definition supported!
            const isSupportedBySubject = parsed.detected_subject === 'MATHS' || parsed.detected_subject === 'ENGLISH_LANGUAGE';
            const isSupportedDoc = isSupportedBySubject ? true : (parsed.is_supported_doc === undefined ? true : Boolean(parsed.is_supported_doc));

            return {
                is_acceptable_quality: Boolean(parsed.is_acceptable_quality),
                rejection_reason: parsed.rejection_reason || undefined,
                needs_rotation: 0, // Rotation is handled by Vision now
                is_two_page_spread: Boolean(parsed.is_two_page_spread) && isPhysicallyLandscape,
                is_marking_scheme: Boolean(parsed.is_marking_scheme),
                is_supported_doc: isSupportedDoc,
                evidence_text_snippet: parsed.evidence_text_snippet || undefined,
                detected_subject: parsed.detected_subject || undefined,
                unsupported_subject_name: parsed.unsupported_subject_name
                    ? cleanSubjectAndQualification(parsed.unsupported_subject_name).subject || parsed.unsupported_subject_name
                    : undefined,
                paper_code_hint: parsed.paper_code_hint || undefined,
                paper_total_marks_hint: (() => {
                    const n = Number(parsed.paper_total_marks_hint);
                    return Number.isInteger(n) && n >= 10 && n <= 400 ? n : undefined;
                })()
            };

        } catch (error) {
            console.error('❌ [ImageGeometryService] Failed to analyze image geometry:', error);
            // Fallback to safe defaults if the LLM fails
            return {
                is_acceptable_quality: true,
                needs_rotation: 0,
                is_two_page_spread: false,
                is_marking_scheme: false,
                is_supported_doc: true // Fall open to let OCR handle it
            };
        }
    }
}
