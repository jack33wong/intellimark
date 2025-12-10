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

        const credits = await getUserCredits(userId);

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
