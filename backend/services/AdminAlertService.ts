import nodemailer, { type Transporter } from 'nodemailer';
import type { Request } from 'express';
import { getStorage, getFirebaseAuth, getFirestore } from '../config/firebase.js';

export interface FunnelEventLog {
  event: string;
  timestamp: string;
  path?: string;
  metadata?: any;
}

export type AlertFeature = 'MARKING' | 'FOLLOW_UP_CHAT' | 'MODEL_ANSWER' | 'MARKING_SCHEME';

const INACTIVITY_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

export class AdminAlertService {
  // Track recent funnel events per anonymousId or userId (capped to prevent memory leaks)
  private static funnelHistory = new Map<string, FunnelEventLog[]>();
  // Map userId to associated anonymousId to link funnel trails
  private static userToAnonMap = new Map<string, string>();
  // Track 3-minute inactivity timers for newly signed-up users
  private static signupTimers = new Map<string, { timer: NodeJS.Timeout; expiresAt: number }>();

  private static transporter: Transporter | null = null;

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
  }

  /**
   * Record telemetry funnel events from the client
   */
  public static recordTelemetryEvent(
    anonymousId?: string,
    userId?: string,
    event?: string,
    path?: string,
    metadata?: any
  ): void {
    try {
      this.sweepExpiredTimers();

      const now = new Date().toISOString();
      const logEntry: FunnelEventLog = {
        event: event || 'unknown',
        timestamp: now,
        path,
        metadata,
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

      if (event === 'marking_engagement_summary' && metadata) {
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
    } catch (err) {
      console.error('⚠️ [ADMIN-ALERT] Failed to record telemetry event:', err);
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

      const funnel = this.getRecentFunnelHistory(userId);
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
   * Upload request files to GCS and generate 7-day signed download URLs
   */
  private static async uploadFilesForCrash(
    req: Request,
    userId: string
  ): Promise<Array<{ filename: string; signedUrl: string; sizeBytes: number }>> {
    const uploadedLinks: Array<{ filename: string; signedUrl: string; sizeBytes: number }> = [];

    try {
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

      if (files.length === 0) return uploadedLinks;

      const storage = getStorage();
      const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'intellimark-6649e.firebasestorage.app';
      const bucket = storage.bucket(bucketName);

      const dateStr = new Date().toISOString().split('T')[0];
      const timestamp = Date.now();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.buffer || file.buffer.length === 0) continue;

        const sanitizedName = (file.originalname || `upload_${i}.dat`).replace(/[^a-zA-Z0-9._-]/g, '_');
        const gcsPath = `crashes/${dateStr}/${timestamp}_${i}_${sanitizedName}`;
        const fileRef = bucket.file(gcsPath);

        await fileRef.save(file.buffer, {
          contentType: file.mimetype || 'application/octet-stream',
          metadata: {
            metadata: {
              uploadedBy: userId,
              originalName: file.originalname || 'unknown',
              crashedAt: new Date().toISOString(),
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
      console.error('⚠️ [ADMIN-ALERT] Failed to upload crash files to GCS:', storageErr);
    }

    return uploadedLinks;
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
        const funnel = this.getRecentFunnelHistory(userId);
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
}
