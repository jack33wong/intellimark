/**
 * Frontend API endpoint to get credit configuration
 * This allows frontend to display dynamic credit allocations
 */

import express from 'express';
import CREDIT_CONFIG from '../config/credit.config.js';
import { getFirestore } from '../config/firebase.js';
import { ExamReferenceService } from '../services/ExamReferenceService.js';
import { NormalizationService } from '../services/marking/NormalizationService.js';
import { AI_MODELS, getDefaultModel, MODEL_TIER_DEFINITIONS } from '../config/aiModels.js';
import { AdminAlertService } from '../services/AdminAlertService.js';

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
 * GET /api/config/models
 * Returns available AI models and their UI configuration
 */
router.get('/models', (req, res) => {
    try {
        const models = Object.values(MODEL_TIER_DEFINITIONS)
            .filter(t => t.exposeInUi)
            .map(t => ({
                id: t.id,
                name: AI_MODELS[t.modelId as keyof typeof AI_MODELS]?.name || t.modelId,
                label: t.uiLabel,
                description: t.uiDescription
            }));
        
        res.json({
            success: true,
            models,
            defaultModel: getDefaultModel()
        });
    } catch (error) {
        console.error('Error fetching models:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
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

        const [papersSnapshot, schemesSnapshot] = await Promise.all([
            db.collection('fullExamPapers').get(),
            db.collection('markingSchemes').get()
        ]);
        const boards = new Set<string>();
        const qualifications = new Set<string>();
        const tiers = new Set<string>();
        const papers = new Set<string>();
        const codes = new Set<string>();
        const subjects = new Set<string>();
        const boardSubjectsMap = new Map<string, Set<string>>();
        const qualBoardsMap = new Map<string, Set<string>>();
        const qualBoardSubjectsMap = new Map<string, Map<string, Set<string>>>();
        const paperSubjects: Record<string, string> = {};
        const paperMeta: Record<string, {
            qualification: string;
            board: string;
            subject: string;
            code: string;
            series: string;
            tier: string;
        }> = {};

        const normalizeSubjectName = (raw: string): string => {
            const trimmed = raw.trim().replace(/\s+/g, ' ');
            if (!trimmed) return '';
            if (/^maths?$/i.test(trimmed)) return 'Mathematics';
            return trimmed
                .toLowerCase()
                .replace(/(^|[\s:\-\/(])([a-z])/g, (_, sep, ch) => `${sep}${ch.toUpperCase()}`);
        };

        const collectMetadataEntry = (metadata: any) => {
            if (!metadata) return;
            const rawBoard = String(metadata.exam_board || metadata.board || '').trim();
            const isValidBoard = Boolean(rawBoard) && !/^(custom|unknown|n\/a|none)$/i.test(rawBoard);
            const board = isValidBoard ? NormalizationService.normalizeExamBoard(rawBoard) : '';
            const code = String(metadata.exam_code || metadata.paperCode || metadata.code || '').trim();
            const rawSubject = typeof metadata.subject === 'string' ? normalizeSubjectName(metadata.subject) : '';
            const resolvedSubject = rawSubject || (/\b(8700|8702|1EN0|1ET0|J351|J352|C700|C720)\b|english/i.test(code) ? 'English Language' : 'Mathematics');

            // Normalize metadata shape for ExamReferenceService
            const normalizedMeta = {
                ...metadata,
                exam_board: board,
                exam_code: code,
                exam_series: metadata.exam_series || metadata.series || ''
            };

            // Normalize Series, Tier, and Qualification using Centralized Service
            const { series: formattedSeries, tier: formattedTier, qualification } = ExamReferenceService.formatMetadataDisplay(normalizedMeta);

            if (isValidBoard) boards.add(board);
            if (code && !/^(uploaded|unknown|n\/a)$/i.test(code)) codes.add(code);
            if (resolvedSubject) {
                subjects.add(resolvedSubject);
                if (isValidBoard) {
                    if (!boardSubjectsMap.has(board)) {
                        boardSubjectsMap.set(board, new Set<string>());
                    }
                    boardSubjectsMap.get(board)!.add(resolvedSubject);
                }
            }

            if (qualification) {
                qualifications.add(qualification);
                if (isValidBoard) {
                    if (!qualBoardsMap.has(qualification)) {
                        qualBoardsMap.set(qualification, new Set<string>());
                    }
                    qualBoardsMap.get(qualification)!.add(board);

                    if (resolvedSubject) {
                        if (!qualBoardSubjectsMap.has(qualification)) {
                            qualBoardSubjectsMap.set(qualification, new Map<string, Set<string>>());
                        }
                        const qMap = qualBoardSubjectsMap.get(qualification)!;
                        if (!qMap.has(board)) {
                            qMap.set(board, new Set<string>());
                        }
                        qMap.get(board)!.add(resolvedSubject);
                    }
                }
            }

            if (formattedTier && formattedTier !== 'N/A') {
                tiers.add(formattedTier);
            }

            if (isValidBoard && (code || formattedSeries)) {
                // Canonical paper description format: "[Qual] Board - Code - Exam Series[, Tier]"
                const qualPrefix = qualification ? `${qualification} ` : 'GCSE ';
                const tierSuffix = formattedTier ? `, ${formattedTier}` : '';
                const fullDescription = `${qualPrefix}${board}${board && code ? ' - ' : ''}${code}${(board || code) && formattedSeries ? ' - ' : ''}${formattedSeries}${tierSuffix}`;

                if (fullDescription.trim()) {
                    papers.add(fullDescription);
                    if (resolvedSubject && !paperSubjects[fullDescription]) {
                        paperSubjects[fullDescription] = resolvedSubject;
                    }
                    if (!paperMeta[fullDescription]) {
                        paperMeta[fullDescription] = {
                            qualification: qualification || 'GCSE',
                            board,
                            subject: resolvedSubject,
                            code,
                            series: formattedSeries,
                            tier: formattedTier
                        };
                    }
                }
            }
        };

        papersSnapshot.forEach((doc: any) => {
            const data = doc.data();
            collectMetadataEntry(data.metadata);
        });

        schemesSnapshot.forEach((doc: any) => {
            const data = doc.data();
            collectMetadataEntry(data.examDetails || data.metadata);
        });

        const boardSubjects: Record<string, string[]> = {};
        boardSubjectsMap.forEach((subjSet, boardKey) => {
            boardSubjects[boardKey] = Array.from(subjSet).sort();
        });

        const qualificationBoards: Record<string, string[]> = {};
        qualBoardsMap.forEach((boardSet, qualKey) => {
            qualificationBoards[qualKey] = Array.from(boardSet).sort();
        });

        const qualificationBoardSubjects: Record<string, Record<string, string[]>> = {};
        qualBoardSubjectsMap.forEach((boardMap, qualKey) => {
            qualificationBoardSubjects[qualKey] = {};
            boardMap.forEach((subjSet, boardKey) => {
                qualificationBoardSubjects[qualKey][boardKey] = Array.from(subjSet).sort();
            });
        });

        const QUAL_ORDER = [
            'GCSE', 'IGCSE', 'A-Level', 'IAL', 'AS-Level', 'International AS',
            'O Level', 'National 5', 'Level 3', 'IB', 'AP'
        ];
        const sortedQualifications = Array.from(qualifications).sort((a, b) => {
            const ia = QUAL_ORDER.indexOf(a);
            const ib = QUAL_ORDER.indexOf(b);
            if (ia !== -1 && ib !== -1) return ia - ib;
            if (ia !== -1) return -1;
            if (ib !== -1) return 1;
            return a.localeCompare(b);
        });

        res.json({
            boards: Array.from(boards).sort(),
            qualifications: sortedQualifications,
            tiers: Array.from(tiers).sort(),
            papers: Array.from(papers).sort(),
            codes: Array.from(codes).sort(),
            subjects: Array.from(subjects).sort(),
            boardSubjects,
            qualificationBoards,
            qualificationBoardSubjects,
            paperSubjects,
            paperMeta
        });
    } catch (error) {
        console.error('Error fetching exam metadata:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/config/paper-questions
 * Queries fullExamPapers in Firestore by paperTitle (or board + paperCode + examSeries)
 * and returns the sorted list of questions and their maximum marks.
 */
router.get('/paper-questions', async (req, res) => {
  try {
    const paperTitle = String(req.query.paperTitle || '').trim();
    if (!paperTitle) {
      return res.status(400).json({ error: 'Missing paperTitle parameter' });
    }

    const db = getFirestore();
    if (!db) {
      return res.status(500).json({ error: 'Firestore not available' });
    }

    // 1. Direct query on paperTitle field
    const snapshot = await db.collection('fullExamPapers')
      .where('paperTitle', '==', paperTitle)
      .limit(1)
      .get();

    let docData: any = !snapshot.empty ? snapshot.docs[0].data() : null;

    // 2. Fallback: match by normalized code + series if exact paperTitle differs
    if (!docData) {
      const codeMatch = paperTitle.match(/\b([0-9A-Z]{4,6}\/[0-9A-Z]{1,3})\b/i);
      if (codeMatch) {
        const byCodeSnap = await db.collection('fullExamPapers')
          .where('metadata.exam_code', '==', codeMatch[1].toUpperCase())
          .get();
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const targetNorm = norm(paperTitle);
        const matchedDoc = byCodeSnap.docs.find(d => {
          const data = d.data();
          const seriesNorm = norm(`${data.metadata?.exam_series || data.examSeries || ''} ${data.metadata?.tier || data.tier || ''}`);
          return seriesNorm && targetNorm.includes(seriesNorm);
        }) || byCodeSnap.docs[0];
        if (matchedDoc) docData = matchedDoc.data();
      }
    }

    // 3. Fallback: ExamReferenceService.findPaper
    if (!docData) {
      const found = await ExamReferenceService.findPaper(paperTitle);
      if (found) docData = found;
    }

    if (!docData) {
      return res.json({ questions: [] });
    }

    const rawQuestions = docData.questions || docData.markingScheme?.allQuestions || {};
    const questionsList: Array<{ questionNumber: string; marks: number }> = [];

    if (Array.isArray(rawQuestions)) {
      rawQuestions.forEach((q: any) => {
        const qNum = String(q.questionNumber || q.number || q.question_number || '').replace(/^0+/, '');
        const marks = Number(q.marks || q.totalMarks || q.maxMarks || q.total_marks || 0);
        if (qNum) questionsList.push({ questionNumber: qNum, marks });
      });
    } else if (typeof rawQuestions === 'object') {
      // Group sub-questions by base question number so pills show top-level questions (Q1, Q2, Q3...)
      const groupedMarks = new Map<string, number>();
      Object.entries(rawQuestions).forEach(([key, val]: [string, any]) => {
        const baseMatch = key.match(/^0*(\d+)/);
        const baseNum = baseMatch ? baseMatch[1] : key;
        const m = Number(val?.marks || val?.totalMarks || val?.total_marks || (Array.isArray(val) ? val.length : 0));
        groupedMarks.set(baseNum, (groupedMarks.get(baseNum) || 0) + m);
      });
      groupedMarks.forEach((marks, questionNumber) => {
        questionsList.push({ questionNumber, marks });
      });
    }

    questionsList.sort((a, b) => (parseInt(a.questionNumber, 10) || 0) - (parseInt(b.questionNumber, 10) || 0));
    return res.json({ questions: questionsList });
  } catch (err: any) {
    console.error('Error fetching paper questions:', err);
    return res.status(500).json({ error: 'Failed to fetch paper questions' });
  }
});

const FUNNEL_EVENTS = new Set([
  'marking_submit_clicked',
  'auth_wall_shown',
  'auth_wall_cta_clicked',
  'auth_wall_dismissed',
  'auth_wall_converted',
  'auth_wall_google_error'
]);

// POST /api/config/telemetry - Lightweight client funnel & drop-off logger
// Accepts both application/json and text/plain (used by sendBeacon to avoid cross-origin OPTIONS preflight on Safari)
router.post('/telemetry', express.json({ type: ['application/json', 'text/plain'], limit: '50kb' }), (req, res) => {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { event, userId, anonymousId, path, origin, timestamp, ...metadata } = body;

    if (body?.type === 'funnel' && FUNNEL_EVENTS.has(event)) {
      const userIP = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
      const actor = typeof userId === 'string' && userId.trim() ? userId.trim() : `guest:${userIP}`;
      const { trigger, step, button, isGuest, fileCount, hasMarkScheme, timeOpenMs, dismissMethod, method, code, fallback, preInspectSessionId } = body;
      const details = [
        step ? `step=${step}` : null,
        button ? `button=${button}` : null,
        trigger ? `trigger=${trigger}` : null,
        typeof isGuest === 'boolean' ? `isGuest=${isGuest}` : null,
        typeof fileCount === 'number' ? `files=${fileCount}` : null,
        typeof hasMarkScheme === 'boolean' ? `ms=${hasMarkScheme}` : null,
        typeof timeOpenMs === 'number' ? `openMs=${timeOpenMs}` : null,
        dismissMethod ? `via=${dismissMethod}` : null,
        method ? `method=${method}` : null,
        code ? `code=${code}` : null,
        fallback ? `fallback=${fallback}` : null
      ].filter(Boolean).join(' | ');

      const funnelLine = `📊 [FUNNEL] ${event} | ${actor} | ${details}`;
      console.log(funnelLine);
      AdminAlertService.appendFunnelEventToPreInspectDigest({
        actor,
        preInspectSessionId: typeof preInspectSessionId === 'string' ? preInspectSessionId : null,
        line: funnelLine,
      });
    } else if (process.env.LOG_FUNNEL === 'true') {
      console.log(
        `📊 [FUNNEL] event=${event || 'unknown'} | user=${userId || 'guest'} | anon=${anonymousId || 'unknown'} | path=${path || '/'} | data=${JSON.stringify(metadata)}`
      );
    }

    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined;
    AdminAlertService.recordTelemetryEvent(anonymousId, userId, event, path, metadata, userAgent);

    if (event === 'marking_engagement_summary' && metadata?.sessionId) {
      import('../services/firestoreService.js')
        .then(({ FirestoreService }) => {
          void FirestoreService.saveSessionEngagement(metadata.sessionId, {
            userId,
            ...metadata
          });
        })
        .catch(() => {});
    }
  } catch (err) {
    // Ignore malformed telemetry payloads
  }
  res.status(204).end();
});

export default router;
