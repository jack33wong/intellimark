/**
 * Stripe Subscription Schedule Service
 * Handles creation and management of subscription schedules for plan changes
 */

import Stripe from 'stripe';
import stripe from '../config/stripe.js';
import { STRIPE_CONFIG } from '../config/stripe.js';

/**
 * Create a downgrade schedule
 * Keeps current plan until period end, then switches to new plan
 */
export async function createDowngradeSchedule(
    subscriptionId: string,
    currentPlanId: 'pro' | 'enterprise',
    newPlanId: 'free' | 'pro' | 'enterprise',
    billingCycle: 'monthly' | 'yearly',
    currentPeriodEnd: number
): Promise<Stripe.SubscriptionSchedule> {
    try {
        // Get price IDs for both plans
        const currentPlanConfig = STRIPE_CONFIG.plans[currentPlanId];
        const newPlanConfig = STRIPE_CONFIG.plans[newPlanId];

        if (!currentPlanConfig || !newPlanConfig) {
            throw new Error(`Plan configuration not found for ${currentPlanId} or ${newPlanId}`);
        }

        const currentPriceId = currentPlanConfig[billingCycle].priceId;
        const newPriceId = newPlanConfig[billingCycle].priceId;

        // Create subscription schedule
        const schedule = await stripe.subscriptionSchedules.create({
            from_subscription: subscriptionId,
            phases: [
                // Phase 1: Current plan until period end
                {
                    items: [{ price: currentPriceId, quantity: 1 }],
                    start_date: Math.floor(Date.now() / 1000),
                    end_date: currentPeriodEnd,
                },
                // Phase 2: New plan from period end onwards
                {
                    items: [{ price: newPriceId, quantity: 1 }],
                    start_date: currentPeriodEnd,
                    // No end_date = continues indefinitely
                },
            ],
            metadata: {
                fromPlan: currentPlanId,
                toPlan: newPlanId,
                createdAt: Date.now().toString(),
            },
        });

        console.log(`✅ Created downgrade schedule: ${currentPlanId} → ${newPlanId} on ${new Date(currentPeriodEnd * 1000).toISOString()}`);

        return schedule;
    } catch (error) {
        console.error('❌ Error creating downgrade schedule:', error);
        throw error;
    }
}

/**
 * Cancel an existing schedule
 */
export async function cancelSchedule(scheduleId: string): Promise<void> {
    try {
        await stripe.subscriptionSchedules.release(scheduleId);
        console.log(`✅ Canceled schedule: ${scheduleId}`);
    } catch (error) {
        console.error('❌ Error canceling schedule:', error);
        throw error;
    }
}

/**
 * Get active schedule for a subscription
 */
export async function getActiveSchedule(
    subscriptionId: string
): Promise<Stripe.SubscriptionSchedule | null> {
    try {
        const schedules = await stripe.subscriptionSchedules.list({
            subscription: subscriptionId,
            limit: 1,
        });

        return schedules.data.length > 0 ? schedules.data[0] : null;
    } catch (error) {
        console.error('❌ Error getting active schedule:', error);
        return null;
    }
}

/**
 * Extract plan ID from Stripe price ID
 */
export function extractPlanIdFromPrice(priceId: string): 'free' | 'pro' | 'enterprise' | null {
    // Match against known price IDs in config
    for (const [planId, planConfig] of Object.entries(STRIPE_CONFIG.plans)) {
        if (planConfig.monthly?.priceId === priceId || planConfig.yearly?.priceId === priceId) {
            return planId as 'free' | 'pro' | 'enterprise';
        }
    }
    return null;
}

export default {
    createDowngradeSchedule,
    cancelSchedule,
    getActiveSchedule,
    extractPlanIdFromPrice,
};
