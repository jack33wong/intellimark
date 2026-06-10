import { ModelProvider } from '../../utils/ModelProvider.js';
import { ModelType } from '../../types/index.js';

export interface GeometryAnalysisResult {
    is_acceptable_quality: boolean;
    rejection_reason?: string;
    needs_rotation: number;
    is_two_page_spread: boolean;
    is_marking_scheme: boolean;
}

interface RawGeometryAnalysisResult {
    visual_observations: string;
    is_acceptable_quality: boolean;
    rejection_reason: string;
    is_two_page_spread: boolean;
    is_marking_scheme: boolean;
}

export class ImageGeometryService {
    
    private static getSystemPrompt(): string {
        return `You are a strict Pre-flight Quality Inspector for a homework grading system.
Your job is to analyze the provided image of student homework and return a strict JSON response containing quality and layout metadata.

# Requirements
1. visual_observations (string): A brief Chain-of-Thought scratchpad. Describe the general clarity of the text and whether you see a physical spine or line dividing exactly two distinct pages side-by-side. Do this BEFORE evaluating the other fields.
2. is_acceptable_quality (boolean): Must be false if the image is extremely blurry, completely unreadable, photographed at an extreme skewed angle, or contains more than 2 pages squeezed into a single photo. Otherwise true.
3. rejection_reason (string): If is_acceptable_quality is false, provide a very short, user-friendly reason (e.g., "The image is too blurry to read"). Omit if true.
4. is_two_page_spread (boolean): Must be true ONLY if the image clearly shows exactly TWO distinct pages side-by-side (like an open booklet or textbook separated by a spine/fold). If it's just one single page, return false.
5. is_marking_scheme (boolean): Must be true ONLY if the image is an official marking scheme or rubric containing explicit grading codes (e.g., M1, A1, B1), structural mark distributions, or evaluator notes. CRITICAL: If the image is a student exam page, a blank question page with no handwriting, a formula sheet, or an appendix, you MUST return false. Do not assume a page is a marking scheme just because it lacks handwritten student work.

# Output Format
Return ONLY valid JSON matching this schema:
{
    "visual_observations": string,
    "is_acceptable_quality": boolean,
    "rejection_reason": string,
    "is_two_page_spread": boolean,
    "is_marking_scheme": boolean
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
                is_marking_scheme: Boolean(parsed.is_marking_scheme)
            };

        } catch (error) {
            console.error('❌ [ImageGeometryService] Failed to analyze image geometry:', error);
            // Fallback to safe defaults if the LLM fails
            return {
                is_acceptable_quality: true,
                needs_rotation: 0,
                is_two_page_spread: false,
                is_marking_scheme: false
            };
        }
    }
}
