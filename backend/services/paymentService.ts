import stripe from '../config/stripe.js';
import { STRIPE_CONFIG } from '../config/stripe.js';
import SubscriptionService from './subscriptionService.js';

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

    let priceId = priceConfig.priceId;

    // Check if priceId is actually a product ID (starts with 'prod_')
    if (priceId && priceId.startsWith('prod_')) {
      // Fetch the product to get its default price
      const product = await stripe.products.retrieve(priceId, {
        expand: ['default_price']
      });

      if (product.default_price) {
        priceId = typeof product.default_price === 'string'
          ? product.default_price
          : product.default_price.id;
      } else {
        throw new Error(
          `Product ${priceId} has no default price. Please set a default price in Stripe Dashboard or use a Price ID.`
        );
      }
    }

    // Validate that we have a valid price ID
    if (!priceId || !priceId.startsWith('price_')) {
      throw new Error(
        `Stripe Price ID not configured for ${planId} ${billingCycle}. ` +
        `Please set STRIPE_${planId.toUpperCase()}_${billingCycle.toUpperCase()}_PRICE_ID in .env.local ` +
        `with either a Price ID (price_xxx) or Product ID (prod_xxx)`
      );
    }

    console.log(`Creating checkout session for plan "${planId}" (${billingCycle}) with price ID: ${priceId}`);

    // Check if user already has an active subscription
    const existingSubscription = await SubscriptionService.getUserSubscription(userId);

    let mode: 'subscription' | 'payment' = 'subscription';
    let sessionParams: any = {
      payment_method_types: ['card'],
      mode: mode,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${successUrl}&session_id={CHECKOUT_SESSION_ID}`, // Original success_url format
      cancel_url: cancelUrl,
      client_reference_id: userId,
      metadata: {
        userId: userId,
        planId: planId,
        billingCycle: billingCycle,
      },
      subscription_data: { // Re-incorporating subscription_data from original method
        metadata: {
          planId,
          billingCycle,
          userId,
        },
      },
    };

    // If user has an existing active subscription, cancel it before creating new one
    if (existingSubscription && existingSubscription.status === 'active') {
      console.log(`⚠️ User ${userId} has existing active subscription: ${existingSubscription.stripeSubscriptionId}`);
      console.log(`   Canceling old subscription before creating new checkout session...`);

      try {
        // Cancel the old subscription immediately
        await stripe.subscriptions.cancel(existingSubscription.stripeSubscriptionId);
        console.log(`✅ Canceled old subscription: ${existingSubscription.stripeSubscriptionId}`);

        // Update our database to reflect cancellation
        await SubscriptionService.updateSubscriptionStatus(
          existingSubscription.stripeSubscriptionId,
          'canceled'
        );
      } catch (error) {
        console.error(`❌ Failed to cancel existing subscription:`, error);
        // Continue anyway - user might still be able to subscribe
      }
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

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
