import { Request, Response, NextFunction } from 'express';
import { MarkingPipelineService } from '../services/marking/MarkingPipelineService.js';
import { sendSseUpdate } from '../utils/sseUtils.js';
import { usageTracker } from '../utils/usageTracker.js';
import { checkCredits, deductCredits } from '../services/creditService.js';

export class MarkingController {
    /**
     * Handles the marking request.
     * Sets up SSE, extracts parameters, and delegates to MarkingPipelineService.
     */
    public static async processMarkingRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();

        // 1. Validate Request
        if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
            res.status(400).json({ error: 'No files uploaded.' });
            return;
        }

        const files = req.files as Express.Multer.File[];
        const submissionId = req.body.submissionId || `sub-${Date.now()}`;

        // 2. Setup SSE Headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        // Send initial connection confirmation
        sendSseUpdate(res, { type: 'connected', message: 'Connection established' });

        try {
            // 3. Prepare Options
            const options = {
                userId: (req as any).user?.uid, // Assuming auth middleware populates this
                sessionId: req.body.sessionId,
                customText: req.body.customText,
                model: req.body.model
            };

            const userId = options.userId;

            console.log(`🔍 [CREDIT DEBUG] userId: ${userId}, isAuthenticated: ${!!userId}, isAnonymous: ${userId === 'anonymous'}`);

            // Check credits before processing (skip for anonymous users)
            if (userId && userId !== 'anonymous') {
                console.log(`💳 [CREDIT CHECK] Starting credit check for user: ${userId}`);
                try {
                    // Estimate cost based on file size and count
                    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
                    const estimatedCost = (totalBytes / 10000 + files.length * 5) * 0.001;
                    console.log(`💳 [CREDIT CHECK] Estimated cost: ${estimatedCost}, files: ${files.length}, bytes: ${totalBytes}`);
                    const creditCheck = await checkCredits(userId, estimatedCost);
                    console.log(`💳 [CREDIT CHECK] Result: ${JSON.stringify(creditCheck)}`);

                    if (creditCheck.warning) {
                        console.log(`💳 Credit warning for user ${userId}: ${creditCheck.warning}`);
                        // Send warning via SSE
                        sendSseUpdate(res, {
                            type: 'credit_warning',
                            message: creditCheck.warning,
                            remaining: creditCheck.remaining
                        });
                    }
                } catch (error) {
                    console.error('❌ Credit check failed:', error);
                    // Continue anyway - don't block user on credit check failure
                }
            } else {
                console.log(`⏭️  [CREDIT CHECK] Skipped for userId: ${userId} (anonymous or missing)`);
            }

            // 4. Execute Pipeline
            const result = await MarkingPipelineService.executePipeline(
                req,
                files,
                submissionId,
                options,
                (data: any) => sendSseUpdate(res, data)
            );

            console.log(`✅ [CONTROLLER] Pipeline completed, result exists: ${!!result}, sessionId: ${result?.sessionId}`);

            // 6. Handle Completion (if not already handled by progressCallback with type: 'complete')
            // The service sends a 'complete' event via the callback, so we might not need to do anything here
            // except ensure the response is ended if it hasn't been already.
            // However, sendSseUpdate doesn't end the response.

            // We can explicitly end the response here if the service returns successfully.
            // But usually, we want to ensure the 'complete' message was sent.
            // The service logic sends { type: 'complete', result: finalOutput } as the last callback.

            // Deduct credits after processing (skip for anonymous users)
            if (userId && userId !== 'anonymous') {
                console.log(`💳 [CREDIT DEDUCT] Starting deduction for user: ${userId}, sessionId from result: ${result?.sessionId}`);
                const actualSessionId = result?.sessionId || options.sessionId;

                try {
                    // Wait briefly to ensure usageRecord is created
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // Get usage cost from usageRecords collection
                    const { getFirestore } = await import('../config/firebase.js');
                    const db = getFirestore();
                    if (db && actualSessionId) {
                        console.log(`💳 [CREDIT DEDUCT] Looking for usageRecord: ${actualSessionId}`);
                        const usageDoc = await db.collection('usageRecords').doc(actualSessionId).get();
                        if (usageDoc.exists) {
                            const usageData = usageDoc.data();
                            const actualCost = usageData?.totalCost || 0;
                            console.log(`💳 [CREDIT DEDUCT] Found usageRecord, totalCost: ${actualCost}`);

                            if (actualCost > 0) {
                                await deductCredits(userId, actualCost, actualSessionId);
                                console.log(`💳 Deducted ${actualCost} credits (session: ${actualSessionId}) from user ${userId}`);
                            } else {
                                console.log(`⚠️  [CREDIT DEDUCT] totalCost is 0, skipping deduction`);
                            }
                        } else {
                            console.log(`⚠️  [CREDIT DEDUCT] usageRecord not found for session: ${actualSessionId}`);
                        }
                    } else {
                        console.log(`⚠️  [CREDIT DEDUCT] Missing db or sessionId - db: ${!!db}, sessionId: ${actualSessionId}`);
                    }
                } catch (error) {
                    console.error('❌ Credit deduction failed:', error);
                    // Don't fail the request if credit deduction fails
                }
            } else {
                console.log(`⏭️  [CREDIT DEDUCT] Skipped for userId: ${userId} (anonymous or missing)`);
            }

            res.end();

        } catch (error: any) {
            console.error('❌ [CONTROLLER] Marking request failed:', error);

            // Send error via SSE since headers are already sent
            sendSseUpdate(res, {
                type: 'error',
                message: error.message || 'An unexpected error occurred during marking.'
            });

            res.end();
        }
    }
}
