import stripe from '../config/stripe.js';
import { STRIPE_CONFIG } from '../config/stripe.js';

export interface CreatePaymentIntentRequest {
  planId: string;
  billingCycle: string;
  customerEmail: string;
  customerId?: string;
}

export interface CreatePaymentIntentResponse {
  paymentIntent: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    client_secret: string;
  };
}

export interface CreateCheckoutSessionRequest {
  planId: string;
  billingCycle: string;
  successUrl: string;
  cancelUrl: string;
  userId: string;
}

export interface SubscriptionData {
  planId: string;
  billingCycle: string;
  customerEmail: string;
  customerId?: string;
}

export class PaymentService {
  async createCheckoutSession(data: CreateCheckoutSessionRequest) {
    const { planId, billingCycle, successUrl, cancelUrl, userId } = data;
    
    const planConfig = STRIPE_CONFIG.plans[planId as keyof typeof STRIPE_CONFIG.plans];
    if (!planConfig) {
      throw new Error(`Plan ${planId} not found`);
    }

    const priceConfig = planConfig[billingCycle as keyof typeof planConfig];
    if (!priceConfig) {
      throw new Error(`Billing cycle ${billingCycle} not found for plan ${planId}`);
    }

    // Check if priceId is valid (starts with 'price_')
    if (!priceConfig.priceId || !priceConfig.priceId.startsWith('price_')) {
      // Create a price dynamically for testing
      
      const price = await stripe.prices.create({
        unit_amount: priceConfig.amount,
        currency: STRIPE_CONFIG.currency,
        recurring: {
          interval: billingCycle === 'monthly' ? 'month' : 'year',
        },
        product_data: {
          name: `${planId.charAt(0).toUpperCase() + planId.slice(1)} Plan (${billingCycle})`,
        },
      });
      
      priceConfig.priceId = price.id;
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceConfig.priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${successUrl}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      metadata: {
        planId,
        billingCycle,
        userId,
      },
      subscription_data: {
        metadata: {
          planId,
          billingCycle,
          userId,
        },
      },
    });

    return session;
  }

  async createPaymentIntent(data: CreatePaymentIntentRequest): Promise<CreatePaymentIntentResponse> {
    const { planId, billingCycle, customerEmail, customerId } = data;
    
    const planConfig = STRIPE_CONFIG.plans[planId as keyof typeof STRIPE_CONFIG.plans];
    if (!planConfig) {
      throw new Error(`Plan ${planId} not found`);
    }

    const priceConfig = planConfig[billingCycle as keyof typeof planConfig];
    if (!priceConfig) {
      throw new Error(`Billing cycle ${billingCycle} not found for plan ${planId}`);
    }

    // Create or retrieve customer
    let customer;
    if (customerId) {
      try {
        customer = await stripe.customers.retrieve(customerId);
      } catch (error) {
        // Customer doesn't exist, create new one
        customer = await stripe.customers.create({
          email: customerEmail,
          metadata: { userId: customerId },
        });
      }
    } else {
      customer = await stripe.customers.create({
        email: customerEmail,
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: priceConfig.amount,
      currency: STRIPE_CONFIG.currency,
      customer: customer.id,
      metadata: {
        planId,
        billingCycle,
        customerEmail,
      },
    });

    return {
      paymentIntent: {
        id: paymentIntent.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: paymentIntent.status,
        client_secret: paymentIntent.client_secret || '',
      },
    };
  }

  async createSubscription(data: SubscriptionData) {
    const { planId, billingCycle, customerEmail, customerId } = data;
    
    const planConfig = STRIPE_CONFIG.plans[planId as keyof typeof STRIPE_CONFIG.plans];
    if (!planConfig) {
      throw new Error(`Plan ${planId} not found`);
    }

    const priceConfig = planConfig[billingCycle as keyof typeof planConfig];
    if (!priceConfig) {
      throw new Error(`Billing cycle ${billingCycle} not found for plan ${planId}`);
    }

    // Create or retrieve customer
    let customer;
    if (customerId) {
      try {
        customer = await stripe.customers.retrieve(customerId);
      } catch (error) {
        // Customer doesn't exist, create new one
        customer = await stripe.customers.create({
          email: customerEmail,
          metadata: { userId: customerId },
        });
      }
    } else {
      customer = await stripe.customers.create({
        email: customerEmail,
      });
    }

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [
        {
          price: priceConfig.priceId,
        },
      ],
      metadata: {
        planId,
        billingCycle,
        customerEmail,
        userId: customerId || '',
      },
    });

    return {
      subscriptionId: subscription.id,
      status: subscription.status,
      planId,
      billingCycle,
      amount: priceConfig.amount,
      currency: STRIPE_CONFIG.currency,
      currentPeriodStart: (subscription as any).current_period_start,
      currentPeriodEnd: (subscription as any).current_period_end,
    };
  }

  async getSubscription(subscriptionId: string) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    return subscription;
  }

  async cancelSubscription(subscriptionId: string) {
    const subscription = await stripe.subscriptions.cancel(subscriptionId);
    return subscription;
  }
}

export default new PaymentService();
