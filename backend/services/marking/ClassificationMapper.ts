import { ModelProvider } from '../../utils/ModelProvider.js';
import { getPrompt } from '../../config/prompts.js';

export interface PageMap {
    pageIndex: number;
    questions: string[]; // List of question numbers (e.g., "1", "2a", "3")
}

export class ClassificationMapper {
    /**
     * Map Pass: Identify which questions are on which pages using a cheap model (Flash).
     * @param images Array of images to map
     * @returns Array of page maps
     */
    static async mapQuestionsToPages(
        images: Array<{ imageData: string; fileName?: string; pageIndex: number }>
    ): Promise<PageMap[]> {
        console.log(`[MAPPER] Starting Map Pass for ${images.length} pages using gemini-2.5-flash...`);
        const startTime = Date.now();

        // Dynamic Model Selection: Choose the cheapest Gemini model
        const { LLM_PRICING } = await import('../../config/pricing.js');
        const geminiModels = Object.keys(LLM_PRICING).filter(m => m.startsWith('gemini'));
        const cheapestModel = geminiModels.sort((a, b) => LLM_PRICING[a].input - LLM_PRICING[b].input)[0];
        const MAPPING_MODEL = cheapestModel || 'gemini-2.5-flash';
        console.log(`[MAPPER] Selected cheapest model for Map Pass: ${MAPPING_MODEL} ($${LLM_PRICING[MAPPING_MODEL]?.input}/1M input)`);

        // SINGLE BATCH: Process all pages at once to maintain full context (e.g. Q11 on Page 13 -> Q11 on Page 12)
        // Gemini 1.5 Flash has 1M context window, so 50 images is trivial.
        const processAllPages = async () => {
            const systemPrompt = `You are a fast document scanner.
            GOAL: List ONLY the question numbers visible on each page.
            
            RULES:
            1. Look for question numbers (e.g., "1", "2", "3a", "4(b)").
            2. Ignore all other text.
            3. Return a JSON object with a "pages" array.
            4. **CRITICAL:** The "pages" array MUST have exactly ${images.length} entries.
            5. For each page, return: { "questions": ["1", "2a"] } (or empty array).
            6. **CONTEXT AWARENESS:** If a page has a sub-question (e.g. "b") but no main number, look at other pages to infer the main number.
            
            OUTPUT FORMAT:
            {
              "pages": [
                { "questions": ["1"] },
                { "questions": [] }
              ]
            }`;

            const userPrompt = `Scan these ${images.length} pages and list question numbers.`;
            const accessToken = await ModelProvider.getGeminiAccessToken();

            const parts: any[] = [
                { text: systemPrompt },
                { text: userPrompt }
            ];

            images.forEach((img, index) => {
                const imageData = img.imageData.includes(',') ? img.imageData.split(',')[1] : img.imageData;
                parts.push({ text: `\n--- Page Index ${index} ---` });
                parts.push({ inline_data: { mime_type: 'image/jpeg', data: imageData } });
            });

            const { getModelConfig } = await import('../../config/aiModels.js');
            const config = getModelConfig(MAPPING_MODEL as any);

            const response = await fetch(config.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
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

            if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);

            const result = await response.json() as any;
            const content = result.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
            let parsed: any;
            try {
                parsed = JSON.parse(content.replace(/```json\n|\n```/g, ''));
            } catch (e) { parsed = { pages: [] }; }

            const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
            const results: PageMap[] = [];

            // Fill exactly images.length results
            for (let i = 0; i < images.length; i++) {
                const p = pages[i] || { questions: [] };
                results.push({
                    pageIndex: i,
                    questions: p.questions || []
                });
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
