import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import API_CONFIG from '../config/api';
import EventManager from '../utils/eventManager';

export interface UserCredits {
    userId: string;
    planId: 'free' | 'pro' | 'ultra';
    totalCredits: number;
    usedCredits: number;
    remainingCredits: number;
    resetDate: number;
    createdAt: number;
    updatedAt: number;
}

// Global cache to prevent flickering and redundant fetches
const globalCreditCache: {
    credits: UserCredits | null;
    loaded: boolean;
    timestamp: number;
} = {
    credits: null,
    loaded: false,
    timestamp: 0
};

export const useCredits = () => {
    const { user } = useAuth();
    const [credits, setCredits] = useState<UserCredits | null>(globalCreditCache.credits);
    const [loading, setLoading] = useState(!globalCreditCache.loaded);
    const [error, setError] = useState<string | null>(null);

    const lastRequestIdRef = useRef(0);

    const fetchCredits = useCallback(async (force = false) => {
        if (!user?.uid) {
            setCredits(null);
            setLoading(false);
            return;
        }

        const requestId = Date.now();
        lastRequestIdRef.current = requestId;

        // Use cache if not force and less than 1 minute old
        if (!force && globalCreditCache.loaded && (Date.now() - globalCreditCache.timestamp < 60000)) {
            // Even if using cache, ensure we aren't overwriting a newer request if one started
            if (lastRequestIdRef.current === requestId) {
                setCredits(globalCreditCache.credits);
                setLoading(false);
            }
            return;
        }

        try {
            setLoading(true);
            const timestamp = Date.now();
            const response = await fetch(`${API_CONFIG.BASE_URL}/api/credits/${user.uid}?t=${timestamp}`, {
                cache: 'no-store'
            });

            // Prevent race conditions: ignore if a newer request has started
            if (lastRequestIdRef.current !== requestId) {
                return;
            }

            if (response.ok) {
                const data = await response.json();

                if (lastRequestIdRef.current === requestId) {
                    setCredits(data);
                    globalCreditCache.credits = data;
                    globalCreditCache.loaded = true;
                    globalCreditCache.timestamp = Date.now();
                    setError(null);
                }
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to fetch credits');
            }
        } catch (err: any) {
            if (lastRequestIdRef.current === requestId) {
                console.error('❌ [useCredits] Fetch failed:', err);
                setError(err.message);
            }
        } finally {
            if (lastRequestIdRef.current === requestId) {
                setLoading(false);
            }
        }
    }, [user?.uid]);

    useEffect(() => {
        fetchCredits();

        // Listen for events that should trigger a credit refresh
        const creditsRefreshUnsubscribe = EventManager.listen('refreshCredits', () => {
            fetchCredits(true);
        });

        const subscriptionUpdatedUnsubscribe = EventManager.listen('SUBSCRIPTION_UPDATED', () => {
            fetchCredits(true);
        });

        // Also listen for the global header refresh key
        const originalRefreshHeader = window.refreshHeaderSubscription;
        window.refreshHeaderSubscription = () => {
            if (originalRefreshHeader) originalRefreshHeader();
            fetchCredits(true);
        };

        return () => {
            creditsRefreshUnsubscribe();
            subscriptionUpdatedUnsubscribe();
            window.refreshHeaderSubscription = originalRefreshHeader;
        };
    }, [fetchCredits]);

    // Invalidate cache on auth change
    useEffect(() => {
        if (!user?.uid) {
            globalCreditCache.credits = null;
            globalCreditCache.loaded = false;
            setCredits(null);
        }
    }, [user?.uid]);

    const hasCredits = credits ? credits.remainingCredits > 0 : true; // Assume true if not loaded to prevent blocking
    const isNegative = credits ? credits.remainingCredits < 0 : false;

    return {
        credits,
        loading,
        error,
        hasCredits,
        isNegative,
        refreshCredits: () => fetchCredits(true)
    };
};
