import express from 'express';
import { STRIPE_CONFIG } from '../config/stripe.js';
import paymentService from '../services/paymentService.js';
import SubscriptionService from '../services/subscriptionService.js';

const router = express.Router();

// Get Stripe configuration
router.get('/config', (req, res) => {
  res.json({
    publishableKey: STRIPE_CONFIG.publishableKey,
    currency: STRIPE_CONFIG.currency,
  });
});

// Create Stripe Checkout Session
router.post('/create-checkout-session', async (req, res) => {
  try {
    console.log('Creating checkout session with data:', req.body);
    const { planId, billingCycle, successUrl, cancelUrl } = req.body;

    if (!planId || !billingCycle || !successUrl || !cancelUrl) {
      console.log('Missing required fields:', { planId, billingCycle, successUrl, cancelUrl });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log('Calling paymentService.createCheckoutSession...');
    const checkoutSession = await paymentService.createCheckoutSession({
      planId,
      billingCycle,
      successUrl,
      cancelUrl,
    });

    console.log('Checkout session created successfully:', checkoutSession.id);
    res.json({ url: checkoutSession.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    res.status(500).json({ 
      error: 'Failed to create checkout session',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Create Payment Intent (for embedded forms)
router.post('/create-payment-intent', async (req, res) => {
  try {
    const { planId, billingCycle, customerEmail, customerId } = req.body;

    if (!planId || !billingCycle || !customerEmail) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const paymentIntent = await paymentService.createPaymentIntent({
      planId,
      billingCycle,
      customerEmail,
      customerId,
    });

    res.json({ paymentIntent });
  } catch (error) {
    console.error('Error creating payment intent:', error);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

// Create Subscription (for embedded forms)
router.post('/create-subscription', async (req, res) => {
  try {
    const { planId, billingCycle, customerEmail, customerId } = req.body;

    if (!planId || !billingCycle || !customerEmail) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const subscription = await paymentService.createSubscription({
      planId,
      billingCycle,
      customerEmail,
      customerId,
    });

    res.json(subscription);
  } catch (error) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// Get user subscription details
router.get('/user-subscription/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const subscription = await SubscriptionService.getUserSubscription(userId);
    
    if (!subscription) {
      return res.json({ 
        hasSubscription: false,
        subscription: null 
      });
    }
    
    res.json({ 
      hasSubscription: true,
      subscription 
    });
  } catch (error) {
    console.error('Error getting user subscription:', error);
    res.status(500).json({ error: 'Failed to get user subscription' });
  }
});

// Get subscription details by Stripe ID
router.get('/subscription/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const subscription = await paymentService.getSubscription(id);
    res.json(subscription);
  } catch (error) {
    console.error('Error getting subscription:', error);
    res.status(500).json({ error: 'Failed to get subscription' });
  }
});

// Cancel subscription
router.delete('/cancel-subscription/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Canceling subscription:', id);
    
    // Check if this is a test subscription (starts with 'sub_test_')
    const isTestSubscription = id.startsWith('sub_test_');
    
    let subscription;
    if (isTestSubscription) {
      // For test subscriptions, just update Firestore status
      console.log('Test subscription detected, updating Firestore only');
      subscription = { id, status: 'canceled' };
    } else {
      // Cancel subscription in Stripe for real subscriptions
      subscription = await paymentService.cancelSubscription(id);
      console.log('Stripe subscription canceled:', subscription.id);
    }
    
    // Update subscription status in Firestore
    const existingSubscription = await SubscriptionService.getSubscriptionByStripeId(id);
    if (existingSubscription) {
      await SubscriptionService.cancelSubscription(id);
      console.log('Firestore subscription status updated to canceled for subscription:', id);
    } else {
      console.log('No existing subscription found in Firestore for ID:', id);
    }
    
    res.json({ 
      success: true, 
      message: 'Subscription canceled successfully',
      subscription: {
        id: subscription.id,
        status: subscription.status
      }
    });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});


// Stripe webhook endpoint
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    if (!sig) {
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }

    // Note: In production, you should verify the webhook signature
    // const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_CONFIG.webhookSecret);

    // For now, just parse the body
    const event = JSON.parse(req.body.toString());
    console.log('Received webhook event:', event.type);

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed':
        console.log('Checkout session completed:', event.data.object);
        await handleCheckoutSessionCompleted(event.data.object);
        break;
      case 'customer.subscription.created':
        console.log('Subscription created:', event.data.object);
        await handleSubscriptionCreated(event.data.object);
        break;
      case 'customer.subscription.updated':
        console.log('Subscription updated:', event.data.object);
        await handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        console.log('Subscription deleted:', event.data.object);
        await handleSubscriptionDeleted(event.data.object);
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).json({ error: 'Webhook error' });
  }
});

// Handle successful checkout session
async function handleCheckoutSessionCompleted(session: any) {
  try {
    console.log('Processing checkout session completion:', session.id);
    
    // Extract subscription data from session metadata
    const { planId, billingCycle } = session.metadata || {};
    const customerId = session.customer;
    const subscriptionId = session.subscription;
    
    if (!planId || !billingCycle || !customerId || !subscriptionId) {
      console.error('Missing required data in checkout session:', { planId, billingCycle, customerId, subscriptionId });
      return;
    }

    // Get subscription details from Stripe
    const stripe = (await import('../config/stripe.js')).default;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    
    // Get customer details
    const customer = await stripe.customers.retrieve(customerId);
    
    // Save subscription to Firestore
    await SubscriptionService.createOrUpdateSubscription({
      userId: (customer as any).metadata?.userId || customerId, // Use userId from metadata or fallback to customerId
      email: (customer as any).email || session.customer_email,
      planId,
      billingCycle,
      amount: subscription.items.data[0]?.price?.unit_amount || 0,
      currency: subscription.currency,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: customerId,
      status: subscription.status,
      currentPeriodStart: (subscription as any).current_period_start,
      currentPeriodEnd: (subscription as any).current_period_end,
    });
    
    console.log(`Successfully saved subscription for user ${(customer as any).metadata?.userId || customerId}`);
  } catch (error) {
    console.error('Error handling checkout session completion:', error);
  }
}

// Handle subscription created
async function handleSubscriptionCreated(subscription: any) {
  try {
    console.log('Processing subscription creation:', subscription.id);
    // Additional logic for subscription creation if needed
  } catch (error) {
    console.error('Error handling subscription creation:', error);
  }
}

// Handle subscription updated
async function handleSubscriptionUpdated(subscription: any) {
  try {
    console.log('Processing subscription update:', subscription.id);
    
    // Update subscription status in Firestore
    const existingSubscription = await SubscriptionService.getSubscriptionByStripeId(subscription.id);
    if (existingSubscription) {
      await SubscriptionService.updateSubscriptionStatus(
        subscription.id,
        subscription.status as any
      );
    }
  } catch (error) {
    console.error('Error handling subscription update:', error);
  }
}

// Handle subscription deleted
async function handleSubscriptionDeleted(subscription: any) {
  try {
    console.log('Processing subscription deletion:', subscription.id);
    
    // Update subscription status to canceled
    const existingSubscription = await SubscriptionService.getSubscriptionByStripeId(subscription.id);
    if (existingSubscription) {
      await SubscriptionService.cancelSubscription(subscription.id);
    }
  } catch (error) {
    console.error('Error handling subscription deletion:', error);
  }
}

export default router;
