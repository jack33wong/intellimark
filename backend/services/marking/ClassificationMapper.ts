import { ModelProvider } from '../../utils/ModelProvider.js';
import { getPrompt } from '../../config/prompts.js';

export interface PageMap {
    pageIndex: number;
    questions: string[]; // List of question numbers (e.g., "1", "2a", "3")
    category?: "frontPage" | "questionPage" | "questionOnly"; // Front page/cover sheet, question with student work, or question only
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
            GOAL: List ONLY the question numbers visible on each page AND categorize each page.
            
            RULES:
            1. **QUESTION NUMBER DETECTION (DO THIS FIRST):**
               - Look for question numbers (e.g., "1", "2", "3a", "4(b)")
               - **NESTED SUB-QUESTIONS (CRITICAL):**
                 * Detect nested structures like "2(a)(i)", "2(a)(ii)", "3(b)(i)"
                 * FLATTEN these to simple format: "2(a)(i)" → "2ai", "2(a)(ii)" → "2aii", "3(b)(i)" → "3bi"
                 * Pattern: {number}({letter})({roman/number}) → {number}{letter}{roman/number}
                 * Examples:
                   - "2(a)(i)" → "2ai"
                   - "2(a)(ii)" → "2aii"
                   - "2(b)" → "2b"
                   - "3(a)(i)" → "3ai"
                   - "12(b)(ii)" → "12bii"
            
            2. **PAGE CATEGORIZATION (DECISION TREE):**
               - **STEP 1:** Did you find ANY question numbers (even just "1")?
                 * YES → Go to STEP 2
                 * NO → Is this a pure metadata page (exam board, code, date, subject, NO questions)?
                   - YES → category: "frontPage"
                   - NO → category: "questionPage" (default if unsure)
               
               - **STEP 2:** You found question numbers. Are there student answers/work?
                 * YES (handwritten numbers, calculations, drawings) → category: "questionPage"
                 * NO (only printed questions, no answers) → category: "questionOnly"
            
            3. **CRITICAL CLARIFICATIONS:**
               - **"frontPage"** = Exam cover sheet with NO questions, just metadata (board, exam code, date)
                 * Example: "Pearson Edexcel GCSE Mathematics 1MA1/3H June 2024" ONLY, no question 1, 2, 3...
               - **"questionPage"** = Has questions AND student work
                 * Example: Question "1 Find the HCF..." with student's handwritten work
               - **"questionOnly"** = Has questions but NO student work (blank answer spaces)
               - **NOT METADATA:** "Answer ALL questions", "Write your answers in the spaces provided" are INSTRUCTIONS, not metadata
                 * If you see "Answer ALL questions" + Question numbers → category: "questionPage" or "questionOnly"
               - **HEADERS/FOOTERS:** Ignore "Pearson Edexcel" headers or "DO NOT WRITE IN THIS AREA" watermarks - NOT frontPage
               - **MATH CONTENT:** If you see equations, grids, or diagrams → NOT frontPage
            
            4. Return a JSON object with a "pages" array.
            5. **CRITICAL:** The "pages" array MUST have exactly ${images.length} entries.
            6. For each page, return: { "questions": ["1", "2ai", "2aii", "2b"], "category": "frontPage" | "questionPage" | "questionOnly" }
            7. **CONTEXT AWARENESS:** If a page has a sub-question (e.g. "b") but no main number, look at other pages to infer the main number.
            
            OUTPUT FORMAT:
            {
              "pages": [
                { "questions": [], "category": "frontPage" },
                { "questions": ["1"], "category": "questionPage" }
              ]
            }`;

            const userPrompt = `Scan these ${images.length} pages and list question numbers.`;
            const accessToken = await ModelProvider.getGeminiAccessToken();

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
            const content = result.candidates?.[0]?.content?.parts?.[0]?.text;
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
