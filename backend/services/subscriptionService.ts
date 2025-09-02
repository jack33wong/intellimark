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

      // Check if this specific Stripe subscription already exists
      const existingSubscription = await this.getSubscriptionByStripeId(data.stripeSubscriptionId);
      
      if (existingSubscription) {
        // Update existing subscription (same Stripe subscription ID)
        subscriptionData.createdAt = existingSubscription.createdAt;
        await FirestoreService.updateDocument(
          this.COLLECTION_NAME,
          data.userId,
          subscriptionData
        );
        console.log(`Updated existing subscription for user ${data.userId}`);
      } else {
        // This is a new subscription - cancel any existing active subscriptions first
        await this.cancelAllActiveSubscriptions(data.userId);
        
        // Create new subscription (let Firestore generate a unique document ID)
        const docRef = await FirestoreService.createDocument(
          this.COLLECTION_NAME,
          null, // Let Firestore generate the document ID
          subscriptionData
        );
        console.log(`Created new subscription for user ${data.userId} with ID: ${docRef.id}`);
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
        subscription.id,
        {
          status,
          updatedAt: Date.now(),
        }
      );
      console.log(`Updated subscription status for ${stripeSubscriptionId} to ${status}`);
    } catch (error) {
      console.error('Error updating subscription status:', error);
      throw new Error('Failed to update subscription status');
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
        console.log(`Canceled subscription ${subscription.id} for user ${userId}`);
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
      console.error('Error getting subscription by Stripe ID:', error);
      return null;
    }
  }
}

export default SubscriptionService;
