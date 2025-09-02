/**
 * Admin Routes
 * Handles administrative functions like PDF uploads, JSON management, and system operations
 */

import * as express from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { requireAdmin } from '../middleware/auth.ts';

// Import Firebase instances from centralized config
import { getFirestore, getFirebaseAdmin } from '../config/firebase.ts';

const router = express.Router();

// Apply admin authentication to all admin routes
router.use(requireAdmin);

// Types
interface PastPaper {
  id: string;
  originalName: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  uploadedAt: string;
  updatedAt?: string;
  examBoard: string;
  year: string;
  tier: string;
  paper: string;
  code: string;
  questions: any[];
  questionCount: number;
  subQuestionCount: number;
}

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

// In-memory storage for past papers (fallback when Firestore is unavailable)
let pastPapers: PastPaper[] = [];

// In-memory storage for JSON collections
const mockData: { [key: string]: any[] } = {
  fullExamPapers: [],
  questionBanks: [],
  otherCollections: []
};

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const examBoard = req.body.examBoard || 'Unknown';
    const year = req.body.year || 'Unknown';
    const uploadPath = path.join(__dirname, '../uploads', examBoard, year);
    
    // Create directory if it doesn't exist
    fs.mkdir(uploadPath, { recursive: true })
      .then(() => cb(null, uploadPath))
      .catch(err => cb(err, uploadPath));
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

/**
 * GET /api/admin/past-papers
 * Get all past papers
 */
router.get('/past-papers', async (req: Request, res: Response) => {
  try {
    let papers = [];
    
    // Try to get from Firestore first
    const db = getFirestore();
    if (db) {
      try {
        const snapshot = await db.collection('pastPapers').get();
        papers = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            ...data,
            uploadedAt: data.uploadedAt ? 
              (typeof data.uploadedAt === 'string' ? data.uploadedAt : data.uploadedAt.toDate().toISOString()) : 
              new Date().toISOString(),
            updatedAt: data.updatedAt ? 
              (typeof data.updatedAt === 'string' ? data.updatedAt : data.updatedAt.toDate().toISOString()) : 
              undefined
          };
        });
        console.log(`Retrieved ${papers.length} papers from Firestore`);
      } catch (firestoreError) {
        console.error('Firestore fetch error:', firestoreError);
        // Fallback to local storage
        papers = pastPapers;
        console.log('Using local storage fallback');
      }
    } else {
      // Use local storage when Firestore is not available
      papers = pastPapers;
      console.log('Firebase not available, using local storage');
    }
    
    res.json({
      pastPapers: papers,
      total: papers.length
    });
  } catch (error) {
    console.error('Get past papers error:', error);
    res.status(500).json({ error: `Failed to get past papers: ${error.message}` });
  }
});

/**
 * POST /api/admin/past-papers/upload
 * Upload a new past paper PDF
 */
router.post('/past-papers/upload', upload.single('pdf'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    const { examBoard, year, tier, paper, code } = req.body;
    
    if (!examBoard || !year || !tier || !paper || !code) {
      return res.status(400).json({ 
        error: 'Missing required fields: examBoard, year, tier, paper, code' 
      });
    }

    const newFilePath = req.file.path;
    const pastPaper: PastPaper = {
      id: uuidv4(),
      originalName: req.file.originalname,
      fileName: req.file.filename,
      filePath: newFilePath,
      fileSize: req.file.size,
      uploadedAt: new Date().toISOString(),
      examBoard,
      year,
      tier,
      paper,
      code,
      questions: [],
      questionCount: 0,
      subQuestionCount: 0
    };

    console.log('Created past paper object:', pastPaper);
    
    // Save metadata to Firestore (if available)
    const db = getFirestore();
    if (db) {
      try {
        const firestoreData = {
          ...pastPaper,
          // Keep uploadedAt as ISO string for Firestore - it will auto-convert
          uploadedAt: pastPaper.uploadedAt
        };
        
        const docRef = await db.collection('pastPapers').doc(pastPaper.id).set(firestoreData);
        console.log('Metadata saved to Firestore with ID:', pastPaper.id);
      } catch (firestoreError) {
        console.error('Firestore save error:', firestoreError);
        // Continue with local storage even if Firestore fails
      }
    } else {
      console.log('Firebase not available, using local storage only');
    }
    
    // Keep local storage for backward compatibility
    pastPapers.push(pastPaper);
    
    res.status(201).json({
      message: 'Past paper uploaded successfully',
      pastPaper
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: `Failed to upload past paper: ${error.message}` });
  }
});

/**
 * DELETE /api/admin/past-papers/clear-all
 * Clear all past papers from database and local system
 */
router.delete('/past-papers/clear-all', async (req: Request, res: Response) => {
  try {
    console.log('Starting clear all past papers...');
    
    // Clear from Firestore (if available)
    const db = getFirestore();
    if (db) {
      try {
        const snapshot = await db.collection('pastPapers').get();
        const batch = db.batch();
        
        snapshot.forEach(doc => {
          batch.delete(doc.ref);
        });
        
        await batch.commit();
        console.log(`Cleared ${snapshot.size} papers from Firestore`);
      } catch (firestoreError) {
        console.error('Firestore clear error:', firestoreError);
        // Continue with local storage even if Firestore fails
      }
    } else {
      console.log('Firebase not available, clearing local storage only');
    }
    
    // Clear local storage
    const clearedCount = pastPapers.length;
    pastPapers.length = 0;
    
    // Clear local files
    try {
      const uploadsDir = path.join(__dirname, '../uploads');
      const examBoards = await fs.readdir(uploadsDir);
      
      for (const examBoard of examBoards) {
        if (examBoard === '.DS_Store') continue;
        
        const examBoardPath = path.join(uploadsDir, examBoard);
        const years = await fs.readdir(examBoardPath);
        
        for (const year of years) {
          if (year === '.DS_Store') continue;
          
          const yearPath = path.join(examBoardPath, year);
          const files = await fs.readdir(yearPath);
          
          for (const file of files) {
            if (file === '.DS_Store') continue;
            
            const filePath = path.join(yearPath, file);
            await fs.unlink(filePath);
            console.log(`Deleted file: ${filePath}`);
          }
          
          // Remove empty year directory
          await fs.rmdir(yearPath);
          console.log(`Removed year directory: ${yearPath}`);
        }
        
        // Remove empty exam board directory
        await fs.rmdir(examBoardPath);
        console.log(`Removed exam board directory: ${examBoardPath}`);
      }
      
      console.log('Local files cleared successfully');
    } catch (fileError) {
      console.error('File cleanup error:', fileError);
      // Continue even if file cleanup fails
    }
    
    res.json({
      message: 'All past papers cleared successfully',
      clearedCount
    });
  } catch (error) {
    console.error('Clear all error:', error);
    res.status(500).json({ error: `Failed to clear past papers: ${error.message}` });
  }
});

/**
 * POST /api/admin/past-papers/:id/extract-questions
 * Extract questions from a specific past paper
 */
router.post('/past-papers/:id/extract-questions', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'Past paper ID is required' });
    }
    
    const paperIndex = pastPapers.findIndex(paper => paper.id === id);
    
    if (paperIndex === -1) {
      return res.status(404).json({ error: 'Past paper not found' });
    }

    const paper = pastPapers[paperIndex];
    console.log(`Extracting questions from paper: ${paper.originalName}`);

    // Return a simple response for now since extraction is disabled
    res.json({
      message: 'Question extraction temporarily disabled',
      pastPaper: paper
    });
  } catch (error) {
    console.error('Question extraction error:', error);
    res.status(500).json({ error: `Failed to extract questions: ${error.message}` });
  }
});

/**
 * POST /api/admin/sync-firestore
 * Sync data from Firestore to local storage
 */
router.post('/sync-firestore', async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(400).json({ error: 'Firebase not available for sync' });
    }
    
    console.log('Starting Firestore sync...');
    
    // Get all documents from Firestore
    const snapshot = await db.collection('pastPapers').get();
    const firestorePapers = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      // Handle both Timestamp objects and ISO strings
      const paper = {
        ...data,
        uploadedAt: data.uploadedAt ? 
          (typeof data.uploadedAt === 'string' ? data.uploadedAt : data.uploadedAt.toDate().toISOString()) : 
          new Date().toISOString(),
        updatedAt: data.updatedAt ? 
          (typeof data.updatedAt === 'string' ? data.updatedAt : data.updatedAt.toDate().toISOString()) : 
          undefined
      };
      firestorePapers.push(paper);
    });
    
    console.log(`Synced ${firestorePapers.length} papers from Firestore`);
    
    // Update local storage
    pastPapers = firestorePapers;
    
    res.json({
      message: 'Firestore sync completed successfully',
      syncedCount: firestorePapers.length
    });
  } catch (error) {
    console.error('Firestore sync error:', error);
    res.status(500).json({ error: `Failed to sync from Firestore: ${error.message}` });
  }
});

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
          entries.push({
            id: doc.id,
            ...data,
            uploadedAt: data.uploadedAt ? 
              (typeof data.uploadedAt === 'string' ? data.uploadedAt : data.uploadedAt.toDate().toISOString()) : 
              new Date().toISOString()
          });
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
        console.log(`Entry saved to Firestore collection: ${collectionName}`);
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
        console.log(`Entry ${entryId} deleted from Firestore collection: ${collectionName}`);
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
        console.log(`Entry ${entryId} deleted from mock data collection: ${collectionName}`);
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
        console.log(`All entries deleted from Firestore collection: ${collectionName}`);
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

export default router;
