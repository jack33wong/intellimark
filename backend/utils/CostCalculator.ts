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
 * @param model - The model name (e.g., 'gemini-2.5-flash', 'openai-gpt-5-mini')
 * @param totalTokens - Total tokens used (input + output)
 * @returns Cost in USD
 */
export function calculateLLMCost(model: string, totalTokens: number): number {
  if (totalTokens <= 0) return 0;
  
  const pricing = getLLMPricing(model);
  if (!pricing) {
    console.warn(`[COST CALCULATOR] Unknown model: ${model}, using default pricing`);
    // Fallback to gemini-2.5-flash pricing
    const defaultPricing = getLLMPricing('gemini-2.5-flash');
    if (!defaultPricing) return 0;
    // Estimate 80% input, 20% output if split unavailable
    const inputTokens = totalTokens * 0.8;
    const outputTokens = totalTokens * 0.2;
    return (inputTokens / 1_000_000) * defaultPricing.input + (outputTokens / 1_000_000) * defaultPricing.output;
  }
  
  // Estimate 80% input, 20% output if split unavailable
  // This is a reasonable estimate for most use cases
  const inputTokens = totalTokens * 0.8;
  const outputTokens = totalTokens * 0.2;
  
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
  const totalMathpixCalls = sessionStats?.totalMathpixCalls || 0;
  const modelUsed = sessionStats?.lastModelUsed || 'auto';
  
  const llmCost = calculateLLMCost(modelUsed, totalLlmTokens);
  const mathpixCost = calculateMathpixCost(totalMathpixCalls);
  const total = llmCost + mathpixCost;
  
  return {
    llmCost: Math.round(llmCost * 100) / 100, // Round to 2 decimal places
    mathpixCost: Math.round(mathpixCost * 100) / 100,
    total: Math.round(total * 100) / 100
  };
}

