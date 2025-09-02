import express from 'express';
import { STRIPE_CONFIG } from '../config/stripe.js';
import paymentService from '../services/paymentService.js';

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

// Get subscription details
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
router.delete('/subscription/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const subscription = await paymentService.cancelSubscription(id);
    res.json(subscription);
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
        break;
      case 'customer.subscription.created':
        console.log('Subscription created:', event.data.object);
        break;
      case 'customer.subscription.updated':
        console.log('Subscription updated:', event.data.object);
        break;
      case 'customer.subscription.deleted':
        console.log('Subscription deleted:', event.data.object);
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

export default router;
