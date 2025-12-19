/**
 * Frontend API endpoint to get credit configuration
 * This allows frontend to display dynamic credit allocations
 */

import express from 'express';
import CREDIT_CONFIG from '../config/credit.config';
import { getFirestore } from '../config/firebase.js';

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

/**
 * GET /api/config/exam-metadata
 * Returns unique exam metadata (board, series, code, tier) for autocomplete
 */
router.get('/exam-metadata', async (req, res) => {
    try {
        const db = getFirestore();
        if (!db) {
            return res.status(500).json({ error: 'Firestore not available' });
        }

        const snapshot = await db.collection('fullExamPapers').get();
        const boards = new Set<string>();
        const tiers = new Set<string>();
        const papers = new Set<string>();

        snapshot.forEach((doc: any) => {
            const data = doc.data();
            const metadata = data.metadata;
            if (metadata) {
                const board = metadata.exam_board || '';
                const tier = metadata.tier || '';
                const code = metadata.exam_code || '';
                const series = metadata.exam_series || '';

                if (board) boards.add(board);
                if (tier) tiers.add(tier);

                if (board || code || series) {
                    // Format: "Exam board - Exam Code - Exam Series, Tier"
                    const fullDescription = `${board}${board && code ? ' - ' : ''}${code}${(board || code) && series ? ' - ' : ''}${series}${tier ? `, ${tier}` : ''}`;
                    if (fullDescription.trim()) {
                        papers.add(fullDescription);
                    }
                }
            }
        });

        res.json({
            boards: Array.from(boards).sort(),
            tiers: Array.from(tiers).sort(),
            papers: Array.from(papers).sort()
        });
    } catch (error) {
        console.error('Error fetching exam metadata:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
