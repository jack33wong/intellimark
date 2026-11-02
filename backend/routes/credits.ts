/**
 * Credit Management API Routes
 */

import express from 'express';
import { getUserCredits } from '../services/creditService.js';

const router = express.Router();

/**
 * GET /api/credits/:userId
 * Get user's current credit status
 */
router.get('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        let targetUid = userId;

        // Support search by email
        if (userId.includes('@')) {
            const { getFirestore } = await import('../config/firebase.js');
            const db = getFirestore();
            if (db) {
                const snap = await db.collection('userSubscriptions')
                    .where('email', '==', userId.toLowerCase().trim())
                    .limit(1)
                    .get();
                if (!snap.empty) {
                    targetUid = snap.docs[0].data().userId;
                }
            }
        }

        const credits = await getUserCredits(targetUid);

        if (!credits) {
            // Return default 0 credits instead of 404
            return res.json({
                userId,
                planId: 'free',
                totalCredits: 0,
                usedCredits: 0,
                remainingCredits: 0,
                resetDate: 0,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
        }

        res.json(credits);
    } catch (error) {
        console.error('Error fetching credits:', error);
        res.status(500).json({ error: 'Failed to fetch credits' });
    }
});

export default router;
