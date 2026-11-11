/**
 * UsageTracker - Centralized token, thought, model, and cost tracking
 * 
 * Purpose: Single source of truth for ALL API usage across the marking pipeline
 * Benefits:
 * - Can't forget to track usage
 * - Exact per-call cost tracking including reasoning (thoughts) tokens
 * - Detailed breakdown by phase and model
 * - Simple cost calculation and credit reconciliation
 */

import { getLLMPricing, getMathpixPricing } from '../config/pricing.js';
import { getDefaultModel, resolveExecutionPlan } from '../config/aiModels.js';
import type { ModelPhase } from './ModelProvider.js';

/**
 * Track token usage across different phases with input/output/thoughts split and exact cost
 */
export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    thoughtTokens?: number;
    requestCount: number;  // Number of API requests
    costUsd?: number;
    modelsUsed?: Set<string>;
}

export interface UsageBreakdown {
    preFlight: TokenUsage;
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
    mathpixPages: number;
}

export interface CostBreakdown {
    preFlight: number;
    mapper: number;
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
    mathpix: number;
    total: number;
}

export class UsageTracker {
    private usage: UsageBreakdown = {
        preFlight: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
        mapper: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
        classification: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
        marking: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
        questionMode: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
        contextChat: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
        modelAnswer: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
        markingScheme: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
        sampleQuestion: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
        analysis: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
        performanceSummary: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
        other: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
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
     * Centralized phase usage recorder with exact cost accumulation
     */
    recordPhaseUsage(
        phase: ModelPhase | string,
        inputTokens: number,
        outputTokens: number,
        thoughtTokens: number = 0,
        modelId: string = '',
        costUsd?: number
    ): void {
        const key = (phase in this.usage ? phase : 'other') as keyof Omit<UsageBreakdown, 'mathpixPages'>;
        const bucket = this.usage[key];
        bucket.inputTokens += inputTokens;
        bucket.outputTokens += outputTokens;
        bucket.thoughtTokens = (bucket.thoughtTokens || 0) + (thoughtTokens || 0);
        bucket.requestCount++;
        if (!bucket.modelsUsed) bucket.modelsUsed = new Set<string>();
        if (modelId) bucket.modelsUsed.add(modelId);

        let callCost = costUsd;
        if (callCost === undefined) {
            const plan = resolveExecutionPlan(modelId || 'auto', key);
            callCost = (inputTokens / 1_000_000) * plan.inputPricePer1M + (outputTokens / 1_000_000) * plan.outputPricePer1M;
        }
        bucket.costUsd = (bucket.costUsd || 0) + callCost;
    }

    recordPreFlight(inputTokens: number, outputTokens: number, thoughtTokens: number = 0, modelId: string = '', costUsd?: number): void {
        this.recordPhaseUsage('preFlight', inputTokens, outputTokens, thoughtTokens, modelId, costUsd);
    }

    recordMapper(inputTokens: number, outputTokens: number, thoughtTokens: number = 0, modelId: string = '', costUsd?: number): void {
        this.recordPhaseUsage('mapper', inputTokens, outputTokens, thoughtTokens, modelId, costUsd);
    }

    recordClassification(inputTokens: number, outputTokens: number, thoughtTokens: number = 0, modelId: string = '', costUsd?: number): void {
        this.recordPhaseUsage('classification', inputTokens, outputTokens, thoughtTokens, modelId, costUsd);
    }

    recordMarking(inputTokens: number, outputTokens: number, thoughtTokens: number = 0, modelId: string = '', costUsd?: number): void {
        this.recordPhaseUsage('marking', inputTokens, outputTokens, thoughtTokens, modelId, costUsd);
    }

    recordQuestionMode(inputTokens: number, outputTokens: number, thoughtTokens: number = 0, modelId: string = '', costUsd?: number): void {
        this.recordPhaseUsage('questionMode', inputTokens, outputTokens, thoughtTokens, modelId, costUsd);
    }

    recordContextChat(inputTokens: number, outputTokens: number, thoughtTokens: number = 0, modelId: string = '', costUsd?: number): void {
        this.recordPhaseUsage('contextChat', inputTokens, outputTokens, thoughtTokens, modelId, costUsd);
    }

    recordModelAnswer(inputTokens: number, outputTokens: number, thoughtTokens: number = 0, modelId: string = '', costUsd?: number): void {
        this.recordPhaseUsage('modelAnswer', inputTokens, outputTokens, thoughtTokens, modelId, costUsd);
    }

    recordMarkingScheme(inputTokens: number, outputTokens: number, thoughtTokens: number = 0, modelId: string = '', costUsd?: number): void {
        this.recordPhaseUsage('markingScheme', inputTokens, outputTokens, thoughtTokens, modelId, costUsd);
    }

    recordSampleQuestion(inputTokens: number, outputTokens: number, thoughtTokens: number = 0, modelId: string = '', costUsd?: number): void {
        this.recordPhaseUsage('sampleQuestion', inputTokens, outputTokens, thoughtTokens, modelId, costUsd);
    }

    recordAnalysis(inputTokens: number, outputTokens: number, thoughtTokens: number = 0, modelId: string = '', costUsd?: number): void {
        this.recordPhaseUsage('analysis', inputTokens, outputTokens, thoughtTokens, modelId, costUsd);
    }

    recordPerformanceSummary(inputTokens: number, outputTokens: number, thoughtTokens: number = 0, modelId: string = '', costUsd?: number): void {
        this.recordPhaseUsage('performanceSummary', inputTokens, outputTokens, thoughtTokens, modelId, costUsd);
    }

    recordOther(inputTokens: number, outputTokens: number, thoughtTokens: number = 0, modelId: string = '', costUsd?: number): void {
        this.recordPhaseUsage('other', inputTokens, outputTokens, thoughtTokens, modelId, costUsd);
    }

    /**
     * Get total tokens across all phases (input + output including thoughts)
     */
    getTotalTokens(): number {
        const { mathpixPages, ...phases } = this.usage;
        return Object.values(phases).reduce(
            (sum, phase) => sum + (typeof phase === 'object' ? phase.inputTokens + phase.outputTokens : 0),
            0
        );
    }

    /**
     * Get total input and output tokens
     */
    getTotalInputOutput(): { inputTokens: number; outputTokens: number } {
        const { mathpixPages, ...phases } = this.usage;
        const inputTokens = Object.values(phases).reduce((sum, phase) => sum + (typeof phase === 'object' ? phase.inputTokens : 0), 0);
        const outputTokens = Object.values(phases).reduce((sum, phase) => sum + (typeof phase === 'object' ? phase.outputTokens : 0), 0);
        return { inputTokens, outputTokens };
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
            preFlight: this.usage.preFlight.requestCount,
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
     * Calculate cost across all phases using exact pre-recorded per-call costs,
     * falling back to phase-specific model plans if cost was not pre-recorded.
     */
    calculateCost(fallbackModel?: string): CostBreakdown {
        const getPhaseCost = (phaseKey: keyof Omit<UsageBreakdown, 'mathpixPages'>): number => {
            const phase = this.usage[phaseKey];
            if (typeof phase.costUsd === 'number' && phase.costUsd > 0) {
                return phase.costUsd;
            }
            if (phase.inputTokens === 0 && phase.outputTokens === 0) {
                return 0;
            }
            // Fallback: Calculate cost using resolved plan for this phase
            const plan = resolveExecutionPlan(fallbackModel || 'auto', phaseKey);
            return (phase.inputTokens / 1_000_000 * plan.inputPricePer1M) +
                   (phase.outputTokens / 1_000_000 * plan.outputPricePer1M);
        };

        const preFlight = getPhaseCost('preFlight');
        const mapper = getPhaseCost('mapper');
        const classification = getPhaseCost('classification');
        const marking = getPhaseCost('marking');
        const questionMode = getPhaseCost('questionMode');
        const contextChat = getPhaseCost('contextChat');
        const modelAnswer = getPhaseCost('modelAnswer');
        const markingScheme = getPhaseCost('markingScheme');
        const sampleQuestion = getPhaseCost('sampleQuestion');
        const analysis = getPhaseCost('analysis');
        const performanceSummary = getPhaseCost('performanceSummary');
        const other = getPhaseCost('other');

        const mathpixPrice = getMathpixPricing();
        const mathpix = this.usage.mathpixPages * mathpixPrice;

        const total = preFlight + mapper + classification + marking + questionMode +
                      contextChat + modelAnswer + markingScheme + sampleQuestion +
                      analysis + performanceSummary + other + mathpix;

        return {
            preFlight,
            mapper,
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
            total
        };
    }

    /**
     * Get usage breakdown
     */
    getBreakdown(): UsageBreakdown {
        return {
            ...this.usage,
            preFlight: { ...this.usage.preFlight, modelsUsed: new Set(this.usage.preFlight.modelsUsed) },
            mapper: { ...this.usage.mapper, modelsUsed: new Set(this.usage.mapper.modelsUsed) },
            classification: { ...this.usage.classification, modelsUsed: new Set(this.usage.classification.modelsUsed) },
            marking: { ...this.usage.marking, modelsUsed: new Set(this.usage.marking.modelsUsed) },
            questionMode: { ...this.usage.questionMode, modelsUsed: new Set(this.usage.questionMode.modelsUsed) },
            contextChat: { ...this.usage.contextChat, modelsUsed: new Set(this.usage.contextChat.modelsUsed) },
            modelAnswer: { ...this.usage.modelAnswer, modelsUsed: new Set(this.usage.modelAnswer.modelsUsed) },
            markingScheme: { ...this.usage.markingScheme, modelsUsed: new Set(this.usage.markingScheme.modelsUsed) },
            sampleQuestion: { ...this.usage.sampleQuestion, modelsUsed: new Set(this.usage.sampleQuestion.modelsUsed) },
            analysis: { ...this.usage.analysis, modelsUsed: new Set(this.usage.analysis.modelsUsed) },
            performanceSummary: { ...this.usage.performanceSummary, modelsUsed: new Set(this.usage.performanceSummary.modelsUsed) },
            other: { ...this.usage.other, modelsUsed: new Set(this.usage.other.modelsUsed) }
        };
    }

    /**
     * Validate usage (detect anomalies)
     */
    validate(): { valid: boolean; errors: string[] } {
        const errors: string[] = [];
        const { mathpixPages, ...phases } = this.usage;

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
            if (tokens.inputTokens < 0 || tokens.outputTokens < 0) {
                errors.push(`${phase}: Negative token count detected (input: ${tokens.inputTokens}, output: ${tokens.outputTokens})`);
            }
        });

        if (mathpixPages < 0) {
            errors.push(`Mathpix: Negative page count (${mathpixPages})`);
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Get summary for logging with clean, aligned terminal table
     */
    getSummary(model?: string, _deprecatedMathpixCalls?: number): string {
        const costs = this.calculateCost(model);
        const { inputTokens: totalInput, outputTokens: totalOutput } = this.getTotalInputOutput();
        const totalRequests = this.getTotalRequests();
        const mathpixPages = this.usage.mathpixPages;

        const phases: Array<{ name: string; key: keyof Omit<UsageBreakdown, 'mathpixPages'> }> = [
            { name: 'Pre-Flight', key: 'preFlight' },
            { name: 'Mapper', key: 'mapper' },
            { name: 'Classification', key: 'classification' },
            { name: 'Marking', key: 'marking' },
            { name: 'Question Mode', key: 'questionMode' },
            { name: 'Context Chat', key: 'contextChat' },
            { name: 'Model Answer', key: 'modelAnswer' },
            { name: 'Marking Scheme', key: 'markingScheme' },
            { name: 'Sample Question', key: 'sampleQuestion' },
            { name: 'Analysis', key: 'analysis' },
            { name: 'Perf Summary', key: 'performanceSummary' },
            { name: 'Other', key: 'other' }
        ];

        interface AuditRow {
            name: string;
            modelsStr: string;
            inTokensStr: string;
            outTokensStr: string;
            reqsStr: string;
            costStr: string;
            creditsStr: string;
        }

        const activeRows: AuditRow[] = [];

        phases.forEach(({ name, key }) => {
            const tokens = this.usage[key];
            const total = tokens.inputTokens + tokens.outputTokens;
            if (total > 0 || tokens.requestCount > 0) {
                const phaseCost = costs[key] || 0;
                const credits = (phaseCost * 100).toFixed(2);
                const modelsStr = tokens.modelsUsed && tokens.modelsUsed.size > 0
                    ? Array.from(tokens.modelsUsed).join(', ')
                    : resolveExecutionPlan(model, key).modelName;
                const thoughtsStr = tokens.thoughtTokens ? ` (${tokens.thoughtTokens.toLocaleString()} th)` : '';
                const outStr = `${tokens.outputTokens.toLocaleString()}${thoughtsStr}`;

                activeRows.push({
                    name,
                    modelsStr,
                    inTokensStr: tokens.inputTokens.toLocaleString(),
                    outTokensStr: outStr,
                    reqsStr: String(tokens.requestCount),
                    costStr: `$${phaseCost.toFixed(6)}`,
                    creditsStr: credits
                });
            }
        });

        if (mathpixPages > 0) {
            const mpCost = costs.mathpix;
            activeRows.push({
                name: 'Mathpix OCR',
                modelsStr: `${mathpixPages} page(s)`,
                inTokensStr: '-',
                outTokensStr: '-',
                reqsStr: String(mathpixPages),
                costStr: `$${mpCost.toFixed(6)}`,
                creditsStr: (mpCost * 100).toFixed(2)
            });
        }

        // Column widths - dynamically expand if any cell exceeds minimum default
        const c1 = 18; // Phase
        let c2 = 25;   // Model(s) Executed
        const c3 = 12; // In Tokens
        let c4 = 20;   // Out (Thoughts)
        const c5 = 6;  // Reqs
        const c6 = 12; // Cost ($)
        const c7 = 9;  // Credits

        for (const r of activeRows) {
            if (r.modelsStr.length > c2) c2 = r.modelsStr.length;
            if (r.outTokensStr.length > c4) c4 = r.outTokensStr.length;
        }

        const lineLen = 1 + c1 + 3 + c2 + 3 + c3 + 3 + c4 + 3 + c5 + 3 + c6 + 3 + c7;
        const border = '='.repeat(lineLen);
        const sep = '-'.repeat(lineLen);

        let summary = `\n${border}\n`;
        summary += `📊 [UsageTracker] Execution Audit Summary (Requested: ${model || 'auto'})\n`;
        summary += `${sep}\n`;
        summary += ` ${'Phase'.padEnd(c1)} | ${'Model(s) Executed'.padEnd(c2)} | ${'In Tokens'.padStart(c3)} | ${'Out (Thoughts)'.padStart(c4)} | ${'Reqs'.padStart(c5)} | ${'Cost ($)'.padStart(c6)} | ${'Credits'.padStart(c7)}\n`;
        summary += `${sep}\n`;

        activeRows.forEach(r => {
            summary += ` ${r.name.padEnd(c1)} | ${r.modelsStr.padEnd(c2)} | ${r.inTokensStr.padStart(c3)} | ${r.outTokensStr.padStart(c4)} | ${r.reqsStr.padStart(c5)} | ${r.costStr.padStart(c6)} | ${r.creditsStr.padStart(c7)}\n`;
        });

        summary += `${sep}\n`;
        summary += ` ${'TOTAL'.padEnd(c1)} | ${'-'.padEnd(c2)} | ${totalInput.toLocaleString().padStart(c3)} | ${totalOutput.toLocaleString().padStart(c4)} | ${String(totalRequests).padStart(c5)} | ${('$' + costs.total.toFixed(6)).padStart(c6)} | ${(costs.total * 100).toFixed(2).padStart(c7)}\n`;
        summary += `${border}\n`;

        const validation = this.validate();
        if (!validation.valid) {
            summary += `\n   ⚠️  Validation Warnings:\n`;
            validation.errors.forEach(error => summary += `      - ${error}\n`);
        }

        return summary;
    }

    /**
     * Reset all usage data
     */
    reset(): void {
        this.usage = {
            preFlight: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
            mapper: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
            classification: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
            marking: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
            questionMode: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
            contextChat: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
            modelAnswer: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
            markingScheme: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
            sampleQuestion: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
            analysis: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
            performanceSummary: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
            other: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, requestCount: 0, costUsd: 0, modelsUsed: new Set<string>() },
            mathpixPages: 0
        };
    }
}

export default UsageTracker;
