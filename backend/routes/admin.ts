/**
 * Admin Routes
 * Handles administrative functions like JSON management and system operations
 */

import * as express from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticateUser, requireAdmin } from '../middleware/auth.js';
import admin from 'firebase-admin';

// Import Firebase instances from centralized config
import { getFirestore, getFirebaseAdmin } from '../config/firebase.js';

const router = express.Router();

// Apply admin authentication to all admin routes
router.use(authenticateUser, requireAdmin);

// Types
interface JSONExamPaper {
  id: string;
  exam: {
    board: string;
    session: string;
    tier: string;
    paper: string;
    code: string;
    totalQuestions: number;
    questionsWithSubQuestions: number;
  };
  questions: any[];
  totalMarks: number;
  uploadedAt: string;
}

// In-memory storage for JSON collections
const mockData: { [key: string]: any[] } = {
  fullExamPapers: [],
  questionBanks: [],
  markingSchemes: [],
  otherCollections: []
};











/**
 * GET /api/admin/json/collections/:collectionName
 * Get all entries from a JSON collection
 */
router.get('/json/collections/:collectionName', async (req: Request, res: Response) => {
  try {
    const { collectionName } = req.params;

    if (!collectionName) {
      return res.status(400).json({ error: 'Collection name is required' });
    }

    // Get data from Firestore if available, otherwise use mock data
    const db = getFirestore();
    if (db) {
      try {
        const snapshot = await db.collection(collectionName).get();
        const entries = [];

        snapshot.forEach(doc => {
          const data = doc.data();
          const entry = {
            id: doc.id,
            ...data,
            uploadedAt: data.uploadedAt ?
              (typeof data.uploadedAt === 'string' ? data.uploadedAt : data.uploadedAt.toDate().toISOString()) :
              new Date().toISOString()
          };

          entries.push(entry);
        });

        res.json({
          collectionName,
          entries: entries
        });
      } catch (firestoreError) {
        console.error('Firestore fetch error:', firestoreError);
        // Fallback to mock data
        const mockEntries = mockData[collectionName] || [];
        res.json({
          collectionName,
          entries: mockEntries
        });
      }
    } else {
      // Use mock data when Firebase is not available
      const mockEntries = mockData[collectionName] || [];
      res.json({
        collectionName,
        entries: mockEntries
      });
    }
  } catch (error) {
    console.error('Get collection error:', error);
    res.status(500).json({ error: `Failed to get collection: ${error.message}` });
  }
});

/**
 * POST /api/admin/json/collections/markingSchemes
 * Upload marking scheme data (specific endpoint for marking schemes)
 */
router.post('/json/collections/markingSchemes', async (req: Request, res: Response) => {
  try {
    const { markingSchemeData } = req.body;

    if (!markingSchemeData) {
      return res.status(400).json({ error: 'Marking scheme data is required' });
    }

    // Parse the marking scheme data if it's a JSON string
    let parsedData;
    try {
      parsedData = typeof markingSchemeData === 'string' ? JSON.parse(markingSchemeData) : markingSchemeData;
    } catch (parseError) {
      return res.status(400).json({ error: 'Invalid JSON format in marking scheme data' });
    }

    // Extract exam details for easier querying
    const examDetails = parsedData.examDetails || {};
    const questions = parsedData.questions || {};

    // Calculate total questions and marks
    const questionNumbers = Object.keys(questions).sort((a, b) => {
      // Sort numerically if both are numbers, otherwise alphabetically
      const numA = parseInt(a);
      const numB = parseInt(b);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a.localeCompare(b);
    });
    const totalQuestions = questionNumbers.length;
    const totalMarks = questionNumbers.reduce((total, qNum) => {
      const question = questions[qNum];
      if (question.marks && Array.isArray(question.marks)) {
        // Count actual mark points, not just array length
        return total + question.marks.length;
      }
      return total;
    }, 0);



    const newEntry = {
      id: uuidv4(),
      ...parsedData, // Spread the parsed data directly (examDetails and questions)
      examDetails: {
        board: examDetails.board || 'Unknown',
        qualification: examDetails.qualification || 'GCSE', // Default to GCSE
        subject: examDetails.subject || 'MATHEMATICS', // Default to MATHEMATICS
        paperCode: examDetails.paperCode || 'Unknown',
        tier: examDetails.tier || 'Unknown',
        paper: examDetails.paper || 'Unknown',
        exam_series: examDetails.exam_series || 'Unknown'
      },
      totalQuestions,
      totalMarks,
      uploadedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    // Save to Firestore if available
    const db = getFirestore();
    if (db) {
      try {
        await db.collection('markingSchemes').doc(newEntry.id).set(newEntry);
      } catch (firestoreError) {
        console.error('Firestore save error:', firestoreError);
        // Continue with mock data even if Firestore fails
      }
    }

    // Always save to mock data for fallback
    if (!mockData['markingSchemes']) {
      mockData['markingSchemes'] = [];
    }
    mockData['markingSchemes'].push(newEntry);

    res.status(201).json({
      message: 'Marking scheme uploaded successfully',
      collectionName: 'markingSchemes',
      entry: newEntry
    });
  } catch (error) {
    console.error('Marking scheme upload error:', error);
    res.status(500).json({ error: `Failed to upload marking scheme: ${error.message}` });
  }
});

/**
 * POST /api/admin/json/collections/:collectionName
 * Add a new entry to a JSON collection
 */
router.post('/json/collections/:collectionName', async (req: Request, res: Response) => {
  try {
    const { collectionName } = req.params;
    const entryData = req.body;

    if (!collectionName) {
      return res.status(400).json({ error: 'Collection name is required' });
    }

    if (!entryData) {
      return res.status(400).json({ error: 'Entry data is required' });
    }

    const newEntry = {
      id: uuidv4(),
      ...entryData,
      uploadedAt: new Date().toISOString()
    };

    // Save to Firestore if available
    const db = getFirestore();
    if (db) {
      try {
        await db.collection(collectionName).doc(newEntry.id).set(newEntry);
      } catch (firestoreError) {
        console.error('Firestore save error:', firestoreError);
        // Continue with mock data even if Firestore fails
      }
    }

    // Always save to mock data for fallback
    if (!mockData[collectionName]) {
      mockData[collectionName] = [];
    }
    mockData[collectionName].push(newEntry);

    res.status(201).json({
      message: 'Entry added successfully',
      collectionName,
      entry: newEntry
    });
  } catch (error) {
    console.error('Add entry error:', error);
    res.status(500).json({ error: `Failed to add entry: ${error.message}` });
  }
});

/**
 * DELETE /api/admin/json/collections/:collectionName/:entryId
 * Delete a specific entry from a JSON collection
 */
router.delete('/json/collections/:collectionName/:entryId', async (req: Request, res: Response) => {
  try {
    const { collectionName, entryId } = req.params;

    // Delete from Firestore if available
    const db = getFirestore();
    if (db) {
      try {
        await db.collection(collectionName).doc(entryId).delete();
      } catch (firestoreError) {
        console.error('Firestore delete error:', firestoreError);
        // Continue with mock data even if Firestore fails
      }
    }

    // Delete from mock data
    if (mockData[collectionName]) {
      const index = mockData[collectionName].findIndex(entry => entry.id === entryId);
      if (index !== -1) {
        mockData[collectionName].splice(index, 1);
      }
    }

    res.json({
      message: `Entry deleted successfully`,
      collectionName,
      entryId,
      deleted: true
    });
  } catch (error) {
    console.error('Delete entry error:', error);
    res.status(500).json({ error: `Failed to delete entry: ${error.message}` });
  }
});

/**
 * DELETE /api/admin/json/collections/:collectionName/clear-all
 * Delete all entries from a specific JSON collection
 */
router.delete('/json/collections/:collectionName/clear-all', async (req: Request, res: Response) => {
  try {
    const { collectionName } = req.params;

    // Delete all documents from the specified collection in Firestore
    const db = getFirestore();
    if (db) {
      try {
        const snapshot = await db.collection(collectionName).get();
        const deletePromises = [];
        snapshot.forEach((doc) => {
          deletePromises.push(doc.ref.delete());
        });

        await Promise.all(deletePromises);
      } catch (firestoreError) {
        console.error('Firestore delete error:', firestoreError);
        // Continue with mock data even if Firestore fails
      }
    }

    // Clear mock data
    const deletedCount = mockData[collectionName] ? mockData[collectionName].length : 0;
    if (mockData[collectionName]) {
      mockData[collectionName].length = 0;
    }

    res.json({
      message: `All entries deleted from collection: ${collectionName}`,
      collectionName,
      deletedCount
    });
  } catch (error) {
    console.error('Delete collection error:', error);
    res.status(500).json({ error: `Failed to delete collection: ${error.message}` });
  }
});

/**
 * POST /api/admin/json/upload
 * Upload JSON data to the fullExamPapers collection (convenience endpoint)
 */
router.post('/json/upload', async (req: Request, res: Response) => {
  try {
    const { data } = req.body;

    if (!data) {
      return res.status(400).json({ error: 'JSON data is required' });
    }

    const newEntry = {
      id: uuidv4(),
      ...data,
      uploadedAt: new Date().toISOString()
    };

    // Save to Firestore if available
    const db = getFirestore();
    if (db) {
      try {
        await db.collection('fullExamPapers').doc(newEntry.id).set(newEntry);
      } catch (firestoreError) {
        console.error('Firestore save error:', firestoreError);
        // Continue with mock data even if Firestore fails
      }
    }

    // Always save to mock data for fallback
    if (!mockData['fullExamPapers']) {
      mockData['fullExamPapers'] = [];
    }
    mockData['fullExamPapers'].push(newEntry);

    res.status(201).json({
      message: 'JSON uploaded successfully to fullExamPapers collection',
      entry: newEntry
    });
  } catch (error) {
    console.error('JSON upload error:', error);
    res.status(500).json({ error: `Failed to upload JSON: ${error.message}` });
  }
});

/**
 * DELETE /api/admin/clear-all-sessions
 * Clear all chat sessions from the database
 */
router.delete('/clear-all-sessions', async (req: Request, res: Response) => {
  try {

    const db = getFirestore();
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Firestore not available'
      });
    }

    // Get all sessions from both collections
    const [subjectMarkingResultsSnapshot, unifiedSessionsSnapshot] = await Promise.all([
      db.collection('subjectMarkingResults').get(),
      db.collection('unifiedSessions').get()
    ]);

    const subjectMarkingResultIds = subjectMarkingResultsSnapshot.docs.map(doc => doc.id);
    const unifiedSessionIds = unifiedSessionsSnapshot.docs.map(doc => doc.id);

    const totalSessions = subjectMarkingResultIds.length + unifiedSessionIds.length;

    if (totalSessions === 0) {
      return res.json({
        success: true,
        message: 'No sessions found to delete',
        deletedCount: 0
      });
    }

    // Delete all sessions in batches
    const batchSize = 500; // Firestore batch limit
    let deletedCount = 0;

    // Delete subjectMarkingResults collection
    for (let i = 0; i < subjectMarkingResultIds.length; i += batchSize) {
      const batch = db.batch();
      const batchIds = subjectMarkingResultIds.slice(i, i + batchSize);

      batchIds.forEach(sessionId => {
        const sessionRef = db.collection('subjectMarkingResults').doc(sessionId);
        batch.delete(sessionRef);
      });

      await batch.commit();
      deletedCount += batchIds.length;
    }

    // Delete unified sessions collection
    for (let i = 0; i < unifiedSessionIds.length; i += batchSize) {
      const batch = db.batch();
      const batchIds = unifiedSessionIds.slice(i, i + batchSize);

      batchIds.forEach(sessionId => {
        const sessionRef = db.collection('unifiedSessions').doc(sessionId);
        batch.delete(sessionRef);
      });

      await batch.commit();
      deletedCount += batchIds.length;
    }


    res.json({
      success: true,
      message: `Successfully cleared ${deletedCount} items (${subjectMarkingResultIds.length} subject marking results + ${unifiedSessionIds.length} unified sessions)`,
      deletedCount: deletedCount,
      subjectMarkingResultsDeleted: subjectMarkingResultIds.length,
      unifiedSessionsDeleted: unifiedSessionIds.length
    });

  } catch (error) {
    console.error('❌ Error clearing sessions:', error);
    res.status(500).json({
      success: false,
      error: `Failed to clear sessions: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
});



/**
 * GET /api/admin/usage
 * Get usage statistics from usageRecords collection (optimized for analytics)
 * Query params: ?filter=all|year|month|week|day
 */
router.get('/usage', async (req: Request, res: Response) => {
  try {
    const filter = (req.query.filter as string) || 'all';

    const db = getFirestore();
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Firestore not available'
      });
    }

    // Calculate date range based on filter
    const now = new Date();
    let startDate: Date;

    switch (filter) {
      case 'day': {
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        break;
      }
      case 'week': {
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        break;
      }
      case 'month': {
        startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 1);
        break;
      }
      case 'year': {
        startDate = new Date(now);
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      }
      default: // 'all'
        startDate = new Date(0); // Beginning of time
    }

    // Query usageRecords collection with date filter at database level
    let query = db.collection('usageRecords');

    // Apply date filter if not 'all' - use Firestore query for efficiency
    if (filter !== 'all') {
      const startTimestamp = admin.firestore.Timestamp.fromDate(startDate);
      query = query.where('createdAt', '>=', startTimestamp);
    }

    const snapshot = await query.get();

    // Process usage records
    const usageData: Array<{
      sessionId: string;
      userId: string;
      createdAt: string;
      totalCost: number;
      llmCost: number;
      geminiCost: number;
      gptCost: number;
      mathpixCost: number;
      modelUsed: string;
    }> = [];

    let totalCost = 0;
    let totalLLMCost = 0;
    let totalGeminiCost = 0;
    let totalGptCost = 0;
    let totalMathpixCost = 0;

    snapshot.forEach(doc => {
      const record = doc.data();

      const createdAt = record.createdAt.toDate().toISOString();

      // Handle legacy records that might not have geminiCost/gptCost
      const geminiCost = record.geminiCost ?? 0;
      const gptCost = record.gptCost ?? 0;
      const llmCost = record.llmCost ?? (geminiCost + gptCost);

      usageData.push({
        sessionId: doc.id,
        userId: record.userId,
        createdAt,
        totalCost: record.totalCost,
        llmCost,
        geminiCost,
        gptCost,
        mathpixCost: record.mathpixCost,
        modelUsed: record.modelUsed
      });

      // Update totals
      totalCost += record.totalCost;
      totalLLMCost += llmCost;
      totalGeminiCost += geminiCost;
      totalGptCost += gptCost;
      totalMathpixCost += record.mathpixCost;
    });

    // Sort by totalCost descending
    usageData.sort((a, b) => b.totalCost - a.totalCost);

    // Round totals to 2 decimal places
    totalCost = Math.round(totalCost * 100) / 100;
    totalLLMCost = Math.round(totalLLMCost * 100) / 100;
    totalGeminiCost = Math.round(totalGeminiCost * 100) / 100;
    totalGptCost = Math.round(totalGptCost * 100) / 100;
    totalMathpixCost = Math.round(totalMathpixCost * 100) / 100;

    // Get unique user count
    const uniqueUsers = new Set(usageData.map(session => session.userId));

    res.json({
      success: true,
      filter,
      summary: {
        totalCost,
        totalLLMCost,
        totalGeminiCost,
        totalGptCost,
        totalMathpixCost,
        totalUsers: uniqueUsers.size,
        totalSessions: usageData.length
      },
      usage: usageData
    });

  } catch (error) {
    console.error('❌ Error getting usage statistics:', error);
    res.status(500).json({
      success: false,
      error: `Failed to get usage statistics: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
});

export default router;
