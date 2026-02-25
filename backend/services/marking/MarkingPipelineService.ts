import { v4 as uuidv4 } from 'uuid';
import { Request, Response } from 'express';
import type { ModelType, MarkingTask, EnrichedAnnotation, MathBlock } from '../../types/index.js';
import PdfProcessingService from '../pdf/PdfProcessingService.js';
import sharp from 'sharp';
import { ImageUtils } from '../../utils/ImageUtils.js';
import { MarkingInstructionService } from './MarkingInstructionService.js';
import { MarkingOutputService } from './MarkingOutputService.js';
import { MarkingPersistenceService } from './MarkingPersistenceService.js';
import { createProgressData } from '../../utils/sseUtils.js';
import {
    logPerformanceSummary,
    extractQuestionsFromClassification,
    logAnnotationSummary,
    getQuestionSortValue
} from './MarkingHelpers.js';
import { withPerformanceLogging } from '../../utils/markingRouterHelpers.js';
import UsageTracker from '../../utils/UsageTracker.js';

import type { MarkingSessionContext, QuestionSessionContext } from '../../types/sessionManagement.js';
import { getBaseQuestionNumber, extractQuestionNumberFromFilename } from '../../utils/TextNormalizationUtils.js';
import { formatMarkingSchemeAsBullets } from '../../config/prompts.js';

// Helper functions for real model and API names
function getRealModelName(modelType: string): string {
    if (modelType === 'auto') {
        return 'gemini-2.0-flash'; // Default model for backward compatibility
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

import type { StandardizedPage, PageOcrResult } from '../../types/markingRouter.js';

import { OCRService } from '../ocr/OCRService.js';
import { ClassificationService } from './ClassificationService.js';
import type { QuestionResult } from '../../types/marking.js';
import { executeMarkingForQuestion, createMarkingTasksFromClassification } from './MarkingExecutor.js';
import { MarkingSchemeOrchestrationService } from './MarkingSchemeOrchestrationService.js';
import { QuestionModeHandlerService } from './QuestionModeHandlerService.js';
import { ModeSplitService } from './ModeSplitService.js';
import { SessionManagementService } from '../sessionManagementService.js';
import { createUserMessage, createAIMessage } from '../../utils/messageUtils.js';

// Define the steps for multi-image processing
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

export interface MarkingOptions {
    model?: string;
    examType?: string;
    subject?: string;
    level?: string;
    examBoard?: string;
    paper?: string;
    year?: string;
    season?: string;
    questionNumber?: string;
    markingScheme?: string;
    userId?: string;
    sessionId?: string;
    customText?: string;
}

export class MarkingPipelineService {

    static async executePipeline(
        req: Request,
        files: Express.Multer.File[],
        submissionId: string,
        options: MarkingOptions,
        progressCallback: (data: any) => void,
        usageTracker: UsageTracker
    ): Promise<any> {
        // --- Basic Setup ---
        // submissionId is passed in
        const startTime = Date.now();

        // Reset debug log flag for new marking session
        MarkingInstructionService.resetDebugLog();

        // Performance tracking variables
        let stepTimings: { [key: string]: { start: number; duration?: number; subSteps?: { [key: string]: number } } } = {};
        let totalLLMTokens = 0;
        let actualModel = 'auto'; // Will be updated when model is determined
        let questionOnlyResult: any = null; // Hoisted for scope access in fallback blocks

        // Performance tracking function
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

        // Send initial message
        progressCallback(createProgressData(0, 'Processing started', MULTI_IMAGE_STEPS));

        try {
            // Determine authentication status early
            const userId = options.userId || null;
            const isAuthenticated = !!userId;

            // Extract options
            let model = options.model || 'auto';
            const examType = options.examType || 'GCE';
            const subject = options.subject || 'Mathematics';
            const level = options.level || 'A Level';
            const examBoard = options.examBoard || 'Edexcel';
            const paper = options.paper || '1';
            const year = options.year || '2023';
            const season = options.season || 'June';
            const inputQuestionNumber = options.questionNumber;
            const inputMarkingScheme = options.markingScheme;

            // Determine actual model
            if (model === 'auto') {
                const { getDefaultModel } = await import('../../config/aiModels.js');
                actualModel = getDefaultModel();
            } else {
                actualModel = model;
            }

            const debugClassification = process.env.DEBUG_RAW_CLASSIFICATION_RESPONSE === 'true';

            // Input Validation
            const logValidation = logStep('Input Validation', 'Validation');
            if (!files || files.length === 0) {
                throw new Error('No files uploaded.');
            }
            logValidation();

            // Determine Input Type
            const firstMime = files[0].mimetype;
            const isPdf = files.length === 1 && firstMime === 'application/pdf';
            const isMultiplePdfs = files.length > 1 && files.every(f => f.mimetype === 'application/pdf');
            const isSingleImage = files.length === 1 && !isPdf && firstMime.startsWith('image/');
            const isMultipleImages = files.length > 1 && files.every(f => {
                const ok = f.mimetype?.startsWith('image/');
                if (!ok) console.warn(`[MIME CHECK] Non-image file detected in multi-upload: ${f.mimetype}`);
                return ok;
            });

            const inputType = isPdf ? 'PDF' : (isMultiplePdfs ? 'Multiple PDFs' : (isSingleImage ? 'Single Image' : 'Multiple Images'));
            console.log(`[INPUT TYPE] Detected: ${inputType} (${files.length} files)`);

            // --- Declare variables at proper scope ---
            let standardizedPages: StandardizedPage[] = [];
            let allPagesOcrData: PageOcrResult[] = [];
            let markingTasks: MarkingTask[] = [];
            let pdfContext: any = null;
            let pageDimensionsMap = new Map<number, { width: number; height: number }>();

            // --- Conditional Routing (PDF first) ---
            if (isPdf || isMultiplePdfs) {
                // --- Multi-File / PDF Path ---
                progressCallback(createProgressData(1, `Preparing ${inputType} processing...`, MULTI_IMAGE_STEPS));

                // Stage 1: Standardization
                if (isPdf) {
                    progressCallback(createProgressData(1, 'Converting PDF...', MULTI_IMAGE_STEPS));
                    const pdfBuffer = files[0].buffer;
                    const originalFileName = files[0].originalname || 'document.pdf';
                    stepTimings['pdf_conversion'] = { start: Date.now() };

                    // Use convertPdfToImages as in markingRouter.ts
                    standardizedPages = await PdfProcessingService.convertPdfToImages(pdfBuffer);

                    // TEMP: Limit to first 10 pages
                    // Enforce Page Limit
                    const MAX_PAGES_LIMIT = parseInt(process.env.MAX_UPLOAD_PAGES || '50');
                    if (standardizedPages.length > MAX_PAGES_LIMIT) {
                        throw new Error(`Upload exceeds the maximum limit of ${MAX_PAGES_LIMIT} pages/images. Processed ${standardizedPages.length} pages.`);
                    }
                    // Set originalFileName
                    standardizedPages.forEach((page) => {
                        page.originalFileName = originalFileName;
                    });

                    if (stepTimings['pdf_conversion']) {
                        stepTimings['pdf_conversion'].duration = Date.now() - stepTimings['pdf_conversion'].start;
                    }
                    if (standardizedPages.length === 0) throw new Error('PDF conversion yielded no pages.');
                    progressCallback(createProgressData(1, `Converted PDF to ${standardizedPages.length} pages.`, MULTI_IMAGE_STEPS));
                } else if (isMultiplePdfs) {
                    // Multiple PDFs processing
                    progressCallback(createProgressData(1, `Converting ${files.length} PDFs in parallel...`, MULTI_IMAGE_STEPS));
                    stepTimings['pdf_conversion'] = { start: Date.now() };

                    const pdfConversionPromises = files.map(async (file, index) => {
                        try {
                            const pdfPages = await PdfProcessingService.convertPdfToImages(file.buffer);
                            if (pdfPages.length === 0) {
                                console.warn(`PDF ${index + 1} (${file.originalname}) yielded no pages.`);
                                return { index, pdfPages: [] };
                            }

                            // Enforce Page Limit per PDF (part of total check later, but good early check)
                            const MAX_PAGES_LIMIT = parseInt(process.env.MAX_UPLOAD_PAGES || '50');
                            if (pdfPages.length > MAX_PAGES_LIMIT) {
                                throw new Error(`Single PDF exceeds the maximum limit of ${MAX_PAGES_LIMIT} pages.`);
                            }

                            // Store original index
                            pdfPages.forEach((page, pageIndex) => {
                                page.originalFileName = file.originalname || `pdf-${index + 1}.pdf`;
                                (page as any)._sourceIndex = index;
                            });

                            return { index, pdfPages };
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

                    // Enforce Total Page Limit for Multiple PDFs
                    const MAX_PAGES_LIMIT = parseInt(process.env.MAX_UPLOAD_PAGES || '50');
                    if (standardizedPages.length > MAX_PAGES_LIMIT) {
                        throw new Error(`Total upload exceeds the maximum limit of ${MAX_PAGES_LIMIT} pages/images. Processed ${standardizedPages.length} pages.`);
                    }

                    if (standardizedPages.length === 0) throw new Error('All PDF conversions yielded no pages.');
                    progressCallback(createProgressData(1, `Converted ${files.length} PDFs to ${standardizedPages.length} total pages.`, MULTI_IMAGE_STEPS));
                }

                // Dimension extraction after conversion (reliable via sharp on buffers)
                progressCallback(createProgressData(1, `Extracting dimensions for ${standardizedPages.length} converted page(s)...`, MULTI_IMAGE_STEPS));
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
                    progressCallback(createProgressData(1, 'Dimension extraction complete.', MULTI_IMAGE_STEPS));
                } catch (dimensionError) {
                    console.error('❌ Error during PDF dimension extraction:', dimensionError);
                    throw new Error(`Failed during PDF dimension extraction: ${dimensionError instanceof Error ? dimensionError.message : 'Unknown error'}`);
                }

                // Handle PDF upload and context setup
                if (isPdf && !isMultiplePdfs) {
                    // Single PDF (single-page or multi-page) - set pdfContext
                    const pageCount = standardizedPages.length;
                    progressCallback(createProgressData(2, pageCount === 1 ? 'Processing as single converted page...' : 'Processing multi-page PDF...', MULTI_IMAGE_STEPS));

                    // Upload original PDF to storage for authenticated users
                    let originalPdfLink = null;
                    let originalPdfDataUrl = null;

                    if (isAuthenticated) {
                        const originalFileName = files[0].originalname || 'document.pdf';
                        try {
                            const { ImageStorageService } = await import('../imageStorageService.js');
                            const sessionId = options.sessionId || submissionId;
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
                    pdfContext = {
                        originalFileType: 'pdf' as const,
                        originalPdfLink,
                        originalPdfDataUrl,
                        originalFileName: files[0].originalname || 'document.pdf',
                        fileSize: fileSizeBytes,
                        fileSizeMB: fileSizeMB + ' MB'
                    };
                } else if (isMultiplePdfs) {
                    // Multiple PDFs - store all PDFs for later use
                    progressCallback(createProgressData(2, 'Processing multiple PDFs...', MULTI_IMAGE_STEPS));

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
                                const { ImageStorageService } = await import('../imageStorageService.js');
                                const sessionId = options.sessionId || submissionId;
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
                    pdfContext = {
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
                progressCallback(createProgressData(2, 'Processing as single image with multi-question detection...', MULTI_IMAGE_STEPS));

                // Convert single image to standardized format for unified pipeline
                const singleFileData = `data:${files[0].mimetype};base64,${files[0].buffer.toString('base64')}`;

                // Standardize the single image as if it were a multi-image input
                standardizedPages = [{
                    pageIndex: 0,
                    imageData: singleFileData,
                    originalFileName: files[0].originalname || 'single-image.png'
                }];

                // Extract dimensions for the single image
                progressCallback(createProgressData(2, 'Extracting image dimensions...', MULTI_IMAGE_STEPS));
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
                progressCallback(createProgressData(1, `Preparing ${inputType} processing...`, MULTI_IMAGE_STEPS));

                // 1. Collect Images & Extract Dimensions in Parallel
                progressCallback(createProgressData(1, `Extracting dimensions for ${files.length} images...`, MULTI_IMAGE_STEPS));
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

                // Re-assign pageIndex based on upload order (User Design)
                standardizedPages.forEach((page, index) => {
                    page.pageIndex = index;
                });

                // Enforce Page Limit for Multiple Images
                const MAX_PAGES_LIMIT = parseInt(process.env.MAX_UPLOAD_PAGES || '50');
                if (standardizedPages.length > MAX_PAGES_LIMIT) {
                    throw new Error(`Upload exceeds the maximum limit of ${MAX_PAGES_LIMIT} images. Selected ${standardizedPages.length} images.`);
                }

                progressCallback(createProgressData(1, `Collected ${standardizedPages.length} image(s).`, MULTI_IMAGE_STEPS));

            } else {
                // This case should technically be caught by initial validation, but belt-and-suspenders.
                throw new Error("Unhandled submission type.");
            }

            // --- Guard against empty standardization ---
            if (standardizedPages.length === 0) {
                throw new Error('Standardization failed: No processable pages/images found.');
            }

            // --- Preprocessing (Common for Multi-Page PDF & Multi-Image) ---
            progressCallback(createProgressData(2, `Preprocessing ${standardizedPages.length} image(s)...`, MULTI_IMAGE_STEPS));
            const logPreprocessingComplete = logStep('Preprocessing', 'image-processing');
            const preprocessedImageDatas = await Promise.all(
                standardizedPages.map(page => ImageUtils.preProcess(page.imageData))
            );

            // Update image data AND re-extract dimensions (critical for orientation/rotation normalization)
            for (let i = 0; i < standardizedPages.length; i++) {
                const page = standardizedPages[i];
                page.imageData = preprocessedImageDatas[i];
                try {
                    const base64Data = page.imageData.split(',')[1];
                    if (base64Data) {
                        const buffer = Buffer.from(base64Data, 'base64');
                        const metadata = await sharp(buffer).metadata();
                        if (metadata.width && metadata.height) {
                            if (page.width !== metadata.width || page.height !== metadata.height) {
                                console.log(`📐 [DIMENSIONS] Refreshed Page ${page.pageIndex} dimensions after preprocessing: ${page.width}x${page.height} -> ${metadata.width}x${metadata.height}`);
                                page.width = metadata.width;
                                page.height = metadata.height;
                            }

                        }
                    }
                } catch (err) {
                    console.warn(`[DIMENSIONS] Failed to refresh dimensions for page ${page.pageIndex}:`, err);
                }
            }

            progressCallback(createProgressData(2, 'Image preprocessing complete.', MULTI_IMAGE_STEPS));
            logPreprocessingComplete();

            // ========================= START: IMPLEMENT STAGE 2 =========================
            // --- Stage 2: Parallel OCR/Classify (Common for Multi-Page PDF & Multi-Image) ---
            progressCallback(createProgressData(3, `Running OCR & Classification on ${standardizedPages.length} pages...`, MULTI_IMAGE_STEPS));

            // --- Perform Classification on ALL Images (Question & Student Work) ---
            const logClassificationComplete = logStep('Classification', actualModel);


            // Classify ALL images at once for better cross-page context (solves continuation page question number detection)
            let allClassificationResults = await ClassificationService.classifyMultipleImages(
                standardizedPages,
                actualModel as ModelType,  // Cast to ModelType
                debugClassification,  // debug (controlled by ENV)
                usageTracker  // Pass tracker for auto-recording
            );

            logClassificationComplete();

            // ========================= CATEGORY OVERRIDE (BEFORE SPLIT) =========================
            // [REMOVED] Override 1: Drawing-only pages → questionOnly
            // User requested to preserve drawing detection even if text is minimal.
            /*
            const questionAnswerPages = allClassificationResults.filter(r => r.result?.category === 'questionAnswer');
            if (questionAnswerPages.length > 0) {
                const allWorkIsDrawingsOnly = questionAnswerPages.every(r => {
                    const questions = r.result?.questions || [];
                    return questions.every((q: any) => {
                        const hasDrawing = q.hasStudentDrawing === true;
                        // Summarize all work lines (top-level + sub-questions)
                        const workLines = [
                            ...(q.studentWorkLines || []),
                            ...(q.subQuestions?.flatMap((sq: any) => sq.studentWorkLines || []) || [])
                        ];
                        // Only override if there is a drawing but almost zero text work
                        const hasMinimalText = workLines.length < 2;
                        return hasDrawing && hasMinimalText;
                    });
                });

                if (allWorkIsDrawingsOnly) {
                    console.log('📐 [DRAWING OVERRIDE] All student work is drawings only, overriding to questionOnly');
                    questionAnswerPages.forEach(r => {
                        if (r.result) r.result.category = 'questionOnly';
                    });
                }
            }
            */

            // Override 3: 90% Student Work Rule
            // If >= 90% of the document has student work, treat the remaining questionOnly pages as student work too
            // (Likely a neat drawing or subtle work the AI missed)
            const nonMetadataPages = allClassificationResults.filter(r => r.result?.category !== 'metadata' && r.result?.category !== 'frontPage');
            const studentWorkPages = nonMetadataPages.filter(r => r.result?.category === 'questionAnswer');

            if (nonMetadataPages.length > 5 && (studentWorkPages.length / nonMetadataPages.length) >= 0.9) {
                console.log(`🚀 [OVERRIDE] 90% Rule Triggered: ${studentWorkPages.length}/${nonMetadataPages.length} pages have student work. Overriding all questionOnly pages to questionAnswer for consistency.`);
                allClassificationResults.forEach(r => {
                    if (r.result?.category === 'questionOnly') {
                        r.result.category = 'questionAnswer';
                    }
                });
            } else if (nonMetadataPages.length > 2 && (studentWorkPages.length / nonMetadataPages.length) > 0.5) {
                // NEW: 50% Safety Rule
                console.log(`🚀 [OVERRIDE] 50% Rule Triggered: ${studentWorkPages.length}/${nonMetadataPages.length} pages have student work. Overriding all questionOnly pages to questionAnswer for consistency.`);
                allClassificationResults.forEach(r => {
                    if (r.result?.category === 'questionOnly') {
                        r.result.category = 'questionAnswer';
                    }
                });
            }

            // Override 2: FrontPage → questionOnly when no actual student work exists
            const hasActualStudentWork = allClassificationResults.some(r => r.result?.category === 'questionAnswer');
            const hasFrontPages = allClassificationResults.some(r => r.result?.category === 'frontPage');

            if (!hasActualStudentWork && hasFrontPages) {
                console.log('📄 [FRONTPAGE OVERRIDE] No student work detected, converting frontPages to questionOnly for text-only response');
                allClassificationResults.forEach(r => {
                    if (r.result?.category === 'frontPage') {
                        r.result.category = 'questionOnly';
                    }
                });
            }

            // Save original results BEFORE split for mode detection
            const originalClassificationResults = [...allClassificationResults];

            // ========================= PERFECT SPLIT: USE MODE SPLIT SERVICE =========================
            const splitResult = ModeSplitService.splitMixedContent(standardizedPages, allClassificationResults);

            // Extract split structures for later use
            const questionOnlyPages = splitResult.questionOnlyPages;
            const questionOnlyClassificationResults = splitResult.questionOnlyClassificationResults;

            // Use final structures for pipeline
            standardizedPages = splitResult.finalPages;
            allClassificationResults = splitResult.finalClassificationResults;
            //=================================================================================================


            // Combine questions from all images
            // Merge questions with same questionNumber across pages (for multi-page questions like Q21)
            const questionsByNumber = new Map<string, Array<{ question: any; pageIndex: number }>>();
            const questionsWithoutNumber: Array<{ question: any; pageIndex: number }> = [];

            allClassificationResults.forEach(({ pageIndex, result }) => {
                if (result.questions && Array.isArray(result.questions)) {
                    result.questions.forEach((question: any) => {
                        const qNum = question.questionNumber;
                        const individualPageIndex = question.pageIndex !== undefined ? question.pageIndex : pageIndex;

                        // Only merge if questionNumber exists and is not null/undefined
                        if (qNum && qNum !== 'null' && qNum !== 'undefined') {
                            const qNumStr = String(qNum);
                            if (!questionsByNumber.has(qNumStr)) {
                                questionsByNumber.set(qNumStr, []);
                            }
                            questionsByNumber.get(qNumStr)!.push({
                                question,
                                pageIndex: individualPageIndex
                            });
                        } else {
                            // No question number - can't merge, keep as separate entry
                            questionsWithoutNumber.push({
                                question,
                                pageIndex: individualPageIndex
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
                    const page = standardizedPages.find(p => p.pageIndex === pageIndex);
                    allQuestions.push({
                        ...question,
                        sourceImage: page?.originalFileName || 'unknown',
                        sourceImageIndex: pageIndex
                    });
                } else {
                    // Multiple pages with same questionNumber - merge them
                    // Multiple pages with same questionNumber - merge them
                    // Fix: Prioritize finding the BEST text, not just the first one.
                    // "BLANK PAGE" is "valid" text but we want the real question text from the other page (e.g. Page 9 vs Page 4)
                    const sortedInstances = [...questionInstances].sort((a, b) => {
                        const textA = a.question.text || '';
                        const textB = b.question.text || '';

                        // Deprioritize "BLANK PAGE" explicitly
                        const isBlankA = textA.toUpperCase().includes('BLANK PAGE');
                        const isBlankB = textB.toUpperCase().includes('BLANK PAGE');
                        if (isBlankA && !isBlankB) return 1;
                        if (!isBlankA && isBlankB) return -1;

                        // Otherwise prefer longer text
                        return textB.length - textA.length;
                    });

                    const pageWithText = sortedInstances[0];

                    // Combine student work from all pages
                    const combinedStudentWork = questionInstances
                        .map(({ question }) => question.studentWork)
                        .filter(sw => sw && sw !== 'null' && sw.trim().length > 0)
                        .join('\n');

                    // 🛡️ [GLOBAL-ID FIX]: Combine parent-level student work lines from all pages
                    // Every line must keep its original page index
                    const combinedParentLines: any[] = [];
                    questionInstances.forEach(({ question, pageIndex }) => {
                        if (question.studentWorkLines && Array.isArray(question.studentWorkLines)) {
                            question.studentWorkLines.forEach((line: any) => {
                                // Stamp the page index on the line before adding
                                combinedParentLines.push({
                                    ...line,
                                    pageIndex: line.pageIndex !== undefined ? line.pageIndex : pageIndex
                                });
                            });
                        }
                    });

                    // Merge sub-questions if present (group by part, combine student work)
                    // Also track which pages each sub-question came from
                    // Recursive merge helper for sub-questions
                    const mergeSubQuestionsRecursive = (existingMap: Map<string, any>, incomingSubQuestions: any[], pIdx: number) => {
                        incomingSubQuestions.forEach((subQ: any) => {
                            const part = subQ.part || '';
                            subQuestionPageIndices.add(pIdx);

                            if (!existingMap.has(part)) {
                                existingMap.set(part, {
                                    ...subQ,
                                    pageIndex: pIdx,
                                    studentWorkLines: subQ.studentWorkLines || [],
                                    subQuestions: subQ.subQuestions ? [] : undefined
                                });
                            }

                            const existing = existingMap.get(part)!;

                            // Merge Text
                            if (subQ.text && subQ.text !== 'null' && !existing.text) {
                                existing.text = subQ.text;
                            }

                            // Merge Student Work
                            if (subQ.studentWork && subQ.studentWork !== 'null' && subQ.studentWork.trim().length > 0) {
                                if (existing.studentWork && !existing.studentWork.includes(subQ.studentWork)) {
                                    existing.studentWork += '\n' + subQ.studentWork;
                                } else if (!existing.studentWork) {
                                    existing.studentWork = subQ.studentWork;
                                }
                            }

                            // Merge Lines
                            if (subQ.studentWorkLines && Array.isArray(subQ.studentWorkLines)) {
                                // Simple deduplication based on text and position
                                subQ.studentWorkLines.forEach((newLine: any) => {
                                    // Stamp source page index
                                    const stampedLine = {
                                        ...newLine,
                                        pageIndex: newLine.pageIndex !== undefined ? newLine.pageIndex : pIdx
                                    };

                                    const isDuplicate = existing.studentWorkLines.some((l: any) =>
                                        l.text === stampedLine.text &&
                                        l.position?.x === stampedLine.position?.x &&
                                        l.position?.y === stampedLine.position?.y
                                    );
                                    if (!isDuplicate) existing.studentWorkLines.push(stampedLine);
                                });
                            }

                            // Merge Drawing Flag
                            if (subQ.hasStudentDrawing) {
                                existing.hasStudentDrawing = true;
                                if (existing.studentWork && !existing.studentWork.includes('[DRAWING]')) {
                                    existing.studentWork += '\n[DRAWING]';
                                } else if (!existing.studentWork) {
                                    existing.studentWork = '[DRAWING]';
                                }
                            }

                            // RECURSE: Merge children of this sub-question
                            if (subQ.subQuestions && Array.isArray(subQ.subQuestions)) {
                                if (!existing.subQuestionsMap) existing.subQuestionsMap = new Map<string, any>();
                                mergeSubQuestionsRecursive(existing.subQuestionsMap, subQ.subQuestions, pIdx);
                            }
                        });
                    };

                    const finalizeSubQuestions = (subQsMap: Map<string, any>): any[] => {
                        return Array.from(subQsMap.values()).map(subQ => {
                            if (subQ.subQuestionsMap) {
                                subQ.subQuestions = finalizeSubQuestions(subQ.subQuestionsMap);
                                delete subQ.subQuestionsMap;
                            }
                            return subQ;
                        });
                    };

                    const mergedSubQuestionsMap = new Map<string, any>();
                    const subQuestionPageIndices = new Set<number>();

                    questionInstances.forEach(({ question, pageIndex }) => {
                        if (question.subQuestions && Array.isArray(question.subQuestions)) {
                            mergeSubQuestionsRecursive(mergedSubQuestionsMap, question.subQuestions, pageIndex);
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
                        // [GLOBAL-ID FIX]: Include all merged lines with their page indices
                        studentWorkLines: combinedParentLines.length > 0 ? combinedParentLines : (pageWithText.question.studentWorkLines || []),
                        // Use sourceImageIndex from page with text, or first page (for backward compatibility)
                        sourceImage: standardizedPages.find(p => p.pageIndex === pageWithText.pageIndex)?.originalFileName || 'unknown',
                        sourceImageIndex: pageWithText.pageIndex,
                        // Store all page indices this question spans (for multi-page questions)
                        sourceImageIndices: allPageIndices,
                        // Merge sub-questions if present
                        subQuestions: mergedSubQuestionsMap.size > 0
                            ? finalizeSubQuestions(mergedSubQuestionsMap)
                            : pageWithText.question.subQuestions || [],
                        // Use highest confidence
                        confidence: Math.max(...questionInstances.map(({ question }) => question.confidence || 0.9))
                    };


                    allQuestions.push(merged);
                }
            });

            // Add questions without question number (can't be merged)
            questionsWithoutNumber.forEach(({ question, pageIndex }) => {
                const page = standardizedPages.find(p => p.pageIndex === pageIndex);
                allQuestions.push({
                    ...question,
                    sourceImage: page?.originalFileName || 'unknown',
                    sourceImageIndex: pageIndex
                });
            });

            // Sort questions by question number (natural sort for numbers like 1, 2, 3, 10, 11)
            allQuestions.sort((a, b) => {
                const numA = parseInt(a.questionNumber) || 0;
                const numB = parseInt(b.questionNumber) || 0;
                return numA - numB;
            });

            // Create combined classification result with enhanced mixed content detection
            // TRUST stage-2 results (and overrides) over stage-1 mapper
            const hasAnyStudentWork = allClassificationResults.some(r => r.result?.category === "questionAnswer");
            const hasMixedContent = allClassificationResults.some(r => r.result?.category !== allClassificationResults[0]?.result?.category);

            // Determine combined category using stage-2 results
            const allCategories = allClassificationResults.map(r => r.result?.category).filter(Boolean);
            const combinedCategory: "questionOnly" | "questionAnswer" | "metadata" =
                allCategories.every(cat => cat === "questionOnly") ? "questionOnly" :
                    allCategories.every(cat => cat === "metadata" || cat === "frontPage") ? "metadata" :
                        "questionAnswer";

            let classificationResult = {
                category: combinedCategory,
                reasoning: allClassificationResults[0]?.result?.reasoning || 'Multi-image classification',
                questions: allQuestions,
                text: (allClassificationResults[0]?.result?.questions && allClassificationResults[0]?.result?.questions[0]) ? allClassificationResults[0]?.result?.questions[0].text : (allClassificationResults[0]?.result?.extractedQuestionText || allClassificationResults[0]?.result?.text || ''),
                apiUsed: allClassificationResults[0]?.result?.apiUsed || 'Unknown',
                usageTokens: allClassificationResults.reduce((sum, { result }) => sum + (result.usageTokens || 0), 0),
                hasMixedContent: hasMixedContent,
                hasAnyStudentWork: hasAnyStudentWork
            };

            // Add classification tokens to total usage
            if (classificationResult.usageTokens) {
                totalLLMTokens += classificationResult.usageTokens;
                // Note: Tokens already recorded by ClassificationMapper.mapQuestionsToPages()
            }

            // For question mode, use the questions array; for marking mode, use extractedQuestionText
            const globalQuestionText = classificationResult?.questions && classificationResult.questions.length > 0
                ? classificationResult.questions[0].text
                : '';


            logClassificationComplete();

            // ========================= AUTO-ROTATION =========================
            // Check for rotation detected by AI and correct the image
            // This ensures OCR and Annotation work on the upright image
            const rotationPromises = allClassificationResults.map(async ({ pageIndex, result }, index) => {
                // Handle Rotation (90deg, -90deg, 180deg)
                const rotation = result.rotation;
                if (rotation && typeof rotation === 'number' && rotation !== 0) {
                    const page = standardizedPages.find(p => p.pageIndex === pageIndex);
                    if (!page) {
                        console.warn(`⚠️ [ROTATION] Could not find page for index ${pageIndex}, skipping rotation.`);
                        return;
                    }
                    console.log(`🔄 [ROTATION] Page ${pageIndex + 1} (${page.originalFileName}) detected rotation: ${rotation}°`);
                    try {
                        const rotatedBuffer = await ImageUtils.rotateImage(page.imageData, rotation);
                        page.imageData = `data:image/png;base64,${rotatedBuffer.toString('base64')}`;

                        // Swap dimensions if 90 or 270
                        if (rotation === 90 || rotation === 270) {
                            const temp = page.width;
                            page.width = page.height;
                            page.height = temp;
                        }
                        console.log(`✅ [ROTATION] Page ${pageIndex + 1} rotated successfully.`);
                    } catch (rotError) {
                        console.error(`❌ [ROTATION] Failed to rotate page ${pageIndex + 1}:`, rotError);
                    }
                }
            });
            await Promise.all(rotationPromises);

            // ========================= MARK METADATA PAGES =========================
            // Log metadata pages (they will skip OCR processing)
            allClassificationResults.forEach(({ pageIndex, result }, index) => {
                const isMetadataPage = result.category === "metadata";

                if (isMetadataPage) {
                    const fileName = standardizedPages.find(p => p.pageIndex === pageIndex)?.originalFileName || 'unknown';
                }
            });

            // ========================= ENHANCED MODE DETECTION =========================
            // Check ORIGINAL results (before split), not filtered marking-only results
            const hasStudentWorkPages = originalClassificationResults.some(r => r.result?.category === 'questionAnswer');
            const hasQuestionOnlyPages = originalClassificationResults.every(r =>
                r.result?.category === 'questionOnly' ||
                r.result?.category === 'frontPage' ||
                r.result?.category === 'metadata'
            );
            const isQuestionMode = hasQuestionOnlyPages && originalClassificationResults.length > 0 && !hasStudentWorkPages;
            const isMixedContent = hasStudentWorkPages && questionOnlyPages.length > 0;

            console.log(`🔍 [MODE DETECTION] Analysis (AFTER overrides):`);
            console.log(`  - All question-only: ${isQuestionMode}`);
            console.log(`  - Has mixed content: ${isMixedContent}`);
            console.log(`  - Has any student work: ${hasStudentWorkPages}`);
            console.log(`  - Selected mode: ${isQuestionMode ? 'Question Mode' : 'Marking Mode'}`);

            if (isQuestionMode) {
                // ========================= ENHANCED QUESTION MODE =========================
                // Question mode: Handle multiple question-only images with detailed responses
                questionOnlyResult = await QuestionModeHandlerService.handleQuestionMode({
                    classificationResult,
                    standardizedPages,
                    files,
                    actualModel,
                    userId: options.userId || 'anonymous',
                    submissionId,
                    req: req,
                    res: {
                        write: (data: string) => {
                            // Parse SSE data and call progressCallback
                            if (data.startsWith('data: ')) {
                                try {
                                    const jsonStr = data.substring(6);
                                    const parsed = JSON.parse(jsonStr);
                                    progressCallback(parsed);
                                } catch (e) {
                                    // Ignore parse errors for keep-alive or non-json
                                }
                            }
                        },
                        end: () => { }
                    } as any,
                    startTime,
                    logStep,
                    usageTracker
                });

                // CRITICAL FIX: Return result with sessionId for credit deduction
                const pureQuestionResult = {
                    mode: 'Question',
                    sessionId: questionOnlyResult?.sessionId,
                    unifiedSession: questionOnlyResult?.unifiedSession,
                    message: questionOnlyResult?.message,
                    annotatedOutput: [],
                    results: []
                };
                // console.log(`\n🔍 [RETURN DEBUG] Pure Question Mode - Returning:`);
                console.log(`   - sessionId: ${pureQuestionResult.sessionId}`);
                console.log(`   - hasUnifiedSession: ${!!pureQuestionResult.unifiedSession}`);
                console.log(`   - result object exists: true\n`);
                return pureQuestionResult;
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
                // Skip OCR for metadata and frontPage (to save Mathpix costs)
                const classificationResult = allClassificationResults[index]?.result;
                const isMetadataPage = classificationResult?.category === "metadata";
                const isFrontPage = classificationResult?.category === "frontPage";


                const ocrResult = await OCRService.processImage(
                    page.imageData, { pageIndex: page.pageIndex }, false, 'auto',
                    { extractedQuestionText: globalQuestionText },
                    usageTracker // Pass tracker here
                );
                return {
                    pageIndex: page.pageIndex,
                    ocrData: ocrResult,
                    classificationText: globalQuestionText
                };
            });

            allPagesOcrData = await Promise.all(pageProcessingPromises);



            // [DEBUG] Verify Data Integrity immediately after OCR
            if (allPagesOcrData.length > 1) {
                const page1Data = allPagesOcrData[1]?.ocrData;
                if (page1Data?.mathBlocks?.length) {
                    // NOTE: OCR 'isHandwritten' flags are unreliable. 
                    // We pass all blocks to ensure no data loss and let AI determine context.
                    const sample = page1Data.mathBlocks.find(b => (b as any).isHandwritten || !b.isPrinted) || page1Data.mathBlocks[0];
                    /*
                    console.log(`[PIPELINE DEBUG] Page 1 OCR Data Check:`);
                    console.log(`   - Total Blocks: ${page1Data.mathBlocks.length}`);
                    console.log(`   - Sample HW Block Check:`, JSON.stringify({
                        text: (sample.mathpixLatex || sample.googleVisionText || '').substring(0, 20),
                        hasCoords: !!sample.coordinates,
                        coords: sample.coordinates
                    }));
                    */
                } else {
                    // console.log(`[PIPELINE DEBUG] Page 1 OCR Data has NO mathBlocks!`);
                }
            }

            // Aggregate Mathpix calls from OCR results
            // Mathpix calls are now automatically tracked by UsageTracker via recordMathpix()
            // No need to manually sum totalMathpixCalls

            logOcrComplete();
            progressCallback(createProgressData(3, 'OCR & Classification complete.', MULTI_IMAGE_STEPS));
            // ========================== END: IMPLEMENT STAGE 2 ==========================

            // ========================= START: ADD QUESTION DETECTION STAGE =========================
            progressCallback(createProgressData(4, 'Detecting questions and fetching schemes...', MULTI_IMAGE_STEPS));

            // Extract questions from AI classification result
            // Extract questions from AI classification result
            const individualQuestions = extractQuestionsFromClassification(classificationResult, standardizedPages[0]?.originalFileName);

            // Call question detection for each individual question
            const logQuestionDetectionComplete = logStep('Question Detection', 'question-detection');

            // Collect full OCR text for reliable metadata extraction (e.g. Total Marks)
            const extractedOcrText = allPagesOcrData.map((p: any) => p.ocrData.text).join('\n\n');

            // Orchestrate marking scheme lookup (detection, grouping, merging)
            const orchestrationResult = await MarkingSchemeOrchestrationService.orchestrateMarkingSchemeLookup(
                individualQuestions,
                classificationResult,
                options.customText,
                inputMarkingScheme
            );

            const markingSchemesMap = orchestrationResult.markingSchemesMap;
            const detectionResults = orchestrationResult.detectionResults;
            const detectionStats = orchestrationResult.detectionStats;
            classificationResult = orchestrationResult.updatedClassificationResult;
            // ^^^ This object now holds the DB-verified Question Numbers

            // 📊 [LOGGING] Print Detection Statistics BEFORE re-indexing starts
            MarkingSchemeOrchestrationService.logDetectionStatistics(detectionStats, detectionResults);
            logQuestionDetectionComplete(); // End the overall Question Detection timer

            // ========================= 🔄 [INTELLIGENCE RE-INDEXING - V2] =========================
            // CRITICAL ARCHITECTURE FIX: Re-sort pages using DB-VERIFIED Ground Truth.
            // This happens AFTER Stage 3, so we trust the Question Numbers implicitly.

            console.log(`\n🔄 [RE-INDEXING] 🛡️ Aligning physical pages...`);

            // 🔍 [RE-INDEX PROBE]: Verify pointer sync integrity
            classificationResult.questions.forEach((q: any) => {
                if (q.questionNumber === '11' || q.questionNumber === '1' || q.questionNumber?.startsWith('11')) {
                    console.log(`🕵️ [PROBE] Q${q.questionNumber} | sourceImageIndex: ${q.sourceImageIndex} | text: ${q.text?.substring(0, 30)}...`);
                }
            });

            // 1. Map pages to their Lowest VERIFIED Question Number (Sub-Question Aware)
            // 🛡️ [MULTI-ANCHOR REUSE]: We check sourceImageIndices (plural) to see if a page belongs to a question.
            // This preserves the existing logic for questions spanning multiple pages (like Q11 on P0/P23).
            const pageSortMap = standardizedPages.map((page, originalIdx) => {
                const physicalPageIndex = page.pageIndex;

                let minSortWeight = Infinity;
                const debugQList: string[] = [];

                // 🏗️ TRUTH-FIRST: Look at database-verified questions and their SUB-QUENCES
                const pageWeights: { q: string, w: number }[] = [];
                const checkWeightRecursive = (node: any, parentQNum: string = '') => {
                    const currentQNum = node.questionNumber || node.part || '';
                    // Build full context (e.g. "11" + "c" = "11c")
                    let qNumContext = parentQNum;
                    if (currentQNum) {
                        if (!qNumContext) qNumContext = currentQNum;
                        else if (!qNumContext.endsWith(currentQNum) && !currentQNum.startsWith(qNumContext)) {
                            // Only append if it looks like a sub-part (not a repetition)
                            if (/^[a-z(]/.test(currentQNum)) qNumContext += currentQNum;
                            else qNumContext = currentQNum;
                        }
                    }

                    // Check if this specific node (Question or Sub-Question) is on this page
                    const indices = node.sourceImageIndices || (node.sourceImageIndex !== undefined ? [node.sourceImageIndex] : []);
                    const pageIndexOnNode = node.pageIndex !== undefined ? [node.pageIndex] : [];
                    const allIndicesOnNode = [...new Set([...indices, ...pageIndexOnNode])];

                    if (allIndicesOnNode.includes(physicalPageIndex)) {
                        if (qNumContext) {
                            debugQList.push(qNumContext);
                            const weight = getQuestionSortValue(qNumContext);
                            pageWeights.push({ q: qNumContext, w: weight });
                        }
                    }

                    // Recurse into sub-questions to find the earliest part on this page
                    if (node.subQuestions && Array.isArray(node.subQuestions)) {
                        node.subQuestions.forEach((sub: any) => checkWeightRecursive(sub, qNumContext));
                    }
                };

                classificationResult.questions.forEach((q: any) => checkWeightRecursive(q));

                // 🛡️ [SPECIFICITY PRIORITY]: Solve ties like Q11 on both pages.
                if (pageWeights.length > 0) {
                    const getPrecision = (n: number) => String(n).includes('.') ? String(n).split('.')[1].length : 0;
                    const maxPrecision = Math.max(...pageWeights.map(pw => getPrecision(pw.w)));
                    const specificWeights = pageWeights.filter(pw => getPrecision(pw.w) === maxPrecision);
                    minSortWeight = Math.min(...specificWeights.map(pw => pw.w));

                    // 🔍 DEBUG: Log the decision
                    console.log(`   ⚖️ [PAGE-WEIGHT] Page ${originalIdx}: Weights=[${pageWeights.map(pw => `${pw.q}:${pw.w}`).join(', ')}] -> Selected: ${minSortWeight}`);
                }

                // Fallback for Meta/Front Pages
                const rawResult = allClassificationResults[originalIdx]?.result;
                const isMeta = rawResult?.category === 'metadata' || rawResult?.category === 'frontPage';

                return {
                    originalIdx,
                    filename: page.originalFileName,
                    minQ: minSortWeight === Infinity ? 999999 : minSortWeight,
                    isMeta,
                    debugQ: [...new Set(debugQList)].join(', ')
                };
            });

            // 🔍 [DEBUG-PROBE] Dump the Sorting Decision Matrix
            console.log('🔍 [RE-INDEX DEBUG] Sorting Decision Matrix:');
            console.log('-----------------------------------------------------------------------------------------');
            console.log('| OrigIdx | Filename             | IsMeta | MinQ   | Detected Qs                        |');
            console.log('-----------------------------------------------------------------------------------------');
            pageSortMap.forEach(p => {
                const fName = p.filename.padEnd(20).slice(0, 20);
                const qList = p.debugQ.padEnd(34).slice(0, 34);
                console.log(`| ${String(p.originalIdx).padEnd(7)} | ${fName} | ${String(p.isMeta).padEnd(6)} | ${String(p.minQ).padEnd(6)} | ${qList} |`);
            });
            console.log('-----------------------------------------------------------------------------------------');

            // 1.5 PAST PAPER MODE: STRICT FAIL-FAST (Bible 1.1)
            const isPastPaper = Array.from(markingSchemesMap.values()).some(m => !m.isGeneric);
            if (isPastPaper) {
                // Identify "Lone Ghosts" (Pages with no Q-number that weren't backfilled)
                const fatalErrors = pageSortMap.filter(p => !p.isMeta && p.minQ === 999999);

                if (fatalErrors.length > 0) {
                    // HALT ON SILENCE (Bible 1.1)
                    // We do NOT fall back to upload order. We crash to protect data integrity.
                    const err = `[DETECTION INTEGRITY FAILURE] Pages ${fatalErrors.map(p => p.originalIdx).join(', ')} could not be identified or backfilled. Halting process to prevent scrambled data.`;
                    console.error(`❌ ${err}`);
                    throw new Error(err);
                }
            }

            // 2. LOGICAL SORT (The Straightener) - [RESTORED]
            // This ensures that the PDF is "straightened" into numerical order regardless of upload sequence.
            pageSortMap.sort((a, b) => {
                // Rule 1: Metadata First
                if (a.isMeta && !b.isMeta) return -1;
                if (!a.isMeta && b.isMeta) return 1;

                // Rule 2: Logical Question Order
                if (Math.abs(a.minQ - b.minQ) > 0.00001) {
                    return a.minQ - b.minQ;
                }

                // Rule 3: Physical Tie-breaker (Original Upload Order)
                return a.originalIdx - b.originalIdx;
            });

            console.log(`\n🚀 [SORT-RESULT] Final Logical Order:`);
            console.log('-----------------------------------------------------------------------------------------');
            pageSortMap.forEach((p, i) => {
                console.log(`| Seq ${i} | OrigIdx ${p.originalIdx} | isMeta: ${p.isMeta} | minQ: ${p.minQ} |`);
            });
            console.log('-----------------------------------------------------------------------------------------');

            // 3. Create Index Lookups
            const oldToNewIndex = new Map<number, number>();
            const newToOldIndex = new Map<number, number>();
            pageSortMap.forEach((item, newIdx) => {
                oldToNewIndex.set(item.originalIdx, newIdx);
                newToOldIndex.set(newIdx, item.originalIdx);
            });

            // 4. Re-build Arrays
            const reindexedStandardPages: StandardizedPage[] = [];
            const reindexedOcrData: any[] = [];
            const reindexedClassificationResults: any[] = [];

            for (let newIdx = 0; newIdx < pageSortMap.length; newIdx++) {
                const oldIdx = newToOldIndex.get(newIdx)!;

                const page = standardizedPages[oldIdx];
                const ocr = allPagesOcrData[oldIdx];
                const cls = allClassificationResults[oldIdx];

                // CRITICAL: Update the ID itself
                page.pageIndex = newIdx;
                if (ocr) ocr.pageIndex = newIdx;
                if (cls) cls.pageIndex = newIdx;

                reindexedStandardPages.push(page);
                if (ocr) reindexedOcrData.push(ocr);
                if (cls) reindexedClassificationResults.push(cls);
            }

            // 5. UPDATE GLOBAL REFERENCES
            standardizedPages = reindexedStandardPages;
            allPagesOcrData = reindexedOcrData;
            allClassificationResults = reindexedClassificationResults;

            console.log(`✅ [RE-INDEXING] Completed. Pages have been straightened into Logical Order.`);

            // 5. CRITICAL: Update Classification Result Indices to match New Integrity (DEEP FIX)
            // We must update questions, sub-questions, AND studentWorkLines to match the new Physical Index.
            // If we don't, the Zone Detector looks at Page 5 but ignores lines tagged as "Page 1".

            // Create a lookup: OriginalIdx -> NewIdx
            const originalToNewIndexMap = new Map<number, number>();
            pageSortMap.forEach((p, newIdx) => {
                originalToNewIndexMap.set(p.originalIdx, newIdx);
            });

            if (classificationResult && classificationResult.questions) {
                const updateNodeIndices = (node: any) => {
                    // Update Page Index if present
                    if (node.pageIndex !== undefined) {
                        node.pageIndex = originalToNewIndexMap.get(node.pageIndex) ?? node.pageIndex;
                    }

                    // Update Source Image Index (Legacy)
                    if (node.sourceImageIndex !== undefined) {
                        node.sourceImageIndex = originalToNewIndexMap.get(node.sourceImageIndex) ?? node.sourceImageIndex;
                    }

                    // Update Array of Indices
                    if (node.sourceImageIndices && Array.isArray(node.sourceImageIndices)) {
                        node.sourceImageIndices = node.sourceImageIndices
                            .map((idx: number) => originalToNewIndexMap.get(idx) ?? idx)
                            .sort((a, b) => a - b);
                    }

                    // CRITICAL: Update Student Work Lines
                    if (node.studentWorkLines && Array.isArray(node.studentWorkLines)) {
                        node.studentWorkLines.forEach((line: any) => {
                            if (line.pageIndex !== undefined) {
                                const newPageIdx = originalToNewIndexMap.get(line.pageIndex) ?? line.pageIndex;
                                line.pageIndex = newPageIdx;

                                // 2. REWRITE THE ID STRING
                                // We must change "p3_q1_line_1" to "p5_q1_line_1"
                                // Otherwise, the detector parses "p3" and discards it.
                                if (line.id && typeof line.id === 'string') {
                                    // Regex to replace p{Number}_ with p{NewNumber}_
                                    const oldId = line.id;
                                    line.id = line.id.replace(/^p\d+_/, `p${newPageIdx}_`);

                                    // 🔍 DEBUG: Log the rewrite for the first few lines to prove it works
                                    if (line.id !== oldId && Math.random() < 0.05) {
                                        console.log(`   🔧 [ID-REWRITE] ${oldId} -> ${line.id}`);
                                    }
                                }
                                if (line.globalBlockId) {
                                    line.globalBlockId = line.globalBlockId.replace(/^p\d+_/, `p${newPageIdx}_`);
                                }
                            }
                        });
                    }

                    // Recurse into SubQuestions
                    if (node.subQuestions && Array.isArray(node.subQuestions)) {
                        node.subQuestions.forEach(updateNodeIndices);
                    }
                };

                classificationResult.questions.forEach(updateNodeIndices);
            }

            // Also update allClassificationResults for consistency
            allClassificationResults.forEach(r => {
                if (r.pageIndex !== undefined) {
                    r.pageIndex = originalToNewIndexMap.get(r.pageIndex) ?? r.pageIndex;
                }
            });
            console.log(`✅ [RE-INDEXING] Deep Pointer Update Complete. Lines now point to new physical pages.`);

            // ========================= 7. REGENERATE OCR BLOCK IDs =========================
            // CRITICAL FIX: The OCR blocks still carry IDs from their original page index (e.g. "p8_ocr_1").
            // Since we moved the page to a new index (e.g. 10), we must rename the blocks to "p10_ocr_1".
            // Otherwise, the Zone Detector thinks these blocks belong to a different page and discards them.

            console.log(`\n🔄 [OCR RE-ID] Regenerating Global Block IDs to match new Page Indices...`);

            allPagesOcrData.forEach(page => {
                const newPageIndex = page.pageIndex; // This is already updated by the sort loop
                let blockCounter = 1;

                // 1. Update Math Blocks
                if (page.ocrData?.mathBlocks) {
                    page.ocrData.mathBlocks.forEach((b: any) => {
                        // Generate new ID: p{NewIndex}_ocr_{Seq}
                        const newId = `p${newPageIndex}_ocr_${blockCounter++}`;

                        // Preserve the old ID in metadata if needed for debugging, but update the main ID
                        if (!b.metadata) b.metadata = {};
                        b.metadata.originalBlockId = b.globalBlockId || b.id;

                        b.globalBlockId = newId;
                        b.id = newId; // Ensure legacy ID field is also updated
                    });
                }

                // 2. Update Standard Blocks (if they exist)
                if (page.ocrData?.blocks) {
                    page.ocrData.blocks.forEach((b: any) => {
                        const newId = `p${newPageIndex}_ocr_${blockCounter++}`;
                        b.globalBlockId = newId;
                        b.id = newId;
                    });
                }
            });
            console.log(`✅ [OCR RE-ID] Completed. Blocks are now synchronized with physical pages.`);

            // ========================= 8. REBUILD DIMENSIONS MAP =========================
            // CRITICAL FIX: The pageDimensionsMap was built BEFORE re-indexing. 
            // Now that pages have swapped indices, the old map keys point to the wrong physical page dimensions.
            // We must rebuild it to ensure coordinate calculations use the correct width/height for the new page order.

            pageDimensionsMap.clear(); // Clear old stale data
            standardizedPages.forEach((page) => {
                if (page.width && page.height && page.pageIndex != null) {
                    pageDimensionsMap.set(page.pageIndex, { width: page.width, height: page.height });
                }
            });
            console.log(`✅ [DIMENSIONS REBUILD] Map refreshed for ${pageDimensionsMap.size} re-indexed pages.`);
            // =============================================================================
            // ===============================================================================
            // =====================================================================================

            // NEW: Extract dominant paper hint for consistent detection in mixed mode
            let dominantPaperHint: string | null = null;
            const paperCounts = new Map<string, number>();
            detectionResults.forEach(res => {
                if (res.detectionResult?.found && res.detectionResult?.match?.paperTitle) {
                    const title = res.detectionResult.match.paperTitle;
                    paperCounts.set(title, (paperCounts.get(title) || 0) + 1);
                }
            });

            let maxCount = 0;
            paperCounts.forEach((count, title) => {
                if (count > maxCount) {
                    maxCount = count;
                    dominantPaperHint = title;
                }
            });

            if (dominantPaperHint) {
                // console.log(`📍 [PIPELINE] Detected consensus paper: "${dominantPaperHint}". Will use as hint for question-only pages.`);
            }

            logQuestionDetectionComplete();

            logQuestionDetectionComplete();

            // [LOG MOVED] Detection statistics are now logged BEFORE re-indexing for better clarity.

            // Warn if suspected missing paper in database
            const detectionRate = detectionStats.totalQuestions > 0
                ? (detectionStats.detected / detectionStats.totalQuestions) * 100
                : 0;
            if (detectionRate < 20 && detectionStats.totalQuestions > 5) {
                console.log(`\n⚠️  \x1b[33m[WARNING] Suspected Missing Exam Paper in Database\x1b[0m`);
                console.log(`   Detection rate is very low (${detectionRate.toFixed(0)}%).`);
                console.log(`   This usually indicates that the exam paper is not in the database.`);
                console.log(`   Please verify that the correct paper is uploaded to Firestore.\n`);
            }

            // 🔍 DEBUG PROBE for Merge Mismatch
            allPagesOcrData.forEach(page => {
                const matches = allClassificationResults.filter(r => r.pageIndex === page.pageIndex);
                if (matches.length === 0) {
                    console.error(`❌ [ZONE CRITICAL] Merge Mismatch! OCR Page ${page.pageIndex} has NO matching Classification Result.`);
                    console.log(`   - OCR Index: ${page.pageIndex}`);
                    console.log(`   - Available Class Indices: ${allClassificationResults.map(c => c.pageIndex).join(', ')}`);
                } else {
                    // console.log(`✅ [ZONE OK] Page ${page.pageIndex} merged with ${matches.length} classification results.`);
                }
            });

            progressCallback(createProgressData(4, `Detected ${markingSchemesMap.size} question scheme(s).`, MULTI_IMAGE_STEPS));
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

                        const pageForDrawing = standardizedPages.find(p => p.pageIndex === pageIndex);
                        if (hasDrawingsInQuestion && pageForDrawing) {
                            // Pass image data to Marking AI
                            (q as any).imageDataForMarking = pageForDrawing.imageData;
                        }
                    });
                }
            });

            // ========================= START: ENHANCE DRAWINGS =========================
            // Drawing Enhancement Service removed as per new design (AI Marking provides coordinates)
            // ========================== END: ENHANCE DRAWINGS ==========================

            // ========================= START: IMPLEMENT STAGE 3 =========================
            // --- Stage 3: Create Marking Tasks Directly from Classification (Bypass Segmentation) ---
            progressCallback(createProgressData(5, 'Preparing marking tasks...', MULTI_IMAGE_STEPS));


            // Create page dimensions map from standardizedPages for accurate drawing position calculation
            console.log(`🔍 [DIMENSIONS DEBUG] Pages: ${standardizedPages.length}`);
            // pageDimensionsMap is already declared and populated above after re-indexing.
            // We just log it here for confirmation.
            /* 
            standardizedPages.forEach((page) => {
                if (page.width && page.height && page.pageIndex != null) {
                    pageDimensionsMap.set(page.pageIndex, { width: page.width, height: page.height });
                } else {
                    console.error(`❌ [ZONE FATAL] Page ${page.pageIndex} (${page.originalFileName}) is MISSING from Dimensions Map! Width: ${page.width}, Height: ${page.height}`);
                }
            });
            */
            console.log(`🔍 [DIMENSIONS DEBUG] Map Size: ${pageDimensionsMap.size}`);

            // Create marking tasks directly from classification results (bypass segmentation)
            try {
                // PATCH: Ensure [DRAWING] token exists in classificationResult if hasStudentDrawing is true
                if (classificationResult && classificationResult.questions && Array.isArray(classificationResult.questions)) {
                    classificationResult.questions.forEach((q: any) => {
                        // Check main question
                        if (q.hasStudentDrawing) {
                            if (q.studentWork) {
                                if (!q.studentWork.includes('[DRAWING]')) {
                                    q.studentWork += '\n[DRAWING]';
                                }
                            } else {
                                q.studentWork = '[DRAWING]';
                            }

                            // Ensure studentWorkLines has a line with [DRAWING]
                            if (!q.studentWorkLines || q.studentWorkLines.length === 0) {
                                q.studentWorkLines = [{ text: '[DRAWING]', confidence: 1.0, pageIndex: q.sourceImageIndex }];
                            } else {
                                // Check if any line has [DRAWING]
                                const hasDrawingLine = q.studentWorkLines.some((l: any) => l.text && l.text.includes('[DRAWING]'));
                                if (!hasDrawingLine) {
                                    q.studentWorkLines.push({ text: '[DRAWING]', confidence: 1.0, pageIndex: q.sourceImageIndex });
                                }
                            }
                        }

                        // Check sub-questions
                        if (q.subQuestions && Array.isArray(q.subQuestions)) {
                            q.subQuestions.forEach((sq: any) => {
                                if (sq.hasStudentDrawing) {
                                    if (sq.studentWork) {
                                        if (!sq.studentWork.includes('[DRAWING]')) {
                                            sq.studentWork += '\n[DRAWING]';
                                        }
                                    } else {
                                        sq.studentWork = '[DRAWING]';
                                    }

                                    // Update lines for sub-question too
                                    if (!sq.studentWorkLines || sq.studentWorkLines.length === 0) {
                                        sq.studentWorkLines = [{ text: '[DRAWING]', confidence: 1.0, pageIndex: sq.pageIndex || q.sourceImageIndex }];
                                    } else {
                                        const hasDrawingLine = sq.studentWorkLines.some((l: any) => l.text && l.text.includes('[DRAWING]'));
                                        if (!hasDrawingLine) {
                                            sq.studentWorkLines.push({ text: '[DRAWING]', confidence: 1.0, pageIndex: sq.pageIndex || q.sourceImageIndex });
                                        }
                                    }
                                }
                            });
                        }
                    });
                }

                // ========================= OCR HANDWRITTEN RE-TAGGING =========================
                // [REMOVED] Superseded by SpatialShieldService's Semantic Tagging
                // The pipeline no longer eagerly re-tags blocks here.
                // ==============================================================================

                // ========================= CLASSIFICATION DATA MERGE =========================
                // CRITICAL: Attach classification results to page objects so logs can find them
                // This enables the "Unified Lookup" for transparency reporting
                allPagesOcrData.forEach(page => {
                    // FIND ALL MATCHES (not just one)
                    const matches = allClassificationResults.filter(r => r.pageIndex === page.pageIndex);

                    if (matches.length > 0) {
                        // Aggregate all questions from all matches
                        const allQuestions = matches.flatMap(m => m.result.questions || []);
                        const uniqueQuestions = [...allQuestions]; // Could add dedup logic if needed, but usually distinct tasks


                        // Construct a merged result
                        (page as any).classificationResult = {
                            questions: uniqueQuestions
                        };
                    }
                });
                // ==============================================================================


                // =====================================================================================

                // ========================= ASSIGN GLOBAL IDs TO OCR BLOCKS =========================
                // Pre-assign stable IDs so MarkingExecutor and Transparency Report match perfectly
                allPagesOcrData.forEach(page => {
                    if (page.ocrData && page.ocrData.mathBlocks) {
                        page.ocrData.mathBlocks.forEach((b: any, idx: number) => {
                            // Format: p{Page}_ocr_{Index}
                            // This ensures that even if MarkingExecutor filters the list, the ID remains stable (e.g. p0_ocr_5)
                            if (!b.globalBlockId) {
                                b.globalBlockId = `p${page.pageIndex}_ocr_${idx + 1}`;
                            }
                        });
                    }
                });
                // ===================================================================================

                markingTasks = createMarkingTasksFromClassification(
                    classificationResult,
                    allPagesOcrData,
                    markingSchemesMap,
                    pageDimensionsMap,
                    standardizedPages,
                    allClassificationResults
                );
            } catch (error) {
                console.error('❌ createMarkingTasksFromClassification failed:', error);
                throw error;
            }

            // Handle case where no student work is found
            if (markingTasks.length === 0) {
                console.log('No marking tasks created, exiting early');
                progressCallback(createProgressData(5, 'No student work found to mark.', MULTI_IMAGE_STEPS));

                // 🛡️ [SESSION-STABILITY]: Ensure we have a sessionId even if no tasks were found
                let finalSessionId = questionOnlyResult?.sessionId || questionOnlyResult?.unifiedSession?.sessionId;
                let finalUnifiedSession = questionOnlyResult?.unifiedSession;

                if (!finalSessionId) {
                    console.log(`📡 [EARLY EXIT] Generating fallback sessionId from submissionId: ${submissionId}`);
                    finalSessionId = submissionId;

                    // Persist an empty marking session so it shows in Library
                    try {
                        const userMessage = createUserMessage({
                            content: 'Uploaded document for marking',
                            pdfContexts: files.map(f => ({ url: f.path, originalFileName: f.originalname, fileSize: f.size }))
                        });
                        const aiMessage = createAIMessage({
                            content: 'No student work was detected on the uploaded pages.'
                        });

                        const markingContext: MarkingSessionContext = {
                            req,
                            submissionId,
                            startTime,
                            userMessage,
                            aiMessage,
                            questionDetection: options.markingScheme,
                            globalQuestionText: options.customText || '',
                            mode: 'Marking',
                            allQuestionResults: [],
                            files,
                            usageTokens: totalLLMTokens,
                            apiRequests: usageTracker.getTotalRequests(),
                            model: actualModel,
                            mathpixCallCount: usageTracker.getMathpixPages(),
                            totalCost: usageTracker.calculateCost(actualModel).total,
                            detectionResults: detectionResults
                        };

                        const sessionResult = await SessionManagementService.persistMarkingSession(markingContext);
                        finalSessionId = sessionResult.sessionId;
                        finalUnifiedSession = sessionResult.unifiedSession;
                        console.log(`✅ [EARLY EXIT] Persisted empty marking session: ${finalSessionId}`);
                    } catch (persistError) {
                        console.error('❌ [EARLY EXIT] Failed to persist empty session:', persistError);
                    }
                }

                const finalOutput = {
                    submissionId, // Pass through submissionId
                    annotatedOutput: [],
                    results: [],
                    mode: isQuestionMode ? 'Question' : 'Marking',
                    unifiedSession: finalUnifiedSession,
                    // Add sessionId for credit deduction
                    sessionId: finalSessionId,
                    // Add sessionStats for usageRecord lookup
                    sessionStats: finalUnifiedSession?.sessionStats || null,
                    processingStats: {
                        totalLLMTokens,
                        mathpixCalls: usageTracker.getMathpixPages()
                    }
                };

                console.log(`   - submissionId: ${finalOutput.submissionId}`);
                console.log(`   - sessionId: ${finalOutput.sessionId}`);
                console.log(`   - result object exists: true\n`);
                return finalOutput; // Exit early
            }
            progressCallback(createProgressData(5, `Prepared ${markingTasks.length} marking task(s).`, MULTI_IMAGE_STEPS));

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
            progressCallback(createProgressData(6, `Marking ${tasksWithSchemes.length} question(s)...`, MULTI_IMAGE_STEPS));
            const logMarkingComplete = logStep('Marking', 'ai-marking');

            // Call the refactored function for each task (works for 1 or many)
            let allQuestionResults: QuestionResult[] = await withPerformanceLogging(
                'AI Marking',
                actualModel,
                async () => {
                    const { PROCESSING_CONSTANTS } = await import('../../config/constants.js');
                    // Implement Worker Pool for Marking (Concurrency Limit: Global)
                    // This prevents "thundering herd" on the API and network saturation
                    const MARKING_CONCURRENCY = PROCESSING_CONSTANTS.CONCURRENCY_LIMIT;
                    const results: QuestionResult[] = [];
                    const queue = [...tasksWithSchemes];
                    let activeWorkers = 0;

                    return new Promise<QuestionResult[]>((resolve, reject) => {
                        const processNext = () => {
                            // Check if we're done
                            if (queue.length === 0 && activeWorkers === 0) {
                                resolve(results);
                                return;
                            }

                            // Start new workers if we have capacity and tasks
                            while (activeWorkers < MARKING_CONCURRENCY && queue.length > 0) {
                                const task = queue.shift();
                                if (task) {
                                    activeWorkers++;
                                    // Mock res for executeMarkingForQuestion if needed, or update it
                                    // executeMarkingForQuestion uses res for SSE updates? No, it uses it for logging?
                                    // Let's check executeMarkingForQuestion signature.
                                    // It takes (task, res, submissionId, model, ocrData, usageTracker)
                                    // We can pass a mock res that forwards to progressCallback
                                    const mockRes = {
                                        write: (data: string) => {
                                            if (data.startsWith('data: ')) {
                                                try {
                                                    const jsonStr = data.substring(6);
                                                    const parsed = JSON.parse(jsonStr);
                                                    progressCallback(parsed);
                                                } catch (e) { }
                                            }
                                        }
                                    } as any;

                                    executeMarkingForQuestion(task, mockRes, submissionId, actualModel as ModelType, allPagesOcrData, usageTracker)
                                        .then(result => {
                                            // [DIAGNOSTIC] Guillotine Trigger Check
                                            const scheme = task.markingScheme;
                                            // FIX: Use authoritative Total Marks from the result (resolved by MarkingInstructionService)
                                            const resultTotal = (result.score && result.score.totalMarks);
                                            // console.log(`[GUILLOTINE CHECK] Q${task.questionNumber}: isGeneric=${scheme?.isGeneric}, hasAnnotations=${!!result.annotations}, hasScore=${!!result.score}, SchemeTotal=${scheme?.totalMarks}, ResultTotal=${resultTotal}`);

                                            // [GUILLOTINE] Hard-Coded Post-Processing for All Questions
                                            // Ensure we strictly respect the budget, especially per sub-question.
                                            if (task.markingScheme && result.annotations && result.score) {
                                                const anyAnnotations = result.annotations as any[];
                                                const subQuestionBudgets = task.markingScheme.subQuestionMaxScores || {};
                                                const totalBudget = result.score.totalMarks || task.markingScheme.totalMarks || 0;

                                                // 1. Group by subQuestion
                                                const groups = new Map<string, any[]>();
                                                anyAnnotations.forEach(a => {
                                                    const rawSq = (a.subQuestion || 'root').toLowerCase();
                                                    const sq = rawSq.replace(/^\d+/, '').replace(/[()\s]/g, '');
                                                    if (!groups.has(sq)) groups.set(sq, []);
                                                    groups.get(sq)!.push(a);
                                                });

                                                let finalizedAnnotations: any[] = [];
                                                const priorityMap: Record<string, number> = { 'A': 3, 'B': 2, 'M': 1 };

                                                // 2. Process each group (Sub-Question Guillotine)
                                                for (const [sq, annos] of groups.entries()) {
                                                    const subBudget = subQuestionBudgets[sq] ?? 99; // Default high if unknown

                                                    // Sort by priority (A > B > M)
                                                    annos.sort((a: any, b: any) => {
                                                        const pA = priorityMap[(a.text || '').charAt(0).toUpperCase()] || 0;
                                                        const pB = priorityMap[(b.text || '').charAt(0).toUpperCase()] || 0;
                                                        return pB - pA;
                                                    });

                                                    const kept: any[] = [];
                                                    let currentSubScore = 0;

                                                    annos.forEach(a => {
                                                        const isAwarded = a.action === 'tick' || a.action === 'mark' || (parseInt((a.text || '').replace(/\D/g, '') || '0') > 0);
                                                        if (!isAwarded) {
                                                            kept.push(a);
                                                            return;
                                                        }

                                                        // Extract value (e.g., B2 is 2 marks)
                                                        // Extract value carefully. Default to 1.
                                                        // Look for "M1", "A2" at start. Avoid "UQ (47)" -> 47.
                                                        const match = (a.text || '').match(/^([A-Za-z]+)(\d+)/);
                                                        let val = 1;
                                                        if (match && match[2]) {
                                                            val = parseInt(match[2]);
                                                        } else {
                                                            // Fallback: If no code found, assume 1 mark if tick/mark
                                                            val = 1;
                                                        }

                                                        if (currentSubScore + val <= subBudget) {
                                                            kept.push(a);
                                                            currentSubScore += val;
                                                        } else if (currentSubScore < subBudget) {
                                                            // Partial credit if applicable, or just cap it
                                                            // For now, we cut the annotation if it would blow the budget
                                                            console.log(`[GUILLOTINE] Q${task.questionNumber}${sq} Cutting mark '${a.text}' to stay within budget ${subBudget}`);
                                                        } else {
                                                            // Budget full
                                                            // console.log(`[GUILLOTINE] Q${task.questionNumber}${sq} Section full. Cutting excess mark: ${a.text}`);
                                                        }
                                                    });

                                                    if (kept.length < annos.length) {
                                                        console.log(`[GUILLOTINE] Q${task.questionNumber}${sq} exceeded budget! Kept ${kept.length}/${annos.length}, Budget ${subBudget}.`);
                                                    }
                                                    finalizedAnnotations.push(...kept);
                                                }

                                                // 3. Final Global Guillotine (just in case sum of subs > total)
                                                const currentTotalTicks = finalizedAnnotations.filter(a => a.action === 'tick' || (parseInt((a.text || '').replace(/\D/g, '') || '0') > 0)).length;
                                                if (totalBudget > 0 && currentTotalTicks > totalBudget) {
                                                    console.log(`[GUILLOTINE] Q${task.questionNumber} GLOBAL exceeded budget! Total ${totalBudget}. Executing final cut...`);
                                                    // Note: This logic is slightly simplified and assumes 1 mark per annotation for global cut
                                                    // For robust multi-mark handling, we'd need to iterate and count values similar to the loop above
                                                    finalizedAnnotations.sort((a, b) => {
                                                        const pA = priorityMap[(a.text || '').charAt(0).toUpperCase()] || 0;
                                                        const pB = priorityMap[(b.text || '').charAt(0).toUpperCase()] || 0;
                                                        return pB - pA;
                                                    });

                                                    let runningGlobal = 0;
                                                    const globalKept: any[] = [];
                                                    finalizedAnnotations.forEach(a => {
                                                        const match = (a.text || '').match(/^([A-Za-z]+)(\d+)/);
                                                        let val = 1;
                                                        if (match && match[2]) {
                                                            val = parseInt(match[2]);
                                                        } else {
                                                            val = 1;
                                                        }
                                                        const isAwarded = a.action === 'tick' || a.action === 'mark' || (parseInt((a.text || '').replace(/\D/g, '') || '0') > 0);
                                                        if (!isAwarded || (runningGlobal + val <= totalBudget)) {
                                                            globalKept.push(a);
                                                            if (isAwarded) runningGlobal += val;
                                                        }
                                                    });
                                                    finalizedAnnotations = globalKept;
                                                }

                                                result.annotations = finalizedAnnotations;

                                                // 4. Recalculate score
                                                // Always recalculate score if we have a budget to ensure consistency
                                                const countsChanged = true;

                                                if (countsChanged) {
                                                    const newAwarded = finalizedAnnotations.reduce((sum: number, a: any) => {
                                                        const isAwardedAction = a.action === 'tick' || a.action === 'mark';
                                                        const text = (a.text || '').trim();

                                                        // ATOMIC MATH FIX: Treat math as 1 mark, avoid "27" error from \sqrt{27}
                                                        const isMath = /[\\{}=\^_\(\)]/.test(text) || text.includes('sqrt') || text.includes('frac');

                                                        let val = 1;
                                                        if (!isMath) {
                                                            const clean = text.replace(/[^a-zA-Z0-9]/g, '');
                                                            if (/^[BMAPC][1-9]\d*$/i.test(clean)) {
                                                                val = parseInt(clean.match(/\d+$/)?.[0] || '1', 10);
                                                            } else {
                                                                // Raw numbers or plain text are 1 mark
                                                                val = 1;
                                                            }
                                                        }

                                                        // Logic: Award if explicit tick AND positive value OR if no action but valid mark code (e.g. M1)
                                                        // This handles both "visual" ticks and "logical" marks from the AI.
                                                        const shouldAward = isAwardedAction || (val > 0 && !a.action);

                                                        if (shouldAward) {
                                                            return sum + val;
                                                        }
                                                        return sum;
                                                    }, 0);

                                                    result.score.awardedMarks = newAwarded;
                                                    result.score.scoreText = `${newAwarded}/${result.score.totalMarks}`;
                                                }

                                                if (finalizedAnnotations.length < anyAnnotations.length && result.feedback) {
                                                    result.feedback += ` (Note: ${anyAnnotations.length - finalizedAnnotations.length} excess marks removed to fit budget)`;
                                                }
                                            }

                                            // Attach scheme to result for persistence
                                            if (result.cleanedOcrText) {
                                                // Already attached by service if it returns it
                                            }

                                            // FIX: Explicitly attach student work for Context Chat
                                            // ChatContextBuilder expects result.studentWork or result.classificationBlocks with text

                                            // DEBUG TRACE: Check if data is even present in the task
                                            if (['15'].includes(String(task.questionNumber))) {
                                                // console.log(`🔍 [DEBUG PIPELINE Q${task.questionNumber}] Student Work Trace:`);
                                                // console.log(`   - task.classificationStudentWork: ${task.classificationStudentWork ? task.classificationStudentWork.length + ' chars' : 'MISSING'}`);
                                                // console.log(`   - task.formattedOcrText: ${task.formattedOcrText ? 'PRESENT' : 'MISSING'}`);
                                                // console.log(`   - task.classificationBlocks: ${task.classificationBlocks ? task.classificationBlocks.length + ' blocks' : 'MISSING'}`);
                                            }

                                            if (!result.studentWork) {
                                                result.studentWork = task.classificationStudentWork || task.formattedOcrText || '';
                                            }
                                            // Also attach classification blocks if missing, as they contain precise line data
                                            if (!result.classificationBlocks && task.classificationBlocks) {
                                                result.classificationBlocks = task.classificationBlocks;
                                            }

                                            // Attach original question text from detection if available (for Context Chat)
                                            if (task.questionText && !result.questionText) {
                                                result.questionText = task.questionText;
                                            }
                                            if (task.databaseQuestionText && !result.databaseQuestionText) {
                                                result.databaseQuestionText = task.databaseQuestionText;
                                            }

                                            results.push(result);
                                        })
                                        .catch(error => {
                                            console.error(`❌ Worker failed for Q${task.questionNumber}:`, error);
                                            // Don't reject the whole batch, just log and continue (maybe push a failed result?)
                                            // For now, we'll just let it be missing from results, or we could push a dummy error result
                                        })
                                        .finally(() => {
                                            activeWorkers--;
                                            processNext();
                                        });
                                }
                            }
                        };

                        // Kick off the first batch
                        processNext();
                    });
                }
            );

            // FIX: Sort results by question number to ensure consistent order (e.g., Q12 before Q13)
            // The worker pool completes tasks in random order, so we must sort explicitly.
            allQuestionResults.sort((a, b) => {
                const qA = String(a.questionNumber);
                const qB = String(b.questionNumber);

                // Extract numeric parts for comparison
                const numA = parseFloat(qA.replace(/[^\d.]/g, ''));
                const numB = parseFloat(qB.replace(/[^\d.]/g, ''));

                if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
                    return numA - numB;
                }

                // Fallback to alphanumeric
                return qA.localeCompare(qB, undefined, { numeric: true, sensitivity: 'base' });
            });

            // Aggregate usage stats from marking results
            if (allQuestionResults) {

                allQuestionResults.forEach(qr => {
                    if (qr.usageTokens) {
                        totalLLMTokens += qr.usageTokens;
                        // Note: Tokens will be auto-recorded when services accept tracker
                        // For now, tracking via legacy usageTokens field
                    }
                    // if (qr.mathpixCalls) totalMathpixCalls += qr.mathpixCalls; // FIX: Prevent double counting (already counted in OCR phase)
                });
            }

            progressCallback(createProgressData(6, 'All questions marked.', MULTI_IMAGE_STEPS));
            logMarkingComplete();
            // ========================== END: IMPLEMENT STAGE 4 ==========================

            // ========================= PROCESS QUESTION-ONLY PAGES (FILTERED EARLIER) =========================
            // Process the questionOnly pages we filtered out earlier for text responses
            questionOnlyResult = null; // Reset or reuse
            if (questionOnlyPages.length > 0) {
                console.log(`\n📝 [QUESTION-ONLY] Processing ${questionOnlyPages.length} filtered questionOnly page(s)...`);

                // Build PROPER standalone classificationResult (not just filtered array)
                // Extract and sort all questions from questionOnly results
                const allQuestionOnlyQuestions = questionOnlyClassificationResults
                    .flatMap(r => r.result?.questions || [])
                    .sort((a: any, b: any) => {
                        const numA = parseInt(a.questionNumber?.toString().replace(/\D/g, '') || '0');
                        const numB = parseInt(b.questionNumber?.toString().replace(/\D/g, '') || '0');
                        return numA - numB;
                    });

                // Build complete standalone classificationResult (as if pure questionOnly mode)
                const questionOnlyClassificationResult = {
                    category: 'questionOnly',
                    questions: allQuestionOnlyQuestions,
                    hasAnyStudentWork: false,
                    hasMixedContent: false
                };

                console.log(`   Built standalone classificationResult:`);
                console.log(`     - Questions: ${questionOnlyClassificationResult.questions.length} (${questionOnlyClassificationResult.questions.map((q: any) => q.questionNumber).join(', ')})`);
                console.log(`     - Category: ${questionOnlyClassificationResult.category}`);

                // Call QuestionModeHandler for questionOnly pages and CAPTURE result
                questionOnlyResult = await QuestionModeHandlerService.handleQuestionMode({
                    classificationResult: questionOnlyClassificationResult,
                    standardizedPages: questionOnlyPages,
                    files,
                    actualModel,
                    userId: options.userId || 'anonymous',
                    submissionId,
                    req: req,
                    res: {
                        write: (data: string) => {
                            if (data.startsWith('data: ')) {
                                try {
                                    const jsonStr = data.substring(6);
                                    const parsed = JSON.parse(jsonStr);
                                    progressCallback(parsed);
                                } catch (e) {
                                    // Ignore
                                }
                            }
                        },
                        end: () => { }
                    } as any,
                    startTime,
                    logStep,
                    usageTracker,
                    suppressSseCompletion: true,  // CRITICAL: Suppress completion in mixed mode!
                    examPaperHint: dominantPaperHint // ✅ Pass paper hint from marking pass
                });

                console.log(`✅ [QUESTION-ONLY] Processed ${questionOnlyPages.length} page(s)`);
                console.log(`   Result captured:`, questionOnlyResult ? 'YES' : 'NO');
                if (questionOnlyResult) {
                    console.log(`   - Mode: ${questionOnlyResult.mode}`);
                    console.log(`   - message type: ${typeof questionOnlyResult.message}`);
                    console.log(`   - message keys:`, questionOnlyResult.message ? Object.keys(questionOnlyResult.message) : 'null');
                    console.log(`   - Has unifiedSession: ${!!questionOnlyResult.unifiedSession}`);

                    // Check what's actually in the result
                    if (questionOnlyResult.unifiedSession?.questionResponses) {
                        console.log(`   - Found questionResponses in unifiedSession: ${questionOnlyResult.unifiedSession.questionResponses.length}`);
                    }
                }
            }

            // ========================= VERIFY DOWNSTREAM TRIGGERING =========================
            console.log('\n🔍 [RESULT VERIFICATION] Checking what will be combined:');
            console.log(`   📊 Marking Results: ${allQuestionResults?.length || 0} questions`);
            console.log(`   📝 Question Results: ${questionOnlyResult ? 'YES (captured)' : 'NO'}`);
            console.log(`   ✅ Both modes triggered: ${(allQuestionResults?.length > 0) && questionOnlyResult ? 'YES' : 'NO'}`);
            //=================================================================================================

            // ========================= START: IMPLEMENT STAGE 5 =========================
            // --- Stage 5: Aggregation & Output ---
            progressCallback(createProgressData(7, 'Aggregating results and generating annotated images...', MULTI_IMAGE_STEPS));
            const logOutputGenerationComplete = logStep('Output Generation', 'output-generation');

            const {
                finalAnnotatedOutput,
                overallScore,
                totalPossibleScore,
                overallScoreText,
                updatedQuestionResults,
                sortedStandardizedPages
            } = await MarkingOutputService.generateOutput(
                standardizedPages,  // Already filtered upstream - only marking pages
                allQuestionResults,
                classificationResult,
                allClassificationResults,
                allPagesOcrData,
                files,
                submissionId,
                options,
                markingSchemesMap,
                progressCallback,
                MULTI_IMAGE_STEPS
            );

            // ========================= REALIGN DETECTION RESULTS (FOR EXAM TAB) =========================
            // After re-indexing, we must also update sourceImageIndex in detectionResults 
            // so that the Exam Tab (sidebar) points to the correct physical pages.

            // Actually, MarkingOutputService already built the map internally.
            // Let's create a map from originalPageIndex to new physical index.
            const originalToPhysicalMap = new Map<number, number>();
            sortedStandardizedPages.forEach((p, physicalIdx) => {
                if (p.originalPageIndex !== undefined) {
                    originalToPhysicalMap.set(p.originalPageIndex, physicalIdx);
                }
            });

            const reindexedDetectionResults = detectionResults.map(dr => {
                const newDr = { ...dr };
                if (dr.question?.sourceImageIndex !== undefined && dr.question.sourceImageIndex >= 0) {
                    newDr.question = {
                        ...dr.question,
                        sourceImageIndex: originalToPhysicalMap.get(dr.question.sourceImageIndex) ?? dr.question.sourceImageIndex
                    };
                }
                return newDr;
            });
            // ===========================================================================================


            logOutputGenerationComplete();

            // ========================= COMBINE QUESTION-ONLY RESULTS (BEFORE PERSISTENCE) =========================
            // Extract questionOnly text responses so they can be added to AI message content
            let combinedQuestionResponses: any[] = [];


            if (questionOnlyResult && questionOnlyResult.unifiedSession?.questionResponses) {
                console.log('\n📝 [RESULT COMBINATION] Extracting questionOnly responses...');
                const questionOnlyResponses = questionOnlyResult.unifiedSession.questionResponses;
                console.log(`   - QuestionOnly responses: ${questionOnlyResponses.length}`);

                // Sort questionOnly responses by question number
                questionOnlyResponses.sort((a: any, b: any) => {
                    const numA = parseInt(a.questionNumber?.toString().replace(/\D/g, '')) || 0;
                    const numB = parseInt(b.questionNumber?.toString().replace(/\D/g, '')) || 0;
                    return numA - numB;
                });

                combinedQuestionResponses = questionOnlyResponses;
                console.log(`   - Sorted questionOnly: ${combinedQuestionResponses.map((r: any) => r.questionNumber).join(', ')}`);
            } else {
                console.log('⚠️  [COMBINATION] No questionResponses found');
            }
            //=================================================================================

            // ========================= START: DATABASE PERSISTENCE =========================
            const { unifiedSession } = await MarkingPersistenceService.persistSession(
                files,
                options,
                submissionId,
                startTime,
                sortedStandardizedPages, // RE-INDEXED
                updatedQuestionResults, // RE-INDEXED
                classificationResult,
                allClassificationResults,
                markingSchemesMap,
                reindexedDetectionResults,  // RE-INDEXED for Exam Tab building
                globalQuestionText,
                finalAnnotatedOutput,
                overallScore,
                totalPossibleScore,
                overallScoreText,
                isPdf,
                isMultiplePdfs,
                pdfContext,
                isMixedContent,
                stepTimings,
                totalLLMTokens,
                combinedQuestionResponses,  // Pass questionOnly responses for persistence
                usageTracker,  // Pass UsageTracker for accurate token/cost tracking
                usageTracker.getMathpixPages()  // Pass actual Mathpix call count from tracker
            );

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
                    questionCount: allQuestionResults.length,
                    usageTokens: usageTracker.getTotalTokens(),
                    mathpixCalls: usageTracker.getMathpixPages()
                },
                annotatedOutput: finalAnnotatedOutput,
                outputFormat: 'images',
                originalInputType: isPdf ? 'pdf' : 'images',
                // Always include unifiedSession for consistent frontend handling
                unifiedSession: unifiedSession,
                results: updatedQuestionResults,
                metadata: {
                    totalQuestions: allQuestionResults.length,
                    totalScore: overallScore, // Use calculated overall score
                    maxScore: totalPossibleScore, // Use grouped total marks calculation to avoid double-counting
                    processingTime: (Date.now() - startTime) / 1000
                },
                // Add sessionId for credit deduction (prefer questionOnly result for pure Question Mode)
                sessionId: questionOnlyResult?.sessionId || unifiedSession?.sessionId,
                // Add sessionStats for usageRecord lookup
                sessionStats: unifiedSession?.sessionStats || null,
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
            progressCallback({ type: 'complete', result: finalOutput }); // 'true' marks as final

            // --- Performance Summary ---
            const totalProcessingTime = Date.now() - startTime;

            // Gather all blocks (OCR + Classification) for the transparency report
            const allOcrBlocks = allPagesOcrData.flatMap(page => {
                let ocrIdx = 0;
                const blocks: any[] = [];

                // 1. Mathpix/Vision Blocks
                if (page.ocrData?.mathBlocks) {
                    page.ocrData.mathBlocks.forEach((b: any) => {
                        // GLOBAL RESCUE ID: p{PageIndex}_ocr_{Index}
                        const globalRescueId = `p${page.pageIndex}_ocr_${ocrIdx++}`;

                        // Use globalBlockId if it exists (highly preferred), otherwise use our new global format.
                        // We do NOT use the old "block_..." format anymore to avoid collision ambiguity.
                        blocks.push({ ...b, id: b.globalBlockId || globalRescueId });
                    });
                }
                if (page.ocrData?.blocks) {
                    page.ocrData.blocks.forEach((b: any) => {
                        const globalRescueId = `p${page.pageIndex}_ocr_${ocrIdx++}`;
                        blocks.push({ ...b, id: b.globalBlockId || globalRescueId });
                    });
                }

                // 2. Classification Blocks (CRITICAL: These are the citations AI usually makes)
                if (page.classificationResult?.questions) {

                    // Reset or continue an index? Ideally continue if we want global uniqueness, but per-page reset with standard IDs is safer if AI resets.
                    // However, AI cites "line_1", "line_13" globally?
                    // Let's assume global sequential for the page context.
                    let logLineIdx = 1;

                    // Recursive helper to gather lines from any depth
                    const gatherLines = (node: any, parentBaseQNum: string) => {
                        // 1. Gather lines from current node
                        if (node.studentWorkLines) {
                            node.studentWorkLines.forEach((l: any) => {
                                // AUTO-SYNTHESIZE ID if missing
                                const isSynthesized = !l.id && !l.lineId;

                                // GLOBAL ID: p{Page}_q{Question}_line_{Index}
                                // We now have parentBaseQNum passed down!
                                const pIdx = l.pageIndex ?? node.pageIndex ?? page.pageIndex;
                                const synthesizedId = `p${pIdx}_q${parentBaseQNum}_line_${logLineIdx++}`;

                                // If l.id exists, it MIGHT be the new global ID we just set in MarkingExecutor, 
                                // OR it might be a weak "line_1" from an old pass.
                                // We check if it matches the global pattern.
                                let validId = l.id || l.lineId;

                                // If ID is missing or "weak" (just line_X), synthesize a robust one
                                if (!validId || validId.startsWith('line_')) {
                                    validId = synthesizedId;
                                }
                                blocks.push({ text: l.text, id: validId, metadata: { isSynthesized } });
                            });
                        }
                        // 2. Recurse into subQuestions
                        if (node.subQuestions && Array.isArray(node.subQuestions)) {
                            node.subQuestions.forEach((child: any) => gatherLines(child, parentBaseQNum));
                        }
                    };

                    // Start traversal for each top-level question
                    page.classificationResult.questions.forEach((q: any) => {
                        const baseQNum = q.questionNumber ? q.questionNumber.toString().replace(/\D/g, '') : '0';
                        gatherLines(q, baseQNum);
                    });
                } else {
                    console.warn(`⚠️ [LOG-DEBUG] No classificationResult for page ${page.pageIndex} in allPagesOcrData`);
                }
                return blocks;
            });


            logAnnotationSummary(allQuestionResults, markingTasks);
            logPerformanceSummary(stepTimings, totalProcessingTime, actualModel, 'unified');
            console.log(usageTracker.getSummary(actualModel));

            console.log(`\n🏁 ========== UNIFIED PIPELINE END ==========`);
            console.log(`🏁 ==========================================\n`);
            // ========================== END: IMPLEMENT STAGE 5 ==========================

            return finalOutput;

        } catch (error: any) {
            console.error('❌ Pipeline Error:', error);
            throw error;
        }
    }
}
