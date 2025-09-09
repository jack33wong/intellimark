/**
 * Subscription Delay Service
 * Handles response delays based on user subscription plans
 */

export interface SubscriptionPlan {
  type: 'free' | 'pro' | 'enterprise';
  name: string;
  delayMs: number;
}

export class SubscriptionDelayService {
  private static instance: SubscriptionDelayService;
  private subscriptionPlans: Map<string, SubscriptionPlan> = new Map();

  private constructor() {
    this.initializeSubscriptionPlans();
  }

  public static getInstance(): SubscriptionDelayService {
    if (!SubscriptionDelayService.instance) {
      SubscriptionDelayService.instance = new SubscriptionDelayService();
    }
    return SubscriptionDelayService.instance;
  }

  private initializeSubscriptionPlans(): void {
    // Load delays from environment variables
    const freeDelay = parseInt(process.env.SUBSCRIPTION_DELAY_FREE || '3000');
    const proDelay = parseInt(process.env.SUBSCRIPTION_DELAY_PRO || '1000');
    const enterpriseDelay = parseInt(process.env.SUBSCRIPTION_DELAY_ENTERPRISE || '0');
    const defaultDelay = parseInt(process.env.SUBSCRIPTION_DELAY_DEFAULT || '3000');

    this.subscriptionPlans.set('free', {
      type: 'free',
      name: 'Free',
      delayMs: freeDelay
    });

    this.subscriptionPlans.set('pro', {
      type: 'pro',
      name: 'Pro',
      delayMs: proDelay
    });

    this.subscriptionPlans.set('enterprise', {
      type: 'enterprise',
      name: 'Enterprise',
      delayMs: enterpriseDelay
    });

    this.subscriptionPlans.set('default', {
      type: 'free',
      name: 'Default',
      delayMs: defaultDelay
    });

    console.log('📊 Subscription Delay Service initialized:');
    console.log(`  - Free: ${freeDelay}ms`);
    console.log(`  - Pro: ${proDelay}ms`);
    console.log(`  - Enterprise: ${enterpriseDelay}ms`);
    console.log(`  - Default: ${defaultDelay}ms`);
  }

  /**
   * Get delay for a specific subscription type
   */
  public getDelay(subscriptionType: string): number {
    const plan = this.subscriptionPlans.get(subscriptionType.toLowerCase());
    if (plan) {
      return plan.delayMs;
    }
    
    // Return default delay for unknown subscription types
    const defaultPlan = this.subscriptionPlans.get('default');
    return defaultPlan?.delayMs || 3000;
  }

  /**
   * Get subscription plan details
   */
  public getSubscriptionPlan(subscriptionType: string): SubscriptionPlan {
    const plan = this.subscriptionPlans.get(subscriptionType.toLowerCase());
    if (plan) {
      return plan;
    }
    
    // Return default plan for unknown subscription types
    return this.subscriptionPlans.get('default') || {
      type: 'free',
      name: 'Default',
      delayMs: 3000
    };
  }

  /**
   * Apply delay based on subscription type
   */
  public async applyDelay(subscriptionType: string): Promise<void> {
    const delayMs = this.getDelay(subscriptionType);
    
    if (delayMs > 0) {
      console.log(`⏱️ Applying ${delayMs}ms delay for ${subscriptionType} subscription`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  /**
   * Get all subscription plans
   */
  public getAllPlans(): SubscriptionPlan[] {
    return Array.from(this.subscriptionPlans.values());
  }
}

export default SubscriptionDelayService;
