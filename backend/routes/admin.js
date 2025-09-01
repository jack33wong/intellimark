const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const { db, admin } = require('../config/firebase');
const { extractQuestionsFromPDF, updatePastPaperWithQuestions } = require('../utils/questionExtractor');
const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Use a default upload directory since we can't access req.body here
    const uploadPath = path.join(__dirname, '../uploads');
    console.log('Multer destination path:', uploadPath);
    
    // Create directory if it doesn't exist
    fs.mkdir(uploadPath, { recursive: true })
      .then(() => {
        console.log('Upload directory created/verified:', uploadPath);
        cb(null, uploadPath);
      })
      .catch(err => {
        console.error('Error creating upload directory:', err);
        cb(err);
      });
  },
  filename: (req, file, cb) => {
    // Use original filename directly, but check if it already exists
    const originalName = file.originalname;
    const filePath = path.join(__dirname, '../uploads', originalName);
    
    // Check if file already exists
    fs.access(filePath)
      .then(() => {
        // File exists, add timestamp to make it unique
        const timestamp = Date.now();
        const nameWithoutExt = path.parse(originalName).name;
        const ext = path.parse(originalName).ext;
        const uniqueName = `${nameWithoutExt}-${timestamp}${ext}`;
        console.log('File exists, using unique name:', uniqueName);
        cb(null, uniqueName);
      })
      .catch(() => {
        // File doesn't exist, use original name
        console.log('Using original filename:', originalName);
        cb(null, originalName);
      });
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    console.log('File filter check:', { 
      filename: file.originalname, 
      mimetype: file.mimetype 
    });
    
    // Only allow PDF files
    if (file.mimetype === 'application/pdf') {
      console.log('File accepted');
      cb(null, true);
    } else {
      console.log('File rejected - not a PDF');
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// In-memory storage for past papers metadata
// In production, this would be stored in a database
let pastPapers = [];

// JSON collections are now stored directly in Firestore

/**
 * Get all past papers with metadata
 * @route GET /api/admin/past-papers
 * @returns {Array} Array of past paper objects
 */
router.get('/past-papers', (req, res) => {
  try {
    res.json(pastPapers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve past papers' });
  }
});

/**
 * Get past papers by exam board
 * @route GET /api/admin/past-papers/board/:examBoard
 * @param {string} examBoard - The exam board name
 * @returns {Array} Array of past papers for the specified board
 */
router.get('/past-papers/board/:examBoard', (req, res) => {
  try {
    const { examBoard } = req.params;
    const boardPapers = pastPapers.filter(paper => 
      paper.examBoard.toLowerCase() === examBoard.toLowerCase()
    );
    res.json(boardPapers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve past papers for exam board' });
  }
});

/**
 * Get past papers by year
 * @route GET /api/admin/past-papers/year/:year
 * @param {string} year - The year
 * @returns {Array} Array of past papers for the specified year
 */
router.get('/past-papers/year/:year', (req, res) => {
  try {
    const { year } = req.params;
    const yearPapers = pastPapers.filter(paper => paper.year === year);
    res.json(yearPapers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve past papers for year' });
  }
});

/**
 * Upload a new past paper PDF
 * @route POST /api/admin/past-papers/upload
 * @returns {Object} Uploaded past paper metadata
 */
router.post('/past-papers/upload', upload.single('pdfFile'), async (req, res) => {
  try {
    console.log('Upload request received:', { body: req.body, file: req.file });
    
    const { examBoard, year, level, paper, type, qualification } = req.body;
    
    if (!req.file) {
      console.log('No file uploaded');
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    if (!examBoard || !year || !level || !paper) {
      console.log('Missing required fields:', { examBoard, year, level, paper });
      return res.status(400).json({ 
        error: 'Exam board, year, level, and paper are required' 
      });
    }

    console.log('Creating organized directory structure...');
    // Create organized directory structure
    const organizedPath = path.join(__dirname, '../uploads', examBoard, year);
    await fs.mkdir(organizedPath, { recursive: true });

    console.log('Moving file to organized directory...');
    // Move file to organized directory
    const newFilePath = path.join(organizedPath, req.file.filename);
    await fs.rename(req.file.path, newFilePath);

    const pastPaper = {
      id: uuidv4(),
      examBoard,
      year: parseInt(year),
      level,
      paper,
      type: type || 'Question Paper',
      qualification: qualification || 'GCSE',
      filename: req.file.filename,
      originalName: req.file.originalname,
      filePath: newFilePath,
      fileSize: req.file.size,
      uploadedAt: new Date().toISOString(),
      questions: [],
      questionCount: 0,
      subQuestionCount: 0
    };

    // Extract questions from the uploaded PDF
    try {
      console.log('Extracting questions from PDF...');
      const extractionResult = await extractQuestionsFromPDF(newFilePath);
      
      if (extractionResult.success) {
        console.log(`Successfully extracted ${extractionResult.totalQuestions} questions`);
        const updatedPaper = updatePastPaperWithQuestions(pastPaper, extractionResult.questions);
        Object.assign(pastPaper, updatedPaper);
      } else {
        console.warn('Question extraction failed:', extractionResult.error);
        // Continue without questions if extraction fails
      }
    } catch (extractionError) {
      console.error('Error during question extraction:', extractionError);
      // Continue without questions if extraction fails
    }

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
 * Clear all past papers from database and local system
 * @route DELETE /api/admin/past-papers/clear-all
 * @returns {Object} Clear status
 */
router.delete('/past-papers/clear-all', async (req, res) => {
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
          
          // Remove year directory
          await fs.rmdir(yearPath);
          console.log(`Removed year directory: ${yearPath}`);
        }
        
        // Remove exam board directory
        await fs.rmdir(examBoardPath);
        console.log(`Removed exam board directory: ${examBoardPath}`);
      }
      
      console.log('All local files cleared successfully');
    } catch (fileError) {
      console.error('File clear error:', fileError);
      // Continue even if file deletion fails
    }
    
    console.log(`Successfully cleared ${clearedCount} past papers`);
    
    res.json({
      message: 'All past papers cleared successfully',
      clearedCount: clearedCount
    });
  } catch (error) {
    console.error('Clear all error:', error);
    res.status(500).json({ error: `Failed to clear all past papers: ${error.message}` });
  }
});

/**
 * Delete a past paper
 * @route DELETE /api/admin/past-papers/:id
 * @param {string} id - The past paper ID
 * @returns {Object} Success message
 */
router.delete('/past-papers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const paperIndex = pastPapers.findIndex(paper => paper.id === id);
    
    if (paperIndex === -1) {
      return res.status(404).json({ error: 'Past paper not found' });
    }

    const paper = pastPapers[paperIndex];
    
    // Delete the file from filesystem
    try {
      await fs.unlink(paper.filePath);
    } catch (fileError) {
      console.warn('File not found for deletion:', fileError.message);
    }

    // Remove from Firestore (if available)
    if (db) {
      try {
        await db.collection('pastPapers').doc(id).delete();
        console.log('Metadata removed from Firestore');
      } catch (firestoreError) {
        console.error('Firestore delete error:', firestoreError);
        // Continue with local deletion even if Firestore fails
      }
    } else {
      console.log('Firebase not available, using local storage only');
    }
    
    // Remove from metadata
    pastPapers.splice(paperIndex, 1);
    
    res.json({ message: 'Past paper deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete past paper' });
  }
});

/**
 * Update past paper metadata
 * @route PUT /api/admin/past-papers/:id
 * @param {string} id - The past paper ID
 * @returns {Object} Updated past paper
 */
router.put('/past-papers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { examBoard, year, level, paper, type, qualification } = req.body;
    
    const paperIndex = pastPapers.findIndex(paper => paper.id === id);
    
    if (paperIndex === -1) {
      return res.status(404).json({ error: 'Past paper not found' });
    }

    // Update metadata
    const updatedPaper = {
      ...pastPapers[paperIndex],
      examBoard: examBoard || pastPapers[paperIndex].examBoard,
      year: year || pastPapers[paperIndex].year,
      level: level || pastPapers[paperIndex].level,
      paper: paper || pastPapers[paperIndex].paper,
      type: type || pastPapers[paperIndex].type,
      qualification: qualification || pastPapers[paperIndex].qualification,
      updatedAt: new Date().toISOString()
    };

    // Update in Firestore (if available)
    if (db) {
      try {
        await db.collection('pastPapers').doc(id).update({
          examBoard: updatedPaper.examBoard,
          year: updatedPaper.year,
          level: updatedPaper.level,
          paper: updatedPaper.paper,
          type: updatedPaper.type,
          qualification: updatedPaper.qualification,
          updatedAt: admin.firestore.Timestamp.fromDate(new Date(updatedPaper.updatedAt))
        });
        console.log('Metadata updated in Firestore');
      } catch (firestoreError) {
        console.error('Firestore update error:', firestoreError);
        // Continue with local update even if Firestore fails
      }
    } else {
      console.log('Firebase not available, using local storage only');
    }

    // Update local storage
    pastPapers[paperIndex] = updatedPaper;

    res.json({
      message: 'Past paper updated successfully',
      pastPaper: updatedPaper
    });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: 'Failed to update past paper' });
  }
});

/**
 * Get available exam boards
 * @route GET /api/admin/exam-boards
 * @returns {Array} Array of exam board names
 */
router.get('/exam-boards', (req, res) => {
  try {
    const examBoards = [...new Set(pastPapers.map(paper => paper.examBoard))];
    res.json(examBoards);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve exam boards' });
  }
});

/**
 * Get available years
 * @route GET /api/admin/years
 * @returns {Array} Array of years
 */
router.get('/years', (req, res) => {
  try {
    const years = [...new Set(pastPapers.map(paper => paper.year))].sort((a, b) => b - a);
    res.json(years);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve years' });
  }
});

/**
 * Get available levels
 * @route GET /api/admin/levels
 * @returns {Array} Array of level names
 */
router.get('/levels', (req, res) => {
  try {
    const levels = [...new Set(pastPapers.map(paper => paper.level))];
    res.json(levels);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve levels' });
  }
});

/**
 * Get available papers
 * @route GET /api/admin/papers
 * @returns {Array} Array of paper codes/names
 */
router.get('/papers', (req, res) => {
  try {
    const papers = [...new Set(pastPapers.map(paper => paper.paper))];
    res.json(papers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve papers' });
  }
});

/**
 * Get available qualifications
 * @route GET /api/admin/qualifications
 * @returns {Array} Array of qualification names
 */
router.get('/qualifications', (req, res) => {
  try {
    const qualifications = [...new Set(pastPapers.map(paper => paper.qualification))];
    res.json(qualifications);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve qualifications' });
  }
});



/**
 * Extract questions from an existing past paper
 * @route POST /api/admin/past-papers/:id/extract-questions
 * @param {string} id - The past paper ID
 * @returns {Object} Updated past paper with extracted questions
 */
router.post('/past-papers/:id/extract-questions', async (req, res) => {
  try {
    const { id } = req.params;
    const paperIndex = pastPapers.findIndex(paper => paper.id === id);
    
    if (paperIndex === -1) {
      return res.status(404).json({ error: 'Past paper not found' });
    }

    const paper = pastPapers[paperIndex];
    console.log(`Extracting questions from paper: ${paper.originalName}`);

    // Extract questions from the PDF file
    const extractionResult = await extractQuestionsFromPDF(paper.filePath);
    
    if (extractionResult.success) {
      console.log(`Successfully extracted ${extractionResult.totalQuestions} questions`);
      
      // Update the past paper with extracted questions
      const updatedPaper = updatePastPaperWithQuestions(paper, extractionResult.questions);
      
      // Update local storage
      pastPapers[paperIndex] = updatedPaper;
      
      // Update Firestore (if available)
      if (db) {
        try {
          await db.collection('pastPapers').doc(id).update({
            questions: updatedPaper.questions,
            questionCount: updatedPaper.questionCount,
            subQuestionCount: updatedPaper.subQuestionCount,
            lastUpdated: admin.firestore.Timestamp.fromDate(new Date())
          });
          console.log('Questions updated in Firestore');
        } catch (firestoreError) {
          console.error('Firestore update error:', firestoreError);
          // Continue with local storage even if Firestore fails
        }
      } else {
        console.log('Firebase not available, using local storage only');
      }
      
      res.json({
        message: 'Questions extracted successfully',
        pastPaper: updatedPaper
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to extract questions',
        details: extractionResult.error 
      });
    }
  } catch (error) {
    console.error('Question extraction error:', error);
    res.status(500).json({ error: `Failed to extract questions: ${error.message}` });
  }
});



/**
 * Sync data from Firestore to local storage
 * @route POST /api/admin/sync-firestore
 * @returns {Object} Sync status
 */
router.post('/sync-firestore', async (req, res) => {
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
 * Upload JSON data to fullExamPapers collection
 * @route POST /api/admin/json/upload
 * @param {Object} req.body.data - JSON data to upload
 * @returns {Object} Upload result
 */
router.post('/json/upload', (req, res) => {
  try {
    const { data } = req.body;
    const collectionName = 'fullExamPapers';
    
    if (!data) {
      return res.status(400).json({ 
        error: 'JSON data is required' 
      });
    }
    
    // Validate that data is an object or array
    if (typeof data !== 'object' || data === null) {
      return res.status(400).json({ 
        error: 'Data must be a valid JSON object or array' 
      });
    }
    
    // Generate unique ID for the document
    const jsonEntryId = uuidv4();
    
    // Calculate data size
    const entrySize = JSON.stringify(data).length;
    
    // Store in Firestore if available
    if (db) {
      try {
        db.collection('fullExamPapers').doc(jsonEntryId).set({
          ...data,
          uploadedAt: new Date(),
          dataSize: entrySize
        });
        console.log('JSON data stored in Firestore fullExamPapers collection');
      } catch (firestoreError) {
        console.error('Firestore storage error:', firestoreError);
        return res.status(500).json({ error: `Failed to store in Firestore: ${firestoreError.message}` });
      }
    } else {
      return res.status(500).json({ error: 'Firestore not available' });
    }
    
    console.log(`JSON uploaded to collection: ${collectionName}`);
    
    res.json({
      message: 'JSON uploaded successfully',
      collectionName,
      entryId: jsonEntryId,
      size: entrySize
    });
    
  } catch (error) {
    console.error('JSON upload error:', error);
    res.status(500).json({ error: `Failed to upload JSON: ${error.message}` });
  }
});

/**
 * Get JSON collections
 * @route GET /api/admin/json/collections
 * @returns {Object} Collections and their metadata
 */
router.get('/json/collections', (req, res) => {
  try {
    // Fetch collections directly from Firestore
    if (db) {
      // For now, we'll return the fullExamPapers collection info
      // In a more complex setup, you could list all collections
      db.collection('fullExamPapers').get()
        .then((snapshot) => {
          const entries = [];
          let totalSize = 0;
          let lastUploaded = null;
          
          snapshot.forEach((doc) => {
            const data = doc.data();
            const size = data.dataSize || JSON.stringify(data).length;
            const uploadedAt = data.uploadedAt ? data.uploadedAt.toDate().toISOString() : new Date().toISOString();
            
            entries.push({
              id: doc.id,
              data: data,
              uploadedAt: uploadedAt,
              size: size
            });
            
            totalSize += size;
            if (!lastUploaded || uploadedAt > lastUploaded) {
              lastUploaded = uploadedAt;
            }
          });
          
          const collections = {
            fullExamPapers: {
              count: entries.length,
              totalSize: totalSize,
              lastUploaded: lastUploaded
            }
          };
          
          res.json({
            collections,
            totalCollections: Object.keys(collections).length
          });
        })
        .catch((firestoreError) => {
          console.error('Firestore fetch error:', firestoreError);
          res.status(500).json({ error: `Failed to fetch collections from Firestore: ${firestoreError.message}` });
        });
    } else {
      res.status(500).json({ error: 'Firestore not available' });
    }
  } catch (error) {
    console.error('Get collections error:', error);
    res.status(500).json({ error: `Failed to get collections: ${error.message}` });
  }
});

/**
 * Get JSON data from a specific collection
 * @route GET /api/admin/json/collections/:collectionName
 * @param {string} collectionName - Name of the collection
 * @returns {Array} Array of JSON entries in the collection
 */
router.get('/json/collections/:collectionName', (req, res) => {
  try {
    const { collectionName } = req.params;
    
    // Fetch data directly from Firestore instead of in-memory storage
    if (db) {
      db.collection(collectionName).get()
        .then((snapshot) => {
          const entries = [];
          snapshot.forEach((doc) => {
            const data = doc.data();
            entries.push({
              id: doc.id,
              data: data,
              uploadedAt: data.uploadedAt ? data.uploadedAt.toDate().toISOString() : new Date().toISOString(),
              size: data.dataSize || JSON.stringify(data).length
            });
          });
          
          res.json({
            collectionName,
            entries: entries
          });
        })
        .catch((firestoreError) => {
          console.error('Firestore fetch error:', firestoreError);
          res.status(500).json({ error: `Failed to fetch data from Firestore: ${firestoreError.message}` });
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
 * Delete a specific entry from a JSON collection
 * @route DELETE /api/admin/json/collections/:collectionName/:entryId
 * @param {string} collectionName - Name of the collection
 * @param {string} entryId - ID of the entry to delete
 * @returns {Object} Success message
 */
router.delete('/json/collections/:collectionName/:entryId', (req, res) => {
  try {
    const { collectionName, entryId } = req.params;
    
    // Delete the specific document from Firestore
    if (db) {
      db.collection(collectionName).doc(entryId).delete()
        .then(() => {
          console.log(`Entry ${entryId} deleted from collection: ${collectionName}`);
          res.json({
            message: `Entry deleted successfully`,
            collectionName,
            entryId,
            deleted: true
          });
        })
        .catch((firestoreError) => {
          console.error('Firestore delete error:', firestoreError);
          res.status(500).json({ error: `Failed to delete entry from Firestore: ${firestoreError.message}` });
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
 * Delete all entries from a specific JSON collection
 * @route DELETE /api/admin/json/collections/:collectionName/clear-all
 * @param {string} collectionName - Name of the collection to clear
 * @returns {Object} Success message
 */
router.delete('/json/collections/:collectionName/clear-all', (req, res) => {
  try {
    const { collectionName } = req.params;
    
    // Delete all documents from the specified collection in Firestore
    if (db) {
      db.collection(collectionName).get()
        .then((snapshot) => {
          const deletePromises = [];
          snapshot.forEach((doc) => {
            deletePromises.push(doc.ref.delete());
          });
          
          return Promise.all(deletePromises);
        })
        .then(() => {
          console.log(`All entries deleted from collection: ${collectionName}`);
          res.json({
            message: `All entries deleted from collection: ${collectionName}`,
            collectionName,
            deletedCount: 'all'
          });
        })
        .catch((firestoreError) => {
          console.error('Firestore delete error:', firestoreError);
          res.status(500).json({ error: `Failed to delete from Firestore: ${firestoreError.message}` });
        });
    } else {
      res.status(500).json({ error: 'Firestore not available' });
    }
  } catch (error) {
    console.error('Delete collection error:', error);
    res.status(500).json({ error: `Failed to delete collection: ${error.message}` });
  }
});

module.exports = router;
