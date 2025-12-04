/**
 * Pricing Configuration
 * Centralized pricing for all external API services (LLM and Mathpix)
 * 
 * IMPORTANT: We are currently using VERTEX AI ENTERPRISE pricing, NOT Google AI Studio pricing
 * 
 * Pricing Discovery (Dec 2024):
 * - Despite using generativelanguage.googleapis.com endpoint (AI Studio endpoint)
 * - Google Cloud project 'intellimark-6649e' is billed at Vertex AI Enterprise rates
 * - This is 8x more expensive for output tokens, 3.8x for input tokens
 * - However, we have £743.46 promotional credits valid until Sept 2026
 * 
 * Pricing Comparison:
 * ┌─────────────────┬──────────────┬────────────┬────────────┐
 * │ Token Type      │ AI Studio    │ Vertex AI  │ Difference │
 * ├─────────────────┼──────────────┼────────────┼────────────┤
 * │ Output          │ $0.30/1M     │ $2.40/1M   │ 8.0x       │
 * │ Input           │ $0.075/1M    │ $0.288/1M  │ 3.8x       │
 * │ Cached Input    │ $0.01/1M     │ $0.037/1M  │ 3.7x       │
 * └─────────────────┴──────────────┴────────────┴────────────┘
 * 
 * Migration Plan:
 * - Current (Until April 2025): Use Vertex AI with promotional credits (FREE)
 * - Future (Post-credits): Switch to Google AI Studio for 7.25x cost reduction
 * 
 * Updated: Dec 4, 2024
 */

/**
 * LLM Pricing (per 1M tokens)
 * Prices are in USD
 * 
 * NOTE: Gemini pricing reflects VERTEX AI ENTERPRISE rates (as of Dec 2024)
 * These rates are 8x higher than AI Studio but we're using promotional credits
 */
export const LLM_PRICING: Record<string, { input: number; output: number }> = {
  // VERTEX AI ENTERPRISE PRICING (Current - using promotional credits until Sept 2026)
  'gemini-2.5-flash': { input: 0.288, output: 2.40 },  // Vertex AI rates (was 0.075/0.30 for AI Studio)
  'gemini-2.5-pro': { input: 1.25, output: 5.00 },
  'gemini-3-pro-preview': { input: 1.25, output: 5.00 },

  // OPENAI PRICING
  'openai-gpt-4o': { input: 2.50, output: 10.00 },
  'openai-gpt-4o-mini': { input: 0.15, output: 0.60 },

  // Fallback for 'auto' model (resolves to gemini-2.5-flash with Vertex AI pricing)
  'auto': { input: 0.288, output: 2.40 },
};

/**
 * Mathpix Pricing (per call)
 * Prices are in USD
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
  // Normalize model name (handle 'auto' and resolve to default)
  const normalizedModel = model === 'auto' ? 'gemini-2.5-flash' : model;

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

