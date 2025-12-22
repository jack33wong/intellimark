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
    let endDate: Date | undefined;

    switch (filter) {
      case 'day': {
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        break;
      }
      case 'yesterday': {
        // Yesterday: from start of yesterday to start of today
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 1);
        startDate.setHours(0, 0, 0, 0);

        endDate = new Date(now);
        endDate.setHours(0, 0, 0, 0);
        break;
      }
      case 'week': {
        // This week: from start of current week (Monday) to now
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        const dayOfWeek = startDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convert Sunday (0) to 6 days back
        startDate.setDate(startDate.getDate() - daysToMonday);
        break;
      }
      case 'month': {
        // This month: from 1st of current month to now
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        startDate.setDate(1); // First day of current month
        break;
      }
      case 'year': {
        // Year to date: from January 1st of current year to now
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        startDate.setDate(1);
        startDate.setMonth(0); // January (month 0)
        break;
      }
      default: // 'all'
        startDate = new Date(0); // Beginning of time
    }

    // Query usageTransactions collection
    // Note: Filtering by date in-memory to avoid index requirement
    const query = db.collection('usageTransactions');
    const snapshot = await query.get();

    // Calculate start/end bounds for in-memory filtering
    const startTime = startDate.getTime();
    const endTime = endDate ? endDate.getTime() : Infinity;

    // Group transactions by sessionId (Global view)
    const sessionsMap = new Map<string, any>();
    let totalCost = 0;
    let totalModelCost = 0;
    let totalMathpixCost = 0;
    let totalApiRequests = 0;

    snapshot.forEach(doc => {
      const tx = doc.data();
      const txTimestamp = tx.timestamp?.toDate ? tx.timestamp.toDate() : new Date();
      const txTime = txTimestamp.getTime();

      // Apply in-memory date filter
      if (filter !== 'all') {
        if (txTime < startTime || txTime >= endTime) return;
      }

      const sessionId = tx.sessionId;
      const interactionCost = tx.totalCost || 0;
      const interactionModelCost = tx.costBreakdown?.llmCost || 0;
      const interactionMathpixCost = tx.costBreakdown?.mathpixCost || 0;
      const createdAt = txTimestamp.toISOString();

      if (!sessionsMap.has(sessionId)) {
        sessionsMap.set(sessionId, {
          sessionId,
          userId: tx.userId,
          createdAt,
          totalCost: 0,
          modelCost: 0,
          mathpixCost: 0,
          modelUsed: tx.modelUsed,
          apiRequests: 0,
          mode: tx.mode,
          modeHistory: []
        });
      }

      const session = sessionsMap.get(sessionId);
      session.totalCost += interactionCost;
      session.modelCost += interactionModelCost;
      session.mathpixCost += interactionMathpixCost;
      session.apiRequests += 1;

      // Update session totals based on latest interaction
      if (new Date(createdAt) > new Date(session.createdAt)) {
        session.mode = tx.mode;
        session.modelUsed = tx.modelUsed;
      }

      // Update global totals
      totalCost += interactionCost;
      totalModelCost += interactionModelCost;
      totalMathpixCost += interactionMathpixCost;
      totalApiRequests += 1;
    });

    const usageData = Array.from(sessionsMap.values());

    // Sort by date descending (newest first)
    usageData.sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA;
    });

    // Round totals to 2 decimal places
    totalCost = Math.round(totalCost * 100) / 100;
    totalModelCost = Math.round(totalModelCost * 100) / 100;
    totalMathpixCost = Math.round(totalMathpixCost * 100) / 100;

    // Get unique user count
    const uniqueUsers = new Set(usageData.map(session => session.userId));

    res.json({
      success: true,
      filter,
      summary: {
        totalCost,
        totalModelCost,
        totalMathpixCost,
        totalUsers: uniqueUsers.size,
        totalSessions: usageData.length,
        totalApiRequests
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

/**
 * DELETE /api/admin/usage/clear-all
 * Clear all usage records
 */
router.delete('/usage/clear-all', async (req: Request, res: Response) => {
  try {
    const db = getFirestore();
    if (!db) {
      return res.status(500).json({
        success: false,
        error: 'Firestore not available'
      });
    }

    const [recordsSnapshot, transactionsSnapshot] = await Promise.all([
      db.collection('usageRecords').get(),
      db.collection('usageTransactions').get()
    ]);

    if (recordsSnapshot.empty && transactionsSnapshot.empty) {
      return res.json({
        success: true,
        message: 'No usage records or transactions to delete',
        deletedCount: 0
      });
    }

    const batchSize = 500;
    let deletedCount = 0;
    const batches = [];
    let batch = db.batch();
    let count = 0;

    // Delete legacy records
    recordsSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
      count++;
      if (count === batchSize) {
        batches.push(batch.commit());
        batch = db.batch();
        count = 0;
      }
    });

    // Delete new transactions
    transactionsSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
      count++;
      if (count === batchSize) {
        batches.push(batch.commit());
        batch = db.batch();
        count = 0;
      }
    });

    if (count > 0) {
      batches.push(batch.commit());
    }

    await Promise.all(batches);
    deletedCount = recordsSnapshot.size + transactionsSnapshot.size;

    res.json({
      success: true,
      message: `Successfully deleted ${deletedCount} items (${recordsSnapshot.size} records + ${transactionsSnapshot.size} transactions)`,
      deletedCount
    });

  } catch (error) {
    console.error('❌ Error clearing usage records:', error);
    res.status(500).json({
      success: false,
      error: `Failed to clear usage records: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
});

export default router;
