/**
 * Credit Tracking Service
 * Manages user credit allocation, consumption, and reset
 */

import { getFirestore } from '../config/firebase.js';
import { CREDIT_CONFIG, costToCredits } from '../config/credit.config.js';

const db = getFirestore();

interface UserCredits {
    userId: string;
    planId: 'free' | 'pro' | 'enterprise';
    totalCredits: number;
    usedCredits: number;
    remainingCredits: number;
    resetDate: number;
    createdAt: number;
    updatedAt: number;
}

/**
 * Initialize user credits when they subscribe
 */
export async function initializeUserCredits(
    userId: string,
    planId: 'free' | 'pro' | 'enterprise',
    subscriptionEndDate: number
): Promise<UserCredits> {
    const now = Date.now();
    const totalCredits = CREDIT_CONFIG.planCredits[planId];

    const userCredits: UserCredits = {
        userId,
        planId,
        totalCredits,
        usedCredits: 0,
        remainingCredits: totalCredits,
        resetDate: subscriptionEndDate,
        createdAt: now,
        updatedAt: now
    };

    await db.collection('userCredits').doc(userId).set(userCredits);
    console.log(`✅ Initialized ${totalCredits} credits for user ${userId} (${planId}), reset: ${new Date(subscriptionEndDate).toISOString()}`);

    return userCredits;
}

/**
 * Get user credits
 */
export async function getUserCredits(userId: string): Promise<UserCredits | null> {
    const doc = await db.collection('userCredits').doc(userId).get();
    return doc.exists ? doc.data() as UserCredits : null;
}

/**
 * Check if user has enough credits
 * Returns warning but ALLOWS operation even if exhausted
 */
export async function checkCredits(
    userId: string,
    estimatedCost: number
): Promise<{ canProceed: boolean; warning?: string; remaining: number }> {
    const credits = await getUserCredits(userId);

    if (!credits) {
        return {
            canProceed: true,
            warning: 'Credits not initialized. Operation will proceed.',
            remaining: 0
        };
    }

    const creditsNeeded = costToCredits(estimatedCost);
    const remaining = credits.remainingCredits;

    // ALWAYS allow, but warn if low/exhausted
    if (remaining <= 0) {
        return {
            canProceed: true,
            warning: `⚠️ You have exhausted your ${credits.planId} plan credits (0 remaining). Consider upgrading for more credits. This operation will proceed but may affect your quota.`,
            remaining: 0
        };
    }

    if (creditsNeeded > remaining) {
        return {
            canProceed: true,
            warning: `⚠️ Low credits: Need ${creditsNeeded}, have ${remaining}. Upgrade your plan for more credits. This operation will proceed.`,
            remaining
        };
    }

    if (remaining < 5) {
        return {
            canProceed: true,
            warning: `⚠️ Low credits: ${remaining} remaining. Consider upgrading your plan.`,
            remaining
        };
    }

    return {
        canProceed: true,
        remaining
    };
}

/**
 * Deduct credits after marking completes
 * NO REFUNDS - all estimated credits are consumed
 */
export async function deductCredits(
    userId: string,
    actualCost: number,
    sessionId: string
): Promise<void> {
    const creditsToDeduct = costToCredits(actualCost);
    const userCreditsRef = db.collection('userCredits').doc(userId);

    const doc = await userCreditsRef.get();
    if (!doc.exists) {
        console.warn(`⚠️ No credits record for user ${userId}, skipping deduction`);
        return;
    }

    const credits = doc.data() as UserCredits;
    const now = Date.now();

    // Deduct credits (can go negative)
    const newUsed = credits.usedCredits + creditsToDeduct;
    const newRemaining = credits.totalCredits - newUsed;

    await userCreditsRef.update({
        usedCredits: newUsed,
        remainingCredits: newRemaining,
        updatedAt: now
    });

    console.log(`💳 Deducted ${creditsToDeduct} credits from user ${userId} (session: ${sessionId}), remaining: ${newRemaining}`);
}

/**
 * Reset credits on subscription renewal (Stripe webhook)
 */
export async function resetCreditsOnRenewal(
    userId: string,
    planId: 'free' | 'pro' | 'enterprise',
    nextRenewalDate: number
): Promise<void> {
    const totalCredits = CREDIT_CONFIG.planCredits[planId];
    const now = Date.now();

    await db.collection('userCredits').doc(userId).set({
        userId,
        planId,
        totalCredits,
        usedCredits: 0,
        remainingCredits: totalCredits,
        resetDate: nextRenewalDate,
        updatedAt: now,
        createdAt: now // Will be overwritten if exists
    }, { merge: true });

    console.log(`🔄 Reset credits for user ${userId}: ${totalCredits} credits (${planId}), next reset: ${new Date(nextRenewalDate).toISOString()}`);
}

/**
 * Update credits on plan change
 */
export async function updateCreditsOnPlanChange(
    userId: string,
    oldPlanId: string,
    newPlanId: 'free' | 'pro' | 'enterprise',
    subscriptionEndDate: number
): Promise<void> {
    const userCreditsRef = db.collection('userCredits').doc(userId);
    const doc = await userCreditsRef.get();

    const newPlanCredits = CREDIT_CONFIG.planCredits[newPlanId];
    const now = Date.now();

    if (!doc.exists) {
        // Initialize if doesn't exist
        await initializeUserCredits(userId, newPlanId, subscriptionEndDate);
        return;
    }

    const currentCredits = doc.data() as UserCredits;
    const levels = { free: 0, pro: 1, enterprise: 2 };
    const isUpgrade = levels[newPlanId] > levels[oldPlanId];

    if (isUpgrade) {
        // Upgrade: Keep unused + add new allocation
        const newRemaining = currentCredits.remainingCredits + newPlanCredits;
        await userCreditsRef.update({
            planId: newPlanId,
            totalCredits: newPlanCredits,
            remainingCredits: newRemaining,
            usedCredits: Math.max(0, newPlanCredits - newRemaining), // Recalculate
            resetDate: subscriptionEndDate,
            updatedAt: now
        });
        console.log(`⬆️ Upgrade: ${oldPlanId} → ${newPlanId}, credits: ${currentCredits.remainingCredits} + ${newPlanCredits} = ${newRemaining}`);
    } else {
        // Downgrade: Cap at new plan limit (forfeit excess)
        const newRemaining = Math.min(currentCredits.remainingCredits, newPlanCredits);
        await userCreditsRef.update({
            planId: newPlanId,
            totalCredits: newPlanCredits,
            remainingCredits: newRemaining,
            usedCredits: newPlanCredits - newRemaining,
            resetDate: subscriptionEndDate,
            updatedAt: now
        });
        console.log(`⬇️ Downgrade: ${oldPlanId} → ${newPlanId}, credits capped: ${currentCredits.remainingCredits} → ${newRemaining}`);
    }
}

/**
 * Admin: Reset user credits to plan default allocation
 */
export async function adminResetCredits(userId: string): Promise<void> {
    const userCreditsRef = db.collection('userCredits').doc(userId);
    const doc = await userCreditsRef.get();

    if (!doc.exists) {
        throw new Error('Credits not initialized for this user');
    }

    const credits = doc.data() as UserCredits;
    const planCredits = CREDIT_CONFIG.planCredits[credits.planId];
    const now = Date.now();

    await userCreditsRef.update({
        usedCredits: 0,
        remainingCredits: planCredits,
        updatedAt: now
    });

    console.log(`🔧 Admin: Reset credits for user ${userId} to ${planCredits} (${credits.planId} plan)`);
}

/**
 * Admin: Adjust user credits by a specific amount (positive or negative)
 */
export async function adminAdjustCredits(userId: string, adjustment: number): Promise<void> {
    const userCreditsRef = db.collection('userCredits').doc(userId);
    const doc = await userCreditsRef.get();

    if (!doc.exists) {
        throw new Error('Credits not initialized for this user');
    }

    const credits = doc.data() as UserCredits;
    const newRemaining = Math.max(0, credits.remainingCredits + adjustment);
    const newUsed = credits.totalCredits - newRemaining;
    const now = Date.now();

    await userCreditsRef.update({
        usedCredits: newUsed,
        remainingCredits: newRemaining,
        updatedAt: now
    });

    console.log(`🔧 Admin: Adjusted credits for user ${userId}: ${credits.remainingCredits} ${adjustment >= 0 ? '+' : ''}${adjustment} = ${newRemaining}`);
}

export default {
    initializeUserCredits,
    getUserCredits,
    checkCredits,
    deductCredits,
    resetCreditsOnRenewal,
    updateCreditsOnPlanChange,
    adminResetCredits,
    adminAdjustCredits
};
