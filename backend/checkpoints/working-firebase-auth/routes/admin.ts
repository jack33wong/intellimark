/**
 * Admin Routes
 * Handles administrative functions like PDF uploads, JSON management, and system operations
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
// import { db, admin } from '../config/firebase.js';
const db = null;
const admin = null;
// import { extractQuestionsFromPDF, updatePastPaperWithQuestions } from '../utils/questionExtractor.js';

const router = express.Router();

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

// In-memory storage for past papers (fallback when Firestore is unavailable)
let pastPapers: PastPaper[] = [];

/**
 * GET /api/admin/past-papers
 * Get all past papers
 */
router.get('/past-papers', async (req: Request, res: Response) => {
  try {
    let papers = [];
    
    // Try to get from Firestore first
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

    // Extract questions from the uploaded PDF (DISABLED)
    // try {
    //   console.log('Extracting questions from PDF...');
    //   const extractionResult = await extractQuestionsFromPDF(newFilePath);
      
    //   if (extractionResult.success) {
    //     console.log(`Successfully extracted ${extractionResult.totalQuestions} questions`);
    //     const updatedPaper = updatePastPaperWithQuestions(pastPaper, extractionResult.questions);
    //     Object.assign(pastPaper, updatedPaper);
    //   } else {
    //     console.warn('Question extraction failed:', extractionResult.error);
    //     // Continue without questions if extraction fails
    //   }
    // } catch (extractionError) {
    //   console.error('Error during question extraction:', extractionError);
    //     // Continue without questions if extraction fails
    //   }
    // }

    console.log('Created past paper object:', pastPaper);
    
    // Save metadata to Firestore (if available)
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

    // Extract questions from the PDF file (DISABLED)
    // const extractionResult = await extractQuestionsFromPDF(paper.filePath);
    
    // if (extractionResult.success) {
    //   console.log(`Successfully extracted ${extractionResult.totalQuestions} questions`);
      
    //   // Update the past paper with extracted questions
    //   const updatedPaper = updatePastPaperWithQuestions(paper, extractionResult.questions);
      
    //   // Update local storage
    //   pastPapers[paperIndex] = updatedPaper;
      
    //   // Update Firestore (if available)
    //   if (db) {
    //     try {
    //       await db.collection('pastPapers').doc(id).update({
    //     questions: updatedPaper.questions,
    //     questionCount: updatedPaper.questionCount,
    //     subQuestionCount: updatedPaper.subQuestionCount,
    //     lastUpdated: admin.firestore.Timestamp.fromDate(new Date())
    //   });
    //   console.log('Questions updated in Firestore');
    // } catch (firestoreError) {
    //   console.error('Firestore update error:', firestoreError);
    //   // Continue with local storage even if Firestore fails
    // }
    // } else {
    //   console.log('Firebase not available, using local storage only');
    // }
    
    // res.json({
    //   message: 'Questions extracted successfully',
    //   pastPaper: updatedPaper
    // });
    // } else {
    //   res.status(500).json({ 
    //     error: 'Failed to extract questions',
    //     details: extractionResult.error 
    //   });
    // }
    
    // Return a simple response for now
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
    
    // Get data from Firestore
    if (db) {
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
    } else {
      res.status(500).json({ error: 'Firestore not available' });
    }
  } catch (error) {
    console.error('Get collection error:', error);
    res.status(500).json({ error: `Failed to get collection: ${error.message}` });
  }
});

/**
 * DELETE /api/admin/json/collections/:collectionName/:entryId
 * Delete a specific entry from a JSON collection
 */
router.delete('/json/collections/:collectionName/:entryId', async (req: Request, res: Response) => {
  try {
    const { collectionName, entryId } = req.params;
    
    // Delete the specific document from Firestore
    if (db) {
      await db.collection(collectionName).doc(entryId).delete();
      console.log(`Entry ${entryId} deleted from collection: ${collectionName}`);
      res.json({
        message: `Entry deleted successfully`,
        collectionName,
        entryId,
        deleted: true
      });
    } else {
      res.status(500).json({ error: 'Firestore not available' });
    }
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
    if (db) {
      const snapshot = await db.collection(collectionName).get();
      const deletePromises = [];
      snapshot.forEach((doc) => {
        deletePromises.push(doc.ref.delete());
      });
      
      await Promise.all(deletePromises);
      console.log(`All entries deleted from collection: ${collectionName}`);
      res.json({
        message: `All entries deleted from collection: ${collectionName}`,
        collectionName,
        deletedCount: 'all'
      });
    } else {
      res.status(500).json({ error: 'Firestore not available' });
    }
  } catch (error) {
    console.error('Delete collection error:', error);
    res.status(500).json({ error: `Failed to delete collection: ${error.message}` });
  }
});

export default router;
