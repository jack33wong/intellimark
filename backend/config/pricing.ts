/**
 * Pricing Configuration
 * Centralized pricing for all external API services (LLM and Mathpix)
 * 
 * UPDATED Dec 4, 2024:  Now using GOOGLE AI STUDIO pricing (via API key)
 * 
 * Pricing Comparison (Dec 2024):
 * ┌─────────────────┬──────────────┬────────────┬────────────┐
 * │ Token Type      │ AI Studio    │ Vertex AI  │ Difference │
 * ├─────────────────┼──────────────┼────────────┼────────────┤
 * │ Output          │ $0.30/1M     │ $2.40/1M   │ 8.0x       │
 * │ Input           │ $0.075/1M    │ $0.288/1M  │ 3.8x       │
 * │ Cached Input    │ $0.01/1M     │ $0.037/1M  │ 3.7x       │
 * └─────────────────┴──────────────┴────────────┴────────────┘
 * 
 * Migration completed: Now using AI Studio API key authentication
 * Cost savings: 74-88% reduction compared to Vertex AI Enterprise
 */

/**
 * LLM Pricing (per 1M tokens)
 * Prices are in USD
 * 
 * NOTE: Gemini pricing reflects AI STUDIO rates (as of Dec 2024)
 */
export const LLM_PRICING: Record<string, { input: number; output: number }> = {
  // AI STUDIO PRICING (Current)
  'gemini-2.5-flash': { input: 0.075, output: 0.30 },  // AI Studio rates (was 0.288/2.40 for Vertex AI)
  'gemini-2.5-pro': { input: 1.25, output: 5.00 },
  'gemini-3-pro-preview': { input: 1.25, output: 5.00 },

  // OPENAI PRICING
  'openai-gpt-4o': { input: 2.50, output: 10.00 },
  'openai-gpt-4o-mini': { input: 0.15, output: 0.60 },

  // Fallback for 'auto' model (resolves to gemini-2.5-flash with AI Studio pricing)
  'auto': { input: 0.075, output: 0.30 },
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

