import { ModelProvider } from '../../utils/ModelProvider.js';
import { getPrompt } from '../../config/prompts.js';
import UsageTracker from '../../utils/UsageTracker.js';
import { combineQuestionAndPart } from './MarkingHelpers.js';
import { resolveModelTier, getModelDisplayName } from '../../config/aiModels.js';

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
        model?: string,  // User-selected model (defaults to gemini-2.5-flash for backward compatibility)
        debug: boolean = false
    ): Promise<PageMap[]> {
        // Use user-selected model or default to Flash for cost optimization
        const MAPPING_MODEL = resolveModelTier(model || 'gemini-2.5-flash');
        
        // Convert the internal ID to the real name (e.g. 'Gemini 3.7 Flash') for the log
        const displayModelName = getModelDisplayName(MAPPING_MODEL);

        console.log(`[MAPPER] Using model: ${displayModelName}`);
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
                    true, // forceJsonResponse
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
                            q.subQuestions.forEach((sq: any) => {
                                let sqString = "";
                                if (typeof sq === 'string') {
                                    sqString = sq;
                                } else if (typeof sq === 'object' && sq !== null) {
                                    // Handle cases where the AI bleeds schema from the Heavy pass
                                    sqString = String(sq.part || sq.subQuestion || sq.q || sq.id || "");
                                }
                                
                                if (sqString) {
                                    flatQuestions.push(combineQuestionAndPart(String(q.questionNumber), sqString));
                                } else {
                                    flatQuestions.push(String(q.questionNumber)); // Fallback to just the main question
                                }
                            });
                        } else {
                            flatQuestions.push(q.questionNumber);
                        }
                    }
                });

                // If Mapper found 0 questions and classified the page as 'questionOnly' (no student work),
                // normalize it to 'frontPage' (blank/additional lined page or metadata page)
                // so empty booklet pages are not scheduled as question tasks or forced into OCR.
                const normalizedCategory = (flatQuestions.length === 0 && p.category === 'questionOnly')
                    ? 'frontPage'
                    : p.category;

                const result: PageMap = {
                    pageIndex: img.pageIndex, // ✅ CORRECT: Global Index (e.g., 10)
                    questions: structuredQuestions,
                    category: normalizedCategory,
                    flatQuestions: flatQuestions
                };
                results.push(result);

                // 🔍 [VERIFICATION LOG] This proves indices are correct
                const qLog = flatQuestions.length > 0 ? flatQuestions.join(', ') : `Empty/Meta (${normalizedCategory || 'unclassified'})`;
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
            const bucketPromises: Promise<PageMap[]>[] = [];

            for (let start = 0; start < images.length; start += (BUCKET_SIZE - OVERLAP)) {
                const end = Math.min(start + BUCKET_SIZE, images.length);
                const bucket = images.slice(start, end);

                if (bucket.length === 0) break;

                console.log(`   📦 [MAPPER-BUCKET] Queueing pages ${start} to ${end - 1}...`);
                bucketPromises.push(processAllPages(bucket, !!debug));

                if (end === images.length) break; // Finished all images
            }

            // Wait for all chunks to finish concurrently
            const allBucketResults = await Promise.all(bucketPromises);

            // Merge sequentially to preserve overlapping priority logic
            allBucketResults.forEach(bucketResults => {
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
            });

            const sortedResults = results.sort((a, b) => a.pageIndex - b.pageIndex);

            // 🛡️ CONTINUATION PAGE INHERITANCE (Multi-Page Booklet Answers):
            // In GCSE/A-Level answer booklets (especially English Language/Literature), a question starts on Page N
            // with a printed question number (e.g. "3" or "4"), followed by 1–3 lined continuation pages (Page N+1, N+2)
            // that contain student handwriting (category === 'questionAnswer') but NO printed question number header.
            // If we leave `questions: []` on those lined pages, Pass 2 treats them as standalone unnumbered full-page
            // tasks and labels them by their 1-based page index (e.g. Page 6 -> "Q6", Page 9 -> "Q9")!
            for (let i = 1; i < sortedResults.length; i++) {
                const current = sortedResults[i];
                const prev = sortedResults[i - 1];
                if (
                    current.category === 'questionAnswer' &&
                    (!current.questions || current.questions.length === 0) &&
                    prev.questions &&
                    prev.questions.length > 0
                ) {
                    const lastPrevQ = prev.questions[prev.questions.length - 1];
                    const inheritedBaseQ = String(lastPrevQ.questionNumber || '').replace(/[^0-9]/g, '') || lastPrevQ.questionNumber;
                    if (inheritedBaseQ) {
                        current.questions = [{ questionNumber: inheritedBaseQ }];
                        current.flatQuestions = [inheritedBaseQ];
                        console.log(
                            `   🔗 [MAPPER CONTINUATION] Global[${current.pageIndex}] (unnumbered questionAnswer page) inherited Q${inheritedBaseQ} from Global[${prev.pageIndex}]`
                        );
                    }
                }
            }

            const duration = (Date.now() - startTime) / 1000;
            console.log(`✅ [MAPPER] Map Pass complete in ${duration.toFixed(2)}s. Mapped ${sortedResults.length} pages.`);

            return sortedResults;
        } catch (error) {
            console.error('❌ [MAPPER] Map Pass failed:', error);
            return [];
        }
    }
}
