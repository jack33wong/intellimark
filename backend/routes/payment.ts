import express from 'express';
import { STRIPE_CONFIG } from '../config/stripe.js';
import paymentService from '../services/paymentService.js';
import SubscriptionService from '../services/subscriptionService.js';
import { initializeUserCredits, updateCreditsOnPlanChange } from '../services/creditService.js';
import { createDowngradeSchedule, cancelSchedule, getActiveSchedule } from '../services/scheduleService.js';
import admin from '../config/firebase.js';

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
    const { planId, billingCycle, successUrl, cancelUrl, userId } = req.body;

    if (!planId || !billingCycle || !successUrl || !cancelUrl || !userId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const checkoutSession = await paymentService.createCheckoutSession({
      planId,
      billingCycle,
      successUrl,
      cancelUrl,
      userId,
    });

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

// Get all subscriptions (admin - with pagination)
router.get('/list-subscriptions', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    // Get all subscriptions from Firestore
    const db = admin.firestore();
    const subscriptionsRef = db.collection('userSubscriptions');

    // Get total count
    const snapshot = await subscriptionsRef.get();
    const total = snapshot.size;

    // Get paginated results sorted by most recent
    const paginatedSnapshot = await subscriptionsRef
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .offset(skip)
      .get();

    const subscriptions = paginatedSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({
      subscriptions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error listing subscriptions:', error);
    res.status(500).json({
      error: 'Failed to list subscriptions',
      details: error.message
    });
  }
});

// Cancel subscription
router.post('/cancel-subscription', async (req, res) => {
  try {
    const { id } = req.body; // Changed from req.params to req.body

    // Check if this is a test subscription (starts with 'sub_test_' or 'sub_debug_')
    const isTestSubscription = id.startsWith('sub_test_') || id.startsWith('sub_debug_');

    let subscription;
    if (isTestSubscription) {
      // For test subscriptions, just update Firestore status
      subscription = { id, status: 'canceled' };
    } else {
      // Cancel subscription in Stripe for real subscriptions
      subscription = await paymentService.cancelSubscription(id);
    }

    // Update subscription status in Firestore

    try {
      const existingSubscription = await SubscriptionService.getSubscriptionByStripeId(id);

      if (existingSubscription) {
        await SubscriptionService.cancelSubscription(id);
      } else {
        // Try to find it using direct Firestore query as fallback
        const { FirestoreService } = await import('../services/firestoreService.js');
        const directQuery = await FirestoreService.queryCollection('userSubscriptions', 'stripeSubscriptionId', '==', id);

        if (directQuery.length > 0) {
          await FirestoreService.updateDocument('userSubscriptions', directQuery[0].id, {
            status: 'canceled',
            updatedAt: Date.now()
          });
        }
      }
    } catch (error) {
      console.error('❌ Error in subscription lookup:', error);
      // Try direct Firestore query as fallback
      try {
        const { FirestoreService } = await import('../services/firestoreService.js');
        const directQuery = await FirestoreService.queryCollection('userSubscriptions', 'stripeSubscriptionId', '==', id);

        if (directQuery.length > 0) {
          await FirestoreService.updateDocument('userSubscriptions', directQuery[0].id, {
            status: 'canceled',
            updatedAt: Date.now()
          });
        }
      } catch (fallbackError) {
        console.error('❌ Fallback query also failed:', fallbackError);
      }
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
    console.error('❌ Error canceling subscription:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      error: 'Failed to cancel subscription',
      details: error.message
    });
  }
});

// Change subscription plan (upgrade or downgrade)
router.post('/change-plan', async (req, res) => {
  try {
    const { userId, newPlanId, billingCycle } = req.body;

    if (!userId || !newPlanId || !billingCycle) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get current subscription
    const subscription = await SubscriptionService.getUserSubscription(userId);
    if (!subscription) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    const currentPlanId = subscription.planId;

    // Helper to get plan level (free=0, pro=1, enterprise=2)
    const getPlanLevel = (plan: string): number => {
      const levels = { free: 0, pro: 1, enterprise: 2 };
      return levels[plan] || 0;
    };

    const isUpgrade = getPlanLevel(newPlanId) > getPlanLevel(currentPlanId);
    const isDowngrade = getPlanLevel(newPlanId) < getPlanLevel(currentPlanId);

    if (isUpgrade) {
      // Immediate upgrade with proration
      const stripe = (await import('../config/stripe.js')).default;
      const newPlanConfig = STRIPE_CONFIG.plans[newPlanId];
      const newPriceId = newPlanConfig[billingCycle].priceId;

      const stripeSubscription = await stripe.subscriptions.retrieve(
        subscription.stripeSubscriptionId
      );

      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        items: [{
          id: stripeSubscription.items.data[0].id,
          price: newPriceId,
        }],
        proration_behavior: 'create_prorations', // Charge difference
      });

      // Update Firestore
      await SubscriptionService.updateSubscription(subscription.stripeSubscriptionId, {
        planId: newPlanId,
        amount: newPlanConfig[billingCycle].amount,
        previousPlanId: currentPlanId,
        planChangedAt: Date.now(),
      });

      // Update credits immediately
      await updateCreditsOnPlanChange(
        userId,
        currentPlanId,
        newPlanId as 'free' | 'pro' | 'enterprise',
        stripeSubscription.current_period_end * 1000
      );

      console.log(`⬆️ Immediate upgrade: ${currentPlanId} → ${newPlanId}`);

      res.json({
        success: true,
        changeType: 'immediate_upgrade',
        newPlan: newPlanId,
      });
    } else if (isDowngrade) {
      // Schedule downgrade for next period
      const schedule = await createDowngradeSchedule(
        subscription.stripeSubscriptionId,
        currentPlanId as 'pro' | 'enterprise',
        newPlanId as 'free' | 'pro' | 'enterprise',
        billingCycle as 'monthly' | 'yearly',
        subscription.currentPeriodEnd
      );

      // Update Firestore with schedule info
      await SubscriptionService.updateSubscription(subscription.stripeSubscriptionId, {
        scheduledPlanId: newPlanId,
        scheduleId: schedule.id,
        scheduleEffectiveDate: subscription.currentPeriodEnd * 1000,
        planChangedAt: Date.now(),
      });

      console.log(`⬇️ Scheduled downgrade: ${currentPlanId} → ${newPlanId} on ${new Date(subscription.currentPeriodEnd * 1000).toISOString()}`);

      res.json({
        success: true,
        changeType: 'scheduled_downgrade',
        currentPlan: currentPlanId,
        scheduledPlan: newPlanId,
        effectiveDate: subscription.currentPeriodEnd * 1000,
        scheduleId: schedule.id,
      });
    } else {
      // Same plan - no change
      res.status(400).json({ error: 'New plan is same as current plan' });
    }
  } catch (error) {
    console.error('❌ Error changing plan:', error);
    res.status(500).json({
      error: 'Failed to change plan',
      details: error.message,
    });
  }
});

// Cancel scheduled plan change
router.post('/cancel-schedule', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }

    const subscription = await SubscriptionService.getUserSubscription(userId);
    if (!subscription || !subscription.scheduleId) {
      return res.status(404).json({ error: 'No scheduled plan change found' });
    }

    await cancelSchedule(subscription.scheduleId);

    // Clear schedule from Firestore
    await SubscriptionService.updateSubscription(subscription.stripeSubscriptionId, {
      scheduledPlanId: null,
      scheduleId: null,
      scheduleEffectiveDate: null,
    });

    res.json({ success: true, message: 'Scheduled plan change canceled' });
  } catch (error) {
    console.error('❌ Error canceling schedule:', error);
    res.status(500).json({ error: 'Failed to cancel schedule' });
  }
});

// Handle subscription creation after successful payment (bypass webhook for localhost)
router.post('/create-subscription-after-payment', async (req, res) => {
  try {
    const { sessionId, userId } = req.body;

    if (!sessionId || !userId) {
      return res.status(400).json({ error: 'Missing sessionId or userId' });
    }


    // Retrieve the checkout session from Stripe
    const stripe = (await import('../config/stripe.js')).default;

    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['subscription', 'customer']
      });


      if (!session.subscription) {
        return res.status(400).json({
          error: 'No subscription found in session',
          sessionDetails: {
            id: session.id,
            status: session.status,
            payment_status: session.payment_status,
            mode: session.mode,
            success_url: session.success_url,
            cancel_url: session.cancel_url
          }
        });
      }
    } catch (stripeError) {
      console.error('❌ Stripe API error:', stripeError);
      return res.status(500).json({
        error: 'Failed to retrieve session from Stripe',
        details: stripeError.message
      });
    }

    // Get subscription details
    const subscription = session.subscription;
    const customer = session.customer;

    // Extract data from session metadata
    const { planId, billingCycle } = session.metadata || {};

    if (!planId || !billingCycle) {
      return res.status(400).json({ error: 'Missing planId or billingCycle in session metadata' });
    }

    // Create subscription record
    const now = Date.now();
    const subscriptionData = {
      userId: userId,
      email: customer.email || session.customer_email,
      planId,
      billingCycle,
      amount: subscription.items.data[0]?.price?.unit_amount || 0,
      currency: subscription.currency,
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: customer.id,
      status: subscription.status,
      currentPeriodStart: subscription.current_period_start || Math.floor(now / 1000),
      currentPeriodEnd: subscription.current_period_end || Math.floor(now / 1000) + (30 * 24 * 60 * 60), // 30 days from now
      createdAt: now,
      updatedAt: now,
    };


    const result = await SubscriptionService.createOrUpdateSubscription(subscriptionData);

    // Initialize user credits
    try {
      await initializeUserCredits(
        userId,
        planId as 'free' | 'pro' | 'enterprise',
        subscription.current_period_end * 1000
      );
      console.log('✅ User credits initialized for', planId);
    } catch (creditError) {
      console.error('⚠️ Failed to initialize credits:', creditError);
      // Don't fail the request if credits initialization fails
    }

    res.json({
      success: true,
      message: 'Subscription created successfully',
      subscription: result
    });

  } catch (error) {
    console.error('❌ Error creating subscription after payment:', error);
    res.status(500).json({
      error: 'Failed to create subscription',
      details: error.message
    });
  }
});

// Debug endpoint to list all subscriptions
router.get('/debug/all-subscriptions', async (req, res) => {
  try {

    // Get all subscriptions from Firestore directly
    const { FirestoreService } = await import('../services/firestoreService.js');
    const allSubscriptions = await FirestoreService.queryCollection('userSubscriptions', 'userId', '!=', null);

    res.json({
      message: 'All subscriptions',
      count: allSubscriptions.length,
      subscriptions: allSubscriptions
    });
  } catch (error) {
    console.error('Error getting all subscriptions:', error);
    res.status(500).json({
      error: 'Failed to get subscriptions',
      details: error.message
    });
  }
});

// Debug endpoint to test subscription lookup
router.get('/debug/test-subscription-lookup/:stripeId', async (req, res) => {
  try {
    const { stripeId } = req.params;

    const { FirestoreService } = await import('../services/firestoreService.js');
    const subscriptions = await FirestoreService.queryCollection('userSubscriptions', 'stripeSubscriptionId', '==', stripeId);


    res.json({
      message: 'Subscription lookup test',
      stripeId,
      found: subscriptions.length > 0,
      subscriptions
    });
  } catch (error) {
    console.error('Error testing subscription lookup:', error);
    res.status(500).json({
      error: 'Failed to test subscription lookup',
      details: error.message
    });
  }
});

// Debug endpoint to create subscription for any user ID
router.post('/debug/create-subscription-for-user', async (req, res) => {
  try {
    const { userId, planId = 'pro', billingCycle = 'monthly', email } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }

    const testData = {
      userId: userId,
      email: email || 'debug@example.com',
      planId: planId,
      billingCycle: billingCycle,
      amount: 2999,
      currency: 'usd',
      stripeSubscriptionId: 'sub_debug_' + Date.now(),
      stripeCustomerId: 'cus_debug_' + Date.now(),
      status: 'active',
      currentPeriodStart: Math.floor(Date.now() / 1000),
      currentPeriodEnd: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
    };


    const result = await SubscriptionService.createOrUpdateSubscription(testData);

    res.json({
      success: true,
      message: 'Debug subscription created successfully',
      subscription: result
    });
  } catch (error) {
    console.error('Error creating debug subscription:', error);
    res.status(500).json({
      error: 'Failed to create debug subscription',
      details: error.message
    });
  }
});

// Debug endpoint to simulate subscription success flow
router.post('/debug/simulate-subscription-success', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }

    // Create a test checkout session
    const stripe = (await import('../config/stripe.js')).default;

    // Create a test customer first
    const testCustomer = await stripe.customers.create({
      email: 'test@example.com',
      metadata: { userId }
    });

    // Create a test product and price
    const testProduct = await stripe.products.create({
      name: 'Pro Plan Test',
    });

    const testPrice = await stripe.prices.create({
      unit_amount: 2999,
      currency: 'usd',
      recurring: { interval: 'month' },
      product: testProduct.id,
    });

    // Create a test subscription
    const testSubscription = await stripe.subscriptions.create({
      customer: testCustomer.id,
      items: [{ price: testPrice.id }],
      metadata: {
        planId: 'pro',
        billingCycle: 'monthly',
        userId
      }
    });

    // Create a test checkout session
    const testSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: testPrice.id, quantity: 1 }],
      success_url: 'http://localhost:3000/?subscription=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'http://localhost:3000/upgrade?canceled=true',
      customer: testCustomer.id,
      metadata: {
        planId: 'pro',
        billingCycle: 'monthly',
        userId
      }
    });


    // Now simulate the subscription creation process
    const subscriptionData = {
      userId: userId,
      email: 'test@example.com',
      planId: 'pro',
      billingCycle: 'monthly',
      amount: 2999,
      currency: 'usd',
      stripeSubscriptionId: testSubscription.id,
      stripeCustomerId: typeof testSubscription.customer === 'string' ? testSubscription.customer : testSubscription.customer.id,
      status: 'active',
      currentPeriodStart: (testSubscription as any).current_period_start,
      currentPeriodEnd: (testSubscription as any).current_period_end,
    };

    const result = await SubscriptionService.createOrUpdateSubscription(subscriptionData);

    res.json({
      success: true,
      message: 'Subscription success flow simulated',
      sessionId: testSession.id,
      subscription: result,
      testUrl: `http://localhost:3000/?subscription=success&session_id=${testSession.id}`
    });

  } catch (error) {
    console.error('Error simulating subscription success:', error);
    res.status(500).json({
      error: 'Failed to simulate subscription success',
      details: error.message
    });
  }
});

// Test endpoint to manually trigger subscription creation (for debugging)
router.post('/test-create-subscription', async (req, res) => {
  try {

    const testData = {
      userId: req.body.userId || 'test_user_' + Date.now(),
      email: req.body.email || 'test@example.com',
      planId: req.body.planId || 'pro',
      billingCycle: req.body.billingCycle || 'monthly',
      amount: req.body.amount || 2999,
      currency: req.body.currency || 'usd',
      stripeSubscriptionId: 'sub_test_' + Date.now(),
      stripeCustomerId: 'cus_test_' + Date.now(),
      status: 'active',
      currentPeriodStart: Math.floor(Date.now() / 1000),
      currentPeriodEnd: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
    };


    const result = await SubscriptionService.createOrUpdateSubscription(testData);

    res.json({
      success: true,
      message: 'Test subscription created successfully',
      subscription: result
    });
  } catch (error) {
    console.error('Error creating test subscription:', error);
    res.status(500).json({
      error: 'Failed to create test subscription',
      details: error.message
    });
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

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object);
        break;
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      case 'subscription_schedule.created':
        await handleScheduleCreated(event.data.object);
        break;
      case 'subscription_schedule.canceled':
        await handleScheduleCanceled(event.data.object);
        break;
      default:
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

    // Extract subscription data from session metadata
    const { planId, billingCycle, userId } = session.metadata || {};
    const customerId = session.customer;
    const subscriptionId = session.subscription;


    if (!planId || !billingCycle || !customerId || !subscriptionId) {
      console.error('❌ Missing required data in checkout session:', { planId, billingCycle, customerId, subscriptionId });
      return;
    }

    // Get subscription details from Stripe
    const stripe = (await import('../config/stripe.js')).default;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    // Get customer details
    const customer = await stripe.customers.retrieve(customerId);

    // Save subscription to Firestore
    const finalUserId = (customer as any).metadata?.userId || session.metadata?.userId || customerId;

    const subscriptionData = {
      userId: finalUserId,
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
    };


    await SubscriptionService.createOrUpdateSubscription(subscriptionData);

  } catch (error) {
    console.error('Error handling checkout session completion:', error);
  }
}

// Handle subscription created
async function handleSubscriptionCreated(subscription: any) {
  try {
    // Additional logic for subscription creation if needed
  } catch (error) {
    console.error('Error handling subscription creation:', error);
  }
}

// Handle subscription updated
async function handleSubscriptionUpdated(subscription: any) {
  try {
    // Check if this update is from a schedule activation
    const isScheduledChange = subscription.schedule !== null;

    const existingSubscription = await SubscriptionService.getSubscriptionByStripeId(subscription.id);
    if (!existingSubscription) {
      console.log('⚠️ Subscription not found in Firestore:', subscription.id);
      return;
    }

    if (isScheduledChange) {
      // This is a scheduled plan change activating
      console.log('📅 Scheduled plan change activated:', subscription.id);

      // Extract new plan from price ID
      const newPriceId = subscription.items.data[0]?.price?.id;
      const { extractPlanIdFromPrice } = await import('../services/scheduleService.js');
      const newPlanId = extractPlanIdFromPrice(newPriceId);

      if (newPlanId && existingSubscription.scheduledPlanId) {
        // Update subscription with new plan
        await SubscriptionService.updateSubscription(subscription.id, {
          previousPlanId: existingSubscription.planId,
          planId: newPlanId,
          amount: subscription.items.data[0]?.price?.unit_amount || 0,
          scheduledPlanId: null,  // Clear schedule
          scheduleId: null,
          scheduleEffectiveDate: null,
        });

        // Update credits for new plan
        await updateCreditsOnPlanChange(
          existingSubscription.userId,
          existingSubscription.planId,
          newPlanId as 'free' | 'pro' | 'enterprise',
          subscription.current_period_end * 1000
        );

        console.log(`✅ Plan changed: ${existingSubscription.planId} → ${newPlanId} (scheduled)`);
      }
    } else {
      // Regular subscription update (status change, etc.)
      await SubscriptionService.updateSubscriptionStatus(
        subscription.id,
        subscription.status as any
      );
    }
  } catch (error) {
    console.error('Error handling subscription update:', error);
  }
}

// Handle schedule created
async function handleScheduleCreated(schedule: any) {
  try {
    console.log('📅 Subscription schedule created:', schedule.id);
    // Schedule info is already stored in Firestore by the change-plan endpoint
    // This webhook just confirms it was created successfully
  } catch (error) {
    console.error('Error handling schedule creation:', error);
  }
}

// Handle schedule canceled
async function handleScheduleCanceled(schedule: any) {
  try {
    console.log('❌ Subscription schedule canceled:', schedule.id);

    // Find subscription with this schedule ID and clear schedule fields
    const subscriptionId = schedule.subscription;
    if (subscriptionId) {
      const existingSubscription = await SubscriptionService.getSubscriptionByStripeId(subscriptionId);
      if (existingSubscription && existingSubscription.scheduleId === schedule.id) {
        await SubscriptionService.updateSubscription(subscriptionId, {
          scheduledPlanId: null,
          scheduleId: null,
          scheduleEffectiveDate: null,
        });
        console.log('✅ Cleared schedule from subscription');
      }
    }
  } catch (error) {
    console.error('Error handling schedule cancellation:', error);
  }
}

// Handle subscription deleted
async function handleSubscriptionDeleted(subscription: any) {
  try {

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
