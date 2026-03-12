import { getFirestore } from '../config/firebase.js';
import admin from 'firebase-admin';

const GUEST_LIMIT = 5;
const RESET_HOURS = 24; // Guest usage resets after 24 hours
const COLLECTION = 'guestUsage';

/**
 * Service to track and enforce usage limits for guest (unauthenticated) users.
 * Uses IP-based tracking in Firestore.
 */
export class GuestUsageService {
    private static db = getFirestore();

    /**
     * Checks if a guest user (by IP) has reached their usage limit.
     */
    static async checkLimit(ip: string): Promise<{ allowed: boolean; count: number; remaining: number; limit: number; resetAt: string | null }> {
        if (!this.db || !ip) return { allowed: true, count: 0, remaining: GUEST_LIMIT, limit: GUEST_LIMIT, resetAt: null };

        try {
            const doc = await this.db.collection(COLLECTION).doc(this.hashIP(ip)).get();

            if (!doc.exists) {
                return { allowed: true, count: 0, remaining: GUEST_LIMIT, limit: GUEST_LIMIT, resetAt: null };
            }

            const data = doc.data();
            const count = data?.count || 0;

            // Compute resetAt from firstUsed + RESET_HOURS
            let resetAt: string | null = null;
            if (data?.firstUsed) {
                const firstUsedMs = data.firstUsed.toMillis ? data.firstUsed.toMillis() : Date.parse(data.firstUsed);
                const resetMs = firstUsedMs + (RESET_HOURS * 60 * 60 * 1000);
                resetAt = new Date(resetMs).toISOString();
                
                // Auto-reset if 24 hours have passed
                if (Date.now() > resetMs) {
                    await this.db.collection(COLLECTION).doc(this.hashIP(ip)).delete();
                    return { allowed: true, count: 0, remaining: GUEST_LIMIT, limit: GUEST_LIMIT, resetAt: null };
                }
            }

            return {
                allowed: count < GUEST_LIMIT,
                count,
                remaining: Math.max(0, GUEST_LIMIT - count),
                limit: GUEST_LIMIT,
                resetAt
            };
        } catch (error) {
            console.error('Error checking guest limit:', error);
            return { allowed: true, count: 0, remaining: 1, limit: GUEST_LIMIT, resetAt: null };
        }
    }

    /**
     * Increments the usage count for a guest user (by IP).
     */
    static async incrementUsage(ip: string): Promise<number> {
        if (!this.db || !ip) return 0;

        try {
            const docRef = this.db.collection(COLLECTION).doc(this.hashIP(ip));

            let newCount = 1;

            await this.db.runTransaction(async (transaction) => {
                const doc = await transaction.get(docRef);

                if (!doc.exists) {
                    transaction.set(docRef, {
                        count: 1,
                        firstUsed: admin.firestore.FieldValue.serverTimestamp(),
                        lastUsed: admin.firestore.FieldValue.serverTimestamp(),
                        ip: ip // Store for debugging, though we use hashed ID
                    });
                } else {
                    newCount = (doc.data()?.count || 0) + 1;
                    transaction.update(docRef, {
                        count: newCount,
                        lastUsed: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
            });

            return newCount;
        } catch (error) {
            console.error('Error incrementing guest usage:', error);
            return 0;
        }
    }

    /**
     * Simple hash for IP to avoid storing raw IPs as document IDs.
     */
    private static hashIP(ip: string): string {
        // Simple base64 encode for document compatibility
        return Buffer.from(ip).toString('base64').replace(/[/+=]/g, '_');
    }
}
