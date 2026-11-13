import { Request, Response, NextFunction } from 'express';
import { MarkingPipelineService } from '../services/marking/MarkingPipelineService.js';
import { sendSseUpdate } from '../utils/sseUtils.js';
import { PERMISSIONS, hasPermission } from '../config/permissions.js';
import UsageTracker from '../utils/UsageTracker.js';
import { checkCredits, deductCredits } from '../services/creditService.js';
import { GuestUsageService } from '../services/guestUsageService.js';
import axios from 'axios';
import https from 'https';
import { AdminAlertService } from '../services/AdminAlertService.js';
import { UserFacingError } from '../utils/UserFacingError.js';
import { FirestoreService } from '../services/firestoreService.js';
import { SessionManagementService } from '../services/sessionManagementService.js';

// Global HTTPS Agent with Keep-Alive enabled
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  keepAliveMsecs: 30000
});

export class MarkingController {
    /**
     * Handles re-marking an existing session using an official past paper mark scheme
     * with zero re-upload. Sets up SSE stream and delegates to MarkingPipelineService.executeRemarkPipeline.
     * Deducts 0 credits (Free Quota)!
     */
    public static async remarkSession(req: Request, res: Response, next: NextFunction): Promise<void> {
        const usageTracker = new UsageTracker();

        const { sessionId, paperTitle, questionNumber, model, aiMessageId, uploadedSchemeFiles } = req.body || {};
        if (!sessionId || (!paperTitle && (!Array.isArray(uploadedSchemeFiles) || uploadedSchemeFiles.length === 0))) {
            res.status(400).json({ error: 'Missing required parameters: sessionId and either paperTitle or uploadedSchemeFiles are required.' });
            return;
        }

        // Setup SSE Headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        sendSseUpdate(res, { type: 'connected', message: 'Connection established', sessionId });

        const heartbeat = setInterval(() => {
            res.write(':\n\n');
        }, 15000);

        try {
            let requestedModel = model;
            if (!requestedModel || requestedModel.toUpperCase() === 'AUTO') {
                requestedModel = 'FAST';
            }

            const options = {
                sessionId,
                paperTitle,
                questionNumber: questionNumber || null,
                uploadedSchemeFiles: Array.isArray(uploadedSchemeFiles) ? uploadedSchemeFiles : undefined,
                model: requestedModel,
                userId: (req as any).user?.uid,
                aiMessageId
            };

            let completeEventSent = false;
            const progressCallback = (data: any) => {
                if (data?.type === 'complete') {
                    completeEventSent = true;
                }
                sendSseUpdate(res, data);
            };

            const result = await MarkingPipelineService.executeRemarkPipeline(
                req,
                options,
                progressCallback,
                usageTracker
            );

            if (result && !completeEventSent) {
                sendSseUpdate(res, { type: 'complete', result });
                completeEventSent = true;
            }

            res.end();
        } catch (error: any) {
            console.error('❌ [CONTROLLER] Remark request failed:', error);
            const isCreditExhausted = error.message?.includes('exhausted your credits');
            const isInvalidScheme = error.message?.includes('INVALID_MARKING_SCHEME');
            if (!isCreditExhausted && !isInvalidScheme) {
                void AdminAlertService.notifyCrash('MARKING', req, error);
            }
            sendSseUpdate(res, {
                type: 'error',
                error: error.message?.replace(/^INVALID_MARKING_SCHEME:\s*/i, '') || 'Failed to re-mark session.'
            });
            res.end();
        } finally {
            clearInterval(heartbeat);
        }
    }

    /**
     * Proxies image download to bypass CORS and force attachment
     */
    public static async downloadImage(req: Request, res: Response): Promise<void> {
        const imageUrl = req.query.url as string;
        let filename = req.query.filename as string || 'download-image.jpg';

        // Never proxy an image with a .pdf extension
        if (filename.toLowerCase().endsWith('.pdf')) {
            filename = filename.replace(/\.pdf$/i, '.jpg');
        }

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

        // Track critical IDs and completion state for credit deduction
        let finalUserId: string | null = null;
        let finalSessionId: string | null = null;
        let finalModel: string = 'gemini-3.7-flash';
        let shouldDeductCredits = false;

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

        let sessionId = req.body.sessionId;
        // Sanitization: Reject temp- IDs from frontend
        if (sessionId && sessionId.startsWith('temp-')) {
            console.log(`⚠️ [MARKING] Rejecting temp session ID: ${sessionId}`);
            sessionId = undefined;
        }

        const submissionId = req.body.submissionId || sessionId || `sub-${Date.now()}`;
        if (!sessionId) {
            sessionId = submissionId;
        }

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
            // 3. Prepare Options
            let requestedModel = req.body.model;
            if (!requestedModel || requestedModel.toUpperCase() === 'AUTO') {
                requestedModel = 'FAST';
            }

            // Enforce Plan Limits: Only allowed plans can select custom models
            const userPlan = (req as any).userPlan || 'free';
            const isDefaultFast = (requestedModel || '').toUpperCase() === 'FAST';
            if (!hasPermission(userPlan, PERMISSIONS.MODEL_SELECTION_PLANS) && !isDefaultFast) {
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
                model: requestedModel,
                allowGenericSubjectMarking: req.body.allowGenericSubjectMarking === true || req.body.allowGenericSubjectMarking === 'true'
            };

            const userId = options.userId;
            if (userId) {
                AdminAlertService.markUserActive(userId);
            }
            
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
            let completeEventSent = false;
            const progressCallback = (data: any) => {
                if (data?.type === 'complete') {
                    completeEventSent = true;
                }
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

            const warningCode = (result as any)?.warning || (result as any)?.submissionResult?.warning;
            const isRejectedOrEmpty = warningCode === 'CONTENT_REJECTED' ||
                warningCode === 'NOT_MATHS_CONTENT' ||
                warningCode === 'COVER_PAGE_ONLY' ||
                warningCode === 'NO_STUDENT_WORK';

            if (result && result.sessionId && !isRejectedOrEmpty) {
                shouldDeductCredits = true;
            }

            console.log(`✅ [CONTROLLER] Pipeline completed, result exists: ${!!result}, sessionId: ${result?.sessionId}`);

            // 6. Handle Completion (guarantee 'complete' event was sent before closing stream)
            if (result && !completeEventSent) {
                sendSseUpdate(res, { type: 'complete', result });
                completeEventSent = true;
            }

            // --- NEW: Increment Guest Usage ---
            if (!isAuthenticated && shouldDeductCredits) {
                await GuestUsageService.incrementUsage(userIP);
            }

            res.end();

        } catch (error: any) {
            console.error(`❌ [CONTROLLER] Marking request failed: ${error.message}`);
            
            const isCreditExhausted = error.message?.includes('exhausted your credits');
            const isLegacyUserFixable =
                error.message?.includes('PDF_UNREADABLE') ||
                error.message?.includes('Postscript delegate failed') ||
                error.message?.includes('exceeds the maximum limit') ||
                error.message?.includes('limited to grading');

            const shouldAlertAdmin = !isCreditExhausted && (
                error instanceof UserFacingError
                    ? error.shouldAlertAdmin
                    : !isLegacyUserFixable
            );

            if (shouldAlertAdmin) {
                void AdminAlertService.notifyCrash('MARKING', req, error);
            }

            if (isCreditExhausted) {
                if (!res.headersSent) {
                    res.setHeader('Content-Type', 'text/event-stream');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.setHeader('Connection', 'keep-alive');
                    res.status(200);
                }
                const errorPayload = JSON.stringify({
                    type: 'error',
                    error: error.message,
                    credits_exhausted: true
                });
                res.write(`data: ${errorPayload}\n\n`);
                res.end();
                return;
            }
            
            // Safely extract IDs to tie the response back to the user's UI
            const aiMessageId = req.body?.aiMessageId || `ai-${Date.now()}`;
            const resolvedSessionId = finalSessionId || sessionId;

            // 2-Bucket non-technical error message for the UI
            let displayMessage = `We couldn't complete marking your work due to a temporary technical issue on our end.\n\nPlease try again in a moment — **no credits were deducted**.`;

            if (error instanceof UserFacingError) {
                displayMessage = error.userMessage;
            } else if (error.message?.includes('PDF_UNREADABLE') || error.message?.includes('Postscript delegate failed')) {
                displayMessage = `We couldn't read this PDF because it appears corrupted, password-protected, or in an unsupported format.\n\n**How to fix:** Open the file, choose **Print → Save as PDF**, and upload the new file.`;
            } else if (isLegacyUserFixable) {
                displayMessage = error.message.replace(/^PDF_PAGE_LIMIT_EXCEEDED:\s*/i, '');
            }

            const userTimestamp = new Date().toISOString();
            const aiTimestamp = new Date(Date.now() + 50).toISOString();
            const aiErrorMessage = {
                id: aiMessageId,
                role: 'assistant',
                content: displayMessage,
                timestamp: aiTimestamp,
                type: 'text',
                isProcessing: false,
                processingStats: {
                    apiUsed: 'System Validation',
                    modelUsed: 'Pre-flight Check'
                }
            };

            // Persist the failed upload attempt (with PDF/image attachment metadata) + friendly error to Firestore
            if (finalUserId && finalUserId !== 'anonymous' && resolvedSessionId) {
                try {
                    const uploadResult = await SessionManagementService.uploadOriginalFiles(
                        files,
                        finalUserId,
                        resolvedSessionId,
                        true
                    );

                    const pdfFiles = files
                        .map((file, idx) => ({ file, idx }))
                        .filter(entry => entry.file.mimetype === 'application/pdf');
                    const isSinglePdf = files.length === 1 && pdfFiles.length === 1;
                    const isMultiplePdfs = pdfFiles.length > 1 || (pdfFiles.length >= 1 && files.length > 1);

                    let pdfContext: any = undefined;
                    if (isSinglePdf) {
                        pdfContext = {
                            isMultiplePdfs: false,
                            originalPdfLink: uploadResult.originalImageLinks[0] || null,
                            originalFileName: files[0].originalname || 'document.pdf',
                            fileSize: files[0].size || 0
                        };
                    } else if (isMultiplePdfs) {
                        pdfContext = {
                            isMultiplePdfs: true,
                            pdfContexts: pdfFiles.map(({ file, idx }) => ({
                                originalPdfLink: uploadResult.originalImageLinks[idx] || null,
                                originalFileName: file.originalname || `document-${idx + 1}.pdf`,
                                fileSize: file.size || 0
                            }))
                        };
                    }

                    const { structuredImageDataArray, structuredPdfContexts } = SessionManagementService.createStructuredData(
                        files,
                        isSinglePdf,
                        isMultiplePdfs,
                        pdfContext
                    );

                    const userUploadMessage = SessionManagementService.createUserMessageForDatabase(
                        {
                            content: req.body?.customText || '',
                            files,
                            isPdf: isSinglePdf,
                            isMultiplePdfs,
                            customText: req.body?.customText,
                            sessionId: resolvedSessionId,
                            model: finalModel,
                            pdfContext
                        },
                        structuredImageDataArray,
                        structuredPdfContexts,
                        uploadResult.originalImageLinks
                    );
                    userUploadMessage.timestamp = userTimestamp;

                    const existingSession = await FirestoreService.getUnifiedSession(resolvedSessionId);
                    if (existingSession) {
                        await FirestoreService.addMessageToUnifiedSession(resolvedSessionId, userUploadMessage, 'Marking');
                        await FirestoreService.addMessageToUnifiedSession(resolvedSessionId, aiErrorMessage, 'Marking');
                    } else {
                        await FirestoreService.createUnifiedSessionWithMessages({
                            sessionId: resolvedSessionId,
                            title: 'Upload Issue',
                            userId: finalUserId,
                            messageType: 'Marking',
                            messages: [userUploadMessage, aiErrorMessage],
                            usageMode: 'Marking'
                        });
                    }
                } catch (persistErr) {
                    console.error('⚠️ [CONTROLLER] Failed to persist error state to Firestore:', persistErr);
                }
            }

            // 🛑 THE FIX: Wrap the error as a successful AI chat message so it renders gracefully in the UI
            const gracefulPayload = JSON.stringify({
                type: 'complete',
                result: {
                    success: true, // Force true so the frontend renders it instead of throwing a JS exception
                    sessionId: resolvedSessionId,
                    sessionTitle: "Upload Issue",
                    aiMessage: aiErrorMessage
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
            
            // 🛑 TRANSACTION-SAFE CREDIT DEDUCTION: Only deduct credits when the pipeline succeeded without crashing or rejecting content
            try {
                const finalCost = usageTracker.calculateCost(finalModel).total;
                
                if (shouldDeductCredits && finalCost > 0 && finalUserId && finalUserId !== 'anonymous') {
                    console.log(`💳 [CREDIT DEDUCT] Calculating final cost: $${finalCost} for user ${finalUserId}`);
                    await deductCredits(finalUserId, finalCost, finalSessionId || 'unknown');
                    console.log(`💳 ✅ Successfully deducted $${finalCost} from user ${finalUserId}`);
                } else if (finalCost > 0) {
                    console.log(`⏭️  [CREDIT DEDUCT] Skipped deduction for user ${finalUserId || 'anonymous'} (shouldDeductCredits=${shouldDeductCredits}, Cost: $${finalCost})`);
                }
            } catch (deductionError) {
                console.error('❌ CRITICAL: Failed to deduct credits during cleanup:', deductionError);
            }
        }
    }
}
