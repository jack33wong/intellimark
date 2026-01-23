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
    inProgressPromise: Promise<UserCredits | null> | null;
} = {
    credits: null,
    loaded: false,
    timestamp: 0,
    inProgressPromise: null
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

        // 1. Check cache (only if not forcing and no promise in progress)
        if (!force && !globalCreditCache.inProgressPromise && globalCreditCache.loaded && (Date.now() - globalCreditCache.timestamp < 60000)) {
            if (lastRequestIdRef.current === requestId) {
                setCredits(globalCreditCache.credits);
                setLoading(false);
            }
            return;
        }

        // 2. Dedup parallel requests (REBUILT: Works for both force and non-force)
        if (globalCreditCache.inProgressPromise) {
            // IF we are already loading, just wait for that one to finish
            // This prevents the 2ms burst seen on mount
            setLoading(true);
            try {
                const data = await globalCreditCache.inProgressPromise;
                if (lastRequestIdRef.current === requestId) {
                    setCredits(data);
                    setError(null);
                }
            } catch (err: any) {
                if (lastRequestIdRef.current === requestId) {
                    setError(err.message);
                }
            } finally {
                if (lastRequestIdRef.current === requestId) {
                    setLoading(false);
                }
            }
            return;
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
        } catch (err: any) {
            if (lastRequestIdRef.current === requestId) {
                console.error('❌ [useCredits] Fetch failed:', err);
                setError(err.message);
            }
        } finally {
            globalCreditCache.inProgressPromise = null;
            if (lastRequestIdRef.current === requestId) {
                setLoading(false);
            }
        }
    }, [user?.uid]);

    const lastFetchedUidRef = useRef<string | null>(null);

    useEffect(() => {
        // Only fetch automatically on mount or when UID actually changes
        // Use globalCreditCache.loaded sparingly here to avoid loops on failure
        if (user?.uid && user.uid !== lastFetchedUidRef.current) {
            fetchCredits();
            lastFetchedUidRef.current = user.uid;
        }

        // Listen for events that should trigger a credit refresh
        const creditsRefreshUnsubscribe = EventManager.listen('refreshCredits', () => {
            fetchCredits(true);
        });

        const subscriptionUpdatedUnsubscribe = EventManager.listen('SUBSCRIPTION_UPDATED', () => {
            fetchCredits(true);
        });

        return () => {
            creditsRefreshUnsubscribe();
            subscriptionUpdatedUnsubscribe();
        };
    }, [fetchCredits, user?.uid]);

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

    const refreshCredits = useCallback(() => fetchCredits(true), [fetchCredits]);

    return {
        credits,
        loading,
        error,
        hasCredits,
        isNegative,
        refreshCredits
    };
};
