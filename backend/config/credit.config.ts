/**
 * Credit System Configuration
 * Reads from environment variables with STRICT validation - NO FALLBACKS
 * Fails fast if environment variables are not properly configured
 */

// Load environment variables from .env.local FIRST
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

/**
 * Get required environment variable or throw error
 */
function getRequiredEnv(key: string, type: 'string' | 'number' = 'string'): string {
    const value = process.env[key];
    if (value === undefined || value === null || value === '') {
        throw new Error(
            `❌ FAIL-FAST: Required environment variable "${key}" is not set. ` +
            `Please configure this in your .env.local file. ` +
            `The system will NOT use fallback values to prevent misconfiguration.`
        );
    }

    // Additional validation for numeric values
    if (type === 'number') {
        const numValue = parseFloat(value);
        if (isNaN(numValue)) {
            throw new Error(
                `❌ FAIL-FAST: Environment variable "${key}" must be a valid number. ` +
                `Current value: "${value}". Please fix your .env.local file.`
            );
        }
    }

    return value;
}

// Load and validate configuration on module initialization
const CREDIT_CONVERSION_RATE = parseFloat(getRequiredEnv('CREDIT_CONVERSION_RATE', 'number'));
const FREE_PLAN_CREDITS = parseInt(getRequiredEnv('FREE_PLAN_CREDITS', 'number'), 10);
const PRO_PLAN_CREDITS = parseInt(getRequiredEnv('PRO_PLAN_CREDITS', 'number'), 10);
const ENTERPRISE_PLAN_CREDITS = parseInt(getRequiredEnv('ENTERPRISE_PLAN_CREDITS', 'number'), 10);

// Log loaded configuration for verification
console.log('✅ Credit configuration loaded from .env.local (FAIL-FAST mode):');
console.log(`   - Conversion Rate: $${CREDIT_CONVERSION_RATE} per credit`);
console.log(`   - Free Plan: ${FREE_PLAN_CREDITS} credits/month`);
console.log(`   - Pro Plan: ${PRO_PLAN_CREDITS} credits/month`);
console.log(`   - Enterprise Plan: ${ENTERPRISE_PLAN_CREDITS} credits/month`);

export const CREDIT_CONFIG = {
    // Conversion rate: Dollar amount per credit
    conversionRate: CREDIT_CONVERSION_RATE,

    // Monthly credit allocations per plan
    planCredits: {
        free: FREE_PLAN_CREDITS,
        pro: PRO_PLAN_CREDITS,
        enterprise: ENTERPRISE_PLAN_CREDITS
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
 * @throws Error if planId is invalid
 */
export function getPlanCredits(planId: 'free' | 'pro' | 'enterprise'): number {
    const credits = CREDIT_CONFIG.planCredits[planId];
    if (credits === undefined) {
        throw new Error(
            `❌ FAIL-FAST: Invalid plan ID "${planId}". ` +
            `Valid plan IDs are: free, pro, enterprise`
        );
    }
    return credits;
}

export default CREDIT_CONFIG;
