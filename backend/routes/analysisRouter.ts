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
    
    const { qualification, examBoard, paperCodeSet } = req.body;
    
    // 1. Get subject marking result
    const subjectResult = await FirestoreService.getSubjectMarkingResult(userId, subject);
    
    if (!subjectResult || !subjectResult.markingResults || subjectResult.markingResults.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: `No marking results found for subject: ${subject}` 
      });
    }
    
    // Filter marking results by qualification, exam board, and paper code set
    let filteredResults = subjectResult.markingResults;
    if (qualification) {
      filteredResults = filteredResults.filter((mr: any) => 
        mr.examMetadata?.qualification === qualification
      );
    }
    if (examBoard) {
      filteredResults = filteredResults.filter((mr: any) => 
        mr.examMetadata?.examBoard === examBoard
      );
    }
    if (paperCodeSet && Array.isArray(paperCodeSet) && paperCodeSet.length > 0) {
      filteredResults = filteredResults.filter((mr: any) => {
        const examCode = mr.examMetadata?.examCode || '';
        const paperCode = examCode.split('/').pop();
        return paperCode && paperCodeSet.includes(paperCode);
      });
    }
    
    if (filteredResults.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: `No marking results found for the selected filters` 
      });
    }
    
    // 2. Check for cached analysis with current filters
    const cachedAnalysis = await FirestoreService.getSubjectAnalysisByFilters(
      userId,
      subject,
      qualification,
      examBoard,
      paperCodeSet
    );
    
    // 3. If cached analysis exists, return it (cache is per filter combination)
    if (cachedAnalysis) {
      return res.json({ 
        success: true, 
        analysis: cachedAnalysis,
        cached: true
      });
    }
    
    // 4. Get last analysis report (for cost-saving context)
    const lastAnalysisReport = cachedAnalysis || null;
    
    // 5. Generate new analysis (with last report context and filters)
    const analysis = await AnalysisService.generateAnalysis(
      {
        subject,
        qualification,
        examBoard,
        paperCodeSet,
        model
      },
      lastAnalysisReport,  // Pass for AI context
      userId  // Pass userId for subjectMarkingResults lookup
    );
    
    // 6. Update analysis in subjectMarkingResults with filter keys
    await FirestoreService.updateSubjectAnalysis(
      userId, 
      subject, 
      analysis, 
      model,
      qualification,
      examBoard,
      paperCodeSet
    );
    
    // 7. Return to frontend
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
 * GET /api/analysis/grade-boundaries
 * Get grade boundaries structure for qualification and subject
 * MUST be before /:subject route to avoid route conflict
 */
router.get('/grade-boundaries', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { qualification, subject } = req.query;
    const userId = (req as any)?.user?.uid;
    const isAuthenticated = !!userId;
    
    // No access for unauthenticated users
    if (!isAuthenticated || !userId) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication required' 
      });
    }
    
    if (!qualification || !subject) {
      return res.status(400).json({ 
        success: false, 
        error: 'Qualification and subject are required' 
      });
    }
    
    // Query grade boundaries collection
    const { getFirestore } = await import('../config/firebase.js');
    const db = getFirestore();
    if (!db) {
      return res.status(500).json({ 
        success: false, 
        error: 'Database not available' 
      });
    }
    
    // Get all grade boundaries for the qualification
    const snapshot = await db.collection('gradeBoundaries')
      .where('qualification', '==', qualification)
      .get();
    
    if (snapshot.empty) {
      return res.json({ 
        success: true, 
        gradeBoundaries: [] 
      });
    }
    
    // Filter by subject and structure the response
    const gradeBoundaries = [];
    
    for (const doc of snapshot.docs) {
      const entry = { id: doc.id, ...doc.data() } as any;
      const matchingSubject = entry.subjects?.find((s: any) => 
        s.name?.toLowerCase() === (subject as string).toLowerCase()
      );
      
      if (matchingSubject) {
        gradeBoundaries.push({
          exam_board: entry.exam_board,
          qualification: entry.qualification,
          exam_series: entry.exam_series,
          subjects: [{
            name: matchingSubject.name,
            code: matchingSubject.code,
            tiers: matchingSubject.tiers?.map((tier: any) => ({
              tier_level: tier.tier_level,
              paper_codes: tier.paper_codes || []
            })) || []
          }]
        });
      }
    }
    
    return res.json({ 
      success: true, 
      gradeBoundaries 
    });
    
  } catch (error) {
    console.error('❌ [ANALYSIS ROUTER] Error fetching grade boundaries:', error);
    return res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to fetch grade boundaries' 
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

