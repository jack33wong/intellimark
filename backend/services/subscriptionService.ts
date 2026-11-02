import { FirestoreService } from './firestoreService.js';

export interface UserSubscription {
  userId: string;
  email: string;
  planId: string;
  billingCycle: string;
  amount: number;
  currency: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: 'active' | 'canceled' | 'past_due' | 'unpaid';
  currentPeriodStart: number;
  currentPeriodEnd: number;
  createdAt: number;
  updatedAt: number;

  // Schedule tracking fields
  scheduledPlanId?: string;
  scheduleId?: string;
  scheduleEffectiveDate?: number;
  previousPlanId?: string;
  planChangedAt?: number;
}

export interface CreateSubscriptionData {
  userId: string;
  email: string;
  planId: string;
  billingCycle: string;
  amount: number;
  currency: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: string;
  currentPeriodStart: number;
  currentPeriodEnd: number;
}

export class SubscriptionService {
  private static readonly COLLECTION_NAME = 'userSubscriptions';

  /**
   * Create or update a user subscription
   */
  static async createOrUpdateSubscription(data: CreateSubscriptionData): Promise<UserSubscription> {
    try {
      const subscriptionData: UserSubscription = {
        userId: data.userId,
        email: data.email,
        planId: data.planId,
        billingCycle: data.billingCycle,
        amount: data.amount,
        currency: data.currency,
        stripeSubscriptionId: data.stripeSubscriptionId,
        stripeCustomerId: data.stripeCustomerId,
        status: data.status as UserSubscription['status'],
        currentPeriodStart: data.currentPeriodStart,
        currentPeriodEnd: data.currentPeriodEnd,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      // Use the Stripe Subscription ID as the Firestore Document ID to ensure idempotency
      const stripeId = data.stripeSubscriptionId;
      const existingSubscription = await this.getSubscriptionByStripeId(stripeId);

      if (existingSubscription) {
        // Update existing subscription
        // Use the actual document ID (which might be the Stripe ID if newly created, or a random ID if legacy)
        const docId = (existingSubscription as any).id;
        await FirestoreService.updateDocument(
          this.COLLECTION_NAME,
          docId,
          {
            ...subscriptionData,
            createdAt: existingSubscription.createdAt // Preserve original creation date
          }
        );
      } else {
        // This is a new subscription - cancel any existing active subscriptions first
        await this.cancelAllActiveSubscriptions(data.userId);

        // Create new subscription using Stripe ID as document ID to prevent race conditions
        await FirestoreService.createDocument(
          this.COLLECTION_NAME,
          stripeId,
          subscriptionData
        );
      }

      return subscriptionData;
    } catch (error) {
      console.error('Error creating/updating subscription:', error);
      throw new Error('Failed to save subscription data');
    }
  }

  /**
   * Get user's current active subscription by user ID
   */
  static async getUserSubscription(userId: string): Promise<UserSubscription | null> {
    try {
      // Get all subscriptions for this user
      const subscriptions = await FirestoreService.queryCollection(
        this.COLLECTION_NAME,
        'userId',
        '==',
        userId
      );

      // Find the active subscription (most recent one with status 'active')
      const activeSubscription = subscriptions
        .filter(sub => sub.status === 'active')
        .sort((a, b) => b.createdAt - a.createdAt)[0];

      if (activeSubscription) {
        // Fix for legacy subscriptions created with wrong amount format (e.g. 19.9 instead of 1990)
        // CRITICAL BUG FIX: Ensure we don't pad correct small amounts (like 50p for admin_test)
        if (activeSubscription.amount > 0 && activeSubscription.amount < 100 && activeSubscription.planId !== 'admin_test') {
          // If it's a known legacy amount (19.9, 29.9, etc) or likely a major unit
          // We'll keep this for safety but exclude the new test plan
          activeSubscription.amount = Math.round(activeSubscription.amount * 100);
        }

        // =========================================================================
        // JIT (Just-In-Time) Lazy Reconciliation
        // Only triggers when the billing period or scheduled date has actually passed.
        // For active, in-period subscriptions (99.9% of requests), returns instantly (0ms).
        // =========================================================================
        const now = Date.now();
        const periodEndMs = (activeSubscription.currentPeriodEnd || 0) * 1000;
        const scheduleDueMs = activeSubscription.scheduleEffectiveDate || 0;
        const isPeriodExpired = periodEndMs > 0 && now >= periodEndMs;
        const isScheduleDue = scheduleDueMs > 0 && now >= scheduleDueMs;

        if (isPeriodExpired || isScheduleDue) {
          try {
            console.log(`🔄 [JIT SYNC] User ${userId} subscription ${activeSubscription.stripeSubscriptionId} due for sync (periodExpired: ${isPeriodExpired}, scheduleDue: ${isScheduleDue}). Reconciling...`);
            const reconciledSub = await this.reconcileSubscriptionWithStripe(activeSubscription);
            if (!reconciledSub || reconciledSub.status !== 'active') {
              return null;
            }
            return reconciledSub;
          } catch (syncError) {
            console.error('⚠️ [JIT SYNC] Failed to reconcile subscription, falling back to cached record:', syncError);
          }
        }
      }

      return activeSubscription as UserSubscription | null;
    } catch (error) {
      console.error('Error getting user subscription:', error);
      return null;
    }
  }

  /**
   * Get all subscriptions for a user (including historical)
   */
  static async getAllUserSubscriptions(userId: string): Promise<UserSubscription[]> {
    try {
      const subscriptions = await FirestoreService.queryCollection(
        this.COLLECTION_NAME,
        'userId',
        '==',
        userId
      );

      return subscriptions.sort((a, b) => b.createdAt - a.createdAt) as UserSubscription[];
    } catch (error) {
      console.error('Error getting all user subscriptions:', error);
      return [];
    }
  }

  /**
   * Get all active subscriber user IDs
   */
  static async getActiveSubscriberIds(): Promise<string[]> {
    try {
      const subscriptions = await FirestoreService.queryCollection(
        this.COLLECTION_NAME,
        'status',
        '==',
        'active'
      );

      // Extract unique userIds from active subscriptions
      const subscriberIds = new Set(subscriptions.map(sub => sub.userId));
      return Array.from(subscriberIds) as string[];
    } catch (error) {
      console.error('Error getting active subscriber IDs:', error);
      return [];
    }
  }

  /**
   * Update subscription status by Stripe subscription ID
   */
  static async updateSubscriptionStatus(
    stripeSubscriptionId: string,
    status: UserSubscription['status']
  ): Promise<void> {
    try {
      const subscription = await this.getSubscriptionByStripeId(stripeSubscriptionId);
      if (!subscription) {
        throw new Error(`Subscription not found: ${stripeSubscriptionId}`);
      }

      await FirestoreService.updateDocument(
        this.COLLECTION_NAME,
        (subscription as any).id,
        {
          status,
          updatedAt: Date.now(),
        }
      );
    } catch (error) {
      console.error('Error updating subscription status:', error);
      throw new Error('Failed to update subscription status');
    }
  }

  /**
   * Update subscription with partial data by Stripe subscription ID
   */
  static async updateSubscription(
    stripeSubscriptionId: string,
    updates: Partial<Omit<UserSubscription, 'userId' | 'stripeSubscriptionId' | 'stripeCustomerId'>>
  ): Promise<void> {
    try {
      const subscription = await this.getSubscriptionByStripeId(stripeSubscriptionId);
      if (!subscription) {
        throw new Error(`Subscription not found: ${stripeSubscriptionId}`);
      }

      await FirestoreService.updateDocument(
        this.COLLECTION_NAME,
        (subscription as any).id,
        {
          ...updates,
          updatedAt: Date.now(),
        }
      );
    } catch (error) {
      console.error('Error updating subscription:', error);
      throw new Error('Failed to update subscription');
    }
  }

  /**
   * Cancel user subscription by Stripe subscription ID
   */
  static async cancelSubscription(stripeSubscriptionId: string): Promise<void> {
    try {
      await this.updateSubscriptionStatus(stripeSubscriptionId, 'canceled');
    } catch (error) {
      console.error('Error canceling subscription:', error);
      throw new Error('Failed to cancel subscription');
    }
  }

  /**
   * Cancel all active subscriptions for a user (when creating a new subscription)
   */
  static async cancelAllActiveSubscriptions(userId: string): Promise<void> {
    try {
      const subscriptions = await FirestoreService.queryCollection(
        this.COLLECTION_NAME,
        'userId',
        '==',
        userId
      );

      const activeSubscriptions = subscriptions.filter(sub => sub.status === 'active');

      for (const subscription of activeSubscriptions) {
        await FirestoreService.updateDocument(
          this.COLLECTION_NAME,
          subscription.id,
          {
            status: 'canceled',
            updatedAt: Date.now(),
          }
        );
      }
    } catch (error) {
      console.error('Error canceling all active subscriptions:', error);
      throw new Error('Failed to cancel active subscriptions');
    }
  }

  /**
   * Get subscription by Stripe subscription ID
   */
  static async getSubscriptionByStripeId(stripeSubscriptionId: string): Promise<UserSubscription | null> {
    try {
      const subscriptions = await FirestoreService.queryCollection(
        this.COLLECTION_NAME,
        'stripeSubscriptionId',
        '==',
        stripeSubscriptionId
      );


      return subscriptions.length > 0 ? subscriptions[0] as UserSubscription : null;
    } catch (error) {
      console.error('❌ Error getting subscription by Stripe ID:', error);
      return null;
    }
  }

  /**
   * JIT (Just-In-Time) Reconciliation:
   * Synchronizes an expired or due subscription with Stripe on-demand without requiring background cron jobs.
   */
  static async reconcileSubscriptionWithStripe(subscription: UserSubscription): Promise<UserSubscription | null> {
    const docId = (subscription as any).id || subscription.stripeSubscriptionId;
    const now = Date.now();

    let stripeSub: any = null;
    if (subscription.stripeSubscriptionId) {
      try {
        const stripe = (await import('../config/stripe.js')).default;
        stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
      } catch (stripeErr: any) {
        if (stripeErr.message?.includes('No such subscription') || stripeErr.code === 'resource_missing') {
          console.log(`[JIT SYNC] Stripe subscription ${subscription.stripeSubscriptionId} missing in Stripe. Finalizing cancel locally.`);
          await FirestoreService.updateDocument(this.COLLECTION_NAME, docId, {
            status: 'canceled',
            scheduledPlanId: null,
            scheduleId: null,
            scheduleEffectiveDate: null,
            updatedAt: now,
          });
          const { updateCreditsOnPlanChange } = await import('./creditService.js');
          await updateCreditsOnPlanChange(subscription.userId, subscription.planId as any, 'free', now + 30 * 24 * 3600 * 1000);
          subscription.status = 'canceled';
          return null;
        }
        console.warn('[JIT SYNC] Non-fatal error retrieving Stripe subscription:', stripeErr.message);
      }
    }

    // 1. If Stripe explicitly marked canceled / incomplete_expired:
    if (stripeSub && (stripeSub.status === 'canceled' || stripeSub.status === 'incomplete_expired')) {
      console.log(`[JIT SYNC] Subscription ${subscription.stripeSubscriptionId} status is ${stripeSub.status} in Stripe. Updating Firestore.`);
      await FirestoreService.updateDocument(this.COLLECTION_NAME, docId, {
        status: 'canceled',
        scheduledPlanId: null,
        scheduleId: null,
        scheduleEffectiveDate: null,
        updatedAt: now,
      });
      const { updateCreditsOnPlanChange } = await import('./creditService.js');
      await updateCreditsOnPlanChange(subscription.userId, subscription.planId as any, 'free', now + 30 * 24 * 3600 * 1000);
      subscription.status = 'canceled';
      return null;
    }

    // 2. If scheduled downgrade to free has reached its effective date:
    if (subscription.scheduledPlanId === 'free' && subscription.scheduleEffectiveDate && now >= subscription.scheduleEffectiveDate) {
      console.log(`[JIT SYNC] Scheduled downgrade to free for user ${subscription.userId} reached effective date. Finalizing cancel.`);
      await FirestoreService.updateDocument(this.COLLECTION_NAME, docId, {
        status: 'canceled',
        scheduledPlanId: null,
        scheduleId: null,
        scheduleEffectiveDate: null,
        updatedAt: now,
      });
      const { updateCreditsOnPlanChange } = await import('./creditService.js');
      await updateCreditsOnPlanChange(subscription.userId, subscription.planId as any, 'free', now + 30 * 24 * 3600 * 1000);
      subscription.status = 'canceled';
      return null;
    }

    // 3. If Stripe confirms active: sync period dates and check for renewal/plan changes
    if (stripeSub && stripeSub.status === 'active') {
      const newPeriodStart = stripeSub.current_period_start;
      const newPeriodEnd = stripeSub.current_period_end;
      let targetPlanId: 'free' | 'pro' | 'ultra' | 'admin_test' = (subscription.planId as any) || 'free';

      if (subscription.scheduledPlanId && subscription.scheduledPlanId !== 'free' && subscription.scheduleEffectiveDate && now >= subscription.scheduleEffectiveDate) {
        targetPlanId = subscription.scheduledPlanId as any;
      }

      const updates: any = {
        currentPeriodStart: newPeriodStart,
        currentPeriodEnd: newPeriodEnd,
        updatedAt: now,
      };

      if (subscription.scheduleEffectiveDate && now >= subscription.scheduleEffectiveDate) {
        updates.planId = targetPlanId;
        updates.scheduledPlanId = null;
        updates.scheduleId = null;
        updates.scheduleEffectiveDate = null;
      }

      await FirestoreService.updateDocument(this.COLLECTION_NAME, docId, updates);

      // If period rolled forward (renewed), refresh monthly credits
      if (newPeriodEnd > (subscription.currentPeriodEnd || 0)) {
        console.log(`[JIT SYNC] Subscription renewed to ${newPeriodEnd}. Refreshing credits...`);
        const { updateCreditsOnPlanChange } = await import('./creditService.js');
        await updateCreditsOnPlanChange(subscription.userId, subscription.planId as any, targetPlanId, newPeriodEnd * 1000);
      }

      Object.assign(subscription, updates);
      return subscription;
    }

    return subscription;
  }
}

export default SubscriptionService;
