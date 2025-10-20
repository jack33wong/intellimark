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
import { sendSseUpdate, closeSseConnection } from '../utils/sseUtils.js';
import { createAIMessage } from '../utils/messageUtils.js';
import { OCRService } from '../services/ocr/OCRService.js';
import { ClassificationService } from '../services/marking/ClassificationService.js';
import { MarkingInstructionService } from '../services/marking/MarkingInstructionService.js';
import { SVGOverlayService } from '../services/marking/svgOverlayService.js';

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
  markingScheme: any;
  sourcePages: number[];
}

interface QuestionResult {
  questionNumber: number | string;
  score: any;
  annotations: any[];
  feedback?: string;
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
  globalQuestionText?: string
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

  // Rest of filtering logic remains the same...
  const studentWorkBlocks = allMathBlocksForContent.filter(block => {
    if (!block.coordinates) return false;
    const pageCheck = block.pageIndex >= startPageThreshold;
    // Ensure Y check allows blocks *on* the start page if Y coord >= threshold
    const yCheck = block.pageIndex > startPageThreshold || (block.pageIndex === startPageThreshold && block.coordinates.y >= startYThreshold);
    const shouldKeep = pageCheck && yCheck;
    console.log(`[DEBUG] Filtering Block ${block.globalBlockId} (Page ${block.pageIndex}, Y: ${block.coordinates.y}): PageCheck(${pageCheck}), YCheck(${yCheck}) -> Keep: ${shouldKeep}`);
    return shouldKeep;
  });
  console.log(`  -> Filtered down to ${studentWorkBlocks.length} student work blocks based on boundary.`);

  // --- 4. Group by Question (Simplified: Assumes Single Question) ---
  const tasks: MarkingTask[] = [];
  if (studentWorkBlocks.length > 0) {
    const questionNumber = 1; // Placeholder for single question
    const sourcePages = [...new Set(studentWorkBlocks.map(b => b.pageIndex))].sort((a, b) => a - b);
    
    // Sort blocks by page, then Y-coordinate for proper ordering
    studentWorkBlocks.sort((a, b) => {
      if (a.pageIndex !== b.pageIndex) {
        return a.pageIndex - b.pageIndex;
      }
      const aY = a.coordinates.y;
      const bY = b.coordinates.y;
      return aY - bY;
    });
    
    const markingTask: MarkingTask = {
      questionNumber,
      mathBlocks: studentWorkBlocks,
      markingScheme: null, // Will be populated in Step 5
      sourcePages
    };
    
    tasks.push(markingTask);
    console.log(`✅ [SEGMENTATION] Created marking task for Q${questionNumber} with ${studentWorkBlocks.length} blocks from pages ${sourcePages.join(', ')}`);
  } else {
    console.warn(`[SEGMENTATION] No student work blocks remained after boundary filtering.`);
  }

  console.log(`✅ [SEGMENTATION] Created ${tasks.length} marking task(s).`);
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


/**
 * POST /api/marking/process
 * 
 * Unified endpoint for processing single images, multiple images, and PDFs
 * Routes to appropriate pipeline based on input type detection
 */
router.post('/process', optionalAuth, upload.array('files'), async (req: Request, res: Response, next: NextFunction) => {
  // --- Basic Setup ---
  const submissionId = uuidv4(); // Generate a unique ID for this submission
  console.log(`🚀 [SUBMISSION ${submissionId}] Received request for /process.`);

  // --- SSE Setup ---
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });
  
  // Send initial message
  sendSseUpdate(res, { submissionId, stage: 'START', status: 'PROCESSING', message: 'Processing started' });

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
    
    sendSseUpdate(res, { submissionId, stage: 'INPUT_VALIDATION', status: 'PROCESSING', message: `Received ${files.length} file(s). Validating...` });

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
    
    sendSseUpdate(res, { submissionId, stage: 'INPUT_VALIDATION', status: 'DONE', message: `Input validated (${isPdf ? 'PDF' : isMultipleImages ? 'Multiple Images' : 'Single Image'}).` });

    // --- Declare standardizedPages at proper scope ---
    let standardizedPages: StandardizedPage[] = [];

    // --- Conditional Routing (PDF first) ---
    if (isPdf) {
      // --- Route to PDF Pipeline ---
      console.log(`[SUBMISSION ${submissionId}] PDF detected. Routing to PDF pipeline.`);
      sendSseUpdate(res, { submissionId, stage: 'ROUTING', status: 'PROCESSING', message: `Preparing PDF processing...` });

      // Stage 1: Standardization
      sendSseUpdate(res, { submissionId, stage: 'STANDARDIZATION', status: 'PROCESSING', message: 'Converting PDF...' });
      const pdfBuffer = files[0].buffer;
      const standardizedPages = await PdfProcessingService.convertPdfToImages(pdfBuffer);
      if (standardizedPages.length === 0) throw new Error('PDF conversion yielded no pages.');
      sendSseUpdate(res, { submissionId, stage: 'STANDARDIZATION', status: 'DONE', message: `Converted PDF to ${standardizedPages.length} pages.` });

      // Dimension extraction after conversion (reliable via sharp on buffers)
      sendSseUpdate(res, { submissionId, stage: 'DIMENSIONS', status: 'PROCESSING', message: `Extracting dimensions for ${standardizedPages.length} converted page(s)...` });
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
        sendSseUpdate(res, { submissionId, stage: 'DIMENSIONS', status: 'DONE', message: 'Dimension extraction complete.' });
      } catch (dimensionError) {
        console.error('❌ Error during PDF dimension extraction:', dimensionError);
        throw new Error(`Failed during PDF dimension extraction: ${dimensionError instanceof Error ? dimensionError.message : 'Unknown error'}`);
      }

      // TEMP: Single-page PDF → treat as single image
      if (standardizedPages.length === 1) {
        console.log(`[SUBMISSION ${submissionId}] Single-page PDF detected. Routing to original single image pipeline after conversion.`);
        sendSseUpdate(res, { submissionId, stage: 'ROUTING', status: 'PROCESSING', message: 'Processing as single converted page...' });
        
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
        
        const singleFileData = standardizedPages[0].imageData;
        
        // Create a modified request object with the original PDF filename
        const modifiedReq = {
          ...req,
          body: {
            ...req.body,
            originalFileName: files[0].originalname || 'document.pdf'
          }
        } as Request;
        
        await runOriginalSingleImagePipeline(singleFileData, modifiedReq, res, submissionId, {
          originalFileType: 'pdf',
          originalPdfLink: originalPdfLink,
          originalPdfDataUrl: originalPdfDataUrl
        });
        return;
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
      // --- Route to Original Single Image Pipeline ---
      console.log(`[SUBMISSION ${submissionId}] Routing to original single image pipeline.`);
      sendSseUpdate(res, { submissionId, stage: 'ROUTING', status: 'PROCESSING', message: 'Processing as single image...' });

      // Convert file buffer to base64 data URL
      console.log(`[MIME CHECK] Single image mimetype: ${files[0].mimetype}`);
      const singleFileData = `data:${files[0].mimetype};base64,${files[0].buffer.toString('base64')}`;

      // Convert multipart form data to the format expected by the original pipeline
      const originalRequestBody = {
        imageData: singleFileData,
        model: req.body.model || 'auto',
        customText: req.body.customText || 'I have a question about this image.',
        debug: false,
        aiMessageId: req.body.aiMessageId || null,
        sessionId: req.body.sessionId || null,
        originalFileName: files[0].originalname || `image.${files[0].mimetype.split('/')[1]}`
      };

      // Create a modified request object with the converted body
      const modifiedReq = {
        ...req,
        body: originalRequestBody
      } as Request;

      // Call the original single image pipeline
      // This function handles everything: preprocessing, OCR, classification, marking, annotation, DB persistence, final SSE message + res.end()
      await runOriginalSingleImagePipeline(singleFileData, modifiedReq, res, submissionId);

      // Note: runOriginalSingleImagePipeline MUST eventually call res.end()

    } else if (isMultipleImages) {
      // --- Multi-Image Path ---
      console.log(`[SUBMISSION ${submissionId}] Routing to new multi-image pipeline.`);
      sendSseUpdate(res, { submissionId, stage: 'ROUTING', status: 'PROCESSING', message: `Preparing multi-image processing...` });

      // 1. Collect Images & Extract Dimensions in Parallel
      sendSseUpdate(res, { submissionId, stage: 'STANDARDIZATION', status: 'PROCESSING', message: `Extracting dimensions for ${files.length} images...` });
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
      sendSseUpdate(res, { submissionId, stage: 'STANDARDIZATION', status: 'DONE', message: `Collected ${standardizedPages.length} image(s).` });

    } else {
      // This case should technically be caught by initial validation, but belt-and-suspenders.
      throw new Error("Unhandled submission type.");
    }

    // --- Guard against empty standardization ---
    if (standardizedPages.length === 0) {
      throw new Error('Standardization failed: No processable pages/images found.');
    }

    // --- Preprocessing (Common for Multi-Page PDF & Multi-Image) ---
    sendSseUpdate(res, { submissionId, stage: 'PREPROCESSING', status: 'PROCESSING', message: `Preprocessing ${standardizedPages.length} image(s)...` });
    const preprocessedImageDatas = await Promise.all(
      standardizedPages.map(page => ImageUtils.preProcess(page.imageData))
    );
    standardizedPages.forEach((page, i) => page.imageData = preprocessedImageDatas[i]);
    sendSseUpdate(res, { submissionId, stage: 'PREPROCESSING', status: 'DONE', message: 'Image preprocessing complete.' });

    // ========================= START: IMPLEMENT STAGE 2 =========================
    // --- Stage 2: Parallel OCR/Classify (Common for Multi-Page PDF & Multi-Image) ---
    sendSseUpdate(res, { submissionId, stage: 'OCR_CLASSIFY', status: 'PROCESSING', message: `Running OCR & Classification on ${standardizedPages.length} pages...` });

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

    const allPagesOcrData: PageOcrResult[] = await Promise.all(pageProcessingPromises);
    sendSseUpdate(res, { submissionId, stage: 'OCR_CLASSIFY', status: 'DONE', message: 'OCR & Classification complete.' });
    // ========================== END: IMPLEMENT STAGE 2 ==========================

    // ========================= START: IMPLEMENT STAGE 3 =========================
    // --- Stage 3: Consolidation & Segmentation ---
    sendSseUpdate(res, { submissionId, stage: 'SEGMENTATION', status: 'PROCESSING', message: 'Segmenting work by question...' });

    // Call the segmentation function
    const markingTasks: MarkingTask[] = segmentOcrResultsByQuestion(
      allPagesOcrData,
      globalQuestionText
    );

    // Handle case where no student work is found
    if (markingTasks.length === 0) {
      sendSseUpdate(res, { submissionId, stage: 'SEGMENTATION', status: 'DONE', message: 'Segmentation complete. No student work found to mark.' });
      const inputType = isPdf ? 'PDF' : isMultipleImages ? 'Multiple Images' : 'Single Image';
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
    sendSseUpdate(res, { submissionId, stage: 'SEGMENTATION', status: 'DONE', message: `Segmentation complete. Identified student work for ${markingTasks.length} question(s).` });
    // ========================== END: IMPLEMENT STAGE 3 ==========================

    // --- TEMPORARY Placeholder for Stages 4 & 5 ---
    // We now have 'markingTasks'. The next step (Step 5) will refactor the marking logic.
    console.log(`[SUBMISSION ${submissionId}] Reached end of implemented stages (Segmentation complete). Sending placeholder complete event.`);

    // Create a summary message indicating segmentation success
    const inputType = isPdf ? 'PDF' : isMultipleImages ? 'Multiple Images' : 'Single Image';
    const summaryContent = `Segmentation successful. Found work for ${markingTasks.length} question(s) across ${standardizedPages.length} pages/images. Ready for marking. (Full implementation pending)`;
    const placeholderAiMessage = createAIMessage({ 
      content: summaryContent, 
      messageId: `placeholder-${submissionId}`, 
      isQuestionOnly: false, 
      processingStats: { apiUsed: "placeholder" } 
    });
    
    let finalResultPayload: any;
    const sessionTitle = `${inputType} Segmentation Complete`;
    
    if (isAuthenticated) {
      const placeholderUnifiedSession = {
        id: submissionId,
        title: sessionTitle,
        userId: userId,
        messageType: 'Marking',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [placeholderAiMessage],
        sessionStats: {
          totalProcessingTimeMs: 0,
          lastModelUsed: 'auto',
          lastApiUsed: 'placeholder',
          totalLlmTokens: 0,
          totalMathpixCalls: 0,
          totalTokens: 0,
          averageConfidence: 0,
          imageSize: 0,
          totalAnnotations: 0
        }
      };
      finalResultPayload = { success: true, unifiedSession: placeholderUnifiedSession, sessionId: submissionId };
    } else {
      finalResultPayload = { 
        success: true, 
        aiMessage: placeholderAiMessage, 
        sessionId: submissionId, 
        sessionTitle: sessionTitle 
      };
    }
    sendSseUpdate(res, { type: 'complete', result: finalResultPayload }, true);
    res.end();

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
    sendSseUpdate(res, { 
      stage: 'ERROR', 
      status: 'FAILED', 
      message: userFriendlyMessage,
      technicalError: process.env['NODE_ENV'] === 'development' ? (error instanceof Error ? error.message : 'Unknown error') : undefined
    });
    
    // Ensure the connection is always closed on error
    if (!res.writableEnded) {
      res.end();
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
