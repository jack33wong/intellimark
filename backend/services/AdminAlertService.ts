import nodemailer, { type Transporter } from 'nodemailer';
import type { Request } from 'express';
import admin from 'firebase-admin';
import { getStorage, getFirebaseAuth, getFirestore } from '../config/firebase.js';

export interface FunnelEventLog {
  event: string;
  timestamp: string;
  path?: string;
  metadata?: any;
}

export type AlertFeature = 'MARKING' | 'FOLLOW_UP_CHAT' | 'MODEL_ANSWER' | 'MARKING_SCHEME';

export type SessionTurnType = 'MARKING' | 'QUESTION_MODE' | 'REMARK' | 'FOLLOW_UP_CHAT';

export interface SessionDigestUploadedFile {
  filename: string;
  url: string;
  sizeBytes?: number;
}

export interface SessionDigestTurn {
  turnType: SessionTurnType;
  timestamp: string;
  submissionId?: string;
  model: string;
  durationMs: number;
  status: 'OK' | 'FAILED';
  errorMessage?: string;
  scoreText?: string;
  questionBreakdown?: string[];
  userInput?: string;
  aiResponse?: string;
  logsText: string;
  lineCount: number;
  truncated?: boolean;
}

interface SessionDigestEntry {
  sessionId: string;
  userId: string;
  userEmail?: string;
  sessionTitle: string;
  createdAt: string;
  lastActivityAt: string;
  turns: SessionDigestTurn[];
  uploadedFiles: SessionDigestUploadedFile[];
  timer: NodeJS.Timeout;
  expiresAt: number;
}

const INACTIVITY_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes
const DEFAULT_SESSION_DIGEST_IDLE_MS = 5 * 60 * 1000; // 5 minutes
const MAX_SESSION_DIGESTS_IN_MEMORY = 500;

export class AdminAlertService {
  // Track recent funnel events per anonymousId or userId (capped to prevent memory leaks)
  private static funnelHistory = new Map<string, FunnelEventLog[]>();
  // Map userId to associated anonymousId to link funnel trails
  private static userToAnonMap = new Map<string, string>();
  // Track 3-minute inactivity timers for newly signed-up users
  private static signupTimers = new Map<string, { timer: NodeJS.Timeout; expiresAt: number }>();
  // Track idle-timeout session digests (keyed by sessionId)
  private static sessionDigests = new Map<string, SessionDigestEntry>();

  private static transporter: Transporter | null = null;

  private static getSessionDigestIdleMs(): number {
    const parsed = parseInt(process.env.MARKING_LOG_IDLE_TIMEOUT_MS || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SESSION_DIGEST_IDLE_MS;
  }

  private static getTransporter(): Transporter | null {
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = parseInt(process.env.SMTP_PORT || '465', 10);
    const user = process.env.SMTP_USER || process.env.EMAIL_USER;
    const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;
    const adminEmail = process.env.ADMIN_ALERT_EMAIL;

    if (!user || !pass || !adminEmail || user.includes('your-smtp-user') || adminEmail.includes('your-admin-email')) {
      console.warn('⚠️ [ADMIN-ALERT] SMTP credentials or ADMIN_ALERT_EMAIL not configured. Email notification skipped.');
      return null;
    }

    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: {
          user,
          pass,
        },
      });
    }

    return this.transporter;
  }

  /**
   * Sweep any timers that expired while Cloud Run CPU was throttled between requests
   */
  private static sweepExpiredTimers(): void {
    const now = Date.now();
    for (const [uid, entry] of this.signupTimers.entries()) {
      if (now >= entry.expiresAt) {
        clearTimeout(entry.timer);
        this.signupTimers.delete(uid);
        void this.handleUserInactivity(uid);
      }
    }
    for (const [sid, digest] of this.sessionDigests.entries()) {
      if (now >= digest.expiresAt) {
        clearTimeout(digest.timer);
        this.sessionDigests.delete(sid);
        void this.flushSessionDigestEntry(digest);
      }
    }
  }

  /**
   * Record telemetry funnel events from the client
   */
  public static recordTelemetryEvent(
    anonymousId?: string,
    userId?: string,
    event?: string,
    path?: string,
    metadata?: any,
    userAgent?: string
  ): void {
    try {
      this.sweepExpiredTimers();

      const now = new Date().toISOString();
      const logEntry: FunnelEventLog = {
        event: event || 'unknown',
        timestamp: now,
        ...(path ? { path } : {}),
        ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
      };

      if (userId && anonymousId) {
        this.userToAnonMap.set(userId, anonymousId);
      }

      // If user initiates an upload on the client, mark them active immediately
      // Note: Do NOT cancel the 3-minute inactivity timer on subscription=success or plan upgrades;
      // only cancel when the user performs an actual core action.
      if (userId && event === 'upload_initiated') {
        this.markUserActive(userId);
      }

      if (process.env.LOG_FUNNEL === 'true' && event === 'marking_engagement_summary' && metadata) {
        console.log(
          `📖 [ENGAGEMENT] user=${userId || anonymousId || 'guest'} | session=${metadata.sessionId} | activeTime=${metadata.totalActiveSec}s | pagesViewed=${metadata.uniquePagesViewed}/${metadata.totalPages} (${metadata.coveragePct}%) | splitMode=${metadata.openedSplitMode} | navClicks=${metadata.questionNavClicks} | dwell=${JSON.stringify(metadata.pageDwellSec || {})}`
        );
      }

      const keysToUpdate = [anonymousId, userId].filter(
        (id): id is string => !!id && id !== 'guest' && id !== 'anonymous'
      );

      for (const id of keysToUpdate) {
        const history = this.funnelHistory.get(id) || [];
        history.push(logEntry);
        if (history.length > 30) {
          history.shift();
        }
        this.funnelHistory.set(id, history);
      }

      // Memory safeguard: keep max 1000 sessions in history
      if (this.funnelHistory.size > 1000) {
        const oldestKey = this.funnelHistory.keys().next().value;
        if (oldestKey) this.funnelHistory.delete(oldestKey);
      }

      // Fire-and-forget Firestore persistence so multi-instance Cloud Run alerts never miss events
      void this.persistTelemetryEvent(keysToUpdate, logEntry, userId, anonymousId, userAgent);
    } catch (err) {
      console.error('⚠️ [ADMIN-ALERT] Failed to record telemetry event:', err);
    }
  }

  /**
   * Fire-and-forget write of funnel event to Firestore for cross-instance Cloud Run visibility
   */
  private static async persistTelemetryEvent(
    keysToUpdate: string[],
    logEntry: FunnelEventLog,
    userId?: string,
    anonymousId?: string,
    userAgent?: string
  ): Promise<void> {
    if (keysToUpdate.length === 0) return;
    try {
      const db = getFirestore();
      if (!db) return;

      const expireAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await Promise.all(
        keysToUpdate.map((id) => {
          const payload: Record<string, any> = {
            events: admin.firestore.FieldValue.arrayUnion(logEntry),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            expireAt,
          };
          if (userId && anonymousId && id === userId) {
            payload.linkedAnonId = anonymousId;
          }
          if (userAgent) {
            payload.userAgent = userAgent;
          }
          return db.collection('funnelTrails').doc(id).set(payload, { merge: true });
        })
      );
    } catch {
      // Non-critical telemetry persistence must never throw
    }
  }

  /**
   * Retrieve combined funnel history for a user
   */
  public static getRecentFunnelHistory(identifier: string): FunnelEventLog[] {
    const directHistory = this.funnelHistory.get(identifier) || [];
    const anonId = this.userToAnonMap.get(identifier);
    const anonHistory = anonId ? (this.funnelHistory.get(anonId) || []) : [];

    // Merge and deduplicate by timestamp + event
    const combined = [...anonHistory, ...directHistory];
    const seen = new Set<string>();
    const deduplicated: FunnelEventLog[] = [];

    for (const item of combined) {
      const key = `${item.timestamp}_${item.event}_${item.path || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(item);
      }
    }

    deduplicated.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return deduplicated.slice(-20);
  }

  /**
   * Retrieve combined funnel history for a user (in-memory + Firestore across Cloud Run instances)
   */
  public static async getPersistedFunnelHistory(
    identifier: string
  ): Promise<{ events: FunnelEventLog[]; userAgent?: string }> {
    const localEvents = this.getRecentFunnelHistory(identifier);
    let userAgent: string | undefined;
    const remoteEvents: FunnelEventLog[] = [];

    try {
      const db = getFirestore();
      if (db && identifier && identifier !== 'guest' && identifier !== 'anonymous') {
        const userDoc = await db.collection('funnelTrails').doc(identifier).get();
        if (userDoc.exists) {
          const data = userDoc.data();
          if (Array.isArray(data?.events)) {
            remoteEvents.push(...data.events);
          }
          if (typeof data?.userAgent === 'string') {
            userAgent = data.userAgent;
          }
          const linkedAnonId = data?.linkedAnonId || this.userToAnonMap.get(identifier);
          if (linkedAnonId && linkedAnonId !== identifier) {
            const anonDoc = await db.collection('funnelTrails').doc(linkedAnonId).get();
            if (anonDoc.exists) {
              const anonData = anonDoc.data();
              if (Array.isArray(anonData?.events)) {
                remoteEvents.push(...anonData.events);
              }
              if (!userAgent && typeof anonData?.userAgent === 'string') {
                userAgent = anonData.userAgent;
              }
            }
          }
        }
      }
    } catch {
      // Fall back to local in-memory history
    }

    const combined = [...remoteEvents, ...localEvents];
    const seen = new Set<string>();
    const deduplicated: FunnelEventLog[] = [];

    for (const item of combined) {
      const key = `${item.timestamp}_${item.event}_${item.path || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(item);
      }
    }

    deduplicated.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return { events: deduplicated.slice(-20), userAgent };
  }

  /**
   * Start 3-minute watch timer when a new user signs up
   */
  public static startNewUserWatchTimer(userId: string): void {
    if (!userId || userId === 'guest' || userId === 'anonymous') return;

    this.sweepExpiredTimers();

    // If timer already active, avoid duplicating
    if (this.signupTimers.has(userId)) return;

    console.log(`⏱️ [ADMIN-ALERT] Started 3-minute inactivity watcher for new user: ${userId}`);

    const expiresAt = Date.now() + INACTIVITY_THRESHOLD_MS;
    const timer = setTimeout(async () => {
      this.signupTimers.delete(userId);
      await this.handleUserInactivity(userId);
    }, INACTIVITY_THRESHOLD_MS);

    this.signupTimers.set(userId, { timer, expiresAt });
  }

  /**
   * Clear watch timer when user performs any core action
   */
  public static markUserActive(userId?: string): void {
    if (!userId || userId === 'guest' || userId === 'anonymous') return;

    const entry = this.signupTimers.get(userId);
    if (entry) {
      clearTimeout(entry.timer);
      this.signupTimers.delete(userId);
      console.log(`✅ [ADMIN-ALERT] User ${userId} became active. Inactivity watcher cancelled.`);
    }
  }

  /**
   * Cross-instance check: Verify in Firestore that the user hasn't created a session
   * or used credits on a different Cloud Run container instance.
   */
  private static async hasUserBeenActiveInFirestore(userId: string): Promise<boolean> {
    try {
      const db = getFirestore();
      if (!db) return false;

      // 1. Check if any unifiedSession exists for this user
      const sessionSnap = await db
        .collection('unifiedSessions')
        .where('userId', '==', userId)
        .limit(1)
        .get();

      if (!sessionSnap.empty) {
        return true;
      }

      // 2. Check if user has spent any credits
      const creditDoc = await db.collection('userCredits').doc(userId).get();
      if (creditDoc.exists) {
        const data = creditDoc.data();
        if (data && typeof data.usedCredits === 'number' && data.usedCredits > 0) {
          return true;
        }
      }

      return false;
    } catch (err) {
      console.warn('⚠️ [ADMIN-ALERT] Firestore activity check failed, proceeding with local state:', err);
      return false;
    }
  }

  /**
   * Handler when 3 minutes elapse with zero activity from a new user
   */
  private static async handleUserInactivity(userId: string): Promise<void> {
    try {
      // Guard against multi-instance false positives on Cloud Run
      const activeElsewhere = await this.hasUserBeenActiveInFirestore(userId);
      if (activeElsewhere) {
        console.log(`✅ [ADMIN-ALERT] User ${userId} was active on another Cloud Run instance. Skipping inactivity alert.`);
        return;
      }

      console.warn(`⚠️ [ADMIN-ALERT] New user ${userId} remained inactive for 3 minutes after signup.`);

      let userEmail: string | undefined;
      try {
        const auth = getFirebaseAuth();
        if (auth) {
          const userRecord = await auth.getUser(userId);
          userEmail = userRecord.email;
        }
      } catch (authErr) {
        // Ignore user lookup error
      }

      const { events: funnel, userAgent } = await this.getPersistedFunnelHistory(userId);
      const funnelHtml = funnel.length > 0
        ? `<ul>${funnel.map(f => `<li><strong>${f.timestamp}</strong>: <code>${f.event}</code> (path: ${f.path || '/'}) ${f.metadata ? `<pre style="font-size:11px">${JSON.stringify(f.metadata)}</pre>` : ''}</li>`).join('')}</ul>`
        : '<p><em>No client funnel events recorded.</em></p>';

      const funnelText = funnel.length > 0
        ? funnel.map(f => `[${f.timestamp}] ${f.event} (${f.path || '/'}) - ${JSON.stringify(f.metadata || {})}`).join('\n')
        : 'No client funnel events recorded.';

      const transporter = this.getTransporter();
      if (!transporter) return;

      const adminEmail = process.env.ADMIN_ALERT_EMAIL;
      const appUrl = process.env.FRONTEND_URL || 'https://aimarking.ai';

      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@aimarking.ai',
        to: adminEmail,
        subject: `⚠️ [NEW USER INACTIVITY] User ${userEmail || userId} had no activity within 3 min`,
        text: `New User Inactivity Alert

User ID: ${userId}
Email: ${userEmail || 'Unknown'}
Device / UA: ${userAgent || 'Unknown'}
Platform: ${appUrl}
Time: ${new Date().toISOString()}

This new user created/initialized an account but performed no core action (no marking, no follow-up chat, no model answer, no marking scheme) within 3 minutes of registration.

Pre-inactivity Funnel Trail:
${funnelText}
`,
        html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; line-height: 1.5; color: #333;">
  <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 16px; border-radius: 4px; margin-bottom: 20px;">
    <h2 style="margin: 0 0 8px 0; color: #856404; font-size: 20px;">⚠️ New User Inactivity Alert</h2>
    <p style="margin: 0; color: #856404; font-size: 14px;">A new user initialized their account but took no action within 3 minutes.</p>
  </div>

  <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
    <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; width: 140px; font-weight: bold;">User ID:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><code>${userId}</code></td></tr>
    <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Email:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${userEmail || '<em>Unknown</em>'}</td></tr>
    <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Device / UA:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #555;">${userAgent || '<em>Unknown</em>'}</td></tr>
    <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Detected At:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${new Date().toISOString()}</td></tr>
    <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Threshold:</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">3 minutes without marking, model answer, or chat</td></tr>
  </table>

  <h3 style="font-size: 16px; margin: 20px 0 10px 0; border-bottom: 2px solid #eee; padding-bottom: 6px;">Client Funnel History</h3>
  ${funnelHtml}
</div>
`
      });

      console.log(`📧 [ADMIN-ALERT] Sent inactivity alert for user ${userId} to ${adminEmail}`);
    } catch (err) {
      console.error('❌ [ADMIN-ALERT] Failed to send user inactivity alert email:', err);
    }
  }

  /**
   * Upload Multer files to GCS and generate 7-day signed download URLs
   */
  private static async uploadMulterFilesToGcs(
    files: Express.Multer.File[],
    userId: string,
    gcsPrefix: string
  ): Promise<Array<{ filename: string; signedUrl: string; sizeBytes: number }>> {
    const uploadedLinks: Array<{ filename: string; signedUrl: string; sizeBytes: number }> = [];

    try {
      if (!files || files.length === 0) return uploadedLinks;

      const storage = getStorage();
      const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'intellimark-6649e.firebasestorage.app';
      const bucket = storage.bucket(bucketName);

      const dateStr = new Date().toISOString().split('T')[0];
      const timestamp = Date.now();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file?.buffer || file.buffer.length === 0) continue;

        const sanitizedName = (file.originalname || `upload_${i}.dat`).replace(/[^a-zA-Z0-9._-]/g, '_');
        const gcsPath = `${gcsPrefix}/${dateStr}/${timestamp}_${i}_${sanitizedName}`;
        const fileRef = bucket.file(gcsPath);

        await fileRef.save(file.buffer, {
          contentType: file.mimetype || 'application/octet-stream',
          metadata: {
            metadata: {
              uploadedBy: userId,
              originalName: file.originalname || 'unknown',
              uploadedAt: new Date().toISOString(),
            }
          }
        });

        // 7-day signed download URL
        const [signedUrl] = await fileRef.getSignedUrl({
          action: 'read',
          expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
        });

        uploadedLinks.push({
          filename: file.originalname || sanitizedName,
          signedUrl,
          sizeBytes: file.size || file.buffer.length,
        });
      }
    } catch (storageErr) {
      console.error(`⚠️ [ADMIN-ALERT] Failed to upload ${gcsPrefix} files to GCS:`, storageErr);
    }

    return uploadedLinks;
  }

  /**
   * Upload request files to GCS and generate 7-day signed download URLs (for crash alerts)
   */
  private static async uploadFilesForCrash(
    req: Request,
    userId: string
  ): Promise<Array<{ filename: string; signedUrl: string; sizeBytes: number }>> {
    const files: Express.Multer.File[] = [];

    if (req.file) {
      files.push(req.file);
    }
    if (req.files) {
      if (Array.isArray(req.files)) {
        files.push(...req.files);
      } else {
        for (const key of Object.keys(req.files)) {
          files.push(...(req.files[key] || []));
        }
      }
    }

    return this.uploadMulterFilesToGcs(files, userId, 'crashes');
  }

  /**
   * Upload Multer files to GCS for session digest logs when no Firebase Storage URLs exist (e.g. guest users)
   */
  public static async uploadFilesForLog(
    files: Express.Multer.File[],
    userId: string
  ): Promise<SessionDigestUploadedFile[]> {
    const uploaded = await this.uploadMulterFilesToGcs(files, userId, 'marking-logs');
    return uploaded.map((item) => ({
      filename: item.filename,
      url: item.signedUrl,
      sizeBytes: item.sizeBytes,
    }));
  }

  /**
   * Upload a base64 data URL or raw base64 image to GCS for session digest logs (e.g. guest follow-up image)
   */
  public static async uploadBase64ImageForLog(
    imageData: string,
    userId: string,
    filename = 'follow-up-image.jpg'
  ): Promise<SessionDigestUploadedFile | null> {
    try {
      if (!imageData || typeof imageData !== 'string') return null;

      let mimeType = 'image/jpeg';
      let base64Body = imageData;
      const match = imageData.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1] || 'image/jpeg';
        base64Body = match[2];
      }

      const buffer = Buffer.from(base64Body, 'base64');
      if (!buffer || buffer.length === 0) return null;

      const ext = mimeType.split('/')[1]?.split('+')[0] || 'jpg';
      const resolvedName = filename.includes('.') ? filename : `${filename}.${ext}`;
      const fakeFile = {
        originalname: resolvedName,
        mimetype: mimeType,
        buffer,
        size: buffer.length,
      } as Express.Multer.File;

      const uploaded = await this.uploadFilesForLog([fakeFile], userId);
      return uploaded[0] || null;
    } catch (err) {
      console.error('⚠️ [ADMIN-ALERT] Failed to upload base64 image for log:', err);
      return null;
    }
  }

  /**
   * Extract already-uploaded Firebase Storage URLs from a marking/question-mode pipeline result
   */
  public static extractUploadedFileLinksFromResult(result: any): SessionDigestUploadedFile[] {
    const links: SessionDigestUploadedFile[] = [];
    const seenUrls = new Set<string>();

    const addLink = (url?: string, filename?: string) => {
      if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url) || seenUrls.has(url)) return;
      seenUrls.add(url);
      links.push({
        filename: filename || 'Uploaded File',
        url,
      });
    };

    const messages: any[] =
      result?.unifiedSession?.messages ||
      result?.submissionResult?.unifiedSession?.messages ||
      [];

    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (!msg || msg.role !== 'user') continue;
        if (Array.isArray(msg.pdfContexts)) {
          for (const ctx of msg.pdfContexts) {
            addLink(ctx?.url || ctx?.originalPdfLink, ctx?.originalFileName || 'document.pdf');
          }
        }
        if (Array.isArray(msg.imageDataArray)) {
          msg.imageDataArray.forEach((item: any, idx: number) => {
            addLink(item?.url, item?.originalFileName || `image-${idx + 1}.jpg`);
          });
        }
        if (msg.imageLink) {
          addLink(msg.imageLink, 'uploaded-file');
        }
      }
    }

    return links;
  }

  /**
   * Main entry point to alert on fatal controller crashes (fire-and-forget)
   */
  public static notifyCrash(feature: AlertFeature, req: Request, error: any): void {
    // Fire-and-forget: execute asynchronously and catch all errors internally
    (async () => {
      try {
        const userId = (req as any).user?.uid || req.body?.userId || 'anonymous';
        const userEmail = (req as any).user?.email;
        const ip = req.ip || req.socket?.remoteAddress || 'unknown';
        const userAgent = req.get('user-agent') || 'unknown';
        const routePath = req.originalUrl || req.url || 'unknown';
        const method = req.method;

        console.error(`🚨 [ADMIN-ALERT] Catch block triggered for ${feature} (user: ${userId}). Generating incident alert...`);

        // Upload any files present in the request to GCS with 7-day signed links
        const uploadedFiles = await this.uploadFilesForCrash(req, userId);

        // Sanitize request body for display (redact tokens/secrets & truncate huge base64 strings)
        const sanitizedBody: Record<string, any> = {};
        if (req.body && typeof req.body === 'object') {
          for (const [key, value] of Object.entries(req.body)) {
            if (/token|password|secret|auth/i.test(key)) {
              sanitizedBody[key] = '[REDACTED]';
            } else if (typeof value === 'string' && value.length > 500) {
              sanitizedBody[key] = `[Truncated string: ${value.substring(0, 100)}... (${value.length} total chars)]`;
            } else {
              sanitizedBody[key] = value;
            }
          }
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : '';

        // Funnel history
        const { events: funnel } = await this.getPersistedFunnelHistory(userId);
        const funnelHtml = funnel.length > 0
          ? `<ul>${funnel.map(f => `<li><strong>${f.timestamp}</strong>: <code>${f.event}</code> (path: ${f.path || '/'})</li>`).join('')}</ul>`
          : '<p><em>No recent funnel events recorded.</em></p>';

        const fileLinksHtml = uploadedFiles.length > 0
          ? `<ul>${uploadedFiles.map(f => `<li><a href="${f.signedUrl}" target="_blank" style="color: #0066cc; font-weight: bold;">Download ${f.filename}</a> (${(f.sizeBytes / (1024 * 1024)).toFixed(2)} MB) - Valid for 7 days</li>`).join('')}</ul>`
          : '<p><em>No files attached to this request.</em></p>';

        const fileLinksText = uploadedFiles.length > 0
          ? uploadedFiles.map(f => `- ${f.filename} (${(f.sizeBytes / (1024 * 1024)).toFixed(2)} MB): ${f.signedUrl}`).join('\n')
          : 'No files attached to this request.';

        const transporter = this.getTransporter();
        if (!transporter) return;

        const adminEmail = process.env.ADMIN_ALERT_EMAIL;

        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@aimarking.ai',
          to: adminEmail,
          subject: `🚨 [CRITICAL ALERT] ${feature} Failed: ${errorMessage.substring(0, 80)}`,
          text: `🚨 CRITICAL CONTROLLER CRASH ALERT

Feature: ${feature}
Time: ${new Date().toISOString()}
Route: ${method} ${routePath}
User ID: ${userId}
Email: ${userEmail || 'Unknown'}
IP: ${ip}
User Agent: ${userAgent}

Error:
${errorMessage}

Stack Trace:
${errorStack || 'No stack trace available'}

Uploaded Files (7-Day Download Links):
${fileLinksText}

Request Body:
${JSON.stringify(sanitizedBody, null, 2)}

Recent Funnel Events:
${funnel.map(f => `[${f.timestamp}] ${f.event} (${f.path || '/'})`).join('\n')}
`,
          html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 750px; margin: 0 auto; line-height: 1.5; color: #222;">
  <div style="background: #f8d7da; border-left: 5px solid #dc3545; padding: 16px; border-radius: 4px; margin-bottom: 20px;">
    <h2 style="margin: 0 0 6px 0; color: #721c24; font-size: 20px;">🚨 Fatal Crash: ${feature}</h2>
    <p style="margin: 0; color: #721c24; font-weight: bold; font-size: 15px;">${errorMessage}</p>
  </div>

  <h3 style="font-size: 16px; margin: 20px 0 8px 0; border-bottom: 1px solid #ddd; padding-bottom: 4px;">Request & User Details</h3>
  <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 15px;">
    <tr><td style="padding: 6px 0; font-weight: bold; width: 130px;">Feature:</td><td><span style="background: #e2e3e5; padding: 2px 6px; border-radius: 3px; font-weight: bold;">${feature}</span></td></tr>
    <tr><td style="padding: 6px 0; font-weight: bold;">User ID:</td><td><code>${userId}</code> ${userEmail ? `(${userEmail})` : ''}</td></tr>
    <tr><td style="padding: 6px 0; font-weight: bold;">Endpoint:</td><td><code>${method} ${routePath}</code></td></tr>
    <tr><td style="padding: 6px 0; font-weight: bold;">IP / Agent:</td><td>${ip} | <span style="font-size: 11px; color: #666;">${userAgent}</span></td></tr>
    <tr><td style="padding: 6px 0; font-weight: bold;">Timestamp:</td><td>${new Date().toISOString()}</td></tr>
  </table>

  <h3 style="font-size: 16px; margin: 20px 0 8px 0; border-bottom: 1px solid #ddd; padding-bottom: 4px;">Uploaded Files (7-Day Signed Links)</h3>
  ${fileLinksHtml}

  <h3 style="font-size: 16px; margin: 20px 0 8px 0; border-bottom: 1px solid #ddd; padding-bottom: 4px;">Error Stack Trace</h3>
  <pre style="background: #f1f1f1; padding: 12px; border-radius: 4px; font-size: 12px; overflow-x: auto; color: #c82333;">${errorStack || errorMessage}</pre>

  <h3 style="font-size: 16px; margin: 20px 0 8px 0; border-bottom: 1px solid #ddd; padding-bottom: 4px;">Request Payload</h3>
  <pre style="background: #f8f9fa; border: 1px solid #e9ecef; padding: 12px; border-radius: 4px; font-size: 12px; overflow-x: auto;">${JSON.stringify(sanitizedBody, null, 2)}</pre>

  <h3 style="font-size: 16px; margin: 20px 0 8px 0; border-bottom: 1px solid #ddd; padding-bottom: 4px;">Recent User Funnel Activity</h3>
  ${funnelHtml}
</div>
`
        });

        console.log(`📧 [ADMIN-ALERT] Crash alert email sent successfully to ${adminEmail}`);
      } catch (alertError) {
        console.error('❌ [ADMIN-ALERT] Failed to send crash notification email:', alertError);
      }
    })().catch(unhandled => {
      console.error('❌ [ADMIN-ALERT] Unhandled error in notifyCrash:', unhandled);
    });
  }

  /**
   * Testing helper: allow unit tests to inject a mock transporter (or reset to null).
   */
  public static setTransporterForTesting(transporter: Transporter | null): void {
    this.transporter = transporter;
  }

  /**
   * Testing/shutdown helper: return number of pending session digests.
   */
  public static getPendingSessionDigestCount(): number {
    return this.sessionDigests.size;
  }

  /**
   * Record a turn (MARKING, QUESTION_MODE, REMARK, or FOLLOW_UP_CHAT) into the
   * idle-timeout session digest for `sessionId`. One combined email is sent
   * after `MARKING_LOG_IDLE_TIMEOUT_MS` (default 5 min) of inactivity.
   */
  public static recordSessionTurn(params: {
    sessionId?: string;
    submissionId?: string;
    turnType: SessionTurnType;
    userId?: string;
    userEmail?: string;
    sessionTitle?: string;
    model?: string;
    result?: any;
    error?: any;
    userInput?: string;
    aiResponse?: string;
    uploadedFiles?: SessionDigestUploadedFile[];
    logsText: string;
    lineCount: number;
    durationMs: number;
    truncated?: boolean;
  }): void {
    try {
      const mode = (process.env.MARKING_LOG_EMAIL_MODE || 'all').toLowerCase();
      if (mode === 'off' || mode === 'false') return;

      this.sweepExpiredTimers();

      const {
        submissionId,
        turnType,
        userId = 'anonymous',
        userEmail,
        model = 'default',
        result,
        error,
        userInput,
        aiResponse,
        uploadedFiles = [],
        logsText,
        lineCount,
        durationMs,
        truncated = false,
      } = params;

      const resolvedSessionId =
        params.sessionId ||
        result?.sessionId ||
        result?.unifiedSession?.id ||
        submissionId ||
        `session-${Date.now()}`;

      // Extract score & paper info safely from pipeline result
      const scoreObj =
        result?.studentScore ||
        result?.submissionResult?.studentScore ||
        result?.aiMessage?.studentScore;
      const metaScore = result?.metadata;
      const scoreText =
        scoreObj?.scoreText ||
        (typeof scoreObj?.awardedMarks === 'number' && typeof scoreObj?.totalMarks === 'number'
          ? `${scoreObj.awardedMarks}/${scoreObj.totalMarks}`
          : typeof metaScore?.totalScore === 'number' && typeof metaScore?.maxScore === 'number' && metaScore.maxScore > 0
            ? `${metaScore.totalScore}/${metaScore.maxScore}`
            : undefined);

      const detectedQ = result?.detectedQuestion || result?.submissionResult?.detectedQuestion;
      const firstPaper = detectedQ?.examPapers?.[0];
      const extractedTitle =
        params.sessionTitle ||
        result?.sessionTitle ||
        result?.unifiedSession?.title ||
        result?.submissionResult?.sessionTitle ||
        result?.paperTitle ||
        (firstPaper
          ? [firstPaper.examBoard, firstPaper.subject, firstPaper.examCode].filter(Boolean).join(' ')
          : '') ||
        '';

      // Extract per-question score breakdown if available
      const qResults: any[] =
        result?.markingResults ||
        result?.questionResults ||
        result?.results ||
        result?.submissionResult?.questionResults ||
        [];
      const questionBreakdown = Array.isArray(qResults)
        ? qResults
            .map((q: any) => {
              const qNum = q?.questionNumber || q?.subQuestion || '?';
              const awarded = q?.studentScore?.awardedMarks ?? q?.awardedMarks;
              const total = q?.studentScore?.totalMarks ?? q?.totalMarks;
              return typeof awarded === 'number' && typeof total === 'number'
                ? `Q${qNum}: ${awarded}/${total}`
                : `Q${qNum}`;
            })
            .filter(Boolean)
        : [];

      const extractedLinks = this.extractUploadedFileLinksFromResult(result);
      const combinedFiles = [...uploadedFiles, ...extractedLinks];

      const nowIso = new Date().toISOString();
      const errorMessage = error ? (error?.message || String(error)) : undefined;

      const turn: SessionDigestTurn = {
        turnType,
        timestamp: nowIso,
        submissionId,
        model,
        durationMs,
        status: error ? 'FAILED' : 'OK',
        errorMessage,
        scoreText,
        questionBreakdown: questionBreakdown.length > 0 ? questionBreakdown : undefined,
        userInput,
        aiResponse,
        logsText,
        lineCount,
        truncated,
      };

      const existing = this.sessionDigests.get(resolvedSessionId);
      const idleMs = this.getSessionDigestIdleMs();
      const expiresAt = Date.now() + idleMs;

      if (existing) {
        clearTimeout(existing.timer);
        existing.lastActivityAt = nowIso;
        if (userId && userId !== 'anonymous') existing.userId = userId;
        if (userEmail) existing.userEmail = userEmail;
        if (extractedTitle && (existing.sessionTitle === 'Marking Session' || existing.sessionTitle === 'Chat Session' || !existing.sessionTitle)) {
          existing.sessionTitle = extractedTitle;
        }
        existing.turns.push(turn);

        // Merge & deduplicate uploaded file links by URL
        const seenUrls = new Set(existing.uploadedFiles.map((f) => f.url));
        for (const f of combinedFiles) {
          if (f?.url && !seenUrls.has(f.url)) {
            seenUrls.add(f.url);
            existing.uploadedFiles.push(f);
          }
        }

        existing.expiresAt = expiresAt;
        existing.timer = setTimeout(() => {
          this.sessionDigests.delete(resolvedSessionId);
          void this.flushSessionDigestEntry(existing);
        }, idleMs);
        existing.timer.unref?.();
      } else {
        // Memory safeguard: if map exceeds cap, flush oldest entry immediately
        if (this.sessionDigests.size >= MAX_SESSION_DIGESTS_IN_MEMORY) {
          const oldestKey = this.sessionDigests.keys().next().value;
          if (oldestKey) {
            const oldestEntry = this.sessionDigests.get(oldestKey);
            if (oldestEntry) {
              clearTimeout(oldestEntry.timer);
              this.sessionDigests.delete(oldestKey);
              void this.flushSessionDigestEntry(oldestEntry);
            }
          }
        }

        const dedupedFiles: SessionDigestUploadedFile[] = [];
        const seenUrls = new Set<string>();
        for (const f of combinedFiles) {
          if (f?.url && !seenUrls.has(f.url)) {
            seenUrls.add(f.url);
            dedupedFiles.push(f);
          }
        }

        const entry: SessionDigestEntry = {
          sessionId: resolvedSessionId,
          userId,
          userEmail,
          sessionTitle: extractedTitle || (turnType === 'FOLLOW_UP_CHAT' ? 'Chat Session' : 'Marking Session'),
          createdAt: nowIso,
          lastActivityAt: nowIso,
          turns: [turn],
          uploadedFiles: dedupedFiles,
          expiresAt,
          timer: setTimeout(() => {
            this.sessionDigests.delete(resolvedSessionId);
            void this.flushSessionDigestEntry(entry);
          }, idleMs),
        };
        entry.timer.unref?.();
        this.sessionDigests.set(resolvedSessionId, entry);
      }

      console.log(`🕒 [ADMIN-ALERT] Recorded ${turnType} turn for session ${resolvedSessionId} (digest idle timeout: ${Math.round(idleMs / 1000)}s)`);
    } catch (err) {
      console.error('❌ [ADMIN-ALERT] Failed to record session turn for digest:', err);
    }
  }

  /**
   * Flush a single session's digest immediately (if pending). Returns true if found and flushed.
   */
  public static async flushSessionDigest(sessionId: string): Promise<boolean> {
    const entry = this.sessionDigests.get(sessionId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.sessionDigests.delete(sessionId);
    await this.flushSessionDigestEntry(entry);
    return true;
  }

  /**
   * Flush all pending session digests immediately (e.g. on graceful shutdown or in tests).
   */
  public static async flushAllSessionDigests(): Promise<number> {
    const entries = Array.from(this.sessionDigests.values());
    for (const entry of entries) {
      clearTimeout(entry.timer);
    }
    this.sessionDigests.clear();
    await Promise.all(entries.map((entry) => this.flushSessionDigestEntry(entry)));
    return entries.length;
  }

  /**
   * Sends the combined idle-timeout session digest email for a completed/idle session.
   */
  private static async flushSessionDigestEntry(entry: SessionDigestEntry): Promise<void> {
    try {
      const mode = (process.env.MARKING_LOG_EMAIL_MODE || 'all').toLowerCase();
      if (mode === 'off' || mode === 'false') return;

      const hasFailure = entry.turns.some((t) => t.status === 'FAILED');
      if (mode === 'errors_only' && !hasFailure) return;

      const transporter = this.getTransporter();
      const adminEmail = process.env.ADMIN_ALERT_EMAIL;
      if (!transporter || !adminEmail) return;

      const totalDurationMs = entry.turns.reduce((sum, t) => sum + (t.durationMs || 0), 0);
      const totalDurationSec = (totalDurationMs / 1000).toFixed(1);
      const totalLines = entry.turns.reduce((sum, t) => sum + (t.lineCount || 0), 0);
      const overallStatus = hasFailure ? 'HAS_ERRORS' : 'OK';
      const includeRawAiResponse = process.env.LOG_AI_MARKING_RESPONSE === 'true';

      const latestScoreTurn = [...entry.turns].reverse().find((t) => t.scoreText && t.scoreText !== 'N/A');
      const scoreSummary = latestScoreTurn?.scoreText ? `${latestScoreTurn.scoreText} | ` : '';
      const modelsUsed = Array.from(new Set(entry.turns.map((t) => t.model).filter(Boolean))).join(', ') || 'default';
      const latestBreakdown = [...entry.turns].reverse().find((t) => t.questionBreakdown && t.questionBreakdown.length > 0)?.questionBreakdown || [];

      const turnLabel = `${entry.turns.length} turn${entry.turns.length === 1 ? '' : 's'}`;
      const emailSubject = `[SESSION DIGEST] ${scoreSummary}${entry.sessionTitle} | ${turnLabel} | ${overallStatus} | ${totalDurationSec}s`;

      const escapeHtml = (str: string) =>
        String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      const filesText =
        entry.uploadedFiles.length > 0
          ? entry.uploadedFiles
              .map((f) => `- ${f.filename}${f.sizeBytes ? ` (${(f.sizeBytes / (1024 * 1024)).toFixed(2)} MB)` : ''}: ${f.url}`)
              .join('\n')
          : 'No uploaded files.';

      const filesHtml =
        entry.uploadedFiles.length > 0
          ? `<ul style="margin: 6px 0; padding-left: 20px;">${entry.uploadedFiles
              .map(
                (f) =>
                  `<li><a href="${escapeHtml(f.url)}" target="_blank" style="color: #0066cc; font-weight: 600;">${escapeHtml(f.filename)}</a>${
                    f.sizeBytes ? ` (${(f.sizeBytes / (1024 * 1024)).toFixed(2)} MB)` : ''
                  }</li>`
              )
              .join('')}</ul>`
          : '<p style="margin: 6px 0; color: #666;"><em>No uploaded files recorded.</em></p>';

      // Build combined .txt attachment across all turns
      const combinedLogsText = entry.turns
        .map((t, idx) => {
          const header = [
            '================================================================================',
            `TURN ${idx + 1}: ${t.turnType} | ${t.timestamp} | Model: ${t.model} | Status: ${t.status} | Duration: ${(t.durationMs / 1000).toFixed(1)}s`,
            t.submissionId ? `Submission ID: ${t.submissionId}` : '',
            t.scoreText ? `Score: ${t.scoreText}` : '',
            t.errorMessage ? `Error: ${t.errorMessage}` : '',
            t.userInput ? `Student Input:\n${t.userInput}` : '',
            includeRawAiResponse && t.aiResponse ? `Raw AI Response:\n${t.aiResponse}` : '',
            '--------------------------------------------------------------------------------',
          ]
            .filter(Boolean)
            .join('\n');
          return `${header}\n${t.logsText || '(No log output captured)'}`;
        })
        .join('\n\n');

      const turnsText = entry.turns
        .map((t, idx) => {
          const tail = (t.logsText ? t.logsText.split('\n').slice(-20).join('\n') : '') || '(No log lines captured)';
          return [
            `--- Turn ${idx + 1}: ${t.turnType} (${t.status}, ${(t.durationMs / 1000).toFixed(1)}s, model=${t.model}) ---`,
            t.scoreText ? `Score: ${t.scoreText}` : '',
            t.errorMessage ? `Error: ${t.errorMessage}` : '',
            t.userInput ? `Input: ${t.userInput}` : '',
            includeRawAiResponse && t.aiResponse ? `AI Response:\n${t.aiResponse}` : '',
            'Tail Log Preview:',
            tail,
          ]
            .filter(Boolean)
            .join('\n');
        })
        .join('\n\n');

      const turnsHtml = entry.turns
        .map((t, idx) => {
          const tail = (t.logsText ? t.logsText.split('\n').slice(-20).join('\n') : '') || '(No log lines captured)';
          const badgeBg = t.status === 'FAILED' ? '#f8d7da' : '#e8f5e9';
          const badgeColor = t.status === 'FAILED' ? '#721c24' : '#1b5e20';
          return `
<div style="border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px; margin-bottom: 14px;">
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
    <strong>Turn ${idx + 1}: ${escapeHtml(t.turnType)}</strong>
    <span style="background: ${badgeBg}; color: ${badgeColor}; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;">
      ${t.status} | ${(t.durationMs / 1000).toFixed(1)}s | ${escapeHtml(t.model)}
    </span>
  </div>
  <div style="font-size: 12px; color: #666; margin-bottom: 6px;">
    Time: ${escapeHtml(t.timestamp)}${t.scoreText ? ` | Score: <strong>${escapeHtml(t.scoreText)}</strong>` : ''} | Log Lines: ${t.lineCount}${t.truncated ? ' (truncated)' : ''}
  </div>
  ${t.errorMessage ? `<div style="color: #721c24; font-weight: 600; font-size: 13px; margin-bottom: 6px;">Error: ${escapeHtml(t.errorMessage)}</div>` : ''}
  ${t.userInput ? `<div style="margin: 6px 0;"><div style="font-size: 12px; font-weight: 600;">Student Input:</div><pre style="background: #f8f9fa; border: 1px solid #e9ecef; padding: 8px; border-radius: 4px; font-size: 12px; white-space: pre-wrap; margin: 4px 0;">${escapeHtml(t.userInput)}</pre></div>` : ''}
  ${includeRawAiResponse && t.aiResponse ? `<div style="margin: 6px 0;"><div style="font-size: 12px; font-weight: 600;">AI Response:</div><pre style="background: #f8f9fa; border: 1px solid #e9ecef; padding: 8px; border-radius: 4px; font-size: 12px; white-space: pre-wrap; margin: 4px 0; max-height: 300px; overflow-y: auto;">${escapeHtml(t.aiResponse)}</pre></div>` : ''}
  <details style="margin-top: 6px;">
    <summary style="cursor: pointer; font-size: 12px; color: #444;">Tail Preview (Last 20 Lines)</summary>
    <pre style="background: #1e1e1e; color: #d4d4d4; padding: 10px; border-radius: 4px; font-size: 11px; overflow-x: auto; white-space: pre-wrap; margin-top: 6px;">${escapeHtml(tail)}</pre>
  </details>
</div>`;
        })
        .join('\n');

      const safeSessionId = String(entry.sessionId || 'session').replace(/[^a-zA-Z0-9_-]/g, '_');

      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: adminEmail,
        subject: emailSubject,
        text: [
          `SESSION DIGEST (${turnLabel})`,
          `Status: ${overallStatus}`,
          `Session ID: ${entry.sessionId}`,
          `User: ${entry.userEmail || entry.userId}`,
          `Session Title: ${entry.sessionTitle}`,
          `Models: ${modelsUsed}`,
          latestScoreTurn?.scoreText ? `Score: ${latestScoreTurn.scoreText}` : '',
          latestBreakdown.length > 0 ? `Questions: ${latestBreakdown.join(', ')}` : '',
          `Total Duration: ${totalDurationSec}s | Total Log Lines: ${totalLines}`,
          `Started: ${entry.createdAt} | Last Activity: ${entry.lastActivityAt}`,
          '',
          'Uploaded Files:',
          filesText,
          '',
          turnsText,
        ]
          .filter(Boolean)
          .join('\n'),
        html: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 820px; margin: 0 auto; color: #222; line-height: 1.5;">
  <div style="background: ${hasFailure ? '#f8d7da' : '#e8f5e9'}; border-left: 5px solid ${hasFailure ? '#dc3545' : '#2e7d32'}; padding: 14px 16px; border-radius: 4px; margin-bottom: 16px;">
    <h2 style="margin: 0 0 4px 0; font-size: 18px; color: ${hasFailure ? '#721c24' : '#1b5e20'};">
      ${hasFailure ? '❌' : '✅'} [SESSION DIGEST] ${escapeHtml(scoreSummary)}${escapeHtml(entry.sessionTitle)}
    </h2>
    <div style="font-size: 13px; color: #444;">
      Turns: <strong>${entry.turns.length}</strong> | Status: <strong>${overallStatus}</strong> | Total Duration: <strong>${totalDurationSec}s</strong> | Total Log Lines: <strong>${totalLines}</strong>
    </div>
  </div>

  <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 16px;">
    <tr><td style="padding: 5px 0; font-weight: bold; width: 130px;">Session ID:</td><td><code>${escapeHtml(entry.sessionId)}</code></td></tr>
    <tr><td style="padding: 5px 0; font-weight: bold;">User:</td><td><code>${escapeHtml(entry.userId)}</code> ${entry.userEmail ? `(${escapeHtml(entry.userEmail)})` : ''}</td></tr>
    <tr><td style="padding: 5px 0; font-weight: bold;">Models:</td><td><code>${escapeHtml(modelsUsed)}</code></td></tr>
    <tr><td style="padding: 5px 0; font-weight: bold;">Activity Window:</td><td>${escapeHtml(entry.createdAt)} → ${escapeHtml(entry.lastActivityAt)}</td></tr>
    ${latestBreakdown.length > 0 ? `<tr><td style="padding: 5px 0; font-weight: bold; vertical-align: top;">Breakdown:</td><td>${escapeHtml(latestBreakdown.join('  |  '))}</td></tr>` : ''}
  </table>

  <h3 style="font-size: 14px; margin: 16px 0 6px 0;">Uploaded Files</h3>
  ${filesHtml}

  <h3 style="font-size: 14px; margin: 18px 0 8px 0;">Session Turns (${entry.turns.length})</h3>
  ${turnsHtml}
</div>`,
        attachments: [
          {
            filename: `session-digest-${safeSessionId}.txt`,
            content: combinedLogsText || '(No log output captured)',
            contentType: 'text/plain; charset=utf-8',
          },
        ],
      });

      console.log(`📧 [ADMIN-ALERT] Session digest email sent for ${entry.sessionId} (${entry.turns.length} turns, ${totalLines} lines, ${totalDurationSec}s)`);
    } catch (emailErr) {
      console.error('❌ [ADMIN-ALERT] Failed to send session digest email:', emailErr);
    }
  }

  /**
   * Backwards-compatible wrapper that records a marking/question/remark turn
   * into the idle-timeout session digest for `sessionId`.
   */
  public static async notifyMarkingLog(params: {
    submissionId: string;
    sessionId?: string;
    userId?: string;
    userEmail?: string;
    model?: string;
    isRemark?: boolean;
    turnType?: SessionTurnType;
    result?: any;
    error?: any;
    userInput?: string;
    aiResponse?: string;
    uploadedFiles?: SessionDigestUploadedFile[];
    logsText: string;
    lineCount: number;
    durationMs: number;
    truncated?: boolean;
  }): Promise<void> {
    const inferredTurnType: SessionTurnType =
      params.turnType ||
      (params.isRemark
        ? 'REMARK'
        : params.result?.mode === 'Question'
          ? 'QUESTION_MODE'
          : 'MARKING');

    this.recordSessionTurn({
      ...params,
      turnType: inferredTurnType,
    });
  }
}
