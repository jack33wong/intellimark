import { Router } from 'express';
import { MarkingSchemeController } from '../controllers/MarkingSchemeController.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// Endpoint for explaining marking schemes
router.post('/', optionalAuth, (req, res) => {
    MarkingSchemeController.explainMarkingScheme(req, res);
});

export default router;
