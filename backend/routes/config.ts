/**
 * Frontend API endpoint to get credit configuration
 * This allows frontend to display dynamic credit allocations
 */

import express from 'express';
import CREDIT_CONFIG from '../config/credit.config.js';
import { getFirestore } from '../config/firebase.js';
import { ExamReferenceService } from '../services/ExamReferenceService.js';
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

// POST /api/config/telemetry - Lightweight client funnel & drop-off logger
// Accepts both application/json and text/plain (used by sendBeacon to avoid cross-origin OPTIONS preflight on Safari)
router.post('/telemetry', express.json({ type: ['application/json', 'text/plain'], limit: '50kb' }), (req, res) => {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { event, userId, anonymousId, path, origin, timestamp, ...metadata } = body;
    if (process.env.LOG_FUNNEL === 'true') {
      console.log(
        `📊 [FUNNEL] event=${event || 'unknown'} | user=${userId || 'guest'} | anon=${anonymousId || 'unknown'} | path=${path || '/'} | data=${JSON.stringify(metadata)}`
      );
    }
    AdminAlertService.recordTelemetryEvent(anonymousId, userId, event, path, metadata);

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
