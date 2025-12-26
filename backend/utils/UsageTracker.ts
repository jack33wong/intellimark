/**
 * UsageTracker - Centralized token and cost tracking
 * 
 * Purpose: Single source of truth for ALL API usage across the marking pipeline
 * Benefits:
 * - Can't forget to track usage
 * - Detailed breakdown by phase
 * - Easy to add validation
 * - Simple cost calculation
 */

import { getLLMPricing } from '../config/pricing.js';

/**
 * Track token usage across different phases with input/output split
 */
interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    requestCount: number;  // Number of API requests
}

export interface UsageBreakdown {
    mapper: TokenUsage;
    classification: TokenUsage;
    marking: TokenUsage;
    questionMode: TokenUsage;
    contextChat: TokenUsage;
    modelAnswer: TokenUsage;
    markingScheme: TokenUsage;
    sampleQuestion: TokenUsage;
    analysis: TokenUsage;
    performanceSummary: TokenUsage;
    other: TokenUsage;
    mathpixPages: number; // NEW: Track Mathpix pages directly
}

export interface CostBreakdown {
    classification: number;
    marking: number;
    questionMode: number;
    contextChat: number;
    modelAnswer: number;
    markingScheme: number;
    sampleQuestion: number;
    analysis: number;
    performanceSummary: number;
    other: number;
    mathpix: number; // NEW
    total: number;
}

export class UsageTracker {
    private usage: UsageBreakdown = {
        mapper: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
        classification: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
        marking: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
        questionMode: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
        contextChat: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
        modelAnswer: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
        markingScheme: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
        sampleQuestion: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
        analysis: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
        performanceSummary: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
        other: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
        mathpixPages: 0
    };

    /**
     * Record Mathpix Usage
     * @param pages Number of pages processed
     */
    recordMathpix(pages: number = 1): void {
        this.usage.mathpixPages += pages;
    }

    /**
     * Get total Mathpix pages recorded
     */
    getMathpixPages(): number {
        return this.usage.mathpixPages;
    }

    /**
     * Record mapper API usage (Map Pass)
     */
    recordMapper(inputTokens: number, outputTokens: number): void {
        this.usage.mapper.inputTokens += inputTokens;
        this.usage.mapper.outputTokens += outputTokens;
        this.usage.mapper.requestCount++;
    }

    /**
     * Record classification phase tokens
     */
    recordClassification(inputTokens: number, outputTokens: number): void {
        this.usage.classification.inputTokens += inputTokens;
        this.usage.classification.outputTokens += outputTokens;
        this.usage.classification.requestCount++;
    }

    /**
     * Record marking phase tokens
     */
    recordMarking(inputTokens: number, outputTokens: number): void {
        this.usage.marking.inputTokens += inputTokens;
        this.usage.marking.outputTokens += outputTokens;
        this.usage.marking.requestCount++;
    }

    /**
     * Record question mode tokens
     */
    recordQuestionMode(inputTokens: number, outputTokens: number): void {
        this.usage.questionMode.inputTokens += inputTokens;
        this.usage.questionMode.outputTokens += outputTokens;
        this.usage.questionMode.requestCount++;
    }

    recordContextChat(inputTokens: number, outputTokens: number): void {
        this.usage.contextChat.inputTokens += inputTokens;
        this.usage.contextChat.outputTokens += outputTokens;
        this.usage.contextChat.requestCount++;
    }

    recordModelAnswer(inputTokens: number, outputTokens: number): void {
        this.usage.modelAnswer.inputTokens += inputTokens;
        this.usage.modelAnswer.outputTokens += outputTokens;
        this.usage.modelAnswer.requestCount++;
    }

    recordMarkingScheme(inputTokens: number, outputTokens: number): void {
        this.usage.markingScheme.inputTokens += inputTokens;
        this.usage.markingScheme.outputTokens += outputTokens;
        this.usage.markingScheme.requestCount++;
    }

    recordSampleQuestion(inputTokens: number, outputTokens: number): void {
        this.usage.sampleQuestion.inputTokens += inputTokens;
        this.usage.sampleQuestion.outputTokens += outputTokens;
        this.usage.sampleQuestion.requestCount++;
    }

    recordAnalysis(inputTokens: number, outputTokens: number): void {
        this.usage.analysis.inputTokens += inputTokens;
        this.usage.analysis.outputTokens += outputTokens;
        this.usage.analysis.requestCount++;
    }

    recordPerformanceSummary(inputTokens: number, outputTokens: number): void {
        this.usage.performanceSummary.inputTokens += inputTokens;
        this.usage.performanceSummary.outputTokens += outputTokens;
        this.usage.performanceSummary.requestCount++;
    }

    /**
     * Record other API usage
     */
    recordOther(inputTokens: number, outputTokens: number): void {
        this.usage.other.inputTokens += inputTokens;
        this.usage.other.outputTokens += outputTokens;
        this.usage.other.requestCount++;
    }

    /**
    * Get total tokens across all phases
    */
    getTotalTokens(): number {
        const { mathpixPages, ...phases } = this.usage; // Exclude mathpixPages from token sum
        return Object.values(phases).reduce(
            (sum, phase) => sum + (typeof phase === 'object' ? phase.inputTokens + phase.outputTokens : 0),
            0
        );
    }

    /**
     * Get total input and output tokens
     */
    getTotalInputOutput(): { inputTokens: number; outputTokens: number } {
        const { mathpixPages, ...phases } = this.usage; // Exclude mathpixPages
        const inputTokens = Object.values(phases).reduce((sum, phase) => sum + (typeof phase === 'object' ? phase.inputTokens : 0), 0);
        const outputTokens = Object.values(phases).reduce((sum, phase) => sum + (typeof phase === 'object' ? phase.outputTokens : 0), 0);
        return { inputTokens, outputTokens };
    }

    /**
     * Calculate cost for a specific phase
     */
    private calculatePhaseCost(inputTokens: number, outputTokens: number, model?: string): number {
        const pricing = getLLMPricing(model || 'gemini-2.0-flash');
        if (!pricing) {
            return 0;
        }
        return (inputTokens / 1_000_000 * pricing.input) + (outputTokens / 1_000_000 * pricing.output);
    }

    /**
     * Get total API request count (LLM only)
    */
    getTotalRequests(): number {
        const { mathpixPages, ...phases } = this.usage;
        return Object.values(phases).reduce((sum, phase) => sum + (typeof phase === 'object' ? phase.requestCount : 0), 0);
    }

    /**
     * Get request counts by phase
     */
    getRequestCounts(): { [key: string]: number } {
        return {
            mapper: this.usage.mapper.requestCount,
            classification: this.usage.classification.requestCount,
            marking: this.usage.marking.requestCount,
            questionMode: this.usage.questionMode.requestCount,
            contextChat: this.usage.contextChat.requestCount,
            modelAnswer: this.usage.modelAnswer.requestCount,
            markingScheme: this.usage.markingScheme.requestCount,
            sampleQuestion: this.usage.sampleQuestion.requestCount,
            analysis: this.usage.analysis.requestCount,
            performanceSummary: this.usage.performanceSummary.requestCount,
            other: this.usage.other.requestCount
        };
    }


    /**
     * Calculate cost for a specific model
     */
    calculateCost(model: string): CostBreakdown {
        const pricing = getLLMPricing(model);

        let pricingToUse = pricing;

        if (!pricingToUse) {
            console.warn(`[UsageTracker] Unknown model: ${model}, using default pricing`);
            // Fallback to gemini-2.0-flash
            const defaultPricing = getLLMPricing('gemini-2.0-flash');
            if (defaultPricing) {
                pricingToUse = defaultPricing;
            }
        }

        if (!pricingToUse) {
            return {
                classification: 0,
                marking: 0,
                questionMode: 0,
                contextChat: 0,
                modelAnswer: 0,
                markingScheme: 0,
                sampleQuestion: 0,
                analysis: 0,
                performanceSummary: 0,
                other: 0,
                mathpix: 0,
                total: 0
            };
        }

        return this.calculateWithPricing(pricingToUse);
    }

    /**
     * Calculate cost with specific pricing
     */
    private calculateWithPricing(pricing: { input: number; output: number }): CostBreakdown {
        const calculatePhaseCost = (phase: TokenUsage): number => {
            return (phase.inputTokens / 1_000_000 * pricing.input) +
                (phase.outputTokens / 1_000_000 * pricing.output);
        };

        const classification = calculatePhaseCost(this.usage.classification);
        const marking = calculatePhaseCost(this.usage.marking);
        const questionMode = calculatePhaseCost(this.usage.questionMode);
        const contextChat = calculatePhaseCost(this.usage.contextChat);
        const modelAnswer = calculatePhaseCost(this.usage.modelAnswer);
        const markingScheme = calculatePhaseCost(this.usage.markingScheme);
        const sampleQuestion = calculatePhaseCost(this.usage.sampleQuestion);
        const analysis = calculatePhaseCost(this.usage.analysis);
        const performanceSummary = calculatePhaseCost(this.usage.performanceSummary);
        const other = calculatePhaseCost(this.usage.other);

        // Mathpix: $0.004 per page
        const mathpix = this.usage.mathpixPages * 0.004;

        return {
            classification,
            marking,
            questionMode,
            contextChat,
            modelAnswer,
            markingScheme,
            sampleQuestion,
            analysis,
            performanceSummary,
            other,
            mathpix,
            total: classification + marking + questionMode + contextChat + modelAnswer + markingScheme + sampleQuestion + analysis + performanceSummary + other + mathpix
        };
    }

    /**
     * Get usage breakdown
     */
    getBreakdown(): UsageBreakdown {
        // Return a deep copy to prevent mutation
        return {
            ...this.usage,
            mapper: { ...this.usage.mapper },
            classification: { ...this.usage.classification },
            marking: { ...this.usage.marking },
            questionMode: { ...this.usage.questionMode },
            contextChat: { ...this.usage.contextChat },
            modelAnswer: { ...this.usage.modelAnswer },
            markingScheme: { ...this.usage.markingScheme },
            sampleQuestion: { ...this.usage.sampleQuestion },
            analysis: { ...this.usage.analysis },
            performanceSummary: { ...this.usage.performanceSummary },
            other: { ...this.usage.other }
        };
    }

    /**
    * Validate usage (detect anomalies)
    */
    validate(): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        const { mathpixPages, ...phases } = this.usage;

        // Check for missing input or output (both should be present if total > 0)
        Object.entries(phases).forEach(([phase, tokens]) => {
            const total = tokens.inputTokens + tokens.outputTokens;
            if (total > 0) {
                if (tokens.inputTokens === 0) {
                    errors.push(`${phase}: Has ${total} total tokens but missing input tokens`);
                }
                if (tokens.outputTokens === 0) {
                    errors.push(`${phase}: Has ${total} total tokens but missing output tokens`);
                }
            }
        });

        // Check for negative tokens
        Object.entries(phases).forEach(([phase, tokens]) => {
            if (tokens.inputTokens < 0 || tokens.outputTokens < 0) {
                errors.push(`${phase}: Negative token count detected (input: ${tokens.inputTokens}, output: ${tokens.outputTokens})`);
            }
        });

        if (mathpixPages < 0) {
            errors.push(`Mathpix: Negative page count (${mathpixPages})`);
        }

        // Check for unrealistic ratios (input should generally be > output for our use case)
        Object.entries(phases).forEach(([phase, tokens]) => {
            const total = tokens.inputTokens + tokens.outputTokens;
            if (total > 100) { // Only check if significant usage
                const outputRatio = tokens.outputTokens / total;
                // Warn if output is > 80% (unusual for our application)
                if (outputRatio > 0.8) {
                    errors.push(`${phase}: Suspicious output ratio ${(outputRatio * 100).toFixed(1)}% (output >> input)`);
                }
            }
        });

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Get summary for logging
     */
    getSummary(model?: string, _deprecatedMathpixCalls?: number): string {
        const costs = this.calculateCost(model || 'gemini-2.5-flash');
        const { inputTokens: totalInput, outputTokens: totalOutput } = this.getTotalInputOutput();
        const mathpixPages = this.usage.mathpixPages;

        let summary = `\n📊 [UsageTracker] Summary:\n`;
        summary += `   Model: ${model || 'unknown'}\n`;
        summary += `   API Requests: ${this.getTotalRequests()} total\n`;
        summary += `   Total Tokens: ${this.getTotalTokens().toLocaleString()} (${totalInput.toLocaleString()} in + ${totalOutput.toLocaleString()} out)\n`;
        summary += `   Total Cost: $${costs.total.toFixed(6)}\n`;

        // Add Mathpix info if usage exists
        if (mathpixPages > 0) {
            summary += `   Mathpix OCR: ${mathpixPages} pages → $${costs.mathpix.toFixed(6)}\n`;
        }

        summary += `\n   Breakdown by Phase:\n`;

        //Show each phase with tokens and request count
        const phases: Array<{ name: string; key: keyof UsageBreakdown }> = [
            { name: 'Mapper (Map Pass)', key: 'mapper' },
            { name: 'Classification (Marking Pass)', key: 'classification' },
            { name: 'Marking', key: 'marking' },
            { name: 'Question Mode', key: 'questionMode' },
            { name: 'Context Chat', key: 'contextChat' },
            { name: 'Model Answer', key: 'modelAnswer' },
            { name: 'Marking Scheme', key: 'markingScheme' },
            { name: 'Sample Question', key: 'sampleQuestion' },
            { name: 'Analysis', key: 'analysis' },
            { name: 'Performance Summary', key: 'performanceSummary' },
            { name: 'Other', key: 'other' }
        ];

        phases.forEach(({ name, key }) => {
            // @ts-ignore - we know key is not mathpixPages here based on the array above
            const tokens = this.usage[key] as TokenUsage;
            const total = tokens.inputTokens + tokens.outputTokens;
            if (total > 0) {
                const cost = this.calculatePhaseCost(tokens.inputTokens, tokens.outputTokens, model);
                summary += `   • ${name}: ${total.toLocaleString()} tokens (${tokens.requestCount} requests) → $${cost.toFixed(6)}\n`;
            }
        });

        const validation = this.validate();
        if (!validation.valid) {
            summary += `\n   ⚠️  Validation Errors:\n`;
            validation.errors.forEach(error => summary += `      - ${error}\n`);
        }

        return summary;
    }

    /**
     * Reset all usage data
     */
    reset(): void {
        this.usage = {
            mapper: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
            classification: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
            marking: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
            questionMode: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
            contextChat: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
            modelAnswer: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
            markingScheme: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
            sampleQuestion: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
            analysis: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
            performanceSummary: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
            other: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
            mathpixPages: 0
        };
    }
}

export default UsageTracker;
