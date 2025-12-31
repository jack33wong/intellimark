import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getAnalytics, logEvent } from 'firebase/analytics';

const AnalyticsTracker = () => {
    const location = useLocation();

    useEffect(() => {
        // Check if analytics is supported and initialized
        // Explicit check: only log in production and if measurement ID exists
        if (typeof window !== 'undefined' &&
            process.env.NODE_ENV === 'production' &&
            process.env.REACT_APP_FIREBASE_MEASUREMENT_ID) {
            try {
                // We import dynamically to avoid issues during SSR or tests
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
    }, [location]);

    return null;
};

export default AnalyticsTracker;
