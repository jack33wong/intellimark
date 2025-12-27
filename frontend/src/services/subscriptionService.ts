import { UserSubscription } from '../types/payment';

export interface SubscriptionResponse {
  hasSubscription: boolean;
  subscription: UserSubscription | null;
}

class SubscriptionService {
  private static readonly API_BASE = '/api/payment';

  /**
   * Get user subscription details
   */
  static async getUserSubscription(userId: string): Promise<SubscriptionResponse> {
    try {
      const response = await fetch(`${this.API_BASE}/user-subscription/${userId}`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching user subscription:', error);
      return {
        hasSubscription: false,
        subscription: null,
      };
    }
  }

  /**
   * Get plan display name
   */
  static getPlanDisplayName(planId: string): string {
    switch (planId) {
      case 'free':
        return 'Free';
      case 'pro':
        return 'Pro';
      case 'ultra':
        return 'Ultra';
      default:
        return planId.charAt(0).toUpperCase() + planId.slice(1);
    }
  }

  /**
   * Get billing cycle display name
   */
  static getBillingCycleDisplayName(billingCycle: string): string {
    return billingCycle === 'monthly' ? 'Monthly' : 'Yearly';
  }

  /**
   * Format subscription status
   */
  static formatSubscriptionStatus(status: string): string {
    switch (status) {
      case 'active':
        return 'Active';
      case 'canceled':
        return 'Canceled';
      case 'past_due':
        return 'Past Due';
      case 'unpaid':
        return 'Unpaid';
      default:
        return status.charAt(0).toUpperCase() + status.slice(1);
    }
  }

  /**
   * Check if subscription is active
   */
  static isSubscriptionActive(subscription: UserSubscription | null): boolean {
    return subscription?.status === 'active';
  }

  /**
   * Get subscription expiry date
   */
  static getSubscriptionExpiryDate(subscription: UserSubscription | null): Date | null {
    if (!subscription) return null;
    return new Date(subscription.currentPeriodEnd * 1000);
  }

  /**
   * Format subscription expiry date
   */
  static formatSubscriptionExpiryDate(subscription: UserSubscription | null): string {
    const expiryDate = this.getSubscriptionExpiryDate(subscription);
    if (!expiryDate) return 'N/A';

    return expiryDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
}

export default SubscriptionService;
