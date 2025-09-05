"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentService = void 0;
const stripe_js_1 = __importDefault(require("../config/stripe.js"));
const stripe_js_2 = require("../config/stripe.js");
class PaymentService {
    async createCheckoutSession(data) {
        const { planId, billingCycle, successUrl, cancelUrl, userId } = data;
        const planConfig = stripe_js_2.STRIPE_CONFIG.plans[planId];
        if (!planConfig) {
            throw new Error(`Plan ${planId} not found`);
        }
        const priceConfig = planConfig[billingCycle];
        if (!priceConfig) {
            throw new Error(`Billing cycle ${billingCycle} not found for plan ${planId}`);
        }
        if (!priceConfig.priceId || !priceConfig.priceId.startsWith('price_')) {
            console.log(`Creating dynamic price for ${planId} ${billingCycle} - $${priceConfig.amount / 100}`);
            const price = await stripe_js_1.default.prices.create({
                unit_amount: priceConfig.amount,
                currency: stripe_js_2.STRIPE_CONFIG.currency,
                recurring: {
                    interval: billingCycle === 'monthly' ? 'month' : 'year',
                },
                product_data: {
                    name: `${planId.charAt(0).toUpperCase() + planId.slice(1)} Plan (${billingCycle})`,
                },
            });
            priceConfig.priceId = price.id;
        }
        const session = await stripe_js_1.default.checkout.sessions.create({
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
    async createPaymentIntent(data) {
        const { planId, billingCycle, customerEmail, customerId } = data;
        const planConfig = stripe_js_2.STRIPE_CONFIG.plans[planId];
        if (!planConfig) {
            throw new Error(`Plan ${planId} not found`);
        }
        const priceConfig = planConfig[billingCycle];
        if (!priceConfig) {
            throw new Error(`Billing cycle ${billingCycle} not found for plan ${planId}`);
        }
        let customer;
        if (customerId) {
            try {
                customer = await stripe_js_1.default.customers.retrieve(customerId);
            }
            catch (error) {
                customer = await stripe_js_1.default.customers.create({
                    email: customerEmail,
                    metadata: { userId: customerId },
                });
            }
        }
        else {
            customer = await stripe_js_1.default.customers.create({
                email: customerEmail,
            });
        }
        const paymentIntent = await stripe_js_1.default.paymentIntents.create({
            amount: priceConfig.amount,
            currency: stripe_js_2.STRIPE_CONFIG.currency,
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
    async createSubscription(data) {
        const { planId, billingCycle, customerEmail, customerId } = data;
        const planConfig = stripe_js_2.STRIPE_CONFIG.plans[planId];
        if (!planConfig) {
            throw new Error(`Plan ${planId} not found`);
        }
        const priceConfig = planConfig[billingCycle];
        if (!priceConfig) {
            throw new Error(`Billing cycle ${billingCycle} not found for plan ${planId}`);
        }
        let customer;
        if (customerId) {
            try {
                customer = await stripe_js_1.default.customers.retrieve(customerId);
            }
            catch (error) {
                customer = await stripe_js_1.default.customers.create({
                    email: customerEmail,
                    metadata: { userId: customerId },
                });
            }
        }
        else {
            customer = await stripe_js_1.default.customers.create({
                email: customerEmail,
            });
        }
        const subscription = await stripe_js_1.default.subscriptions.create({
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
            currency: stripe_js_2.STRIPE_CONFIG.currency,
            currentPeriodStart: subscription.current_period_start,
            currentPeriodEnd: subscription.current_period_end,
        };
    }
    async getSubscription(subscriptionId) {
        const subscription = await stripe_js_1.default.subscriptions.retrieve(subscriptionId);
        return subscription;
    }
    async cancelSubscription(subscriptionId) {
        const subscription = await stripe_js_1.default.subscriptions.cancel(subscriptionId);
        return subscription;
    }
}
exports.PaymentService = PaymentService;
exports.default = new PaymentService();
