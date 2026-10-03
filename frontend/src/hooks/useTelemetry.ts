import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';

import { useCallback } from 'react';

export const useTelemetry = () => {
    const { user } = useAuth() as { user: any };

    const logEvent = useCallback(async (
        collectionName: 'telemetry_events' | 'marking_feedback', 
        payload: Record<string, any>
    ) => {
        if (!user || !user.uid || !db) {
            console.warn(`[TELEMETRY] Skipping sync to ${collectionName}. Reason:`, { 
                hasUser: !!user, 
                hasUid: !!user?.uid, 
                hasDb: !!db 
            });
            return;
        }
        try {
            const docRef = await addDoc(collection(db, collectionName), {
                userId: user.uid,
                ...payload,
                createdAt: serverTimestamp()
            });
            console.log(`[TELEMETRY] Successfully synced to ${collectionName} with ID: ${docRef.id}`);
        } catch (error) {
            console.error("[TELEMETRY] silent fail:", error);
        }
    }, [user]);

    return { logEvent };
};
