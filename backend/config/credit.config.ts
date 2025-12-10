/**
 * Credit System Configuration
 * Reads from environment variables to allow flexible credit allocation
 */

export const CREDIT_CONFIG = {
    // Conversion rate: Dollar amount per credit
    // Default: $0.01 = 1 credit
    conversionRate: parseFloat(process.env.CREDIT_CONVERSION_RATE || '0.01'),

    // Monthly credit allocations per plan
    planCredits: {
        free: parseInt(process.env.FREE_PLAN_CREDITS || '5', 10),
        pro: parseInt(process.env.PRO_PLAN_CREDITS || '50', 10),
        enterprise: parseInt(process.env.ENTERPRISE_PLAN_CREDITS || '500', 10)
    }
};

/**
 * Convert dollar amount to credits
 * @param dollarAmount - Amount in dollars (e.g., 0.05)
 * @returns Number of credits (rounded up)
 */
export function costToCredits(dollarAmount: number): number {
    return Math.ceil(dollarAmount / CREDIT_CONFIG.conversionRate);
}

/**
 * Convert credits to dollar amount
 * @param credits - Number of credits
 * @returns Dollar amount
 */
export function creditsToCost(credits: number): number {
    return credits * CREDIT_CONFIG.conversionRate;
}

/**
 * Get credit allocation for a specific plan
 * @param planId - Plan identifier (free, pro, enterprise)
 * @returns Monthly credit allocation
 */
export function getPlanCredits(planId: 'free' | 'pro' | 'enterprise'): number {
    return CREDIT_CONFIG.planCredits[planId] || 0;
}

export default CREDIT_CONFIG;
