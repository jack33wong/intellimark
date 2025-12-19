/**
 * Cost Calculator
 * Calculates costs for external API calls (LLM and Mathpix)
 */

import { getLLMPricing, getMathpixPricing } from '../config/pricing.js';

export interface CostBreakdown {
  llmCost: number;
  mathpixCost: number;
  total: number;
}

/**
 * Calculate LLM cost based on model and token usage
 * @param model - The model name (e.g., 'gemini-2.0-flash', 'openai-gpt-5-mini')
 * @param inputTokens - Input tokens used
 * @param outputTokens - Output tokens used
 * @returns Cost in USD
 */
export function calculateLLMCost(model: string, inputTokens: number, outputTokens: number): number {
  if (inputTokens + outputTokens <= 0) return 0;

  const pricing = getLLMPricing(model);
  if (!pricing) {
    console.warn(`[COST CALCULATOR] Unknown model: ${model}, using default pricing`);
    // Fallback to gemini-2.0-flash pricing
    const defaultPricing = getLLMPricing('gemini-2.0-flash');
    if (!defaultPricing) return 0;

    return (inputTokens / 1_000_000) * defaultPricing.input + (outputTokens / 1_000_000) * defaultPricing.output;
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return inputCost + outputCost;
}

/**
 * Calculate Mathpix cost based on number of calls
 * @param callCount - Number of Mathpix API calls
 * @returns Cost in USD
 */
export function calculateMathpixCost(callCount: number): number {
  if (callCount <= 0) return 0;

  const pricePerCall = getMathpixPricing();
  return callCount * pricePerCall;
}

/**
 * Calculate total cost for a session based on sessionStats
 * @param sessionStats - Session statistics containing totalLlmTokens, totalMathpixCalls, and lastModelUsed
 * @returns Cost breakdown with LLM cost, Mathpix cost, and total
 */
export function calculateTotalCost(sessionStats: any): CostBreakdown {
  const totalLlmTokens = sessionStats?.totalLlmTokens || 0;
  // Use real split tokens if available, fallback to 80/20 for legacy records
  const llmInputTokens = sessionStats?.totalLlmInputTokens ?? (totalLlmTokens * 0.8);
  const llmOutputTokens = sessionStats?.totalLlmOutputTokens ?? (totalLlmTokens * 0.2);

  const totalMathpixCalls = sessionStats?.totalMathpixCalls || 0;
  const modelUsed = sessionStats?.lastModelUsed || 'gemini-2.0-flash';

  const llmCost = calculateLLMCost(modelUsed, llmInputTokens, llmOutputTokens);
  const mathpixCost = calculateMathpixCost(totalMathpixCalls);
  const total = llmCost + mathpixCost;

  return {
    llmCost: Math.round(llmCost * 1000000) / 1000000, // Round to 6 decimal places
    mathpixCost: Math.round(mathpixCost * 1000000) / 1000000,
    total: Math.round(total * 1000000) / 1000000
  };
}

