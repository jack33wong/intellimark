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
            return res.status(404).json({
                error: 'Credits not initialized',
                message: 'Subscribe to a plan to get credits'
            });
        }

        res.json(credits);
    } catch (error) {
        console.error('Error fetching credits:', error);
        res.status(500).json({ error: 'Failed to fetch credits' });
    }
});

export default router;
