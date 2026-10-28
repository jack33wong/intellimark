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
import { NormalizationService } from '../services/marking/NormalizationService.js';
import { ImageStorageService } from '../services/imageStorageService.js';
const router = express.Router();

/**
 * Helper to validate exam paper questions for 0 marks
 * Returns error message if invalid, null if valid
 */
function validateExamPaper(data: any): string | null {
  const questions = data?.questions;
  if (!Array.isArray(questions)) return null;

  for (const q of questions) {
    const qNum = q.question_number || q.questionNumber || q.number || 'Unknown';
    const marks = parseFloat(q.marks) || 0;

    // Check if it's a leaf node OR if it's a container that MUST have marks
    const subQs = q.sub_questions || q.subQuestions || [];
    if (subQs.length === 0) {
      if (marks === 0) return `Question ${qNum} has 0 marks.`;
    } else {
      // For compound questions, we still require top-level marks to be populated
      // (This was the root cause of the AI's 0 marks issue)
      if (marks === 0) return `Question ${qNum} is a compound question but missing top-level marks.`;

      // Recursively check sub-questions
      for (const sq of subQs) {
        const sqPart = sq.question_part || sq.part || sq.subQuestionNumber || '';
        if ((parseFloat(sq.marks) || 0) === 0) {
          return `Question ${qNum}${sqPart} has 0 marks.`;
        }
      }
    }
  }
  return null;
}

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
  examinerReports: [],
  otherCollections: []
};











/**
 * GET /api/admin/users/:userId/email
 * Fetch a user's email address by their UID (Admin only)
 */
router.get('/users/:userId/email', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    // Fetch user from Firebase Auth
    const userRecord = await admin.auth().getUser(userId);
    res.json({ email: userRecord.email || 'No email associated' });
  } catch (error) {
    console.error('Error fetching user email:', error);
    res.status(500).json({ error: `Failed to fetch user email: ${error.message}` });
  }
});

/**
 * GET /api/admin/json/collections/:collectionName

 * Get all entries from a JSON collection
 */
router.get('/json/collections/:collectionName', async (req: Request, res: Response) => {
  try {
    const { collectionName } = req.params;
    const listOnly = req.query.listOnly === 'true';

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

          if (listOnly) {
            // EXCLUDE large arrays for list view performance
            if (collectionName === 'fullExamPapers') {
              // Pre-calculate total marks before deleting questions
              if (data.questions && Array.isArray(data.questions)) {
                const getQuestionMarksRecursive = (q: any): number => {
                  const pMark = parseFloat(q.marks) || parseFloat(q.max_marks) || parseFloat(q.total_marks) || 0;
                  const subQs = q.subQuestions || q.sub_questions || [];
                  if (!Array.isArray(subQs) || subQs.length === 0) return pMark;
                  const subSum = subQs.reduce((total: number, sq: any) => total + getQuestionMarksRecursive(sq), 0);
                  return Math.max(pMark, subSum);
                };
                data.totalMarks = data.questions.reduce((sum: number, q: any) => sum + getQuestionMarksRecursive(q), 0);
              }
              delete data.questions;
            } else if (collectionName === 'markingSchemes') {
              if (!data.totalMarks && data.questions && typeof data.questions === 'object') {
                const qList = Array.isArray(data.questions) ? data.questions : Object.values(data.questions);
                data.totalQuestions = data.totalQuestions || qList.length;
                data.totalMarks = qList.reduce((sum: number, q: any) => {
                  if (!q) return sum;
                  const explicitMark = Number(q.totalMarks || q.maxMarks || (typeof q.marks === 'number' ? q.marks : 0));
                  if (explicitMark > 0) return sum + explicitMark;
                  if (Array.isArray(q.marks)) return sum + q.marks.length;
                  return sum;
                }, 0);
              }
              delete data.questions; // markingSchemes has questions as an object or array depending on version
              delete data.markingSchemeData; // Also potentially large
            } else if (collectionName === 'examinerReports') {
              if (!data.totalQuestions && data.questions && typeof data.questions === 'object') {
                const qList = Array.isArray(data.questions) ? data.questions : Object.keys(data.questions);
                data.totalQuestions = qList.length;
              }
              delete data.questions;
            }
          }

          const examMeta = data.exam || data.metadata || (data.examDetails || {});
          const board = examMeta.board || examMeta.exam_board || '';
          const series = examMeta.exam_series || examMeta.date || '';
          const normalizedSeries = series ? NormalizationService.normalizeExamSeries(series, board) : series;

          const entry = {
            id: doc.id,
            ...data,
            normalizedSeries,
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
 * GET /api/admin/json/collections/:collectionName/:id
 * Get a specific entry from a JSON collection by ID
 */
router.get('/json/collections/:collectionName/:id', async (req: Request, res: Response) => {
  try {
    const { collectionName, id } = req.params;

    if (!collectionName || !id) {
      return res.status(400).json({ error: 'Collection name and ID are required' });
    }

    const db = getFirestore();
    if (db) {
      try {
        const doc = await db.collection(collectionName).doc(id).get();
        if (!doc.exists) {
          // Fallback to mock data if not found in db
          const mockEntries = mockData[collectionName] || [];
          const mockEntry = mockEntries.find(e => e.id === id);
          if (mockEntry) return res.json({ entry: mockEntry });
          return res.status(404).json({ error: 'Document not found' });
        }

        const data = doc.data();
        const examMeta = data?.exam || data?.metadata || (data?.examDetails || {});
        const board = examMeta.board || examMeta.exam_board || '';
        const series = examMeta.exam_series || examMeta.date || '';
        const normalizedSeries = series ? NormalizationService.normalizeExamSeries(series, board) : series;

        res.json({
          entry: {
            id: doc.id,
            ...data,
            normalizedSeries,
            uploadedAt: data?.uploadedAt ?
              (typeof data.uploadedAt === 'string' ? data.uploadedAt : data.uploadedAt.toDate().toISOString()) :
              new Date().toISOString()
          }
        });
      } catch (err) {
        console.error('Firestore fetch by ID error:', err);
        return res.status(500).json({ error: 'Database fetch error' });
      }
    } else {
      const mockEntries = mockData[collectionName] || [];
      const mockEntry = mockEntries.find(e => e.id === id);
      if (mockEntry) {
        return res.json({ entry: mockEntry });
      } else {
        return res.status(404).json({ error: 'Document not found in mock data' });
      }
    }
  } catch (error) {
    console.error('Get individual entry error:', error);
    res.status(500).json({ error: `Failed to get entry: ${error.message}` });
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
    const totalMarks = parsedData.totalMarks || questionNumbers.reduce((total, qNum) => {
      const question = questions[qNum];
      if (!question) return total;
      if (typeof question.totalMarks === 'number' && question.totalMarks > 0) {
        return total + question.totalMarks;
      }
      if (typeof question.maxMarks === 'number' && question.maxMarks > 0) {
        return total + question.maxMarks;
      }
      if (typeof question.marks === 'number' && question.marks > 0) {
        return total + question.marks;
      }
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
 * POST /api/admin/json/collections/examinerReports
 * Upload examiner report data (specific endpoint for examiner reports)
 */
router.post('/json/collections/examinerReports', async (req: Request, res: Response) => {
  try {
    const rawInput = req.body.examinerReportData || req.body.data || req.body;

    if (!rawInput) {
      return res.status(400).json({ error: 'Examiner report data is required' });
    }

    let parsedData;
    try {
      parsedData = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    } catch (parseError) {
      return res.status(400).json({ error: 'Invalid JSON format in examiner report data' });
    }

    // Support uploading wrapper object with top-level examinerReport key
    if (parsedData.examinerReport && typeof parsedData.examinerReport === 'object' && parsedData.examinerReport.examDetails) {
      parsedData = parsedData.examinerReport;
    }

    const examDetails = parsedData.examDetails || parsedData.metadata || {};
    const questions = parsedData.questions || {};
    const questionKeys = Array.isArray(questions) ? questions.map((_, idx) => String(idx + 1)) : Object.keys(questions);
    const totalQuestions = parsedData.totalQuestions || questionKeys.length;

    const newEntry = {
      id: parsedData.id || uuidv4(),
      ...parsedData,
      examDetails: {
        board: examDetails.board || examDetails.exam_board || 'Unknown',
        qualification: examDetails.qualification || 'GCSE',
        subject: examDetails.subject || 'English Language',
        paperCode: examDetails.paperCode || examDetails.exam_code || 'Unknown',
        tier: examDetails.tier || 'N/A',
        paper: examDetails.paper || examDetails.paper_title || 'Unknown',
        exam_series: examDetails.exam_series || examDetails.date || 'Unknown'
      },
      totalQuestions,
      uploadedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    const db = getFirestore();
    if (db) {
      try {
        await db.collection('examinerReports').doc(newEntry.id).set(newEntry);
      } catch (firestoreError) {
        console.error('Firestore save error (examinerReports):', firestoreError);
      }
    }

    if (!mockData['examinerReports']) {
      mockData['examinerReports'] = [];
    }
    mockData['examinerReports'].push(newEntry);

    res.status(201).json({
      message: 'Examiner report uploaded successfully',
      collectionName: 'examinerReports',
      entry: newEntry
    });
  } catch (error) {
    console.error('Examiner report upload error:', error);
    res.status(500).json({ error: `Failed to upload examiner report: ${error.message}` });
  }
});

/**
 * POST /api/admin/json/collections/gradeBoundaries
 * Add or append to grade boundary data
 * If a record with the same year, same exam board, and same qualification exists, append/merge subjects into it.
 */
router.post('/json/collections/gradeBoundaries', async (req: Request, res: Response) => {
  try {
    const rawData = req.body;
    if (!rawData) {
      return res.status(400).json({ error: 'Grade boundary data is required' });
    }

    let parsedData: any;
    try {
      parsedData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch (parseError: any) {
      return res.status(400).json({ error: `Invalid JSON format: ${parseError.message}` });
    }

    // Helper: normalize qualification for comparison
    const normalizeQual = (qual: string): string => {
      const q = (qual || '').trim().toLowerCase().replace(/[\s\-_]/g, '');
      if (q.includes('igcse') || q.includes('internationalgcse')) return 'igcse';
      if (q.includes('gcse')) return 'gcse';
      if (q.includes('alevel') || q.includes('gce')) return 'alevel';
      return q;
    };

    // Helper: extract 4-digit year
    const extractYear = (data: any): string | null => {
      if (data.year) {
        const match = String(data.year).match(/\b(20\d{2}|19\d{2})\b/);
        if (match) return match[1];
      }
      const series = data.exam_series || data.series || data.examSeries || data.date || '';
      const match = String(series).match(/\b(20\d{2}|19\d{2})\b/);
      if (match) return match[1];
      return null;
    };

    // Extract incoming key fields
    const incomingBoardRaw = parsedData.exam_board || parsedData.board || parsedData.examBoard || '';
    const incomingBoard = NormalizationService.normalizeExamBoard(incomingBoardRaw);
    const incomingQualRaw = parsedData.qualification || parsedData.level || parsedData.qual || '';
    const incomingQual = normalizeQual(incomingQualRaw);
    const incomingYear = extractYear(parsedData);
    const incomingSeriesRaw = parsedData.exam_series || parsedData.series || parsedData.examSeries || '';
    const incomingSeriesNorm = incomingSeriesRaw ? NormalizationService.normalizeExamSeries(incomingSeriesRaw, incomingBoard) : '';

    // Extract incoming subjects
    let incomingSubjects: any[] = [];
    if (Array.isArray(parsedData.subjects)) {
      incomingSubjects = parsedData.subjects;
    } else if (parsedData.subjects && typeof parsedData.subjects === 'object') {
      incomingSubjects = [parsedData.subjects];
    } else if (parsedData.name && (parsedData.tiers || parsedData.max_mark)) {
      incomingSubjects = [parsedData];
    }

    const db = getFirestore();
    let existingMatchDoc: any = null;
    let existingMatchRef: any = null;

    if (db && incomingBoard && incomingQual && incomingYear) {
      try {
        const snapshot = await db.collection('gradeBoundaries').get();
        let bestMatch: any = null;
        let bestScore = 0;

        snapshot.forEach(doc => {
          const docData = doc.data();
          const docBoard = NormalizationService.normalizeExamBoard(docData.exam_board || docData.board || docData.examBoard || '');
          const docQual = normalizeQual(docData.qualification || docData.level || docData.qual || '');
          const docYear = extractYear(docData);

          // 1. Board Match
          const boardMatch = docBoard && incomingBoard && (
            docBoard.toLowerCase() === incomingBoard.toLowerCase() ||
            docBoard.toLowerCase().includes(incomingBoard.toLowerCase()) ||
            incomingBoard.toLowerCase().includes(docBoard.toLowerCase())
          );
          if (!boardMatch) return;

          // 2. Qualification Match
          const qualMatch = docQual && incomingQual && (docQual === incomingQual);
          if (!qualMatch) return;

          // 3. Year Match
          const yearMatch = docYear && incomingYear && (docYear === incomingYear);
          if (!yearMatch) return;

          // Compute matching score: prioritize same series (e.g. Summer/June vs November)
          let score = 5;
          const docSeriesRaw = docData.exam_series || docData.series || docData.examSeries || '';
          const docSeriesNorm = docSeriesRaw ? NormalizationService.normalizeExamSeries(docSeriesRaw, docBoard) : '';
          if (incomingSeriesNorm && docSeriesNorm && incomingSeriesNorm.toLowerCase() === docSeriesNorm.toLowerCase()) {
            score = 10;
          }

          if (score > bestScore) {
            bestScore = score;
            bestMatch = { id: doc.id, ref: doc.ref, data: docData };
          }
        });

        if (bestMatch) {
          existingMatchDoc = bestMatch.data;
          existingMatchDoc.id = bestMatch.id;
          existingMatchRef = bestMatch.ref;
        }
      } catch (queryError) {
        console.error('Error finding existing grade boundary in Firestore:', queryError);
      }
    }

    // Also check mockData if no Firestore match
    if (!existingMatchDoc && mockData['gradeBoundaries'] && incomingBoard && incomingQual && incomingYear) {
      const match = mockData['gradeBoundaries'].find((entry: any) => {
        const docBoard = NormalizationService.normalizeExamBoard(entry.exam_board || entry.board || entry.examBoard || '');
        const docQual = normalizeQual(entry.qualification || entry.level || entry.qual || '');
        const docYear = extractYear(entry);
        const boardMatch = docBoard && incomingBoard && (
          docBoard.toLowerCase() === incomingBoard.toLowerCase() ||
          docBoard.toLowerCase().includes(incomingBoard.toLowerCase()) ||
          incomingBoard.toLowerCase().includes(docBoard.toLowerCase())
        );
        const qualMatch = docQual && incomingQual && (docQual === incomingQual);
        const yearMatch = docYear && incomingYear && (docYear === incomingYear);
        return boardMatch && qualMatch && yearMatch;
      });
      if (match) {
        existingMatchDoc = match;
      }
    }

    if (existingMatchDoc) {
      // System should APPEND to the existing record
      const existingSubjects: any[] = Array.isArray(existingMatchDoc.subjects) ? [...existingMatchDoc.subjects] : [];

      incomingSubjects.forEach((inSubj: any) => {
        const inCode = inSubj.code ? String(inSubj.code).trim().toLowerCase() : '';
        const inName = inSubj.name ? String(inSubj.name).trim().toLowerCase() : '';

        const subjIdx = existingSubjects.findIndex((s: any) => {
          const sCode = s.code ? String(s.code).trim().toLowerCase() : '';
          const sName = s.name ? String(s.name).trim().toLowerCase() : '';
          if (inCode && sCode && inCode === sCode) return true;
          if (inName && sName && inName === sName) return true;
          return false;
        });

        if (subjIdx >= 0) {
          // Subject exists: merge tiers or update subject definition
          const existingSubj = existingSubjects[subjIdx];
          const existingTiers = Array.isArray(existingSubj.tiers) ? [...existingSubj.tiers] : [];
          const inTiers = Array.isArray(inSubj.tiers) ? inSubj.tiers : [];

          inTiers.forEach((inTier: any) => {
            const inTierLevel = String(inTier.tier_level || '').trim().toLowerCase();
            const tierIdx = existingTiers.findIndex((t: any) =>
              String(t.tier_level || '').trim().toLowerCase() === inTierLevel
            );
            if (tierIdx >= 0) {
              existingTiers[tierIdx] = { ...existingTiers[tierIdx], ...inTier };
            } else {
              existingTiers.push(inTier);
            }
          });

          existingSubjects[subjIdx] = {
            ...existingSubj,
            ...inSubj,
            tiers: existingTiers.length > 0 ? existingTiers : (inSubj.tiers || existingSubj.tiers)
          };
        } else {
          // New subject: APPEND to subjects array!
          existingSubjects.push(inSubj);
        }
      });

      const updatedEntry = {
        ...existingMatchDoc,
        subjects: existingSubjects,
        updatedAt: new Date().toISOString(),
        lastAppendedAt: new Date().toISOString()
      };

      if (existingMatchRef) {
        await existingMatchRef.set(updatedEntry, { merge: true });
      }

      // Update mockData if present
      if (mockData['gradeBoundaries']) {
        const mockIdx = mockData['gradeBoundaries'].findIndex((e: any) => e.id === existingMatchDoc.id);
        if (mockIdx >= 0) {
          mockData['gradeBoundaries'][mockIdx] = updatedEntry;
        }
      }

      console.log(`✅ [GRADE BOUNDARY] Appended ${incomingSubjects.length} subject(s) to existing document ${existingMatchDoc.id} (${updatedEntry.exam_board} ${updatedEntry.qualification} ${updatedEntry.exam_series})`);

      return res.status(200).json({
        message: `Grade boundary appended successfully to existing record (${updatedEntry.exam_board} ${updatedEntry.qualification} ${updatedEntry.exam_series || ''})`,
        collectionName: 'gradeBoundaries',
        action: 'appended',
        entry: {
          ...updatedEntry,
          normalizedSeries: NormalizationService.normalizeExamSeries(
            updatedEntry.exam_series || '',
            updatedEntry.exam_board || ''
          )
        }
      });
    }

    // No existing matching record found -> CREATE NEW RECORD
    const newEntry = {
      id: uuidv4(),
      ...parsedData,
      subjects: incomingSubjects,
      uploadedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    if (db) {
      try {
        await db.collection('gradeBoundaries').doc(newEntry.id).set(newEntry);
      } catch (firestoreError) {
        console.error('Firestore save error:', firestoreError);
      }
    }

    if (!mockData['gradeBoundaries']) {
      mockData['gradeBoundaries'] = [];
    }
    mockData['gradeBoundaries'].push(newEntry);

    console.log(`✅ [GRADE BOUNDARY] Created new document ${newEntry.id} (${newEntry.exam_board} ${newEntry.qualification} ${newEntry.exam_series})`);

    return res.status(201).json({
      message: 'Grade boundary uploaded successfully',
      collectionName: 'gradeBoundaries',
      action: 'created',
      entry: {
        ...newEntry,
        normalizedSeries: NormalizationService.normalizeExamSeries(
          newEntry.exam_series || '',
          newEntry.exam_board || ''
        )
      }
    });
  } catch (error: any) {
    console.error('Grade boundary upload error:', error);
    res.status(500).json({ error: `Failed to upload grade boundary: ${error.message}` });
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
      // 🛡️ Strict Validation for Full Exam Papers
      if (collectionName === 'fullExamPapers') {
        const validationError = validateExamPaper(newEntry);
        if (validationError) {
          return res.status(400).json({ error: `Validation Failed: ${validationError}` });
        }
      }

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
 * PATCH /api/admin/json/collections/:collectionName/:entryId
 * Update a specific entry in a JSON collection
 */
router.patch('/json/collections/:collectionName/:entryId', async (req: Request, res: Response) => {
  try {
    const { collectionName, entryId } = req.params;
    const updateData = req.body;

    if (!updateData) {
      return res.status(400).json({ error: 'Update data is required' });
    }

    // Update in Firestore if available
    const db = getFirestore();
    if (db) {
      try {
        const docRef = db.collection(collectionName).doc(entryId);
        const doc = await docRef.get();

        if (!doc.exists) {
          return res.status(404).json({ error: 'Entry not found' });
        }

        // Merge update data
        await docRef.set({
          ...updateData,
          updatedAt: new Date().toISOString()
        }, { merge: true });

      } catch (firestoreError) {
        console.error('Firestore update error:', firestoreError);
        // Continue with mock data
      }
    }

    // Update in mock data
    if (mockData[collectionName]) {
      const index = mockData[collectionName].findIndex(entry => entry.id === entryId);
      if (index !== -1) {
        mockData[collectionName][index] = {
          ...mockData[collectionName][index],
          ...updateData,
          updatedAt: new Date().toISOString()
        };
      }
    }

    res.json({
      message: 'Entry updated successfully',
      collectionName,
      entryId
    });
  } catch (error) {
    console.error('Update entry error:', error);
    res.status(500).json({ error: `Failed to update entry: ${error.message}` });
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
      // 🛡️ Strict Validation
      const validationError = validateExamPaper(newEntry);
      if (validationError) {
        return res.status(400).json({ error: `Validation Failed: ${validationError}` });
      }

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
 * PATCH /api/admin/json/collections/fullExamPapers/:id/relationship-status
 * Update the relationship status (mismatches, grade boundaries) for an exam paper
 */
router.patch('/json/collections/fullExamPapers/:id/relationship-status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { relationshipStatus } = req.body;

    if (relationshipStatus === undefined) {
      return res.status(400).json({ error: 'relationshipStatus is required' });
    }

    const db = getFirestore();
    if (!db) {
      return res.status(500).json({ error: 'Firestore not available' });
    }

    await db.collection('fullExamPapers').doc(id).update({
      relationshipStatus,
      lastStatusUpdate: new Date().toISOString()
    });

    res.json({ message: 'Relationship status updated successfully' });
  } catch (error) {
    console.error('Update relationship status error:', error);
    res.status(500).json({ error: `Failed to update relationship status: ${error.message}` });
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

    // Extract admin user ID
    const uid = (req as any).user?.uid;
    if (!uid) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: User ID not found'
      });
    }

    // Get all sessions from both collections belonging to this admin
    const [subjectMarkingResultsSnapshot, unifiedSessionsSnapshot] = await Promise.all([
      db.collection('subjectMarkingResults').where('userId', '==', uid).get(),
      db.collection('unifiedSessions').where('userId', '==', uid).get()
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

    // Purge associated images in Firebase Storage for this admin
    try {
      await ImageStorageService.deleteUserImages(uid);
      console.log(`🧹 Successfully cleared Firebase Storage images for admin user: ${uid}`);
    } catch (imageError) {
      console.error(`❌ Error clearing images for admin user ${uid}:`, imageError);
      // We don't fail the request if image deletion fails, we just log it
    }

    res.json({
      success: true,
      message: `Successfully cleared ${deletedCount} items for your account (${subjectMarkingResultIds.length} subject marking results + ${unifiedSessionIds.length} unified sessions) and purged associated images`,
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

    // Group transactions by userId (User-Centric view)
    const usersMap = new Map<string, any>();
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

      const userId = tx.userId || 'guest';
      const interactionCost = tx.totalCost || 0;
      const interactionModelCost = tx.costBreakdown?.llmCost || 0;
      const interactionMathpixCost = tx.costBreakdown?.mathpixCost || 0;
      const txDateIso = txTimestamp.toISOString();

      if (!usersMap.has(userId)) {
        usersMap.set(userId, {
          userId,
          email: userId, // Default to userId, will override with email later
          totalCost: 0,
          modelCost: 0,
          mathpixCost: 0,
          apiRequests: 0,
          sessionIds: new Set(),
          sessionEngagements: new Map<string, any>(),
          lastActive: txDateIso,
          paywallHits: 0,
          churnReason: 'None'
        });
      }

      const userStats = usersMap.get(userId)!;
      userStats.totalCost += interactionCost;
      userStats.modelCost += interactionModelCost;
      userStats.mathpixCost += interactionMathpixCost;
      userStats.apiRequests += 1;
      if (tx.sessionId) {
        userStats.sessionIds.add(tx.sessionId);
        if (tx.engagement && !userStats.sessionEngagements.has(tx.sessionId)) {
          userStats.sessionEngagements.set(tx.sessionId, tx.engagement);
        }
      }

      if (new Date(txDateIso) > new Date(userStats.lastActive)) {
          userStats.lastActive = txDateIso;
      }

      // Update global totals
      totalCost += interactionCost;
      totalModelCost += interactionModelCost;
      totalMathpixCost += interactionMathpixCost;
      totalApiRequests += 1;
    });

    // Fetch Telemetry to map drop-offs (with time boundaries)
    try {
      const telemetrySnapshot = await db.collection('telemetry_events').get();
      telemetrySnapshot.forEach(doc => {
          const data = doc.data();
          const txTimestamp = data.createdAt?.toDate ? data.createdAt.toDate() : new Date();
          const txTime = txTimestamp.getTime();
          
          if (filter !== 'all') {
              if (txTime < startTime || txTime >= endTime) return;
          }

          if (data.userId && usersMap.has(data.userId)) {
              const userStats = usersMap.get(data.userId)!;
              if (data.eventType === 'paywall_viewed') {
                  userStats.paywallHits += 1;
              }
              if (data.eventType === 'exit_survey_submitted') {
                  userStats.churnReason = data.metadata?.reason || 'Unknown';
              }
          }
      });

      const feedbackSnapshot = await db.collection('marking_feedback').get();
      console.log(`[DEBUG] Fetched ${feedbackSnapshot.size} marking_feedback documents`);
      feedbackSnapshot.forEach(doc => {
          const data = doc.data();
          console.log(`[DEBUG] Feedback Doc: userId=${data.userId}, stars=${data.stars}, createdAt=${data.createdAt}`);
          const txTimestamp = data.createdAt?.toDate ? data.createdAt.toDate() : new Date();
          const txTime = txTimestamp.getTime();

          if (filter !== 'all') {
              if (txTime < startTime || txTime >= endTime) {
                  console.log(`[DEBUG] -> Excluded by date filter (txTime=${txTime}, start=${startTime}, end=${endTime})`);
                  return;
              }
          }

          if (data.userId && usersMap.has(data.userId)) {
              console.log(`[DEBUG] -> Matched to user: ${data.userId}`);
              const userStats = usersMap.get(data.userId)!;
              if (!userStats.feedback) userStats.feedback = [];
              userStats.feedback.push({ stars: data.stars || 0, tags: data.tags || [] });
          } else {
              console.log(`[DEBUG] -> User not in usersMap: ${data.userId}`);
          }
      });
    } catch(e) {
      console.warn("Failed to fetch telemetry events", e);
    }

    // Resolve UIDs to Emails
    const userIdsToResolve = Array.from(usersMap.keys()).filter(id => id && id !== 'guest' && id !== 'anonymous');
    
    // Batch resolve in chunks of 100
    for (let i = 0; i < userIdsToResolve.length; i += 100) {
        const chunk = userIdsToResolve.slice(i, i + 100);
        const identifiers = chunk.map(uid => ({ uid }));
        try {
            const result = await admin.auth().getUsers(identifiers);
            result.users.forEach(userRecord => {
                if (usersMap.has(userRecord.uid)) {
                    usersMap.get(userRecord.uid)!.email = userRecord.email || userRecord.uid;
                }
            });
        } catch (e) {
            console.error("Failed to resolve user emails chunk:", e);
        }
    }

    // Backfill any missing session engagements from unifiedSessions
    try {
      const missingSessionToUser = new Map<string, string>();
      usersMap.forEach((u) => {
        u.sessionIds.forEach((sid: string) => {
          if (sid && !u.sessionEngagements.has(sid)) {
            missingSessionToUser.set(sid, u.userId);
          }
        });
      });

      const missingIds = Array.from(missingSessionToUser.keys());
      for (let i = 0; i < missingIds.length; i += 30) {
        const chunk = missingIds.slice(i, i + 30);
        const refs = chunk.map(sid => db.collection('unifiedSessions').doc(sid));
        const docs = await db.getAll(...refs);
        docs.forEach(d => {
          if (d.exists) {
            const eng = d.data()?.sessionStats?.engagement;
            const uid = missingSessionToUser.get(d.id);
            if (eng && uid && usersMap.has(uid)) {
              usersMap.get(uid)!.sessionEngagements.set(d.id, eng);
            }
          }
        });
      }
    } catch (e) {
      console.warn('Failed to backfill session engagement from unifiedSessions:', e);
    }

    const usageData = Array.from(usersMap.values()).map(u => {
        let avgRating = 0;
        let feedbackReasons: string[] = [];
        
        if (u.feedback && u.feedback.length > 0) {
            avgRating = u.feedback.reduce((sum: number, f: any) => sum + (f.stars || 0), 0) / u.feedback.length;
            
            // Extract and count all tags across all feedback
            const tagsMap = new Map<string, number>();
            u.feedback.forEach((f: any) => {
                if (f.tags && Array.isArray(f.tags)) {
                    f.tags.forEach((tag: string) => {
                        tagsMap.set(tag, (tagsMap.get(tag) || 0) + 1);
                    });
                }
            });
            
            // Format as "2x Accuracy issues, 1x Math errors"
            feedbackReasons = Array.from(tagsMap.entries()).map(([tag, count]) => `${count}x ${tag}`);
        }

        // Aggregate engagement across this user's sessions
        const engEntries: Array<[string, any]> = Array.from(u.sessionEngagements?.entries() || []);
        let engagement: any = null;
        if (engEntries.length > 0) {
          let totalActiveSec = 0;
          let uniquePagesViewed = 0;
          let totalPages = 0;
          let openedSplitMode = false;
          let questionNavClicks = 0;
          let summaryChipClicks = 0;
          const mergedDwell: Record<string, number> = {};

          engEntries.forEach(([, eng], idx) => {
            totalActiveSec += Number(eng.totalActiveSec) || 0;
            uniquePagesViewed += Number(eng.uniquePagesViewed) || 0;
            totalPages += Number(eng.totalPages) || 0;
            if (eng.openedSplitMode) openedSplitMode = true;
            questionNavClicks += Number(eng.questionNavClicks) || 0;
            summaryChipClicks += Number(eng.summaryChipClicks) || 0;
            if (eng.pageDwellSec && typeof eng.pageDwellSec === 'object') {
              Object.entries(eng.pageDwellSec).forEach(([k, v]) => {
                const key = engEntries.length > 1 ? `S${idx + 1}.${k}` : k;
                mergedDwell[key] = Math.round((Number(v) || 0) * 10) / 10;
              });
            }
          });

          totalActiveSec = Math.round(totalActiveSec * 10) / 10;
          totalPages = Math.max(1, totalPages);
          uniquePagesViewed = Math.min(totalPages, uniquePagesViewed);
          const coveragePct = Math.min(100, Math.round((uniquePagesViewed / totalPages) * 100));

          engagement = {
            totalActiveSec,
            uniquePagesViewed,
            totalPages,
            coveragePct,
            viewedAllPages: uniquePagesViewed >= totalPages,
            openedSplitMode,
            questionNavClicks,
            summaryChipClicks,
            pageDwellSec: mergedDwell,
            sessionsTracked: engEntries.length
          };
        }

        const { sessionEngagements, ...restUser } = u;
        return {
            ...restUser,
            avgRating,
            feedbackReasons: feedbackReasons.length > 0 ? feedbackReasons.join(' | ') : '',
            sessionCount: u.sessionIds.size,
            sessionIds: Array.from(u.sessionIds), // Set cannot be JSON serialized directly
            engagement
        };
    });

    // Sort by date descending (newest first)
    usageData.sort((a, b) => {
      const dateA = new Date(a.lastActive).getTime();
      const dateB = new Date(b.lastActive).getTime();
      return dateB - dateA;
    });

    // Round totals to 2 decimal places
    totalCost = Math.round(totalCost * 100) / 100;
    totalModelCost = Math.round(totalModelCost * 100) / 100;
    totalMathpixCost = Math.round(totalMathpixCost * 100) / 100;

    // Get unique user count
    const uniqueUsers = new Set(usageData.map(session => session.userId));

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
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
