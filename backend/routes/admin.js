const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { examBoard, year } = req.body;
    const uploadPath = path.join(__dirname, '../uploads', examBoard, year);
    
    // Create directory if it doesn't exist
    fs.mkdir(uploadPath, { recursive: true })
      .then(() => cb(null, uploadPath))
      .catch(err => cb(err));
  },
  filename: (req, file, cb) => {
    // Generate unique filename with original extension
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// In-memory storage for past papers metadata
// In production, this would be stored in a database
let pastPapers = [];

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
    const { examBoard, year, subject, paperType, description } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    if (!examBoard || !year || !subject) {
      return res.status(400).json({ 
        error: 'Exam board, year, and subject are required' 
      });
    }

    const pastPaper = {
      id: uuidv4(),
      examBoard,
      year,
      subject,
      paperType: paperType || 'Main',
      description: description || '',
      filename: req.file.filename,
      originalName: req.file.originalname,
      filePath: req.file.path,
      fileSize: req.file.size,
      uploadedAt: new Date().toISOString(),
      downloadCount: 0
    };

    pastPapers.push(pastPaper);
    
    res.status(201).json({
      message: 'Past paper uploaded successfully',
      pastPaper
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload past paper' });
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
router.put('/past-papers/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { examBoard, year, subject, paperType, description } = req.body;
    
    const paperIndex = pastPapers.findIndex(paper => paper.id === id);
    
    if (paperIndex === -1) {
      return res.status(404).json({ error: 'Past paper not found' });
    }

    // Update metadata
    pastPapers[paperIndex] = {
      ...pastPapers[paperIndex],
      examBoard: examBoard || pastPapers[paperIndex].examBoard,
      year: year || pastPapers[paperIndex].year,
      subject: subject || pastPapers[paperIndex].subject,
      paperType: paperType || pastPapers[paperIndex].paperType,
      description: description || pastPapers[paperIndex].description,
      updatedAt: new Date().toISOString()
    };

    res.json({
      message: 'Past paper updated successfully',
      pastPaper: pastPapers[paperIndex]
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
 * Get available subjects
 * @route GET /api/admin/subjects
 * @returns {Array} Array of subject names
 */
router.get('/subjects', (req, res) => {
  try {
    const subjects = [...new Set(pastPapers.map(paper => paper.subject))];
    res.json(subjects);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve subjects' });
  }
});

/**
 * Download a past paper PDF
 * @route GET /api/admin/past-papers/:id/download
 * @param {string} id - The past paper ID
 * @returns {File} PDF file stream
 */
router.get('/past-papers/:id/download', (req, res) => {
  try {
    const { id } = req.params;
    const paper = pastPapers.find(p => p.id === id);
    
    if (!paper) {
      return res.status(404).json({ error: 'Past paper not found' });
    }

    // Increment download count
    paper.downloadCount++;
    
    // Send file
    res.download(paper.filePath, paper.originalName);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download past paper' });
  }
});

module.exports = router;
