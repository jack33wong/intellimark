/**
 * Result Aggregator
 * Waits for multiple flows to complete and combines their results
 */

export interface FlowResult {
    success: boolean;
    result: any;
    sessionId?: string;
    message?: any;
    unifiedSession?: any;
    mode?: string;
}

export class ResultAggregator {
    private mode: 'mixed' | 'question' | 'marking';
    private pendingFlows: Set<'question' | 'marking'>;
    private results: {
        questionResult?: FlowResult;
        markingResult?: FlowResult;
    };
    private resolveCallback?: (result: any) => void;
    private rejectCallback?: (error: any) => void;

    constructor(mode: 'mixed' | 'question' | 'marking') {
        this.mode = mode;
        this.results = {};

        // Determine which flows to wait for
        if (mode === 'mixed') {
            this.pendingFlows = new Set(['question', 'marking']);
            console.log('[AGGREGATOR] Created for mixed mode - waiting for both question & marking flows');
        } else if (mode === 'question') {
            this.pendingFlows = new Set(['question']);
            console.log('[AGGREGATOR] Created for question mode');
        } else {
            this.pendingFlows = new Set(['marking']);
            console.log('[AGGREGATOR] Created for marking mode');
        }
    }

    /**
     * Returns a promise that resolves when all expected flows complete
     */
    waitForCompletion(): Promise<any> {
        return new Promise((resolve, reject) => {
            this.resolveCallback = resolve;
            this.rejectCallback = reject;

            // If no flows to wait for, resolve immediately
            if (this.pendingFlows.size === 0) {
                resolve(this.combineResults());
            }
        });
    }

    /**
     * Called by each flow when it completes with its result
     */
    onFlowComplete(flowType: 'question' | 'marking', flowResult: FlowResult) {
        console.log(`[AGGREGATOR] Flow "${flowType}" completed`);

        // Store the result
        if (flowType === 'question') {
            this.results.questionResult = flowResult;
        } else {
            this.results.markingResult = flowResult;
        }

        this.pendingFlows.delete(flowType);

        // Check if all flows are complete
        if (this.pendingFlows.size === 0) {
            console.log('[AGGREGATOR] All flows complete - combining results');
            const combined = this.combineResults();
            this.resolveCallback?.(combined);
        } else {
            console.log(`[AGGREGATOR] Still waiting for: ${Array.from(this.pendingFlows).join(', ')}`);
        }
    }

    /**
     * Called if a flow fails
     */
    onFlowError(flowType: 'question' | 'marking', error: any) {
        console.error(`[AGGREGATOR] Flow "${flowType}" failed:`, error);
        this.rejectCallback?.(error);
    }

    /**
     * Combines results from all completed flows
     */
    private combineResults(): any {
        const { questionResult, markingResult } = this.results;

        if (this.mode === 'question') {
            // Pure question mode - return question result
            return questionResult;
        }

        if (this.mode === 'marking') {
            // Pure marking mode - return marking result
            return markingResult;
        }

        // Mixed mode - combine both results
        console.log('[AGGREGATOR] Combining question and marking results');

        const questionQuestionResults = questionResult?.result?.allQuestionResults || [];
        const markingQuestionResults = markingResult?.result?.allQuestionResults || [];

        // Combine allQuestionResults arrays
        const allQuestionResults = [
            ...markingQuestionResults,  // Marking results first (has scores)
            ...questionQuestionResults   // Question-only results second (text only)
        ];

        console.log(`[AGGREGATOR] Combined ${allQuestionResults.length} total results (${markingQuestionResults.length} marking + ${questionQuestionResults.length} question-only)`);

        // Use marking result as base, merge in question stats
        return {
            success: true,
            result: {
                allQuestionResults,
                finalAnnotatedOutput: markingResult?.result?.finalAnnotatedOutput || [],
                overallScore: markingResult?.result?.overallScore || 0,
                totalPossibleScore: markingResult?.result?.totalPossibleScore || 0,
                overallScoreText: markingResult?.result?.overallScoreText || '0/0',
                processingStats: {
                    totalLLMTokens:
                        (markingResult?.result?.processingStats?.totalLLMTokens || 0) +
                        (questionResult?.result?.processingStats?.totalLLMTokens || 0),
                    totalMathpixCalls:
                        (markingResult?.result?.processingStats?.totalMathpixCalls || 0) +
                        (questionResult?.result?.processingStats?.totalMathpixCalls || 0)
                }
            },
            // Include session data from whichever flow has it
            sessionId: markingResult?.sessionId || questionResult?.sessionId,
            mode: 'mixed',
            message: markingResult?.message || questionResult?.message,
            unifiedSession: markingResult?.unifiedSession || questionResult?.unifiedSession
        };
    }
}
