import { v4 as uuidv4 } from 'uuid';
import { Request, Response } from 'express';
import type { ModelType } from '../../types/index.js';
import PdfProcessingService from '../pdf/PdfProcessingService.js';
import sharp from 'sharp';
import { ImageUtils } from '../../utils/ImageUtils.js';
import { MarkingInstructionService } from './MarkingInstructionService.js';
import { MarkingOutputService } from './MarkingOutputService.js';
import { MarkingPersistenceService } from './MarkingPersistenceService.js';
import { createProgressData } from '../../utils/sseUtils.js';
import { logPerformanceSummary, extractQuestionsFromClassification, logAnnotationSummary } from './MarkingHelpers.js';
import { withPerformanceLogging } from '../../utils/markingRouterHelpers.js';
import { usageTracker } from '../../utils/usageTracker.js';

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

import type { StandardizedPage, PageOcrResult, MathBlock } from '../../types/markingRouter.js';
import type { MarkingTask } from './MarkingExecutor.js';
import { OCRService } from '../ocr/OCRService.js';
import { ClassificationService } from './ClassificationService.js';
import { executeMarkingForQuestion, QuestionResult, EnrichedAnnotation, createMarkingTasksFromClassification } from './MarkingExecutor.js';
import { MarkingSchemeOrchestrationService } from './MarkingSchemeOrchestrationService.js';
import { QuestionModeHandlerService } from './QuestionModeHandlerService.js';
import { ModeSplitService } from './ModeSplitService.js';

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
        progressCallback: (data: any) => void
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

        // Import global UsageTracker singleton (DO NOT create new instance)
        const { usageTracker } = await import('../../utils/UsageTracker.js');

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
            standardizedPages.forEach((page, i) => page.imageData = preprocessedImageDatas[i]);
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
                false,  // debug
                usageTracker  // Pass tracker for auto-recording
            );


            // DEBUG: Log Mapper Response (Page Index -> Question Number)
            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('[MAPPER RESPONSE] Page Index -> Question Number Map');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            allClassificationResults.forEach(({ pageIndex, result }) => {
                const qNums = result.questions?.map((q: any) => {
                    const subQs = q.subQuestions?.map((sq: any) => sq.part).join(',') || '';
                    return q.questionNumber + (subQs ? `(${subQs})` : '');
                }).filter(Boolean).join(', ') || 'No Questions';
                console.log(`Page ${pageIndex}: [${qNums}] (Category: ${result.category})`);
            });
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

            logClassificationComplete();

            // ========================= CATEGORY OVERRIDE (BEFORE SPLIT) =========================
            // Override 1: Drawing-only pages → questionOnly
            const questionAnswerPages = allClassificationResults.filter(r => r.result?.category === 'questionAnswer');
            if (questionAnswerPages.length > 0) {
                const allWorkIsDrawingsOnly = questionAnswerPages.every(r => {
                    const questions = r.result?.questions || [];
                    return questions.every((q: any) => {
                        const hasDrawing = q.hasStudentDrawing === true;
                        const workLines = q.studentWorkLines || [];
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
                                        pageIndex: pageIndex, // Track which page this sub-question came from
                                        studentWorkLines: subQ.studentWorkLines || [], // Preserve lines
                                        hasStudentDrawing: subQ.hasStudentDrawing // Preserve drawing flag
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
                                    // Merge lines if present
                                    if (subQ.studentWorkLines && Array.isArray(subQ.studentWorkLines)) {
                                        existing.studentWorkLines = [...(existing.studentWorkLines || []), ...subQ.studentWorkLines];
                                    }
                                    // Merge drawing flag
                                    if (subQ.hasStudentDrawing) {
                                        existing.hasStudentDrawing = true;
                                        // Ensure [DRAWING] token exists in text if flag is true
                                        if (existing.studentWork) {
                                            if (!existing.studentWork.includes('[DRAWING]')) {
                                                existing.studentWork += '\n[DRAWING]';
                                            }
                                        } else {
                                            existing.studentWork = '[DRAWING]';
                                        }
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
                        sourceImage: standardizedPages.find(p => p.pageIndex === pageWithText.pageIndex)?.originalFileName || 'unknown',
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
            // Use MAPPER category (source of truth) instead of classification category
            const hasAnyStudentWork = allClassificationResults.some(r => r.mapperCategory === "questionAnswer");
            const hasMixedContent = allClassificationResults.some(r => r.mapperCategory !== allClassificationResults[0]?.mapperCategory);

            // Determine combined category using MAPPER results (not classification results)
            const allMapperCategories = allClassificationResults.map(r => r.mapperCategory).filter(Boolean);
            const combinedCategory: "questionOnly" | "questionAnswer" | "metadata" =
                allMapperCategories.every(cat => cat === "questionOnly") ? "questionOnly" :
                    allMapperCategories.every(cat => cat === "metadata" || cat === "frontPage") ? "metadata" :
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
            const hasQuestionOnlyPages = originalClassificationResults.every(r => r.result?.category === 'questionOnly');
            const isQuestionMode = hasQuestionOnlyPages && originalClassificationResults.length > 0;
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
                console.log(`\n🔍 [RETURN DEBUG] Pure Question Mode - Returning:`);
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
                    page.imageData, {}, false, 'auto',
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

            // Orchestrate marking scheme lookup (detection, grouping, merging)
            const orchestrationResult = await MarkingSchemeOrchestrationService.orchestrateMarkingSchemeLookup(
                individualQuestions,
                classificationResult
            );

            const markingSchemesMap = orchestrationResult.markingSchemesMap;
            const detectionResults = orchestrationResult.detectionResults;
            const detectionStats = orchestrationResult.detectionStats;
            classificationResult = orchestrationResult.updatedClassificationResult;

            logQuestionDetectionComplete();

            // Log detection statistics
            MarkingSchemeOrchestrationService.logDetectionStatistics(detectionStats);

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
                            console.log(`[DRAWING] Q${q.questionNumber}: Passing image to Marking AI (Drawing Classification returned 0 for this drawing question)`);
                            (q as any).imageDataForMarking = pageForDrawing.imageData;
                            console.log(`[DRAWING] Q${q.questionNumber || '?'}: Will pass image to Marking AI`);
                        }
                    });
                }
            });
            console.log('[PIPELINE DEBUG] ✅ Drawing image passing configured, proceeding to create marking tasks...');

            // ========================= START: ENHANCE DRAWINGS =========================
            // Drawing Enhancement Service removed as per new design (AI Marking provides coordinates)
            // ========================== END: ENHANCE DRAWINGS ==========================

            // ========================= START: IMPLEMENT STAGE 3 =========================
            // --- Stage 3: Create Marking Tasks Directly from Classification (Bypass Segmentation) ---
            progressCallback(createProgressData(5, 'Preparing marking tasks...', MULTI_IMAGE_STEPS));
            console.log('[PIPELINE DEBUG] Starting createMarkingTasksFromClassification...');


            // Create page dimensions map from standardizedPages for accurate drawing position calculation
            const pageDimensionsMap = new Map<number, { width: number; height: number }>();
            standardizedPages.forEach((page, index) => {
                if (page.width && page.height) {
                    pageDimensionsMap.set(index, { width: page.width, height: page.height });
                }
            });

            // Create marking tasks directly from classification results (bypass segmentation)
            try {
                // PATCH: Ensure [DRAWING] token exists in classificationResult if hasStudentDrawing is true
                // This is critical for MarkingExecutor to create drawing blocks for questions with 0 lines of text
                // classificationResult is an object with a 'questions' array
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
                                q.studentWorkLines = [{ text: '[DRAWING]', confidence: 1.0 }];
                            } else {
                                // Check if any line has [DRAWING]
                                const hasDrawingLine = q.studentWorkLines.some((l: any) => l.text && l.text.includes('[DRAWING]'));
                                if (!hasDrawingLine) {
                                    q.studentWorkLines.push({ text: '[DRAWING]', confidence: 1.0 });
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
                                        sq.studentWorkLines = [{ text: '[DRAWING]', confidence: 1.0 }];
                                    } else {
                                        const hasDrawingLine = sq.studentWorkLines.some((l: any) => l.text && l.text.includes('[DRAWING]'));
                                        if (!hasDrawingLine) {
                                            sq.studentWorkLines.push({ text: '[DRAWING]', confidence: 1.0 });
                                        }
                                    }
                                }
                            });
                        }
                    });
                }

                markingTasks = createMarkingTasksFromClassification(
                    classificationResult,
                    allPagesOcrData,
                    markingSchemesMap,
                    pageDimensionsMap,
                    standardizedPages
                );
                console.log(`[PIPELINE DEBUG] ✅ createMarkingTasksFromClassification completed, created ${markingTasks.length} marking task(s)`);
            } catch (error) {
                console.error('[PIPELINE DEBUG] ❌ createMarkingTasksFromClassification failed:', error);
                throw error;
            }

            // Handle case where no student work is found
            if (markingTasks.length === 0) {
                console.log('[PIPELINE DEBUG] No marking tasks created, exiting early');
                progressCallback(createProgressData(5, 'No student work found to mark.', MULTI_IMAGE_STEPS));
                const finalOutput = {
                    submissionId, // Pass through submissionId
                    annotatedOutput: [],
                    results: [],
                    mode: 'Question',
                    unifiedSession: questionOnlyResult?.unifiedSession,
                    // Add sessionId for credit deduction (Question Mode)
                    sessionId: questionOnlyResult?.sessionId || questionOnlyResult?.unifiedSession?.sessionId,
                    // Add sessionStats for usageRecord lookup
                    sessionStats: questionOnlyResult?.unifiedSession?.sessionStats || null,
                    processingStats: {
                        totalLLMTokens,
                        mathpixCalls: usageTracker.getMathpixPages()
                    }
                };


                console.log(`\n🔍 [RETURN DEBUG] No Marking Tasks - Returning:`);
                console.log(`   - submissionId: ${finalOutput.submissionId}`);
                console.log(`   - result object exists: true\n`);
                // sendSseUpdate(res, { type: 'complete', result: finalOutput }, true);
                // res.end();
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

                                    executeMarkingForQuestion(task, mockRes, submissionId, actualModel, allPagesOcrData, usageTracker)
                                        .then(result => {
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
                    suppressSseCompletion: true  // CRITICAL: Suppress completion in mixed mode!
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
                overallScoreText
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
                // console.log('⚠️  [COMBINATION] No questionResponses found');
            }
            //=================================================================================

            // ========================= START: DATABASE PERSISTENCE =========================
            const { unifiedSession } = await MarkingPersistenceService.persistSession(
                files,
                options,
                submissionId,
                startTime,
                standardizedPages,
                allQuestionResults,
                classificationResult,
                allClassificationResults,
                markingSchemesMap,
                detectionResults,  // Add detection results for Exam Tab building
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
                    usageTokens: totalLLMTokens,
                    mathpixCalls: usageTracker.getMathpixPages()
                },
                annotatedOutput: finalAnnotatedOutput,
                outputFormat: 'images',
                originalInputType: isPdf ? 'pdf' : 'images',
                // Always include unifiedSession for consistent frontend handling
                unifiedSession: unifiedSession,
                results: allQuestionResults,
                metadata: {
                    totalQuestions: allQuestionResults.length,
                    totalScore: allQuestionResults.reduce((acc, r) => acc + (r.score?.awardedMarks || 0), 0),
                    maxScore: allQuestionResults.reduce((acc, r) => acc + (r.score?.totalMarks || 0), 0),
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

            // DEBUG: Show what's being sent to frontend
            console.log('\n📤 [FINAL OUTPUT DEBUG] Sending to frontend:');
            console.log(`   - annotatedOutput: ${finalOutput.annotatedOutput?.length || 0} images`);
            console.log(`   - results: ${finalOutput.results?.length || 0} marking results`);
            console.log(`   - unifiedSession exists: ${!!finalOutput.unifiedSession}`);
            console.log(`   - questionResponses in AI message: ${combinedQuestionResponses.length > 0 ? 'YES' : 'NO'}`);

            // --- Send FINAL Complete Event ---
            progressCallback({ type: 'complete', result: finalOutput }); // 'true' marks as final

            // --- Performance Summary ---
            const totalProcessingTime = Date.now() - startTime;
            logAnnotationSummary(allQuestionResults, markingTasks);
            logPerformanceSummary(stepTimings, totalProcessingTime, actualModel, 'unified');
            console.log(usageTracker.getSummary(actualModel));

            console.log(`\n🏁 ========== UNIFIED PIPELINE END ==========`);
            console.log(`🏁 ==========================================\n`);
            // ========================== END: IMPLEMENT STAGE 5 ==========================

            console.log(`\n🔍 [RETURN DEBUG] Normal/Mixed Mode - Returning:`);
            console.log(`   - sessionId: ${finalOutput.sessionId}`);
            console.log(`   - hasUnifiedSession: ${!!finalOutput.unifiedSession}`);
            console.log(`   - mode: ${finalOutput.mode || 'not set'}`);
            console.log(`   - result object exists: true\n`);
            return finalOutput;

        } catch (error: any) {
            console.error('❌ Pipeline Error:', error);
            throw error;
        }
    }
}
