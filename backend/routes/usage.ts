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

        // Query usageRecords collection filtered by userId
        let query = db.collection('usageRecords').where('userId', '==', userId);

        // Apply date filter if not 'all'
        if (filter !== 'all') {
            const startTimestamp = admin.firestore.Timestamp.fromDate(startDate);
            query = query.where('createdAt', '>=', startTimestamp);

            if (endDate) {
                const endTimestamp = admin.firestore.Timestamp.fromDate(endDate);
                query = query.where('createdAt', '<', endTimestamp);
            }
        }

        const snapshot = await query.get();

        // Process usage records
        const usageData: Array<{
            sessionId: string;
            userId: string;
            createdAt: string;
            totalCost: number;
            llmCost: number;
            geminiCost: number;
            gptCost: number;
            mathpixCost: number;
            modelUsed: string;
            apiRequests: number;
            mode: string;
            modeHistory?: Array<{ mode: string; timestamp: string; costAtSwitch: number }>;
        }> = [];

        let totalCost = 0;
        let totalLLMCost = 0;
        let totalGeminiCost = 0;
        let totalGptCost = 0;
        let totalMathpixCost = 0;
        let totalApiRequests = 0;

        snapshot.forEach(doc => {
            const record = doc.data();

            const createdAt = record.createdAt.toDate().toISOString();

            // Handle legacy records
            const geminiCost = record.geminiCost ?? 0;
            const gptCost = record.gptCost ?? 0;
            const llmCost = record.llmCost ?? (geminiCost + gptCost);
            const apiRequests = record.apiRequests || 0;
            // Handle mode mapping. DB might store it as 'mode' or 'usageMode' or miss it
            const mode = record.mode || record.usageMode || 'chat';
            // Handle mode history
            const modeHistory = record.modeHistory || [];

            usageData.push({
                sessionId: doc.id,
                userId: record.userId,
                createdAt,
                totalCost: record.totalCost,
                llmCost,
                geminiCost,
                gptCost,
                mathpixCost: record.mathpixCost,
                modelUsed: record.modelUsed,
                apiRequests,
                mode,
                modeHistory
            });

            // Update totals
            totalCost += record.totalCost;
            totalLLMCost += llmCost;
            totalGeminiCost += geminiCost;
            totalGptCost += gptCost;
            totalMathpixCost += record.mathpixCost;
            totalApiRequests += apiRequests;
        });

        // Sort by date descending (newest first)
        usageData.sort((a, b) => {
            const dateA = new Date(a.createdAt).getTime();
            const dateB = new Date(b.createdAt).getTime();
            return dateB - dateA;
        });

        // Round totals to 2 decimal places
        totalCost = Math.round(totalCost * 100) / 100;
        totalLLMCost = Math.round(totalLLMCost * 100) / 100;
        totalGeminiCost = Math.round(totalGeminiCost * 100) / 100;
        totalGptCost = Math.round(totalGptCost * 100) / 100;
        totalMathpixCost = Math.round(totalMathpixCost * 100) / 100;

        res.json({
            success: true,
            filter,
            summary: {
                totalCost,
                totalLLMCost,
                totalGeminiCost,
                totalGptCost,
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
