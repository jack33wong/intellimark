/**
 * Credit Management API Routes
 */

import express from 'express';
import { getUserCredits } from '../services/creditService.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/credits/:userId
 * Get user's current credit status
 */
router.get('/:userId', requireAuth, async (req, res) => {
    try {
        const { userId } = req.params;

        // Verify user can only access their own credits (or admin)
        if (req.user.uid !== userId && !req.user.isAdmin) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

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
