/**
 * Pricing Configuration
 * Centralized pricing for all external API services (LLM and Mathpix)
 * 
 * UPDATED Dec 5, 2025: Using GOOGLE AI STUDIO pricing + Added Gemini 2.0 Flash
 * 
 * Pricing Sources:
 * - Google AI Studio: https://ai.google.dev/pricing
 * - OpenAI: https://openai.com/api/pricing/
 * - Mathpix: https://mathpix.com/pricing
 * 

 * 
 * Migration completed: Now using AI Studio API key authentication
 */
import { resolveModelTier } from './aiModels.js';

/**
 * LLM Pricing (per 1M tokens)
 * Prices are in USD
 * 
 * Sources:
 * - Google AI Studio: https://ai.google.dev/pricing
 * - OpenAI: https://openai.com/api/pricing/
 * 
 * NOTE: Gemini pricing reflects AI STUDIO rates (as of Dec 2025)
 */
export const LLM_PRICING: Record<string, { input: number; output: number }> = {
  // GOOGLE AI STUDIO PRICING
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.50 },
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-3.5-flash': { input: 1.50, output: 9.00 },
  
  // Legacy models (kept for compatibility)
  'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 }, // Latest flash lite model
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },      // Corrected to official pricing
  'gemini-2.5-pro': { input: 1.25, output: 10.00 },

  // OPENAI PRICING
  'openai-gpt-4o': { input: 2.50, output: 10.00 },
  'openai-gpt-4o-mini': { input: 0.15, output: 0.60 },
};

/**
 * Mathpix Pricing (per call)
 * Prices are in USD
 * 
 * Source: https://mathpix.com/pricing
 */
export const MATHPIX_PRICING = {
  image: 0.002,  // $0.002 per image call (0-1M images tier)
};

/**
 * Get LLM pricing for a specific model
 * @param model - The model name (e.g., 'gemini-2.5-flash', 'openai-gpt-5-mini')
 * @returns Pricing object with input and output costs, or null if model not found
 */
export function getLLMPricing(model: string): { input: number; output: number } | null {
  // Normalize model name (handle tiers and exact strings)
  let normalizedModel = resolveModelTier(model);
  const pricing = LLM_PRICING[normalizedModel];
  return pricing || null;
}

/**
 * Get Mathpix pricing
 * @returns Mathpix image processing price per call
 */
export function getMathpixPricing(): number {
  return MATHPIX_PRICING.image;
}

