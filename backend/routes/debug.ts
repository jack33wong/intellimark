
import express from 'express';
import { QuestionDetectionService } from '../services/marking/questionDetectionService.js';

const router = express.Router();

/**
 * POST /api/debug/detect-question
 * Directly calls QuestionDetectionService for local testing/debugging.
 */
router.post('/detect-question', async (req, res) => {
    try {
        const { text, questionNumberHint, examPaperHint } = req.body;

        if (!text && !questionNumberHint) {
            return res.status(400).json({ error: 'Text or questionNumberHint required' });
        }

        const service = QuestionDetectionService.getInstance();
        const result = await service.detectQuestion(text, questionNumberHint, examPaperHint);

        res.json(result);
    } catch (error) {
        console.error('Debug Detection API Error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
