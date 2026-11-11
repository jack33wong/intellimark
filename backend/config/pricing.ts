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
  // CANONICAL MODELS
  'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gemini-4-argon': { input: 4.00, output: 20.00 },

  // GOOGLE AI STUDIO PRICING
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.50 },
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-3.7-flash': { input: 0.75, output: 3.75 },
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
  image: 0.005,
};

/**
 * Get LLM pricing for a specific model or tier
 * Checks exact model/tier first, then resolves tier
 * @param model - The model or tier name
 * @returns Pricing object with input and output costs, or null if model not found
 */
export function getLLMPricing(model: string): { input: number; output: number } | null {
  if (!model) return null;
  // Check direct model or tier key first
  if (LLM_PRICING[model]) {
    return LLM_PRICING[model];
  }
  // Fall back to resolving tier
  const normalizedModel = resolveModelTier(model);
  return LLM_PRICING[normalizedModel] || null;
}

/**
 * Get Mathpix pricing
 * @returns Mathpix image processing price per call
 */
export function getMathpixPricing(): number {
  return MATHPIX_PRICING.image;
}

