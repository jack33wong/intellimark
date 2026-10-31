import { ModelProvider } from '../../utils/ModelProvider.js';
import { ModelType } from '../../types/index.js';

export interface GeometryAnalysisResult {
    is_acceptable_quality: boolean;
    rejection_reason?: string;
    needs_rotation: number;
    is_two_page_spread: boolean;
    is_marking_scheme: boolean;
    is_supported_doc?: boolean;
    evidence_text_snippet?: string;
    detected_subject?: 'MATHS' | 'ENGLISH_LANGUAGE' | 'ENGLISH_LITERATURE' | 'UNSUPPORTED_SUBJECT';
    unsupported_subject_name?: string;
    paper_code_hint?: string;
}

interface RawGeometryAnalysisResult {
    visual_observations: string;
    is_acceptable_quality: boolean;
    rejection_reason: string;
    is_two_page_spread: boolean;
    is_marking_scheme: boolean;
    is_supported_doc: boolean;
    evidence_text_snippet: string;
    detected_subject?: 'MATHS' | 'ENGLISH_LANGUAGE' | 'ENGLISH_LITERATURE' | 'UNSUPPORTED_SUBJECT';
    unsupported_subject_name?: string;
    paper_code_hint?: string;
}

export class ImageGeometryService {
    
    private static getSystemPrompt(): string {
        return `You are a strict Pre-flight Quality Inspector for an academic exam & homework grading system.
Your job is to analyze the provided image of student homework or exam booklet and return a strict JSON response containing quality, subject, and layout metadata.

# Requirements
1. visual_observations (string): A brief Chain-of-Thought scratchpad. Describe the general clarity of the text, the academic subject (Mathematics, GCSE English Language, etc.), and whether you see a physical spine or line dividing exactly two distinct pages side-by-side.

2. is_acceptable_quality (boolean): Must be false if the image is extremely blurry, completely unreadable, photographed at an extreme skewed angle, or contains more than 2 pages squeezed into a single photo. Otherwise true.
3. is_two_page_spread (boolean): Must be true ONLY if the image is a wide/landscape capture showing two FULL, complete pages side-by-side (roughly 50% left page and 50% right page separated by a central spine/fold) where BOTH pages are meant to be read and graded. CRITICAL: If the photo is a single portrait page where the booklet spine or a partial edge/corner of the adjacent page is merely peeking into the left or right margin, you MUST return false.
4. is_marking_scheme (boolean): Must be true ONLY if the image is an official marking scheme or rubric containing explicit grading codes (e.g., M1, A1, B1, AO1, AO2, Level 4 Perceptive), structural mark distributions, or evaluator notes. CRITICAL EXCEPTION: Standard exam cover pages or title pages containing student name fields, candidate signatures, and "For Examiner's Use" mark tally grids are NOT marking schemes; return false for these. CRITICAL: Do NOT eject pages that contain large maps, graphs, reading insert extracts (Source A / Source B), or diagrams. You must scan the entire page. If there are question numbers (e.g., '1.1.1', '01', '02', 'Q5'), reading extracts, or student answer spaces beneath the image, it is an active exam page and MUST be kept in the array. Do not assume a page is a marking scheme just because it lacks handwritten student work.
5. is_supported_doc (boolean): Verify that the document belongs to our **fully supported active subjects**:
   - **SUPPORTED ACTIVE SUBJECTS (MUST SET \`is_supported_doc: true\`)**:
     1. **Mathematics / Further Maths / Statistics / Numeracy** (GCSE, IGCSE, A-Level, homework, working, graphs, geometry). Set \`detected_subject: "MATHS"\`.
     2. **GCSE / IGCSE / A-Level English Language** (AQA 8700, Edexcel 1EN0, OCR J351, reading inserts Source A / Source B, comprehension, language/structure analysis, creative/transactional writing Q5). Set \`detected_subject: "ENGLISH_LANGUAGE"\`.
   - **UNSUPPORTED / COMING SOON SUBJECTS (MUST SET \`is_supported_doc: false\` AND \`detected_subject: "UNSUPPORTED_SUBJECT"\` / \`"ENGLISH_LITERATURE"\` as appropriate)**:
     - **GCSE English Literature** (AQA 8702, Edexcel 1ET0, Macbeth, A Christmas Carol, An Inspector Calls, poetry essays). Set \`detected_subject: "ENGLISH_LITERATURE"\`.
     - **Science Subjects** (Biology, Chemistry, Physics, Combined Science like AQA 8461/8464, Edexcel 1BI0/1SC0). Set \`detected_subject: "UNSUPPORTED_SUBJECT"\` and \`unsupported_subject_name: "Biology"\` (or Chemistry/Physics).
     - **Other Humanities / Languages** (History, Geography, Computer Science, French, Spanish, etc.). Set \`detected_subject: "UNSUPPORTED_SUBJECT"\`.
   - **ZERO-FALSE-ALARM GUARD FOR MATHS & ENGLISH LANGUAGE**:
     - If a Maths question uses a science context (e.g., bacteria growth rates, magnification, density, or physics word problems) or an English Language reading extract talks about nature or science, you **MUST** set \`is_supported_doc: true\` and \`detected_subject: "MATHS"\` or \`"ENGLISH_LANGUAGE"\`. Only reject when it is unmistakably an unsupported subject.

6. detected_subject ("MATHS" | "ENGLISH_LANGUAGE" | "ENGLISH_LITERATURE" | "UNSUPPORTED_SUBJECT"):
   - Set to \`"ENGLISH_LANGUAGE"\` for English Language.
   - Set to \`"ENGLISH_LITERATURE"\` for English Literature.
   - Set to \`"UNSUPPORTED_SUBJECT"\` for Sciences, Humanities, or other subjects.
   - Otherwise default to \`"MATHS"\`.

7. unsupported_subject_name (string): 
   - If \`detected_subject === "ENGLISH_LITERATURE"\`, set to \`"English Literature"\`.
   - If \`detected_subject === "UNSUPPORTED_SUBJECT"\`, set to the detected subject name (e.g., \`"Biology"\`, \`"Chemistry"\`, \`"Physics"\`, \`"History"\`, \`"Geography"\`). Otherwise \`""\`.

8. paper_code_hint (string): If a paper code or title is visible on the cover/header/footer (e.g., "8700/1", "8700/2", "8702/1", "8461/1H", "1MA1/1H", "AQA GCSE English Language Paper 1"), extract it briefly. Otherwise "".

9. rejection_reason (string):
   - If \`detected_subject === "ENGLISH_LITERATURE"\`:
     Return: \`"GCSE English Literature (Macbeth, A Christmas Carol, An Inspector Calls) is currently in beta and launching soon! Right now, we fully support GCSE & A-Level Mathematics and GCSE English Language (8700 / 1EN0 / J351) with verified official mark schemes and grade boundaries."\`
   - If \`detected_subject === "UNSUPPORTED_SUBJECT"\` and \`unsupported_subject_name\`:
     Return: \`"Unsupported subject (" + unsupported_subject_name + "): AI Marking currently supports GCSE & A-Level Mathematics and GCSE English Language with official mark schemes and grade boundaries. " + unsupported_subject_name + " support is coming soon!"\`
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
    "detected_subject": "MATHS" | "ENGLISH_LANGUAGE" | "ENGLISH_LITERATURE" | "UNSUPPORTED_SUBJECT",
    "unsupported_subject_name": string,
    "paper_code_hint": string,
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
                unsupported_subject_name: parsed.unsupported_subject_name || undefined,
                paper_code_hint: parsed.paper_code_hint || undefined
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
