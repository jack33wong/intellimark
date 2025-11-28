/**
 * Unified Marking Router
 * Handles single images, multiple images, and PDFs through a single endpoint
 */

import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { optionalAuth } from '../middleware/auth.js';
import type { ModelType } from '../types/index.js';
import PdfProcessingService from '../services/pdf/PdfProcessingService.js';
import sharp from 'sharp';
import { ImageUtils } from '../utils/ImageUtils.js';
import { sendSseUpdate, closeSseConnection, createProgressData } from '../utils/sseUtils.js';
import { createAIMessage, createUserMessage, handleAIMessageIdForEndpoint, calculateMessageProcessingStats, calculateSessionStats } from '../utils/messageUtils.js';
import { logPerformanceSummary, logCommonSteps, getSuggestedFollowUps, extractQuestionsFromClassification, convertMarkingSchemeToPlainText, formatGroupedStudentWork, getQuestionSortValue, buildClassificationPageToSubQuestionMap, buildPageToQuestionNumbersMap, calculateOverallScore, calculatePerPageScores } from '../services/marking/MarkingHelpers.js';
import {
  generateSessionTitle,
  sendProgressUpdate,
  withPerformanceLogging,
  withErrorHandling
} from '../utils/markingRouterHelpers.js';
import { SessionManagementService } from '../services/sessionManagementService.js';
import type { MarkingSessionContext, QuestionSessionContext } from '../types/sessionManagement.js';
import { getBaseQuestionNumber, extractQuestionNumberFromFilename } from '../utils/TextNormalizationUtils.js';
import { formatMarkingSchemeAsBullets } from '../config/prompts.js';

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
import { executeMarkingForQuestion, QuestionResult, EnrichedAnnotation, createMarkingTasksFromClassification } from '../services/marking/MarkingExecutor.js';
import { questionDetectionService } from '../services/marking/questionDetectionService.js';
import { ImageStorageService } from '../services/imageStorageService.js';
import { GradeBoundaryService } from '../services/marking/GradeBoundaryService.js';
import { MarkingSchemeOrchestrationService } from '../services/marking/MarkingSchemeOrchestrationService.js';
import { QuestionModeHandlerService } from '../services/marking/QuestionModeHandlerService.js';
// import { getMarkingScheme } from '../services/marking/questionDetectionService.js';

// Placeholder function removed - schemes are now fetched in Question Detection stage

// Types are now imported from '../types/markingRouter.js'


// --- Helper Functions for Multi-Question Detection ---




// --- Configure Multer ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit per file
    files: 50 // Maximum 50 files
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
        const green = '\x1b[32m';
        const bold = '\x1b[1m';
        const reset = '\x1b[0m';
        const duration = stepTimings[stepKey].duration;
        const durationSec = (duration / 1000).toFixed(1);
        const stepNameUpper = stepName.toUpperCase();
        const modelInfoUpper = modelInfo.toUpperCase();
        console.log(`${bold}${green}✅ [${stepNameUpper}]${reset} ${bold}COMPLETED${reset} in ${bold}${durationSec}s${reset} (${green}${bold}${modelInfoUpper}${reset})`);
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

    // Extract and resolve model from request
    const requestedModel = req.body.model || 'auto';
    if (requestedModel === 'auto') {
      const { getDefaultModel } = await import('../config/aiModels.js');
      actualModel = getDefaultModel();
    } else {
      actualModel = requestedModel;
    }

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
        const originalFileName = files[0].originalname || 'document.pdf';
        stepTimings['pdf_conversion'] = { start: Date.now() };
        standardizedPages = await PdfProcessingService.convertPdfToImages(pdfBuffer);
        // TEMP: Limit to first 10 pages to stabilize processing
        const MAX_PAGES_LIMIT = 10;
        if (standardizedPages.length > MAX_PAGES_LIMIT) {
          standardizedPages = standardizedPages.slice(0, MAX_PAGES_LIMIT);
        }
        // Set originalFileName for all pages (like we do for multiple PDFs)
        standardizedPages.forEach((page) => {
          page.originalFileName = originalFileName;
        });
        if (stepTimings['pdf_conversion']) {
          stepTimings['pdf_conversion'].duration = Date.now() - stepTimings['pdf_conversion'].start;
        }
        if (standardizedPages.length === 0) throw new Error('PDF conversion yielded no pages.');
        sendSseUpdate(res, createProgressData(1, `Converted PDF to ${standardizedPages.length} pages.`, MULTI_IMAGE_STEPS));
      } else if (isMultiplePdfs) {
        // Multiple PDFs processing - PARALLEL CONVERSION
        sendSseUpdate(res, createProgressData(1, `Converting ${files.length} PDFs in parallel...`, MULTI_IMAGE_STEPS));
        stepTimings['pdf_conversion'] = { start: Date.now() };

        // Convert all PDFs in parallel
        const pdfConversionPromises = files.map(async (file, index) => {
          try {
            const pdfPages = await PdfProcessingService.convertPdfToImages(file.buffer);
            if (pdfPages.length === 0) {
              console.warn(`PDF ${index + 1} (${file.originalname}) yielded no pages.`);
              return { index, pdfPages: [] };
            }

            // TEMP: Limit to first 10 pages per PDF
            const MAX_PAGES_LIMIT = 10;
            const limitedPages = pdfPages.slice(0, MAX_PAGES_LIMIT);

            // Store original index for sequential page numbering
            limitedPages.forEach((page, pageIndex) => {
              page.originalFileName = file.originalname || `pdf-${index + 1}.pdf`;
              (page as any)._sourceIndex = index; // Track source PDF for ordering
            });

            return { index, pdfPages: limitedPages };
          } catch (error) {
            console.error(`❌ Failed to convert PDF ${index + 1} (${file.originalname}):`, error);
            return { index, pdfPages: [] };
          }
        });

        const results = await Promise.all(pdfConversionPromises);

        // Combine results and maintain sequential page indices
        const allPdfPages: StandardizedPage[] = [];
        results.forEach((result: any) => {
          if (result && result.pdfPages && result.pdfPages.length > 0) {
            result.pdfPages.forEach((page: any) => {
              page.pageIndex = allPdfPages.length;
              allPdfPages.push(page);
            });
          }
        });

        if (stepTimings['pdf_conversion']) {
          stepTimings['pdf_conversion'].duration = Date.now() - stepTimings['pdf_conversion'].start;
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

      // Handle PDF upload and context setup
      if (isPdf && !isMultiplePdfs) {
        // Single PDF (single-page or multi-page) - set pdfContext
        const pageCount = standardizedPages.length;
        sendSseUpdate(res, createProgressData(2, pageCount === 1 ? 'Processing as single converted page...' : 'Processing multi-page PDF...', MULTI_IMAGE_STEPS));

        // Upload original PDF to storage for authenticated users
        let originalPdfLink = null;
        let originalPdfDataUrl = null;

        if (isAuthenticated) {
          const originalFileName = files[0].originalname || 'document.pdf';
          try {
            const { ImageStorageService } = await import('../services/imageStorageService.js');
            const sessionId = req.body.sessionId || submissionId;
            originalPdfLink = await ImageStorageService.uploadPdf(
              `data:application/pdf;base64,${files[0].buffer.toString('base64')}`,
              userId || 'anonymous',
              sessionId,
              originalFileName
            );
          } catch (error) {
            const pdfSizeMB = (files[0].size / (1024 * 1024)).toFixed(2);
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`❌ [PDF UPLOAD] Failed to upload original PDF (${originalFileName}):`);
            console.error(`  - PDF size: ${pdfSizeMB}MB`);
            console.error(`  - Error: ${errorMessage}`);
            if (error instanceof Error && error.stack) {
              console.error(`  - Stack: ${error.stack}`);
            }
            throw new Error(`Failed to upload original PDF (${originalFileName}): ${errorMessage}`);
          }
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
          fileSize: fileSizeBytes,
          fileSizeMB: fileSizeMB + ' MB'
        };
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
            const originalFileName = file.originalname || `document-${i + 1}.pdf`;
            try {
              const { ImageStorageService } = await import('../services/imageStorageService.js');
              const sessionId = req.body.sessionId || submissionId;
              originalPdfLink = await ImageStorageService.uploadPdf(
                `data:application/pdf;base64,${file.buffer.toString('base64')}`,
                userId || 'anonymous',
                sessionId,
                originalFileName
              );
            } catch (error) {
              const pdfSizeMB = (file.size / (1024 * 1024)).toFixed(2);
              const errorMessage = error instanceof Error ? error.message : String(error);
              console.error(`❌ [PDF UPLOAD] Failed to upload PDF ${i + 1} (${originalFileName}):`);
              console.error(`  - PDF size: ${pdfSizeMB}MB`);
              console.error(`  - Error: ${errorMessage}`);
              if (error instanceof Error && error.stack) {
                console.error(`  - Stack: ${error.stack}`);
              }
              throw new Error(`Failed to upload PDF ${i + 1} (${originalFileName}): ${errorMessage}`);
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
            fileSize: fileSizeBytes, // Store as bytes (number) to match simplified structure
            fileSizeMB: fileSizeMB + ' MB', // Keep for display if needed
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

    // --- Perform Classification on ALL Images (Question & Student Work) ---
    const logClassificationComplete = logStep('Classification', actualModel);


    // Classify ALL images at once for better cross-page context (solves continuation page question number detection)
    const allClassificationResults = await ClassificationService.classifyMultipleImages(
      standardizedPages.map((page, index) => ({
        imageData: page.imageData,
        fileName: page.originalFileName,
        pageIndex: index
      })),
      actualModel as ModelType,
      false
    );

    // Combine questions from all images
    // Merge questions with same questionNumber across pages (for multi-page questions like Q21)
    const questionsByNumber = new Map<string, Array<{ question: any; pageIndex: number }>>();
    const questionsWithoutNumber: Array<{ question: any; pageIndex: number }> = [];

    allClassificationResults.forEach(({ pageIndex, result }) => {
      if (result.questions && Array.isArray(result.questions)) {
        result.questions.forEach((question: any) => {
          const qNum = question.questionNumber;


          // Only merge if questionNumber exists and is not null/undefined
          if (qNum && qNum !== 'null' && qNum !== 'undefined') {
            const qNumStr = String(qNum);
            if (!questionsByNumber.has(qNumStr)) {
              questionsByNumber.set(qNumStr, []);
            }
            questionsByNumber.get(qNumStr)!.push({
              question,
              pageIndex
            });
          } else {
            // No question number - can't merge, keep as separate entry
            questionsWithoutNumber.push({
              question,
              pageIndex
            });
          }
        });
      }
    });


    // Merge questions with same questionNumber
    const allQuestions: any[] = [];

    // Process merged questions
    questionsByNumber.forEach((questionInstances, questionNumber) => {

      if (questionInstances.length === 1) {
        // Single page - no merge needed
        const { question, pageIndex } = questionInstances[0];
        allQuestions.push({
          ...question,
          sourceImage: standardizedPages[pageIndex].originalFileName,
          sourceImageIndex: pageIndex
        });
      } else {
        // Multiple pages with same questionNumber - merge them
        // Find page with question text (not null/empty)
        const pageWithText = questionInstances.find(({ question }) =>
          question.text && question.text !== 'null' && question.text.trim().length > 0
        ) || questionInstances[0];

        // Combine student work from all pages
        const combinedStudentWork = questionInstances
          .map(({ question }) => question.studentWork)
          .filter(sw => sw && sw !== 'null' && sw.trim().length > 0)
          .join('\n');

        // Merge sub-questions if present (group by part, combine student work)
        // Also track which pages each sub-question came from
        const mergedSubQuestions = new Map<string, any>();
        const subQuestionPageIndices = new Set<number>(); // Track pages that have sub-questions

        questionInstances.forEach(({ question, pageIndex }) => {
          if (question.subQuestions && Array.isArray(question.subQuestions)) {
            question.subQuestions.forEach((subQ: any) => {
              const part = subQ.part || '';
              // Track that this page has sub-questions
              subQuestionPageIndices.add(pageIndex);

              if (!mergedSubQuestions.has(part)) {
                mergedSubQuestions.set(part, {
                  part: subQ.part,
                  text: subQ.text && subQ.text !== 'null' ? subQ.text : null,
                  studentWork: null,
                  confidence: subQ.confidence || 0.9,
                  pageIndex: pageIndex // Track which page this sub-question came from
                });
              }
              // Combine student work for same sub-question part
              if (subQ.studentWork && subQ.studentWork !== 'null' && subQ.studentWork.trim().length > 0) {
                const existing = mergedSubQuestions.get(part)!;
                if (existing.studentWork) {
                  existing.studentWork += '\n' + subQ.studentWork;
                } else {
                  existing.studentWork = subQ.studentWork;
                }
              }
              // Use text from sub-question that has it
              if (subQ.text && subQ.text !== 'null' && !mergedSubQuestions.get(part)!.text) {
                mergedSubQuestions.get(part)!.text = subQ.text;
              }
            });
          }
        });

        // Collect all page indices for this merged question
        // Include both question instance pages AND pages that have sub-questions
        const questionInstancePageIndices = questionInstances.map(({ pageIndex }) => pageIndex);
        const allPageIndices = [...new Set([...questionInstancePageIndices, ...Array.from(subQuestionPageIndices)])].sort((a, b) => a - b);


        const merged = {
          ...pageWithText.question,
          questionNumber: questionNumber,
          // Use text from page that has it (not null/empty)
          text: pageWithText.question.text && pageWithText.question.text !== 'null'
            ? pageWithText.question.text
            : questionInstances[0].question.text,
          // Combine student work from all pages
          studentWork: combinedStudentWork || pageWithText.question.studentWork || null,
          // Use sourceImageIndex from page with text, or first page (for backward compatibility)
          sourceImage: standardizedPages[pageWithText.pageIndex].originalFileName,
          sourceImageIndex: pageWithText.pageIndex,
          // Store all page indices this question spans (for multi-page questions)
          sourceImageIndices: allPageIndices,
          // Merge sub-questions if present
          subQuestions: mergedSubQuestions.size > 0
            ? Array.from(mergedSubQuestions.values())
            : pageWithText.question.subQuestions || [],
          // Use highest confidence
          confidence: Math.max(...questionInstances.map(({ question }) => question.confidence || 0.9))
        };


        allQuestions.push(merged);
      }
    });

    // Add questions without question number (can't be merged)
    questionsWithoutNumber.forEach(({ question, pageIndex }) => {
      allQuestions.push({
        ...question,
        sourceImage: standardizedPages[pageIndex].originalFileName,
        sourceImageIndex: pageIndex
      });
    });

    // Create combined classification result with enhanced mixed content detection
    const hasAnyStudentWork = allClassificationResults.some(result => result.result?.category === "questionAnswer");
    const hasMixedContent = allClassificationResults.some(result => result.result?.category !== allClassificationResults[0]?.result?.category);

    // Determine combined category
    const allCategories = allClassificationResults.map(r => r.result?.category).filter(Boolean);
    const combinedCategory: "questionOnly" | "questionAnswer" | "metadata" =
      allCategories.every(cat => cat === "questionOnly") ? "questionOnly" :
        allCategories.every(cat => cat === "metadata") ? "metadata" :
          "questionAnswer";

    let classificationResult = {
      category: combinedCategory,
      reasoning: allClassificationResults[0]?.result?.reasoning || 'Multi-image classification',
      questions: allQuestions,
      extractedQuestionText: allQuestions.length > 0 ? allQuestions[0].text : allClassificationResults[0]?.result?.extractedQuestionText,
      apiUsed: allClassificationResults[0]?.result?.apiUsed || 'Unknown',
      usageTokens: allClassificationResults.reduce((sum, { result }) => sum + (result.usageTokens || 0), 0),
      hasMixedContent: hasMixedContent,
      hasAnyStudentWork: hasAnyStudentWork
    };

    // For question mode, use the questions array; for marking mode, use extractedQuestionText
    const globalQuestionText = classificationResult?.questions && classificationResult.questions.length > 0
      ? classificationResult.questions[0].text
      : classificationResult?.extractedQuestionText;


    logClassificationComplete();

    // ========================= AUTO-ROTATION =========================
    // Check for rotation detected by AI and correct the image
    // This ensures OCR and Annotation work on the upright image
    const rotationPromises = allClassificationResults.map(async ({ pageIndex, result }, index) => {
      const rotation = (result as any).rotation;
      if (rotation && typeof rotation === 'number' && rotation !== 0) {
        console.log(`🔄 [ROTATION] Page ${index + 1} (${standardizedPages[index].originalFileName}) detected rotation: ${rotation}°`);
        try {
          const rotatedBuffer = await ImageUtils.rotateImage(standardizedPages[index].imageData, rotation);
          standardizedPages[index].imageData = `data:image/png;base64,${rotatedBuffer.toString('base64')}`;

          // Swap dimensions if 90 or 270
          if (rotation === 90 || rotation === 270) {
            const temp = standardizedPages[index].width;
            standardizedPages[index].width = standardizedPages[index].height;
            standardizedPages[index].height = temp;
          }
          console.log(`✅ [ROTATION] Page ${index + 1} rotated successfully.`);
        } catch (rotError) {
          console.error(`❌ [ROTATION] Failed to rotate page ${index + 1}:`, rotError);
        }
      }
    });
    await Promise.all(rotationPromises);

    // ========================= MARK METADATA PAGES =========================
    // Mark front pages (metadata pages) that should skip OCR, question detection, and marking
    // but still appear in final output
    allClassificationResults.forEach(({ pageIndex, result }, index) => {
      // Metadata page: explicitly marked as metadata by AI classification
      const isMetadataPage = result.category === "metadata";

      if (isMetadataPage) {
        // Mark the page as metadata page
        (standardizedPages[index] as any).isMetadataPage = true;
        console.log(`📄 [METADATA] Page ${index + 1} (${standardizedPages[index].originalFileName}) marked as metadata page - will skip OCR/processing`);
      }
    });

    // ========================= ENHANCED MODE DETECTION =========================
    // Smart mode detection based on content analysis
    const isQuestionMode = classificationResult?.category === "questionOnly";
    const isMixedContent = classificationResult?.hasMixedContent === true;

    console.log(`🔍 [MODE DETECTION] Analysis:`);
    console.log(`  - All question-only: ${isQuestionMode}`);
    console.log(`  - Has mixed content: ${isMixedContent}`);
    console.log(`  - Has any student work: ${classificationResult?.hasAnyStudentWork}`);
    console.log(`  - Selected mode: ${isQuestionMode ? 'Question Mode' : 'Marking Mode'}`);

    if (isQuestionMode) {
      // ========================= ENHANCED QUESTION MODE =========================
      // Question mode: Handle multiple question-only images with detailed responses
      await QuestionModeHandlerService.handleQuestionMode({
        classificationResult,
        standardizedPages,
        files,
        actualModel,
        userId,
        submissionId,
        req,
        res,
        startTime,
        logStep
      });
      return;
    }

    // ========================= ENHANCED MARKING MODE =========================
    // Marking mode: Handle mixed content with both marking and question analysis

    if (isMixedContent) {
      console.log(`🔄 [MIXED CONTENT] Processing ${standardizedPages.length} images with mixed content`);
      console.log(`  - Student work images: ${standardizedPages.filter((_, i) => allClassificationResults[i]?.result?.category === "questionAnswer").length}`);
      console.log(`  - Question-only images: ${standardizedPages.filter((_, i) => allClassificationResults[i]?.result?.category === "questionOnly").length}`);
    }

    // --- Run OCR on each page in parallel (Marking Mode) ---
    const logOcrComplete = logStep('OCR Processing', 'mathpix');


    const pageProcessingPromises = standardizedPages.map(async (page, index): Promise<PageOcrResult> => {
      // Skip OCR for metadata pages (front pages with no questions/answers)
      if ((page as any).isMetadataPage) {
        console.log(`⏭️ [METADATA] Skipping OCR for metadata page: ${page.originalFileName}`);
        return {
          pageIndex: page.pageIndex,
          ocrData: {
            text: '',
            mathBlocks: [],
            rawResponse: { rawLineData: [] }
          },
          classificationText: globalQuestionText
        };
      }

      // Skip OCR for question-only images in mixed content scenarios
      // Check if this specific page was classified as question-only
      const pageClassification = allClassificationResults[index]?.result;
      const isQuestionOnly = pageClassification?.category === "questionOnly";

      if (isMixedContent && isQuestionOnly) {
        console.log(`⏭️ [MIXED CONTENT] Skipping OCR for question-only image: ${page.originalFileName}`);
        return {
          pageIndex: page.pageIndex,
          ocrData: {
            text: '',
            mathBlocks: [],
            rawResponse: { rawLineData: [] }
          },
          classificationText: globalQuestionText
        };
      }

      const ocrResult = await OCRService.processImage(
        page.imageData, {}, false, 'auto',
        { extractedQuestionText: globalQuestionText }
      );
      return {
        pageIndex: page.pageIndex,
        ocrData: ocrResult,
        classificationText: globalQuestionText
      };
    });

    allPagesOcrData = await Promise.all(pageProcessingPromises);
    logOcrComplete();
    sendSseUpdate(res, createProgressData(3, 'OCR & Classification complete.', MULTI_IMAGE_STEPS));
    // ========================== END: IMPLEMENT STAGE 2 ==========================

    // ========================= START: ADD QUESTION DETECTION STAGE =========================
    sendSseUpdate(res, createProgressData(4, 'Detecting questions and fetching schemes...', MULTI_IMAGE_STEPS));

    // Extract questions from AI classification result
    const individualQuestions = extractQuestionsFromClassification(classificationResult, standardizedPages[0]?.originalFileName);

    // Call question detection for each individual question
    const logQuestionDetectionComplete = logStep('Question Detection', 'question-detection');

    // Orchestrate marking scheme lookup (detection, grouping, merging)
    const orchestrationResult = await MarkingSchemeOrchestrationService.orchestrateMarkingSchemeLookup(
      individualQuestions,
      classificationResult
    );

    const markingSchemesMap = orchestrationResult.markingSchemesMap;
    const detectionStats = orchestrationResult.detectionStats;
    classificationResult = orchestrationResult.updatedClassificationResult;

    logQuestionDetectionComplete();

    // Log detection statistics
    MarkingSchemeOrchestrationService.logDetectionStatistics(detectionStats);

    sendSseUpdate(res, createProgressData(4, `Detected ${markingSchemesMap.size} question scheme(s).`, MULTI_IMAGE_STEPS));
    // ========================== END: ADD QUESTION DETECTION STAGE ==========================

    // =========================PASS IMAGES TO DRAWING QUESTIONS (SIMPLIFIED) =========================
    // For questions with hasStudentDrawing=true, flag them to receive images for marking
    // No need for Drawing Classification AI - just pass the image directly
    allClassificationResults.forEach(({ pageIndex, result }) => {
      if (result.category === 'questionAnswer' && result.questions) {
        result.questions.forEach((q) => {
          // If Classification detected a drawing question (via heuristic or visual)
          const hasDrawingsInQuestion = q.hasStudentDrawing === true ||
            (q.subQuestions && q.subQuestions.some(sq => sq.hasStudentDrawing === true));

          if (hasDrawingsInQuestion && standardizedPages[pageIndex]) {
            // Flag this question to receive the image for marking
            (q as any).requiresImageForMarking = true;
            (q as any).imageDataForMarking = standardizedPages[pageIndex].imageData;
            console.log(`[DRAWING] Q${q.questionNumber || '?'}: Will pass image to Marking AI`);
          }
        });
      }
    });
    console.log('[PIPELINE DEBUG] ✅ Drawing image passing configured, proceeding to create marking tasks...');

    // ========================= START: IMPLEMENT STAGE 3 =========================
    // --- Stage 3: Create Marking Tasks Directly from Classification (Bypass Segmentation) ---
    sendSseUpdate(res, createProgressData(5, 'Preparing marking tasks...', MULTI_IMAGE_STEPS));
    console.log('[PIPELINE DEBUG] Starting createMarkingTasksFromClassification...');
    const logSegmentationComplete = logStep('Segmentation', 'segmentation');

    // Create page dimensions map from standardizedPages for accurate drawing position calculation
    const pageDimensionsMap = new Map<number, { width: number; height: number }>();
    standardizedPages.forEach((page, index) => {
      if (page.width && page.height) {
        pageDimensionsMap.set(index, { width: page.width, height: page.height });
      }
    });

    // Create marking tasks directly from classification results (bypass segmentation)
    try {
      markingTasks = createMarkingTasksFromClassification(
        classificationResult,
        allPagesOcrData,
        markingSchemesMap,
        pageDimensionsMap
      );
      console.log(`[PIPELINE DEBUG] ✅ createMarkingTasksFromClassification completed, created ${markingTasks.length} marking task(s)`);
    } catch (error) {
      console.error('[PIPELINE DEBUG] ❌ createMarkingTasksFromClassification failed:', error);
      throw error;
    }

    // Handle case where no student work is found
    if (markingTasks.length === 0) {
      console.log('[PIPELINE DEBUG] No marking tasks created, exiting early');
      sendSseUpdate(res, createProgressData(5, 'No student work found to mark.', MULTI_IMAGE_STEPS));
      const finalOutput = {
        submissionId,
        annotatedOutput: standardizedPages.map(p => p.imageData), // Return originals if no work
        outputFormat: isPdf ? 'pdf' : 'images'
      };
      sendSseUpdate(res, { type: 'complete', result: finalOutput }, true);
      res.end();
      return; // Exit early
    }
    sendSseUpdate(res, createProgressData(5, `Prepared ${markingTasks.length} marking task(s).`, MULTI_IMAGE_STEPS));
    logSegmentationComplete();
    // ========================== END: IMPLEMENT STAGE 3 ==========================

    // ========================= START: VALIDATE SCHEMES =========================
    // --- Stage 3.5: Validate that schemes were attached during segmentation ---
    // Allow tasks without marking schemes - they'll use basic prompt (for non-past papers or failed detection)
    const tasksWithoutScheme: string[] = [];
    const tasksWithSchemes: MarkingTask[] = markingTasks.filter(task => {
      if (!task.markingScheme) {
        tasksWithoutScheme.push(String(task.questionNumber || '?'));
        console.warn(`[SEGMENTATION] ⚠️ Task for Q${task.questionNumber} has no marking scheme, will use basic prompt`);
        // Don't skip - allow task to proceed with null markingScheme (basic prompt will be used)
        return true;
      }
      return true;
    });

    if (tasksWithSchemes.length === 0 && markingTasks.length > 0) {
      throw new Error("Failed to assign marking schemes to any detected question work.");
    }
    // ========================== END: VALIDATE SCHEMES ==========================

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
          executeMarkingForQuestion(task, res, submissionId, actualModel) // Pass res, submissionId, and actualModel
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
    const { overallScore, totalPossibleScore, overallScoreText } = calculateOverallScore(allQuestionResults);
    const pageScores = calculatePerPageScores(allQuestionResults, classificationResult);

    // --- Determine First Page After Sorting (for total score placement) ---
    // Helper function to extract page number from filename (same as used in sorting)
    const extractPageNumber = (filename: string | undefined): number | null => {
      if (!filename) return null;
      const patterns = [
        /page[-_\s]?(\d+)/i,
        /p[-_\s]?(\d+)/i,
        /(\d+)(?:\.(jpg|jpeg|png|pdf))?$/i
      ];
      for (const pattern of patterns) {
        const match = filename.match(pattern);
        if (match && match[1]) {
          const pageNum = parseInt(match[1], 10);
          if (!isNaN(pageNum) && pageNum > 0) {
            return pageNum;
          }
        }
      }
      return null;
    };

    // Create array to determine which page will be first after sorting
    const pagesForSorting = standardizedPages.map((page, index) => ({
      page,
      pageIndex: page.pageIndex,
      pageNumber: extractPageNumber(page.originalFileName),
      isMetadataPage: (page as any).isMetadataPage || false,
      originalIndex: index
    }));

    // Sort to find first page (same logic as final sorting)
    pagesForSorting.sort((a, b) => {
      if (a.isMetadataPage && !b.isMetadataPage) return -1;
      if (!a.isMetadataPage && b.isMetadataPage) return 1;
      if (a.pageNumber !== null && b.pageNumber !== null) {
        return a.pageNumber - b.pageNumber;
      }
      if (a.pageNumber !== null && b.pageNumber === null) return -1;
      if (a.pageNumber === null && b.pageNumber !== null) return 1;
      return a.originalIndex - b.originalIndex;
    });

    // Get the pageIndex of the first page after sorting
    const firstPageIndexAfterSorting = pagesForSorting[0]?.pageIndex ?? 0;

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

      // Add total score with double underline on first page AFTER reordering
      const totalScoreToDraw = (pageIndex === firstPageIndexAfterSorting) ? overallScoreText : undefined;

      // Only call service if there's something to draw
      if (annotationsForThisPage.length > 0 || scoreToDraw || totalScoreToDraw) {
        try {
          return await SVGOverlayService.burnSVGOverlayServerSide(
            page.imageData,
            annotationsForThisPage,
            imageDimensions,
            scoreToDraw,
            totalScoreToDraw
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
        // FIXED: Pass original filename for proper annotated filename generation
        const originalFileName = files[index]?.originalname || `image-${index + 1}.png`;
        try {
          const imageLink = await ImageStorageService.uploadImage(
            imageData,
            userId,
            `multi-${submissionId}`,
            'annotated',
            originalFileName
          );
          return imageLink;
        } catch (uploadError) {
          const imageSizeMB = (imageData.length / (1024 * 1024)).toFixed(2);
          const errorMessage = uploadError instanceof Error ? uploadError.message : String(uploadError);
          console.error(`❌ [ANNOTATION] Failed to upload annotated image ${index} (${originalFileName}):`);
          console.error(`  - Image size: ${imageSizeMB}MB`);
          console.error(`  - Error: ${errorMessage}`);
          if (uploadError instanceof Error && uploadError.stack) {
            console.error(`  - Stack: ${uploadError.stack}`);
          }
          throw new Error(`Failed to upload annotated image ${index} (${originalFileName}): ${errorMessage}`);
        }
      });
      annotatedImageLinks = await Promise.all(uploadPromises);
    }

    // --- Sort Final Annotated Output ---
    // Reuse extractPageNumber function defined earlier (line 2159)
    // Check if this is a past paper (has marking schemes)
    const isPastPaper = markingSchemesMap && markingSchemesMap.size > 0;

    // Build mapping from classification result: page -> sub-question number
    const classificationPageToSubQuestion = isPastPaper
      ? buildClassificationPageToSubQuestionMap(classificationResult)
      : new Map<number, Map<string, string>>();

    // Create mapping from pageIndex to question numbers (for past paper sorting)
    const pageToQuestionNumbers = isPastPaper
      ? buildPageToQuestionNumbersMap(allQuestionResults, markingSchemesMap, classificationPageToSubQuestion)
      : new Map<number, number[]>();

    // Create array with page info and annotated output for sorting
    const pagesWithOutput = standardizedPages.map((page, index) => ({
      page,
      annotatedOutput: isAuthenticated ? annotatedImageLinks[index] : annotatedImagesBase64[index],
      pageNumber: extractPageNumber(page.originalFileName),
      isMetadataPage: (page as any).isMetadataPage || false,
      originalIndex: index,
      pageIndex: page.pageIndex,
      // For past paper: get lowest question number on this page
      lowestQuestionNumber: isPastPaper
        ? (pageToQuestionNumbers.get(page.pageIndex) || []).sort((a, b) => a - b)[0] || Infinity
        : Infinity
    }));

    // Sort: metadata pages first, then by page number (if available), then by question number
    // Debug logging for sorting (Removed as requested)

    // Sort: metadata pages first, then by question number, then by upload sequence
    pagesWithOutput.sort((a, b) => {
      // 1. Metadata pages come first
      if (a.isMetadataPage && !b.isMetadataPage) return -1;
      if (!a.isMetadataPage && b.isMetadataPage) return 1;

      // 2. If both pages have detected questions, sort by Question Number
      // This handles jumbled scans where the user wants question order
      if (isPastPaper && a.lowestQuestionNumber !== Infinity && b.lowestQuestionNumber !== Infinity) {
        return a.lowestQuestionNumber - b.lowestQuestionNumber;
      }

      // 3. Fallback: If one or both pages have NO detected questions, use Upload Sequence
      // This ensures that pages with missed detection (e.g. Page 13) stay in their physical position
      // instead of being pushed to the end.
      return a.originalIndex - b.originalIndex;
    });

    // Extract sorted annotated output
    const finalAnnotatedOutput: string[] = pagesWithOutput.map(item => item.annotatedOutput);

    // --- Construct Final Output (Always Images) ---
    const outputFormat: 'images' = 'images'; // Explicitly set to images
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

      // Create structured data (only for authenticated users - unauthenticated users don't need database persistence)
      let structuredImageDataArray: any[] | undefined = undefined;
      let structuredPdfContexts: any[] | undefined = undefined;

      if (isAuthenticated) {
        const structuredData = SessionManagementService.createStructuredData(
          files,
          isPdf,
          isMultiplePdfs,
          pdfContext,
          isAuthenticated // Pass authentication status for diagnostic logging
        );
        structuredImageDataArray = structuredData.structuredImageDataArray;
        structuredPdfContexts = structuredData.structuredPdfContexts;

        // Update pdfContext with structured data for frontend
        if (pdfContext && structuredPdfContexts) {
          pdfContext.pdfContexts = structuredPdfContexts;
        }
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

      // ========================= MIXED CONTENT: QUESTION ANALYSIS =========================
      let questionOnlyResponses: string[] = [];

      if (isMixedContent) {
        console.log(`🔍 [MIXED CONTENT] Generating AI responses for question-only images...`);

        // Find question-only images and generate AI responses for them
        const questionOnlyImages = standardizedPages.filter((page, index) =>
          allClassificationResults[index]?.result?.category === "questionOnly"
        );

        if (questionOnlyImages.length > 0) {
          const { MarkingServiceLocator } = await import('../services/marking/MarkingServiceLocator.js');

          questionOnlyResponses = await Promise.all(
            questionOnlyImages.map(async (page, index) => {
              const originalIndex = standardizedPages.indexOf(page);
              const questionText = allClassificationResults[originalIndex]?.result?.extractedQuestionText ||
                classificationResult.questions[originalIndex]?.text || '';

              const response = await MarkingServiceLocator.generateChatResponse(
                page.imageData,
                questionText,
                actualModel as ModelType,
                "questionOnly", // category
                false // debug
              );

              return `## Question Analysis (${page.originalFileName})\n\n${response.response}`;
            })
          );

          console.log(`✅ [MIXED CONTENT] Generated ${questionOnlyResponses.length} question-only responses`);
        }
      }

      // Create AI message for database
      const resolvedAIMessageId = handleAIMessageIdForEndpoint(req.body, null, 'marking');

      // Reuse overallScore and totalPossibleScore calculated earlier (line 2042-2057)
      // overallScoreText is already calculated as `${overallScore}/${totalPossibleScore}`

      // Calculate grade based on grade boundaries (if exam data is available)
      // Get detectedQuestion from markingSchemesMap (it contains detection results)
      let detectedQuestionForGrade: any = undefined;
      if (markingSchemesMap && markingSchemesMap.size > 0) {
        const firstSchemeEntry = Array.from(markingSchemesMap.values())[0];
        detectedQuestionForGrade = firstSchemeEntry?.questionDetection || undefined;
      }

      const gradeResult = await GradeBoundaryService.calculateGradeWithOrchestration(
        overallScore,
        totalPossibleScore,
        detectedQuestionForGrade,
        markingSchemesMap
      );
      const calculatedGrade = gradeResult.grade;
      const gradeBoundaryType = gradeResult.boundaryType;
      const gradeBoundaries = gradeResult.boundaries;

      dbAiMessage = SessionManagementService.createAIMessageForDatabase({
        allQuestionResults,
        finalAnnotatedOutput,
        files,
        actualModel,
        startTime,
        markingSchemesMap,
        globalQuestionText,
        resolvedAIMessageId,
        questionOnlyResponses: isMixedContent ? questionOnlyResponses : undefined,
        studentScore: {
          totalMarks: totalPossibleScore,
          awardedMarks: overallScore,
          scoreText: overallScoreText
        },
        grade: calculatedGrade,
        gradeBoundaryType: gradeBoundaryType,
        gradeBoundaries: gradeBoundaries
      });

      // Log grade storage confirmation
      if (calculatedGrade) {

      }

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
      stepTimings['database_persistence'] = { start: Date.now() };
      persistenceResult = await SessionManagementService.persistMarkingSession(markingContext);
      if (stepTimings['database_persistence']) {
        stepTimings['database_persistence'].duration = Date.now() - stepTimings['database_persistence'].start;
      }

      // For authenticated users, use the unifiedSession from persistence
      if (isAuthenticated) {
        unifiedSession = persistenceResult.unifiedSession;

        // Persist marking result to subjectMarkingResults in background (don't wait)
        if (unifiedSession && dbAiMessage) {
          // Find the marking message with studentScore
          const markingMessage = unifiedSession.messages?.find(
            (msg: any) => msg.role === 'assistant' && msg.studentScore
          );

          if (markingMessage) {
            // Persist in background (don't await - user doesn't need to wait)
            import('../services/subjectMarkingResultService.js').then(({ persistMarkingResultToSubject }) => {
              persistMarkingResultToSubject(unifiedSession, markingMessage).catch(err => {
                console.error('❌ [SUBJECT MARKING RESULT] Background persistence failed:', err);
              });
            }).catch(err => {
              console.error('❌ [SUBJECT MARKING RESULT] Failed to import service:', err);
            });
          }
        }
      }

    } catch (error) {
      console.error(`❌ [SUBMISSION ${submissionId}] Failed to persist to database:`, error);
      if (error instanceof Error) {
        console.error(`❌ [SUBMISSION ${submissionId}] Error name: ${error.name}`);
        console.error(`❌ [SUBMISSION ${submissionId}] Error message: ${error.message}`);
        console.error(`❌ [SUBMISSION ${submissionId}] Error stack:`, error.stack);
      }
      // Re-throw the real error instead of hiding it
      throw error;
    }

    // For unauthenticated users, create unifiedSession even if database persistence failed
    if (!isAuthenticated && !unifiedSession) {
      // Validate required data before creating session
      if (!dbUserMessage || !dbAiMessage) {
        throw new Error(`Cannot create unauthenticated session: missing required data. dbUserMessage: ${!!dbUserMessage}, dbAiMessage: ${!!dbAiMessage}`);
      }
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
        totalMarks: totalPossibleScore, // Use the grouped total marks calculation
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
      // Handle multer file size errors
      if (error.message.includes('File too large') || error.message.includes('LIMIT_FILE_SIZE')) {
        userFriendlyMessage = 'File too large. Maximum file size is 50MB per file. Please compress your images or use smaller files.';
      } else if (error.message.includes('too large') || error.message.includes('max:')) {
        // Handle ImageStorageService file size errors (includes file size in message)
        userFriendlyMessage = error.message.includes('max:')
          ? error.message // Use the detailed message that includes size info
          : 'File too large. Maximum file size is 50MB per file. Please compress your images or use smaller files.';
      } else if (error.message.includes('quota exceeded') || error.message.includes('429')) {
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

    // Determine content type from URL or response headers
    let contentType = response.headers.get('content-type');
    const filenameStr = Array.isArray(filename) ? filename[0] : filename;

    if (!contentType) {
      // Fallback: determine content type from URL or filename
      const urlLower = typeof url === 'string' ? url.toLowerCase() : '';
      const filenameLower = (typeof filenameStr === 'string' ? filenameStr : '').toLowerCase();

      if (urlLower.includes('.png') || filenameLower.includes('.png')) {
        contentType = 'image/png';
      } else if (urlLower.includes('.webp') || filenameLower.includes('.webp')) {
        contentType = 'image/webp';
      } else if (urlLower.includes('.gif') || filenameLower.includes('.gif')) {
        contentType = 'image/gif';
      } else if (urlLower.includes('.jpg') || urlLower.includes('.jpeg') ||
        filenameLower.includes('.jpg') || filenameLower.includes('.jpeg')) {
        contentType = 'image/jpeg';
      } else {
        contentType = 'image/jpeg'; // Default fallback
      }
    }

    // Set headers for download
    const downloadFilename = filenameStr && typeof filenameStr === 'string' ? filenameStr : 'image';
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

