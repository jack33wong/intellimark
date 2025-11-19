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
    const { sessionId, sessionIds, subject, model = 'auto' } = req.body;
    const userId = (req as any)?.user?.uid;
    const isAuthenticated = !!userId;
    
    // No analysis for unauthenticated users
    if (!isAuthenticated || !userId) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication required for analysis' 
      });
    }
    
    // Subject is required
    if (!subject) {
      return res.status(400).json({ 
        success: false, 
        error: 'Subject is required' 
      });
    }
    
      // 1. Get subject marking result
      const subjectResult = await FirestoreService.getSubjectMarkingResult(userId, subject);
      
      if (!subjectResult || !subjectResult.markingResults || subjectResult.markingResults.length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: `No marking results found for subject: ${subject}` 
        });
      }
      
      // 2. Check if re-analysis is needed
      const reAnalysisNeeded = subjectResult.reAnalysisNeeded || false;
      const existingAnalysis = subjectResult.analysis;
      
      // If analysis exists and no re-analysis needed, return cached
      if (existingAnalysis && !reAnalysisNeeded) {
        return res.json({ 
          success: true, 
          analysis: existingAnalysis,
          cached: true,
          reAnalysisNeeded: false
        });
      }
      
      // 3. Get last analysis report (for cost-saving)
      const lastAnalysisReport = existingAnalysis || null;
      
      // 4. Generate new analysis (with last report context)
      const analysis = await AnalysisService.generateAnalysis(
        {
          subject,
          model
        },
        lastAnalysisReport,  // Pass for AI context
        userId  // Pass userId for subjectMarkingResults lookup
      );
      
      // 5. Update analysis in subjectMarkingResults and reset reAnalysisNeeded flag
    await FirestoreService.updateSubjectAnalysis(userId, subject, analysis, model);
    
    // 6. Return to frontend
    return res.json({ 
      success: true, 
      analysis,
      cached: false,
      reAnalysisNeeded: false
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
 * GET /api/analysis/subjects
 * Get all subjects with marking results for the authenticated user
 */
router.get('/subjects', optionalAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any)?.user?.uid;
    const isAuthenticated = !!userId;
    
    // No analysis for unauthenticated users
    if (!isAuthenticated || !userId) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication required' 
      });
    }
    
    // Get all subject marking results for this user
    const subjectResults = await FirestoreService.getUserSubjectMarkingResults(userId);
    
    // Extract unique subjects
    const subjects = subjectResults
      .map((sr: any) => sr.subject)
      .filter((subject: string) => subject) // Filter out null/undefined
      .sort();
    
    return res.json({ 
      success: true, 
      subjects
    });
    
  } catch (error) {
    console.error('❌ [ANALYSIS ROUTER] Error fetching subjects:', error);
    return res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to fetch subjects' 
    });
  }
});

/**
 * GET /api/analysis/:subject
 * Get full subjectMarkingResults document (including marking results and analysis)
 */
router.get('/:subject', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { subject } = req.params;
    const userId = (req as any)?.user?.uid;
    const isAuthenticated = !!userId;
    
    // No analysis for unauthenticated users
    if (!isAuthenticated || !userId) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication required for analysis' 
      });
    }
    
    // Get full subject marking result document
    const subjectResult = await FirestoreService.getSubjectMarkingResult(userId, subject);
    
    if (!subjectResult) {
      return res.status(404).json({ 
        success: false, 
        error: `No marking results found for subject: ${subject}` 
      });
    }
    
    // Return full document including markingResults, statistics, analysis, and flags
    return res.json({ 
      success: true, 
      subjectMarkingResult: {
        markingResults: subjectResult.markingResults || [],
        statistics: subjectResult.statistics || {},
        analysis: subjectResult.analysis || null,
        reAnalysisNeeded: subjectResult.reAnalysisNeeded || false
      }
    });
    
  } catch (error) {
    console.error('❌ [ANALYSIS ROUTER] Error fetching subject marking results:', error);
    return res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to fetch subject marking results' 
    });
  }
});

/**
 * DELETE /api/analysis/:subject/:sessionId
 * Delete a marking result from subjectMarkingResults and set reAnalysisNeeded flag
 */
router.delete('/:subject/:sessionId', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { subject, sessionId } = req.params;
    const userId = (req as any)?.user?.uid;
    const isAuthenticated = !!userId;
    
    // No delete for unauthenticated users
    if (!isAuthenticated || !userId) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication required' 
      });
    }
    
    // Remove marking result from subjectMarkingResults (this already sets reAnalysisNeeded flag)
    await FirestoreService.removeMarkingResultFromSubject(userId, subject, sessionId);
    
    return res.json({ 
      success: true, 
      message: 'Marking result deleted successfully' 
    });
    
  } catch (error) {
    console.error('❌ [ANALYSIS ROUTER] Error deleting marking result:', error);
    return res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to delete marking result' 
    });
  }
});


export default router;

