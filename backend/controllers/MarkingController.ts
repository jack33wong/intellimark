import { Request, Response, NextFunction } from 'express';
import { MarkingPipelineService } from '../services/marking/MarkingPipelineService.js';
import { sendSseUpdate } from '../utils/sseUtils.js';
import { PERMISSIONS, hasPermission } from '../config/permissions.js';
import UsageTracker from '../utils/UsageTracker.js';
import { checkCredits, deductCredits } from '../services/creditService.js';
import { GuestUsageService } from '../services/guestUsageService.js';
import axios from 'axios';
import https from 'https';

// Global HTTPS Agent with Keep-Alive enabled
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  keepAliveMsecs: 30000
});

export class MarkingController {
    /**
     * Proxies image download to bypass CORS and force attachment
     */
    public static async downloadImage(req: Request, res: Response): Promise<void> {
        const imageUrl = req.query.url as string;
        const filename = req.query.filename as string || 'download-image.jpg';

        if (!imageUrl) {
            res.status(400).send('Missing image URL');
            return;
        }

        try {
            console.log(`📡 [MARKING] Proxying download for: ${filename}`);
            const response = await axios({
                method: 'get',
                url: imageUrl,
                responseType: 'stream',
                httpsAgent: keepAliveAgent
            });

            // Forward relevant headers
            res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

            // Pipe the stream
            response.data.pipe(res);
        } catch (error: any) {
            console.error('❌ [MARKING] Download proxy failed:', error.message);
            res.status(500).send('Failed to proxy image download');
        }
    }
    /**
     * Handles the marking request.
     * Sets up SSE, extracts parameters, and delegates to MarkingPipelineService.
     */
    public static async processMarkingRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const usageTracker = new UsageTracker();

        // Track critical IDs for credit deduction even if the pipeline crashes
        let finalUserId: string | null = null;
        let finalSessionId: string | null = null;
        let finalModel: string = 'gemini-3.7-flash';

        // 1. Validate Request
        console.log(`🚀 [MARKING] Controller started - Files: ${Array.isArray(req.files) ? req.files.length : 0}, Body Keys: ${Object.keys(req.body || {}).join(', ')}`);

        if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
            console.warn('⚠️ [MARKING] 400 Bad Request: No files found in request.');
            console.log('[MARKING-DEBUG] Full Body:', JSON.stringify(req.body));
            res.status(400).json({
                error: 'No files uploaded.',
                debug: {
                    hasFiles: !!req.files,
                    filesCount: Array.isArray(req.files) ? req.files.length : 0,
                    bodyKeys: Object.keys(req.body || {}),
                    contentType: req.headers['content-type'],
                    hasRawBody: !!(req as any).rawBody,
                    rawBodySize: (req as any).rawBody?.length || 0
                }
            });
            return;
        }

        const files = req.files as Express.Multer.File[];
        const submissionId = req.body.submissionId || `sub-${Date.now()}`;

        // 2. Setup SSE Headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        // Send initial connection confirmation with the guaranteed submissionId
        sendSseUpdate(res, { type: 'connected', message: 'Connection established', sessionId: submissionId });

        // 👇 KEEP-ALIVE HEARTBEAT 👇
        const heartbeat = setInterval(() => {
            // Sending a colon and newlines is an SSE comment. 
            // The frontend fetch reader will completely ignore it, but GCP stays awake.
            res.write(':\n\n'); 
        }, 15000); // Ping every 15 seconds

        try {
            let sessionId = req.body.sessionId;
            // Sanitization: Reject temp- IDs from frontend
            if (sessionId && sessionId.startsWith('temp-')) {
                console.log(`⚠️ [MARKING] Rejecting temp session ID: ${sessionId}`);
                sessionId = undefined;
            }

            // 3. Prepare Options
            let requestedModel = req.body.model;
            if (!requestedModel || requestedModel.toUpperCase() === 'AUTO') {
                requestedModel = 'FAST';
            }

            // Enforce Plan Limits: Only allowed plans can select custom models
            const userPlan = (req as any).userPlan || 'free';
            if (!hasPermission(userPlan, PERMISSIONS.MODEL_SELECTION_PLANS) && requestedModel !== 'FAST') {
                const uid = (req as any).user?.uid;
                const userIdentifier = (uid && uid !== 'anonymous') ? `User ${uid}` : 'Guest User';
                console.log(`🔒 [PLAN LIMIT] ${userIdentifier} (${userPlan}) tried to use model '${requestedModel}'. Forcing 'FAST'.`);
                requestedModel = 'FAST';
            }

            // Write back so downstream services see the final string
            req.body.model = requestedModel;

            const options = {
                userId: (req as any).user?.uid,
                sessionId: sessionId,
                customText: req.body.customText,
                model: requestedModel
            };

            const userId = options.userId;
            
            // Populate tracking variables for finally block
            finalUserId = userId || null;
            finalSessionId = sessionId || null;
            finalModel = requestedModel;

            const isAuthenticated = !!userId && userId !== 'anonymous';
            const userIP = req.ip || '0.0.0.0';

            // --- NEW: Guest Usage Limit Check ---
            if (!isAuthenticated) {
                const limitInfo = await GuestUsageService.checkLimit(userIP);
                if (!limitInfo.allowed) {
                    sendSseUpdate(res, {
                        type: 'error',
                        error: 'Guest limit reached. Please sign up to continue.',
                        details: 'guest_limit_reached',
                        usageCount: limitInfo.count,
                        usageLimit: limitInfo.limit,
                        resetAt: limitInfo.resetAt
                    });
                    res.end();
                    return;
                }
            }

            console.log(`🔍 [CREDIT DEBUG] userId: ${userId}, isAuthenticated: ${isAuthenticated}`);

            // Note: Credit check is now securely handled inside MarkingPipelineService.ts 
            // AFTER files have been standardized into explicit images for 100% accurate page counts.

            // 4. Execute Pipeline
            const progressCallback = (data: any) => {
                if (process.env.CHAOS_MODE === 'true') {
                    // Randomly drop non-essential packets (progress updates, not 'complete' or 'error' or first packet)
                    if (data.type !== 'complete' && data.type !== 'error' && data.progress !== 0) {
                        if (Math.random() < 0.3) {
                            console.log(`🌪️ [CHAOS MODE] Dropped packet: ${data.message || data.type}`);
                            return; // Simulate packet loss
                        }
                    }
                }
                sendSseUpdate(res, data);
            };

            const result = await MarkingPipelineService.executePipeline(
                req,
                files,
                submissionId,
                options,
                progressCallback,
                usageTracker
            );
            
            if (result?.sessionId) {
                finalSessionId = result.sessionId;
            }

            console.log(`✅ [CONTROLLER] Pipeline completed, result exists: ${!!result}, sessionId: ${result?.sessionId}`);

            // 6. Handle Completion (if not already handled by progressCallback with type: 'complete')
            // The service sends a 'complete' event via the callback, so we might not need to do anything here
            // except ensure the response is ended if it hasn't been already.
            // However, sendSseUpdate doesn't end the response.

            // We can explicitly end the response here if the service returns successfully.
            // But usually, we want to ensure the 'complete' message was sent.
            // The service logic sends { type: 'complete', result: finalOutput } as the last callback.

            // Credit deduction was moved to the finally block to ensure it always runs (even on crash).
            // We NO LONGER deduct credits here in the success path to prevent double-charging.
            
            // --- NEW: Increment Guest Usage ---
            if (!isAuthenticated) {
                await GuestUsageService.incrementUsage(userIP);
            }

            res.end();

        } catch (error: any) {
            console.error(`❌ [CONTROLLER] Marking request failed: ${error.message}`);
            
            // Safely extract IDs to tie the response back to the user's UI
            const aiMessageId = req.body?.aiMessageId || `ai-${Date.now()}`;
            const sessionId = req.body?.sessionId;

            // 🛡️ NEW: INTERCEPT UNREADABLE PDF ERRORS FOR THE UI
            let displayMessage = `**Analysis Halted:**\n\n${error.message}`;
            
            if (error.message?.includes('PDF_UNREADABLE') || error.message?.includes('Postscript delegate failed')) {
                displayMessage = `**Analysis Halted: Unreadable PDF format** 🛑\n\nI couldn't read the text inside this PDF because it appears to be corrupted, password-protected, or saved in an unsupported format.\n\n**Quick Fix:**\n1. Open the file on your device.\n2. Select **Print** and choose **"Save as PDF"**.\n3. Upload that newly saved file!`;
            }

            // 🛑 THE FIX: Wrap the error as a successful AI chat message so it renders gracefully in the UI
            const gracefulPayload = JSON.stringify({
                type: 'complete',
                result: {
                    success: true, // Force true so the frontend renders it instead of throwing a JS exception
                    sessionId: sessionId,
                    sessionTitle: "Document Rejected",
                    aiMessage: {
                        id: aiMessageId,
                        role: 'assistant',
                        content: displayMessage,
                        timestamp: new Date().toISOString(),
                        type: 'text',
                        isProcessing: false,
                        processingStats: {
                            apiUsed: 'System Validation',
                            modelUsed: 'Pre-flight Check'
                        }
                    }
                }
            });

            // Ensure headers are set if the stream hasn't started yet
            if (!res.headersSent) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.status(200);
            }
            
            res.write(`data: ${gracefulPayload}\n\n`);
            res.end(); // Gracefully close the connection
        } finally {
            // 👇 CLEAR HEARTBEAT 👇
            clearInterval(heartbeat);
            
            // 🛑 THE FIX: Guarantee credit deduction regardless of pipeline success or failure
            try {
                const finalCost = usageTracker.calculateCost(finalModel).total;
                
                if (finalCost > 0 && finalUserId && finalUserId !== 'anonymous') {
                    console.log(`💳 [CREDIT DEDUCT] Calculating final cost: $${finalCost} for user ${finalUserId}`);
                    await deductCredits(finalUserId, finalCost, finalSessionId || 'unknown');
                    console.log(`💳 ✅ Successfully deducted $${finalCost} from user ${finalUserId}`);
                } else if (finalCost > 0) {
                    console.log(`⏭️  [CREDIT DEDUCT] Skipped deduction for anonymous user (Cost: $${finalCost})`);
                }
            } catch (deductionError) {
                console.error('❌ CRITICAL: Failed to deduct credits during cleanup:', deductionError);
            }
        }
    }
}
