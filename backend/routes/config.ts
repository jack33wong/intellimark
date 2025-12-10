/**
 * Frontend API endpoint to get credit configuration
 * This allows frontend to display dynamic credit allocations
 */

import express from 'express';
import CREDIT_CONFIG from '../config/credit.config';

const router = express.Router();

/**
 * GET /api/config/credits
 * Returns credit configuration for frontend display
 */
router.get('/credits', (req, res) => {
    res.json({
        conversionRate: CREDIT_CONFIG.conversionRate,
        planCredits: CREDIT_CONFIG.planCredits
    });
});

export default router;
