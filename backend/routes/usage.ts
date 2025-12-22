/**
 * Usage Routes
 * Handles user-specific usage statistics
 */

import * as express from 'express';
import type { Request, Response } from 'express';
import { authenticateUser } from '../middleware/auth.js';
import admin from 'firebase-admin';

// Import Firebase instances from centralized config
import { getFirestore } from '../config/firebase.js';
import { costToCredits } from '../config/credit.config.js';

const router = express.Router();

// Apply authentication to all usage routes
router.use(authenticateUser);

/**
 * GET /api/usage/me
 * Get usage statistics for the current authenticated user
 * Query params: ?filter=all|year|month|week|yesterday|day
 */
router.get('/me', async (req: Request, res: Response) => {
    try {
        const filter = (req.query.filter as string) || 'all';
        const userId = (req as any).user.uid; // Get current user ID from auth middleware

        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }

        const db = getFirestore();
        if (!db) {
            return res.status(500).json({
                success: false,
                error: 'Firestore not available'
            });
        }

        // Calculate date range based on filter
        const now = new Date();
        let startDate: Date;
        let endDate: Date | undefined;

        switch (filter) {
            case 'day': {
                startDate = new Date(now);
                startDate.setHours(0, 0, 0, 0);
                break;
            }
            case 'yesterday': {
                startDate = new Date(now);
                startDate.setDate(startDate.getDate() - 1);
                startDate.setHours(0, 0, 0, 0);

                endDate = new Date(now);
                endDate.setHours(0, 0, 0, 0);
                break;
            }
            case 'week': {
                startDate = new Date(now);
                startDate.setHours(0, 0, 0, 0);
                const dayOfWeek = startDate.getDay();
                const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
                startDate.setDate(startDate.getDate() - daysToMonday);
                break;
            }
            case 'month': {
                startDate = new Date(now);
                startDate.setHours(0, 0, 0, 0);
                startDate.setDate(1);
                break;
            }
            case 'year': {
                startDate = new Date(now);
                startDate.setHours(0, 0, 0, 0);
                startDate.setDate(1);
                startDate.setMonth(0);
                break;
            }
            default: // 'all'
                startDate = new Date(0);
        }

        // Query usageTransactions collection filtered by userId
        // Note: Filtering by date in-memory to avoid composite index requirement
        const query = db.collection('usageTransactions').where('userId', '==', userId);
        const snapshot = await query.get();

        // Calculate start/end bounds for in-memory filtering
        const startTime = startDate.getTime();
        const endTime = endDate ? endDate.getTime() : Infinity;

        // Group transactions by sessionId
        const sessionsMap = new Map<string, any>();
        let totalCost = 0;
        let totalModelCost = 0;
        let totalMathpixCost = 0;
        let totalApiRequests = 0;

        snapshot.forEach(doc => {
            const tx = doc.data();
            const txTimestamp = tx.timestamp?.toDate ? tx.timestamp.toDate() : new Date();
            const txTime = txTimestamp.getTime();

            // Apply in-memory date filter
            if (filter !== 'all') {
                if (txTime < startTime || txTime >= endTime) return;
            }

            const sessionId = tx.sessionId;
            const interactionCost = tx.totalCost || 0;
            const interactionModelCost = tx.costBreakdown?.llmCost || 0;
            const interactionMathpixCost = tx.costBreakdown?.mathpixCost || 0;
            const timestamp = txTimestamp.toISOString();

            if (!sessionsMap.has(sessionId)) {
                sessionsMap.set(sessionId, {
                    sessionId,
                    userId: tx.userId,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                    totalCost: 0,
                    modelCost: 0,
                    mathpixCost: 0,
                    modelUsed: tx.modelUsed,
                    apiRequests: 0,
                    mode: tx.mode,
                    creditsSpent: 0,
                    modeHistory: []
                });
            }

            const session = sessionsMap.get(sessionId);
            session.totalCost += interactionCost;
            session.modelCost += interactionModelCost;
            session.mathpixCost += interactionMathpixCost;
            session.creditsSpent = costToCredits(session.totalCost);
            session.apiRequests += 1;

            // Keep track of latest mode and update time
            if (new Date(timestamp) > new Date(session.updatedAt)) {
                session.updatedAt = timestamp;
                session.mode = tx.mode;
                session.modelUsed = tx.modelUsed;
            }
            if (new Date(timestamp) < new Date(session.createdAt)) {
                session.createdAt = timestamp;
            }

            // Map transaction to "history" format for frontend compatibility
            session.modeHistory.push({
                mode: tx.mode,
                timestamp: timestamp,
                costAtSwitch: session.totalCost - interactionCost, // Previous total
                creditsSpentAtSwitch: costToCredits(session.totalCost - interactionCost),
                modelCostAtSwitch: session.modelCost - interactionModelCost,
                modelUsed: tx.modelUsed,
                creditsSpent: costToCredits(interactionCost), // Current interaction credits
                // Granular tokens for details if needed
                tokens: tx.tokens,
                mathpixCalls: tx.mathpixCalls
            });

            // Update totals for summary
            totalCost += interactionCost;
            totalModelCost += interactionModelCost;
            totalMathpixCost += interactionMathpixCost;
            totalApiRequests += 1;
        });

        // Convert map to array and sort history within each session
        const usageData = Array.from(sessionsMap.values()).map(session => {
            session.modeHistory.sort((a: any, b: any) =>
                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
            return session;
        });

        // Sort by updatedAt descending (most recent activity first)
        usageData.sort((a, b) => {
            const dateA = new Date(a.updatedAt).getTime();
            const dateB = new Date(b.updatedAt).getTime();
            return dateB - dateA;
        });

        // Round totals to 4 decimal places for better precision
        totalCost = Math.round(totalCost * 10000) / 10000;
        totalModelCost = Math.round(totalModelCost * 10000) / 10000;
        totalMathpixCost = Math.round(totalMathpixCost * 10000) / 10000;

        res.json({
            success: true,
            filter,
            summary: {
                totalCost,
                totalModelCost,
                totalMathpixCost,
                totalUsers: 1, // Always 1 for user-specific query
                totalSessions: usageData.length,
                totalApiRequests
            },
            usage: usageData
        });

    } catch (error) {
        console.error('❌ Error getting user usage statistics:', error);
        res.status(500).json({
            success: false,
            error: `Failed to get usage statistics: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
    }
});

export default router;
