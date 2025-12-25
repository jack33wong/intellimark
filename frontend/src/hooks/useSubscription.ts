import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SubscriptionService from '../services/subscriptionService';
import EventManager, { EVENT_TYPES } from '../utils/eventManager';
import { UserSubscription } from '../types/payment';

export interface UseSubscriptionResult {
    subscription: UserSubscription | null;
    planId: 'free' | 'pro' | 'enterprise';
    loading: boolean;
    error: string | null;
    refreshSubscription: () => Promise<void>;
    checkPermission: (feature: 'analysis' | 'model_selection') => boolean;
}

// Global cache to prevent flickering on remounts
const globalCache = {
    subscription: null as UserSubscription | null,
    loaded: false,
    timestamp: 0
};

export const useSubscription = (): UseSubscriptionResult => {
    const { user } = useAuth();
    // Initialize with cached data if available (prevents flickering)
    const [subscription, setSubscription] = useState<UserSubscription | null>(globalCache.subscription);
    const [loading, setLoading] = useState(!globalCache.loaded);
    const [error, setError] = useState<string | null>(null);

    const fetchSubscription = async () => {
        if (!user?.uid) {
            setSubscription(null);
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const response = await SubscriptionService.getUserSubscription(user.uid);
            if (response.hasSubscription && response.subscription) {
                setSubscription(response.subscription);
                // Update cache
                globalCache.subscription = response.subscription;
                globalCache.loaded = true;
                globalCache.timestamp = Date.now();
            } else {
                setSubscription(null);
                globalCache.subscription = null;
                globalCache.loaded = true;
            }
            setError(null);
        } catch (err: any) {
            console.error('Error fetching subscription:', err);
            setError(err.message || 'Failed to fetch subscription');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSubscription();

        // Listen for subscription updates (e.g., after upgrade/downgrade)
        const cleanup = EventManager.listen(EVENT_TYPES.SUBSCRIPTION_UPDATED, () => {
            console.log('🔄 [useSubscription] Received update event, refreshing...');
            fetchSubscription();
        });

        return () => {
            cleanup();
        };

    }, [user?.uid]);

    // Invalidate cache on logout
    useEffect(() => {
        if (!user?.uid) {
            globalCache.subscription = null;
            globalCache.loaded = false;
        }
    }, [user?.uid]);

    const planId = (subscription?.status === 'active' ? subscription.planId : 'free') as 'free' | 'pro' | 'enterprise';

    // Get allowed plans from env vars or default (ROBUST: trim spaces)
    const ALLOWED_ANALYSIS_PLANS = useMemo(() => (process.env.REACT_APP_PLAN_ANALYSIS || 'pro,enterprise').split(',').map(p => p.trim()), []);
    const ALLOWED_MODEL_SELECTION_PLANS = useMemo(() => (process.env.REACT_APP_PLAN_MODEL_SELECTION || 'enterprise').split(',').map(p => p.trim()), []);

    const checkPermission = useCallback((feature: 'analysis' | 'model_selection') => {
        if (feature === 'analysis') {
            return ALLOWED_ANALYSIS_PLANS.includes(planId);
        }
        if (feature === 'model_selection') {
            return ALLOWED_MODEL_SELECTION_PLANS.includes(planId);
        }
        return false;
    }, [planId, ALLOWED_ANALYSIS_PLANS, ALLOWED_MODEL_SELECTION_PLANS]);

    return {
        subscription,
        planId,
        loading,
        error,
        refreshSubscription: fetchSubscription,
        checkPermission
    };
};
