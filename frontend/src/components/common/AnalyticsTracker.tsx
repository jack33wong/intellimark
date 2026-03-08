import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
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
        monthly: 0.50, // Updated from 0.01
    },
};

const AnalyticsTracker = () => {
    const location = useLocation();
    const { user, loading } = useAuth();
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
        const searchParams = new URLSearchParams(location.search);
        const isSuccess = searchParams.get('subscription') === 'success';

        if (!isSuccess) return;

        // THE FIX: Wait for Firebase to finish initializing before proceeding
        // This prevents a race condition where the URL is detected before the user object is ready.
        if (loading) {
            console.log('[Ads Detection] ⏳ Waiting for Firebase Auth to resolve user...');
            return; // Exit and wait for the next render (user/loading change)
        }

        if (trackingAttempted.current) return;
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

        // Extract user email for Enhanced Conversions
        const userEmail = user?.email;
        fireAdsPurchaseConversion(transactionValue, sessionId, userEmail);

    }, [location, user, loading]);

    return null;
};

export default AnalyticsTracker;
