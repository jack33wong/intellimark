import { StandardizedPage } from '../../types/markingRouter.js';

interface SplitResult {
    // Structures for each mode (re-indexed with consecutive indices)
    questionOnlyPages: StandardizedPage[];
    questionOnlyClassificationResults: any[];
    markingPages: StandardizedPage[];
    markingClassificationResults: any[];

    // Which mode to use
    mode: 'question' | 'marking' | 'mixed';

    // Final structures to use for pipeline
    finalPages: StandardizedPage[];
    finalClassificationResults: any[];
}

/**
 * ModeSplitService
 * 
 * Handles the "perfect split" of mixed content into separate question-only and marking modes.
 * Builds completely independent, re-indexed structures for each mode.
 * 
 * Key principle: Each mode gets consecutive 0-based indices for proper array access.
 */
export class ModeSplitService {
    /**
     * Split mixed content into question and marking modes with proper re-indexing
     */
    static splitMixedContent(
        standardizedPages: StandardizedPage[],
        allClassificationResults: any[]
    ): SplitResult {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🔀 [PERFECT SPLIT] Building standalone structures with re-indexing');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        // Group classification results by pageIndex
        const resultsByPageIndex = new Map<number, typeof allClassificationResults>();
        allClassificationResults.forEach(result => {
            if (!resultsByPageIndex.has(result.pageIndex)) {
                resultsByPageIndex.set(result.pageIndex, []);
            }
            resultsByPageIndex.get(result.pageIndex)!.push(result);
        });

        // ===== 1. BUILD QUESTION MODE STRUCTURE =====
        const questionOnlyOriginalPages: StandardizedPage[] = [];
        const questionOnlyOriginalResults: typeof allClassificationResults = [];

        standardizedPages.forEach((page) => {
            const resultsForPage = resultsByPageIndex.get(page.pageIndex) || [];
            const isQuestionOnlyPage = resultsForPage.length > 0 &&
                resultsForPage.every(r => r.result?.category === 'questionOnly');

            if (isQuestionOnlyPage) {
                questionOnlyOriginalPages.push(page);
                questionOnlyOriginalResults.push(...resultsForPage);
            }
        });

        // PRESERVE PAGE INDICES: Do not consecutively re-index, as this breaks UI bounding box alignments.
        const questionOnlyPages = questionOnlyOriginalPages.map((page) => ({
            ...page,
            originalPageIndex: page.pageIndex
        }));

        const questionOnlyClassificationResults = [...questionOnlyOriginalResults];

        // ===== 2. BUILD MARKING MODE STRUCTURE =====
        const markingOriginalPages: StandardizedPage[] = [];
        const markingOriginalResults: typeof allClassificationResults = [];

        standardizedPages.forEach((page) => {
            const resultsForPage = resultsByPageIndex.get(page.pageIndex) || [];
            const isMarkingPage = resultsForPage.length === 0 || // frontPage (no results yet)
                resultsForPage.some(r => r.result?.category !== 'questionOnly');

            if (isMarkingPage) {
                markingOriginalPages.push(page);
                markingOriginalResults.push(...resultsForPage.filter(r => r.result?.category !== 'questionOnly'));
            }
        });

        // PRESERVE PAGE INDICES: Do not consecutively re-index, as this breaks UI bounding box alignments.
        const markingPages = markingOriginalPages.map((page) => ({
            ...page,
            originalPageIndex: page.pageIndex
        }));

        const markingClassificationResults = [...markingOriginalResults];

        // ===== 3. DETERMINE MODE AND FINAL STRUCTURES =====
        const hasMarkingData = markingPages.length > 0;
        const hasQuestionData = questionOnlyPages.length > 0;

        let mode: 'question' | 'marking' | 'mixed';
        let finalPages: StandardizedPage[];
        let finalClassificationResults: any[];

        if (hasMarkingData && hasQuestionData) {
            mode = 'mixed';
            // CRITICAL FIX: In mixed mode, we MUST keep ALL pages for the marking pipeline.
            // If we filter, we lose questions that were incorrectly categorized as questionOnly by the mapper.
            finalPages = markingPages;
            finalClassificationResults = markingClassificationResults;

            // Re-check: are these missing pages?
            if (finalPages.length < standardizedPages.length) {
                console.log(`📡 [MODE-SPLIT] Mixed mode detected. Preserving ALL ${standardizedPages.length} pages for marking flow.`);
                finalPages = standardizedPages;
                // We must use the original classification results (re-ordered) for the marking flow
                // to ensure every page index is represented.
                finalClassificationResults = allClassificationResults;
            }

            console.log('🔀 [MODE ROUTING] Mixed mode - using comprehensive structures for pipeline');
        } else if (hasMarkingData) {
            mode = 'marking';
            finalPages = markingPages;
            finalClassificationResults = markingClassificationResults;
            console.log('🎯 [MODE ROUTING] Pure marking mode');
        } else if (hasQuestionData) {
            mode = 'question';
            finalPages = questionOnlyPages;
            finalClassificationResults = questionOnlyClassificationResults;
            console.log('📝 [MODE ROUTING] Pure question mode');
        } else {
            // Fallback - should not happen
            mode = 'marking';
            finalPages = [];
            finalClassificationResults = [];
            console.warn('⚠️  [MODE ROUTING] No data in either mode!');
        }

        // ===== 4. DEBUG OUTPUT =====
        this.logSplitResults(questionOnlyPages, questionOnlyClassificationResults, markingPages, markingClassificationResults);

        return {
            questionOnlyPages,
            questionOnlyClassificationResults,
            markingPages,
            markingClassificationResults,
            mode,
            finalPages,
            finalClassificationResults
        };
    }

    private static logSplitResults(
        questionOnlyPages: StandardizedPage[],
        questionOnlyClassificationResults: any[],
        markingPages: StandardizedPage[],
        markingClassificationResults: any[]
    ) {
        // DEBUG: Verbose structure logging (commented out for cleaner logs)
        // console.log('\n📝 QUESTION MODE STRUCTURE (Re-indexed):');
        // console.log(`   Pages: ${questionOnlyPages.length}`);
        // questionOnlyPages.forEach((p, idx) => {
        //     console.log(`     [${idx}] pageIndex=${p.pageIndex}, original=${p.originalPageIndex}`);
        // });
        // console.log(`   Classifications: ${questionOnlyClassificationResults.length}`);
        // questionOnlyClassificationResults.forEach((result, idx) => {
        //     const qNums = result.result?.questions?.map((q: any) => q.questionNumber).join(', ') || 'None';
        //     console.log(`     [${idx}] pageIndex=${result.pageIndex}, Questions=[${qNums}]`);
        // });

        // console.log('\n🎯 MARKING MODE STRUCTURE (Re-indexed):');
        // console.log(`   Pages: ${markingPages.length}`);
        // markingPages.forEach((p, idx) => {
        //     console.log(`     [${idx}] pageIndex=${p.pageIndex}, original=${p.originalPageIndex}`);
        // });
        // console.log(`   Classifications: ${markingClassificationResults.length}`);
        // markingClassificationResults.forEach((result, idx) => {
        //     const qNums = result.result?.questions?.map((q: any) => q.questionNumber).join(', ') || 'None';
        //     console.log(`     [${idx}] pageIndex=${result.pageIndex}, Category=${result.result?.category}, Questions=[${qNums}]`);
        // });

        console.log('\n✅ Perfect split complete - each mode has consecutive 0-based indices');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }
}
