/**
 * Unified Marking Router
 * Handles single images, multiple images, and PDFs through a single endpoint
 */

import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as stringSimilarity from 'string-similarity';
import { optionalAuth } from '../middleware/auth.js';
import { runOriginalSingleImagePipeline } from './originalPipeline.js';
import PdfProcessingService from '../services/pdf/PdfProcessingService.js';
import sharp from 'sharp';
import { ImageUtils } from '../utils/ImageUtils.js';
import { sendSseUpdate, closeSseConnection, createProgressData } from '../utils/sseUtils.js';
import { createAIMessage, createUserMessage, handleAIMessageIdForEndpoint } from '../utils/messageUtils.js';
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


// --- Helper: Find Boundary using Fuzzy Match (with added logging) ---
const findBoundaryByFuzzyMatch = (
  ocrLines: Array<any>, // Expect objects with globalIndex, pageIndex, text/latex_styled
  questionText: string | undefined
): number => {
  console.log('🔧 [SEGMENTATION - BOUNDARY] Attempting fuzzy match boundary detection across all lines.');
  
  if (!questionText || questionText.trim().length === 0) {
    console.log('  -> No question text provided, processing all lines');
    return 0;
  }
  
  const questionLines = questionText.split('\n').map(l => l.trim()).filter(Boolean);
  if (questionLines.length === 0) {
    console.log('  -> No valid question lines after processing, processing all lines');
    return 0;
  }

  const SIMILARITY_THRESHOLD = 0.80;
  let lastMatchIndex = -1;
  console.log(`[DEBUG] Comparing ${ocrLines.length} OCR lines against ${questionLines.length} question lines.`);

  for (let i = 0; i < ocrLines.length; i++) {
    const ocrLineText = ocrLines[i]?.latex_styled || ocrLines[i]?.text || '';
    const trimmedOcrText = ocrLineText.trim();
    if (!trimmedOcrText) continue;

    const bestMatch = stringSimilarity.findBestMatch(trimmedOcrText, questionLines);
    // --- DEBUG LOG ---
    console.log(`[DEBUG] Fuzzy Match: OCR Line ${i} (Page ${ocrLines[i]?.pageIndex}) "${trimmedOcrText.substring(0, 40)}..." -> Best Q Match: "${bestMatch.bestMatch.target.substring(0, 40)}..." (Rating: ${bestMatch.bestMatch.rating.toFixed(2)})`);
    // ---------------

    if (bestMatch.bestMatch.rating >= SIMILARITY_THRESHOLD) {
      console.log(`  -> [DEBUG] STRONG MATCH FOUND at index ${i}`);
      lastMatchIndex = i; // Keep track of the *last* strong match
    }
  } // End loop

  let boundaryIndex = 0;
  if (lastMatchIndex !== -1) {
    boundaryIndex = lastMatchIndex + 1;
    console.log(`  -> Boundary set at global index ${boundaryIndex} (after last strong fuzzy match).`);
  } else {
    console.warn('  -> Fuzzy match failed. Attempting keyword fallback.');
    const instructionKeywords = ['work out', 'calculate', 'explain', 'show that', 'find the', 'write down'];
    let lastInstructionIndex = -1;
    for (let i = ocrLines.length - 1; i >= 0; i--) {
      const text = (ocrLines[i]?.latex_styled || ocrLines[i]?.text || '').toLowerCase();
      const containsKeyword = instructionKeywords.some(kw => text.includes(kw));
      const hasEquals = text.includes('=');
      const wordCount = text.split(/\s+/).length;
      // --- DEBUG LOG ---
      console.log(`[DEBUG] Keyword Check: Line ${i} "${text.substring(0, 40)}..." | HasKeyword: ${containsKeyword} | HasEquals: ${hasEquals} | WordCount: ${wordCount}`);
      // ---------------
      if (wordCount > 2 && containsKeyword && !hasEquals) {
        lastInstructionIndex = i;
        console.log(`  -> Keyword Fallback: Found potential last instruction at global index ${i}`);
        break;
      }
    }
    if (lastInstructionIndex !== -1) {
      boundaryIndex = lastInstructionIndex + 1;
      console.log(`  -> Keyword Fallback: Boundary set at global index ${boundaryIndex}.`);
    } else {
       console.warn('  -> Keyword fallback also failed. Treating all as student work.');
       boundaryIndex = 0;
    }
  }
  boundaryIndex = Math.min(boundaryIndex, ocrLines.length);
  console.log(`✅ [SEGMENTATION - BOUNDARY] Final boundary index determined globally: ${boundaryIndex}`);
  return boundaryIndex;
};

// --- Refined Segmentation Logic (with added logging) ---
const segmentOcrResultsByQuestion = (
  allPagesOcrData: PageOcrResult[],
  globalQuestionText?: string,
  // Pass the map from the Question Detection stage
  detectedSchemesMap?: Map<string, any>
): MarkingTask[] => {
  console.log('🔧 [SEGMENTATION] Consolidating and segmenting OCR results...');
  // --- DEBUG LOG ---
  console.log(`[DEBUG] Received ${allPagesOcrData.length} page results.`);
  // ---------------

  if (allPagesOcrData.length === 0) {
    console.log(`[SEGMENTATION] No OCR data available`);
    return [];
  }

  // 1. Consolidate ALL raw lines and processed math blocks
  let allRawLinesForBoundary: Array<any & { pageIndex: number; globalIndex: number }> = [];
  let allMathBlocksForContent: Array<MathBlock & { pageIndex: number; globalBlockId: string }> = [];
  let lineCounter = 0;
  let blockCounter = 0;

  allPagesOcrData.forEach((pageResult, pageIdx) => {
    const rawLines = pageResult.ocrData?.rawResponse?.rawLineData || [];
    // --- DEBUG LOG ---
    console.log(`[DEBUG] Page ${pageIdx}: Found ${rawLines.length} raw lines, ${pageResult.ocrData?.mathBlocks?.length || 0} processed blocks.`);
    // ---------------
    rawLines.forEach((line) => {
      const globalIndex = lineCounter++;
      allRawLinesForBoundary.push({ ...line, pageIndex: pageResult.pageIndex, globalIndex });
      // --- DEBUG LOG ---
      // console.log(`[DEBUG] Raw Line ${globalIndex} (Page ${pageResult.pageIndex}): "${(line.latex_styled || line.text || '').substring(0,50)}..."`);
      // ---------------
    });
    
    const mathBlocks = pageResult.ocrData?.mathBlocks || [];
    mathBlocks.forEach((block) => {
       const globalBlockId = `block_${blockCounter++}`;
       allMathBlocksForContent.push({ ...block, pageIndex: pageResult.pageIndex, globalBlockId });
       // --- DEBUG LOG ---
       // console.log(`[DEBUG] Processed Block ${globalBlockId} (Page ${pageResult.pageIndex}, Coords: ${JSON.stringify(block.coordinates)}): "${(block.mathpixLatex || block.googleVisionText || '').substring(0,50)}..."`);
       // ---------------
    });
  });
  console.log(`  -> Consolidated ${allRawLinesForBoundary.length} raw lines and ${allMathBlocksForContent.length} processed math blocks.`);

  if (allRawLinesForBoundary.length === 0) {
    console.log(`[SEGMENTATION] No raw lines available for segmentation`);
    return [];
  }

  // --- 2. Determine Boundary ---
  const boundaryGlobalIndex = findBoundaryByFuzzyMatch(allRawLinesForBoundary, globalQuestionText);

  // --- 3. Filter Math Blocks based on Boundary ---
  let startYThreshold = -Infinity; // Default to include everything from page 0
  let startPageThreshold = 0;      // Default to include page 0

  if (boundaryGlobalIndex > 0 && boundaryGlobalIndex < allRawLinesForBoundary.length) {
    const boundaryLine = allRawLinesForBoundary[boundaryGlobalIndex];
    // ========================= START OF FIX =========================
    // Use the SAME extractBoundingBox helper used elsewhere
    const boundaryCoords = OCRService.extractBoundingBox(boundaryLine);
    // ========================== END OF FIX ==========================

    if (boundaryCoords) {
      startYThreshold = boundaryCoords.y;
      startPageThreshold = boundaryLine.pageIndex;
      console.log(`  -> Boundary corresponds to Page ${startPageThreshold}, starting at Y-coordinate ~ ${startYThreshold}`);
    } else {
       console.warn(`  -> Could not extract coordinates for boundary line index ${boundaryGlobalIndex}. Applying boundary page threshold only.`);
       // Fallback: If coords fail, still use the page index but include everything on that page
       startPageThreshold = boundaryLine.pageIndex;
       startYThreshold = -Infinity; // Include all Y coords on the boundary page onwards
    }
  } else if (boundaryGlobalIndex === allRawLinesForBoundary.length && allRawLinesForBoundary.length > 0) {
     console.warn(`  -> Boundary detected after all lines. No student work blocks will be included.`);
     startYThreshold = Infinity;
     startPageThreshold = allPagesOcrData.length;
  } // else boundaryIndex is 0, defaults (0, -Infinity) are correct

  // ========================= START OF FIX =========================
  const studentWorkBlocks = allMathBlocksForContent.filter(block => {
    if (!block.coordinates) {
      console.log(`[DEBUG] Filtering Block ${block.globalBlockId}: Discarding (No Coords)`);
      return false;
    }

    // ========================= START OF FIX =========================
    let shouldKeep = false;
    // Rule 1: Always keep if the boundary detection failed (index 0).
    if (boundaryGlobalIndex === 0) {
      shouldKeep = true;
    }
    // Rule 2: Keep if block is on a page strictly AFTER the boundary page.
    else if (block.pageIndex > startPageThreshold) {
      shouldKeep = true;
    }
    // Rule 3: Keep if block is ON the boundary page AND at or BELOW the boundary Y coordinate.
    else if (block.pageIndex === startPageThreshold && block.coordinates.y >= startYThreshold) {
      shouldKeep = true;
    }
    // ELSE: Block is on a page before the boundary page, OR
    //       on the boundary page but above the start Y -> Discard.
    // (No explicit 'else shouldKeep = false', default is false unless a rule passes)
    // ========================== END OF FIX ==========================

    console.log(`[DEBUG] Filtering Block ${block.globalBlockId} (Page ${block.pageIndex}, Y: ${block.coordinates.y}) vs Boundary (Index ${boundaryGlobalIndex} -> Page ${startPageThreshold}, Y: ${startYThreshold}) -> Keep: ${shouldKeep}`);
    return shouldKeep;
  });
  console.log(`  -> Filtered down to ${studentWorkBlocks.length} student work blocks based on boundary.`);

  // --- 4. Group by Question (Use Detected Number) ---
  const tasks: MarkingTask[] = [];
  if (studentWorkBlocks.length > 0) {

    // ========================= START OF FIX 2 =========================
    let questionNumber: string | number = "UNKNOWN"; // Default
    // Attempt to get the question number from the detected schemes map
    // Simple approach: Assume only one question detected for now
    if (detectedSchemesMap && detectedSchemesMap.size === 1) {
         questionNumber = detectedSchemesMap.keys().next().value;
         console.log(`  -> Using detected question number: ${questionNumber}`);
    } else if (detectedSchemesMap && detectedSchemesMap.size > 1) {
         console.warn(`  -> Multiple question schemes detected (${Array.from(detectedSchemesMap.keys()).join(',')}). Using first detected ('${detectedSchemesMap.keys().next().value}') for single task.`);
         questionNumber = detectedSchemesMap.keys().next().value; // Use first one for now
    } else {
        console.warn(`  -> No specific question detected by Question Detection stage. Defaulting to Q1 (placeholder).`);
        questionNumber = 1; // Fallback to placeholder if detection failed
    }

    // Scheme is looked up later in the router, just pass the number
    // ========================== END OF FIX 2 ==========================

    const sourcePages = [...new Set(studentWorkBlocks.map(b => b.pageIndex))].sort((a, b) => a - b);

    // ========================= START OF FIX =========================
    // REMOVED: const markingScheme = getMarkingScheme(questionNumber);

    // Sort blocks by page, then Y-coordinate for proper ordering
    studentWorkBlocks.sort((a, b) => {
      if (a.pageIndex !== b.pageIndex) {
        return a.pageIndex - b.pageIndex;
      }
      const aY = a.coordinates.y;
      const bY = b.coordinates.y;
      return aY - bY;
    });

    // Create task WITHOUT the scheme (scheme added in router)
    tasks.push({
      questionNumber: questionNumber, // Use detected or fallback number
      mathBlocks: studentWorkBlocks,
      markingScheme: null, // Scheme added later
      sourcePages: sourcePages
    });
    // ========================== END OF FIX ==========================

    console.log(`✅ [SEGMENTATION] Created marking task for Q${questionNumber} with ${studentWorkBlocks.length} blocks from pages ${sourcePages.join(', ')}`);
  } else {
    console.warn(`[SEGMENTATION] No student work blocks remained after boundary filtering.`);
  }

  console.log(`✅ [SEGMENTATION] Created ${tasks.length} preliminary marking task(s) (without schemes).`);
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
  console.log(`🚀 [SUBMISSION ${submissionId}] Received request for /process.`);

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
    console.log(`[MIME CHECK] Received ${files.length} file(s). First mimetype: ${firstMime}`);
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
      console.log(`[SUBMISSION ${submissionId}] Routing to new ${inputType} pipeline.`);
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
          console.log(`[DIMENSIONS - PDF Path] Extracted dimensions for page ${i}: ${page.width}x${page.height}`);
        }));
        sendSseUpdate(res, createProgressData(1, 'Dimension extraction complete.', MULTI_IMAGE_STEPS));
      } catch (dimensionError) {
        console.error('❌ Error during PDF dimension extraction:', dimensionError);
        throw new Error(`Failed during PDF dimension extraction: ${dimensionError instanceof Error ? dimensionError.message : 'Unknown error'}`);
      }

      // Single-page PDF → route to new unified pipeline for consistency
      if (standardizedPages.length === 1) {
        console.log(`[SUBMISSION ${submissionId}] Single-page PDF detected. Routing to new unified pipeline for plain text formatting.`);
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
            console.log(`[PDF CONTEXT] Original PDF uploaded: ${originalPdfLink}`);
          } catch (error) {
            console.error('❌ Failed to upload original PDF:', error);
            originalPdfLink = null;
          }
        } else {
          // For unauthenticated users, create a data URL
          originalPdfDataUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
          console.log(`[PDF CONTEXT] Created PDF data URL for unauthenticated user`);
        }
        
        // Store PDF context for later use in the unified pipeline
        (req as any).pdfContext = {
          originalFileType: 'pdf' as const,
          originalPdfLink,
          originalPdfDataUrl,
          originalFileName: files[0].originalname || 'document.pdf'
        };
        
        // Continue to unified pipeline (don't return here)
        console.log(`[SUBMISSION ${submissionId}] Single-page PDF will be processed through new unified pipeline.`);
      }

      // Multi-page PDF – Continue to common processing logic
      console.log(`[SUBMISSION ${submissionId}] Multi-page PDF detected (${standardizedPages.length} pages). Proceeding with multi-page logic.`);
      
      // One-line dimension logs per page
      standardizedPages.forEach((p: any) => {
        const ratio = p.height ? (p.width / p.height).toFixed(3) : '0.000';
        console.log(`[DIM] page=${p.pageIndex} size=${p.width}x${p.height} ratio=${ratio}`);
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
      // --- Route to Original Single Image Pipeline ---
      console.log(`[SUBMISSION ${submissionId}] Routing single image to original pipeline.`);
      sendSseUpdate(res, createProgressData(2, 'Processing as single image...', MULTI_IMAGE_STEPS));

      // Prepare the image data URL
      const singleFileData = `data:${files[0].mimetype};base64,${files[0].buffer.toString('base64')}`;

      // Call the original pipeline function - IT HANDLES EVERYTHING + res.end()
      await runOriginalSingleImagePipeline(singleFileData, req, res, submissionId);

      // *** CRITICAL: Return immediately after calling the original pipeline ***
      return;
      // ========================== END OF FIX ==========================

    } else if (isMultipleImages) {
      // --- Multi-File / PDF Path (This code only runs if NOT isSingleImage) ---
      console.log(`[SUBMISSION ${submissionId}] Routing to new ${inputType} pipeline.`);
      sendSseUpdate(res, createProgressData(1, `Preparing ${inputType} processing...`, MULTI_IMAGE_STEPS));

      // 1. Collect Images & Extract Dimensions in Parallel
      sendSseUpdate(res, createProgressData(1, `Extracting dimensions for ${files.length} images...`, MULTI_IMAGE_STEPS));
      standardizedPages = await Promise.all(files.map(async (file, index): Promise<StandardizedPage | null> => {
        if (!file.mimetype.startsWith('image/')) return null;
        try {
          const metadata = await sharp(file.buffer).metadata();
          if (!metadata.width || !metadata.height) return null;
          console.log(`[DIMENSIONS - MultiImg Path] Extracted dimensions for image ${index}: ${metadata.width}x${metadata.height}`);
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
    const globalQuestionText = standardizedPages.length > 0
      ? (await ClassificationService.classifyImage(standardizedPages[0].imageData, 'auto', false, standardizedPages[0].originalFileName)).extractedQuestionText
      : undefined;
    console.log(`🔍 [CLASSIFICATION] Extracted Global Question Text: ${globalQuestionText ? `"${globalQuestionText.substring(0, 100)}..."` : 'None'}`);

    // --- Run OCR on each page in parallel ---
    const pageProcessingPromises = standardizedPages.map(async (page): Promise<PageOcrResult> => {
      console.log(`⚡ [OCR Parallel] Starting OCR for page ${page.pageIndex}...`);
      const ocrResult = await OCRService.processImage(
        page.imageData, {}, false, 'auto',
        { extractedQuestionText: globalQuestionText }
      );
      console.log(`⚡ [OCR Parallel] Finished OCR for page ${page.pageIndex}.`);
      return {
        pageIndex: page.pageIndex,
        ocrData: ocrResult,
        classificationText: globalQuestionText // Pass down for segmentation
      };
    });

    allPagesOcrData = await Promise.all(pageProcessingPromises);
    sendSseUpdate(res, createProgressData(3, 'OCR & Classification complete.', MULTI_IMAGE_STEPS));
    // ========================== END: IMPLEMENT STAGE 2 ==========================

    // ========================= START: ADD QUESTION DETECTION STAGE =========================
    sendSseUpdate(res, createProgressData(4, 'Detecting questions and fetching schemes...', MULTI_IMAGE_STEPS));

    // Consolidate necessary data for Question Detection (e.g., all OCR text)
    const allOcrTextForDetection = allPagesOcrData.map(p => p.ocrData.text).join('\n\n--- Page Break ---\n\n');
    // Or pass structured blocks if needed by the service

    // Call your Question Detection Service
    // For now, use the existing detectQuestion method and create a placeholder response
    const detectionResult = await questionDetectionService.detectQuestion(
        globalQuestionText || allOcrTextForDetection
    );
    
    // Create a Map from the detection result
    const markingSchemesMap: Map<string, any> = new Map();
    if (detectionResult.found && detectionResult.match?.markingScheme) {
        // Use question number from detection result or default to 1
        const questionNumber = detectionResult.match.questionNumber || '1';
        
        // ========================= START OF FIX =========================
        // Extract the specific question's marks from the marking scheme
        // The marking scheme should have structure: questionMarks (which is the full marks array)
        let questionSpecificMarks = null;
        
        // The questionMarks should be the full marks array from fullexampaper.questions[x].marks
        if (detectionResult.match.markingScheme.questionMarks) {
            // questionMarks is the full marks array for this question
            questionSpecificMarks = detectionResult.match.markingScheme.questionMarks;
            console.log(`🔍 [SCHEME EXTRACTION] Using questionMarks for Q${questionNumber}:`, questionSpecificMarks);
        } else {
            console.warn(`⚠️ [SCHEME EXTRACTION] No questionMarks found for Q${questionNumber} in marking scheme`);
            questionSpecificMarks = detectionResult.match.markingScheme; // Fallback to entire scheme
        }
        
        markingSchemesMap.set(questionNumber, questionSpecificMarks);
        // ========================== END OF FIX ==========================
    }

    if (markingSchemesMap.size === 0) {
        console.warn("[QUESTION DETECTION] No questions or schemes were identified.");
        // Handle appropriately - maybe fallback to a default scheme or error?
    } else {
         console.log(`[QUESTION DETECTION] Detected schemes for questions: ${Array.from(markingSchemesMap.keys()).join(', ')}`);
    }
    sendSseUpdate(res, createProgressData(4, `Detected ${markingSchemesMap.size} question scheme(s).`, MULTI_IMAGE_STEPS));
    // ========================== END: ADD QUESTION DETECTION STAGE ==========================

    // ========================= START: IMPLEMENT STAGE 3 =========================
    // --- Stage 3: Consolidation & Segmentation ---
    sendSseUpdate(res, createProgressData(5, 'Segmenting work by question...', MULTI_IMAGE_STEPS));

    // Call the segmentation function
    markingTasks = segmentOcrResultsByQuestion(
      allPagesOcrData,
      globalQuestionText,
      markingSchemesMap // <-- Pass the map here
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
             console.warn(`[SCHEME MAPPING] No scheme found for segmented Question ${task.questionNumber}. Task will be skipped or use default.`);
             // Decide how to handle missing scheme: skip task, use default, throw error?
             // For now, let's add a placeholder to avoid crashing executeMarkingForQuestion
             return { ...task, markingScheme: { error: `Scheme not found for Q${task.questionNumber}` } };
        }
        return { ...task, markingScheme: scheme }; // Add the found scheme
    }).filter(task => task.markingScheme && !task.markingScheme.error); // Filter out tasks without valid schemes

    if (tasksWithSchemes.length === 0 && markingTasks.length > 0) {
         console.error("❌ No valid marking schemes could be assigned to segmented tasks.");
         throw new Error("Failed to assign marking schemes to any detected question work.");
    }
     console.log(`[SCHEME MAPPING] Assigned schemes to ${tasksWithSchemes.length} task(s).`);
    // ========================== END: ADD SCHEME TO TASKS ==========================

    // ========================= START: IMPLEMENT STAGE 4 =========================
    // --- Stage 4: Marking (Single or Parallel) ---
    sendSseUpdate(res, createProgressData(6, `Marking ${tasksWithSchemes.length} question(s)...`, MULTI_IMAGE_STEPS));

    // Call the refactored function for each task (works for 1 or many)
    const markingPromises = tasksWithSchemes.map(task => // <-- Use tasksWithSchemes
        executeMarkingForQuestion(task, res, submissionId) // Pass res and submissionId
    );

    // Wait for all marking tasks to complete
    const allQuestionResults: QuestionResult[] = await Promise.all(markingPromises);
    sendSseUpdate(res, createProgressData(6, 'All questions marked.', MULTI_IMAGE_STEPS));
    // ========================== END: IMPLEMENT STAGE 4 ==========================

    // ========================= START: IMPLEMENT STAGE 5 =========================
    // --- Stage 5: Aggregation & Output ---
    sendSseUpdate(res, createProgressData(7, 'Aggregating results and generating annotated images...', MULTI_IMAGE_STEPS));

    // --- Annotation Grouping ---
    const annotationsByPage: { [pageIndex: number]: EnrichedAnnotation[] } = {};
    allQuestionResults.forEach(qr => {
        (qr.annotations || []).forEach(anno => {
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

        // Only call service if there's something to draw
        if (annotationsForThisPage.length > 0 || scoreToDraw) {
            console.log(`🖌️ [ANNOTATION] Drawing ${annotationsForThisPage.length} annotations (Score: ${!!scoreToDraw}) on page ${pageIndex}...`);
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
      const aiMessageId = req.body.aiMessageId;
      
      // Generate timestamps for database consistency
      const userTimestamp = new Date(Date.now() - 1000).toISOString(); // User message 1 second earlier
      const aiTimestamp = new Date().toISOString(); // AI message current time
      
      // Create user message for database
      const dbUserMessage = createUserMessage({
        content: customText || (isPdf ? 'I have uploaded a PDF for analysis.' : `I have uploaded ${files.length} file(s) for analysis.`),
        imageData: !isAuthenticated ? (isPdf ? files[0].buffer.toString('base64') : files.map(f => f.buffer.toString('base64')).join(',')) : undefined,
        originalFileName: files[0]?.originalname || 'uploaded-file',
        sessionId: currentSessionId,
        model: model,
        // Add PDF context if applicable
        ...(pdfContext && {
          originalFileType: pdfContext.originalFileType,
          originalPdfLink: pdfContext.originalPdfLink,
          originalPdfDataUrl: pdfContext.originalPdfDataUrl
        })
      });
      
      // Override timestamp for database consistency
      (dbUserMessage as any).timestamp = userTimestamp;
      
      // Create AI message for database
      const resolvedAIMessageId = handleAIMessageIdForEndpoint(req.body, null, 'marking');
      const dbAiMessage = createAIMessage({
        content: 'Marking completed - see results below',
        messageId: resolvedAIMessageId,
        imageData: !isAuthenticated && finalAnnotatedOutput.length > 0 ? finalAnnotatedOutput[0] : undefined, // Use first image for unauthenticated users
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
      (dbAiMessage as any).imageDataArray = finalAnnotatedOutput;
      (dbAiMessage as any).resultsByQuestion = allQuestionResults;
      
      // Add detectedQuestion data for exam stats tabs (following original pipeline design)
      // Use the detectionResult.match data instead of markingSchemesMap for question metadata
      if (detectionResult && detectionResult.found && detectionResult.match) {
        (dbAiMessage as any).detectedQuestion = {
          found: true,
          questionText: detectionResult.questionText || '',
          questionNumber: detectionResult.match.questionNumber || '',
          subQuestionNumber: detectionResult.match.subQuestionNumber || '',
          examBoard: detectionResult.match.board || 'Pearson Edexcel',
          examCode: detectionResult.match.paperCode || '1MA1/2F',
          paperTitle: detectionResult.match.qualification || 'Mathematics',
          subject: 'Mathematics', // Default value since not in ExamPaperMatch
          tier: detectionResult.match.tier || 'Foundation Tier',
          year: detectionResult.match.year || '2022',
          marks: detectionResult.match.marks || 0,
          markingScheme: detectionResult.match.markingScheme ? JSON.stringify(detectionResult.match.markingScheme) : ''
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
      
      // Generate session title
      const sessionTitle = `Marking Session - ${new Date().toLocaleDateString()}`;
      
      // Handle session creation and message storage - only for authenticated users
      if (isAuthenticated) {
        if (sessionId && !sessionId.startsWith('temp-')) {
          // Adding to existing session
          await FirestoreService.addMessageToUnifiedSession(currentSessionId, dbUserMessage);
          await FirestoreService.addMessageToUnifiedSession(currentSessionId, dbAiMessage);
          console.log(`✅ [SUBMISSION ${submissionId}] Messages added to existing session ${currentSessionId}`);
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
          console.log(`✅ [SUBMISSION ${submissionId}] New session created: ${currentSessionId}`);
        }
      } else {
        console.log(`ℹ️ [SUBMISSION ${submissionId}] Anonymous user - messages not persisted to database`);
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
    console.log(`✅ [SUBMISSION ${submissionId}] Processing complete. Final 'complete' event sent.`);
    // ========================== END: IMPLEMENT STAGE 5 ==========================

  } catch (error) {
    console.error(`❌ [SUBMISSION ${submissionId}] Processing failed:`, error);
    
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
      console.log(`[SUBMISSION ${submissionId}] SSE connection closed in finally block (multi-page path).`);
    } else {
      console.log(`[SUBMISSION ${submissionId}] SSE connection likely closed by single-page pipeline.`);
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
