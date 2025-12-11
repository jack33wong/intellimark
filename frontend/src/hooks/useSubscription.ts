import { useState, useEffect } from 'react';
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

export const useSubscription = (): UseSubscriptionResult => {
    const { user } = useAuth();
    const [subscription, setSubscription] = useState<UserSubscription | null>(null);
    const [loading, setLoading] = useState(true);
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
            } else {
                setSubscription(null);
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

    const planId = (subscription?.status === 'active' ? subscription.planId : 'free') as 'free' | 'pro' | 'enterprise';

    const checkPermission = (feature: 'analysis' | 'model_selection') => {
        if (feature === 'analysis') {
            // Free: Block Analysis
            // Pro/Enterprise: Allowed
            return planId !== 'free';
        }
        if (feature === 'model_selection') {
            // Free/Pro: Block Model Selection
            // Enterprise: Allowed
            return planId === 'enterprise';
        }
        return false;
    };

    return {
        subscription,
        planId,
        loading,
        error,
        refreshSubscription: fetchSubscription,
        checkPermission
    };
};
