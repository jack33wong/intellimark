/**
 * Analysis Router - Handles analysis report generation
 */

import express, { Request, Response } from 'express';
import { optionalAuth } from '../middleware/auth.js';
import { AnalysisService } from '../services/analysis/AnalysisService.js';
import { FirestoreService } from '../services/firestoreService.js';
import type { AnalysisResult } from '../services/analysis/analysisTypes.js';
import type { UnifiedSession, UnifiedMessage } from '../types/index.js';

const router = express.Router();

/**
 * POST /api/analysis/generate
 * Generate analysis report for a session
 */
router.post('/generate', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { sessionId, model = 'auto' } = req.body;
    const userId = (req as any)?.user?.uid;
    const isAuthenticated = !!userId;
    
    if (!sessionId) {
      return res.status(400).json({ 
        success: false, 
        error: 'sessionId is required' 
      });
    }
    
    // 1. Get session and check if it has marking results
    const session = isAuthenticated 
      ? await FirestoreService.getUnifiedSession(sessionId)
      : null; // For unauthenticated, would need to get from in-memory
    
    if (!session) {
      return res.status(404).json({ 
        success: false, 
        error: 'Session not found' 
      });
    }
    
    // 2. Check if analysis already exists
    const existingAnalysis = await AnalysisService.getExistingAnalysis(sessionId);
    
    // 3. Check if session has new marking results
    const hasNewResults = await AnalysisService.hasNewMarkingResults(sessionId);
    
    // 4. If analysis exists and no new results, return cached
    if (existingAnalysis && !hasNewResults) {
      return res.json({ 
        success: true, 
        analysis: existingAnalysis,
        cached: true 
      });
    }
    
    // 5. Get last analysis report (for cost-saving)
    const lastAnalysisReport = existingAnalysis || null;
    
    // 6. Generate new analysis (with last report context)
    const analysis = await AnalysisService.generateAnalysis(
      {
        sessionId,
        model,
        detectedQuestion: getDetectedQuestionFromSession(session)
      },
      lastAnalysisReport  // Pass for AI context
    );
    
    // 7. Store analysis in session (as UnifiedMessage)
    await storeAnalysisInSession(sessionId, analysis, userId, isAuthenticated);
    
    // 8. Return to frontend
    return res.json({ 
      success: true, 
      analysis,
      cached: false 
    });
    
  } catch (error) {
    console.error('❌ [ANALYSIS ROUTER] Error generating analysis:', error);
    return res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to generate analysis' 
    });
  }
});

/**
 * GET /api/analysis/:sessionId
 * Get existing analysis for a session
 */
router.get('/:sessionId', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = (req as any)?.user?.uid;
    const isAuthenticated = !!userId;
    
    const session = isAuthenticated 
      ? await FirestoreService.getUnifiedSession(sessionId)
      : null;
    
    if (!session) {
      return res.status(404).json({ 
        success: false, 
        error: 'Session not found' 
      });
    }
    
    const analysis = await AnalysisService.getExistingAnalysis(sessionId);
    
    if (!analysis) {
      return res.status(404).json({ 
        success: false, 
        error: 'Analysis not found for this session' 
      });
    }
    
    return res.json({ 
      success: true, 
      analysis 
    });
    
  } catch (error) {
    console.error('❌ [ANALYSIS ROUTER] Error fetching analysis:', error);
    return res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to fetch analysis' 
    });
  }
});

/**
 * Helper: Get detectedQuestion from session
 */
function getDetectedQuestionFromSession(session: UnifiedSession): any {
  // Find the most recent message with detectedQuestion
  const messagesWithDetectedQuestion = session.messages
    ?.filter((msg: UnifiedMessage) => msg.detectedQuestion?.found)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  
  return messagesWithDetectedQuestion?.[0]?.detectedQuestion || null;
}

/**
 * Helper: Store analysis in session as UnifiedMessage
 */
async function storeAnalysisInSession(
  sessionId: string,
  analysis: AnalysisResult,
  userId: string | undefined,
  isAuthenticated: boolean
): Promise<void> {
  if (!isAuthenticated || !userId) {
    // For unauthenticated users, analysis is not persisted
    return;
  }
  
  try {
    // Create analysis message
    const analysisMessage: UnifiedMessage = {
      messageId: `analysis-${Date.now()}`,
      sessionId,
      userId,
      role: 'assistant',
      content: `Performance Analysis Report\n\nOverall Score: ${analysis.performance.overallScore} (${analysis.performance.percentage}%)\n\n${analysis.performance.summary}`,
      timestamp: new Date().toISOString(),
      type: 'analysis',
      isProcessing: false
    };
    
    // Attach analysis result to message
    (analysisMessage as any).analysisResult = analysis;
    
    // Add to session
    await FirestoreService.addMessageToUnifiedSession(sessionId, analysisMessage);
    
  } catch (error) {
    console.error('❌ [ANALYSIS ROUTER] Error storing analysis:', error);
    // Don't throw - analysis generation succeeded, storage is secondary
  }
}

export default router;

