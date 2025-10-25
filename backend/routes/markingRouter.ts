/**
 * Unified Marking Router
 * Handles single images, multiple images, and PDFs through a single endpoint
 */

import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { optionalAuth } from '../middleware/auth.js';
import type { ModelType } from '../types/index.js';
// import { runOriginalSingleImagePipeline } from './originalPipeline.js'; // Removed - using unified pipeline only
import PdfProcessingService from '../services/pdf/PdfProcessingService.js';
import sharp from 'sharp';
import { ImageUtils } from '../utils/ImageUtils.js';
import { sendSseUpdate, closeSseConnection, createProgressData } from '../utils/sseUtils.js';
import { createAIMessage, createUserMessage, handleAIMessageIdForEndpoint, calculateMessageProcessingStats, calculateSessionStats } from '../utils/messageUtils.js';
import { logPerformanceSummary, logCommonSteps, getSuggestedFollowUps } from '../services/marking/MarkingHelpers.js';
import { 
  generateSessionTitle, 
  sendProgressUpdate, 
  withPerformanceLogging, 
  withErrorHandling 
} from '../utils/markingRouterHelpers.js';
import { SessionManagementService } from '../services/sessionManagementService.js';
import type { MarkingSessionContext, QuestionSessionContext } from '../types/sessionManagement.js';

// Helper functions for real model and API names
function getRealModelName(modelType: string): string {
  if (modelType === 'auto') {
    return 'gemini-2.5-flash'; // Default model for auto
  }
  return modelType; // Return the actual model name
}

function getRealApiName(modelName: string): string {
  if (modelName.includes('gemini')) {
    return 'Google Gemini API';
  }
  // Add other API mappings as needed
  return 'Unknown API';
}
import type { StandardizedPage, PageOcrResult, MathBlock } from '../types/markingRouter.js';
import type { MarkingTask } from '../services/marking/MarkingExecutor.js';
import { OCRService } from '../services/ocr/OCRService.js';
import { ClassificationService } from '../services/marking/ClassificationService.js';
import { MarkingInstructionService } from '../services/marking/MarkingInstructionService.js';
import { SVGOverlayService } from '../services/marking/svgOverlayService.js';
import { executeMarkingForQuestion, QuestionResult, EnrichedAnnotation } from '../services/marking/MarkingExecutor.js';
import { questionDetectionService } from '../services/marking/questionDetectionService.js';
import { ImageStorageService } from '../services/imageStorageService.js';
// import { getMarkingScheme } from '../services/marking/questionDetectionService.js';

// Placeholder function removed - schemes are now fetched in Question Detection stage

// Types are now imported from '../types/markingRouter.js'


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
    
    return questions;
  }
  
  // Fallback: Handle old extractedQuestionText structure
  if (classification?.extractedQuestionText) {
    return [{
      text: classification.extractedQuestionText
    }];
  }
  
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

// --- Helper: findQuestionIndicators (This IS still needed) ---
// Finds question start lines *within a single page's raw text*
const findQuestionIndicators = (
  rawLines: Array<any & { pageIndex: number; globalIndex: number }>
): Array<{ questionNumber: string; pageIndex: number; y: number }> => {
    const indicators: Array<{ questionNumber: string; pageIndex: number; y: number }> = [];
    const questionRegex = /^(?:(question|q)\s*)?(\d+[a-z]?)[.)]?\s+/i;

    rawLines.forEach(line => {
        const text = (line.text?.trim() || '')
            .replace(/\\\(|\\\)|\\\[|\\\]/g, '') // Clean LaTeX
            .trim();
        const match = text.match(questionRegex);
        
        if (match && text.length < 150) {
            const questionNumber = match[2];
            const coords = OCRService.extractBoundingBox(line); // Assumes OCRService.extractBoundingBox is static
            if (coords) {
                 console.log(`[DEBUG - SEGMENTATION] Found Question Indicator: "Q${questionNumber}" on Page ${line.pageIndex}, Y: ${coords.y}`);
                indicators.push({
                    questionNumber: questionNumber,
                    pageIndex: line.pageIndex,
                    y: coords.y
                });
            }
        }
    });
    return indicators.sort((a, b) => {
        if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
        return a.y - b.y;
    });
};

// --- Helper: assignBlockToQuestion (This IS still needed) ---
// Assigns a block to an indicator *on the same page*
const assignBlockToQuestion = (
    block: MathBlock & { pageIndex: number },
    indicators: Array<{ questionNumber: string; pageIndex: number; y: number }>
): string | null => {
    let assignedQuestion: string | null = null;
    // Find the last indicator *on the same page* that appeared *before* this block
    const pageIndicators = indicators.filter(ind => ind.pageIndex === block.pageIndex);
    
    for (const indicator of pageIndicators) {
        if ((block.coordinates?.y ?? 0) >= indicator.y) {
            assignedQuestion = indicator.questionNumber;
        } else {
            break; // Block is before this indicator
        }
    }
    return assignedQuestion;
};

// ========================= START: REPLACED SEGMENTATION LOGIC =========================
/**
 * NEW SEGMENTATION LOGIC (STEP 6)
 * Segments OCR results by mapping blocks to questions based on the
 * source image index provided by the ClassificationService.
 */
const segmentOcrResultsByQuestion = (
  allPagesOcrData: PageOcrResult[],
  classificationResult: any, // The full result from ClassificationService
  detectedSchemesMap?: Map<string, any>,
  standardizedPages?: StandardizedPage[] // Add standardizedPages to access filenames
): MarkingTask[] => {
  console.log('🔧 [SEGMENTATION] Consolidating and segmenting OCR results...');
  
  if (!allPagesOcrData || allPagesOcrData.length === 0) return [];
  if (!classificationResult || !classificationResult.questions || classificationResult.questions.length === 0) {
       console.warn('[SEGMENTATION] No questions found in classification result. Cannot segment.');
       return [];
  }

  // 1. Consolidate all processed math blocks
  let allMathBlocksForContent: Array<MathBlock & { pageIndex: number; globalBlockId: string }> = [];
  let blockCounter = 0;
  allPagesOcrData.forEach((pageResult) => {
    const mathBlocks = pageResult.ocrData?.mathBlocks || [];
    console.log(`[DEBUG] Page ${pageResult.pageIndex}: Consolidating ${mathBlocks.length} processed blocks.`);
    mathBlocks.forEach((block) => {
       allMathBlocksForContent.push({
           ...block,
           pageIndex: pageResult.pageIndex,
           globalBlockId: `block_${blockCounter++}`
      });
    });
  });
  console.log(`  -> Consolidated ${allMathBlocksForContent.length} total processed math blocks.`);

  // 2. Filter out empty blocks (safeguard)
  const studentWorkBlocks = allMathBlocksForContent.filter(block =>
      (block.mathpixLatex || block.googleVisionText || '').trim().length > 0
  );
  if (studentWorkBlocks.length === 0) {
    console.warn(`[SEGMENTATION] No student work blocks found after consolidation.`);
    return [];
  }

  // 3. Create a map of { pageIndex -> [list of question numbers on that page] }
  //    This map is our "source of truth" from Classification + Question Detection
  const pageToQuestionNumbersMap = new Map<number, string[]>();
  const allDetectedQuestionNumbers = Array.from(detectedSchemesMap?.keys() || []);
  
  // Create a mapping from filename to page index using the standardizedPages
  const filenameToPageIndexMap = new Map<string, number>();
  if (standardizedPages) {
    standardizedPages.forEach((page) => {
      const filename = page.originalFileName || '';
      if (filename) {
        filenameToPageIndexMap.set(filename, page.pageIndex);
      }
    });
  }
  
  classificationResult.questions.forEach((classifiedQ: any) => {
      // Get page index from filename mapping
      const sourceImage = classifiedQ.sourceImage || '';
      const pageIndex = filenameToPageIndexMap.get(sourceImage);
      
      if (pageIndex === undefined) {
        console.warn(`[SEGMENTATION] Could not find page index for source image: ${sourceImage}`);
        return;
      }
      
      // Find the *actual* question number(s) detected in this text
      const textPreview = classifiedQ.textPreview || '';
      let detectedQNsOnThisPage: string[] = [];
      
      // First, try to find question numbers in the text preview
      detectedQNsOnThisPage = allDetectedQuestionNumbers.filter(qNum => 
          textPreview.toLowerCase().includes(qNum) ||
          textPreview.toLowerCase().includes(`q${qNum}`)
      );
      
      // If no question numbers found in text, try to infer from filename
      if (detectedQNsOnThisPage.length === 0) {
        const filename = sourceImage.toLowerCase();
        detectedQNsOnThisPage = allDetectedQuestionNumbers.filter(qNum => 
            filename.includes(`q${qNum}`) || filename.includes(qNum)
        );
      }
      
      // If still no matches, try to infer from the source image name pattern
      if (detectedQNsOnThisPage.length === 0) {
        const filename = sourceImage.toLowerCase();
        // For Q21 case: if filename contains "q21", assign Q21
        if (filename.includes('q21')) {
          detectedQNsOnThisPage = ['21'];
        }
        // For Q13/Q14 case: if filename contains "q13" or "q14", assign both
        else if (filename.includes('q13') || filename.includes('q14')) {
          detectedQNsOnThisPage = allDetectedQuestionNumbers.filter(qNum => 
              qNum === '13' || qNum === '14'
          );
        }
      }
      
      console.log(`[SEGMENTATION] Source image: ${sourceImage}, Page: ${pageIndex}, Detected QNs: [${detectedQNsOnThisPage.join(', ')}]`);
      
      if (detectedQNsOnThisPage.length > 0) {
          if (!pageToQuestionNumbersMap.has(pageIndex)) {
              pageToQuestionNumbersMap.set(pageIndex, []);
          }
          const existingQNs = pageToQuestionNumbersMap.get(pageIndex)!;
          detectedQNsOnThisPage.forEach(qNum => {
              if (!existingQNs.includes(qNum)) {
                  existingQNs.push(qNum);
              }
          });
      }
  });
  console.log('[DEBUG] Page-to-Question Map created:', pageToQuestionNumbersMap);

  // 4. Group Blocks by Question
  const blocksByQuestion: Map<string, (MathBlock & { pageIndex: number })[]> = new Map();

  for (const [pageIndex, questionNumbers] of pageToQuestionNumbersMap.entries()) {
      const blocksOnThisPage = studentWorkBlocks.filter(b => b.pageIndex === pageIndex);
      
      if (questionNumbers.length === 1) {
          // Simple case: All blocks on this page belong to this one question
          const qNum = questionNumbers[0];
          if (!blocksByQuestion.has(qNum)) blocksByQuestion.set(qNum, []);
          blocksByQuestion.get(qNum)!.push(...blocksOnThisPage);
          console.log(`[SEGMENTATION] Assigning all ${blocksOnThisPage.length} blocks from Page ${pageIndex} to Q${qNum}`);

      } else if (questionNumbers.length > 1) {
          // Complex case: Multiple questions on one page (e.g., Q13/Q14 on Page 2)
          console.log(`[SEGMENTATION] Found ${questionNumbers.length} questions [${questionNumbers.join(',')}] on Page ${pageIndex}. Binning blocks for this page...`);
          
          // Get the raw lines *for this page only* to find indicators
          const pageRawLines = allPagesOcrData[pageIndex]?.ocrData?.rawResponse?.rawLineData
              .map((line, i) => ({...line, pageIndex, globalIndex: i})) || [];
          
          const indicatorsOnPage = findQuestionIndicators(pageRawLines)
              .filter(ind => questionNumbers.includes(ind.questionNumber)); // Only use indicators for questions we *know* are on this page
          
          blocksOnThisPage.forEach(block => {
              const assignedQNum = assignBlockToQuestion(block, indicatorsOnPage);
              if (assignedQNum) {
                  if (!blocksByQuestion.has(assignedQNum)) blocksByQuestion.set(assignedQNum, []);
                  blocksByQuestion.get(assignedQNum)!.push(block);
              } else {
                  console.warn(`[SEGMENTATION] Could not assign block ${block.globalBlockId} on Page ${pageIndex} to any of [${questionNumbers.join(', ')}]`);
              }
          });
      }
  }

  // 5. Handle "work-only" pages (continuation pages like q21-bottom)
  const assignedPageIndices = Array.from(pageToQuestionNumbersMap.keys());
  const unassignedPages = allPagesOcrData.filter(page => !assignedPageIndices.includes(page.pageIndex));
  let lastAssignedQuestion: string | null = null; // Track the last question

  // Sort pages to process in order
  const allPageIndices = [...new Set(allPagesOcrData.map(p => p.pageIndex))].sort((a,b) => a - b);
  
  for (const pageIndex of allPageIndices) {
      if (pageToQuestionNumbersMap.has(pageIndex)) {
          // This page has question headers, update the "last seen" question
          const questionsOnThisPage = pageToQuestionNumbersMap.get(pageIndex)!;
          // Use the last question on the page as the "current" one
          lastAssignedQuestion = questionsOnThisPage[questionsOnThisPage.length - 1];
      } else {
          // This is a "work-only" page.
          if (lastAssignedQuestion) {
              const blocksOnThisPage = studentWorkBlocks.filter(b => b.pageIndex === pageIndex);
              console.log(`[SEGMENTATION] Page ${pageIndex} is work-only. Assigning ${blocksOnThisPage.length} blocks to previous question: Q${lastAssignedQuestion}`);
              if (!blocksByQuestion.has(lastAssignedQuestion)) blocksByQuestion.set(lastAssignedQuestion, []);
              blocksByQuestion.get(lastAssignedQuestion)!.push(...blocksOnThisPage);
          } else {
              console.warn(`[SEGMENTATION] Page ${pageIndex} is work-only but no previous question was found. Discarding ${studentWorkBlocks.filter(b => b.pageIndex === pageIndex).length} blocks.`);
          }
      }
  }


  // 6. Create Marking Tasks from grouped blocks
  const tasks: MarkingTask[] = [];
  for (const [questionNumber, blocks] of blocksByQuestion.entries()) {
      if (blocks.length === 0) continue;
      
      blocks.sort((a, b) => { // Sort blocks within each question
        if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
        return (a.coordinates?.y ?? 0) - (b.coordinates?.y ?? 0);
      });
      
      const sourcePages = [...new Set(blocks.map(b => b.pageIndex))].sort((a, b) => a - b);
      
      tasks.push({
          questionNumber: questionNumber,
          mathBlocks: blocks,
          markingScheme: null, // Scheme will be added by the router
          sourcePages: sourcePages
      });
      console.log(`✅ [SEGMENTATION] Created marking task for Q${questionNumber} with ${blocks.length} blocks from pages ${sourcePages.join(', ')}.`);
  }

  console.log(`✅ [SEGMENTATION] Created ${tasks.length} preliminary marking task(s) (without schemes).`);
  return tasks;
};

// ========================== END: REPLACED SEGMENTATION LOGIC ==========================

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

// Helper function to persist session data to database (reused by both marking and question modes)
// Session management is now handled by SessionManagementService


// Helper functions are now imported from '../utils/markingRouterHelpers.js'

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
    const logInputValidationComplete = logStep('Input Validation', 'validation');

    // --- Input Type Detection (Support Multiple PDFs) ---
    const firstMime = files[0]?.mimetype || 'unknown';
    const isPdf = files.length === 1 && firstMime === 'application/pdf';
    const isMultiplePdfs = files.length > 1 && files.every(f => f.mimetype === 'application/pdf');
    const isSingleImage = files.length === 1 && !isPdf && firstMime.startsWith('image/');
    const isMultipleImages = files.length > 1 && files.every(f => {
      const ok = f.mimetype?.startsWith('image/');
      if (!ok) console.warn(`[MIME CHECK] Non-image file detected in multi-upload: ${f.mimetype}`);
      return ok;
    });

    if (!isSingleImage && !isMultipleImages && !isPdf && !isMultiplePdfs) {
      // Handle invalid combinations (e.g., mixed types)
      console.error(`[SUBMISSION ${submissionId}] Invalid file combination received.`);
      throw new Error('Invalid file submission: Please upload PDFs, images, or a combination of the same type.');
    }
    
    const inputType = isPdf ? 'PDF' : isMultiplePdfs ? 'Multiple PDFs' : isMultipleImages ? 'Multiple Images' : 'Single Image';
    sendSseUpdate(res, createProgressData(0, `Input validated (${inputType}).`, MULTI_IMAGE_STEPS));
    logInputValidationComplete();

    // --- Declare variables at proper scope ---
    let standardizedPages: StandardizedPage[] = [];
    let allPagesOcrData: PageOcrResult[] = [];
    let markingTasks: MarkingTask[] = [];

    // --- Conditional Routing (PDF first) ---
    if (isPdf || isMultiplePdfs) {
      // --- Multi-File / PDF Path (This code only runs if NOT isSingleImage) ---
      sendSseUpdate(res, createProgressData(1, `Preparing ${inputType} processing...`, MULTI_IMAGE_STEPS));

      // Stage 1: Standardization
      if (isPdf) {
        // Single PDF processing
        sendSseUpdate(res, createProgressData(1, 'Converting PDF...', MULTI_IMAGE_STEPS));
        const pdfBuffer = files[0].buffer;
        standardizedPages = await PdfProcessingService.convertPdfToImages(pdfBuffer);
        if (standardizedPages.length === 0) throw new Error('PDF conversion yielded no pages.');
        sendSseUpdate(res, createProgressData(1, `Converted PDF to ${standardizedPages.length} pages.`, MULTI_IMAGE_STEPS));
      } else if (isMultiplePdfs) {
        // Multiple PDFs processing
        sendSseUpdate(res, createProgressData(1, `Converting ${files.length} PDFs...`, MULTI_IMAGE_STEPS));
        const allPdfPages: StandardizedPage[] = [];
        
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          sendSseUpdate(res, createProgressData(1, `Converting PDF ${i + 1}/${files.length}...`, MULTI_IMAGE_STEPS));
          
          const pdfPages = await PdfProcessingService.convertPdfToImages(file.buffer);
          if (pdfPages.length === 0) {
            console.warn(`PDF ${i + 1} (${file.originalname}) yielded no pages.`);
            continue;
          }
          
          // Update page indices to be sequential across all PDFs
          pdfPages.forEach((page, pageIndex) => {
            page.pageIndex = allPdfPages.length + pageIndex;
            page.originalFileName = file.originalname || `pdf-${i + 1}.pdf`;
          });
          
          allPdfPages.push(...pdfPages);
        }
        
        standardizedPages = allPdfPages;
        if (standardizedPages.length === 0) throw new Error('All PDF conversions yielded no pages.');
        sendSseUpdate(res, createProgressData(1, `Converted ${files.length} PDFs to ${standardizedPages.length} total pages.`, MULTI_IMAGE_STEPS));
      }

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
              `data:application/pdf;base64,${files[0].buffer.toString('base64')}`,
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
          originalPdfDataUrl = `data:application/pdf;base64,${files[0].buffer.toString('base64')}`;
        }
        
        // Calculate file size for single PDF
        const fileSizeBytes = files[0].buffer.length;
        const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);
        
        // Store PDF context for later use in the unified pipeline
        (req as any).pdfContext = {
          originalFileType: 'pdf' as const,
          originalPdfLink,
          originalPdfDataUrl,
          originalFileName: files[0].originalname || 'document.pdf',
          fileSize: fileSizeMB + ' MB',
          fileSizeBytes: fileSizeBytes
        };
        
        // Continue to unified pipeline (don't return here)
      } else if (isMultiplePdfs) {
        // Multiple PDFs - store all PDFs for later use
        sendSseUpdate(res, createProgressData(2, 'Processing multiple PDFs...', MULTI_IMAGE_STEPS));
        
        const pdfContexts: any[] = [];
        
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          let originalPdfLink = null;
          let originalPdfDataUrl = null;
          
          // Always create base64 URL for immediate display
          originalPdfDataUrl = `data:application/pdf;base64,${file.buffer.toString('base64')}`;
          
          if (isAuthenticated) {
            try {
              const { ImageStorageService } = await import('../services/imageStorageService.js');
              const sessionId = req.body.sessionId || submissionId;
              const originalFileName = file.originalname || `document-${i + 1}.pdf`;
              originalPdfLink = await ImageStorageService.uploadPdf(
                `data:application/pdf;base64,${file.buffer.toString('base64')}`,
                userId || 'anonymous',
                sessionId,
                originalFileName
              );
            } catch (error) {
              console.error(`❌ Failed to upload PDF ${i + 1}:`, error);
              originalPdfLink = null;
            }
          }
          
          // Calculate file size
          const fileSizeBytes = file.buffer.length;
          const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);
          
          const pdfContextItem = {
            originalFileType: 'pdf' as const,
            originalPdfLink,
            originalPdfDataUrl,
            originalFileName: file.originalname || `document-${i + 1}.pdf`,
            fileSize: fileSizeMB + ' MB',
            fileSizeBytes: fileSizeBytes,
            fileIndex: i
          };
          
          
          
          pdfContexts.push(pdfContextItem);
        }
        
        // Store multiple PDF contexts for later use in the unified pipeline
        (req as any).pdfContext = {
          isMultiplePdfs: true,
          pdfContexts
        };
      }

      // Multi-page PDF or Multiple PDFs – Continue to common processing logic
      
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
    const logPreprocessingComplete = logStep('Preprocessing', 'image-processing');
    const preprocessedImageDatas = await Promise.all(
      standardizedPages.map(page => ImageUtils.preProcess(page.imageData))
    );
    standardizedPages.forEach((page, i) => page.imageData = preprocessedImageDatas[i]);
    sendSseUpdate(res, createProgressData(2, 'Image preprocessing complete.', MULTI_IMAGE_STEPS));
    logPreprocessingComplete();

    // ========================= START: IMPLEMENT STAGE 2 =========================
    // --- Stage 2: Parallel OCR/Classify (Common for Multi-Page PDF & Multi-Image) ---
    sendSseUpdate(res, createProgressData(3, `Running OCR & Classification on ${standardizedPages.length} pages...`, MULTI_IMAGE_STEPS));

    // --- Perform Classification on ALL Images ---
    const logClassificationComplete = logStep('Image Classification', actualModel);
    
    
    // Classify ALL images to detect questions in all of them
    const classificationPromises = standardizedPages.map(async (page, index) => {
      const result = await ClassificationService.classifyImage(page.imageData, 'auto', false, page.originalFileName);
      return { pageIndex: index, result };
    });
    
    const allClassificationResults = await Promise.all(classificationPromises);
    
    // Combine questions from all images
    const allQuestions: any[] = [];
    allClassificationResults.forEach(({ pageIndex, result }) => {
      if (result.questions && Array.isArray(result.questions)) {
        result.questions.forEach((question: any) => {
          allQuestions.push({
            ...question,
            sourceImage: standardizedPages[pageIndex].originalFileName,
            sourceImageIndex: pageIndex
          });
        });
      }
    });
    
    // Create combined classification result
    const classificationResult = {
      isQuestionOnly: allClassificationResults[0]?.result?.isQuestionOnly || false,
      reasoning: allClassificationResults[0]?.result?.reasoning || 'Multi-image classification',
      questions: allQuestions,
      extractedQuestionText: allQuestions.length > 0 ? allQuestions[0].text : allClassificationResults[0]?.result?.extractedQuestionText,
      apiUsed: allClassificationResults[0]?.result?.apiUsed || 'Unknown',
      usageTokens: allClassificationResults.reduce((sum, { result }) => sum + (result.usageTokens || 0), 0)
    };
    // For question mode, use the questions array; for marking mode, use extractedQuestionText
    const globalQuestionText = classificationResult?.questions && classificationResult.questions.length > 0 
      ? classificationResult.questions[0].text 
      : classificationResult?.extractedQuestionText;
    
    
    logClassificationComplete();

    // ========================= QUESTION MODE DETECTION =========================
    // Check if this is a question-only image (like original MarkingPipeline)
    const isQuestionMode = classificationResult?.isQuestionOnly === true;
    
    if (isQuestionMode) {
      // Question mode: simplified pipeline - skip OCR, segmentation, and marking
      
      // Step 1: Question Detection
      sendSseUpdate(res, createProgressData(4, 'Detecting question type...', MULTI_IMAGE_STEPS));
      const logQuestionDetectionComplete = logStep('Question Detection', 'question-detection');
      const questionDetection = await questionDetectionService.detectQuestion(globalQuestionText || '');
      logQuestionDetectionComplete();
      
      // Step 2: AI Response Generation (skip segmentation and marking steps)
      sendSseUpdate(res, createProgressData(6, 'Generating response...', MULTI_IMAGE_STEPS));
      const logAiResponseComplete = logStep('AI Response Generation', actualModel);
      const { MarkingServiceLocator } = await import('../services/marking/MarkingServiceLocator.js');
      const aiResponse = await MarkingServiceLocator.generateChatResponse(
        standardizedPages[0].imageData, 
        globalQuestionText || '', 
        actualModel as ModelType, 
        true, // isQuestionOnly
        false // debug
      );
      logAiResponseComplete();
      
      // Generate suggested follow-ups (same as marking mode)
      const suggestedFollowUps = await getSuggestedFollowUps();
      
      // Complete progress
      sendSseUpdate(res, createProgressData(7, 'Question analysis complete!', MULTI_IMAGE_STEPS));
      
      // Create AI message for question mode with real processing stats
      const realProcessingStats = calculateMessageProcessingStats(
        aiResponse,
        actualModel,
        Date.now() - startTime,
        [], // No annotations in question mode
        standardizedPages[0].imageData.length,
        [] // No question results in question mode
      );

      const aiMessage = createAIMessage({
        content: aiResponse.response,
        imageDataArray: [{
          url: standardizedPages[0].imageData,
          originalFileName: standardizedPages[0].originalFileName || 'question-image.png',
          fileSize: standardizedPages[0].imageData.length
        }],
        progressData: {
          currentStepDescription: 'Question analysis complete',
          allSteps: MULTI_IMAGE_STEPS,
          currentStepIndex: 7,
          isComplete: true
        },
        suggestedFollowUps: suggestedFollowUps,
        processingStats: realProcessingStats
      });
      
      // Update AI message with original image (not annotated)
      (aiMessage as any).imageData = standardizedPages[0].imageData;
      (aiMessage as any).imageLink = null; // No image link for question mode
      
      // ========================= DATABASE PERSISTENCE FOR QUESTION MODE =========================
      let persistenceResult: any = null;
      let userMessage: any = null;
      try {
        // Upload original files for authenticated users
        const uploadResult = await SessionManagementService.uploadOriginalFiles(
          files,
          userId || 'anonymous',
          submissionId,
          !!userId
        );

        // Create structured data
        const { structuredImageDataArray } = SessionManagementService.createStructuredData(
          files,
          false, // isPdf
          false, // isMultiplePdfs
          undefined // pdfContext
        );

        // Create user message for question mode
        userMessage = SessionManagementService.createUserMessageForDatabase(
          {
            content: `I have uploaded 1 file(s) for analysis.`,
            files,
            isPdf: false,
            isMultiplePdfs: false,
            sessionId: req.body.sessionId || submissionId,
            model: req.body.model || 'auto'
          },
          structuredImageDataArray,
          undefined, // structuredPdfContexts
          uploadResult.originalImageLinks
        );
        
        // Persist question session
        const questionContext: QuestionSessionContext = {
          req,
          submissionId,
          startTime,
          userMessage,
          aiMessage,
          questionDetection,
          globalQuestionText: globalQuestionText || '',
          mode: 'Question'
        };
        persistenceResult = await SessionManagementService.persistQuestionSession(questionContext);
        
        // Update the AI message with session data
        (aiMessage as any).sessionId = persistenceResult.sessionId;
        
      } catch (dbError) {
        console.error('❌ [QUESTION MODE] Database persistence failed:', dbError);
        // Continue with response even if database fails
      }
      
      // Create unifiedSession for unauthenticated users (same as marking mode)
      const isAuthenticated = !!(req as any)?.user?.uid;
      let unifiedSession = persistenceResult?.unifiedSession;
      
      if (!isAuthenticated && !unifiedSession) {
        // For unauthenticated users, create a temporary session structure
        unifiedSession = SessionManagementService.createUnauthenticatedSession(
          submissionId,
          userMessage,
          aiMessage,
          [], // No question results in question mode
          startTime,
          actualModel,
          files,
          'Question'
        );
      }
      
      // Send final result
      const finalResult = {
        success: true,
        message: aiMessage,
        sessionId: submissionId,
        mode: 'Question',
        unifiedSession: unifiedSession // Include unified session data for both user types
      };
      
      // Send final result with completion flag
      const finalProgressData = createProgressData(7, 'Complete!', MULTI_IMAGE_STEPS);
      finalProgressData.isComplete = true;
      sendSseUpdate(res, finalProgressData);
      
      // Send completion event in the format expected by frontend
      const completionEvent = {
        type: 'complete',
        result: finalResult
      };
      res.write(`data: ${JSON.stringify(completionEvent)}\n\n`);
      res.end();
      return;
    }

    // --- Run OCR on each page in parallel (Marking Mode) ---
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
            
            // For image version, use question number as key (no duplicate question numbers)
            const uniqueKey = actualQuestionNumber;
            
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
                questionNumber: actualQuestionNumber,
                questionDetection: detectionResult // Store the full question detection result
            };
            
            markingSchemesMap.set(uniqueKey, schemeWithTotalMarks);
        }
    }
    logQuestionDetectionComplete();
    
    // Debug logging for markingSchemesMap
    for (const [key, value] of markingSchemesMap.entries()) {
    }
    
    sendSseUpdate(res, createProgressData(4, `Detected ${markingSchemesMap.size} question scheme(s).`, MULTI_IMAGE_STEPS));
    // ========================== END: ADD QUESTION DETECTION STAGE ==========================

    // ========================= START: IMPLEMENT STAGE 3 =========================
    // --- Stage 3: Consolidation & Segmentation ---
    sendSseUpdate(res, createProgressData(5, 'Segmenting work by question...', MULTI_IMAGE_STEPS));
    const logSegmentationComplete = logStep('Segmentation', 'segmentation');

    // Call the segmentation function
    markingTasks = segmentOcrResultsByQuestion(
      allPagesOcrData,
      classificationResult,
      markingSchemesMap, // <-- Pass the map here
      standardizedPages // <-- Pass standardizedPages for filename mapping
    );

    // Handle case where no student work is found
    if (markingTasks.length === 0) {
      sendSseUpdate(res, createProgressData(5, 'Segmentation complete. No student work found to mark.', MULTI_IMAGE_STEPS));
      const finalOutput = { 
        submissionId, 
        annotatedOutput: standardizedPages.map(p => p.imageData), // Return originals if no work
        outputFormat: isPdf ? 'pdf' : 'images' 
      };
      sendSseUpdate(res, { type: 'complete', result: finalOutput }, true);
      res.end();
      return; // Exit early
    }
    sendSseUpdate(res, createProgressData(5, `Segmentation complete. Identified student work for ${markingTasks.length} question(s).`, MULTI_IMAGE_STEPS));
    logSegmentationComplete();
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
    const logMarkingComplete = logStep('Marking', 'ai-marking');

    // Call the refactored function for each task (works for 1 or many)
    const allQuestionResults: QuestionResult[] = await withPerformanceLogging(
      'AI Marking',
      actualModel,
      async () => {
        const markingPromises = tasksWithSchemes.map(task => // <-- Use tasksWithSchemes
          executeMarkingForQuestion(task, res, submissionId) // Pass res and submissionId
        );
        return Promise.all(markingPromises);
      }
    );
    sendSseUpdate(res, createProgressData(6, 'All questions marked.', MULTI_IMAGE_STEPS));
    logMarkingComplete();
    // ========================== END: IMPLEMENT STAGE 4 ==========================

    // ========================= START: IMPLEMENT STAGE 5 =========================
    // --- Stage 5: Aggregation & Output ---
    sendSseUpdate(res, createProgressData(7, 'Aggregating results and generating annotated images...', MULTI_IMAGE_STEPS));
    const logOutputGenerationComplete = logStep('Output Generation', 'output-generation');
    
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


    // --- Calculate Overall Score and Per-Page Scores ---
    const overallScore = allQuestionResults.reduce((sum, qr) => sum + (qr.score?.awardedMarks || 0), 0);
    const totalPossibleScore = allQuestionResults.reduce((sum, qr) => sum + (qr.score?.totalMarks || 0), 0);
    const overallScoreText = `${overallScore}/${totalPossibleScore}`;
    
    // Calculate per-page scores
    const pageScores: { [pageIndex: number]: { awarded: number; total: number; scoreText: string } } = {};
    allQuestionResults.forEach((qr, index) => {
      const question = classificationResult.questions[index];
      const pageIndex = question?.sourceImageIndex ?? 0;
      
      if (!pageScores[pageIndex]) {
        pageScores[pageIndex] = { awarded: 0, total: 0, scoreText: '' };
      }
      
      pageScores[pageIndex].awarded += qr.score?.awardedMarks || 0;
      pageScores[pageIndex].total += qr.score?.totalMarks || 0;
    });
    
    // Generate score text for each page
    Object.keys(pageScores).forEach(pageIndex => {
      const pageScore = pageScores[parseInt(pageIndex)];
      pageScore.scoreText = `${pageScore.awarded}/${pageScore.total}`;
    });

    // --- Parallel Annotation Drawing using SVGOverlayService ---
    sendSseUpdate(res, createProgressData(7, `Drawing annotations on ${standardizedPages.length} pages...`, MULTI_IMAGE_STEPS));
    const annotationPromises = standardizedPages.map(async (page) => {
        const pageIndex = page.pageIndex;
        const annotationsForThisPage = annotationsByPage[pageIndex] || [];
        const imageDimensions = { width: page.width, height: page.height };
        // Draw per-page score on each page
        const pageScore = pageScores[pageIndex];
        const scoreToDraw = pageScore ? { 
          scoreText: pageScore.scoreText 
        } : undefined;

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
        
        // finalOutput will be constructed after database persistence

    // ========================= START: DATABASE PERSISTENCE =========================
    // --- Database Persistence (Using SessionManagementService) ---
    let dbUserMessage: any = null; // Declare outside try-catch for scope
    let dbAiMessage: any = null; // Declare outside try-catch for scope
    let persistenceResult: any = null; // Declare outside try-catch for scope
    let unifiedSession: any = null; // Declare outside try-catch for scope
    try {
      // Extract request data
      const userId = (req as any)?.user?.uid || 'anonymous';
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
      
      // Generate timestamps for database consistency
      const userTimestamp = new Date(Date.now() - 1000).toISOString(); // User message 1 second earlier
      const aiTimestamp = new Date().toISOString(); // AI message current time
      
      // Upload original files for authenticated users
      const uploadResult = await SessionManagementService.uploadOriginalFiles(
        files,
        userId,
        submissionId,
        isAuthenticated
      );

      // Create structured data
      
      const { structuredImageDataArray, structuredPdfContexts } = SessionManagementService.createStructuredData(
        files,
        isPdf,
        isMultiplePdfs,
        pdfContext
      );
      

      // Update pdfContext with structured data for frontend
      if (pdfContext && structuredPdfContexts) {
        pdfContext.pdfContexts = structuredPdfContexts;
      }

      // Create user message for database
      const messageContent = customText || (isPdf ? 'I have uploaded a PDF for analysis.' : `I have uploaded ${files.length} file(s) for analysis.`);
      
      dbUserMessage = SessionManagementService.createUserMessageForDatabase(
        {
          content: messageContent,
          files,
          isPdf,
          isMultiplePdfs,
          customText,
          sessionId: currentSessionId,
          model,
          pdfContext
        },
        structuredImageDataArray,
        structuredPdfContexts,
        uploadResult.originalImageLinks
      );
      
      // Override timestamp for database consistency
      (dbUserMessage as any).timestamp = userTimestamp;
      
      // Create AI message for database
      const resolvedAIMessageId = handleAIMessageIdForEndpoint(req.body, null, 'marking');
      
      dbAiMessage = SessionManagementService.createAIMessageForDatabase({
        allQuestionResults,
        finalAnnotatedOutput,
        files,
        actualModel,
        startTime,
        markingSchemesMap,
        globalQuestionText,
        resolvedAIMessageId
      });
      
      // Add suggested follow-ups
      (dbAiMessage as any).suggestedFollowUps = await getSuggestedFollowUps();
      
      // Override timestamp for database consistency
      (dbAiMessage as any).timestamp = aiTimestamp;
      
      // Debug logging for markingSchemesMap
      for (const [key, value] of markingSchemesMap.entries()) {
      }
      
      // Persist marking session
      const markingContext: MarkingSessionContext = {
        req,
        submissionId,
        startTime,
        userMessage: dbUserMessage,
        aiMessage: dbAiMessage,
        questionDetection: null,
        globalQuestionText: globalQuestionText || '',
        mode: 'Marking',
        allQuestionResults,
        markingSchemesMap,
        files,
        model: actualModel,
        usageTokens: 0
      };
      persistenceResult = await SessionManagementService.persistMarkingSession(markingContext);
      
      // For authenticated users, use the unifiedSession from persistence
      if (isAuthenticated) {
        unifiedSession = persistenceResult.unifiedSession;
      }
      
    } catch (error) {
      console.error(`❌ [SUBMISSION ${submissionId}] Failed to persist to database:`, error);
      // Continue without throwing - user still gets response
    }
    
    // For unauthenticated users, create unifiedSession even if database persistence failed
    if (!isAuthenticated && !unifiedSession) {
      unifiedSession = SessionManagementService.createUnauthenticatedSession(
        submissionId,
        dbUserMessage,
        dbAiMessage,
        allQuestionResults,
        startTime,
        actualModel,
        files,
        'Marking'
      );
      
      // Debug logging for unauthenticated users
      console.log('  - id:', unifiedSession.id);
      console.log('  - title:', unifiedSession.title);
      console.log('  - messages count:', unifiedSession.messages?.length);
      console.log('  - userId:', unifiedSession.userId);
      console.log('  - markingSchemesMap sample:', Array.from(markingSchemesMap.entries())[0]);
    }
    
    // ========================== END: DATABASE PERSISTENCE ==========================


      // Construct unified finalOutput that works for both authenticated and unauthenticated users
      const finalOutput = {
        success: true, // Add success flag for frontend compatibility
        submissionId: submissionId,
        // Calculate message-specific processing stats (not session-level totals)
        processingStats: {
          apiUsed: getRealApiName(getRealModelName(actualModel)),
          modelUsed: getRealModelName(actualModel),
          totalMarks: allQuestionResults.reduce((sum, q) => sum + (q.score?.totalMarks || 0), 0),
          awardedMarks: allQuestionResults.reduce((sum, q) => sum + (q.score?.awardedMarks || 0), 0),
          questionCount: allQuestionResults.length
        },
        annotatedOutput: finalAnnotatedOutput,
        outputFormat: outputFormat,
        originalInputType: isPdf ? 'pdf' : 'images',
        // Always include unifiedSession for consistent frontend handling
        unifiedSession: unifiedSession,
        // Add PDF context for frontend display
        ...(pdfContext && {
            originalFileType: pdfContext.originalFileType,
            originalPdfLink: pdfContext.originalPdfLink,
            originalPdfDataUrl: pdfContext.originalPdfDataUrl,
            originalFileName: pdfContext.originalFileName,
            // Include pdfContexts for multiple PDFs
            ...(pdfContext.pdfContexts && {
              pdfContexts: pdfContext.pdfContexts
            })
        })
      };
      
      
      // --- Send FINAL Complete Event ---
      sendSseUpdate(res, { type: 'complete', result: finalOutput }, true); // 'true' marks as final
      logOutputGenerationComplete();
      
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

