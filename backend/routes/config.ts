/**
 * Frontend API endpoint to get credit configuration
 * This allows frontend to display dynamic credit allocations
 */

import express from 'express';
import CREDIT_CONFIG from '../config/credit.config';
import { getFirestore } from '../config/firebase.js';
import { ExamReferenceService } from '../services/ExamReferenceService.js';

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
        const qualifications = new Set<string>();
        const tiers = new Set<string>();
        const papers = new Set<string>();
        const codes = new Set<string>();

        snapshot.forEach((doc: any) => {
            const data = doc.data();
            const metadata = data.metadata;
            if (metadata) {
                const board = metadata.exam_board || '';
                const code = metadata.exam_code || '';

                // Normalize Series, Tier, and Qualification using Centralized Service
                const { series: formattedSeries, tier: formattedTier, qualification, isAlevel, isGcse } = ExamReferenceService.formatMetadataDisplay(metadata);

                if (board) boards.add(board);
                if (code) codes.add(code);
                
                // Track qualification (Normalized: GCSE or A-Level)
                if (qualification) {
                    qualifications.add(qualification); // Use the normalized value from service
                }

                // [RULE] Collect TIER only for GCSE and only if not "N/A"
                if (isGcse && formattedTier && formattedTier !== 'N/A') {
                    tiers.add(formattedTier);
                }

                if (board || code || formattedSeries) {
                    // [RULE] Paper description format: "[Qual] Board - Code - Exam Series" (Tier only if GCSE)
                    const qualPrefix = isAlevel ? 'A-Level ' : 'GCSE ';
                    
                    const tierSuffix = (isGcse && formattedTier) ? `, ${formattedTier}` : '';
                    
                    const fullDescription = `${qualPrefix}${board}${board && code ? ' - ' : ''}${code}${(board || code) && formattedSeries ? ' - ' : ''}${formattedSeries}${tierSuffix}`;
                    
                    if (fullDescription.trim()) {
                        papers.add(fullDescription);
                    }
                }
            }
        });

        res.json({
            boards: Array.from(boards).sort(),
            qualifications: Array.from(qualifications).sort(),
            tiers: Array.from(tiers).sort(),
            papers: Array.from(papers).sort(),
            codes: Array.from(codes).sort()
        });
    } catch (error) {
        console.error('Error fetching exam metadata:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
