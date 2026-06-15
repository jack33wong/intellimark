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
}

interface RawGeometryAnalysisResult {
    visual_observations: string;
    is_acceptable_quality: boolean;
    rejection_reason: string;
    is_two_page_spread: boolean;
    is_marking_scheme: boolean;
    is_math_content: boolean;
    evidence_text_snippet: string;
}

export class ImageGeometryService {
    
    private static getSystemPrompt(): string {
        return `You are a strict Pre-flight Quality Inspector for a homework grading system.
Your job is to analyze the provided image of student homework and return a strict JSON response containing quality and layout metadata.

# Requirements
1. visual_observations (string): A brief Chain-of-Thought scratchpad. Describe the general clarity of the text and whether you see a physical spine or line dividing exactly two distinct pages side-by-side. Do this BEFORE evaluating the other fields.
2. is_acceptable_quality (boolean): Must be false if the image is extremely blurry, completely unreadable, photographed at an extreme skewed angle, or contains more than 2 pages squeezed into a single photo. Otherwise true.
3. is_two_page_spread (boolean): Must be true ONLY if the image clearly shows exactly TWO distinct pages side-by-side (like an open booklet or textbook separated by a spine/fold). If it's just one single page, return false.
4. is_marking_scheme (boolean): Must be true ONLY if the image is an official marking scheme or rubric containing explicit grading codes (e.g., M1, A1, B1), structural mark distributions, or evaluator notes. CRITICAL: If the image is a student exam page, a blank question page with no handwriting, a formula sheet, or an appendix, you MUST return false. Do not assume a page is a marking scheme just because it lacks handwritten student work.
5. is_math_content (boolean): You must verify the academic subject of the document. If the document is an essay, a piece of creative writing, or clearly belongs to a non-mathematical subject (like English, History, or Geography), you must set this to false. Otherwise true.
6. rejection_reason (string): If is_acceptable_quality or is_math_content is false, provide a very short, user-friendly reason (e.g., "The image is too blurry to read" or "Document appears to be an English essay, not a mathematics paper."). Omit if both are true.
7. evidence_text_snippet (string): If you set is_math_content to false, you MUST also provide an evidence_text_snippet containing the first 20 to 30 words transcribed directly from the document to serve as proof of the subject matter. Otherwise omit or leave empty.

# Output Format
Return ONLY valid JSON matching this schema:
{
    "visual_observations": string,
    "is_acceptable_quality": boolean,
    "rejection_reason": string,
    "is_two_page_spread": boolean,
    "is_marking_scheme": boolean,
    "is_math_content": boolean,
    "evidence_text_snippet": string
}`;
    }

    /**
     * Analyzes an image for quality, orientation, and spread layout.
     * @param base64Image The base64 image data to analyze
     * @param width The image width
     * @param height The image height
     * @param model The model to use (defaults to fast tier)
     * @param tracker Optional usage tracker
     * @returns GeometryAnalysisResult
     */
    static async analyze(
        base64Image: string,
        width?: number,
        height?: number,
        model: ModelType = 'gemini-3.1-flash-lite',
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
                'gemini-3.1-flash-lite', // Hardcoded as per design
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
            if (process.env.LOG_GEOMETRY_SYSTEM_PROMPT === 'true') {
                console.log(`\n🤖 [SEMANTIC GEOMETRY AI DEBUG] Pretty Response:\n${JSON.stringify(parsed, null, 2)}\n`);
            } else {
                console.log(`🤖 [SEMANTIC GEOMETRY AI DEBUG] Response for image: ${JSON.stringify(parsed)}`);
            }

            return {
                is_acceptable_quality: Boolean(parsed.is_acceptable_quality),
                rejection_reason: parsed.rejection_reason || undefined,
                needs_rotation: 0, // Rotation is handled by Vision now
                is_two_page_spread: Boolean(parsed.is_two_page_spread),
                is_marking_scheme: Boolean(parsed.is_marking_scheme),
                is_math_content: parsed.is_math_content === undefined ? true : Boolean(parsed.is_math_content),
                evidence_text_snippet: parsed.evidence_text_snippet || undefined
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
