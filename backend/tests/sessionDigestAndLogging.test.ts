import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminAlertService } from '../services/AdminAlertService.js';
import { logDetectionAudit } from '../services/marking/MarkingHelpers.js';
import { runWithLogCapture } from '../utils/RequestLogCapture.js';

function createMockTransporter() {
  const sentEmails: any[] = [];
  const transporter = {
    sendMail: async (mailOptions: any) => {
      sentEmails.push(mailOptions);
      return { messageId: `mock-${sentEmails.length}` };
    },
  } as any;
  return { transporter, sentEmails };
}

test('AdminAlertService aggregates multiple turns for the same sessionId into one idle-timeout digest email', async () => {
  const prevEmail = process.env.ADMIN_ALERT_EMAIL;
  const prevSmtpUser = process.env.SMTP_USER;
  const prevSmtpPass = process.env.SMTP_PASS;
  const prevMode = process.env.MARKING_LOG_EMAIL_MODE;
  const prevIdle = process.env.MARKING_LOG_IDLE_TIMEOUT_MS;
  const prevLogResp = process.env.LOG_AI_MARKING_RESPONSE;

  process.env.ADMIN_ALERT_EMAIL = 'admin@example.com';
  process.env.SMTP_USER = 'bot@example.com';
  process.env.SMTP_PASS = 'secret';
  process.env.MARKING_LOG_EMAIL_MODE = 'all';
  process.env.MARKING_LOG_IDLE_TIMEOUT_MS = '80';
  process.env.LOG_AI_MARKING_RESPONSE = 'true';

  const { transporter, sentEmails } = createMockTransporter();
  AdminAlertService.setTransporterForTesting(transporter);

  try {
    await AdminAlertService.notifyMarkingLog({
      submissionId: 'sub-1',
      sessionId: 'sess-agg-1',
      userId: 'user-123',
      userEmail: 'student@example.com',
      model: 'FAST',
      result: {
        sessionId: 'sess-agg-1',
        studentScore: { awardedMarks: 7, totalMarks: 10, scoreText: '7/10' },
        unifiedSession: {
          title: 'Edexcel Maths 1MA1',
          messages: [
            {
              role: 'user',
              imageLink: 'https://storage.example.com/page1.jpg',
              pdfContexts: [{ url: 'https://storage.example.com/paper.pdf', originalFileName: 'exam.pdf' }],
            },
          ],
        },
        questionResults: [
          { questionNumber: '1', studentScore: { awardedMarks: 4, totalMarks: 5 } },
          { questionNumber: '2', studentScore: { awardedMarks: 3, totalMarks: 5 } },
        ],
      },
      aiResponse: '{"annotations":[]}',
      logsText: 'Marking turn log line 1',
      lineCount: 1,
      durationMs: 1200,
    });

    // Should NOT have sent immediately
    assert.equal(sentEmails.length, 0);
    assert.equal(AdminAlertService.getPendingSessionDigestCount(), 1);

    // Wait 40ms (< 80ms idle timeout) and record a follow-up chat turn — this resets the timer
    await new Promise((r) => setTimeout(r, 40));

    AdminAlertService.recordSessionTurn({
      sessionId: 'sess-agg-1',
      turnType: 'FOLLOW_UP_CHAT',
      userId: 'user-123',
      userEmail: 'student@example.com',
      model: 'FAST',
      userInput: 'Why did I lose 1 mark on Q2?',
      aiResponse: 'You forgot to simplify the fraction.',
      uploadedFiles: [
        { filename: 'page1.jpg', url: 'https://storage.example.com/page1.jpg' }, // duplicate URL should be deduped
        { filename: 'followup.jpg', url: 'https://storage.example.com/followup.jpg' },
      ],
      logsText: 'Follow-up chat log line 1',
      lineCount: 1,
      durationMs: 800,
    });

    assert.equal(sentEmails.length, 0);

    // Wait past the 80ms idle timeout after the second turn
    await new Promise((r) => setTimeout(r, 130));

    assert.equal(sentEmails.length, 1);
    assert.equal(AdminAlertService.getPendingSessionDigestCount(), 0);

    const mail = sentEmails[0];
    assert.match(mail.subject, /\[SESSION DIGEST\]/);
    assert.match(mail.subject, /7\/10/);
    assert.match(mail.subject, /Edexcel Maths 1MA1/);
    assert.match(mail.subject, /2 turns/);
    assert.match(mail.subject, /OK/);

    // Point 2: uploaded file links present & deduplicated
    assert.match(mail.text, /https:\/\/storage\.example\.com\/page1\.jpg/);
    assert.match(mail.text, /https:\/\/storage\.example\.com\/paper\.pdf/);
    assert.match(mail.text, /https:\/\/storage\.example\.com\/followup\.jpg/);
    const page1Matches = mail.html.match(/https:\/\/storage\.example\.com\/page1\.jpg/g) || [];
    assert.equal(page1Matches.length, 1);

    // Point 1 & Point 4: student input and raw AI response present
    assert.match(mail.text, /Why did I lose 1 mark on Q2\?/);
    assert.match(mail.text, /You forgot to simplify the fraction\./);

    // Combined .txt attachment
    assert.equal(mail.attachments.length, 1);
    assert.equal(mail.attachments[0].filename, 'session-digest-sess-agg-1.txt');
    assert.match(mail.attachments[0].content, /TURN 1: MARKING/);
    assert.match(mail.attachments[0].content, /TURN 2: FOLLOW_UP_CHAT/);
    assert.match(mail.attachments[0].content, /Marking turn log line 1/);
    assert.match(mail.attachments[0].content, /Follow-up chat log line 1/);
  } finally {
    await AdminAlertService.flushAllSessionDigests();
    AdminAlertService.setTransporterForTesting(null);
    process.env.ADMIN_ALERT_EMAIL = prevEmail;
    process.env.SMTP_USER = prevSmtpUser;
    process.env.SMTP_PASS = prevSmtpPass;
    process.env.MARKING_LOG_EMAIL_MODE = prevMode;
    process.env.MARKING_LOG_IDLE_TIMEOUT_MS = prevIdle;
    process.env.LOG_AI_MARKING_RESPONSE = prevLogResp;
  }
});

test('MARKING_LOG_EMAIL_MODE=errors_only suppresses success-only sessions and sends sessions with errors', async () => {
  const prevEmail = process.env.ADMIN_ALERT_EMAIL;
  const prevSmtpUser = process.env.SMTP_USER;
  const prevSmtpPass = process.env.SMTP_PASS;
  const prevMode = process.env.MARKING_LOG_EMAIL_MODE;

  process.env.ADMIN_ALERT_EMAIL = 'admin@example.com';
  process.env.SMTP_USER = 'bot@example.com';
  process.env.SMTP_PASS = 'secret';
  process.env.MARKING_LOG_EMAIL_MODE = 'errors_only';

  const { transporter, sentEmails } = createMockTransporter();
  AdminAlertService.setTransporterForTesting(transporter);

  try {
    AdminAlertService.recordSessionTurn({
      sessionId: 'sess-ok-only',
      turnType: 'QUESTION_MODE',
      model: 'FAST',
      logsText: 'ok log',
      lineCount: 1,
      durationMs: 500,
    });
    await AdminAlertService.flushSessionDigest('sess-ok-only');
    assert.equal(sentEmails.length, 0);

    AdminAlertService.recordSessionTurn({
      sessionId: 'sess-with-err',
      turnType: 'MARKING',
      model: 'FAST',
      logsText: 'initial ok',
      lineCount: 1,
      durationMs: 500,
    });
    AdminAlertService.recordSessionTurn({
      sessionId: 'sess-with-err',
      turnType: 'FOLLOW_UP_CHAT',
      model: 'FAST',
      error: new Error('LLM timeout'),
      logsText: 'error log',
      lineCount: 1,
      durationMs: 200,
    });
    await AdminAlertService.flushSessionDigest('sess-with-err');
    assert.equal(sentEmails.length, 1);
    assert.match(sentEmails[0].subject, /HAS_ERRORS/);
    assert.match(sentEmails[0].text, /LLM timeout/);
  } finally {
    await AdminAlertService.flushAllSessionDigests();
    AdminAlertService.setTransporterForTesting(null);
    process.env.ADMIN_ALERT_EMAIL = prevEmail;
    process.env.SMTP_USER = prevSmtpUser;
    process.env.SMTP_PASS = prevSmtpPass;
    process.env.MARKING_LOG_EMAIL_MODE = prevMode;
  }
});

test('logDetectionAudit logs full extracted question text without 45-char truncation (Point 3)', async () => {
  const longQuestionText =
    'A particle P moves along a straight line such that its acceleration at time t seconds is given by a = 6t - 4. Given that when t = 2, the velocity is 5 m/s and displacement is 10 m, find the exact displacement when t = 4.';

  let capturedText = '';
  await runWithLogCapture(
    'audit-test',
    async () => {
      logDetectionAudit([
        {
          question: {
            questionNumber: '7a',
            text: longQuestionText,
          },
          detectionResult: {
            found: true,
            match: {
              board: 'Pearson Edexcel',
              qualification: 'A-Level',
              paperCode: '9MA0',
              examSeries: 'June 2023',
              questionNumber: '7a',
              confidence: 0.94,
            },
          },
        },
      ]);
    },
    (captured) => {
      capturedText = captured.logsText;
    }
  );

  assert.match(capturedText, /\[DETECTION AUDIT REPORT\]/);
  assert.match(capturedText, /\[DETECTION FULL EXTRACTED TEXT\]/);
  assert.ok(capturedText.includes(longQuestionText), 'Expected full question text to be present in captured log');
});

test('LOG_AI_MARKING_RESPONSE=false omits raw AI response and REMARK result.results breakdown is extracted', async () => {
  const prevEmail = process.env.ADMIN_ALERT_EMAIL;
  const prevSmtpUser = process.env.SMTP_USER;
  const prevSmtpPass = process.env.SMTP_PASS;
  const prevMode = process.env.MARKING_LOG_EMAIL_MODE;
  const prevLogResp = process.env.LOG_AI_MARKING_RESPONSE;

  process.env.ADMIN_ALERT_EMAIL = 'admin@example.com';
  process.env.SMTP_USER = 'bot@example.com';
  process.env.SMTP_PASS = 'secret';
  process.env.MARKING_LOG_EMAIL_MODE = 'all';
  process.env.LOG_AI_MARKING_RESPONSE = 'false';

  const { transporter, sentEmails } = createMockTransporter();
  AdminAlertService.setTransporterForTesting(transporter);

  try {
    AdminAlertService.recordSessionTurn({
      sessionId: 'sess-remark-1',
      turnType: 'REMARK',
      model: 'FAST',
      result: {
        sessionId: 'sess-remark-1',
        metadata: { totalScore: 8, maxScore: 10 },
        results: [
          { questionNumber: '3', studentScore: { awardedMarks: 8, totalMarks: 10 } },
        ],
      },
      aiResponse: 'SECRET_RAW_AI_OUTPUT',
      logsText: 'Remark log line',
      lineCount: 1,
      durationMs: 600,
    });

    await AdminAlertService.flushSessionDigest('sess-remark-1');
    assert.equal(sentEmails.length, 1);
    const mail = sentEmails[0];
    assert.match(mail.subject, /8\/10/);
    assert.match(mail.text, /Q3: 8\/10/);
    assert.ok(!mail.text.includes('SECRET_RAW_AI_OUTPUT'), 'aiResponse should be omitted when LOG_AI_MARKING_RESPONSE=false');
    assert.ok(!mail.attachments[0].content.includes('SECRET_RAW_AI_OUTPUT'), 'aiResponse should be omitted from attachment when LOG_AI_MARKING_RESPONSE=false');
  } finally {
    await AdminAlertService.flushAllSessionDigests();
    AdminAlertService.setTransporterForTesting(null);
    process.env.ADMIN_ALERT_EMAIL = prevEmail;
    process.env.SMTP_USER = prevSmtpUser;
    process.env.SMTP_PASS = prevSmtpPass;
    process.env.MARKING_LOG_EMAIL_MODE = prevMode;
    process.env.LOG_AI_MARKING_RESPONSE = prevLogResp;
  }
});
