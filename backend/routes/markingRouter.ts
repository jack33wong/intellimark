/**
 * Unified Marking Router
 * Handles single images, multiple images, and PDFs through a single endpoint
 */

import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { optionalAuth } from '../middleware/auth.js';
// import { runOriginalSingleImagePipeline } from './originalPipeline.js'; // Removed - using unified pipeline only
import PdfProcessingService from '../services/pdf/PdfProcessingService.js';
import sharp from 'sharp';
import { ImageUtils } from '../utils/ImageUtils.js';
import { sendSseUpdate, closeSseConnection, createProgressData } from '../utils/sseUtils.js';
import { createAIMessage, createUserMessage, handleAIMessageIdForEndpoint } from '../utils/messageUtils.js';
import { logPerformanceSummary, logCommonSteps } from '../services/marking/MarkingHelpers.js';
import { OCRService } from '../services/ocr/OCRService.js';
import { ClassificationService } from '../services/marking/ClassificationService.js';
import { MarkingInstructionService } from '../services/marking/MarkingInstructionService.js';
import { SVGOverlayService } from '../services/marking/svgOverlayService.js';
import { executeMarkingForQuestion, QuestionResult, EnrichedAnnotation } from '../services/marking/MarkingExecutor.js';
import { questionDetectionService } from '../services/marking/questionDetectionService.js';
import { ImageStorageService } from '../services/imageStorageService.js';
// import { getMarkingScheme } from '../services/marking/questionDetectionService.js';

// Placeholder function removed - schemes are now fetched in Question Detection stage

// Types for multi-page processing
interface StandardizedPage {
  pageIndex: number;
  imageData: string;
  originalFileName?: string;
  width?: number;
  height?: number;
}

interface PageOcrResult {
  pageIndex: number;
  ocrData: any;
  classificationText?: string;
}

// Types for segmentation
interface MathBlock {
  googleVisionText: string;
  mathpixLatex?: string;
  confidence: number;
  mathpixConfidence?: number;
  mathLikenessScore: number;
  coordinates: { x: number; y: number; width: number; height: number };
  suspicious?: boolean;
  pageIndex?: number;
  globalBlockId?: string;
}

interface MarkingTask {
  questionNumber: number | string;
  mathBlocks: MathBlock[];
  markingScheme: any | null; // Allow null for preliminary tasks
  sourcePages: number[];
}


// --- Helper Functions for Multi-Question Detection ---

/**
 * Extract questions from AI classification result
 * 
 * DESIGN: Support 1...N questions in classification response
 * - Classification AI extracts question text (no question numbers needed)
 * - Question Detection finds exam paper and marking schemes from database records
 * - Database records contain the actual question numbers (Q13, Q14, etc.)
 * - Classification returns array of questions with text only, NO numbers
 */
const extractQuestionsFromClassification = (
  classification: any, 
  fileName?: string
): Array<{text: string}> => {
  // Handle new questions array structure (1...N questions)
  if (classification?.questions && Array.isArray(classification.questions)) {
    const questions = classification.questions.map((q: any) => ({
      text: q.text || ''
    }));
    
    console.log('🔍 [DEBUG] Using questions array from classification:', {
      count: questions.length,
      questions: questions.map(q => ({ textLength: q.text.length }))
    });
    return questions;
  }
  
  // Fallback: Handle old extractedQuestionText structure
  if (classification?.extractedQuestionText) {
    return [{
      text: classification.extractedQuestionText
    }];
  }
  
  console.log('🔍 [DEBUG] No questions found in classification');
  return [];
};

/**
 * Extract question number from filename (e.g., "q19.png" -> "19")
 */
const extractQuestionNumberFromFilename = (fileName?: string): string | null => {
  if (!fileName) return null;
  
  const match = fileName.match(/q(\d+)/i);
  return match ? match[1] : null;
};

/**
 * Enhanced boundary detection for multiple questions using question endings
 */
const findMultipleQuestionBoundaries = (
  studentWorkBlocks: any[],
  individualQuestions: Array<{text: string}>,
  detectedSchemesMap?: Map<string, any>
): Array<{questionNumber: string, startIndex: number, endIndex: number}> => {
  const boundaries: Array<{questionNumber: string, startIndex: number, endIndex: number}> = [];
  
  // Get question numbers from detectedSchemesMap (from question detection)
  const questionNumbers = detectedSchemesMap ? Array.from(detectedSchemesMap.keys()) : [];
  
  if (individualQuestions.length === 1) {
    // Single question - use all blocks
    const questionNumber = questionNumbers[0] || "1";
    boundaries.push({
      questionNumber: questionNumber,
      startIndex: 0,
      endIndex: studentWorkBlocks.length - 1
    });
    return boundaries;
  }
  
  // Multiple questions - find boundaries using question endings
  let currentStartIndex = 0;
  
  for (let i = 0; i < individualQuestions.length; i++) {
    const questionNumber = questionNumbers[i] || `${i + 1}`;
    const isLastQuestion = i === individualQuestions.length - 1;
    
    if (isLastQuestion) {
      // Last question gets all remaining blocks
      boundaries.push({
        questionNumber: questionNumber,
        startIndex: currentStartIndex,
        endIndex: studentWorkBlocks.length - 1
      });
    } else {
      // For now, split blocks evenly between questions
      // TODO: Enhance this to use actual question ending detection
      const blocksPerQuestion = Math.floor(studentWorkBlocks.length / individualQuestions.length);
      const endIndex = Math.min(currentStartIndex + blocksPerQuestion - 1, studentWorkBlocks.length - 1);
      
      boundaries.push({
        questionNumber: questionNumber,
        startIndex: currentStartIndex,
        endIndex: endIndex
      });
      
      currentStartIndex = endIndex + 1;
    }
  }
  
  return boundaries;
};

/**
 * Create marking tasks using enhanced boundary detection
 */
const createTasksFromEnhancedBoundaries = (
  individualQuestions: Array<{text: string}>,
  studentWorkBlocks: any[],
  detectedSchemesMap?: Map<string, any>
): MarkingTask[] => {
  const tasks: MarkingTask[] = [];
  
  // Find boundaries for each question
  const boundaries = findMultipleQuestionBoundaries(studentWorkBlocks, individualQuestions, detectedSchemesMap);
  
  // Create tasks based on boundaries
  for (const boundary of boundaries) {
    const questionNumber = boundary.questionNumber;
    const questionBlocks = studentWorkBlocks.slice(boundary.startIndex, boundary.endIndex + 1);
    
    // Find matching marking scheme
    let markingScheme = null;
    if (detectedSchemesMap && detectedSchemesMap.has(questionNumber)) {
      markingScheme = detectedSchemesMap.get(questionNumber);
    }
    
    const sourcePages = [...new Set(questionBlocks.map(b => b.pageIndex))].sort((a, b) => a - b);
    
    tasks.push({
      questionNumber: questionNumber,
      mathBlocks: questionBlocks,
      markingScheme: markingScheme,
      sourcePages: sourcePages
    });
    
  }
  
  return tasks;
};

// --- Enhanced Segmentation Logic with Multi-Question Support ---
const segmentOcrResultsByQuestion = async (
  allPagesOcrData: PageOcrResult[],
  globalQuestionText?: string,
  detectedSchemesMap?: Map<string, any>,
  classificationResult?: any,
  fileName?: string
): Promise<MarkingTask[]> => {
  if (allPagesOcrData.length === 0) {
    return [];
  }

  // 1. Consolidate ALL *processed* math blocks (no raw lines, no re-filtering)
  let allMathBlocksForContent: Array<MathBlock & { pageIndex: number; globalBlockId: string }> = [];
  let blockCounter = 0;

  allPagesOcrData.forEach((pageResult, pageIdx) => {
    const mathBlocks = pageResult.ocrData?.mathBlocks || [];
    
    mathBlocks.forEach((block) => {
       allMathBlocksForContent.push({
           ...block,
           pageIndex: pageResult.pageIndex, // Use the pageIndex from the PageOcrResult
           globalBlockId: `block_${blockCounter++}`
      });
    });
  });

  // 2. Filter out any blocks that might be empty (should be handled by OCRService, but as a safeguard)
  const studentWorkBlocks = allMathBlocksForContent.filter(block =>
      (block.mathpixLatex || block.googleVisionText || '').trim().length > 0
  );

  if (studentWorkBlocks.length === 0) {
    return [];
  }

  // 3. Enhanced Multi-Question Detection using Question Endings
  const tasks: MarkingTask[] = [];
  
  try {
    // Extract questions from AI classification result
    const individualQuestions = extractQuestionsFromClassification(classificationResult, fileName);
    
    if (individualQuestions.length > 1) {
      // Use enhanced boundary detection instead of AI
      const questionTasks = createTasksFromEnhancedBoundaries(
        individualQuestions,
        studentWorkBlocks,
        detectedSchemesMap
      );
      
      if (questionTasks.length > 0) {
        return questionTasks;
      }
    }
    
  } catch (error) {
    console.error('Error in enhanced boundary detection:', error);
  }
  
  // 4. Fallback: Single Question Logic (Original behavior)
  // Use the detected question number from the map
  let questionNumber: string | number = "UNKNOWN";
  if (detectedSchemesMap && detectedSchemesMap.size === 1) {
       questionNumber = detectedSchemesMap.keys().next().value;
  } else if (detectedSchemesMap && detectedSchemesMap.size > 1) {
       questionNumber = detectedSchemesMap.keys().next().value;
  } else {
      questionNumber = 1;
  }

  const sourcePages = [...new Set(studentWorkBlocks.map(b => b.pageIndex))].sort((a, b) => a - b);

  // Sort blocks by page, then Y-coordinate
  studentWorkBlocks.sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) {
      return a.pageIndex - b.pageIndex;
    }
    return (a.coordinates?.y ?? 0) - (b.coordinates?.y ?? 0);
  });

  tasks.push({
      questionNumber: questionNumber,
      mathBlocks: studentWorkBlocks,
      markingScheme: null, // Scheme is added later in the router
      sourcePages: sourcePages
  });

  return tasks;
};

// --- Configure Multer ---
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
    files: 10 // Maximum 10 files
  }
});

const router = express.Router();

// Helper function to convert multi-image stages to original progress format
// Define the steps for multi-image processing (matching original single image format)
const MULTI_IMAGE_STEPS = [
  'Input Validation',
  'Standardization', 
  'Preprocessing',
  'OCR & Classification',
  'Question Detection',
  'Segmentation',
  'Marking',
  'Output Generation'
];


/**
 * POST /api/marking/process
 * 
 * Unified endpoint for processing single images, multiple images, and PDFs
 * Routes to appropriate pipeline based on input type detection
 */
router.post('/process', optionalAuth, upload.array('files'), async (req: Request, res: Response, next: NextFunction) => {
  // --- Basic Setup ---
  const submissionId = uuidv4(); // Generate a unique ID for this submission
  const startTime = Date.now();
  
  // Performance tracking variables (reuse original design)
  const stepTimings: { [key: string]: { start: number; duration?: number; subSteps?: { [key: string]: number } } } = {};
  let totalLLMTokens = 0;
  let totalMathpixCalls = 0;
  let actualModel = 'auto'; // Will be updated when model is determined
  
  // Performance tracking function (reuse original design)
  const logStep = (stepName: string, modelInfo: string) => {
    const stepKey = stepName.toLowerCase().replace(/\s+/g, '_');
    stepTimings[stepKey] = { start: Date.now() };
    
    return () => {
      if (stepTimings[stepKey]) {
        stepTimings[stepKey].duration = Date.now() - stepTimings[stepKey].start;
        console.log(`✅ [${stepName}] Completed in ${stepTimings[stepKey].duration}ms (${modelInfo})`);
      }
    };
  };
  
  console.log(`\n🔄 ========== UNIFIED PIPELINE START ==========`);
  console.log(`🔄 ============================================\n`);

  // --- SSE Setup ---
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });
  
  // Send initial message in the same format as original single image pipeline
  sendSseUpdate(res, createProgressData(0, 'Processing started', MULTI_IMAGE_STEPS));

  try {
    const files = req.files as Express.Multer.File[];
    // Determine authentication status early
    const userId = (req as any)?.user?.uid || null;
    const isAuthenticated = !!userId;

    // --- Input Validation ---
    if (!files || files.length === 0) {
      console.error(`[SUBMISSION ${submissionId}] No files uploaded.`);
      throw new Error('No files were uploaded.');
    }
    
    sendSseUpdate(res, createProgressData(0, `Received ${files.length} file(s). Validating...`, MULTI_IMAGE_STEPS));

    // --- Input Type Detection (Prioritize PDF) ---
    const firstMime = files[0]?.mimetype || 'unknown';
    const isPdf = files.length === 1 && firstMime === 'application/pdf';
    const isSingleImage = files.length === 1 && !isPdf && firstMime.startsWith('image/');
    const isMultipleImages = files.length > 1 && files.every(f => {
      const ok = f.mimetype?.startsWith('image/');
      if (!ok) console.warn(`[MIME CHECK] Non-image file detected in multi-upload: ${f.mimetype}`);
      return ok;
    });

    if (!isSingleImage && !isMultipleImages && !isPdf) {
      // Handle invalid combinations (e.g., multiple PDFs, mixed types)
      console.error(`[SUBMISSION ${submissionId}] Invalid file combination received.`);
      throw new Error('Invalid file submission: Please upload a single PDF, a single image, or multiple images.');
    }
    
    const inputType = isPdf ? 'PDF' : isMultipleImages ? 'Multiple Images' : 'Single Image';
    sendSseUpdate(res, createProgressData(0, `Input validated (${inputType}).`, MULTI_IMAGE_STEPS));

    // --- Declare variables at proper scope ---
    let standardizedPages: StandardizedPage[] = [];
    let allPagesOcrData: PageOcrResult[] = [];
    let markingTasks: MarkingTask[] = [];

    // --- Conditional Routing (PDF first) ---
    if (isPdf) {
      // --- Multi-File / PDF Path (This code only runs if NOT isSingleImage) ---
      sendSseUpdate(res, createProgressData(1, `Preparing ${inputType} processing...`, MULTI_IMAGE_STEPS));

      // Stage 1: Standardization
      sendSseUpdate(res, createProgressData(1, 'Converting PDF...', MULTI_IMAGE_STEPS));
      const pdfBuffer = files[0].buffer;
      standardizedPages = await PdfProcessingService.convertPdfToImages(pdfBuffer);
      if (standardizedPages.length === 0) throw new Error('PDF conversion yielded no pages.');
      sendSseUpdate(res, createProgressData(1, `Converted PDF to ${standardizedPages.length} pages.`, MULTI_IMAGE_STEPS));

      // Dimension extraction after conversion (reliable via sharp on buffers)
      sendSseUpdate(res, createProgressData(1, `Extracting dimensions for ${standardizedPages.length} converted page(s)...`, MULTI_IMAGE_STEPS));
      try {
        await Promise.all(standardizedPages.map(async (page, i) => {
          const base64Data = page.imageData.split(',')[1];
          if (!base64Data) {
            console.warn(`[DIMENSIONS - PDF Path] Invalid base64 data for page ${i}, skipping.`);
            page.width = 0; page.height = 0; return;
          }
          const imageBuffer = Buffer.from(base64Data, 'base64');
          const metadata = await sharp(imageBuffer).metadata();
          if (!metadata.width || !metadata.height) {
            console.warn(`[DIMENSIONS - PDF Path] Sharp failed to get valid dimensions for page ${i}.`);
          }
          page.width = metadata.width || 0;
          page.height = metadata.height || 0;
        }));
        sendSseUpdate(res, createProgressData(1, 'Dimension extraction complete.', MULTI_IMAGE_STEPS));
      } catch (dimensionError) {
        console.error('❌ Error during PDF dimension extraction:', dimensionError);
        throw new Error(`Failed during PDF dimension extraction: ${dimensionError instanceof Error ? dimensionError.message : 'Unknown error'}`);
      }

      // Single-page PDF → route to new unified pipeline for consistency
      if (standardizedPages.length === 1) {
        sendSseUpdate(res, createProgressData(2, 'Processing as single converted page...', MULTI_IMAGE_STEPS));
        
        // Upload original PDF to storage for authenticated users or create data URL for unauthenticated users
        let originalPdfLink = null;
        let originalPdfDataUrl = null;
        
        if (isAuthenticated) {
          try {
            const { ImageStorageService } = await import('../services/imageStorageService.js');
            const sessionId = req.body.sessionId || submissionId;
            const originalFileName = files[0].originalname || 'document.pdf';
            originalPdfLink = await ImageStorageService.uploadPdf(
              `data:application/pdf;base64,${pdfBuffer.toString('base64')}`,
              userId || 'anonymous',
              sessionId,
              originalFileName
            );
          } catch (error) {
            console.error('❌ Failed to upload original PDF:', error);
            originalPdfLink = null;
          }
        } else {
          // For unauthenticated users, create a data URL
          originalPdfDataUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
        }
        
        // Store PDF context for later use in the unified pipeline
        (req as any).pdfContext = {
          originalFileType: 'pdf' as const,
          originalPdfLink,
          originalPdfDataUrl,
          originalFileName: files[0].originalname || 'document.pdf'
        };
        
        // Continue to unified pipeline (don't return here)
      }

      // Multi-page PDF – Continue to common processing logic
      
      // One-line dimension logs per page
      standardizedPages.forEach((p: any) => {
        const ratio = p.height ? (p.width / p.height).toFixed(3) : '0.000';
      });

      // Fallback warning if any page still lacks dimensions
      standardizedPages.forEach((p: any, i: number) => {
        if (!p.width || !p.height) {
          console.warn(`[DIMENSIONS] Dimensions for page ${i} not set during standardization. Extraction needed (TODO).`);
          p.width = p.width || 0;
          p.height = p.height || 0;
        }
      });

    } else if (isSingleImage) {
      // ========================= START OF FIX =========================
      // --- Route Single Image to Unified Pipeline for Multi-Question Support ---
      sendSseUpdate(res, createProgressData(2, 'Processing as single image with multi-question detection...', MULTI_IMAGE_STEPS));

      // Convert single image to standardized format for unified pipeline
      const singleFileData = `data:${files[0].mimetype};base64,${files[0].buffer.toString('base64')}`;
      
      // Standardize the single image as if it were a multi-image input
      standardizedPages = [{
        pageIndex: 0,
        imageData: singleFileData,
        originalFileName: files[0].originalname || 'single-image.png'
      }];
      
      // Extract dimensions for the single image
      sendSseUpdate(res, createProgressData(2, 'Extracting image dimensions...', MULTI_IMAGE_STEPS));
      try {
        const base64Data = singleFileData.split(',')[1];
        if (base64Data) {
          const imageBuffer = Buffer.from(base64Data, 'base64');
          const metadata = await sharp(imageBuffer).metadata();
          if (metadata.width && metadata.height) {
            standardizedPages[0].width = metadata.width;
            standardizedPages[0].height = metadata.height;
          }
        }
      } catch (error) {
        console.warn(`[DIMENSIONS - Single Image] Failed to extract dimensions:`, error);
      }
      
      // Continue to unified pipeline processing (don't return here)
      // ========================== END OF FIX ==========================

    } else if (isMultipleImages) {
      // --- Multi-File / PDF Path (This code only runs if NOT isSingleImage) ---
      sendSseUpdate(res, createProgressData(1, `Preparing ${inputType} processing...`, MULTI_IMAGE_STEPS));

      // 1. Collect Images & Extract Dimensions in Parallel
      sendSseUpdate(res, createProgressData(1, `Extracting dimensions for ${files.length} images...`, MULTI_IMAGE_STEPS));
      standardizedPages = await Promise.all(files.map(async (file, index): Promise<StandardizedPage | null> => {
        if (!file.mimetype.startsWith('image/')) return null;
        try {
          const metadata = await sharp(file.buffer).metadata();
          if (!metadata.width || !metadata.height) return null;
          return {
            pageIndex: index,
            imageData: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
            originalFileName: file.originalname,
            width: metadata.width,
            height: metadata.height
          };
        } catch (imgDimError) { 
          console.warn(`[DIMENSIONS - MultiImg Path] Failed to extract dimensions for image ${index}:`, imgDimError);
          return null; 
        }
      }));
      standardizedPages = standardizedPages.filter((page): page is StandardizedPage => page !== null);
      sendSseUpdate(res, createProgressData(1, `Collected ${standardizedPages.length} image(s).`, MULTI_IMAGE_STEPS));

    } else {
      // This case should technically be caught by initial validation, but belt-and-suspenders.
      throw new Error("Unhandled submission type.");
    }

    // --- Guard against empty standardization ---
    if (standardizedPages.length === 0) {
      throw new Error('Standardization failed: No processable pages/images found.');
    }

    // --- Preprocessing (Common for Multi-Page PDF & Multi-Image) ---
    sendSseUpdate(res, createProgressData(2, `Preprocessing ${standardizedPages.length} image(s)...`, MULTI_IMAGE_STEPS));
    const preprocessedImageDatas = await Promise.all(
      standardizedPages.map(page => ImageUtils.preProcess(page.imageData))
    );
    standardizedPages.forEach((page, i) => page.imageData = preprocessedImageDatas[i]);
    sendSseUpdate(res, createProgressData(2, 'Image preprocessing complete.', MULTI_IMAGE_STEPS));

    // ========================= START: IMPLEMENT STAGE 2 =========================
    // --- Stage 2: Parallel OCR/Classify (Common for Multi-Page PDF & Multi-Image) ---
    sendSseUpdate(res, createProgressData(3, `Running OCR & Classification on ${standardizedPages.length} pages...`, MULTI_IMAGE_STEPS));

    // --- Perform Initial Classification ---
    // Using simple approach: Classify first page for global context
    const logClassificationComplete = logStep('Image Classification', actualModel);
    const classificationResult = standardizedPages.length > 0
      ? await ClassificationService.classifyImage(standardizedPages[0].imageData, 'auto', false, standardizedPages[0].originalFileName)
      : null;
    const globalQuestionText = classificationResult?.extractedQuestionText;
    logClassificationComplete();

    // --- Run OCR on each page in parallel ---
    const logOcrComplete = logStep('OCR Processing', 'mathpix');
    const pageProcessingPromises = standardizedPages.map(async (page): Promise<PageOcrResult> => {
      const ocrResult = await OCRService.processImage(
        page.imageData, {}, false, 'auto',
        { extractedQuestionText: globalQuestionText }
      );
      return {
        pageIndex: page.pageIndex,
        ocrData: ocrResult,
        classificationText: globalQuestionText // Pass down for segmentation
      };
    });

    allPagesOcrData = await Promise.all(pageProcessingPromises);
    logOcrComplete();
    sendSseUpdate(res, createProgressData(3, 'OCR & Classification complete.', MULTI_IMAGE_STEPS));
    // ========================== END: IMPLEMENT STAGE 2 ==========================

    // ========================= START: ADD QUESTION DETECTION STAGE =========================
    sendSseUpdate(res, createProgressData(4, 'Detecting questions and fetching schemes...', MULTI_IMAGE_STEPS));

    // Consolidate necessary data for Question Detection (e.g., all OCR text)
    const allOcrTextForDetection = allPagesOcrData.map(p => p.ocrData.text).join('\n\n--- Page Break ---\n\n');
    // Or pass structured blocks if needed by the service

    // Extract questions from AI classification result
    const individualQuestions = extractQuestionsFromClassification(classificationResult, standardizedPages[0]?.originalFileName);
    
    // Create a Map from the detection results
    const markingSchemesMap: Map<string, any> = new Map();
    
    // Call question detection for each individual question
    const logQuestionDetectionComplete = logStep('Question Detection', 'question-detection');
    for (const question of individualQuestions) {
        const detectionResult = await questionDetectionService.detectQuestion(question.text);
        
        if (detectionResult.found && detectionResult.match?.markingScheme) {
            // Use the actual question number from database (Q13, Q14, etc.) not temporary ID
            const actualQuestionNumber = detectionResult.match.questionNumber;
            
            // Extract the specific question's marks from the marking scheme
            let questionSpecificMarks = null;
            
            if (detectionResult.match.markingScheme.questionMarks) {
                questionSpecificMarks = detectionResult.match.markingScheme.questionMarks;
            } else {
                questionSpecificMarks = detectionResult.match.markingScheme;
            }
            
            const schemeWithTotalMarks = {
                questionMarks: questionSpecificMarks,
                totalMarks: detectionResult.match.marks,
                questionNumber: actualQuestionNumber
            };
            
            markingSchemesMap.set(actualQuestionNumber, schemeWithTotalMarks);
        }
    }
    logQuestionDetectionComplete();
    sendSseUpdate(res, createProgressData(4, `Detected ${markingSchemesMap.size} question scheme(s).`, MULTI_IMAGE_STEPS));
    // ========================== END: ADD QUESTION DETECTION STAGE ==========================

    // ========================= START: IMPLEMENT STAGE 3 =========================
    // --- Stage 3: Consolidation & Segmentation ---
    sendSseUpdate(res, createProgressData(5, 'Segmenting work by question...', MULTI_IMAGE_STEPS));

    // Call the segmentation function
    markingTasks = await segmentOcrResultsByQuestion(
      allPagesOcrData,
      globalQuestionText,
      markingSchemesMap, // <-- Pass the map here
      classificationResult,
      standardizedPages[0]?.originalFileName
    );

    // Handle case where no student work is found
    if (markingTasks.length === 0) {
      sendSseUpdate(res, createProgressData(5, 'Segmentation complete. No student work found to mark.', MULTI_IMAGE_STEPS));
      const finalOutput = { 
        submissionId, 
        resultsByQuestion: [], 
        annotatedOutput: standardizedPages.map(p => p.imageData), // Return originals if no work
        outputFormat: isPdf ? 'pdf' : 'images' 
      };
      sendSseUpdate(res, { type: 'complete', result: finalOutput }, true);
      res.end();
      return; // Exit early
    }
    sendSseUpdate(res, createProgressData(5, `Segmentation complete. Identified student work for ${markingTasks.length} question(s).`, MULTI_IMAGE_STEPS));
    // ========================== END: IMPLEMENT STAGE 3 ==========================

    // ========================= START: ADD SCHEME TO TASKS =========================
    // --- Stage 3.5: Add Correct Scheme to Each Task ---
    const tasksWithSchemes: MarkingTask[] = markingTasks.map(task => {
        const scheme = markingSchemesMap.get(String(task.questionNumber)); // Look up the fetched scheme
        if (!scheme) {
             // Decide how to handle missing scheme: skip task, use default, throw error?
             // For now, let's add a placeholder to avoid crashing executeMarkingForQuestion
             return { ...task, markingScheme: { error: `Scheme not found for Q${task.questionNumber}` } };
        }
        return { ...task, markingScheme: scheme }; // Add the found scheme
    }).filter(task => task.markingScheme && !task.markingScheme.error); // Filter out tasks without valid schemes

    if (tasksWithSchemes.length === 0 && markingTasks.length > 0) {
         throw new Error("Failed to assign marking schemes to any detected question work.");
    }
    // ========================== END: ADD SCHEME TO TASKS ==========================

    // ========================= START: IMPLEMENT STAGE 4 =========================
    // --- Stage 4: Marking (Single or Parallel) ---
    sendSseUpdate(res, createProgressData(6, `Marking ${tasksWithSchemes.length} question(s)...`, MULTI_IMAGE_STEPS));

    // Call the refactored function for each task (works for 1 or many)
    const logMarkingComplete = logStep('AI Marking', actualModel);
    const markingPromises = tasksWithSchemes.map(task => // <-- Use tasksWithSchemes
        executeMarkingForQuestion(task, res, submissionId) // Pass res and submissionId
    );

    // Wait for all marking tasks to complete
    const allQuestionResults: QuestionResult[] = await Promise.all(markingPromises);
    logMarkingComplete();
    sendSseUpdate(res, createProgressData(6, 'All questions marked.', MULTI_IMAGE_STEPS));
    // ========================== END: IMPLEMENT STAGE 4 ==========================

    // ========================= START: IMPLEMENT STAGE 5 =========================
    // --- Stage 5: Aggregation & Output ---
    sendSseUpdate(res, createProgressData(7, 'Aggregating results and generating annotated images...', MULTI_IMAGE_STEPS));
    
    const logAnnotationComplete = logStep('Image Annotation', 'svg-overlay');

    // --- Annotation Grouping ---
    const annotationsByPage: { [pageIndex: number]: EnrichedAnnotation[] } = {};


    allQuestionResults.forEach((qr, questionIndex) => {
        const currentAnnotations = qr.annotations || []; // Ensure array exists

        currentAnnotations.forEach((anno, annoIndex) => {

            if (anno.pageIndex !== undefined && anno.pageIndex >= 0) {
                if (!annotationsByPage[anno.pageIndex]) {
                    annotationsByPage[anno.pageIndex] = [];
                }
                annotationsByPage[anno.pageIndex].push(anno);
            } else {
                console.warn(`[ANNOTATION] Skipping annotation missing valid pageIndex:`, anno);
            }
        });
    });


    // --- Calculate Overall Score (Example) ---
    const overallScore = allQuestionResults.reduce((sum, qr) => sum + (qr.score?.awardedMarks || 0), 0);
    const totalPossibleScore = allQuestionResults.reduce((sum, qr) => sum + (qr.score?.totalMarks || 0), 0);
    const overallScoreText = `${overallScore}/${totalPossibleScore}`; // Adjust if total marks aren't directly summable

    // --- Parallel Annotation Drawing using SVGOverlayService ---
    sendSseUpdate(res, createProgressData(7, `Drawing annotations on ${standardizedPages.length} pages...`, MULTI_IMAGE_STEPS));
    const annotationPromises = standardizedPages.map(async (page) => {
        const pageIndex = page.pageIndex;
        const annotationsForThisPage = annotationsByPage[pageIndex] || [];
        const imageDimensions = { width: page.width, height: page.height };
        // Draw score only on the last page (adjust logic if needed)
        const scoreToDraw = (pageIndex === standardizedPages.length - 1) ? { scoreText: overallScoreText } : undefined;

        // Log exactly what's being sent to the drawing service

        // Only call service if there's something to draw
        if (annotationsForThisPage.length > 0 || scoreToDraw) {
            try {
                return await SVGOverlayService.burnSVGOverlayServerSide(
                    page.imageData,
                    annotationsForThisPage,
                    imageDimensions,
                    scoreToDraw
                );
            } catch (drawError) {
                console.error(`❌ [ANNOTATION] Failed to draw annotations on page ${pageIndex}:`, drawError);
                return page.imageData; // Fallback
            }
        }
        return page.imageData; // Return original if nothing to draw
    });
    const annotatedImagesBase64: string[] = await Promise.all(annotationPromises);
    sendSseUpdate(res, createProgressData(7, 'Annotation drawing complete.', MULTI_IMAGE_STEPS));

        // --- Upload Annotated Images to Storage (for authenticated users) ---
        let annotatedImageLinks: string[] = [];
        
        if (isAuthenticated) {
            // Upload annotated images to storage for authenticated users
            const uploadPromises = annotatedImagesBase64.map(async (imageData, index) => {
                try {
                    const imageLink = await ImageStorageService.uploadImage(
                        imageData,
                        userId,
                        `multi-${submissionId}`,
                        'annotated'
                    );
                    return imageLink;
                } catch (uploadError) {
                    console.error(`❌ [ANNOTATION] Failed to upload annotated image ${index}:`, uploadError);
                    return imageData; // Fallback to base64
                }
            });
            annotatedImageLinks = await Promise.all(uploadPromises);
        }

        // --- Construct Final Output (Always Images) ---
        const outputFormat: 'images' = 'images'; // Explicitly set to images
        const finalAnnotatedOutput: string[] = isAuthenticated ? annotatedImageLinks : annotatedImagesBase64;
        logAnnotationComplete();

        // Add PDF context if available
        const pdfContext = (req as any)?.pdfContext;
        
        const finalOutput = {
            success: true, // Add success flag for frontend compatibility
            submissionId: submissionId,
            resultsByQuestion: allQuestionResults.map(qr => ({
                 questionNumber: qr.questionNumber,
                 score: qr.score,
                 feedback: qr.feedback,
            })),
            annotatedOutput: finalAnnotatedOutput,
            outputFormat: outputFormat,
            originalInputType: isPdf ? 'pdf' : 'images',
            // Add PDF context for frontend display
            ...(pdfContext && {
                originalFileType: pdfContext.originalFileType,
                originalPdfLink: pdfContext.originalPdfLink,
                originalPdfDataUrl: pdfContext.originalPdfDataUrl,
                originalFileName: pdfContext.originalFileName
            })
        };

    // ========================= START: DATABASE PERSISTENCE =========================
    // --- Database Persistence (Following Original Pipeline Design) ---
    try {
      const { FirestoreService } = await import('../services/firestoreService.js');
      
      // Extract request data
      const userId = (req as any)?.user?.uid || 'anonymous';
      const userEmail = (req as any)?.user?.email || 'anonymous@example.com';
      const isAuthenticated = !!(req as any)?.user?.uid;
      const sessionId = req.body.sessionId || `temp-${Date.now()}`;
      const currentSessionId = sessionId.startsWith('temp-') ? `session-${Date.now()}` : sessionId;
      const customText = req.body.customText;
      const model = req.body.model || 'auto';
      
      // Resolve actual model if 'auto' is specified
      if (model === 'auto') {
        const { getDefaultModel } = await import('../config/aiModels.js');
        actualModel = getDefaultModel();
      } else {
        actualModel = model;
      }
      const aiMessageId = req.body.aiMessageId;
      
      // Generate timestamps for database consistency
      const userTimestamp = new Date(Date.now() - 1000).toISOString(); // User message 1 second earlier
      const aiTimestamp = new Date().toISOString(); // AI message current time
      
      // Upload original images to Firebase Storage for authenticated users
      let originalImageLinks: string[] = [];
      if (isAuthenticated) {
        const uploadPromises = files.map(async (file, index) => {
          try {
            const imageLink = await ImageStorageService.uploadImage(
              file.buffer.toString('base64'),
              userId,
              `multi-${submissionId}`,
              'original'
            );
            return imageLink;
          } catch (uploadError) {
            console.error(`❌ [UPLOAD] Failed to upload original image ${index}:`, uploadError);
            return file.buffer.toString('base64'); // Fallback to base64
          }
        });
        originalImageLinks = await Promise.all(uploadPromises);
      }

      // Create user message for database
      const dbUserMessage = createUserMessage({
        content: customText || (isPdf ? 'I have uploaded a PDF for analysis.' : `I have uploaded ${files.length} file(s) for analysis.`),
        imageData: !isAuthenticated && files.length === 1 ? files[0].buffer.toString('base64') : undefined,
        imageDataArray: !isAuthenticated && files.length > 1 ? files.map(f => f.buffer.toString('base64')) : undefined,
        originalFileName: files.length === 1 ? files[0]?.originalname : files.map(f => f.originalname).join(', '),
        sessionId: currentSessionId,
        model: model,
        // Add PDF context if applicable
        ...(pdfContext && {
          originalFileType: pdfContext.originalFileType,
          originalPdfLink: pdfContext.originalPdfLink,
          originalPdfDataUrl: pdfContext.originalPdfDataUrl
        })
      });

      // Add image links for authenticated users
      if (isAuthenticated) {
        if (files.length === 1) {
          (dbUserMessage as any).imageLink = originalImageLinks[0];
        } else {
          (dbUserMessage as any).imageDataArray = originalImageLinks;
        }
      }
      
      // Override timestamp for database consistency
      (dbUserMessage as any).timestamp = userTimestamp;
      
      // Create AI message for database
      const resolvedAIMessageId = handleAIMessageIdForEndpoint(req.body, null, 'marking');
      const dbAiMessage = createAIMessage({
        content: 'Marking completed - see results below',
        messageId: resolvedAIMessageId,
        imageData: finalAnnotatedOutput.length === 1 ? finalAnnotatedOutput[0] : undefined, // Use first image for single image cases
        imageDataArray: finalAnnotatedOutput.length > 1 ? finalAnnotatedOutput : undefined, // Use all images for multi-image cases
        progressData: {
          currentStepDescription: 'Marking completed',
          allSteps: MULTI_IMAGE_STEPS,
          currentStepIndex: 7,
          isComplete: true
        },
        processingStats: {
          processingTimeMs: Date.now() - startTime,
          modelUsed: model,
          apiUsed: 'unified_marking_pipeline',
          totalLlmTokens: 0, // Will be calculated from individual results if available
          totalMathpixCalls: 0, // Will be calculated from individual results if available
          totalTokens: 0, // Will be calculated from individual results if available
          averageConfidence: 0, // Will be calculated from individual results if available
          imageSize: files.reduce((sum, f) => sum + f.size, 0),
          totalAnnotations: allQuestionResults.reduce((sum, q) => sum + (q.annotations?.length || 0), 0)
        },
        suggestedFollowUps: [
          'Provide model answer according to the marking scheme.',
          'Show marking scheme.',
          'Similar practice questions.'
        ]
      });
      
      // Add unified pipeline specific data to the AI message
      // Note: imageDataArray is already set in createAIMessage above, don't override it
      (dbAiMessage as any).resultsByQuestion = allQuestionResults;
      
      // Add detectedQuestion data for exam stats tabs (following original pipeline design)
      // For multi-question cases, combine all question numbers and total marks
      const allQuestionNumbers = Array.from(markingSchemesMap.keys());
      const totalMarks = Array.from(markingSchemesMap.values()).reduce((sum, scheme) => sum + (scheme.totalMarks || 0), 0);
      const firstQuestionScheme = allQuestionNumbers.length > 0 ? markingSchemesMap.get(allQuestionNumbers[0]) : null;
      
      if (firstQuestionScheme && allQuestionNumbers.length > 0) {
        // For multi-question cases, show "Q13, 14" format
        const questionNumberDisplay = allQuestionNumbers.length > 1 
          ? allQuestionNumbers.join(', ') 
          : allQuestionNumbers[0];
        
        (dbAiMessage as any).detectedQuestion = {
          found: true,
          questionText: globalQuestionText || '',
          questionNumber: questionNumberDisplay,
          subQuestionNumber: '',
          examBoard: 'Pearson Edexcel',
          examCode: '1MA1/2H',
          paperTitle: 'Mathematics',
          subject: 'Mathematics',
          tier: 'Higher Tier',
          year: '2022',
          marks: totalMarks, // Use total marks from all questions
          markingScheme: firstQuestionScheme.questionMarks ? JSON.stringify(firstQuestionScheme.questionMarks) : ''
        };
      } else {
        (dbAiMessage as any).detectedQuestion = {
          found: false,
          questionText: '',
          questionNumber: '',
          subQuestionNumber: '',
          examBoard: '',
          examCode: '',
          paperTitle: '',
          subject: '',
          tier: '',
          year: '',
          marks: 0,
          markingScheme: ''
        };
      }
      
      // Override timestamp for database consistency
      (dbAiMessage as any).timestamp = aiTimestamp;
      
      // Generate session title using the same smart logic as original pipeline
      const { generateSessionTitle } = await import('../services/marking/MarkingHelpers.js');
      
      // Extract question text from OCR results for title generation
      let extractedQuestionText = '';
      if (allPagesOcrData.length > 0) {
        // Get the first page's OCR text as fallback
        const firstPageOcr = allPagesOcrData[0];
        if (firstPageOcr.ocrData?.mathBlocks && firstPageOcr.ocrData.mathBlocks.length > 0) {
          // Use the first few math blocks as question text
          extractedQuestionText = firstPageOcr.ocrData.mathBlocks
            .slice(0, 3)
            .map(block => block.googleVisionText || block.mathpixLatex || '')
            .join(' ')
            .trim();
        }
      }
      
      // Generate session title for multi-question cases
      let sessionTitle: string;
      if (allQuestionNumbers.length > 0 && firstQuestionScheme) {
        // Use exam stats pattern for multi-question cases
        const questionNumberDisplay = allQuestionNumbers.length > 1 
          ? allQuestionNumbers.join(', ') 
          : allQuestionNumbers[0];
        
        sessionTitle = `Pearson Edexcel Mathematics 1MA1/2H (2022) Tier Higher Tier Q${questionNumberDisplay} ${totalMarks} marks`;
      } else {
        // Fallback to original logic for single questions or no detection
        sessionTitle = generateSessionTitle(null, globalQuestionText, 'Marking');
      }
      
      // Handle session creation and message storage - only for authenticated users
      if (isAuthenticated) {
        if (sessionId && !sessionId.startsWith('temp-')) {
          // Adding to existing session
          await FirestoreService.addMessageToUnifiedSession(currentSessionId, dbUserMessage);
          await FirestoreService.addMessageToUnifiedSession(currentSessionId, dbAiMessage);
        } else {
          // Creating new session
          await FirestoreService.createUnifiedSessionWithMessages({
            sessionId: currentSessionId,
            title: sessionTitle,
            userId: userId,
            messageType: 'Marking',
            messages: [dbUserMessage, dbAiMessage],
            isPastPaper: false,
            sessionStats: {
              totalProcessingTimeMs: Date.now() - startTime,
              lastModelUsed: model,
              lastApiUsed: 'unified_marking_pipeline',
              totalLlmTokens: 0, // Will be calculated from individual results if available
              totalMathpixCalls: 0, // Will be calculated from individual results if available
              totalTokens: 0, // Will be calculated from individual results if available
              averageConfidence: 0, // Will be calculated from individual results if available
              imageSize: files.reduce((sum, f) => sum + f.size, 0),
              totalAnnotations: allQuestionResults.reduce((sum, q) => sum + (q.annotations?.length || 0), 0)
            }
          });
        }
      } else {
      }
      
      // For authenticated users, include session data to trigger sidebar updates
      if (isAuthenticated) {
        (finalOutput as any).unifiedSession = {
          id: currentSessionId,
          title: sessionTitle,
          messages: [dbUserMessage, dbAiMessage],
          userId: userId,
          messageType: 'Marking',
          createdAt: userTimestamp,
          updatedAt: aiTimestamp,
          isPastPaper: false,
          sessionStats: {
            totalProcessingTimeMs: Date.now() - startTime,
            lastModelUsed: model,
            lastApiUsed: 'unified_marking_pipeline',
            totalLlmTokens: 0,
            totalMathpixCalls: 0,
            totalTokens: 0,
            averageConfidence: 0,
            imageSize: files.reduce((sum, f) => sum + f.size, 0),
            totalAnnotations: allQuestionResults.reduce((sum, q) => sum + (q.annotations?.length || 0), 0)
          }
        };
      }
      
    } catch (error) {
      console.error(`❌ [SUBMISSION ${submissionId}] Failed to persist to database:`, error);
      // Continue without throwing - user still gets response
    }
    // ========================== END: DATABASE PERSISTENCE ==========================

      // --- Send FINAL Complete Event ---
      sendSseUpdate(res, { type: 'complete', result: finalOutput }, true); // 'true' marks as final
      
      // --- Performance Summary (reuse original design) ---
      const totalProcessingTime = Date.now() - startTime;
      logPerformanceSummary(stepTimings, totalProcessingTime, actualModel, 'unified');
      
      console.log(`\n🏁 ========== UNIFIED PIPELINE END ==========`);
      console.log(`🏁 ==========================================\n`);
    // ========================== END: IMPLEMENT STAGE 5 ==========================

  } catch (error) {
    console.error(`❌ [SUBMISSION ${submissionId}] Processing failed:`, error);
    console.log(`\n💥 ========== UNIFIED PIPELINE FAILED ==========`);
    console.log(`💥 =============================================\n`);
    
    // Provide user-friendly error messages based on error type
    let userFriendlyMessage = 'An unexpected error occurred. Please try again.';
    
    if (error instanceof Error) {
      if (error.message.includes('quota exceeded') || error.message.includes('429')) {
        userFriendlyMessage = 'API quota exceeded. Please try again later or contact support if this persists.';
      } else if (error.message.includes('timeout')) {
        userFriendlyMessage = 'Request timed out. The image might be too complex or the service is busy. Please try again.';
      } else if (error.message.includes('authentication') || error.message.includes('401') || error.message.includes('403')) {
        userFriendlyMessage = 'Authentication error. Please refresh the page and try again.';
      } else if (error.message.includes('network') || error.message.includes('connection')) {
        userFriendlyMessage = 'Network error. Please check your connection and try again.';
      } else if (error.message.includes('Invalid file submission')) {
        userFriendlyMessage = error.message; // Use the specific validation error message
      }
    }
    
    // Ensure SSE message indicates error before closing
    sendSseUpdate(res, createProgressData(0, `Error: ${userFriendlyMessage}`, MULTI_IMAGE_STEPS, true));
    
    // Ensure the connection is always closed on error
    if (!res.writableEnded) {
      res.end();
    }
  } finally {
    // --- Ensure Connection Closure (Only if not already closed) ---
    if (!res.writableEnded) {
      closeSseConnection(res);
    } else {
    }
  }
});

/**
 * GET /marking/download-image
 * Download image by proxying the request to avoid CORS issues
 * (Preserved from original markingApi.ts)
 */
router.get('/download-image', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { url, filename } = req.query;
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ 
        success: false, 
        error: 'Image URL is required' 
      });
    }

    // Fetch the image from the external URL
    const response = await fetch(url);
    
    if (!response.ok) {
      return res.status(404).json({ 
        success: false, 
        error: 'Image not found' 
      });
    }

    // Get the image data
    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    
    // Set headers for download
    const downloadFilename = filename && typeof filename === 'string' ? filename : 'image';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.setHeader('Content-Length', imageBuffer.byteLength);
    
    // Send the image data
    res.send(Buffer.from(imageBuffer));
    
  } catch (error) {
    console.error('Error downloading image:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to download image' 
    });
  }
});

export default router;

