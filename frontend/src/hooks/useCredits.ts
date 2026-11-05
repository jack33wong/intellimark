import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import API_CONFIG from '../config/api';
import EventManager, { EVENT_TYPES } from '../utils/eventManager';

export interface UserCredits {
    userId: string;
    planId: 'free' | 'pro' | 'ultra' | 'admin_test';
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
    inProgressPromise: Promise<UserCredits | null> | null;
    userId: string | null;
} = {
    credits: null,
    loaded: false,
    timestamp: 0,
    inProgressPromise: null,
    userId: null
};

export const useCredits = () => {
    const { user } = useAuth();
    const isCacheValidForUser = globalCreditCache.loaded && globalCreditCache.userId === user?.uid;
    const [credits, setCredits] = useState<UserCredits | null>(isCacheValidForUser ? globalCreditCache.credits : null);
    const [loading, setLoading] = useState(!isCacheValidForUser);
    const [error, setError] = useState<string | null>(null);

    const lastRequestIdRef = useRef(0);

    const fetchCredits = useCallback(async (force = false): Promise<UserCredits | null> => {
        if (!user?.uid) {
            setCredits(null);
            setLoading(false);
            return null;
        }

        const requestId = Date.now();
        lastRequestIdRef.current = requestId;

        // 1. Check cache (only if for current user, not forcing, and within 60s)
        if (
            !force &&
            !globalCreditCache.inProgressPromise &&
            globalCreditCache.loaded &&
            globalCreditCache.userId === user.uid &&
            (Date.now() - globalCreditCache.timestamp < 60000)
        ) {
            if (lastRequestIdRef.current === requestId) {
                setCredits(globalCreditCache.credits);
                setLoading(false);
            }
            return globalCreditCache.credits;
        }

        // 2. Dedup parallel requests for the same user
        if (globalCreditCache.inProgressPromise && globalCreditCache.userId === user.uid) {
            setLoading(true);
            try {
                const data = await globalCreditCache.inProgressPromise;
                if (lastRequestIdRef.current === requestId) {
                    setCredits(data);
                    setError(null);
                }
                return data;
            } catch (err: any) {
                if (lastRequestIdRef.current === requestId) {
                    setError(err.message);
                }
                return null;
            } finally {
                if (lastRequestIdRef.current === requestId) {
                    setLoading(false);
                }
            }
        }

        const performFetch = async () => {
            const timestamp = Date.now();
            const response = await fetch(`${API_CONFIG.BASE_URL}/api/credits/${user.uid}?t=${timestamp}`, {
                cache: 'no-store'
            });

            if (!response.ok) {
                let errorMsg = 'Failed to fetch credits';
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.error || errorMsg;
                } catch (e) {
                    // response body might not be JSON
                }
                throw new Error(errorMsg);
            }

            const data = await response.json();
            globalCreditCache.credits = data;
            globalCreditCache.loaded = true;
            globalCreditCache.timestamp = Date.now();
            globalCreditCache.userId = user.uid;
            return data;
        };

        try {
            setLoading(true);
            const fetchPromise = performFetch();
            globalCreditCache.inProgressPromise = fetchPromise;

            const data = await fetchPromise;

            if (lastRequestIdRef.current === requestId) {
                setCredits(data);
                setError(null);
            }
            return data;
        } catch (err: any) {
            if (lastRequestIdRef.current === requestId) {
                console.error('❌ [useCredits] Fetch failed:', err);
                setError(err.message);
            }
            return null;
        } finally {
            globalCreditCache.inProgressPromise = null;
            if (lastRequestIdRef.current === requestId) {
                setLoading(false);
            }
        }
    }, [user?.uid]);

    const lastFetchedUidRef = useRef<string | null>(null);

    // Watch for user changes and logout
    useEffect(() => {
        if (!user?.uid) {
            globalCreditCache.credits = null;
            globalCreditCache.loaded = false;
            globalCreditCache.timestamp = 0;
            globalCreditCache.userId = null;
            globalCreditCache.inProgressPromise = null;
            setCredits(null);
            setLoading(false);
            lastFetchedUidRef.current = null;
            return;
        }

        // If user switched accounts, immediately clear old user's cached credits and force fetch
        if (globalCreditCache.userId && globalCreditCache.userId !== user.uid) {
            globalCreditCache.credits = null;
            globalCreditCache.loaded = false;
            globalCreditCache.timestamp = 0;
            globalCreditCache.userId = user.uid;
            globalCreditCache.inProgressPromise = null;
            setCredits(null);
            setLoading(true);
            fetchCredits(true);
            lastFetchedUidRef.current = user.uid;
            return;
        }

        // Initial fetch on mount or UID change
        if (user.uid !== lastFetchedUidRef.current) {
            fetchCredits();
            lastFetchedUidRef.current = user.uid;
        }
    }, [fetchCredits, user?.uid]);

    // Listen for events that should trigger a credit refresh or logout cache purge
    useEffect(() => {
        const creditsRefreshUnsubscribe = EventManager.listen('refreshCredits', () => {
            fetchCredits(true);
        });

        const subscriptionUpdatedUnsubscribe = EventManager.listen('SUBSCRIPTION_UPDATED', () => {
            fetchCredits(true);
        });

        const logoutUnsubscribe = EventManager.listen(EVENT_TYPES.USER_LOGGED_OUT, () => {
            globalCreditCache.credits = null;
            globalCreditCache.loaded = false;
            globalCreditCache.timestamp = 0;
            globalCreditCache.userId = null;
            globalCreditCache.inProgressPromise = null;
            setCredits(null);
            setLoading(false);
            lastFetchedUidRef.current = null;
        });

        return () => {
            creditsRefreshUnsubscribe();
            subscriptionUpdatedUnsubscribe();
            logoutUnsubscribe();
        };
    }, [fetchCredits]);

    const hasCredits = credits ? credits.remainingCredits > 0 : true; // Assume true if not loaded to prevent blocking
    const isNegative = credits ? credits.remainingCredits <= 0 : false;

    const refreshCredits = useCallback(() => fetchCredits(true), [fetchCredits]);

    const ensureCredits = useCallback(async (force = false): Promise<UserCredits | null> => {
        if (!user?.uid) return null;
        if (!force && globalCreditCache.loaded && globalCreditCache.credits && globalCreditCache.userId === user.uid && !loading) {
            return globalCreditCache.credits;
        }
        return await fetchCredits(force);
    }, [user?.uid, loading, fetchCredits]);

    return {
        credits,
        loading,
        error,
        hasCredits,
        isNegative,
        refreshCredits,
        ensureCredits
    };
};
