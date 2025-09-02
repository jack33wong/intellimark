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

      // Check if subscription already exists for this user
      const existingSubscription = await this.getUserSubscription(data.userId);
      
      if (existingSubscription) {
        // Update existing subscription
        subscriptionData.createdAt = existingSubscription.createdAt;
        await FirestoreService.updateDocument(
          this.COLLECTION_NAME,
          data.userId,
          subscriptionData
        );
        console.log(`Updated subscription for user ${data.userId}`);
      } else {
        // Create new subscription
        await FirestoreService.createDocument(
          this.COLLECTION_NAME,
          data.userId,
          subscriptionData
        );
        console.log(`Created new subscription for user ${data.userId}`);
      }

      return subscriptionData;
    } catch (error) {
      console.error('Error creating/updating subscription:', error);
      throw new Error('Failed to save subscription data');
    }
  }

  /**
   * Get user subscription by user ID
   */
  static async getUserSubscription(userId: string): Promise<UserSubscription | null> {
    try {
      const subscription = await FirestoreService.getDocument(
        this.COLLECTION_NAME,
        userId
      );
      
      return subscription as UserSubscription | null;
    } catch (error) {
      console.error('Error getting user subscription:', error);
      return null;
    }
  }

  /**
   * Update subscription status
   */
  static async updateSubscriptionStatus(
    userId: string, 
    status: UserSubscription['status']
  ): Promise<void> {
    try {
      await FirestoreService.updateDocument(
        this.COLLECTION_NAME,
        userId,
        {
          status,
          updatedAt: Date.now(),
        }
      );
      console.log(`Updated subscription status for user ${userId} to ${status}`);
    } catch (error) {
      console.error('Error updating subscription status:', error);
      throw new Error('Failed to update subscription status');
    }
  }

  /**
   * Cancel user subscription
   */
  static async cancelSubscription(userId: string): Promise<void> {
    try {
      await this.updateSubscriptionStatus(userId, 'canceled');
    } catch (error) {
      console.error('Error canceling subscription:', error);
      throw new Error('Failed to cancel subscription');
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
