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

export interface UsagePhase {
    inputTokens: number;
    outputTokens: number;
}

export interface UsageBreakdown {
    classification: UsagePhase;
    marking: UsagePhase;
    questionMode: UsagePhase;
    other: UsagePhase;
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
        classification: { inputTokens: 0, outputTokens: 0 },
        marking: { inputTokens: 0, outputTokens: 0 },
        questionMode: { inputTokens: 0, outputTokens: 0 },
        other: { inputTokens: 0, outputTokens: 0 }
    };

    /**
     * Record classification phase tokens
     */
    recordClassification(inputTokens: number, outputTokens: number): void {
        this.usage.classification.inputTokens += inputTokens;
        this.usage.classification.outputTokens += outputTokens;
    }

    /**
     * Record marking phase tokens
     */
    recordMarking(inputTokens: number, outputTokens: number): void {
        this.usage.marking.inputTokens += inputTokens;
        this.usage.marking.outputTokens += outputTokens;
    }

    /**
     * Record question mode tokens
     */
    recordQuestionMode(inputTokens: number, outputTokens: number): void {
        this.usage.questionMode.inputTokens += inputTokens;
        this.usage.questionMode.outputTokens += outputTokens;
    }

    /**
     * Record other API usage
     */
    recordOther(inputTokens: number, outputTokens: number): void {
        this.usage.other.inputTokens += inputTokens;
        this.usage.other.outputTokens += outputTokens;
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
     * Get total input tokens
     */
    getTotalInputTokens(): number {
        return Object.values(this.usage).reduce(
            (sum, phase) => sum + phase.inputTokens,
            0
        );
    }

    /**
     * Get total output tokens
     */
    getTotalOutputTokens(): number {
        return Object.values(this.usage).reduce(
            (sum, phase) => sum + phase.outputTokens,
            0
        );
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
        const calculatePhaseCost = (phase: UsagePhase): number => {
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
    getSummary(model: string): string {
        const breakdown = this.getBreakdown();
        const costs = this.calculateCost(model);

        const lines = [
            `\n📊 [UsageTracker] Summary:`,
            `   Model: ${model}`,
            `   Total Tokens: ${this.getTotalTokens()} (${this.getTotalInputTokens()} in + ${this.getTotalOutputTokens()} out)`,
            `   Total Cost: $${costs.total.toFixed(6)}`,
            `\n   Breakdown by Phase:`
        ];

        if (breakdown.classification.inputTokens + breakdown.classification.outputTokens > 0) {
            lines.push(`   • Classification: ${breakdown.classification.inputTokens + breakdown.classification.outputTokens} tokens → $${costs.classification.toFixed(6)}`);
        }
        if (breakdown.marking.inputTokens + breakdown.marking.outputTokens > 0) {
            lines.push(`   • Marking: ${breakdown.marking.inputTokens + breakdown.marking.outputTokens} tokens → $${costs.marking.toFixed(6)}`);
        }
        if (breakdown.questionMode.inputTokens + breakdown.questionMode.outputTokens > 0) {
            lines.push(`   • Question Mode: ${breakdown.questionMode.inputTokens + breakdown.questionMode.outputTokens} tokens → $${costs.questionMode.toFixed(6)}`);
        }
        if (breakdown.other.inputTokens + breakdown.other.outputTokens > 0) {
            lines.push(`   • Other: ${breakdown.other.inputTokens + breakdown.other.outputTokens} tokens → $${costs.other.toFixed(6)}`);
        }

        const validation = this.validate();
        if (!validation.valid) {
            lines.push(`\n   ⚠️  Validation Errors:`);
            validation.errors.forEach(error => lines.push(`      - ${error}`));
        }

        return lines.join('\n');
    }

    /**
     * Reset all usage data
     */
    reset(): void {
        this.usage = {
            classification: { inputTokens: 0, outputTokens: 0 },
            marking: { inputTokens: 0, outputTokens: 0 },
            questionMode: { inputTokens: 0, outputTokens: 0 },
            other: { inputTokens: 0, outputTokens: 0 }
        };
    }
}
