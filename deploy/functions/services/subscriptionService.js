"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionService = void 0;
const firestoreService_js_1 = require("./firestoreService.js");
class SubscriptionService {
    static async createOrUpdateSubscription(data) {
        try {
            const subscriptionData = {
                userId: data.userId,
                email: data.email,
                planId: data.planId,
                billingCycle: data.billingCycle,
                amount: data.amount,
                currency: data.currency,
                stripeSubscriptionId: data.stripeSubscriptionId,
                stripeCustomerId: data.stripeCustomerId,
                status: data.status,
                currentPeriodStart: data.currentPeriodStart,
                currentPeriodEnd: data.currentPeriodEnd,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            const existingSubscription = await this.getSubscriptionByStripeId(data.stripeSubscriptionId);
            if (existingSubscription) {
                subscriptionData.createdAt = existingSubscription.createdAt;
                await firestoreService_js_1.FirestoreService.updateDocument(this.COLLECTION_NAME, existingSubscription.id, subscriptionData);
                console.log(`Updated existing subscription for user ${data.userId} with document ID: ${existingSubscription.id}`);
            }
            else {
                await this.cancelAllActiveSubscriptions(data.userId);
                const docRef = await firestoreService_js_1.FirestoreService.createDocument(this.COLLECTION_NAME, null, subscriptionData);
                console.log(`Created new subscription for user ${data.userId} with ID: ${docRef.id}`);
            }
            return subscriptionData;
        }
        catch (error) {
            console.error('Error creating/updating subscription:', error);
            throw new Error('Failed to save subscription data');
        }
    }
    static async getUserSubscription(userId) {
        try {
            const subscriptions = await firestoreService_js_1.FirestoreService.queryCollection(this.COLLECTION_NAME, 'userId', '==', userId);
            const activeSubscription = subscriptions
                .filter(sub => sub.status === 'active')
                .sort((a, b) => b.createdAt - a.createdAt)[0];
            return activeSubscription;
        }
        catch (error) {
            console.error('Error getting user subscription:', error);
            return null;
        }
    }
    static async getAllUserSubscriptions(userId) {
        try {
            const subscriptions = await firestoreService_js_1.FirestoreService.queryCollection(this.COLLECTION_NAME, 'userId', '==', userId);
            return subscriptions.sort((a, b) => b.createdAt - a.createdAt);
        }
        catch (error) {
            console.error('Error getting all user subscriptions:', error);
            return [];
        }
    }
    static async updateSubscriptionStatus(stripeSubscriptionId, status) {
        try {
            const subscription = await this.getSubscriptionByStripeId(stripeSubscriptionId);
            if (!subscription) {
                throw new Error(`Subscription not found: ${stripeSubscriptionId}`);
            }
            await firestoreService_js_1.FirestoreService.updateDocument(this.COLLECTION_NAME, subscription.id, {
                status,
                updatedAt: Date.now(),
            });
            console.log(`Updated subscription status for ${stripeSubscriptionId} to ${status}`);
        }
        catch (error) {
            console.error('Error updating subscription status:', error);
            throw new Error('Failed to update subscription status');
        }
    }
    static async cancelSubscription(stripeSubscriptionId) {
        try {
            await this.updateSubscriptionStatus(stripeSubscriptionId, 'canceled');
        }
        catch (error) {
            console.error('Error canceling subscription:', error);
            throw new Error('Failed to cancel subscription');
        }
    }
    static async cancelAllActiveSubscriptions(userId) {
        try {
            const subscriptions = await firestoreService_js_1.FirestoreService.queryCollection(this.COLLECTION_NAME, 'userId', '==', userId);
            const activeSubscriptions = subscriptions.filter(sub => sub.status === 'active');
            for (const subscription of activeSubscriptions) {
                await firestoreService_js_1.FirestoreService.updateDocument(this.COLLECTION_NAME, subscription.id, {
                    status: 'canceled',
                    updatedAt: Date.now(),
                });
                console.log(`Canceled subscription ${subscription.id} for user ${userId}`);
            }
        }
        catch (error) {
            console.error('Error canceling all active subscriptions:', error);
            throw new Error('Failed to cancel active subscriptions');
        }
    }
    static async getSubscriptionByStripeId(stripeSubscriptionId) {
        try {
            console.log('🔍 Looking for subscription with Stripe ID:', stripeSubscriptionId);
            const subscriptions = await firestoreService_js_1.FirestoreService.queryCollection(this.COLLECTION_NAME, 'stripeSubscriptionId', '==', stripeSubscriptionId);
            console.log('📊 Found subscriptions:', subscriptions.length);
            console.log('📋 Subscription data:', subscriptions);
            return subscriptions.length > 0 ? subscriptions[0] : null;
        }
        catch (error) {
            console.error('❌ Error getting subscription by Stripe ID:', error);
            return null;
        }
    }
}
exports.SubscriptionService = SubscriptionService;
SubscriptionService.COLLECTION_NAME = 'userSubscriptions';
exports.default = SubscriptionService;
