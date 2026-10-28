import { ModelProvider } from '../../utils/ModelProvider.js';
import { ModelType } from '../../types/index.js';

export interface GeometryAnalysisResult {
    is_acceptable_quality: boolean;
    rejection_reason?: string;
    needs_rotation: number;
    is_two_page_spread: boolean;
    is_marking_scheme: boolean;
    is_math_content?: boolean;
    evidence_text_snippet?: string;
    detected_subject?: 'MATHS' | 'ENGLISH_LANGUAGE' | 'ENGLISH_LITERATURE';
    paper_code_hint?: string;
}

interface RawGeometryAnalysisResult {
    visual_observations: string;
    is_acceptable_quality: boolean;
    rejection_reason: string;
    is_two_page_spread: boolean;
    is_marking_scheme: boolean;
    is_math_content: boolean;
    evidence_text_snippet: string;
    detected_subject?: 'MATHS' | 'ENGLISH_LANGUAGE' | 'ENGLISH_LITERATURE';
    paper_code_hint?: string;
}

export class ImageGeometryService {
    
    private static getSystemPrompt(): string {
        return `You are a strict Pre-flight Quality Inspector for an academic exam & homework grading system.
Your job is to analyze the provided image of student homework or exam booklet and return a strict JSON response containing quality, subject, and layout metadata.

# Requirements
1. visual_observations (string): A brief Chain-of-Thought scratchpad. Describe the general clarity of the text, the academic subject (Mathematics, GCSE English Language, GCSE English Literature, etc.), and whether you see a physical spine or line dividing exactly two distinct pages side-by-side. Do this BEFORE evaluating the other fields.
2. is_acceptable_quality (boolean): Must be false if the image is extremely blurry, completely unreadable, photographed at an extreme skewed angle, or contains more than 2 pages squeezed into a single photo. Otherwise true.
3. is_two_page_spread (boolean): Must be true ONLY if the image is a wide/landscape capture showing two FULL, complete pages side-by-side (roughly 50% left page and 50% right page separated by a central spine/fold) where BOTH pages are meant to be read and graded. CRITICAL: If the photo is a single portrait page where the booklet spine or a partial edge/corner of the adjacent page is merely peeking into the left or right margin, you MUST return false.
4. is_marking_scheme (boolean): Must be true ONLY if the image is an official marking scheme or rubric containing explicit grading codes (e.g., M1, A1, B1, AO1, AO2, Level 4 Perceptive), structural mark distributions, or evaluator notes. CRITICAL EXCEPTION: Standard exam cover pages or title pages containing student name fields, candidate signatures, and "For Examiner's Use" mark tally grids are NOT marking schemes; return false for these. CRITICAL: Do NOT eject pages that contain large maps, graphs, reading insert extracts (Source A / Source B), or diagrams. You must scan the entire page. If there are question numbers (e.g., '1.1.1', '01', '02', 'Q5'), reading extracts, or student answer spaces beneath the image, it is an active exam page and MUST be kept in the array. Do not assume a page is a marking scheme just because it lacks handwritten student work.
5. is_math_content (boolean): Verify that the document is valid academic content. This includes Mathematics, Mathematical Literacy, GCSE/A-Level English Language (including reading inserts Source A / Source B, comprehension, and creative/descriptive/transactional writing), GCSE/A-Level English Literature (Shakespeare, novels, drama, poetry essays), Physics, Chemistry, Geography, Accounting, or ANY exam paper / student homework / handwritten essay. If the document is a financial certificate/bond/banknote/receipt/invoice, an ID/official certificate, or clearly belongs to a non-educational subject (like a random selfie or food photo), you must set this to false. Otherwise true. CRITICAL: If you see ANY exam question numbers (e.g., 1.1, Q2, 01, 05), mathematical equations/working, handwritten essays/creative writing, reading extracts, student homework, or an academic map/graph/diagram, you MUST set this to true (never make a false positive on real student work or exam pages).
6. detected_subject ("MATHS" | "ENGLISH_LANGUAGE" | "ENGLISH_LITERATURE"):
   - Set to "ENGLISH_LANGUAGE" if the page belongs to GCSE/IGCSE English Language (e.g., AQA 8700, Edexcel 1EN0, OCR J351, Eduqas C700, "Explorations in creative reading and writing", "Writers' viewpoints and perspectives", "Source A", "Source B", language/structure analysis of an extract, or creative/descriptive story writing Q5).
   - Set to "ENGLISH_LITERATURE" if the page belongs to GCSE/IGCSE English Literature (e.g., AQA 8702, Edexcel 1ET0, Shakespeare plays like Macbeth/Romeo and Juliet, 19th-century novels like A Christmas Carol/Jekyll and Hyde, modern texts like An Inspector Calls, or Power and Conflict / Unseen Poetry essays).
   - Otherwise default to "MATHS".
7. paper_code_hint (string): If a paper code or title is visible on the cover/header/footer (e.g., "8700/1", "8700/2", "8702/1", "1MA1/1H", "AQA GCSE English Language Paper 1"), extract it briefly. Otherwise "".
8. rejection_reason (string): If is_math_content is false, start with "Not academic exam content: " followed by a very short, user-friendly explanation. If is_acceptable_quality is false, provide a very short, user-friendly quality reason. Omit if both are true.
9. evidence_text_snippet (string): If you set is_math_content to false, provide the first 20 words as proof. Otherwise omit or leave empty.

# Output Format
Return ONLY valid JSON matching this schema:
{
    "visual_observations": string,
    "is_acceptable_quality": boolean,
    "rejection_reason": string,
    "is_two_page_spread": boolean,
    "is_marking_scheme": boolean,
    "is_math_content": boolean,
    "detected_subject": "MATHS" | "ENGLISH_LANGUAGE" | "ENGLISH_LITERATURE",
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

            return {
                is_acceptable_quality: Boolean(parsed.is_acceptable_quality),
                rejection_reason: parsed.rejection_reason || undefined,
                needs_rotation: 0, // Rotation is handled by Vision now
                is_two_page_spread: Boolean(parsed.is_two_page_spread) && isPhysicallyLandscape,
                is_marking_scheme: Boolean(parsed.is_marking_scheme),
                is_math_content: parsed.is_math_content === undefined ? true : Boolean(parsed.is_math_content),
                evidence_text_snippet: parsed.evidence_text_snippet || undefined,
                detected_subject: parsed.detected_subject || undefined,
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
                is_math_content: true // Fall open to let OCR handle it
            };
        }
    }
}
