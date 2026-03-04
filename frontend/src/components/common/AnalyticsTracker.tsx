import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { fireAdsPurchaseConversion } from '../../utils/analytics';

// 1. Centralized Pricing Map (Source of Truth for Conversions)
const PRICING_MAP: Record<string, Record<string, number>> = {
    pro: {
        monthly: 9.90,
        yearly: 99.00,
    },
    ultra: {
        monthly: 19.90,
        yearly: 199.00,
    },
    admin_test: {
        monthly: 0.01, // Mock value for tracking
    },
};

const AnalyticsTracker = () => {
    const location = useLocation();
    const trackingAttempted = useRef(false);

    useEffect(() => {
        // --- EXISTING FIREBASE TRACKING ---
        if (typeof window !== 'undefined' &&
            process.env.NODE_ENV === 'production' &&
            process.env.REACT_APP_FIREBASE_MEASUREMENT_ID) {
            try {
                import('firebase/analytics').then(({ getAnalytics, logEvent }) => {
                    const analytics = getAnalytics();
                    if (analytics) {
                        logEvent(analytics, 'page_view', {
                            page_path: location.pathname + location.search
                        });
                    }
                });
            } catch (error) {
                console.warn('Google Analytics logging failed:', error);
            }
        }

        // --- NEW GOOGLE ADS CONVERSION TRACKING ---
        if (trackingAttempted.current) return;

        const searchParams = new URLSearchParams(location.search);
        const isSuccess = searchParams.get('subscription') === 'success';

        if (!isSuccess) return;

        trackingAttempted.current = true;

        const plan = searchParams.get('plan');
        const cycle = searchParams.get('cycle');
        const sessionId = searchParams.get('session_id');

        if (!plan || !cycle || !sessionId) {
            console.error('[Ads Detection] ❌ Missing required URL parameters. Conversion dropped.', { plan, cycle, sessionId });
            return;
        }

        const planPricing = PRICING_MAP[plan.toLowerCase()];
        const transactionValue = planPricing ? planPricing[cycle.toLowerCase()] : null;

        if (!transactionValue) {
            console.error(`[Ads Detection] ❌ Unrecognized pricing tier detected: ${plan} / ${cycle}. Halting conversion fire.`);
            return;
        }

        console.log(`[Ads Detection] 🏁 Valid subscription success detected. Extracting evidence...`);
        console.log(`[Ads Detection] 📝 Plan: ${plan} | Cycle: ${cycle} | Session: ${sessionId} | Value: £${transactionValue}`);

        fireAdsPurchaseConversion(transactionValue, sessionId);

    }, [location]);

    return null;
};

export default AnalyticsTracker;
