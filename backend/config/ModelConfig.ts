export const API_PRICING: Record<string, any> = {
    MATHPIX_PER_PAGE: 0.005, // Updated to 0.005 to reflect Mathpix's PDF rate for dense text
    MODELS: {
        'FAST': { inputPer1M: 0.75, outputPer1M: 3.75 },
        'THINKING': { inputPer1M: 1.50, outputPer1M: 5.00 }, // Retail markup
        'PRO': { inputPer1M: 3.00, outputPer1M: 15.00 }      // Retail markup
    }
};

// Helper function to resolve the requested model to a billable model
export function getBillableModel(requestedModel: string): string {
    if (!requestedModel) return 'FAST';
    const normalized = requestedModel.toUpperCase();
    if (normalized === 'AUTO') return 'FAST';
    return API_PRICING.MODELS[normalized] ? normalized : 'FAST'; // Fallback to FAST
}
