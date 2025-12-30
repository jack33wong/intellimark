import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getAnalytics, logEvent } from 'firebase/analytics';

const AnalyticsTracker = () => {
    const location = useLocation();

    useEffect(() => {
        // Check if analytics is supported and initialized
        if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
            try {
                // We import dynamically to avoid issues during SSR or tests
                import('firebase/analytics').then(({ getAnalytics }) => {
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
