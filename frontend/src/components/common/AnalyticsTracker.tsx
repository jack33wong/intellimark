import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fireAdsPurchaseConversion } from '../../utils/analytics';
import { trackFunnelEvent, getNavigationType } from '../../utils/funnelTracker';

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
    const userIdRef = useRef<string | null>(null);
    const lastTrackedPathRef = useRef<string | null>(null);
    const errorCountRef = useRef(0);

    useEffect(() => {
        userIdRef.current = user?.uid || null;
    }, [user?.uid]);

    // Track route changes & initial page load navigation type
    useEffect(() => {
        const currentPath = location.pathname + location.search;
        if (lastTrackedPathRef.current !== currentPath) {
            const isFirst = lastTrackedPathRef.current === null;
            lastTrackedPathRef.current = currentPath;
            trackFunnelEvent(
                'route_changed',
                isFirst ? { navType: getNavigationType() } : {},
                user?.uid || null
            );
        }
    }, [location.pathname, location.search, user?.uid]);

    // Track uncaught client JS errors, unhandled promise rejections, and tab hide/exit
    useEffect(() => {
        const handleError = (event: ErrorEvent) => {
            if (errorCountRef.current >= 5) return;
            errorCountRef.current += 1;
            trackFunnelEvent('client_error', {
                type: 'js_error',
                message: (event.message || 'Unknown error').slice(0, 200),
                source: event.filename ? `${event.filename.split('/').pop()}:${event.lineno}` : undefined,
            }, userIdRef.current);
        };

        const handleRejection = (event: PromiseRejectionEvent) => {
            if (errorCountRef.current >= 5) return;
            errorCountRef.current += 1;
            const reason = event.reason instanceof Error ? event.reason.message : String(event.reason || 'Unknown rejection');
            trackFunnelEvent('client_error', {
                type: 'unhandled_rejection',
                message: reason.slice(0, 200),
            }, userIdRef.current);
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                trackFunnelEvent('page_hidden', {}, userIdRef.current);
            }
        };

        window.addEventListener('error', handleError);
        window.addEventListener('unhandledrejection', handleRejection);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.removeEventListener('error', handleError);
            window.removeEventListener('unhandledrejection', handleRejection);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

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
