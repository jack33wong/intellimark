import { ModelProvider } from '../../utils/ModelProvider.js';
import { getPrompt } from '../../config/prompts.js';
import UsageTracker from '../../utils/UsageTracker.js';

export interface PageMap {
    pageIndex: number;
    questions: string[]; // List of question numbers (e.g., "1", "2a", "3")
    category?: "frontPage" | "questionAnswer" | "questionOnly"; // Front page/cover sheet, question with student work, or question only
}

export class ClassificationMapper {
    /**
     * Map Pass: Identify which questions are on which pages using a cheap model (Flash).
     * @param images Array of images to map
     * @param tracker Optional UsageTracker for recording API usage
     * @returns Array of page maps
     */
    static async mapQuestionsToPages(
        images: Array<{ imageData: string; fileName?: string; pageIndex: number }>,
        tracker?: UsageTracker,  // UsageTracker (optional)
        model?: string  // User-selected model (defaults to gemini-2.0-flash for backward compatibility)
    ): Promise<PageMap[]> {
        // Use user-selected model or default to Flash for cost optimization
        const MAPPING_MODEL = model || 'gemini-2.0-flash';

        console.log(`[MAPPER] Using model: ${MAPPING_MODEL}`);
        console.log(`[MAPPER] Starting Map Pass for ${images.length} pages...`);
        const startTime = Date.now(); // Track performance

        // SINGLE BATCH: Process all pages at once to maintain full context (e.g. Q11 on Page 13 -> Q11 on Page 12)
        // Gemini 1.5 Flash has 1M context window, so 50 images is trivial.
        const processAllPages = async () => {
            const systemPrompt = getPrompt('classification.mapper.system', images.length);
            const userPrompt = getPrompt('classification.mapper.user', images.length);
            const accessToken = ModelProvider.getGeminiApiKey();

            const parts: any[] = [
                { text: systemPrompt },
                { text: userPrompt }
            ];

            images.forEach((img, index) => {
                let mimeType = 'image/jpeg';
                let cleanData = img.imageData;

                if (img.imageData.includes(';base64,')) {
                    const parts = img.imageData.split(';base64,');
                    mimeType = parts[0].replace('data:', '');
                    cleanData = parts[1];
                } else if (img.imageData.includes(',')) {
                    cleanData = img.imageData.split(',')[1];
                }

                parts.push({ text: `\n--- Page Index ${index} ---` });
                parts.push({ inline_data: { mime_type: mimeType, data: cleanData } });
            });

            const { getModelConfig } = await import('../../config/aiModels.js');
            const config = getModelConfig(MAPPING_MODEL as any);

            const response = await ModelProvider.withRetry(async () => {
                const res = await fetch(`${config.apiEndpoint}?key=${accessToken}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        contents: [{ parts }],
                        generationConfig: {
                            temperature: 0.1,
                            maxOutputTokens: 8192, // Increased for larger output
                            responseMimeType: "application/json"
                        }
                    })
                });

                if (!res.ok) {
                    if (res.status === 429) throw new Error(`Gemini API error: 429 Too Many Requests`); // Explicitly throw 429 for retry match
                    if (res.status === 503) throw new Error(`Gemini API error: 503 Service Unavailable`);
                    const txt = await res.text();
                    throw new Error(`Gemini API error: ${res.status} - ${txt}`);
                }
                return res;
            });

            if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);

            const result = await response.json() as any;
            const content = result.candidates?.[0]?.content?.parts?.[0]?.text;

            // Extract token usage and record via tracker
            if (tracker) {
                const inputTokens = result.usageMetadata?.promptTokenCount || 0;
                const outputTokens = result.usageMetadata?.candidatesTokenCount || 0;
                tracker.recordMapper(inputTokens, outputTokens);  // Use mapper phase
            }

            let parsed: any;
            try {
                parsed = JSON.parse(content.replace(/```json\n|\n```/g, ''));
            } catch (e) { parsed = { pages: [] }; }

            const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
            const results: PageMap[] = [];

            // Fill exactly images.length results
            for (let i = 0; i < images.length; i++) {
                const p = pages[i] || { questions: [], category: undefined };
                const result: PageMap = {
                    pageIndex: i,
                    questions: p.questions || [],
                    category: p.category
                };
                results.push(result);

                // Debug logging for pages with Q2 - REMOVED
            }
            return results;
        };

        // Execute single batch
        try {
            const allPages = await processAllPages();

            const duration = (Date.now() - startTime) / 1000;
            console.log(`✅ [MAPPER] Map Pass complete in ${duration.toFixed(2)}s. Mapped ${allPages.length} pages.`);

            return allPages;
        } catch (error) {
            console.error('❌ [MAPPER] Map Pass failed:', error);
            return [];
        }
    }
}
