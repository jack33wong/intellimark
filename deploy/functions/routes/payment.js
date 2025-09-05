"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const stripe_js_1 = require("../config/stripe.js");
const paymentService_js_1 = __importDefault(require("../services/paymentService.js"));
const subscriptionService_js_1 = __importDefault(require("../services/subscriptionService.js"));
const router = express_1.default.Router();
router.get('/config', (req, res) => {
    res.json({
        publishableKey: stripe_js_1.STRIPE_CONFIG.publishableKey,
        currency: stripe_js_1.STRIPE_CONFIG.currency,
    });
});
router.post('/create-checkout-session', async (req, res) => {
    try {
        console.log('Creating checkout session with data:', req.body);
        const { planId, billingCycle, successUrl, cancelUrl, userId } = req.body;
        if (!planId || !billingCycle || !successUrl || !cancelUrl || !userId) {
            console.log('Missing required fields:', { planId, billingCycle, successUrl, cancelUrl, userId });
            return res.status(400).json({ error: 'Missing required fields' });
        }
        console.log('Calling paymentService.createCheckoutSession...');
        const checkoutSession = await paymentService_js_1.default.createCheckoutSession({
            planId,
            billingCycle,
            successUrl,
            cancelUrl,
            userId,
        });
        console.log('Checkout session created successfully:', checkoutSession.id);
        res.json({ url: checkoutSession.url });
    }
    catch (error) {
        console.error('Error creating checkout session:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        res.status(500).json({
            error: 'Failed to create checkout session',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
router.post('/create-payment-intent', async (req, res) => {
    try {
        const { planId, billingCycle, customerEmail, customerId } = req.body;
        if (!planId || !billingCycle || !customerEmail) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        const paymentIntent = await paymentService_js_1.default.createPaymentIntent({
            planId,
            billingCycle,
            customerEmail,
            customerId,
        });
        res.json({ paymentIntent });
    }
    catch (error) {
        console.error('Error creating payment intent:', error);
        res.status(500).json({ error: 'Failed to create payment intent' });
    }
});
router.post('/create-subscription', async (req, res) => {
    try {
        const { planId, billingCycle, customerEmail, customerId } = req.body;
        if (!planId || !billingCycle || !customerEmail) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        const subscription = await paymentService_js_1.default.createSubscription({
            planId,
            billingCycle,
            customerEmail,
            customerId,
        });
        res.json(subscription);
    }
    catch (error) {
        console.error('Error creating subscription:', error);
        res.status(500).json({ error: 'Failed to create subscription' });
    }
});
router.get('/user-subscription/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const subscription = await subscriptionService_js_1.default.getUserSubscription(userId);
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
    }
    catch (error) {
        console.error('Error getting user subscription:', error);
        res.status(500).json({ error: 'Failed to get user subscription' });
    }
});
router.get('/subscription/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const subscription = await paymentService_js_1.default.getSubscription(id);
        res.json(subscription);
    }
    catch (error) {
        console.error('Error getting subscription:', error);
        res.status(500).json({ error: 'Failed to get subscription' });
    }
});
router.delete('/cancel-subscription/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log('Canceling subscription:', id);
        const isTestSubscription = id.startsWith('sub_test_') || id.startsWith('sub_debug_');
        console.log('🔍 Subscription ID:', id);
        console.log('🔍 Is test subscription:', isTestSubscription);
        let subscription;
        if (isTestSubscription) {
            console.log('✅ Test subscription detected, updating Firestore only');
            subscription = { id, status: 'canceled' };
        }
        else {
            console.log('💳 Real subscription detected, canceling in Stripe...');
            subscription = await paymentService_js_1.default.cancelSubscription(id);
            console.log('Stripe subscription canceled:', subscription.id);
        }
        console.log('🔍 Looking up subscription in Firestore for ID:', id);
        try {
            const existingSubscription = await subscriptionService_js_1.default.getSubscriptionByStripeId(id);
            console.log('📊 Existing subscription found:', existingSubscription);
            if (existingSubscription) {
                console.log('✅ Subscription found, canceling...');
                await subscriptionService_js_1.default.cancelSubscription(id);
                console.log('Firestore subscription status updated to canceled for subscription:', id);
            }
            else {
                console.log('❌ No existing subscription found in Firestore for ID:', id);
                const { FirestoreService } = await Promise.resolve().then(() => __importStar(require('../services/firestoreService.js')));
                const directQuery = await FirestoreService.queryCollection('userSubscriptions', 'stripeSubscriptionId', '==', id);
                console.log('🔍 Direct query result:', directQuery);
                if (directQuery.length > 0) {
                    console.log('✅ Found subscription via direct query, updating status...');
                    await FirestoreService.updateDocument('userSubscriptions', directQuery[0].id, {
                        status: 'canceled',
                        updatedAt: Date.now()
                    });
                    console.log('✅ Subscription status updated via direct query');
                }
            }
        }
        catch (error) {
            console.error('❌ Error in subscription lookup:', error);
            try {
                const { FirestoreService } = await Promise.resolve().then(() => __importStar(require('../services/firestoreService.js')));
                const directQuery = await FirestoreService.queryCollection('userSubscriptions', 'stripeSubscriptionId', '==', id);
                console.log('🔍 Fallback direct query result:', directQuery);
                if (directQuery.length > 0) {
                    console.log('✅ Found subscription via fallback query, updating status...');
                    await FirestoreService.updateDocument('userSubscriptions', directQuery[0].id, {
                        status: 'canceled',
                        updatedAt: Date.now()
                    });
                    console.log('✅ Subscription status updated via fallback query');
                }
            }
            catch (fallbackError) {
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
    }
    catch (error) {
        console.error('❌ Error canceling subscription:', error);
        console.error('❌ Error details:', error.message);
        console.error('❌ Error stack:', error.stack);
        res.status(500).json({
            error: 'Failed to cancel subscription',
            details: error.message
        });
    }
});
router.post('/create-subscription-after-payment', async (req, res) => {
    try {
        console.log('💳 Creating subscription after successful payment');
        console.log('Request body:', req.body);
        const { sessionId, userId } = req.body;
        if (!sessionId || !userId) {
            console.log('❌ Missing sessionId or userId');
            return res.status(400).json({ error: 'Missing sessionId or userId' });
        }
        console.log('🔍 Retrieving session from Stripe:', sessionId);
        const stripe = (await Promise.resolve().then(() => __importStar(require('../config/stripe.js')))).default;
        let session;
        try {
            session = await stripe.checkout.sessions.retrieve(sessionId, {
                expand: ['subscription', 'customer']
            });
            console.log('✅ Retrieved session:', session.id);
            console.log('📋 Session metadata:', session.metadata);
            console.log('💳 Session subscription:', session.subscription);
            console.log('👤 Session customer:', session.customer);
            console.log('💰 Session payment status:', session.payment_status);
            console.log('📊 Session status:', session.status);
            if (!session.subscription) {
                console.log('❌ No subscription found in session');
                console.log('🔍 Session details:', {
                    id: session.id,
                    status: session.status,
                    payment_status: session.payment_status,
                    mode: session.mode,
                    success_url: session.success_url,
                    cancel_url: session.cancel_url
                });
                return res.status(400).json({ error: 'No subscription found in session' });
            }
        }
        catch (stripeError) {
            console.error('❌ Stripe API error:', stripeError);
            return res.status(500).json({
                error: 'Failed to retrieve session from Stripe',
                details: stripeError.message
            });
        }
        const subscription = session.subscription;
        const customer = session.customer;
        console.log('🔍 Subscription details:', {
            id: subscription.id,
            status: subscription.status,
            hasPeriodStart: !!subscription.current_period_start,
            hasPeriodEnd: !!subscription.current_period_end
        });
        const { planId, billingCycle } = session.metadata || {};
        if (!planId || !billingCycle) {
            console.log('❌ Missing planId or billingCycle in session metadata');
            return res.status(400).json({ error: 'Missing planId or billingCycle in session metadata' });
        }
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
            currentPeriodEnd: subscription.current_period_end || Math.floor(now / 1000) + (30 * 24 * 60 * 60),
            createdAt: now,
            updatedAt: now,
        };
        console.log('📝 Creating subscription with data:', subscriptionData);
        const result = await subscriptionService_js_1.default.createOrUpdateSubscription(subscriptionData);
        console.log('✅ Subscription created successfully:', result);
        res.json({
            success: true,
            message: 'Subscription created successfully',
            subscription: result
        });
    }
    catch (error) {
        console.error('❌ Error creating subscription after payment:', error);
        res.status(500).json({
            error: 'Failed to create subscription',
            details: error.message
        });
    }
});
router.get('/debug/all-subscriptions', async (req, res) => {
    try {
        console.log('🔍 Debug: Listing all subscriptions');
        const { FirestoreService } = await Promise.resolve().then(() => __importStar(require('../services/firestoreService.js')));
        const allSubscriptions = await FirestoreService.queryCollection('userSubscriptions', 'userId', '!=', null);
        res.json({
            message: 'All subscriptions',
            count: allSubscriptions.length,
            subscriptions: allSubscriptions
        });
    }
    catch (error) {
        console.error('Error getting all subscriptions:', error);
        res.status(500).json({
            error: 'Failed to get subscriptions',
            details: error.message
        });
    }
});
router.get('/debug/test-subscription-lookup/:stripeId', async (req, res) => {
    try {
        const { stripeId } = req.params;
        console.log('🔍 Testing subscription lookup for:', stripeId);
        const { FirestoreService } = await Promise.resolve().then(() => __importStar(require('../services/firestoreService.js')));
        const subscriptions = await FirestoreService.queryCollection('userSubscriptions', 'stripeSubscriptionId', '==', stripeId);
        console.log('📊 Query result:', subscriptions);
        res.json({
            message: 'Subscription lookup test',
            stripeId,
            found: subscriptions.length > 0,
            subscriptions
        });
    }
    catch (error) {
        console.error('Error testing subscription lookup:', error);
        res.status(500).json({
            error: 'Failed to test subscription lookup',
            details: error.message
        });
    }
});
router.post('/debug/create-subscription-for-user', async (req, res) => {
    try {
        console.log('🔧 Debug: Creating subscription for specific user');
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
        console.log('Creating debug subscription:', testData);
        const result = await subscriptionService_js_1.default.createOrUpdateSubscription(testData);
        res.json({
            success: true,
            message: 'Debug subscription created successfully',
            subscription: result
        });
    }
    catch (error) {
        console.error('Error creating debug subscription:', error);
        res.status(500).json({
            error: 'Failed to create debug subscription',
            details: error.message
        });
    }
});
router.post('/debug/simulate-subscription-success', async (req, res) => {
    try {
        console.log('🎯 Debug: Simulating subscription success flow');
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ error: 'Missing userId' });
        }
        const stripe = (await Promise.resolve().then(() => __importStar(require('../config/stripe.js')))).default;
        const testCustomer = await stripe.customers.create({
            email: 'test@example.com',
            metadata: { userId }
        });
        const testProduct = await stripe.products.create({
            name: 'Pro Plan Test',
        });
        const testPrice = await stripe.prices.create({
            unit_amount: 2999,
            currency: 'usd',
            recurring: { interval: 'month' },
            product: testProduct.id,
        });
        const testSubscription = await stripe.subscriptions.create({
            customer: testCustomer.id,
            items: [{ price: testPrice.id }],
            metadata: {
                planId: 'pro',
                billingCycle: 'monthly',
                userId
            }
        });
        const testSession = await stripe.checkout.sessions.create({
            mode: 'subscription',
            line_items: [{ price: testPrice.id, quantity: 1 }],
            success_url: 'http://localhost:3000/?subscription=success&session_id={CHECKOUT_SESSION_ID}',
            cancel_url: 'http://localhost:3000/upgrade?canceled=true',
            subscription: testSubscription.id,
            customer: testCustomer.id,
            metadata: {
                planId: 'pro',
                billingCycle: 'monthly',
                userId
            }
        });
        console.log('Test session created:', testSession.id);
        const subscriptionData = {
            userId: userId,
            email: 'test@example.com',
            planId: 'pro',
            billingCycle: 'monthly',
            amount: 2999,
            currency: 'usd',
            stripeSubscriptionId: testSubscription.id,
            stripeCustomerId: testSubscription.customer,
            status: 'active',
            currentPeriodStart: testSubscription.current_period_start,
            currentPeriodEnd: testSubscription.current_period_end,
        };
        const result = await subscriptionService_js_1.default.createOrUpdateSubscription(subscriptionData);
        res.json({
            success: true,
            message: 'Subscription success flow simulated',
            sessionId: testSession.id,
            subscription: result,
            testUrl: `http://localhost:3000/?subscription=success&session_id=${testSession.id}`
        });
    }
    catch (error) {
        console.error('Error simulating subscription success:', error);
        res.status(500).json({
            error: 'Failed to simulate subscription success',
            details: error.message
        });
    }
});
router.post('/test-create-subscription', async (req, res) => {
    try {
        console.log('🧪 Test endpoint: Creating test subscription');
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
        console.log('Test subscription data:', testData);
        const result = await subscriptionService_js_1.default.createOrUpdateSubscription(testData);
        res.json({
            success: true,
            message: 'Test subscription created successfully',
            subscription: result
        });
    }
    catch (error) {
        console.error('Error creating test subscription:', error);
        res.status(500).json({
            error: 'Failed to create test subscription',
            details: error.message
        });
    }
});
router.post('/webhook', express_1.default.raw({ type: 'application/json' }), async (req, res) => {
    try {
        console.log('🔔 Webhook received!');
        console.log('Headers:', req.headers);
        console.log('Body length:', req.body.length);
        const sig = req.headers['stripe-signature'];
        if (!sig) {
            console.log('❌ Missing stripe-signature header');
            return res.status(400).json({ error: 'Missing stripe-signature header' });
        }
        const event = JSON.parse(req.body.toString());
        console.log('✅ Received webhook event:', event.type);
        console.log('Event data:', JSON.stringify(event.data, null, 2));
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
    }
    catch (error) {
        console.error('Webhook error:', error);
        res.status(400).json({ error: 'Webhook error' });
    }
});
async function handleCheckoutSessionCompleted(session) {
    try {
        console.log('🔄 Processing checkout session completion:', session.id);
        console.log('Session data:', JSON.stringify(session, null, 2));
        const { planId, billingCycle, userId } = session.metadata || {};
        const customerId = session.customer;
        const subscriptionId = session.subscription;
        console.log('Extracted data:', { planId, billingCycle, userId, customerId, subscriptionId });
        if (!planId || !billingCycle || !customerId || !subscriptionId) {
            console.error('❌ Missing required data in checkout session:', { planId, billingCycle, customerId, subscriptionId });
            return;
        }
        const stripe = (await Promise.resolve().then(() => __importStar(require('../config/stripe.js')))).default;
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const customer = await stripe.customers.retrieve(customerId);
        const finalUserId = customer.metadata?.userId || session.metadata?.userId || customerId;
        console.log('💾 Saving subscription to Firestore with userId:', finalUserId);
        const subscriptionData = {
            userId: finalUserId,
            email: customer.email || session.customer_email,
            planId,
            billingCycle,
            amount: subscription.items.data[0]?.price?.unit_amount || 0,
            currency: subscription.currency,
            stripeSubscriptionId: subscriptionId,
            stripeCustomerId: customerId,
            status: subscription.status,
            currentPeriodStart: subscription.current_period_start,
            currentPeriodEnd: subscription.current_period_end,
        };
        console.log('Subscription data to save:', JSON.stringify(subscriptionData, null, 2));
        await subscriptionService_js_1.default.createOrUpdateSubscription(subscriptionData);
        console.log(`✅ Successfully saved subscription for user ${finalUserId}`);
    }
    catch (error) {
        console.error('Error handling checkout session completion:', error);
    }
}
async function handleSubscriptionCreated(subscription) {
    try {
        console.log('Processing subscription creation:', subscription.id);
    }
    catch (error) {
        console.error('Error handling subscription creation:', error);
    }
}
async function handleSubscriptionUpdated(subscription) {
    try {
        console.log('Processing subscription update:', subscription.id);
        const existingSubscription = await subscriptionService_js_1.default.getSubscriptionByStripeId(subscription.id);
        if (existingSubscription) {
            await subscriptionService_js_1.default.updateSubscriptionStatus(subscription.id, subscription.status);
        }
    }
    catch (error) {
        console.error('Error handling subscription update:', error);
    }
}
async function handleSubscriptionDeleted(subscription) {
    try {
        console.log('Processing subscription deletion:', subscription.id);
        const existingSubscription = await subscriptionService_js_1.default.getSubscriptionByStripeId(subscription.id);
        if (existingSubscription) {
            await subscriptionService_js_1.default.cancelSubscription(subscription.id);
        }
    }
    catch (error) {
        console.error('Error handling subscription deletion:', error);
    }
}
exports.default = router;
