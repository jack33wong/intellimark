/**
 * Admin Credit Management API Routes
 */

import express from 'express';
import { adminResetCredits, adminAdjustCredits } from '../../services/creditService.js';

const router = express.Router();

/**
 * POST /api/admin/credits/:userId/reset
 * Reset user credits to their plan's default allocation
 */
router.post('/:userId/reset', async (req, res) => {
    try {
        const { userId } = req.params;

        await adminResetCredits(userId);

        res.json({
            success: true,
            message: 'Credits reset to plan default'
        });
    } catch (error) {
        console.error('Error resetting credits:', error);
        res.status(500).json({
            error: 'Failed to reset credits',
            details: error.message
        });
    }
});

/**
 * POST /api/admin/credits/:userId/adjust
 * Adjust user credits by a specific amount
 * Body: { adjustment: number } (positive to add, negative to subtract)
 */
router.post('/:userId/adjust', async (req, res) => {
    try {
        const { userId } = req.params;
        const { adjustment } = req.body;

        if (typeof adjustment !== 'number') {
            return res.status(400).json({ error: 'Adjustment must be a number' });
        }

        await adminAdjustCredits(userId, adjustment);

        res.json({
            success: true,
            message: `Credits adjusted by ${adjustment}`
        });
    } catch (error) {
        console.error('Error adjusting credits:', error);
        res.status(500).json({
            error: 'Failed to adjust credits',
            details: error.message
        });
    }
});

export default router;
