
import { getAnalytics, logEvent, Analytics } from 'firebase/analytics';
import app from '../config/firebase';

/**
 * Service to handle Google Analytics tracking
 * Wraps Firebase Analytics to provide consistent event logging
 */
class AnalyticsService {
    private analytics: Analytics | null = null;
    private initialized = false;

    constructor() {
        if (typeof window !== 'undefined' && app) {
            // We lazily load analytics to ensure we are in a browser environment
            // and firebase app is initialized
            this.init();
        }
    }

    private async init() {
        if (this.initialized) return;

        try {
            // Check if we are in production and have measurement ID
            // Note: AnalyticsTracker.tsx handles the main page_view events
            const isProduction = process.env.NODE_ENV === 'production';
            const hasMeasurementId = process.env.REACT_APP_FIREBASE_MEASUREMENT_ID;

            if (isProduction && hasMeasurementId) {
                const firebaseAnalytics = await import('firebase/analytics');
                this.analytics = firebaseAnalytics.getAnalytics(app);
                this.initialized = true;
                console.log('📊 AnalyticsService initialized');
            } else if (!isProduction) {
                console.log('🚧 AnalyticsService in Development Mode (Events will be logged to console)');
            }
        } catch (error) {
            console.warn('Failed to initialize AnalyticsService:', error);
        }
    }

    /**
     * Log a conversion event (valuable action for Google Ads)
     * @param eventName The standard Google Analytics event name (e.g., 'sign_up', 'purchase')
     * @param params Additional parameters for the event
     */
    public async logConversion(eventName: string, params: Record<string, any> = {}) {
        if (!this.initialized && process.env.NODE_ENV === 'production') {
            await this.init();
        }

        if (this.analytics) {
            try {
                logEvent(this.analytics, eventName, params);
                console.log(`📡 [GA4] Event logged: ${eventName}`, params);
            } catch (error) {
                console.error(`❌ [GA4] Failed to log event ${eventName}:`, error);
            }
        } else if (process.env.NODE_ENV !== 'production') {
            // Dev mode fallback
            console.log(`🧪 [GA4 DEV] Event: ${eventName}`, params);
        }
    }

    /**
     * Log a sign up event
     * @param method method of sign up (google, email, etc.)
     */
    public logSignUp(method: string) {
        this.logConversion('sign_up', { method });
    }

    /**
     * Log a purchase event (subscription)
     */
    public logPurchase(transactionId: string, value: number, currency: string = 'GBP') {
        this.logConversion('purchase', {
            transaction_id: transactionId,
            value,
            currency,
            items: [{
                item_name: 'Premium Subscription',
                item_category: 'subscription',
                price: value
            }]
        });
    }
}

export const analyticsService = new AnalyticsService();
