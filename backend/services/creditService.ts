/**
 * Credit Tracking Service
 * Manages user credit allocation, consumption, and reset
 */

import { getFirestore } from '../config/firebase.js';
import { CREDIT_CONFIG, costToCredits } from '../config/credit.config.js';

const db = getFirestore();

interface UserCredits {
    userId: string;
    planId: 'free' | 'pro' | 'ultra' | 'admin_test';
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
    planId: 'free' | 'pro' | 'ultra' | 'admin_test',
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
export async function getUserCredits(userId: string): Promise<UserCredits> {
    const doc = await db.collection('userCredits').doc(userId).get();
    
    if (doc.exists) {
        return doc.data() as UserCredits;
    }

    // SELF-HEALING: New user signed up but has no Firestore credit record yet.
    // Initialize them immediately on the 'free' plan.
    console.log(`[CREDITS] Initializing missing credit record for new user: ${userId}`);
    
    // Set a standard 30-day reset period for the free tier
    const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
    const resetDate = Date.now() + thirtyDaysInMs;
    
    // This utilizes your existing initializeUserCredits function and the FREE_PLAN_CREDITS env variable
    return await initializeUserCredits(userId, 'free', resetDate);
}

/**
 * Check if user has enough credits
 * Self-healing: auto-initializes credits for users without a record,
 * and reconciles plan drift when subscriptions expire or change.
 */
export async function checkCredits(
    userId: string,
    estimatedCost: number,
    currentPlan: 'free' | 'pro' | 'ultra' | 'admin_test' = 'free'
): Promise<{ canProceed: boolean; warning?: string; remaining: number }> {
    let credits = await getUserCredits(userId);

    // Reconcile if the subscription plan has changed since the credit record was created
    // (e.g., subscription expired → planMiddleware says 'free', but record still says 'pro')
    if (credits.planId !== currentPlan) {
        console.log(`🔄 [CREDIT] Plan drift detected: record=${credits.planId}, actual=${currentPlan}. Reconciling...`);
        await updateCreditsOnPlanChange(
            userId,
            credits.planId,
            currentPlan,
            Date.now() + 30 * 24 * 60 * 60 * 1000
        );
        credits = await getUserCredits(userId) as UserCredits;
    }

    const creditsNeeded = costToCredits(estimatedCost);
    const remaining = credits.remainingCredits;

    // BLOCK if negative or zero
    if (remaining <= 0) {
        return {
            canProceed: false,
            warning: `❌ You have exhausted your credits (${remaining.toFixed(2)} remaining). Please top up to continue using AI features.`,
            remaining
        };
    }

    // Safety Cap: Block if the transaction itself is too large (>$0.60 / 60 credits) AND they are relying on an overdraft
    if (creditsNeeded > 60 && creditsNeeded > remaining) {
        return {
            canProceed: false,
            warning: `❌ Upload too large. Estimated cost (${creditsNeeded} credits) exceeds the 60-credit safety limit for overdrafts.`,
            remaining
        };
    }

    // Otherwise, PROCEED! (Allowing overdrafts up to the safety limit)
    if (remaining < 5) {
        return {
            canProceed: true,
            warning: `⚠️ Low credits: ${remaining.toFixed(2)} remaining. Consider upgrading your plan.`,
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
    const newUsed = Math.round((credits.usedCredits + creditsToDeduct) * 100) / 100;
    const newRemaining = Math.round((credits.totalCredits - newUsed) * 100) / 100;

    await userCreditsRef.update({
        usedCredits: newUsed,
        remainingCredits: newRemaining,
        updatedAt: now
    });

    console.log(`💳 Deducted ${creditsToDeduct.toFixed(2)} credits from user ${userId} (session: ${sessionId}), remaining: ${newRemaining.toFixed(2)}`);
}

/**
 * Reset credits on subscription renewal (Stripe webhook)
 */
export async function resetCreditsOnRenewal(
    userId: string,
    planId: 'free' | 'pro' | 'ultra' | 'admin_test',
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
    newPlanId: 'free' | 'pro' | 'ultra' | 'admin_test',
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
    const levels: Record<string, number> = { free: 0, pro: 1, ultra: 2, admin_test: 3 };
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
