/**
 * Admin Credit Management API Routes
 */

import express from 'express';
import { adminResetCredits, adminAdjustCredits } from '../../services/creditService.js';

const router = express.Router();

router.post('/:userId/reset', async (req, res) => {
    try {
        const { userId } = req.params;

        // Import services dynamically to avoid circular dependencies if any
        const { default: SubscriptionService } = await import('../../services/subscriptionService.js');
        const { getFirestore } = await import('../../config/firebase.js');
        const stripe = (await import('../../config/stripe.js')).default;
        const db = getFirestore();

        console.log(`🔧 Admin: Performing HARD RESET for user ${userId}`);

        // 1. Get current subscription
        const currentSub = await SubscriptionService.getUserSubscription(userId);

        // 2. Cancel Stripe Subscription if active
        if (currentSub && currentSub.stripeSubscriptionId) {
            try {
                // Determine if it handles a schedule
                if (currentSub.scheduleId) {
                    try {
                        await stripe.subscriptionSchedules.cancel(currentSub.scheduleId);
                        console.log(`✅ Canceled schedule ${currentSub.scheduleId}`);
                    } catch (err) {
                        console.warn(`⚠️ Failed to cancel schedule ${currentSub.scheduleId}:`, err.message);
                    }
                }

                // Cancel subscription immediately
                await stripe.subscriptions.cancel(currentSub.stripeSubscriptionId);
                console.log(`✅ Canceled Stripe subscription ${currentSub.stripeSubscriptionId}`);
            } catch (stripeError) {
                console.warn(`⚠️ Error cancelling Stripe subscription: ${stripeError.message}`);
                // Continue to reset DB even if Stripe fails (might already be cancelled)
            }
        }

        // 3. Reset Firestore Subscription to FREE
        // First, cancel all existing active subscriptions in the CORRECT collection ('userSubscriptions')
        await SubscriptionService.cancelAllActiveSubscriptions(userId);

        // Clean up the erroneous document from previous failed attempt (if it exists)
        try {
            await db.collection('subscriptions').doc(userId).delete();
        } catch (e) { /* ignore */ }

        // Create a new 'Free' subscription record so the UI shows 'Current Plan' on Free
        const now = Date.now();
        await SubscriptionService.createOrUpdateSubscription({
            userId,
            email: currentSub?.email || '',
            planId: 'free',
            billingCycle: 'monthly',
            amount: 0,
            currency: 'gbp',
            stripeSubscriptionId: `free_${userId}_${now}`, // Dummy ID for internal tracking
            stripeCustomerId: currentSub?.stripeCustomerId || '',
            status: 'active',
            currentPeriodStart: Math.floor(now / 1000),
            currentPeriodEnd: Math.floor(now / 1000) + (30 * 24 * 60 * 60) // +30 days
        });

        // 4. Reset Credits to 10 (Hard Reset)
        await db.collection('userCredits').doc(userId).set({
            userId,
            planId: 'free',
            totalCredits: 10, // Explicitly 10 as requested
            usedCredits: 0,
            remainingCredits: 10,
            resetDate: Date.now(),
            updatedAt: Date.now(),
            createdAt: Date.now() // Reset creation date too essentially
        });

        console.log(`✅ Hard reset complete for user ${userId}`);

        res.json({
            success: true,
            message: 'User hard reset successful: Subscription canceled, Plan set to Free, Credits set to 10.'
        });
    } catch (error) {
        console.error('Error resetting credits/subscription:', error);
        res.status(500).json({
            error: 'Failed to reset user',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * POST /api/admin/credits/:userId/adjust
 * Adjust user credits by a specific amount
 * Body: { adjustment: number } (positive to add, negative to subtract)
 */
router.post('/:userId/adjust', async (req, res) => {
    try {
        const { userId } = req.params;
        const { adjustment } = req.body;

        if (typeof adjustment !== 'number') {
            return res.status(400).json({ error: 'Adjustment must be a number' });
        }

        await adminAdjustCredits(userId, adjustment);

        res.json({
            success: true,
            message: `Credits adjusted by ${adjustment}`
        });
    } catch (error) {
        console.error('Error adjusting credits:', error);
        res.status(500).json({
            error: 'Failed to adjust credits',
            details: error.message
        });
    }
});

export default router;
