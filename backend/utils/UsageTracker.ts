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
    mapper: TokenUsage;           // NEW: Separate mapper phase
    classification: TokenUsage;    // Classification marking pass
    marking: TokenUsage;
    questionMode: TokenUsage;
    other: TokenUsage;
}

export interface CostBreakdown {
    classification: number;
    marking: number;
    questionMode: number;
    other: number;
    total: number;
}

export class UsageTracker {
    private usage: UsageBreakdown = {
        mapper: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
        classification: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
        marking: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
        questionMode: { inputTokens: 0, outputTokens: 0, requestCount: 0 },
        other: { inputTokens: 0, outputTokens: 0, requestCount: 0 }
    };

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
        return Object.values(this.usage).reduce(
            (sum, phase) => sum + phase.inputTokens + phase.outputTokens,
            0
        );
    }

    /**
     * Get total input and output tokens
     */
    getTotalInputOutput(): { inputTokens: number; outputTokens: number } {
        const inputTokens = Object.values(this.usage).reduce((sum, phase) => sum + phase.inputTokens, 0);
        const outputTokens = Object.values(this.usage).reduce((sum, phase) => sum + phase.outputTokens, 0);
        return { inputTokens, outputTokens };
    }

    /**
     * Get total cost for a model
     */
    getTotalCost(model?: string): number {
        const costs = this.calculateCost(model || 'gemini-2.5-flash');
        return costs.total;
    }

    /**
     * Get combined total cost including Mathpix
     * This is the SINGLE SOURCE OF TRUTH for total cost
     */
    getCombinedTotal(model: string, mathpixCalls: number): number {
        const llmCost = this.getTotalCost(model);
        const mathpixCost = mathpixCalls * 0.004; // $0.004 per page
        return llmCost + mathpixCost;
    }

    /**
     * Calculate cost for a specific phase
     */
    private calculatePhaseCost(inputTokens: number, outputTokens: number, model?: string): number {
        const pricing = getLLMPricing(model || 'gemini-2.5-flash');
        if (!pricing) {
            return 0;
        }
        return (inputTokens / 1_000_000 * pricing.input) + (outputTokens / 1_000_000 * pricing.output);
    }

    /**
     * Get total API request count
     */
    getTotalRequests(): number {
        return Object.values(this.usage).reduce((sum, phase) => sum + phase.requestCount, 0);
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
            other: this.usage.other.requestCount
        };
    }


    /**
     * Calculate cost for a specific model
     */
    calculateCost(model: string): CostBreakdown {
        const pricing = getLLMPricing(model);

        if (!pricing) {
            console.warn(`[UsageTracker] Unknown model: ${model}, using default pricing`);
            // Fallback to gemini-2.5-flash
            const defaultPricing = getLLMPricing('gemini-2.5-flash');
            if (!defaultPricing) {
                return {
                    classification: 0,
                    marking: 0,
                    questionMode: 0,
                    other: 0,
                    total: 0
                };
            }
            return this.calculateWithPricing(defaultPricing);
        }

        return this.calculateWithPricing(pricing);
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
        const other = calculatePhaseCost(this.usage.other);

        return {
            classification,
            marking,
            questionMode,
            other,
            total: classification + marking + questionMode + other
        };
    }

    /**
     * Get usage breakdown
     */
    getBreakdown(): UsageBreakdown {
        // Return a deep copy to prevent mutation
        return {
            mapper: { ...this.usage.mapper },
            classification: { ...this.usage.classification },
            marking: { ...this.usage.marking },
            questionMode: { ...this.usage.questionMode },
            other: { ...this.usage.other }
        };
    }

    /**
   * Validate usage (detect anomalies)
   */
    validate(): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        // Check for missing input or output (both should be present if total > 0)
        Object.entries(this.usage).forEach(([phase, tokens]) => {
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
        Object.entries(this.usage).forEach(([phase, tokens]) => {
            if (tokens.inputTokens < 0 || tokens.outputTokens < 0) {
                errors.push(`${phase}: Negative token count detected (input: ${tokens.inputTokens}, output: ${tokens.outputTokens})`);
            }
        });

        // Check for unrealistic ratios (input should generally be > output for our use case)
        Object.entries(this.usage).forEach(([phase, tokens]) => {
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
    getSummary(model?: string, mathpixCalls?: number): string {
        const totalTokens = this.getTotalTokens();
        const totalCost = this.getTotalCost(model);
        const { inputTokens: totalInput, outputTokens: totalOutput } = this.getTotalInputOutput();

        let summary = `\n📊 [UsageTracker] Summary:\n`;
        summary += `   Model: ${model || 'unknown'}\n`;
        summary += `   API Requests: ${this.getTotalRequests()} total\n`;
        summary += `   Total Tokens: ${totalTokens.toLocaleString()} (${totalInput.toLocaleString()} in + ${totalOutput.toLocaleString()} out)\n`;
        summary += `   Total Cost: $${totalCost.toFixed(6)}\n`;

        // Add Mathpix info if provided
        if (mathpixCalls && mathpixCalls > 0) {
            const mathpixCost = mathpixCalls * 0.004; // $0.004 per page
            summary += `   Mathpix OCR: ${mathpixCalls} pages → $${mathpixCost.toFixed(6)}\n`;
            summary += `   Combined Total: $${(totalCost + mathpixCost).toFixed(6)}\n`;
        }

        summary += `\n   Breakdown by Phase:\n`;

        //Show each phase with tokens and request count
        const phases: Array<{ name: string; key: keyof UsageBreakdown }> = [
            { name: 'Mapper (Map Pass)', key: 'mapper' },
            { name: 'Classification (Marking Pass)', key: 'classification' },
            { name: 'Marking', key: 'marking' },
            { name: 'Question Mode', key: 'questionMode' },
            { name: 'Other', key: 'other' }
        ];

        phases.forEach(({ name, key }) => {
            const tokens = this.usage[key];
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
            other: { inputTokens: 0, outputTokens: 0, requestCount: 0 }
        };
    }
}

export const usageTracker = new UsageTracker();
