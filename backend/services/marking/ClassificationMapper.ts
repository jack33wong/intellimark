import { ModelProvider } from '../../utils/ModelProvider.js';
import { getPrompt } from '../../config/prompts.js';
import UsageTracker from '../../utils/UsageTracker.js';

export interface PageMap {
    pageIndex: number;
    questions: Array<{
        questionNumber: string;
        subQuestions?: string[];
    }>;
    category?: "frontPage" | "questionAnswer" | "questionOnly";
    flatQuestions?: string[]; // For backward compatibility in Pass 2
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
        model?: string,  // User-selected model (defaults to gemini-2.0-flash for backward compatibility)
        debug: boolean = false
    ): Promise<PageMap[]> {
        // Use user-selected model or default to Flash for cost optimization
        const MAPPING_MODEL = model || 'gemini-2.0-flash';

        console.log(`[MAPPER] Using model: ${MAPPING_MODEL}`);
        console.log(`[MAPPER] Starting Map Pass for ${images.length} pages...`);
        const startTime = Date.now(); // Track performance

        // SINGLE BATCH HELPER: Process a subset of pages
        const processAllPages = async (imagesToProcess: typeof images, debugLog: boolean = false): Promise<PageMap[]> => {
            const systemPrompt = getPrompt('classification.mapper.system', imagesToProcess.length);
            const userPrompt = getPrompt('classification.mapper.user', imagesToProcess.length);

            const isOpenAI = MAPPING_MODEL.startsWith('openai-');
            let content: string;

            if (isOpenAI) {
                const openaiModel = MAPPING_MODEL.replace('openai-', '');
                const aiResponse = await ModelProvider.callOpenAIChat(
                    systemPrompt,
                    userPrompt,
                    imagesToProcess.map(img => img.imageData),
                    openaiModel,
                    true, // forceJsonResponse
                    tracker,
                    'classification'
                );
                content = aiResponse.content;
            } else {
                const aiResponse = await ModelProvider.callGeminiChat(
                    systemPrompt,
                    userPrompt,
                    imagesToProcess.map(img => img.imageData),
                    MAPPING_MODEL as any,
                    tracker,
                    'classification'
                );
                content = aiResponse.content;
            }

            let parsed: any;
            const cleanContent = content.replace(/```json\n|\n```/g, '');
            try {
                parsed = JSON.parse(cleanContent);
            } catch (e) { parsed = { pages: [] }; }

            const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
            const results: PageMap[] = [];

            // ========================= 🛡️ THE CRITICAL FIX & AUDIT 🛡️ =========================
            // 1. Iterate the BATCH (imagesToProcess), not global images.
            // 2. Use img.pageIndex to set the result ID.

            console.log(`\n🔍 [MAPPER AUDIT] Batch of ${imagesToProcess.length} images:`);

            imagesToProcess.forEach((img, localIdx) => {
                // Fetch AI result by LOCAL index (0, 1, 2...)
                const p = pages[localIdx] || { questions: [], category: undefined };

                // Parsing Logic (Standard)
                const rawQuestions = Array.isArray(p.questions) ? p.questions : [];
                const structuredQuestions: Array<{ questionNumber: string; subQuestions?: string[] }> = [];
                const flatQuestions: string[] = [];

                rawQuestions.forEach((q: any) => {
                    if (typeof q === 'string') {
                        const match = q.match(/^(\d+)([a-z]*.*)/i);
                        if (match) {
                            const base = match[1];
                            const part = match[2];
                            const existing = structuredQuestions.find(sq => sq.questionNumber === base);
                            if (existing) {
                                if (part && !existing.subQuestions?.includes(part)) {
                                    existing.subQuestions = [...(existing.subQuestions || []), part];
                                }
                            } else {
                                structuredQuestions.push({
                                    questionNumber: base,
                                    subQuestions: part ? [part] : undefined
                                });
                            }
                        } else {
                            structuredQuestions.push({ questionNumber: q });
                        }
                        flatQuestions.push(q);
                    } else if (typeof q === 'object' && q !== null && q.questionNumber) {
                        structuredQuestions.push(q);
                        if (q.subQuestions && q.subQuestions.length > 0) {
                            q.subQuestions.forEach((sq: string) => {
                                flatQuestions.push(`${q.questionNumber}${sq}`);
                            });
                        } else {
                            flatQuestions.push(q.questionNumber);
                        }
                    }
                });

                const result: PageMap = {
                    pageIndex: img.pageIndex, // ✅ CORRECT: Global Index (e.g., 10)
                    questions: structuredQuestions,
                    category: p.category,
                    flatQuestions: flatQuestions
                };
                results.push(result);

                // 🔍 [VERIFICATION LOG] This proves indices are correct
                const qLog = flatQuestions.length > 0 ? flatQuestions.join(', ') : 'Empty/Meta';
                console.log(`   ✅ Mapped Local[${localIdx}] -> Global[${img.pageIndex}] | Content: ${qLog}`);
            });

            return results;
        };

        // OVERLAPPING BUCKETS: Process large documents in chunks to avoid AI response truncation
        // We use an overlap (e.g. 2 pages) so that a question split across buckets is caught by both.
        const BUCKET_SIZE = 10;
        const OVERLAP = 2;
        const results: PageMap[] = [];
        const processedPageIndices = new Set<number>();

        try {
            for (let start = 0; start < images.length; start += (BUCKET_SIZE - OVERLAP)) {
                const end = Math.min(start + BUCKET_SIZE, images.length);
                const bucket = images.slice(start, end);

                if (bucket.length === 0) break;

                console.log(`   📦 [MAPPER-BUCKET] Processing pages ${start} to ${end - 1}...`);
                const bucketResults = await processAllPages(bucket, !!debug);

                // Merge results, prioritizing new data for pages we haven't seen or that were empty
                bucketResults.forEach(res => {
                    const existingIdx = results.findIndex(r => r.pageIndex === res.pageIndex);
                    if (existingIdx === -1) {
                        results.push(res);
                        processedPageIndices.add(res.pageIndex);
                    } else {
                        // If we already have this page, merge questions if the new result found more
                        const existing = results[existingIdx];
                        if (res.questions.length > existing.questions.length) {
                            results[existingIdx] = res;
                        }
                    }
                });

                if (end === images.length) break; // Finished all images
            }

            const duration = (Date.now() - startTime) / 1000;
            console.log(`✅ [MAPPER] Map Pass complete in ${duration.toFixed(2)}s. Mapped ${results.length} pages.`);

            return results.sort((a, b) => a.pageIndex - b.pageIndex);
        } catch (error) {
            console.error('❌ [MAPPER] Map Pass failed:', error);
            return [];
        }
    }
}
