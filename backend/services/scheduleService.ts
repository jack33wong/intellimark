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
    currentPlanId: 'pro' | 'ultra',
    newPlanId: 'free' | 'pro' | 'ultra',
    billingCycle: 'monthly' | 'yearly',
    currentPeriodEnd: number
): Promise<Stripe.SubscriptionSchedule> {
    try {
        const { getDefaultPriceFromProduct } = await import('../config/stripe.js');

        // Get product IDs for both plans
        const currentPlanConfig = STRIPE_CONFIG.plans[currentPlanId];
        const newPlanConfig = STRIPE_CONFIG.plans[newPlanId];

        if (!currentPlanConfig || !newPlanConfig) {
            throw new Error(`Plan configuration not found for ${currentPlanId} or ${newPlanId}`);
        }

        const currentProductId = currentPlanConfig[billingCycle].productId;
        const newProductId = newPlanConfig[billingCycle].productId;

        // Fetch default prices from products
        const newPriceId = await getDefaultPriceFromProduct(newProductId);

        // Get current subscription 
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        // Check if subscription already has a schedule
        let schedule;
        if (subscription.schedule) {
            // Subscription already has a schedule, retrieve it
            const scheduleId = typeof subscription.schedule === 'string'
                ? subscription.schedule
                : subscription.schedule.id;
            schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
            console.log(`📋 Found existing schedule: ${scheduleId}`);
        } else {
            // Create new schedule from subscription
            schedule = await stripe.subscriptionSchedules.create({
                from_subscription: subscriptionId,
            });
            console.log(`📋 Created new schedule: ${schedule.id}`);
        }

        // Get the current phase from the schedule
        const currentPhase = schedule.phases[0];

        // Update the schedule: keep current phase, add new phase for downgrade
        const updatedSchedule = await stripe.subscriptionSchedules.update(schedule.id, {
            end_behavior: 'release',
            phases: [
                // Phase 1: Keep current phase as-is  
                {
                    items: currentPhase.items,
                    start_date: currentPhase.start_date,
                    end_date: currentPeriodEnd,
                },
                // Phase 2: New plan from period end onwards
                {
                    items: [{ price: newPriceId, quantity: 1 }],
                    start_date: currentPeriodEnd,
                },
            ],
        });

        console.log(`✅ Scheduled downgrade: ${currentPlanId} → ${newPlanId} at ${new Date(currentPeriodEnd * 1000).toISOString()}`);

        return updatedSchedule;
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
        } as any);

        return schedules.data.length > 0 ? schedules.data[0] : null;
    } catch (error) {
        console.error('❌ Error getting active schedule:', error);
        return null;
    }
}

/**
 * Extract plan ID from Stripe product ID
 */
export function extractPlanIdFromProduct(productId: string): 'free' | 'pro' | 'ultra' | null {
    // Match against known product IDs in config
    for (const [planId, planConfig] of Object.entries(STRIPE_CONFIG.plans)) {
        if (planConfig.monthly?.productId === productId || planConfig.yearly?.productId === productId) {
            return planId as 'free' | 'pro' | 'ultra';
        }
    }
    return null;
}

export default {
    createDowngradeSchedule,
    cancelSchedule,
    getActiveSchedule,
    extractPlanIdFromProduct,
};
