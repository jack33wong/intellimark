import { v4 as uuidv4 } from 'uuid';
import { Request, Response } from 'express';
import type { ModelType, MarkingTask, EnrichedAnnotation, MathBlock } from '../../types/index.js';
import PdfProcessingService from '../pdf/PdfProcessingService.js';
import sharp from 'sharp';
import { ImageUtils } from '../../utils/ImageUtils.js';
import { MarkingInstructionService } from './MarkingInstructionService.js';
import { MarkingOutputService } from './MarkingOutputService.js';
import { MarkingPersistenceService } from './MarkingPersistenceService.js';
import { ImageGeometryService, isRecognizedAcademicSubject } from './ImageGeometryService.js';
import { createProgressData } from '../../utils/sseUtils.js';
import axios from 'axios';
import { getFirestore } from '../../config/firebase.js';
import { GradeBoundaryService } from './GradeBoundaryService.js';
import { ChatContextBuilder } from './ChatContextBuilder.js';
import {
    logPerformanceSummary,
    extractQuestionsFromClassification,
    logAnnotationSummary,
    getQuestionSortValue,
    getSuggestedFollowUps,
    calculateOverallScore
} from './MarkingHelpers.js';
import { withPerformanceLogging } from '../../utils/markingRouterHelpers.js';
import UsageTracker from '../../utils/UsageTracker.js';
import { UserFacingError } from '../../utils/UserFacingError.js';

import type { MarkingSessionContext, QuestionSessionContext } from '../../types/sessionManagement.js';
import { getBaseQuestionNumber, extractQuestionNumberFromFilename } from '../../utils/TextNormalizationUtils.js';
import { formatMarkingSchemeAsBullets } from '../../config/prompts.js';

import { resolveModelTier, resolveExecutionPlan, getDefaultModel } from '../../config/aiModels.js';
import { checkCredits } from '../creditService.js';
import { AdminAlertService } from '../AdminAlertService.js';

// Helper functions for real model and API names
function getRealModelName(modelType: string): string {
    return resolveExecutionPlan(modelType, 'marking').modelName;
}

function getRealApiName(modelName: string): string {
    if (modelName.includes('gemini') || modelName.includes('argon')) {
        return 'Google Gemini API';
    }
    if (modelName.includes('gpt') || modelName.includes('openai')) {
        return 'OpenAI API';
    }
    return 'Google Gemini API';
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
import {
    resolveSubjectProfile,
    isLevelOfResponseQuestion,
    type SubjectProfile,
    SUBJECT_PROFILES
} from '../../config/subjectProfiles.js';

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

// Define the steps for re-marking processing
const REMARK_STEPS = [
    'Loading cached student work...',
    'Fetching official mark scheme...',
    'Re-marking with official rubric...',
    'Updating grade boundaries & annotations...'
];

// Helper to format marking scheme required message for genuine academic subjects
const formatMarkSchemeRequiredMessage = (rawReasonOrSubject: string): string => {
    let subjectName = rawReasonOrSubject.trim();
    const subjectMatch = rawReasonOrSubject.match(/Unsupported subject\s*\(([^)]+)\)/i);
    if (subjectMatch) {
        subjectName = subjectMatch[1].trim();
    }
    if (!subjectName || /^(this subject|other|unknown|none)$/i.test(subjectName)) {
        subjectName = 'this subject';
    }

    return `📋 **Marking Scheme Required (${subjectName}):** AI Marking includes built-in official past paper mark schemes for **GCSE & A-Level Mathematics** and **GCSE English Language**. For **${subjectName}** (and all other subjects), we support full AI grading as soon as you provide the marking scheme!\n\n💡 **Want me to mark this paper right now?** Click **Attach Marking Scheme** below to upload the official or teacher marking scheme (marking scheme pages are free and do not count toward your page limit!).`;
};

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
    allowGenericSubjectMarking?: boolean;
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
            let inputMarkingScheme = options.markingScheme;

            // Determine selected tier (preserves 'fast' | 'thinking' | 'pro')
            const selectedTier = (options.model && options.model !== 'auto') ? options.model : getDefaultModel();
            actualModel = selectedTier;

            const debugClassification = process.env.DEBUG_RAW_CLASSIFICATION_RESPONSE === 'true';

            // Input Validation
            const logValidation = logStep('Input Validation', 'Validation');
            if (!files || files.length === 0) {
                throw new Error('No files uploaded.');
            }
            logValidation();

            // Sanitize and detect actual file types from binary magic bytes (protects against misnamed uploads / canvas exports)
            files.forEach(file => {
                if (file.buffer && file.buffer.length >= 4) {
                    const buf = file.buffer;
                    const pdfIdx = buf.indexOf('%PDF-');
                    const isRealPdf = pdfIdx >= 0 && pdfIdx < 2048;
                    const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
                    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
                    const isWebp = buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP';

                    if (isRealPdf && file.mimetype !== 'application/pdf') {
                        console.log(`🧼 [MIME-REPAIR] Corrected "${file.originalname}" to application/pdf based on %PDF- header.`);
                        file.mimetype = 'application/pdf';
                    } else if (file.mimetype === 'application/pdf' && !isRealPdf) {
                        if (isJpeg) {
                            console.warn(`🧼 [MIME-REPAIR] File "${file.originalname}" declared as PDF but buffer is JPEG. Correcting to image/jpeg.`);
                            file.mimetype = 'image/jpeg';
                        } else if (isPng) {
                            console.warn(`🧼 [MIME-REPAIR] File "${file.originalname}" declared as PDF but buffer is PNG. Correcting to image/png.`);
                            file.mimetype = 'image/png';
                        } else if (isWebp) {
                            console.warn(`🧼 [MIME-REPAIR] File "${file.originalname}" declared as PDF but buffer is WebP. Correcting to image/webp.`);
                            file.mimetype = 'image/webp';
                        }
                    }
                }
            });

            // Determine Input Type
            const firstMime = files[0].mimetype;
            const isPdf = files.length === 1 && firstMime === 'application/pdf';
            const isMultiplePdfs = files.length > 1 && files.every(f => f.mimetype === 'application/pdf');
            const isSingleImage = files.length === 1 && !isPdf && firstMime.startsWith('image/');
            const isMultipleImages = files.length > 1 && files.every(f => f.mimetype?.startsWith('image/'));
            const isMixedUpload = files.length > 1 && !isMultiplePdfs && !isMultipleImages && files.every(f =>
                f.mimetype === 'application/pdf' || f.mimetype?.startsWith('image/')
            );

            const inputType = isPdf
                ? 'PDF'
                : isMultiplePdfs
                    ? 'Multiple PDFs'
                    : isSingleImage
                        ? 'Single Image'
                        : isMultipleImages
                            ? 'Multiple Images'
                            : isMixedUpload
                                ? 'Mixed (Images + PDFs)'
                                : 'Unknown';
            console.log(`[INPUT TYPE] Detected: ${inputType} (${files.length} files)`);

            // --- Hoisted Page Limits (so PDFs can be gated in 10ms BEFORE 45s rasterization) ---
            const userPlan = (req as any).userPlan || 'free';
            const isFreeUser = !userId || userPlan === 'free';
            const MAX_PAGES_LIMIT = parseInt(process.env.MAX_UPLOAD_PAGES || '50');
            const MAX_FREE_PAGES = parseInt(process.env.MAX_FREE_PAGES || String(MAX_PAGES_LIMIT)); // Unified to 50 for combined 48-page booklets
            const MAX_RAW_COMBINED_PAGES = parseInt(process.env.MAX_RAW_UPLOAD_PAGES || '100'); // Allows up to 50 student pages + up to 50 Mark Scheme pages before Stage 2 ejection
            const effectiveMaxPages = isFreeUser ? Math.min(MAX_FREE_PAGES, MAX_PAGES_LIMIT) : MAX_PAGES_LIMIT;
            const getPageLimitErrorMessage = (count?: number) =>
                `PDF_PAGE_LIMIT_EXCEEDED: Upload exceeds the maximum limit of ${effectiveMaxPages} pages/images${count ? ` (uploaded ${count} pages)` : ''}.`;

            // --- Fast Pre-Rasterization Credit Balance Gate (10ms fail-fast if balance <= 0) ---
            if (userId && userId !== 'anonymous') {
                const preFlightCreditCheck = await checkCredits(userId, 0.020, userPlan);
                if (!preFlightCreditCheck.canProceed) {
                    throw new Error(preFlightCreditCheck.warning);
                }
            }

            // --- Declare variables at proper scope ---
            let standardizedPages: StandardizedPage[] = [];
            let allPagesOcrData: PageOcrResult[] = [];
            let markingTasks: MarkingTask[] = [];
            let pdfContext: any = null;
            let pageDimensionsMap = new Map<number, { width: number; height: number }>();
            const MARK_SCHEME_FILENAME_REGEX = /(^|[-_\s.])(rms|ms|mark[-_\s]?scheme|marking[-_\s]?scheme)([-_\s.]|$)/i;
            const isExplicitMarkSchemePdfFile = (f: Express.Multer.File) =>
                f?.mimetype === 'application/pdf' && MARK_SCHEME_FILENAME_REGEX.test((f.originalname || '').replace(/\.pdf$/i, ''));
            const hasNonSchemeStudentFiles = files.some(f => !isExplicitMarkSchemePdfFile(f));
            const deferredSchemePdfFiles: Express.Multer.File[] = [];

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
                    standardizedPages = await PdfProcessingService.convertPdfToImages(pdfBuffer, {
                        maxPages: effectiveMaxPages,
                        maxPagesErrorMessage: getPageLimitErrorMessage
                    });

                    // TEMP: Limit to first 10 pages
                    // Enforce Page Limit
                    if (standardizedPages.length > MAX_PAGES_LIMIT) {
                        throw new Error(`Upload exceeds the maximum limit of ${MAX_PAGES_LIMIT} pages/images. Processed ${standardizedPages.length} pages.`);
                    }
                    // Set originalFileName and _sourceIndex
                    standardizedPages.forEach((page) => {
                        page.originalFileName = originalFileName;
                        (page as any)._sourceIndex = 0;
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
                        if (hasNonSchemeStudentFiles && isExplicitMarkSchemePdfFile(file)) {
                            deferredSchemePdfFiles.push(file);
                            console.log(`⏭️  [DEFERRED-MS-PDF] Holding Mark Scheme PDF "${file.originalname}" off Stage 1 rasterization until DB pre-check.`);
                            return { index, pdfPages: [] };
                        }
                        try {
                            const pdfPages = await PdfProcessingService.convertPdfToImages(file.buffer, {
                                maxPages: effectiveMaxPages,
                                maxPagesErrorMessage: getPageLimitErrorMessage
                            });
                            if (pdfPages.length === 0) {
                                console.warn(`PDF ${index + 1} (${file.originalname}) yielded no pages.`);
                                return { index, pdfPages: [] };
                            }

                            // Enforce Page Limit per PDF (part of total check later, but good early check)
                            if (pdfPages.length > MAX_PAGES_LIMIT) {
                                throw new Error(`Single PDF exceeds the maximum limit of ${MAX_PAGES_LIMIT} pages.`);
                            }

                            // Store original index
                            pdfPages.forEach((page, pageIndex) => {
                                page.originalFileName = file.originalname || `pdf-${index + 1}.pdf`;
                                (page as any)._sourceIndex = index;
                            });

                            return { index, pdfPages };
                        } catch (error: any) {
                            console.error(`❌ Failed to convert PDF ${index + 1} (${file.originalname}):`, error);
                            
                            // 🛡️ LET CUSTOM UNREADABLE / USER-FACING ERRORS BUBBLE UP TO THE CONTROLLER
                            if (error instanceof UserFacingError || error.message?.includes('PDF_UNREADABLE') || error.message?.includes('limited to grading') || error.message?.includes('exceeds the maximum limit')) {
                                throw error;
                            }
                            
                            // 🚨 Fallback for generic size/complexity failures
                            throw new Error(`Failed to process document "${file.originalname}". The file may be too large or complex. Please try uploading it in smaller batches.`);
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

                    // Enforce Raw Combined Ceiling for Multiple PDFs (Mark Scheme pages are exempted after Stage 2 Geometry)
                    if (standardizedPages.length > MAX_RAW_COMBINED_PAGES) {
                        throw new Error(`Total upload exceeds the maximum limit of ${MAX_PAGES_LIMIT} pages/images. Processed ${standardizedPages.length} pages.`);
                    }

                    if (standardizedPages.length === 0) throw new Error('All PDF conversions yielded no pages.');
                    progressCallback(createProgressData(1, `Converted ${files.length} PDFs to ${standardizedPages.length} total pages.`, MULTI_IMAGE_STEPS));
                }

                // Dimension extraction after conversion (reliable via sharp on buffers)
                progressCallback(createProgressData(1, `Extracting dimensions for ${standardizedPages.length} converted page(s)...`, MULTI_IMAGE_STEPS));
                try {
                    await Promise.all(standardizedPages.map(async (page, i) => {
                        if (page.width && page.height) return; // Already populated by PdfProcessingService
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

                    // Defer original PDF upload to background (preUploadedOriginalFilesPromise) so Stage 1 doesn't block 2-5s
                    const originalPdfLink = null;
                    const originalPdfDataUrl = null;

                    // Calculate file size for single PDF
                    const fileSizeBytes = files[0].buffer.length;
                    const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);

                    // Store PDF context for later use in the unified pipeline (originalPdfLink is back-filled by background upload)
                    pdfContext = {
                        originalFileType: 'pdf' as const,
                        originalPdfLink,
                        originalPdfDataUrl,
                        originalFileName: files[0].originalname || 'document.pdf',
                        fileSize: fileSizeBytes,
                        fileSizeMB: fileSizeMB + ' MB'
                    };
                } else if (isMultiplePdfs) {
                    // Multiple PDFs - store all PDFs for later use (uploads deferred to background preUploadedOriginalFilesPromise)
                    progressCallback(createProgressData(2, 'Processing multiple PDFs...', MULTI_IMAGE_STEPS));

                    const pdfContexts: any[] = [];

                    for (let i = 0; i < files.length; i++) {
                        const file = files[i];
                        const originalPdfLink = null;
                        // Always create base64 URL for immediate display
                        const originalPdfDataUrl = `data:application/pdf;base64,${file.buffer.toString('base64')}`;

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
                const rawFileData = `data:${files[0].mimetype};base64,${files[0].buffer.toString('base64')}`;
                const singleFileData = await ImageUtils.normalizeOrientation(rawFileData);

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
                        const rawData = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
                        const normalizedImageData = await ImageUtils.normalizeOrientation(rawData);
                        
                        const base64Data = normalizedImageData.split(',')[1];
                        const imageBuffer = Buffer.from(base64Data, 'base64');
                        const metadata = await sharp(imageBuffer).metadata();
                        
                        if (!metadata.width || !metadata.height) return null;
                        return {
                            pageIndex: index,
                            imageData: normalizedImageData,
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

                // Enforce Raw Combined Ceiling for Multiple Images (Mark Scheme pages are exempted after Stage 2 Geometry)
                if (standardizedPages.length > MAX_RAW_COMBINED_PAGES) {
                    throw new Error(`Upload exceeds the maximum limit of ${MAX_PAGES_LIMIT} images. Selected ${standardizedPages.length} images.`);
                }

                progressCallback(createProgressData(1, `Collected ${standardizedPages.length} image(s).`, MULTI_IMAGE_STEPS));

            } else if (isMixedUpload) {
                // --- Mixed Upload Path (Images + PDFs in the same batch) ---
                // NOTE: isPdf / isMultiplePdfs stay false so downstream image sorting still applies.
                progressCallback(createProgressData(1, `Preparing mixed files (${files.length} files)...`, MULTI_IMAGE_STEPS));
                stepTimings['pdf_conversion'] = { start: Date.now() };

                const mixedConversionPromises = files.map(async (file, index): Promise<StandardizedPage[]> => {
                    if (file.mimetype === 'application/pdf') {
                        if (hasNonSchemeStudentFiles && isExplicitMarkSchemePdfFile(file)) {
                            deferredSchemePdfFiles.push(file);
                            console.log(`⏭️  [DEFERRED-MS-PDF] Holding Mark Scheme PDF "${file.originalname}" off Stage 1 rasterization until DB pre-check.`);
                            return [];
                        }
                        try {
                            const pdfPages = await PdfProcessingService.convertPdfToImages(file.buffer, {
                                maxPages: effectiveMaxPages,
                                maxPagesErrorMessage: getPageLimitErrorMessage
                            });
                            await Promise.all(pdfPages.map(async (page) => {
                                page.originalFileName = file.originalname || `pdf-${index + 1}.pdf`;
                                (page as any)._sourceIndex = index;
                                if (page.width && page.height) return; // Already populated by PdfProcessingService
                                const base64Data = page.imageData.split(',')[1];
                                if (base64Data) {
                                    const metadata = await sharp(Buffer.from(base64Data, 'base64')).metadata();
                                    page.width = metadata.width || 0;
                                    page.height = metadata.height || 0;
                                }
                            }));
                            return pdfPages;
                        } catch (error: any) {
                            console.error(`❌ Failed to convert PDF in mixed batch (${file.originalname}):`, error);
                            if (error instanceof UserFacingError || error.message?.includes('PDF_UNREADABLE') || error.message?.includes('limited to grading') || error.message?.includes('exceeds the maximum limit')) throw error;
                            throw new Error(`Failed to process PDF "${file.originalname}".`);
                        }
                    } else if (file.mimetype?.startsWith('image/')) {
                        try {
                            const rawData = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
                            const normalizedImageData = await ImageUtils.normalizeOrientation(rawData);
                            const base64Data = normalizedImageData.split(',')[1];
                            const metadata = await sharp(Buffer.from(base64Data, 'base64')).metadata();
                            if (!metadata.width || !metadata.height) return [];
                            return [{
                                pageIndex: 0, // Re-indexed sequentially below
                                imageData: normalizedImageData,
                                originalFileName: file.originalname || `image-${index + 1}.jpg`,
                                width: metadata.width,
                                height: metadata.height
                            }];
                        } catch (imgErr) {
                            console.warn(`[MIXED UPLOAD] Failed to process image ${file.originalname}:`, imgErr);
                            return [];
                        }
                    }
                    return [];
                });

                const nestedPages = await Promise.all(mixedConversionPromises);
                if (stepTimings['pdf_conversion']) {
                    stepTimings['pdf_conversion'].duration = Date.now() - stepTimings['pdf_conversion'].start;
                }

                // Flatten in original upload order and re-index sequentially
                standardizedPages = nestedPages.flat().map((page, idx) => ({
                    ...page,
                    pageIndex: idx
                }));

                if (standardizedPages.length > MAX_RAW_COMBINED_PAGES) {
                    throw new Error(`Total upload exceeds the maximum limit of ${MAX_PAGES_LIMIT} pages/images. Processed ${standardizedPages.length} pages.`);
                }

                // Store PDF context for any PDFs included in the mixed batch (upload deferred to background preUploadedOriginalFilesPromise)
                const pdfFiles = files.filter(f => f.mimetype === 'application/pdf');
                if (pdfFiles.length > 0) {
                    const pdfContexts: any[] = [];
                    for (let i = 0; i < pdfFiles.length; i++) {
                        const file = pdfFiles[i];
                        const originalFileIdx = files.indexOf(file);
                        const originalPdfLink = null;
                        const originalPdfDataUrl = `data:application/pdf;base64,${file.buffer.toString('base64')}`;

                        const fileSizeBytes = file.buffer.length;
                        const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);
                        pdfContexts.push({
                            originalFileType: 'pdf' as const,
                            originalPdfLink,
                            originalPdfDataUrl,
                            originalFileName: file.originalname || `document-${i + 1}.pdf`,
                            fileSize: fileSizeBytes,
                            fileSizeMB: fileSizeMB + ' MB',
                            fileIndex: originalFileIdx >= 0 ? originalFileIdx : i
                        });
                    }
                    pdfContext = {
                        isMultiplePdfs: true,
                        pdfContexts
                    };
                }

                progressCallback(createProgressData(1, `Prepared ${standardizedPages.length} total page(s) from mixed upload.`, MULTI_IMAGE_STEPS));

            } else {
                // This case should technically be caught by initial validation, but belt-and-suspenders.
                throw new Error("Unhandled submission type.");
            }

            // --- Guard against empty standardization ---
            if (standardizedPages.length === 0) {
                throw new Error('Standardization failed: No processable pages/images found.');
            }

            // Stamp pre-split raw page index & detect 100% solid-black corrupted client canvas exports (<1ms via sharp.stats)
            await Promise.all(standardizedPages.map(async (page, idx) => {
                (page as any)._rawPageIndex = idx;
                if ((page as any)._sourceIndex === undefined) {
                    try {
                        const base64Data = page.imageData.split(',')[1];
                        if (base64Data) {
                            const buf = Buffer.from(base64Data, 'base64');
                            const stats = await sharp(buf).stats();
                            if (stats.channels.length > 0 && stats.channels.every(c => c.max <= 2)) {
                                (page as any)._isSolidBlackCorrupted = true;
                                console.warn(`🖤 [CORRUPT-IMAGE GUARD] Page ${idx} (${page.originalFileName}) is 100% solid black (Safari canvas memory limit). Marking for ejection.`);
                            }
                        }
                    } catch {}
                }
            }));

            console.log(`📊 [RAW UPLOAD] User ${userId || 'anonymous'} (${userPlan}) uploaded ${standardizedPages.length} raw page(s) pre-geometry.`);

            // --- 1. Vision Orientation Fix (Deterministic) ---
            progressCallback(createProgressData(2, `Detecting orientation via Google Vision for ${standardizedPages.length} image(s)...`, MULTI_IMAGE_STEPS));
            const logOrientationComplete = logStep('Vision Orientation Check', 'Google Cloud Vision');
            
            const { GoogleVisionService } = await import('../ocr/GoogleVisionService.js');

            // ⚡ Skip orientation for pages from digital official Mark Scheme PDFs (identified by filename, >= 5 pages)
            // and for solid-black corrupted canvas exports.
            const pdfPageCountByName = new Map<string, number>();
            standardizedPages.forEach(p => {
                const name = p.originalFileName || '';
                if ((p as any)._sourceIndex !== undefined && /\.pdf$/i.test(name)) {
                    pdfPageCountByName.set(name, (pdfPageCountByName.get(name) || 0) + 1);
                }
            });
            const isUprightMarkSchemePdfPage = (p: StandardizedPage) => {
                const name = p.originalFileName || '';
                return (pdfPageCountByName.get(name) || 0) >= 5 && MARK_SCHEME_FILENAME_REGEX.test(name.replace(/\.pdf$/i, ''));
            };

            const orientationTargets = standardizedPages.filter(
                p => !isUprightMarkSchemePdfPage(p) && !(p as any)._isSolidBlackCorrupted
            );
            const skippedOrientationCount = standardizedPages.length - orientationTargets.length;
            if (skippedOrientationCount > 0) {
                console.log(`⏭️  [VISION ORIENTATION] Skipped ${skippedOrientationCount} upright Mark Scheme / corrupted page(s).`);
            }

            const ORIENTATION_BATCH_SIZE = 8;
            for (let b = 0; b < orientationTargets.length; b += ORIENTATION_BATCH_SIZE) {
                const batch = orientationTargets.slice(b, b + ORIENTATION_BATCH_SIZE);
                await Promise.all(batch.map(async (page) => {
                    // Convert base64 to buffer for Vision API
                    const base64Data = page.imageData.replace(/^data:image\/\w+;base64,/, '');
                    const imageBuffer = Buffer.from(base64Data, 'base64');

                    const rotationNeeded = await GoogleVisionService.detectOrientation(imageBuffer);

                    if (rotationNeeded > 0) {
                        console.log(`🔄 [VISION ORIENTATION] Page ${page.pageIndex} needs ${rotationNeeded} degrees. Rotating...`);
                        const rotatedBuffer = await ImageUtils.rotateImage(page.imageData, rotationNeeded);
                        const mimeType = page.imageData.startsWith('data:') ? page.imageData.split(';')[0] : 'data:image/jpeg';
                        page.imageData = `${mimeType};base64,${rotatedBuffer.toString('base64')}`;

                        // Refresh dimensions after physical rotation
                        if (rotationNeeded === 90 || rotationNeeded === 270) {
                            const temp = page.width;
                            page.width = page.height;
                            page.height = temp;
                        }
                    }

                    // Overlap Tier 2 (800px WebP) generation immediately after each page's orientation check resolves
                    (page as any)._lightweightImageData = await ImageUtils.createLightweightCopy(page.imageData, 800);
                }));
            }
            logOrientationComplete();

            // --- 2. AI Semantic Geometry & Quality Check ---
            progressCallback(createProgressData(2, `Running semantic quality check on ${standardizedPages.length} image(s)...`, MULTI_IMAGE_STEPS));
            const logGeometryComplete = logStep('Semantic Geometry Check', 'FAST (HARDCODED)');
            
            const newStandardizedPages: StandardizedPage[] = [];
            const newLightweightPages: StandardizedPage[] = [];
            let pagesEjected = deferredSchemePdfFiles.length > 0;
            const interceptedSchemeImages: string[] = [];
            
            // --- 1.5 Create Tier 2 (Low-Res WEBP) for Gemini ---
            // Reuse pre-generated _lightweightImageData from Vision Orientation batch, or generate for skipped upright pages
            let lightweightPages = await Promise.all(
                standardizedPages.map(async page => {
                    const precomputedLight = (page as any)._lightweightImageData;
                    delete (page as any)._lightweightImageData;
                    return {
                        ...page,
                        imageData: (page as any)._isSolidBlackCorrupted
                            ? page.imageData
                            : (precomputedLight || await ImageUtils.createLightweightCopy(page.imageData, 800))
                    };
                })
            );

            const geometryResults = await Promise.all(
                lightweightPages.map(async (page, idx) => {
                    if ((standardizedPages[idx] as any)._isSolidBlackCorrupted) {
                        return {
                            is_acceptable_quality: false,
                            rejection_reason: 'Image is blank or solid black due to browser memory limits during upload.',
                            needs_rotation: 0,
                            is_two_page_spread: false,
                            is_marking_scheme: false,
                            is_supported_doc: false
                        };
                    }
                    return ImageGeometryService.analyze(page.imageData, page.width, page.height, 'fast', usageTracker);
                })
            );

            let lastRejectionReason = 'Image is blurry, blank, unreadable, or not mathematics content.';

            // 🛡️ [SPREAD CONSISTENCY SWEEP]:
            // If >= 50% of student images in a multi-image upload (at least 3 student images) are 2-page booklet spreads,
            // any remaining landscape student image (width > height * 1.1, e.g. Page 0 with Cover + Page 2)
            // that missed spread detection due to lacking a dark center crease is also a 2-page spread.
            // Note: Exclude Marking Scheme pages so a 29-page portrait Mark Scheme PDF does not dilute the student spread ratio!
            const isPageLandscape = (p?: StandardizedPage) =>
                Boolean(p?.width && p?.height && p.width > p.height * 1.1);

            const nonSchemeIndices = standardizedPages
                .map((_, idx) => idx)
                .filter(idx => !geometryResults[idx]?.is_marking_scheme);
            const spreadCount = nonSchemeIndices.filter(
                idx => geometryResults[idx]?.is_two_page_spread && isPageLandscape(standardizedPages[idx])
            ).length;
            const isMajoritySpreadBatch =
                nonSchemeIndices.length >= 3 && (spreadCount / nonSchemeIndices.length) >= 0.5;

            // 🛡️ [BYOMS DETECTION & DOCUMENT-LEVEL SUBJECT CONSENSUS]:
            // Check if any uploaded page in the batch is a Marking Scheme (or if a custom marking scheme was provided).
            // When a Marking Scheme is present, Universal BYOMS mode is enabled for any academic subject!
            const allowGenericSubject = Boolean(
                options.allowGenericSubjectMarking ||
                req.body?.allowGenericSubjectMarking === true ||
                req.body?.allowGenericSubjectMarking === 'true'
            );

            let hasUploadedMarkingScheme =
                deferredSchemePdfFiles.length > 0 ||
                geometryResults.some(g => g?.is_marking_scheme === true) ||
                Boolean(options.markingScheme);

            const isMultiPageUpload = standardizedPages.length >= 2;
            const unsupportedPageResults = geometryResults.filter(
                g => g && g.is_acceptable_quality !== false && g.is_supported_doc === false && !g.is_marking_scheme &&
                g.detected_subject !== 'NON_ACADEMIC' &&
                !/not educational|please upload an academic exam|non-academic/i.test(g.rejection_reason || '') &&
                (g.detected_subject === 'ENGLISH_LITERATURE' ||
                 (g.detected_subject === 'UNSUPPORTED_SUBJECT' && isRecognizedAcademicSubject(g.unsupported_subject_name)))
            );
            const nonSchemePageCount = Math.max(1, geometryResults.filter(g => !g?.is_marking_scheme).length);
            const unsupportedRatio = unsupportedPageResults.length / nonSchemePageCount;

            // 📚 [AUTO-CATALOGED OFFICIAL SCHEME LOOKUP]:
            // If an unsupported subject (e.g. Biology 8461/1H) is uploaded WITHOUT a marking scheme,
            // check if an official marking scheme for this paperCode already exists in Firestore `markingSchemes`!
            if (!hasUploadedMarkingScheme && unsupportedPageResults.length > 0) {
                try {
                    const combinedGeoHints = [
                        ...geometryResults.map(g => g?.paper_code_hint || ''),
                        ...geometryResults.map(g => g?.evidence_text_snippet || ''),
                        ...(Array.isArray(files) ? files.map(f => f?.originalname || '') : []),
                        options.customText || ''
                    ].filter(Boolean).join(' ');
                    const primarySubjName = unsupportedPageResults[0]?.unsupported_subject_name || undefined;
                    const seriesMatch = combinedGeoHints.match(/\b((?:June|May|Summer|November|Autumn|January|Winter)\s+20\d{2}|20\d{2})\b/i);
                    const { MarkingSchemeParserService } = await import('./MarkingSchemeParserService.js');
                    const catalogedScheme = await MarkingSchemeParserService.findCatalogedSchemeByPaperHint(
                        combinedGeoHints,
                        primarySubjName,
                        seriesMatch?.[1]
                    );
                    if (catalogedScheme) {
                        inputMarkingScheme = catalogedScheme;
                        hasUploadedMarkingScheme = true;
                        console.log(
                            `📚 [AUTO-CATALOG SCHEME] Found official ${catalogedScheme.examDetails?.subject || primarySubjName} marking scheme in DB for "${catalogedScheme.examDetails?.paperCode}" (${catalogedScheme.examDetails?.exam_series || 'N/A'})! Grading automatically without requiring user mark scheme upload.`
                        );
                    }
                } catch (catalogLookupErr) {
                    // Non-fatal: proceed with standard unsupported subject handling
                }
            }

            if (allowGenericSubject && unsupportedPageResults.length > 0) {
                const primarySubjName = unsupportedPageResults[0]?.unsupported_subject_name || undefined;
                if (!options.subject && primarySubjName) {
                    options.subject = primarySubjName;
                }
                geometryResults.forEach(g => {
                    if (g && (g.detected_subject === 'UNSUPPORTED_SUBJECT' || g.detected_subject === 'ENGLISH_LITERATURE')) {
                        g.is_supported_doc = true;
                    }
                });
                console.log(
                    `🤖 [GENERIC SUBJECT MODE] User opted into AI marking with general rubric (${options.subject || 'General'}) without an official scheme. Unblocking ${unsupportedPageResults.length} page(s)...`
                );
            }

            if (!hasUploadedMarkingScheme && !allowGenericSubject && isMultiPageUpload && (unsupportedPageResults.length >= 2 || unsupportedRatio >= 0.4)) {
                const primaryUnsupported = unsupportedPageResults.find(g => g.rejection_reason && g.rejection_reason.trim()) || unsupportedPageResults[0];
                const consensusRejectionReason = primaryUnsupported?.rejection_reason ||
                    'The uploaded document belongs to an unsupported subject (e.g. Sciences, Humanities, or English Literature). AI Marking currently supports GCSE & A-Level Mathematics and GCSE English Language with official mark schemes and grade boundaries.';

                console.log(
                    `🛡️ [SUBJECT CONSENSUS] Multi-page document consensus triggered (${unsupportedPageResults.length}/${standardizedPages.length} pages flagged as unsupported). Marking entire upload as unsupported: "${consensusRejectionReason}"`
                );

                geometryResults.forEach(g => {
                    if (g && !g.is_marking_scheme) {
                        g.is_supported_doc = false;
                        g.rejection_reason = consensusRejectionReason;
                        if (primaryUnsupported?.detected_subject) {
                            g.detected_subject = primaryUnsupported.detected_subject;
                        }
                        if (primaryUnsupported?.unsupported_subject_name) {
                            g.unsupported_subject_name = primaryUnsupported.unsupported_subject_name;
                        }
                    }
                });
                lastRejectionReason = consensusRejectionReason;
            } else if ((hasUploadedMarkingScheme || allowGenericSubject) && unsupportedPageResults.length > 0) {
                console.log(
                    `🛡️ [${hasUploadedMarkingScheme ? 'BYOMS' : 'GENERIC SUBJECT'} MODE] ${hasUploadedMarkingScheme ? 'Uploaded Marking Scheme' : 'General AI Rubric'} enabled alongside ${unsupportedPageResults.length} non-Maths/English page(s). Enabling Universal Subject Marking!`
                );
            }

            for (let i = 0; i < standardizedPages.length; i++) {
                const stdPage = standardizedPages[i];
                const lightPage = lightweightPages[i];
                const geo = geometryResults[i];

                // 1. Always drop unreadable / non-educational junk pages
                if (!geo.is_acceptable_quality) {
                    lastRejectionReason = geo.rejection_reason || lastRejectionReason;
                    const evidence = geo.evidence_text_snippet ? `\n   📄 Evidence: "${geo.evidence_text_snippet}"` : "";
                    if (process.env.DEBUG_SEMANTIC_GEOMETRY === 'true') {
                        console.warn(`⚠️ [GEOMETRY] Dropping Page ${stdPage.pageIndex + 1} (quality check): ${lastRejectionReason}${evidence}`);
                    }
                    continue;
                }

                // 2. 🛡️ THE INTERCEPTOR: Always eject marking scheme pages BEFORE subject rejection
                if (geo.is_marking_scheme) {
                    console.log(`📄 [INTERCEPTOR] Page ${stdPage.pageIndex} is a Marking Scheme`);
                    pagesEjected = true;
                    interceptedSchemeImages.push(stdPage.imageData);
                    continue; // Skip pushing to student pages (exempt from student page quota)
                }

                // 3. Reject unsupported subjects ONLY when NO marking scheme was uploaded AND user did not opt into general rubric
                if (geo.is_supported_doc === false && !hasUploadedMarkingScheme && !allowGenericSubject) {
                    const rawReason = (geo.rejection_reason || '').trim();
                    lastRejectionReason = rawReason || 'The uploaded document belongs to an unsupported subject or does not contain supported exam content. AI Marking currently supports GCSE & A-Level Mathematics and GCSE English Language.';
                    
                    const reason = lastRejectionReason;
                    const evidence = geo.evidence_text_snippet ? `\n   📄 Evidence: "${geo.evidence_text_snippet}"` : "";
                    if (process.env.DEBUG_SEMANTIC_GEOMETRY === 'true') {
                        console.warn(`⚠️ [GEOMETRY] Dropping Page ${stdPage.pageIndex + 1} from grading pipeline: ${reason}${evidence}`);
                    }
                    
                    continue; // Gracefully filter out the unsupported page
                }

                const isLandscapeAspect = isPageLandscape(stdPage);
                if (geo.is_two_page_spread && !isLandscapeAspect) {
                    console.log(
                        `🛡️ [GEOMETRY GUARD] Ignoring false-positive 2-page spread on Portrait Page ${stdPage.pageIndex} (${stdPage.width}x${stdPage.height}).`
                    );
                }
                const shouldSplitSpread = Boolean(isLandscapeAspect && (geo.is_two_page_spread || isMajoritySpreadBatch));

                // Handle 2-page spread splitting
                if (shouldSplitSpread) {
                    console.log(`✂️ [GEOMETRY] Splitting 2-page spread for Page ${stdPage.pageIndex}${!geo.is_two_page_spread ? ' (Batch Landscape Spread Sweep)' : ''}.`);
                    const splitStdImages = await ImageUtils.splitImageVertically(stdPage.imageData);
                    // Generate full 800px lightweight copies from each split half-page (instead of cutting an 800px image into two tiny 400px halves!)
                    const splitLightImages = await Promise.all([
                        ImageUtils.createLightweightCopy(splitStdImages[0], 800),
                        ImageUtils.createLightweightCopy(splitStdImages[1], 800)
                    ]);
                    
                    newStandardizedPages.push({ ...stdPage, imageData: splitStdImages[0], width: Math.round((stdPage.width || 0) / 2) }); // Left (Canonical)
                    newStandardizedPages.push({ ...stdPage, imageData: splitStdImages[1], width: Math.round((stdPage.width || 0) / 2) }); // Right (Canonical)
                    
                    newLightweightPages.push({ ...lightPage, imageData: splitLightImages[0], width: Math.round((lightPage.width || 0) / 2) }); // Left (Lightweight 800px)
                    newLightweightPages.push({ ...lightPage, imageData: splitLightImages[1], width: Math.round((lightPage.width || 0) / 2) }); // Right (Lightweight 800px)
                } else {
                    newStandardizedPages.push(stdPage);
                    newLightweightPages.push(lightPage);
                }
            }

            // 🛡️ [PURE MARKING SCHEME SWEEP]:
            // If >= 75% of pages from a single multi-page source file (with at least 3 pages) were flagged as a Marking Scheme,
            // any remaining 1-2 pages from that same file are almost certainly diagram/formula pages of the scheme itself
            // that suffered a false negative. Sweep them into interceptedSchemeImages so they aren't graded as student work!
            if (interceptedSchemeImages.length >= 2 && newStandardizedPages.length > 0) {
                const getFileKey = (p: StandardizedPage) => `${(p as any)._sourceIndex ?? 'img'}_${p.originalFileName || 'default'}`;

                const fileStats = new Map<string, { total: number; scheme: number; name: string }>();
                for (let i = 0; i < standardizedPages.length; i++) {
                    const key = getFileKey(standardizedPages[i]);
                    const stat = fileStats.get(key) || { total: 0, scheme: 0, name: standardizedPages[i].originalFileName || 'default' };
                    stat.total++;
                    if (geometryResults[i]?.is_marking_scheme) {
                        stat.scheme++;
                    }
                    fileStats.set(key, stat);
                }

                const pureSchemeFileKeys = new Set<string>();
                fileStats.forEach((stat, key) => {
                    if (stat.total >= 3 && (stat.scheme / stat.total) >= 0.75) {
                        pureSchemeFileKeys.add(key);
                        console.log(`🧹 [INTERCEPTOR SWEEP] File "${stat.name}" is ${(stat.scheme / stat.total * 100).toFixed(0)}% Marking Scheme (${stat.scheme}/${stat.total}). Sweeping remaining leaked pages into scheme parser.`);
                    }
                });

                if (pureSchemeFileKeys.size > 0) {
                    const filteredStd: StandardizedPage[] = [];
                    const filteredLight: StandardizedPage[] = [];
                    for (let i = 0; i < newStandardizedPages.length; i++) {
                        const page = newStandardizedPages[i];
                        if (pureSchemeFileKeys.has(getFileKey(page))) {
                            console.log(`📄 [INTERCEPTOR SWEEP] Ejecting leaked scheme page ${page.pageIndex} from "${page.originalFileName}"`);
                            pagesEjected = true;
                            interceptedSchemeImages.push(page.imageData);
                        } else {
                            filteredStd.push(page);
                            filteredLight.push(newLightweightPages[i]);
                        }
                    }
                    newStandardizedPages.length = 0;
                    newStandardizedPages.push(...filteredStd);
                    newLightweightPages.length = 0;
                    newLightweightPages.push(...filteredLight);
                }
            }

            // If ALL pages were ejected because the user ONLY uploaded a Marking Scheme (no student work or questions):
            if (newStandardizedPages.length === 0 && interceptedSchemeImages.length > 0) {
                lastRejectionReason = 'It looks like you uploaded a Marking Scheme without any exam questions or student answers! Please upload your question paper or handwritten answers along with the marking scheme so I can grade them.';
            }

            // CRITICAL FIX: We MUST re-assign pageIndex = index for ALL files (PDFs and Images).
            // A previous developer incorrectly assumed the frontend uses a native PDF viewer that relies on physical page mapping.
            // In reality, PDFs are rasterized into images and the frontend displays the annotated *images*.
            // If we don't re-index after splitting/ejecting, downstream AI passes collapse duplicate indices, causing a fatal Merge Mismatch.
            standardizedPages = newStandardizedPages.map((page, index) => ({
                ...page,
                pageIndex: index
            }));
            
            lightweightPages = newLightweightPages.map((page, index) => ({
                ...page,
                pageIndex: index
            }));

            if (standardizedPages.length === 0) {
                console.log(`⚠️ [PIPELINE] All pages rejected by Geometry check. Short-circuiting gracefully.`);
                progressCallback(createProgressData(2, 'Content rejected by quality inspector.', MULTI_IMAGE_STEPS));

                const academicSubjectPages = geometryResults.filter(
                    g => g && g.is_acceptable_quality !== false && g.is_supported_doc === false &&
                    g.detected_subject !== 'NON_ACADEMIC' &&
                    !/not educational|please upload an academic exam|non-academic/i.test(g.rejection_reason || '') &&
                    (g.detected_subject === 'ENGLISH_LITERATURE' ||
                     (g.detected_subject === 'UNSUPPORTED_SUBJECT' && isRecognizedAcademicSubject(g.unsupported_subject_name)))
                );
                const academicSubjectGeo = academicSubjectPages[0];

                const nonAcademicPages = geometryResults.filter(g => g && (
                    g.detected_subject === 'NON_ACADEMIC' ||
                    /not educational|please upload an academic exam|non-academic|invoice|receipt|selfie/i.test(g.rejection_reason || '')
                ));

                // A document is non-educational ONLY when no recognized academic subject pages were detected
                const isNonEducational =
                    academicSubjectPages.length === 0 && (
                        /not educational|please upload an academic exam|non-academic|invoice|receipt|selfie/i.test(lastRejectionReason) ||
                        nonAcademicPages.length > 0
                    );

                const isUnsupportedWithoutScheme =
                    !isNonEducational &&
                    interceptedSchemeImages.length === 0 &&
                    Boolean(academicSubjectGeo);

                const detectedAcademicSubjectName = academicSubjectGeo?.detected_subject === 'ENGLISH_LITERATURE'
                    ? 'English Literature'
                    : (academicSubjectGeo?.unsupported_subject_name || 'this subject');

                // Only trigger Admin Alert email when NO marking scheme was uploaded and NOT educational content
                if (interceptedSchemeImages.length === 0 && !isUnsupportedWithoutScheme) {
                    void AdminAlertService.notifyCrash('MARKING', req, new Error(lastRejectionReason));
                }

                // If rejected due to an unsupported subject without a marking scheme, guide the user to attach their mark scheme
                const guidedRejectionReason = isUnsupportedWithoutScheme
                    ? formatMarkSchemeRequiredMessage(detectedAcademicSubjectName)
                    : (lastRejectionReason || 'Not educational exam content: Please upload an academic exam question or student homework.');

                // Persist the rejected session so it shows in Library and chat history
                try {
                    const uploadResult = await SessionManagementService.uploadOriginalFiles(
                        files,
                        userId || 'anonymous',
                        submissionId,
                        !!userId,
                        pdfContext
                    );
                    const { structuredImageDataArray, structuredPdfContexts } = SessionManagementService.createStructuredData(
                        files,
                        isPdf,
                        isMultiplePdfs || isMixedUpload,
                        pdfContext
                    );
                    const userMessage = SessionManagementService.createUserMessageForDatabase(
                        {
                            content: options.customText || 'Uploaded document for analysis',
                            files,
                            isPdf,
                            isMultiplePdfs: isMultiplePdfs || isMixedUpload,
                            sessionId: options.sessionId || submissionId,
                            model: actualModel,
                            pdfContext
                        },
                        structuredImageDataArray,
                        structuredPdfContexts,
                        uploadResult.originalImageLinks
                    );
                    
                    const aiMessage: any = createAIMessage({
                        content: guidedRejectionReason || 'The uploaded image could not be processed because it is blurry, unreadable, or does not contain educational content.',
                        messageId: req.body?.aiMessageId
                    });
                    if (isUnsupportedWithoutScheme) {
                        aiMessage.requiresMarkingScheme = true;
                    }

                    const markingContext: MarkingSessionContext = {
                        req,
                        submissionId,
                        startTime,
                        userMessage,
                        aiMessage,
                        questionDetection: options.markingScheme,
                        // 🛡️ SAFE TITLE FALLBACK: Use custom text, OR the filename, OR a safe default
                        globalQuestionText: options.customText || (files && files[0] ? files[0].originalname : 'Rejected Document'),
                        mode: 'Question', // Fallback to Question Mode so no marking UI is rendered
                        allQuestionResults: [],
                        files,
                        usageTokens: usageTracker.getTotalTokens(),
                        apiRequests: usageTracker.getTotalRequests(),
                        model: actualModel,
                        mathpixCallCount: 0, // Bypassed Mathpix!
                        totalCost: usageTracker.calculateCost(actualModel).total,
                        detectionResults: []
                    };

                    const sessionResult = await SessionManagementService.persistMarkingSession(markingContext);
                    
                    const finalOutput = {
                        success: true,
                        submissionId,
                        mode: 'Question',
                        sessionId: sessionResult.sessionId,
                        sessionTitle: sessionResult.sessionTitle,
                        unifiedSession: sessionResult.unifiedSession,
                        aiMessage,
                        requiresMarkingScheme: isUnsupportedWithoutScheme,
                        annotatedOutput: [],
                        results: [],
                        warning: "CONTENT_REJECTED",
                        processingStats: {
                            totalLLMTokens: usageTracker.getTotalTokens(),
                            mathpixCalls: 0
                        },
                        // Attach the PDF/File context so the frontend renders the user's upload card
                        ...(pdfContext && {
                            originalFileType: pdfContext.originalFileType,
                            originalPdfLink: pdfContext.originalPdfLink,
                            originalPdfDataUrl: pdfContext.originalPdfDataUrl,
                            originalFileName: pdfContext.originalFileName,
                            ...(pdfContext.pdfContexts && {
                                pdfContexts: pdfContext.pdfContexts
                            })
                        })
                    };

                    progressCallback({ type: 'complete', result: finalOutput });
                    console.log(`✅ [EARLY EXIT] Persisted rejected session: ${sessionResult.sessionId} | Reason: ${lastRejectionReason}`);
                    return finalOutput;

                } catch (persistError) {
                    console.error('❌ [EARLY EXIT] Failed to persist rejected session:', persistError);
                    throw new Error(lastRejectionReason); // Fallback to hard crash if database fails
                }
            }

            logGeometryComplete();

            // --- Post-Geometry Input Page & Credit Gating (Mark Scheme & ejected pages are exempt!) ---
            const studentRawPageCount = new Set(
                standardizedPages.map(p => (p as any)._rawPageIndex ?? p.pageIndex)
            ).size;
            console.log(`📊 [PAGE GATING] User ${userId || 'anonymous'} (${userPlan}): ${studentRawPageCount} student page(s) to grade (${standardizedPages.length} post-split page(s), ${interceptedSchemeImages.length} mark scheme page(s) exempted).`);

            // 1. Check Product Tier & Upload Limits (excluding Mark Scheme pages)
            if (isFreeUser && studentRawPageCount > MAX_FREE_PAGES) {
                throw new Error(`Free accounts are limited to grading ${MAX_FREE_PAGES} pages at a time. Upgrade to Pro to grade full past papers.`);
            }
            if (studentRawPageCount > MAX_PAGES_LIMIT) {
                throw new Error(`Total upload exceeds the maximum limit of ${MAX_PAGES_LIMIT} pages/images. Processed ${studentRawPageCount} pages.`);
            }

            // 2. Check Financial Limits (only charge estimated cost for student/question pages, never Mark Scheme pages)
            if (userId && userId !== 'anonymous') {
                const exactEstimatedCost = studentRawPageCount * 0.020; // $0.02 per student page (Mathpix + Gemini tokens)
                const creditCheck = await checkCredits(userId, exactEstimatedCost, userPlan);

                if (!creditCheck.canProceed) {
                    throw new Error(creditCheck.warning);
                }
            }

            // 🚀 [BACKGROUND ORIGINAL FILE UPLOAD]:
            // Start uploading original files in the background right after page & credit gating passes,
            // so Firebase Storage uploads run concurrently with Classification, OCR, and Marking instead of blocking ~35s at the end!
            const preUploadedOriginalFilesPromise = isAuthenticated
                ? SessionManagementService.uploadOriginalFiles(
                    files,
                    userId || 'anonymous',
                    submissionId,
                    true,
                    pdfContext
                )
                : undefined;

            // --- Preprocessing (Common for Multi-Page PDF & Multi-Image) ---
            progressCallback(createProgressData(2, `Preprocessing ${standardizedPages.length} image(s)...`, MULTI_IMAGE_STEPS));
            const logPreprocessingComplete = logStep('Preprocessing', 'image-processing');
            const preprocessedResults = await Promise.all(
                standardizedPages.map(page => ImageUtils.preProcessWithMetadata(page.imageData))
            );

            // Update image data and dimensions directly from single-pass Sharp output (avoids decoding 24 WebPs a second time)
            for (let i = 0; i < standardizedPages.length; i++) {
                const page = standardizedPages[i];
                const { imageData: displayImageData, ocrImageData, width: newW, height: newH } = preprocessedResults[i];
                page.imageData = displayImageData;
                if (ocrImageData) {
                    (page as any).ocrImageData = ocrImageData;
                }
                if (newW && newH) {
                    if (page.width !== newW || page.height !== newH) {
                        console.log(`📐 [DIMENSIONS] Refreshed Page ${page.pageIndex} dimensions after preprocessing: ${page.width}x${page.height} -> ${newW}x${newH}`);
                        page.width = newW;
                        page.height = newH;
                    }
                }
            }

            progressCallback(createProgressData(2, 'Image preprocessing complete.', MULTI_IMAGE_STEPS));
            logPreprocessingComplete();

            // ========================= START: IMPLEMENT STAGE 2 =========================
            // --- Stage 2: Parallel OCR/Classify (Common for Multi-Page PDF & Multi-Image) ---

            // --- 🧭 EARLY SUBJECT ROUTING (BEFORE CLASSIFICATION & STAGE 3 OCR) ---
            const geoSubjectVote = geometryResults
                .filter(g => !g?.is_marking_scheme)
                .map(g => g?.detected_subject)
                .find(s => s === 'ENGLISH_LANGUAGE' || s === 'ENGLISH_LITERATURE' || s === 'UNSUPPORTED_SUBJECT');
            const customSchemeSubject = (inputMarkingScheme as any)?.examDetails?.subject;
            const geoPaperCodeHint = geometryResults
                .map(g => g?.paper_code_hint)
                .filter(Boolean)
                .join(' ');
            const uploadedFileNames = Array.isArray(files) ? files.map(f => f?.originalname || '') : [];

            let subjectProfile: SubjectProfile = resolveSubjectProfile({
                detectedSubject: geoSubjectVote,
                subject: customSchemeSubject,
                paperCode: geoPaperCodeHint || (inputMarkingScheme as any)?.examDetails?.paperCode,
                customText: options.customText,
                fileNames: uploadedFileNames
            });

            progressCallback(createProgressData(3, `Running Classification on ${lightweightPages.length} pages...`, MULTI_IMAGE_STEPS));

            // --- Perform Classification on ALL Images (Question & Student Work) ---
            const logClassificationComplete = logStep('Classification', actualModel);

            // Classify ALL images at once for better cross-page context (solves continuation page question number detection)
            // 🛑 CRITICAL: We pass the lightweightPages (Tier 2) which was already generated before Semantic Geometry
            // This prevents Gemini from doing massive inference on 2000px Mathpix images.
            let allClassificationResults = await ClassificationService.classifyMultipleImages(
                lightweightPages,
                actualModel as ModelType,  // Cast to ModelType
                debugClassification,  // debug (controlled by ENV)
                usageTracker,  // Pass tracker for auto-recording
                subjectProfile.ocrStrategy === 'VISION_VERBATIM'
            );

            logClassificationComplete();

            // Refine subjectProfile using extracted classification question text BEFORE Stage 3 OCR runs
            if (subjectProfile.key === 'MATHS') {
                const classTextSample = allClassificationResults
                    .flatMap(r => r.result?.questions || [])
                    .map((q: any) => `${q.text || ''} ${q.questionText || ''}`)
                    .join(' ')
                    .substring(0, 2000);
                if (classTextSample.trim()) {
                    subjectProfile = resolveSubjectProfile({
                        detectedSubject: geoSubjectVote,
                        paperCode: geoPaperCodeHint,
                        customText: options.customText,
                        fileNames: uploadedFileNames,
                        rawTextHint: classTextSample
                    });
                }
            }

            console.log(
                `🧭 [SUBJECT-ROUTER] Paper="${geoPaperCodeHint || uploadedFileNames[0] || 'Upload'}" -> Profile="${subjectProfile.key}" | Paradigm="${subjectProfile.paradigm}" | OCR="${subjectProfile.ocrStrategy}"`
            );

            // --- 🛡️ BLANK CONTINUATION / OVERFLOW PAGE FILTER ---
            // 1. Collect all base question numbers (e.g. "15" from "15a") that have actual student work
            const answeredBaseQuestions = new Set<string>();
            for (const item of allClassificationResults) {
                if (item.result?.category === 'questionAnswer' && Array.isArray(item.result?.questions)) {
                    for (const q of item.result.questions) {
                        const baseNum = String(q.questionNumber || '').replace(/[^0-9]/g, '');
                        if (baseNum) answeredBaseQuestions.add(baseNum);
                    }
                }
            }

            // Helper to detect if extracted question text is just a "Question X continued" or English booklet "Extra space" stub
            const isContinuationStubText = (text?: string): boolean => {
                if (!text) return true;
                let cleaned = text
                    .replace(/question\s*\d+[a-z0-9().\s]*continued\.?/gi, '')
                    .replace(/turn\s+over/gi, '')
                    .replace(/leave\s+blank/gi, '')
                    .replace(/do\s+not\s+write\s+(in\s+|outside\s+)?this\s+(area|box)/gi, '')
                    .replace(/total\s+for\s+question\s+\d+\s+is\s+\d+\s+marks?/gi, '');

                for (const pattern of subjectProfile.overflowBoilerplatePatterns) {
                    cleaned = cleaned.replace(new RegExp(pattern.source, 'gi'), '');
                }
                cleaned = cleaned.trim();
                // If nothing meaningful remains after stripping continuation boilerplate, it's a blank overflow sheet
                return cleaned.length < 10;
            };

            // 2. Inspect questionOnly pages and reclassify blank overflow/continuation pages to 'metadata'
            for (const item of allClassificationResults) {
                if (item.result?.category === 'questionOnly') {
                    const questions = Array.isArray(item.result.questions) ? item.result.questions : [];

                    // Filter out individual question stubs that are just "Question X continued" or already answered on an earlier page
                    const realUnansweredQuestions = questions.filter((q: any) => {
                        const qText = q.text || q.questionText || '';
                        const subQuestions = Array.isArray(q.subQuestions) ? q.subQuestions : [];
                        const hasSubQuestionText = subQuestions.some((sq: any) => !isContinuationStubText(sq.text || sq.questionText));
                        const baseNum = String(q.questionNumber || '').replace(/[^0-9]/g, '');

                        const isStub = isContinuationStubText(qText) && !hasSubQuestionText;
                        const isAlreadyAnsweredBaseQ = Boolean(baseNum && answeredBaseQuestions.has(baseNum) && isStub);

                        return !isStub && !isAlreadyAnsweredBaseQ;
                    });

                    if (realUnansweredQuestions.length === 0) {
                        console.log(
                            `🧹 [OVERFLOW-FILTER] Page ${item.pageIndex} classified as questionOnly has only continuation headers/stubs. Reclassifying to 'metadata'.`
                        );
                        item.result.category = 'metadata';
                        item.result.questions = [];
                    } else if (realUnansweredQuestions.length !== questions.length) {
                        item.result.questions = realUnansweredQuestions;
                    }
                }
            }

            // --- 🌟 SEPARATE ANSWER & HYBRID DONOR STEM HARVESTING ---
            // When a student writes answers on separate notebook pages (or partially on the booklet and
            // partially on notebook pages), `questionOnly` pages contain the printed question stems and
            // sub-question prompts for questions answered in `answeredBaseQuestions`.
            // 1. Harvest printed stems & sub-question texts from `questionOnly` pages into `donatedStemsByQNum`.
            // 2. If an entire uploaded source file has ZERO `questionAnswer` pages (a pure Reference Question Paper PDF)
            //    while other files have student work, eject all pages of that Reference Question Paper from
            //    `standardizedPages` and `allClassificationResults` so they are never OCR'd by Mathpix or rendered in output!
            // 3. In multi-page exams (> 3 pages) that have student work, reclassify any remaining `questionOnly`
            //    pages inside partially-answered booklets to `'metadata'` so `QuestionModeHandlerService` does not solve them.
            const donatedStemsByQNum = new Map<string, {
                text: string;
                subQuestionsMap: Map<string, string>;
                donorImageData?: string;
            }>();

            if (answeredBaseQuestions.size > 0) {
                for (const item of allClassificationResults) {
                    if (item.result?.category === 'questionOnly' && Array.isArray(item.result?.questions)) {
                        const donorPage = standardizedPages.find(p => p.pageIndex === item.pageIndex);
                        for (const q of item.result.questions) {
                            const baseNum = String(q.questionNumber || '').replace(/[^0-9]/g, '');
                            if (!baseNum || !answeredBaseQuestions.has(baseNum)) continue;

                            if (!donatedStemsByQNum.has(baseNum)) {
                                donatedStemsByQNum.set(baseNum, {
                                    text: '',
                                    subQuestionsMap: new Map<string, string>(),
                                    donorImageData: donorPage?.imageData
                                });
                            }
                            const entry = donatedStemsByQNum.get(baseNum)!;
                            const qText = (q.text || (q as any).questionText || '').trim();
                            if (qText && qText !== 'null' && qText.length > entry.text.length) {
                                entry.text = qText;
                            }

                            const harvestSubQuestions = (subs: any[], prefix: string = '') => {
                                if (!Array.isArray(subs)) return;
                                for (const sq of subs) {
                                    const rawPart = String(sq.part || '').replace(/[()\s]/g, '').toLowerCase();
                                    const fullPart = prefix ? `${prefix}${rawPart}` : rawPart;
                                    const sqText = (sq.text || (sq as any).questionText || '').trim();
                                    if (fullPart && sqText && sqText !== 'null') {
                                        const existingSqText = entry.subQuestionsMap.get(fullPart) || '';
                                        if (sqText.length > existingSqText.length) {
                                            entry.subQuestionsMap.set(fullPart, sqText);
                                        }
                                    }
                                    if (Array.isArray(sq.subQuestions)) {
                                        harvestSubQuestions(sq.subQuestions, fullPart);
                                    }
                                }
                            };
                            harvestSubQuestions(q.subQuestions);
                        }
                    }
                }

                // Detect Pure Reference Question Paper files (files with >= 2 pages and 0 `questionAnswer` pages)
                const getSourceFileKey = (p: StandardizedPage) =>
                    `${(p as any)._sourceIndex ?? 'img'}_${p.originalFileName || 'default'}`;

                const fileAnswerCounts = new Map<string, { total: number; answered: number; name: string }>();
                for (const page of standardizedPages) {
                    const key = getSourceFileKey(page);
                    const stat = fileAnswerCounts.get(key) || { total: 0, answered: 0, name: page.originalFileName || 'default' };
                    stat.total++;
                    const cls = allClassificationResults.find(r => r.pageIndex === page.pageIndex);
                    if (cls?.result?.category === 'questionAnswer') {
                        stat.answered++;
                    }
                    fileAnswerCounts.set(key, stat);
                }

                const hasAnsweredFile = Array.from(fileAnswerCounts.values()).some(s => s.answered > 0);
                const pureReferenceFileKeys = new Set<string>();
                if (hasAnsweredFile && fileAnswerCounts.size >= 2) {
                    fileAnswerCounts.forEach((stat, key) => {
                        if (stat.answered === 0 && stat.total >= 2) {
                            pureReferenceFileKeys.add(key);
                            console.log(
                                `📑 [SEPARATE-ANSWER DEMUX] Ejecting Reference Question Paper "${stat.name}" (${stat.total} pages, 0 student work) after harvesting ${donatedStemsByQNum.size} question stem(s).`
                            );
                        }
                    });
                }

                if (pureReferenceFileKeys.size > 0) {
                    const keptPages: StandardizedPage[] = [];
                    const keptClassifications: typeof allClassificationResults = [];
                    const oldToCompactedIdx = new Map<number, number>();

                    for (const page of standardizedPages) {
                        if (!pureReferenceFileKeys.has(getSourceFileKey(page))) {
                            const newIdx = keptPages.length;
                            oldToCompactedIdx.set(page.pageIndex, newIdx);
                            keptPages.push({ ...page, pageIndex: newIdx });
                        }
                    }

                    const remapNodePageIdx = (node: any, newIdx: number) => {
                        if (!node || typeof node !== 'object') return;
                        node.pageIndex = newIdx;
                        node.sourceImageIndex = newIdx;
                        node.sourceImageIndices = [newIdx];
                        if (Array.isArray(node.studentWorkLines)) {
                            node.studentWorkLines.forEach((l: any) => {
                                if (l && typeof l === 'object') {
                                    l.pageIndex = newIdx;
                                    if (l.position) l.position.pageIndex = newIdx;
                                }
                            });
                        }
                        if (Array.isArray(node.subQuestions)) {
                            node.subQuestions.forEach((sq: any) => remapNodePageIdx(sq, newIdx));
                        }
                    };

                    for (const cls of allClassificationResults) {
                        const newIdx = oldToCompactedIdx.get(cls.pageIndex);
                        if (newIdx !== undefined) {
                            if (Array.isArray(cls.result?.questions)) {
                                cls.result.questions.forEach((q: any) => remapNodePageIdx(q, newIdx));
                            }
                            keptClassifications.push({
                                ...cls,
                                pageIndex: newIdx
                            });
                        }
                    }

                    standardizedPages = keptPages;
                    allClassificationResults = keptClassifications;
                } else if (standardizedPages.length > 3) {
                    // Hybrid / Partially-Answered Booklet Case:
                    // Reclassify remaining `questionOnly` pages inside a partially-answered exam booklet (> 3 pages)
                    // to `'metadata'` so `QuestionModeHandlerService` does NOT solve unattempted exam questions.
                    // CRITICAL: Preserve question numbers in `mapperHints` before clearing `questions` so the Straightener
                    // knows their logical question order (e.g. Q15, Q16, Q17) and puts them at the END, not Page 0!
                    for (const item of allClassificationResults) {
                        if (item.result?.category === 'questionOnly') {
                            const existingQs = Array.isArray(item.result.questions)
                                ? item.result.questions.map((q: any) => String(q.questionNumber || '')).filter(Boolean)
                                : [];
                            if (existingQs.length > 0) {
                                (item.result as any).mapperHints = [
                                    ...new Set([...((item.result as any).mapperHints || []), ...existingQs])
                                ];
                            }
                            console.log(
                                `🧹 [HYBRID-BOOKLET] Reclassifying blank/donor exam page ${item.pageIndex} (Qs: ${existingQs.join(', ') || 'none'}) from 'questionOnly' to 'metadata'.`
                            );
                            item.result.category = 'metadata';
                            item.result.questions = [];
                        }
                    }
                }
            }

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
            // If >= 90% of the document has student work, treat the remaining questionOnly pages (that actually contain questions) as student work too
            // (Likely a neat drawing or subtle work the AI missed)
            const hasPageQuestions = (r: any) =>
                (Array.isArray(r.result?.questions) && r.result.questions.length > 0) ||
                (Array.isArray((r.result as any)?.mapperHints) && (r.result as any).mapperHints.length > 0);

            const nonMetadataPages = allClassificationResults.filter(r =>
                r.result?.category !== 'metadata' &&
                r.result?.category !== 'frontPage' &&
                (r.result?.category === 'questionAnswer' || hasPageQuestions(r))
            );
            const studentWorkPages = nonMetadataPages.filter(r => r.result?.category === 'questionAnswer');

            if (nonMetadataPages.length > 5 && (studentWorkPages.length / nonMetadataPages.length) >= 0.9) {
                console.log(`🚀 [OVERRIDE] 90% Rule Triggered: ${studentWorkPages.length}/${nonMetadataPages.length} pages have student work. Overriding questionOnly pages with questions to questionAnswer for consistency.`);
                allClassificationResults.forEach(r => {
                    if (r.result?.category === 'questionOnly') {
                        r.result.category = hasPageQuestions(r) ? 'questionAnswer' : 'frontPage';
                    }
                });
            } else if (nonMetadataPages.length > 2 && (studentWorkPages.length / nonMetadataPages.length) > 0.5) {
                // NEW: 50% Safety Rule
                console.log(`🚀 [OVERRIDE] 50% Rule Triggered: ${studentWorkPages.length}/${nonMetadataPages.length} pages have student work. Overriding questionOnly pages with questions to questionAnswer for consistency.`);
                allClassificationResults.forEach(r => {
                    if (r.result?.category === 'questionOnly') {
                        r.result.category = hasPageQuestions(r) ? 'questionAnswer' : 'frontPage';
                    }
                });
            }

            // Override 2: FrontPage → questionOnly ONLY when the entire upload is frontPage/metadata (0 student work AND 0 questionOnly pages with questions)
            const hasActualStudentWork = allClassificationResults.some(r => r.result?.category === 'questionAnswer');
            const hasQuestionPagesWithContent = allClassificationResults.some(r => r.result?.category === 'questionOnly' && hasPageQuestions(r));
            const hasFrontPages = allClassificationResults.some(r => r.result?.category === 'frontPage');

            if (!hasActualStudentWork && !hasQuestionPagesWithContent && hasFrontPages) {
                console.log('📄 [FRONTPAGE OVERRIDE] Pure cover/frontPage upload detected, converting frontPages to questionOnly for text-only response');
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
                            // Extract the entire base number (e.g. '12' from '12.1' or '12a')
                            const numMatch = String(qNum).match(/^(\d+)/);
                            const baseNumStr = numMatch ? numMatch[1] : String(qNum);
                            
                            if (!questionsByNumber.has(baseNumStr)) {
                                questionsByNumber.set(baseNumStr, []);
                            }
                            questionsByNumber.get(baseNumStr)!.push({
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

            // Helper to hydrate missing question & sub-question stems from donatedStemsByQNum
            const hydrateQuestionWithDonatedStems = (qObj: any, baseQNum: string) => {
                const donated = donatedStemsByQNum.get(baseQNum);
                if (!donated) return qObj;

                // Mark this question as residing on a separate handwritten answer sheet (no physical printed stem on page)
                qObj.isSeparateAnswerSheet = true;

                // 1. Hydrate main question stem if missing or contaminated/short on notebook page
                const currentText = (qObj.text && qObj.text !== 'null') ? String(qObj.text).trim() : '';
                if ((!currentText || currentText.length < 10) && donated.text) {
                    qObj.text = donated.text;
                }

                // 2. Hydrate existing sub-questions and inject any sub-question texts from the donor PDF
                const existingSubQs = Array.isArray(qObj.subQuestions) ? qObj.subQuestions : [];
                const normalizePartKey = (p: string) =>
                    String(p || '').replace(new RegExp(`^0*${baseQNum}`, 'i'), '').replace(/[()\s]/g, '').toLowerCase();

                existingSubQs.forEach((sq: any) => {
                    sq.isSeparateAnswerSheet = true;
                    const partKey = normalizePartKey(sq.part || '');
                    const donatedSqText = donated.subQuestionsMap.get(partKey);
                    const curSqText = (sq.text && sq.text !== 'null') ? String(sq.text).trim() : '';
                    if ((!curSqText || curSqText.length < 5) && donatedSqText) {
                        sq.text = donatedSqText;
                    }
                });

                // If the notebook question has no subQuestions array yet, but donatedStems has sub-question prompts,
                // attach them to qObj.text so both Question Detection and the Marking AI see the full sub-question wording & marks
                if (donated.subQuestionsMap.size > 0) {
                    const fullStemParts: string[] = [];
                    if (qObj.text && qObj.text !== 'null') fullStemParts.push(String(qObj.text).trim());
                    donated.subQuestionsMap.forEach((sqText, partKey) => {
                        const alreadyInMain = fullStemParts.some(p => p.toLowerCase().includes(sqText.toLowerCase().slice(0, 25)));
                        if (!alreadyInMain) {
                            fullStemParts.push(`(${partKey}) ${sqText}`);
                        }
                    });
                    qObj.text = fullStemParts.join('\n');
                }

                return qObj;
            };

            // Helper to check if a question instance on a page actually has student work
            const hasInstanceStudentWork = (q: any): boolean => {
                if (!q) return false;
                if (q.hasStudentDrawing === true) return true;
                if (Array.isArray(q.studentWorkLines) && q.studentWorkLines.length > 0) return true;
                if (q.studentWork && q.studentWork !== 'null' && String(q.studentWork).trim().length > 0) return true;
                if (Array.isArray(q.subQuestions)) {
                    return q.subQuestions.some((sq: any) => hasInstanceStudentWork(sq));
                }
                return false;
            };

            // Process merged questions
            questionsByNumber.forEach((questionInstances, questionNumber) => {
                if (questionInstances.length === 1) {
                    // Single page - hydrate with donated stems if needed
                    const { question, pageIndex } = questionInstances[0];
                    hydrateQuestionWithDonatedStems(question, questionNumber);
                    const page = standardizedPages.find(p => p.pageIndex === pageIndex);
                    allQuestions.push({
                        ...question,
                        sourceImage: page?.originalFileName || 'unknown',
                        sourceImageIndex: pageIndex
                    });
                } else {
                    // Multiple pages with same questionNumber - merge them
                    const isVerbatimProse = subjectProfile?.ocrStrategy === 'VISION_VERBATIM';
                    const isContaminatedStem = (q: any): boolean => {
                        if (!q || !q.text) return false;
                        const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        const stem = norm(q.text);
                        if (stem.length < 15) return false;
                        const work = norm((q.studentWorkLines || []).map((l: any) => l?.t || '').join(' ') || q.studentWork || '');
                        return work.length > 0 && work.includes(stem.slice(0, 40));
                    };

                    const sortedInstances = [...questionInstances].sort((a, b) => {
                        const textA = a.question.text || '';
                        const textB = b.question.text || '';

                        const isBlankA = textA.toUpperCase().includes('BLANK PAGE');
                        const isBlankB = textB.toUpperCase().includes('BLANK PAGE');
                        if (isBlankA && !isBlankB) return 1;
                        if (!isBlankA && isBlankB) return -1;

                        if (isVerbatimProse) {
                            const cA = isContaminatedStem(a.question);
                            const cB = isContaminatedStem(b.question);
                            if (cA && !cB) return 1;
                            if (!cA && cB) return -1;
                        }

                        return textB.length - textA.length;
                    });

                    const pageWithText = sortedInstances[0];

                    // 🛡️ ANCHOR FIX: Always anchor `sourceImageIndex` to the first page that has actual student work,
                    // NOT `pageWithText` (which may be a blank printed booklet page in hybrid mode).
                    const firstInstanceWithWork = questionInstances.find(inst => hasInstanceStudentWork(inst.question)) || pageWithText;
                    const anchorPageIndex = firstInstanceWithWork.pageIndex;

                    const combinedStudentWork = questionInstances
                        .map(({ question }) => question.studentWork)
                        .filter(sw => sw && sw !== 'null' && sw.trim().length > 0)
                        .join('\n');

                    const combinedParentLines: any[] = [];
                    questionInstances.forEach(({ question, pageIndex }) => {
                        if (question.studentWorkLines && Array.isArray(question.studentWorkLines)) {
                            question.studentWorkLines.forEach((line: any) => {
                                combinedParentLines.push({
                                    ...line,
                                    pageIndex: line.pageIndex !== undefined ? line.pageIndex : pageIndex
                                });
                            });
                        }
                    });

                    const mergedSubQuestionsMap = new Map<string, any>();
                    const subQuestionPageIndices = new Set<number>();

                    const mergeSubQuestionsRecursive = (existingMap: Map<string, any>, incomingSubQuestions: any[], pIdx: number) => {
                        incomingSubQuestions.forEach((subQ: any) => {
                            const part = subQ.part || '';
                            if (hasInstanceStudentWork(subQ)) {
                                subQuestionPageIndices.add(pIdx);
                            }

                            if (!existingMap.has(part)) {
                                existingMap.set(part, {
                                    ...subQ,
                                    pageIndex: pIdx,
                                    studentWorkLines: subQ.studentWorkLines || [],
                                    subQuestions: subQ.subQuestions ? [] : undefined
                                });
                            }

                            const existing = existingMap.get(part)!;

                            // Prefer anchoring sub-question pageIndex to the page that actually has student work
                            if (hasInstanceStudentWork(subQ) && (!existing.studentWorkLines || existing.studentWorkLines.length === 0)) {
                                existing.pageIndex = pIdx;
                            }

                            if (subQ.text && subQ.text !== 'null' && !existing.text) {
                                existing.text = subQ.text;
                            }

                            if (subQ.studentWork && subQ.studentWork !== 'null' && subQ.studentWork.trim().length > 0) {
                                if (existing.studentWork && !existing.studentWork.includes(subQ.studentWork)) {
                                    existing.studentWork += '\n' + subQ.studentWork;
                                } else if (!existing.studentWork) {
                                    existing.studentWork = subQ.studentWork;
                                }
                            }

                            if (subQ.studentWorkLines && Array.isArray(subQ.studentWorkLines)) {
                                subQ.studentWorkLines.forEach((newLine: any) => {
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

                            if (subQ.hasStudentDrawing) {
                                existing.hasStudentDrawing = true;
                                if (existing.studentWork && !existing.studentWork.includes('[DRAWING]')) {
                                    existing.studentWork += '\n[DRAWING]';
                                } else if (!existing.studentWork) {
                                    existing.studentWork = '[DRAWING]';
                                }
                            }

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

                    questionInstances.forEach(({ question, pageIndex }) => {
                        if (question.subQuestions && Array.isArray(question.subQuestions)) {
                            mergeSubQuestionsRecursive(mergedSubQuestionsMap, question.subQuestions, pageIndex);
                        }
                    });

                    // Only include pages that actually contain student work in `sourceImageIndices` if at least one exists
                    const workPageIndices = questionInstances
                        .filter(inst => hasInstanceStudentWork(inst.question))
                        .map(inst => inst.pageIndex);
                    const basePageIndices = workPageIndices.length > 0
                        ? workPageIndices
                        : questionInstances.map(({ pageIndex }) => pageIndex);
                    const allPageIndices = [...new Set([...basePageIndices, ...Array.from(subQuestionPageIndices)])].sort((a, b) => a - b);

                    const merged = {
                        ...pageWithText.question,
                        questionNumber: questionNumber,
                        text: pageWithText.question.text && pageWithText.question.text !== 'null'
                            ? pageWithText.question.text
                            : questionInstances[0].question.text,
                        studentWork: combinedStudentWork || firstInstanceWithWork.question.studentWork || null,
                        studentWorkLines: combinedParentLines.length > 0 ? combinedParentLines : (firstInstanceWithWork.question.studentWorkLines || []),
                        sourceImage: standardizedPages.find(p => p.pageIndex === anchorPageIndex)?.originalFileName || 'unknown',
                        sourceImageIndex: anchorPageIndex,
                        sourceImageIndices: allPageIndices,
                        subQuestions: mergedSubQuestionsMap.size > 0
                            ? finalizeSubQuestions(mergedSubQuestionsMap)
                            : firstInstanceWithWork.question.subQuestions || [],
                        confidence: Math.max(...questionInstances.map(({ question }) => question.confidence || 0.9))
                    };

                    hydrateQuestionWithDonatedStems(merged, questionNumber);
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
                const hasQuestions = classificationResult?.questions && classificationResult.questions.length > 0;

                // 🛑 Intercept Cover Pages or Non-Maths/Metadata Pages with 0 questions before they hit the handler
                if (!hasQuestions) {
                    const isCoverPage = (classificationResult as any)?.hasFrontPages === true ||
                        (classificationResult as any)?.category === 'frontPage' ||
                        (classificationResult as any)?.pages?.some((p: any) => p.category === 'frontPage');

                    console.log(`📄 [${isCoverPage ? 'COVER PAGE ONLY' : 'NO MATHS QUESTIONS'}] No questions found. Bypassing solver to return warning.`);

                    // 1. Create the proactive AI chat message
                    const uploadResult = await SessionManagementService.uploadOriginalFiles(
                        files,
                        userId || 'anonymous',
                        submissionId,
                        !!userId
                    );
                    const { structuredImageDataArray, structuredPdfContexts } = SessionManagementService.createStructuredData(
                        files,
                        isPdf,
                        isMultiplePdfs || isMixedUpload,
                        pdfContext
                    );
                    const userMessage = SessionManagementService.createUserMessageForDatabase(
                        {
                            content: options.customText || 'Uploaded document for analysis',
                            files,
                            isPdf,
                            isMultiplePdfs: isMultiplePdfs || isMixedUpload,
                            sessionId: options.sessionId || submissionId,
                            model: actualModel,
                            pdfContext
                        },
                        structuredImageDataArray,
                        structuredPdfContexts,
                        uploadResult.originalImageLinks
                    );

                    const earlyExitText = isCoverPage
                        ? "I see you've uploaded an exam cover page. To generate a grade, please upload the pages containing the student's handwritten answers. If you want to see how to solve a problem, just upload the question page!"
                        : "Not maths related image. No mathematics questions or student work were detected on the uploaded image. Please upload a mathematics question or student homework image.";

                    const aiMessage = createAIMessage({
                        content: earlyExitText,
                        messageId: req.body?.aiMessageId
                    });

                    // 2. Persist the session to Firestore so the chat panel actually loads it
                    const sessionResult = await SessionManagementService.persistMarkingSession({
                        req,
                        submissionId,
                        startTime,
                        userMessage,
                        aiMessage,
                        questionDetection: undefined,
                        globalQuestionText: options.customText || '',
                        mode: 'Question',
                        allQuestionResults: [],
                        files,
                        usageTokens: totalLLMTokens,
                        apiRequests: usageTracker.getTotalRequests(),
                        model: actualModel,
                        mathpixCallCount: usageTracker.getMathpixPages(),
                        totalCost: usageTracker.calculateCost(actualModel).total,
                        detectionResults: []
                    });

                    const finalOutput = {
                        success: true,
                        mode: 'Question',
                        sessionId: sessionResult.sessionId,
                        unifiedSession: sessionResult.unifiedSession,
                        aiMessage: sessionResult.unifiedSession?.messages?.find((m: any) => m.role === 'assistant') || aiMessage,
                        sessionTitle: sessionResult.unifiedSession?.title || (isCoverPage ? 'Cover Page' : 'Rejected Upload'),
                        annotatedOutput: [],
                        results: [],
                        warning: isCoverPage ? "COVER_PAGE_ONLY" : "NOT_MATHS_CONTENT"
                    };

                    // 3. Fire the complete event directly to the frontend UI
                    progressCallback({ type: 'complete', result: finalOutput });

                    console.log(`   - sessionId: ${finalOutput.sessionId}`);
                    console.log(`   - warning: ${finalOutput.warning} applied`);
                    
                    return finalOutput;
                }

                // ========================= ENHANCED QUESTION MODE (Normal Flow) =========================
                // If questions DO exist, proceed to the solver as normal
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
                            if (data.startsWith('data: ')) {
                                try {
                                    const jsonStr = data.substring(6);
                                    const parsed = JSON.parse(jsonStr);
                                    progressCallback(parsed);
                                } catch (e) {
                                    // Ignore parse errors
                                }
                            }
                        },
                        end: () => { }
                    } as any,
                    startTime,
                    logStep,
                    usageTracker
                });

                const pureQuestionResult: any = {
                    mode: 'Question',
                    sessionId: questionOnlyResult?.sessionId,
                    unifiedSession: questionOnlyResult?.unifiedSession,
                    message: questionOnlyResult?.message,
                    annotatedOutput: [],
                    results: []
                };

                return pureQuestionResult;
            }

            // ========================= ENHANCED MARKING MODE =========================
            // Marking mode: Handle mixed content with both marking and question analysis

            if (isMixedContent) {
                console.log(`🔄 [MIXED CONTENT] Processing ${standardizedPages.length} images with mixed content`);
                console.log(`  - Student work images: ${standardizedPages.filter((_, i) => allClassificationResults[i]?.result?.category === "questionAnswer").length}`);
                console.log(`  - Question-only images: ${standardizedPages.filter((_, i) => allClassificationResults[i]?.result?.category === "questionOnly").length}`);
            }

            // ========================= CLASSIFICATION-DRIVEN OCR ROUTING =========================
            // Identify which pages actually need OCR based on Gemini's classification
            let pagesToOcr: Set<number>;
            
            if (standardizedPages.length === 1) {
                // FIX: Single-image uploads MUST ALWAYS be OCR'd. Do not trust classification to drop them.
                pagesToOcr = new Set([0]);
                console.log(`🎯 [OCR ROUTING] Single image detected. Forcing OCR on the only page.`);
            } else if (allClassificationResults && allClassificationResults.length > 0) {
                // Surgical Routing: Only OCR pages that have questions or student work
                const validIndices = allClassificationResults
                    .filter(r => r.result?.category === 'questionAnswer' || r.result?.category === 'questionOnly')
                    .map(r => r.pageIndex);
                pagesToOcr = new Set(validIndices);
                console.log(`🎯 [OCR ROUTING] Surgical Mathpix routing: Skipping ${standardizedPages.length - pagesToOcr.size} non-exam pages.`);
            } else {
                // Fail-safe: If AI fails, OCR everything
                console.warn(`⚠️ [OCR ROUTING] Classification failed or returned empty! Defaulting to OCRing all ${standardizedPages.length} pages.`);
                pagesToOcr = new Set(standardizedPages.map(p => p.pageIndex));
            }

            // Build effective paper hint & extract questions from Classification BEFORE OCR so we can fast-check DB before LLM scheme parsing
            const fileNamePaperHintMatch = uploadedFileNames
                .join(' ')
                .match(/\b(1ma1|8300|8700|j560|9ma0)[-_\/]([0-9a-z]{1,3})\b/i);
            const fileNamePaperHint = fileNamePaperHintMatch
                ? `${fileNamePaperHintMatch[1].toUpperCase()}/${fileNamePaperHintMatch[2].toUpperCase()}`
                : undefined;
            const cleanGeoPaperHint = geoPaperCodeHint
                ? (geoPaperCodeHint.match(/\b([0-9A-Z]{4,6}\/[0-9A-Z]{1,3}|8700\/[12]|8300\/[123][FH]|1MA1\/[123][FH]|J560\/0[1-6])\b/i)?.[1] || geoPaperCodeHint.split(/\s+/)[0])
                : fileNamePaperHint;
            const effectiveExamPaperHint = options.customText || cleanGeoPaperHint;
            const individualQuestions = extractQuestionsFromClassification(classificationResult, standardizedPages[0]?.originalFileName);

            // ⚡ [FAST DB PRE-CHECK FOR UPLOADED MARKING SCHEMES]:
            // If the user uploaded a Marking Scheme alongside an exam paper that ALREADY exists in our Firestore DB,
            // verify against our in-memory DB cache (~15ms) first. If found, skip the 30s LLM scheme extraction (and deferred PDF rasterization) completely!
            let preResolvedOrchestrationResult: Awaited<ReturnType<typeof MarkingSchemeOrchestrationService.orchestrateMarkingSchemeLookup>> | null = null;
            if (pagesEjected && (interceptedSchemeImages.length > 0 || deferredSchemePdfFiles.length > 0) && !inputMarkingScheme && individualQuestions.length > 0) {
                try {
                    const dbPreCheck = await MarkingSchemeOrchestrationService.orchestrateMarkingSchemeLookup(
                        individualQuestions.map(q => ({ ...q })),
                        classificationResult,
                        effectiveExamPaperHint,
                        undefined,
                        subjectProfile?.ocrStrategy === 'VISION_VERBATIM'
                    );
                    const totalGroups = dbPreCheck.markingSchemesMap.size;
                    const matchedDbSchemes = Array.from(dbPreCheck.markingSchemesMap.values()).filter(
                        (s: any) => !s?.isGeneric && s?.questionDetection?.found && s?.questionDetection?.match?.markingScheme
                    );
                    if (totalGroups > 0 && matchedDbSchemes.length > 0 && (matchedDbSchemes.length / totalGroups) >= 0.7) {
                        const matchedTitle = matchedDbSchemes[0]?.questionDetection?.match?.paperTitle || 'Official Past Paper';
                        console.log(`⚡ [FAST-DB-SCHEME] Official marking scheme already exists in DB ("${matchedTitle}", ${matchedDbSchemes.length}/${totalGroups} question groups). Skipping LLM extraction of uploaded mark scheme!`);
                        preResolvedOrchestrationResult = dbPreCheck;
                    }
                } catch (preCheckErr) {
                    // Non-fatal: fall through to custom scheme parser
                }
            }

            // 🧠 [DYNAMIC PARSER]: Only run LLM custom scheme extraction if the paper was NOT already matched in our DB.
            // Runs concurrently with Mathpix OCR below.
            const schemeParserPromise: Promise<any | null> = (async () => {
                if (preResolvedOrchestrationResult || !pagesEjected || (interceptedSchemeImages.length === 0 && deferredSchemePdfFiles.length === 0)) return null;
                const schemeParserModel = resolveExecutionPlan('fast', 'markingScheme').modelName;
                const logSchemeParserComplete = logStep('Custom Scheme Parsing', schemeParserModel);
                try {
                    if (deferredSchemePdfFiles.length > 0) {
                        console.log(`📄 [DEFERRED-MS-PDF] Paper not found in DB — rasterizing ${deferredSchemePdfFiles.length} deferred Mark Scheme PDF(s) on demand...`);
                        for (const msFile of deferredSchemePdfFiles) {
                            const msPages = await PdfProcessingService.convertPdfToImages(msFile.buffer, {
                                maxPages: MAX_RAW_COMBINED_PAGES
                            });
                            msPages.forEach(p => interceptedSchemeImages.push(p.imageData));
                        }
                    }
                    if (interceptedSchemeImages.length === 0) {
                        logSchemeParserComplete();
                        return null;
                    }
                    const { MarkingSchemeParserService } = await import('./MarkingSchemeParserService.js');
                    const parsedObj = await MarkingSchemeParserService.parseImagesToObject(
                        interceptedSchemeImages,
                        usageTracker,
                        {
                            userId: userId || 'anonymous',
                            sessionId: options.sessionId || submissionId,
                            sourceFileName: deferredSchemePdfFiles[0]?.originalname || files?.[0]?.originalname
                        }
                    );
                    logSchemeParserComplete();

                    if (parsedObj && Object.keys(parsedObj).length > 0) {
                        console.log(`✅ [SCHEME PARSER] Successfully extracted marking scheme via ${schemeParserModel}.`);
                        if (process.env.LOG_CUSTOM_SCHEME_JSON === 'true') {
                            console.log(`\n📄 [CUSTOM-SCHEME-DEBUG] Pretty JSON of Parsed Scheme:`);
                            console.log(JSON.stringify(parsedObj, null, 2));
                            console.log(`----------------------------------------------------\n`);
                        }
                        return parsedObj;
                    }
                    console.warn(`⚠️ [SCHEME PARSER] Parser returned empty object. Falling back to generic marking scheme.`);
                    return null;
                } catch (err) {
                    logSchemeParserComplete();
                    console.error(`⚠️ [SCHEME PARSER] Exception during custom marking scheme parsing. Proceeding with generic fallback. Error:`, err instanceof Error ? err.message : String(err));
                    return null;
                }
            })();

            progressCallback(createProgressData(3, `Running Precision OCR on ${pagesToOcr.size} pages...`, MULTI_IMAGE_STEPS));
            const logOcrComplete = logStep('OCR Processing', 'mathpix');

            const runPrecisionOcrBatched = async () => {
                const results: PageOcrResult[] = [];
                const BATCH_SIZE = 5;
                for (let i = 0; i < standardizedPages.length; i += BATCH_SIZE) {
                    const batch = standardizedPages.slice(i, i + BATCH_SIZE);
                    const batchResults = await Promise.all(batch.map(async (page) => {
                        // Skip Mathpix completely if this page was ejected by Classification
                        if (!pagesToOcr.has(page.pageIndex)) {
                            return {
                                pageIndex: page.pageIndex,
                                ocrData: { text: '', mathBlocks: [], rawResponse: null } as any, // Empty mock response
                                classificationText: '' 
                            };
                        }

                        const ocrResult = await OCRService.processImage(
                            (page as any).ocrImageData || page.imageData,
                            { pageIndex: page.pageIndex, ocrStrategy: subjectProfile.ocrStrategy },
                            false,
                            'auto',
                            {}, // Empty hint
                            usageTracker
                        );
                        return {
                            pageIndex: page.pageIndex,
                            ocrData: ocrResult,
                            classificationText: '' // We backfill this later
                        };
                    }));
                    results.push(...batchResults);
                }
                return results;
            };

            allPagesOcrData = await runPrecisionOcrBatched();
            logOcrComplete();

            // Backfill the globalQuestionText that we now have from the completed Classification pass
            allPagesOcrData.forEach(ocr => {
                 ocr.classificationText = globalQuestionText;
            });

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

            // Collect full OCR text for reliable metadata extraction (e.g. Total Marks)
            const extractedOcrText = allPagesOcrData.map((p: any) => p.ocrData.text).join('\n\n');

            // ⏳ Resolve the concurrently-running custom scheme parser (if not already satisfied by fast DB pre-check)
            const parsedCustomScheme = await schemeParserPromise;

            // Call question detection for each individual question (started after custom scheme parsing completes so timings don't overlap)
            const logQuestionDetectionComplete = logStep('Question Detection', 'question-detection');
            if (parsedCustomScheme) {
                inputMarkingScheme = parsedCustomScheme;
                const parsedSchemeSubject = (parsedCustomScheme as any)?.examDetails?.subject;
                const parsedSchemePaperCode = (parsedCustomScheme as any)?.examDetails?.paperCode;
                if (parsedSchemeSubject || parsedSchemePaperCode) {
                    const schemeResolvedProfile = resolveSubjectProfile({
                        detectedSubject: geoSubjectVote,
                        subject: parsedSchemeSubject,
                        paperCode: geoPaperCodeHint || parsedSchemePaperCode,
                        customText: options.customText,
                        fileNames: uploadedFileNames
                    });
                    if (schemeResolvedProfile.key !== subjectProfile.key || schemeResolvedProfile.displayName !== subjectProfile.displayName) {
                        console.log(
                            `🧭 [SUBJECT-ROUTER] Refined from Uploaded Scheme (subject="${parsedSchemeSubject || 'N/A'}") -> Profile="${schemeResolvedProfile.key}" | Display="${schemeResolvedProfile.displayName}"`
                        );
                        subjectProfile = schemeResolvedProfile;
                    }
                }
            }

            if (parsedCustomScheme && individualQuestions.length >= 3) {
                // Snapshot BEFORE orchestration: orchestrateMarkingSchemeLookup mutates q.text in place ("smart swap"),
                // and this save runs asynchronously, so passing the live objects races with that mutation.
                const questionsSnapshot = individualQuestions.map(q => ({
                    questionNumber: q.questionNumber,
                    text: q.text,
                    parentText: q.parentText
                }));
                const schemeForPersistence = parsedCustomScheme;

                // Paper total printed on the QUESTION PAPER cover (e.g. "The maximum mark for this paper is 100"),
                // detected by the pre-flight geometry pass. Most frequent value across non-scheme pages wins.
                const totalVotes = new Map<number, number>();
                geometryResults
                    .filter(g => g && !g.is_marking_scheme && g.paper_total_marks_hint)
                    .forEach(g => totalVotes.set(g!.paper_total_marks_hint!, (totalVotes.get(g!.paper_total_marks_hint!) || 0) + 1));
                const paperStatedTotal = Array.from(totalVotes.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

                // 🛡️ COMPLETENESS GATE: Only a COMPLETE question paper + COMPLETE mark scheme is auto-persisted.
                // Individual questions / partial uploads are ignored (see persistOfficialPastPaperIfComplete).
                import('./MarkingSchemeParserService.js')
                    .then(({ MarkingSchemeParserService }) => {
                        void MarkingSchemeParserService.persistOfficialPastPaperIfComplete({
                            parsedScheme: schemeForPersistence,
                            extractedQuestions: questionsSnapshot,
                            paperStatedTotal,
                            auditContext: {
                                userId: userId || 'anonymous',
                                sessionId: options.sessionId || submissionId,
                                sourceFileName: deferredSchemePdfFiles[0]?.originalname || files?.[0]?.originalname
                            }
                        });
                    })
                    .catch(() => {});
            }

            // Orchestrate marking scheme lookup (reuse pre-resolved DB match if available, otherwise run lookup)
            const orchestrationResult = preResolvedOrchestrationResult || await MarkingSchemeOrchestrationService.orchestrateMarkingSchemeLookup(
                individualQuestions,
                classificationResult,
                effectiveExamPaperHint,
                inputMarkingScheme,
                subjectProfile?.ocrStrategy === 'VISION_VERBATIM'
            );

            const markingSchemesMap = orchestrationResult.markingSchemesMap;
            const detectionResults = orchestrationResult.detectionResults;
            const detectionStats = orchestrationResult.detectionStats;
            classificationResult = orchestrationResult.updatedClassificationResult;
            // ^^^ This object now holds the DB-verified Question Numbers

            // Refine subjectProfile if DB Question Detection matched an exam paper
            const firstMatch = detectionResults.find((dr: any) => dr?.detectionResult?.found && dr?.detectionResult?.match)?.detectionResult?.match;
            if (firstMatch) {
                const dbResolvedProfile = resolveSubjectProfile({
                    detectedSubject: geoSubjectVote,
                    subject: firstMatch.subject || firstMatch.qualification,
                    paperCode: firstMatch.paperCode || firstMatch.examCode,
                    paperTitle: firstMatch.paperTitle
                });
                if (dbResolvedProfile.key !== subjectProfile.key) {
                    subjectProfile = dbResolvedProfile;
                    console.log(
                        `🧭 [SUBJECT-ROUTER] Refined from DB Match "${firstMatch.paperCode || firstMatch.paperTitle}" -> Profile="${subjectProfile.key}" | Paradigm="${subjectProfile.paradigm}"`
                    );
                }
            }

            // Attach resolved subjectProfile onto each scheme in markingSchemesMap so MarkingInstructionService & MarkingExecutor have direct access
            if (markingSchemesMap && markingSchemesMap.size > 0) {
                for (const schemeEntry of markingSchemesMap.values()) {
                    if (schemeEntry && typeof schemeEntry === 'object') {
                        schemeEntry.subjectProfile = subjectProfile;
                        if (schemeEntry.questionMarks && typeof schemeEntry.questionMarks === 'object') {
                            schemeEntry.questionMarks.subjectProfile = subjectProfile;
                        }
                    }
                }
            }

            // 📊 [LOGGING] Print Detection Statistics BEFORE re-indexing starts
            MarkingSchemeOrchestrationService.logDetectionStatistics(detectionStats, detectionResults);
            logQuestionDetectionComplete(); // End the overall Question Detection timer

            // 🛡️ [SIGNAL-BASED PAPER TYPE DETECTION]: 
            // Detect A-Level vs GCSE using structural signals instead of guesswork (Bible Rule 8).
            const isALevelPaper = allPagesOcrData.some((p: any) => {
                const ocr = p.ocrData;
                if (!ocr) return false;
                const blocks = ocr.mathBlocks || [];
                const pageHeight = ocr.dimensions?.height || 3500;
                const textLen = blocks.reduce((sum: number, b: any) => sum + (b.googleVisionText || b.text || '').length, 0);
                
                // Signal 1: High Density (Question Text)
                if (textLen < 300) return false;

                // Signal 2: Large Empty Space (The Answer Box)
                const sortedBlocks = [...blocks].sort((a: any, b: any) => (a.coordinates?.y || 0) - (b.coordinates?.y || 0));
                let maxGap = 0;
                
                for (let i = 1; i < sortedBlocks.length; i++) {
                    const top = (sortedBlocks[i-1].coordinates?.y || 0) + (sortedBlocks[i-1].coordinates?.height || 0);
                    const bottom = sortedBlocks[i].coordinates?.y || 0;
                    const gap = bottom - top;
                    if (gap > maxGap) maxGap = gap;
                }

                // Also check the gap from the final block to the bottom of the page
                if (sortedBlocks.length > 0) {
                    const lastBlock = sortedBlocks[sortedBlocks.length - 1];
                    const lastBottom = (lastBlock.coordinates?.y || 0) + (lastBlock.coordinates?.height || 0);
                    const bottomGap = pageHeight - lastBottom;
                    if (bottomGap > maxGap) maxGap = bottomGap;
                }
                
                return maxGap > (pageHeight * 0.20); // Large vertical gap (at least 20% of page)
            });

            if (process.env.LOG_REINDEX_DEBUG === 'true') {
                console.log(`\n🔄 [RE-INDEXING] 🛡️ Aligning physical pages... (Signal-Detected: ${isALevelPaper ? 'A-Level Type' : 'GCSE/Standard Type'})`);

                // 🔍 [RE-INDEX PROBE]: Verify pointer sync integrity
                classificationResult.questions.forEach((q: any) => {
                    if (q.questionNumber === '11' || q.questionNumber === '1' || q.questionNumber?.startsWith('11')) {
                        console.log(`🕵️ [PROBE] Q${q.questionNumber} | sourceImageIndex: ${q.sourceImageIndex} | text: ${q.text?.substring(0, 30)}...`);
                    }
                });
            }

            // 1. Map pages to their Lowest VERIFIED Question Number (Sub-Question Aware)
            // 🛡️ [MULTI-ANCHOR REUSE]: We check sourceImageIndices (plural) to see if a page belongs to a question.
            // This preserves the existing logic for questions spanning multiple pages (like Q11 on P0/P23).
            const pageSortMap = standardizedPages.map((page, originalIdx) => {
                const matchedClassification = allClassificationResults.find(r => r.pageIndex === page.pageIndex) || allClassificationResults[originalIdx];
                const rawResult = matchedClassification?.result;
                const pageRawResult = rawResult || {
                    category: 'metadata',
                    questions: []
                };
                const physicalPageIndex = page.pageIndex;

                let minSortWeight = Infinity;
                const debugQList: string[] = [];

                // 🏗️ TRUTH-FIRST: Look at database-verified questions and their SUB-QUENCES
                const pageWeights: { q: string, w: number }[] = [];
                const checkWeightRecursive = (node: any, parentQNum: string = '') => {
                    const currentQNum = typeof node === 'string' ? node : (node.questionNumber || node.part || '');
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

                    // 🛡️ [SCOPE FIX]: We no longer check `allIndicesOnNode` because `pageRawResult` is
                    // ALREADY 1:1 mapped to this `physicalPageIndex` by ClassificationMapper!
                    if (qNumContext) {
                        debugQList.push(qNumContext);
                        const weight = getQuestionSortValue(qNumContext);
                        pageWeights.push({ q: qNumContext, w: weight });
                    }

                    // Recurse into sub-questions to find the earliest part on this page
                    if (node.subQuestions && Array.isArray(node.subQuestions)) {
                        node.subQuestions.forEach((sub: any) => checkWeightRecursive(sub, qNumContext));
                    }
                };

                if (pageRawResult.questions && Array.isArray(pageRawResult.questions) && pageRawResult.questions.length > 0) {
                    pageRawResult.questions.forEach((q: any) => checkWeightRecursive(q));
                } else if ((pageRawResult as any).mapperHints && Array.isArray((pageRawResult as any).mapperHints)) {
                    (pageRawResult as any).mapperHints.forEach((qStr: string) => {
                        debugQList.push(qStr);
                        pageWeights.push({ q: qStr, w: getQuestionSortValue(qStr) });
                    });
                }

                // 🛡️ [ROLE-BASED TIE-BREAKER]: 
                // A-Level Generic = Continuation (Follows Specific 11.01)
                // GCSE Generic = Stem (Leads Specific 11.01)
                if (pageWeights.length > 0) {
                    const specificWeights = pageWeights.filter(pw => pw.w % 1 !== 0);
                    const genericWeights = pageWeights.filter(pw => pw.w % 1 === 0);

                    if (specificWeights.length > 0) {
                        // Page has specific sub-questions (e.g. 11c). Use the earliest one.
                        minSortWeight = Math.min(...specificWeights.map(pw => pw.w));
                    } else if (genericWeights.length > 0) {
                        // Page is GENERIC ONLY (e.g. "11" or "2"). Use Paper Type to decide.
                        const baseWeight = Math.min(...genericWeights.map(pw => pw.w));
                        minSortWeight = baseWeight + 0.9;
                    }

                    // 🔍 DEBUG: Log the decision
                    if (process.env.LOG_REINDEX_DEBUG === 'true') {
                        console.log(`   ⚖️ [PAGE-WEIGHT] Page ${originalIdx}: Weights=[${pageWeights.map(pw => `${pw.q}:${pw.w}`).join(', ')}] -> Selected: ${minSortWeight}`);
                    }
                }

                // 🛡️ [METADATA IDENTITY]: DO NOT force minSortWeight = Infinity for meta-pages.
                // ⚠️ [WARNING]: Cover pages MUST retain their question labels (identity) so the Zone Detector 
                // can find top-of-page anchors. Physical sorting is handled by the 'isMeta' flag alone.
                const isMeta = pageRawResult?.category === 'metadata' || pageRawResult?.category === 'frontPage';

                // Detect true Exam Front Cover so out-of-order loose image uploads never treat it as an interior blank page
                const pageOcrBlocks = (allPagesOcrData.find(o => o.pageIndex === page.pageIndex) || allPagesOcrData[originalIdx])?.ocrData?.mathBlocks || [];
                const pageOcrText = pageOcrBlocks.map((b: any) => b.googleVisionText || b.mathpixLatex || b.text || '').join(' ');
                const hasCoverLandmarks = /candidate\s*surname|centre\s*number|instructions\s*to\s*candidates|paper\s*reference|total\s*mark\s*for\s*this\s*paper|you\s*must\s*have/i.test(pageOcrText)
                    && !/no\s*questions\s*printed|blank\s*page/i.test(pageOcrText);
                const isFrontCover = pageRawResult?.category === 'frontPage' || (isMeta && hasCoverLandmarks);

                // Detect whether this page contains a printed question prompt vs continuation text only
                const isContaminatedStemLocal = (q: any): boolean => {
                    if (!q || !q.text) return false;
                    const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    const stem = norm(q.text);
                    if (stem.length < 15) return false;
                    const work = norm((q.studentWorkLines || []).map((l: any) => l?.t || '').join(' ') || q.studentWork || '');
                    return work.length > 0 && work.includes(stem.slice(0, 40));
                };

                const hasPrintedStem = Boolean(
                    pageRawResult?.questions?.some((q: any) => {
                        const t = (q.text || '').trim();
                        return t.length > 20 && !isContaminatedStemLocal(q);
                    })
                );

                // Detect printed booklet page number from OCR (header or footer blocks)
                let bookletPage: number | null = null;
                if (pageOcrBlocks.length > 0) {
                    for (let i = 0; i < Math.min(4, pageOcrBlocks.length); i++) {
                        const txt = (pageOcrBlocks[i].googleVisionText || pageOcrBlocks[i].text || '').trim();
                        if (/^\d{1,2}$/.test(txt)) {
                            const num = parseInt(txt, 10);
                            if (num >= 1 && num <= 40) {
                                bookletPage = num;
                                break;
                            }
                        }
                    }
                    if (bookletPage === null && pageOcrBlocks.length > 3) {
                        for (let i = pageOcrBlocks.length - 1; i >= Math.max(0, pageOcrBlocks.length - 4); i--) {
                            const raw = (pageOcrBlocks[i].googleVisionText || pageOcrBlocks[i].text || '').trim();
                            const txt = raw.replace(/\s+/g, '');
                            if (/^\d{1,2}$/.test(txt)) {
                                const num = parseInt(txt, 10);
                                if (num >= 1 && num <= 40) {
                                    bookletPage = num;
                                    break;
                                }
                            }
                        }
                    }
                }

                return {
                    originalIdx,
                    originalPageIndex: page.originalPageIndex,
                    filename: page.originalFileName,
                    minQ: minSortWeight === Infinity ? 999999 : minSortWeight,
                    hasPrintedStem,
                    bookletPage,
                    isMeta,
                    isFrontCover,
                    debugQ: [...new Set(debugQList)].join(', ')
                };
            });

            const isPastPaper = Array.from(markingSchemesMap.values()).some(m => !m.isGeneric);
            // 🛡️ [ORPHAN & INTERIOR BOOKLET PAGE RESCUE]: 
            // Both GCSE and A-Level papers have unnumbered overflow/working pages, blank lined pages, or
            // "There are no questions printed on this page" filler pages in the middle/end of the booklet.
            // Rescue any page (including interior/trailing isMeta booklet pages) that follows a known question page
            // by inheriting `prev.minQ + 0.0001` so it stays in its physical booklet position instead of jumping to Page 0!
            // Leading cover pages (before any question appears, where prev.minQ === 999999) keep minQ = 999999 and stay at Page 0.
            // CRITICAL: Never backfill a true Front Cover (or a loose image meta page from a different file, or the left-half of a Q1 spread).
            for (let i = 1; i < pageSortMap.length; i++) {
                const current = pageSortMap[i];
                const prev = pageSortMap[i - 1];
                const next = pageSortMap[i + 1];
                const isSpreadCoverBeforeQ1 = Boolean(
                    current.isMeta &&
                    next &&
                    next.filename === current.filename &&
                    next.minQ < 2
                );
                const isDifferentLooseFileMeta = Boolean(
                    current.isMeta &&
                    !isPdf &&
                    !isMultiplePdfs &&
                    current.filename !== prev.filename
                );
                if (
                    current.minQ === 999999 &&
                    prev.minQ !== 999999 &&
                    !current.isFrontCover &&
                    !isSpreadCoverBeforeQ1 &&
                    !isDifferentLooseFileMeta
                ) {
                    current.minQ = prev.minQ + 0.0001;
                }
            }
            if (isPastPaper) {
                for (let i = pageSortMap.length - 2; i >= 0; i--) {
                    const current = pageSortMap[i];
                    const next = pageSortMap[i + 1];
                    if (!current.isMeta && current.minQ === 999999 && next.minQ !== 999999) {
                        current.minQ = Math.max(0, next.minQ - 0.0001);
                    }
                }
            }

            // 🔍 [DEBUG-PROBE] Dump the Sorting Decision Matrix
            if (process.env.LOG_REINDEX_DEBUG === 'true') {
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
            }

            // 1.5 NON-DESTRUCTIVE ORPHAN FALLBACK:
            // Any page that still has no question number after neighbor backfill (e.g., a trailing blank/lined page)
            // is safely demoted to metadata so it preserves its physical sequence without crashing the pipeline.
            const unresolvedPages = pageSortMap.filter(p => !p.isMeta && p.minQ === 999999);
            if (unresolvedPages.length > 0) {
                console.warn(`⚠️ [SORT FALLBACK] Pages ${unresolvedPages.map(p => p.originalIdx).join(', ')} have no question anchors after backfill. Demoting to metadata to preserve physical sequence.`);
                unresolvedPages.forEach(p => {
                    p.isMeta = true;
                });
            }

            // 2. LOGICAL SORT (The Straightener) - [RESTORED FOR IMAGES ONLY]
            // This ensures that LOOSE IMAGES are "straightened" into numerical order.
            // DO NOT apply this to PDFs! PDFs are already chronologically sequenced by the student.
            // Scrambling a PDF because of an OCR misread destroys the visual flow of the document.
            if (!isPdf && !isMultiplePdfs) {
                pageSortMap.sort((a, b) => {
                    // Rule 1: ONLY true Exam Front Covers (isFrontCover === true) go before Q1.
                    // Unattempted/unresolved metadata pages (isMeta && minQ === 999999 && !isFrontCover) go to the END!
                    const aIsTrueCover = a.isFrontCover && a.minQ === 999999;
                    const bIsTrueCover = b.isFrontCover && b.minQ === 999999;
                    if (aIsTrueCover && !bIsTrueCover) return -1;
                    if (!aIsTrueCover && bIsTrueCover) return 1;

                    // Push non-cover unresolved metadata pages (minQ === 999999) to the end of the upload
                    if (a.minQ === 999999 && b.minQ !== 999999) return 1;
                    if (a.minQ !== 999999 && b.minQ === 999999) return -1;

                    // Rule 2: Logical Question Order (Now Q1..Q14 -> Pages 0..13, and Q15..Q17 -> Pages 14..16!)
                    if (Math.abs(a.minQ - b.minQ) > 0.00001) {
                        return a.minQ - b.minQ;
                    }

                    // Rule 2.1: Intra-Question Ordering by Printed Booklet Page Number
                    if (a.bookletPage !== null && b.bookletPage !== null && a.bookletPage !== b.bookletPage) {
                        return a.bookletPage - b.bookletPage;
                    }

                    // Rule 2.2: Printed Question Stem Precedes Continuation Pages
                    if (a.hasPrintedStem && !b.hasPrintedStem) return -1;
                    if (!a.hasPrintedStem && b.hasPrintedStem) return 1;

                    // Rule 3: Physical Tie-breaker (Original Upload Order)
                    return a.originalIdx - b.originalIdx;
                });
            } else {
                console.log('🛡️ [PDF INTEGRITY] Straightener bypassed. Maintaining exact physical sequence of the PDF.');
            }

            if (process.env.LOG_REINDEX_DEBUG === 'true') {
                console.log(`\n🚀 [SORT-RESULT] Final Logical Order:`);
                console.log('-----------------------------------------------------------------------------------------');
                pageSortMap.forEach((p, i) => {
                    console.log(`| Seq ${i} | OrigIdx ${p.originalIdx} | isMeta: ${p.isMeta} | minQ: ${p.minQ} |`);
                });
                console.log('-----------------------------------------------------------------------------------------');
            }

            // 3. Create Index Lookups
            const oldToNewIndex = new Map<number, number>();
            const newToOldIndex = new Map<number, number>();
            pageSortMap.forEach((item, newIdx) => {
                oldToNewIndex.set(item.originalIdx, newIdx);
                newToOldIndex.set(newIdx, item.originalIdx);
            });

            // 4. Re-build Arrays (Use immutable shallow clones to avoid in-loop index collision)
            const reindexedStandardPages: StandardizedPage[] = [];
            const reindexedOcrData: any[] = [];
            const reindexedClassificationResults: any[] = [];

            const snapshotOcrByPageIdx = new Map<number, any>();
            allPagesOcrData.forEach(o => snapshotOcrByPageIdx.set(o.pageIndex, o));
            const snapshotClsByPageIdx = new Map<number, any>();
            allClassificationResults.forEach(c => snapshotClsByPageIdx.set(c.pageIndex, c));

            for (let newIdx = 0; newIdx < pageSortMap.length; newIdx++) {
                const oldIdx = newToOldIndex.get(newIdx)!;

                const page = standardizedPages[oldIdx];
                const prevPageIdx = page.pageIndex;
                const ocr = snapshotOcrByPageIdx.get(prevPageIdx) || allPagesOcrData[oldIdx];
                const cls = snapshotClsByPageIdx.get(prevPageIdx) || allClassificationResults[oldIdx];

                const updatedPage = { ...page, pageIndex: newIdx };
                const updatedOcr = ocr ? { ...ocr, pageIndex: newIdx } : undefined;
                const updatedCls = cls ? { ...cls, pageIndex: newIdx } : undefined;

                reindexedStandardPages.push(updatedPage);
                if (updatedOcr) reindexedOcrData.push(updatedOcr);
                if (updatedCls) reindexedClassificationResults.push(updatedCls);
            }

            // 5. UPDATE GLOBAL REFERENCES
            standardizedPages = reindexedStandardPages;
            allPagesOcrData = reindexedOcrData;
            allClassificationResults = reindexedClassificationResults;

            if (process.env.LOG_REINDEX_DEBUG === 'true') {
                console.log(`✅ [RE-INDEXING] Completed. Pages have been straightened into Logical Order.`);
            }

            // 5. CRITICAL: Update Classification Result Indices to match New Integrity (DEEP FIX)
            // We must update questions, sub-questions, AND studentWorkLines to match the new Physical Index.
            // If we don't, the Zone Detector looks at Page 5 but ignores lines tagged as "Page 1".

            // Create a lookup: PostSplitIdx (from after ModeSplit) -> NewIdx
            const originalToNewIndexMap = new Map<number, number>();
            pageSortMap.forEach((p, newIdx) => {
                // The classification questions JSON was generated on the POST-split array (0 to N-1),
                // so we MUST use originalIdx (the array index) rather than originalPageIndex (physical upload index).
                originalToNewIndexMap.set(p.originalIdx, newIdx);
            });

            const updateNodeIndices = (node: any) => {
                if (!node || typeof node !== 'object' || node._reindexed) return;
                node._reindexed = true;

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
                        if (!line || typeof line !== 'object' || line._reindexed) return;
                        line._reindexed = true;

                        if (line.pageIndex !== undefined) {
                            const newPageIdx = originalToNewIndexMap.get(line.pageIndex) ?? line.pageIndex;
                            line.pageIndex = newPageIdx;
                            if (line.position && typeof line.position === 'object') {
                                line.position.pageIndex = newPageIdx;
                            }

                            // 2. REWRITE THE ID STRING
                            // We must change "p3_q1_line_1" to "p5_q1_line_1"
                            // Otherwise, the detector parses "p3" and discards it.
                            if (line.id && typeof line.id === 'string') {
                                const oldId = line.id;
                                line.id = line.id.replace(/^p\d+_/, `p${newPageIdx}_`);

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

            if (classificationResult && classificationResult.questions) {
                classificationResult.questions.forEach(updateNodeIndices);
            }

            // Update nested question nodes in allClassificationResults (Note: r.pageIndex itself was ALREADY set to newIdx in Step 4!)
            allClassificationResults.forEach(r => {
                if (r.result?.questions && Array.isArray(r.result.questions)) {
                    r.result.questions.forEach(updateNodeIndices);
                }
            });
            if (process.env.LOG_REINDEX_DEBUG === 'true') {
                console.log(`✅ [RE-INDEXING] Deep Pointer Update Complete. Lines now point to new physical pages.`);
            }

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
                    const computeLinesUnion = (lines: any[], targetPage: number): { x: number; y: number; width: number; height: number } | undefined => {
                        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                        let found = false;
                        for (const l of lines) {
                            if (!l || l.text === '[DRAWING]') continue;
                            if (l.pageIndex !== undefined && l.pageIndex !== targetPage) continue;
                            const x = l.position?.x ?? (Array.isArray(l.p) ? l.p[0] : undefined);
                            const y = l.position?.y ?? (Array.isArray(l.p) ? l.p[1] : undefined);
                            const w = l.position?.width ?? (Array.isArray(l.p) ? l.p[2] : undefined);
                            const h = l.position?.height ?? (Array.isArray(l.p) ? l.p[3] : undefined);
                            if (typeof x === 'number' && typeof y === 'number' && typeof w === 'number' && typeof h === 'number') {
                                minX = Math.min(minX, x);
                                minY = Math.min(minY, y);
                                maxX = Math.max(maxX, x + w);
                                maxY = Math.max(maxY, y + h);
                                found = true;
                            }
                        }
                        if (found && maxX > minX && maxY > minY) {
                            return {
                                x: Math.round(minX * 10) / 10,
                                y: Math.round(minY * 10) / 10,
                                width: Math.round((maxX - minX) * 10) / 10,
                                height: Math.round((maxY - minY) * 10) / 10
                            };
                        }
                        return undefined;
                    };

                    const resolveDrawingBox = (targetNode: any, parentNode?: any, lines?: any[], targetPage: number = 0) => {
                        let box = targetNode?.studentDrawingPosition || parentNode?.studentDrawingPosition;
                        if (!box && lines && lines.length > 0) {
                            box = computeLinesUnion(lines, targetPage);
                        }
                        return box;
                    };

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

                            const targetPage = q.sourceImageIndex ?? 0;
                            const drawingBox = resolveDrawingBox(q, undefined, q.studentWorkLines, targetPage);

                            // Ensure studentWorkLines has a line with [DRAWING]
                            if (!q.studentWorkLines || q.studentWorkLines.length === 0) {
                                q.studentWorkLines = [{
                                    text: '[DRAWING]',
                                    confidence: 1.0,
                                    pageIndex: targetPage,
                                    position: drawingBox ? { x: drawingBox.x, y: drawingBox.y, width: drawingBox.width, height: drawingBox.height } : undefined,
                                    p: drawingBox ? [drawingBox.x, drawingBox.y, drawingBox.width, drawingBox.height] : undefined
                                }];
                            } else {
                                // Check if any line has [DRAWING]
                                const existingDrawing = q.studentWorkLines.find((l: any) => l.text && l.text.includes('[DRAWING]'));
                                if (!existingDrawing) {
                                    q.studentWorkLines.push({
                                        text: '[DRAWING]',
                                        confidence: 1.0,
                                        pageIndex: targetPage,
                                        position: drawingBox ? { x: drawingBox.x, y: drawingBox.y, width: drawingBox.width, height: drawingBox.height } : undefined,
                                        p: drawingBox ? [drawingBox.x, drawingBox.y, drawingBox.width, drawingBox.height] : undefined
                                    });
                                } else if (!existingDrawing.position && drawingBox) {
                                    existingDrawing.position = { x: drawingBox.x, y: drawingBox.y, width: drawingBox.width, height: drawingBox.height };
                                    existingDrawing.p = [drawingBox.x, drawingBox.y, drawingBox.width, drawingBox.height];
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

                                    const targetPage = sq.pageIndex ?? sq.sourceImageIndex ?? q.sourceImageIndex ?? 0;
                                    const drawingBox = resolveDrawingBox(sq, q, sq.studentWorkLines, targetPage);

                                    // Update lines for sub-question too
                                    if (!sq.studentWorkLines || sq.studentWorkLines.length === 0) {
                                        sq.studentWorkLines = [{
                                            text: '[DRAWING]',
                                            confidence: 1.0,
                                            pageIndex: targetPage,
                                            position: drawingBox ? { x: drawingBox.x, y: drawingBox.y, width: drawingBox.width, height: drawingBox.height } : undefined,
                                            p: drawingBox ? [drawingBox.x, drawingBox.y, drawingBox.width, drawingBox.height] : undefined
                                        }];
                                    } else {
                                        const existingDrawing = sq.studentWorkLines.find((l: any) => l.text && l.text.includes('[DRAWING]'));
                                        if (!existingDrawing) {
                                            sq.studentWorkLines.push({
                                                text: '[DRAWING]',
                                                confidence: 1.0,
                                                pageIndex: targetPage,
                                                position: drawingBox ? { x: drawingBox.x, y: drawingBox.y, width: drawingBox.width, height: drawingBox.height } : undefined,
                                                p: drawingBox ? [drawingBox.x, drawingBox.y, drawingBox.width, drawingBox.height] : undefined
                                            });
                                        } else if (!existingDrawing.position && drawingBox) {
                                            existingDrawing.position = { x: drawingBox.x, y: drawingBox.y, width: drawingBox.width, height: drawingBox.height };
                                            existingDrawing.p = [drawingBox.x, drawingBox.y, drawingBox.width, drawingBox.height];
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

                const metaPageIndices = pageSortMap.filter(p => p.isMeta).map(p => oldToNewIndex.get(p.originalIdx)!);
                console.log(` 🕵️ [PIPELINE-META] Collected Meta Indices: ${metaPageIndices.join(', ')}`);

                markingTasks = createMarkingTasksFromClassification(
                    classificationResult,
                    allPagesOcrData,
                    markingSchemesMap,
                    pageDimensionsMap,
                    standardizedPages,
                    allClassificationResults,
                    metaPageIndices
                );
            } catch (error) {
                console.error('❌ createMarkingTasksFromClassification failed:', error);
                throw error;
            }

            // Handle case where no student work is found
            if (markingTasks.length === 0) {
                console.log('No marking tasks created, exiting early');
                const hasDetectedQuestions = allQuestions.length > 0;
                progressCallback(createProgressData(5, hasDetectedQuestions ? 'No student work found to mark.' : 'Not maths related image.', MULTI_IMAGE_STEPS));

                // 🛡️ [SESSION-STABILITY]: Ensure we have a sessionId even if no tasks were found
                let finalSessionId = questionOnlyResult?.sessionId || questionOnlyResult?.unifiedSession?.sessionId;
                let finalUnifiedSession = questionOnlyResult?.unifiedSession;
                let fallbackAiMessage: any = null;

                if (!finalSessionId) {
                    console.log(`📡 [EARLY EXIT] Generating fallback sessionId from submissionId: ${submissionId}`);
                    finalSessionId = submissionId;

                    // Persist an empty marking session so it shows in Library
                    try {
                        const uploadResult = await SessionManagementService.uploadOriginalFiles(
                            files,
                            userId || 'anonymous',
                            submissionId,
                            !!userId
                        );
                        const { structuredImageDataArray, structuredPdfContexts } = SessionManagementService.createStructuredData(
                            files,
                            isPdf,
                            isMultiplePdfs || isMixedUpload,
                            pdfContext
                        );
                        const userMessage = SessionManagementService.createUserMessageForDatabase(
                            {
                                content: options.customText || 'Uploaded document for marking',
                                files,
                                isPdf,
                                isMultiplePdfs: isMultiplePdfs || isMixedUpload,
                                sessionId: options.sessionId || submissionId,
                                model: actualModel,
                                pdfContext
                            },
                            structuredImageDataArray,
                            structuredPdfContexts,
                            uploadResult.originalImageLinks
                        );
                        const aiMessage = createAIMessage({
                            content: hasDetectedQuestions
                                ? 'No student work was detected on the uploaded pages.'
                                : 'Not maths related image. No mathematics questions or student work were detected on the uploaded image. Please upload a mathematics question or student homework image.',
                            messageId: req.body?.aiMessageId
                        });
                        fallbackAiMessage = aiMessage;

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
                    success: true,
                    submissionId, // Pass through submissionId
                    annotatedOutput: [],
                    results: [],
                    mode: isQuestionMode ? 'Question' : 'Marking',
                    unifiedSession: finalUnifiedSession,
                    aiMessage: finalUnifiedSession?.messages?.find((m: any) => m.role === 'assistant') || fallbackAiMessage,
                    sessionTitle: finalUnifiedSession?.title || (hasDetectedQuestions ? 'Marking Session' : 'Rejected Upload'),
                    // Add sessionId for credit deduction
                    sessionId: finalSessionId,
                    // Add sessionStats for usageRecord lookup
                    sessionStats: finalUnifiedSession?.sessionStats || null,
                    processingStats: {
                        totalLLMTokens,
                        mathpixCalls: usageTracker.getMathpixPages()
                    },
                    ...(pdfContext && { pdfContext })
                };

                progressCallback({ type: 'complete', result: finalOutput });

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

                                            // [GUILLOTINE] Hard-Coded Post-Processing for Point-Based Questions
                                            // Ensure we strictly respect the budget, especially per sub-question.
                                            // Bypassed for Level-of-Response (LoR) questions where ScoreAuditor.reconcileLevelOfResponseScore is authoritative.
                                            const isLoRResult = isLevelOfResponseQuestion(
                                                task.markingScheme,
                                                subjectProfile,
                                                (result as any).rubricEvaluation
                                            );
                                            if (!isLoRResult && task.markingScheme && result.annotations && result.score) {
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
                                                    const cleanDotSq = sq.replace(/^\./, '');
                                                    let subBudget =
                                                        subQuestionBudgets[sq] ??
                                                        subQuestionBudgets[`${task.questionNumber}${sq}`] ??
                                                        subQuestionBudgets[`${task.questionNumber}.${cleanDotSq}`] ??
                                                        99; // Default high if unknown

                                                    // Never enforce a 0 budget! If budget is 0 or undefined, treat as unbounded (99)
                                                    if (!subBudget || subBudget <= 0) {
                                                        subBudget = 99;
                                                    }

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

                                                    // 🛡️ GENERIC / UNIVERSAL MODE TOTAL MARKS RECOVERY:
                                                    // If `result.score.totalMarks` is 0 (because the paper is not in the DB and
                                                    // mark brackets like `[ 1 ]` or `[ 4 ]` were in OCR blocks rather than classification text),
                                                    // compute the true denominator from all evaluated mark annotations (e.g. B1, B2, M1, A1, B0, M0, A0).
                                                    if (!result.score.totalMarks || result.score.totalMarks <= 0) {
                                                        const inferredTotalFromAnnotations = finalizedAnnotations.reduce((sum: number, a: any) => {
                                                            const text = (a.text || '').trim();
                                                            const isMath = /[\\{}=\^_\(\)]/.test(text) || text.includes('sqrt') || text.includes('frac');
                                                            if (!isMath) {
                                                                const clean = text.replace(/[^a-zA-Z0-9]/g, '');
                                                                // Match both awarded (B1, B2, M1, A1) and un-awarded (B0, M0, A0, P0) rubric criteria
                                                                const m = clean.match(/^([BMAPC])(\d+)$/i);
                                                                if (m) {
                                                                    const num = parseInt(m[2], 10);
                                                                    return sum + (num > 0 ? num : 1);
                                                                }
                                                            }
                                                            if (a.action === 'tick' || a.action === 'cross' || a.action === 'mark') {
                                                                return sum + 1;
                                                            }
                                                            return sum;
                                                        }, 0);

                                                        result.score.totalMarks = Math.max(inferredTotalFromAnnotations, newAwarded);
                                                        (result as any).totalMarks = result.score.totalMarks;
                                                        if (task.markingScheme && result.score.totalMarks > 0) {
                                                            task.markingScheme.totalMarks = result.score.totalMarks;
                                                            task.markingScheme.parentQuestionMarks = result.score.totalMarks;
                                                        }
                                                    }

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
                                            if (error.message && error.message.includes('MANUAL_REVIEW_REQUIRED_TOO_DENSE')) {
                                                console.log(`[DEBUG] Catching Dense Error for Q${task.questionNumber}. task.sourcePages = ${JSON.stringify(task.sourcePages)}`);
                                                results.push({
                                                    questionNumber: task.questionNumber,
                                                    pageIndex: task.sourcePages?.[0] ?? 0,
                                                    sourceImageIndices: task.sourcePages || [],
                                                    annotations: [],
                                                    score: { totalMarks: task.markingScheme?.marks || 0, awardedMarks: 0 },
                                                    isError: true,
                                                    errorMessage: 'Too Dense'
                                                } as any);
                                            }
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

            // 🚀 [PARALLEL PERFORMANCE SUMMARY]:
            // Kick off the 4s Performance Summary AI call concurrently with Output Generation (SVG burning + Firebase Storage image uploads)!
            const precomputedPerformanceSummaryPromise = (async () => {
                const summaryStart = Date.now();
                try {
                    const { overallScore: preOverall, totalPossibleScore: preTotal, overallScoreText: preScoreText } =
                        calculateOverallScore(allQuestionResults);
                    let detectedQuestionForGrade: any = undefined;
                    if (markingSchemesMap && markingSchemesMap.size > 0) {
                        const allSchemes = Array.from(markingSchemesMap.values());
                        const firstSchemeEntry =
                            allSchemes.find((s: any) => !s?.isGeneric && s?.questionDetection?.found && s?.questionDetection?.match) ||
                            allSchemes[0];
                        detectedQuestionForGrade = firstSchemeEntry?.questionDetection || undefined;
                    }
                    const gradeResult = await GradeBoundaryService.calculateGradeWithOrchestration(
                        preOverall,
                        preTotal,
                        detectedQuestionForGrade,
                        markingSchemesMap
                    );
                    const firstDetection = detectionResults?.[0]?.detectionResult?.match || {};
                    const isAnyQuestionFound = detectionResults?.some((r: any) => r.detectionResult?.found === true) || false;
                    const isRealPastPaper = Boolean(firstDetection.board && firstDetection.board !== 'Unknown' && isAnyQuestionFound);
                    const examInfo = isRealPastPaper ? {
                        examBoard: firstDetection.board || '',
                        examSeries: firstDetection.examSeries || firstDetection.year || '',
                        subject: firstDetection.subject || firstDetection.qualification || '',
                        examCode: firstDetection.paperCode || '',
                        tier: firstDetection.tier || ''
                    } : undefined;

                    const summary = await SessionManagementService.generateMasterPerformanceSummary(
                        allQuestionResults,
                        actualModel,
                        usageTracker,
                        isRealPastPaper ? gradeResult.grade : undefined,
                        isRealPastPaper ? gradeResult.predictedGrade : undefined,
                        isRealPastPaper ? gradeResult.boundaries : undefined,
                        { totalMarks: preTotal, awardedMarks: preOverall, scoreText: preScoreText },
                        examInfo
                    );
                    return { summary, durationMs: Date.now() - summaryStart, startTime: summaryStart };
                } catch (err) {
                    console.warn('⚠️ [PARALLEL SUMMARY] Failed to precompute performance summary:', err);
                    return { summary: undefined, durationMs: Date.now() - summaryStart, startTime: summaryStart };
                }
            })();

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
            


            
            // ===========================================================================================


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
                isMultiplePdfs || isMixedUpload, // ✅ Ensures PDF contexts are persisted in mixed uploads
                pdfContext,
                isMixedContent,
                stepTimings,
                totalLLMTokens,
                combinedQuestionResponses,  // Pass questionOnly responses for persistence
                usageTracker,  // Pass UsageTracker for accurate token/cost tracking
                usageTracker.getMathpixPages(),  // Pass actual Mathpix call count from tracker
                allPagesOcrData,  // Pass OCR data for pipeline cache persistence
                preUploadedOriginalFilesPromise,
                precomputedPerformanceSummaryPromise
            );

            // Construct unified finalOutput that works for both authenticated and unauthenticated users
            const finalOutput = {
                success: true, // Add success flag for frontend compatibility
                submissionId: submissionId,
                // Calculate message-specific processing stats (not session-level totals)
                processingStats: {
                    apiUsed: getRealApiName(getRealModelName(actualModel)),
                    modelUsed: getRealModelName(actualModel),
                    selectedModel: actualModel,
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
            if (process.env.CHAOS_MODE === 'true') {
                console.log('🌪️ [CHAOS MODE] Simulating 85s latency before complete payload...');
                await new Promise(resolve => setTimeout(resolve, 85000));
            }
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

    /**
     * Executes the zero-reupload re-marking pipeline.
     * Reuses cached OCR data & student page images to re-grade against an official past paper mark scheme
     * and updates the session in-place. Deducts 0 credits!
     */
    static async executeRemarkPipeline(
        req: Request,
        options: {
            sessionId: string;
            paperTitle?: string;
            questionNumber?: string | null;
            uploadedSchemeFiles?: Array<{ originalName: string; mimeType: string; base64Data: string }>;
            model?: string;
            userId?: string;
            aiMessageId?: string;
        },
        progressCallback: (data: any) => void,
        usageTracker: UsageTracker
    ): Promise<any> {
        const startTime = Date.now();
        console.log(`🚀 [REMARK-PIPELINE] Starting re-marking for session ${options.sessionId} | paper="${options.paperTitle || 'N/A'}" | question="${options.questionNumber || 'ALL'}" | schemeFiles=${options.uploadedSchemeFiles?.length || 0}`);

        // 1. Load Cache (loading_cache)
        progressCallback(createProgressData(0, 'Loading cached student work...', REMARK_STEPS));
        const db = getFirestore();
        if (!db) {
            throw new Error('Firestore is not available');
        }

        let resolvedSessionId = options.sessionId;
        let cacheDoc = await db.collection('unifiedSessions').doc(resolvedSessionId).collection('pipelineCache').doc('latest').get();

        if (!cacheDoc.exists) {
            const alternateId = resolvedSessionId.startsWith('sub-')
                ? resolvedSessionId.replace(/^sub-/, 'session-')
                : resolvedSessionId.startsWith('session-')
                ? resolvedSessionId.replace(/^session-/, 'sub-')
                : null;
            if (alternateId) {
                const altDoc = await db.collection('unifiedSessions').doc(alternateId).collection('pipelineCache').doc('latest').get();
                if (altDoc.exists) {
                    resolvedSessionId = alternateId;
                    cacheDoc = altDoc;
                }
            }
        }

        if (!cacheDoc.exists) {
            const sessionSnap = await db.collection('unifiedSessions').doc(options.sessionId).get();
            if (sessionSnap.exists) {
                const sData = sessionSnap.data() as any;
                if (sData?.pipelineCache) {
                    cacheDoc = { exists: true, data: () => sData.pipelineCache } as any;
                } else if (sData?.sessionId && sData.sessionId !== options.sessionId) {
                    const linkedDoc = await db.collection('unifiedSessions').doc(sData.sessionId).collection('pipelineCache').doc('latest').get();
                    if (linkedDoc.exists) {
                        resolvedSessionId = sData.sessionId;
                        cacheDoc = linkedDoc;
                    }
                }
            }
        }

        if (!cacheDoc.exists) {
            throw new Error(`Pipeline cache not found for session ${options.sessionId}. Please re-upload your document.`);
        }

        let cacheData = cacheDoc.data() as any;
        if (cacheData.cacheStorageUrl) {
            const resp = await axios.get(cacheData.cacheStorageUrl);
            cacheData = resp.data;
        }

        const pagesMeta = cacheData.pagesMeta || [];
        if (pagesMeta.length === 0) {
            throw new Error('No cached student pages found in pipeline cache.');
        }

        const standardizedPages: StandardizedPage[] = [];
        for (let i = 0; i < pagesMeta.length; i++) {
            const pm = pagesMeta[i];
            let imgData = '';
            if (pm.imageUrl) {
                if (pm.imageUrl.startsWith('data:')) {
                    imgData = pm.imageUrl;
                } else {
                    try {
                        const imgResp = await axios.get(pm.imageUrl, { responseType: 'arraybuffer' });
                        const contentType = imgResp.headers['content-type'] || 'image/jpeg';
                        const base64 = Buffer.from(imgResp.data).toString('base64');
                        imgData = `data:${contentType};base64,${base64}`;
                    } catch (fetchErr) {
                        console.error(`❌ [REMARK] Failed to fetch image from ${pm.imageUrl}:`, fetchErr);
                    }
                }
            }
            standardizedPages.push({
                pageIndex: pm.pageIndex ?? i,
                originalPageIndex: pm.originalPageIndex ?? i,
                originalFileName: pm.originalFileName || `page-${i + 1}.jpg`,
                width: pm.width,
                height: pm.height,
                imageData: imgData
            });
        }

        let classificationResult = JSON.parse(JSON.stringify(cacheData.classificationResult || { questions: [] }));
        let allClassificationResults = JSON.parse(JSON.stringify(cacheData.allClassificationResults || []));
        const allPagesOcrData: PageOcrResult[] = cacheData.allPagesOcrData || [];

        // 2. Resolve Target Rubric: Either Custom Uploaded Mark Scheme OR Official Past Paper
        progressCallback(createProgressData(1, 'Fetching & validating mark scheme...', REMARK_STEPS));

        let parsedCustomScheme: any = undefined;

        // --- PATH A: USER UPLOADED CUSTOM MARK SCHEME FILES ---
        if (Array.isArray(options.uploadedSchemeFiles) && options.uploadedSchemeFiles.length > 0) {
            const schemePageImages: string[] = [];

            for (const f of options.uploadedSchemeFiles) {
                const rawB64 = f.base64Data.includes(',') ? f.base64Data.split(',')[1] : f.base64Data;
                const buf = Buffer.from(rawB64, 'base64');
                if (f.mimeType === 'application/pdf' || f.originalName?.toLowerCase().endsWith('.pdf')) {
                    const pdfPages = await PdfProcessingService.convertPdfToImages(buf, { maxPages: 30 });
                    pdfPages.forEach(p => schemePageImages.push(p.imageData));
                } else {
                    const normImg = await ImageUtils.normalizeOrientation(
                        f.base64Data.startsWith('data:') ? f.base64Data : `data:${f.mimeType || 'image/jpeg'};base64,${rawB64}`
                    );
                    schemePageImages.push(normImg);
                }
            }

            if (schemePageImages.length === 0) {
                throw new Error('INVALID_MARKING_SCHEME: Could not read any pages from the uploaded file.');
            }

            // 🛡️ STRICT VALIDATION GATE 1: Verify with ImageGeometryService that the uploaded files are actually a Marking Scheme
            // (Rejects dummy images, selfies, or duplicate student essay pages like "HARRY D Q5 P1_page_1.jpg"!)
            const lightSchemeImages = await Promise.all(
                schemePageImages.map(img => ImageUtils.createLightweightCopy(img, 800))
            );
            const geoChecks = await Promise.all(
                lightSchemeImages.map(img => ImageGeometryService.analyze(img, 800, 1000, 'fast', usageTracker))
            );

            const validSchemeImages = schemePageImages.filter((_, idx) => geoChecks[idx]?.is_acceptable_quality && geoChecks[idx]?.is_marking_scheme === true);

            if (validSchemeImages.length === 0) {
                console.warn(`🛑 [REMARK-REJECTED] Uploaded file(s) failed Marking Scheme validation gate. None of the ${schemePageImages.length} page(s) were recognized as a marking scheme.`);
                throw new Error('INVALID_MARKING_SCHEME: The uploaded file is not a valid marking scheme (it looks like a student answer page or non-scheme image). Your existing marks have been kept.');
            }

            // 🛡️ STRICT VALIDATION GATE 2: Parse the scheme and ensure it contains valid question criteria
            const { MarkingSchemeParserService } = await import('./MarkingSchemeParserService.js');
            parsedCustomScheme = await MarkingSchemeParserService.parseImagesToObject(validSchemeImages, usageTracker);

            if (!parsedCustomScheme || !parsedCustomScheme.questions || Object.keys(parsedCustomScheme.questions).length === 0) {
                throw new Error('INVALID_MARKING_SCHEME: Could not extract any valid marking scheme criteria from the uploaded file. Your existing marks have been kept.');
            }
            console.log(`✅ [REMARK-SCHEME] Validated & parsed custom marking scheme with ${Object.keys(parsedCustomScheme.questions).length} question(s).`);
        }

        // --- PATH B: USER SELECTED OFFICIAL PAST PAPER ---
        const targetQNum = options.questionNumber && options.questionNumber !== 'ALL'
            ? String(options.questionNumber).replace(/^Q/i, '').trim()
            : null;

        const findOfficialPaperDoc = async (paperTitleStr?: string): Promise<any | null> => {
            if (!paperTitleStr) return null;
            const exactSnap = await db.collection('fullExamPapers').where('paperTitle', '==', paperTitleStr).limit(1).get();
            if (!exactSnap.empty) return exactSnap.docs[0].data();

            const codeMatch = paperTitleStr.match(/\b([0-9A-Z]{4,6}\/[0-9A-Z]{1,3}|8700\/[12]|8300\/[123][FH]|1MA1\/[123][FH]|J560\/0[1-6]|J351\/0[12]|1EN0\/0[12])\b/i);
            if (codeMatch) {
                const targetCode = codeMatch[1].toUpperCase();
                let byCodeSnap = await db.collection('fullExamPapers').where('paperCode', '==', targetCode).get();
                if (byCodeSnap.empty) {
                    byCodeSnap = await db.collection('fullExamPapers').where('metadata.exam_code', '==', targetCode).get();
                }
                if (!byCodeSnap.empty) {
                    const norm = (s: string) => (s || '').toLowerCase().replace(/\b(june|may|summer)\b/g, 'summer').replace(/[^a-z0-9]/g, '');
                    const targetNorm = norm(paperTitleStr);
                    const matched = byCodeSnap.docs.find(d => {
                        const data = d.data();
                        const series = data.examSeries || data.metadata?.exam_series || '';
                        return series && targetNorm.includes(norm(series));
                    }) || byCodeSnap.docs[0];
                    return matched.data();
                }
            }
            return null;
        };

        const officialPaperDoc = await findOfficialPaperDoc(options.paperTitle);

        const getOfficialQuestionFromDoc = (paperDoc: any, qNum: string): any | null => {
            if (!paperDoc) return null;
            const qList = paperDoc.questions || paperDoc.marking_scheme?.questions || paperDoc.markingScheme?.allQuestions;
            const baseTarget = getBaseQuestionNumber(qNum) || qNum;
            if (Array.isArray(qList)) {
                return qList.find((q: any) => {
                    const qn = String(q.questionNumber ?? q.question_number ?? q.number ?? '').replace(/^0+/, '');
                    return qn === qNum || getBaseQuestionNumber(qn) === baseTarget;
                }) || null;
            } else if (qList && typeof qList === 'object') {
                return qList[qNum] || qList[`0${qNum}`] || qList[baseTarget] || null;
            }
            return null;
        };

        if (targetQNum) {
            const dbQObj = getOfficialQuestionFromDoc(officialPaperDoc, targetQNum);
            const officialStemText = dbQObj?.questionText || dbQObj?.question_text || dbQObj?.text || '';

            if (classificationResult?.questions?.length > 0) {
                classificationResult.questions.forEach((q: any) => {
                    q.questionNumber = targetQNum;
                    if (officialStemText) {
                        q.text = officialStemText;
                    }
                });
            }
            if (Array.isArray(allClassificationResults)) {
                allClassificationResults.forEach((cr: any) => {
                    const qArr = cr?.result?.questions || cr?.questions || [];
                    if (Array.isArray(qArr)) {
                        qArr.forEach((q: any) => {
                            q.questionNumber = targetQNum;
                            if (officialStemText) {
                                q.text = officialStemText;
                            }
                        });
                    }
                });
            }
        }

        let subjectProfile: SubjectProfile = resolveSubjectProfile({
            detectedSubject: cacheData.subjectProfileKey,
            subject: parsedCustomScheme?.examDetails?.subject || officialPaperDoc?.metadata?.subject || officialPaperDoc?.subject,
            paperCode: parsedCustomScheme?.examDetails?.paperCode || officialPaperDoc?.metadata?.exam_code || officialPaperDoc?.paperCode || options.paperTitle,
            paperTitle: options.paperTitle,
            customText: options.paperTitle
        });

        const individualQuestions = extractQuestionsFromClassification(classificationResult, standardizedPages[0]?.originalFileName);
        if (targetQNum && individualQuestions.length > 0) {
            const dbQObj = getOfficialQuestionFromDoc(officialPaperDoc, targetQNum);
            const officialStemText = dbQObj?.questionText || dbQObj?.question_text || dbQObj?.text || '';
            individualQuestions.forEach(iq => {
                iq.questionNumber = targetQNum;
                if (officialStemText) iq.text = officialStemText;
            });
        }

        const orchestrationResult = await MarkingSchemeOrchestrationService.orchestrateMarkingSchemeLookup(
            individualQuestions,
            classificationResult,
            options.paperTitle || null,
            parsedCustomScheme,
            subjectProfile?.ocrStrategy === 'VISION_VERBATIM'
        );

        const markingSchemesMap = orchestrationResult.markingSchemesMap;
        const detectionResults = orchestrationResult.detectionResults;
        classificationResult = orchestrationResult.updatedClassificationResult;

        const firstMatch = detectionResults.find((dr: any) => dr?.detectionResult?.found && dr?.detectionResult?.match)?.detectionResult?.match;
        if (firstMatch) {
            const dbResolvedProfile = resolveSubjectProfile({
                detectedSubject: cacheData.subjectProfileKey,
                subject: firstMatch.subject || firstMatch.qualification,
                paperCode: firstMatch.paperCode || firstMatch.examCode || options.paperTitle,
                paperTitle: firstMatch.paperTitle || options.paperTitle
            });
            if (dbResolvedProfile.key !== subjectProfile.key) {
                subjectProfile = dbResolvedProfile;
            }
        }

        // CRITICAL: Attach subjectProfile to every entry in markingSchemesMap so LoR vs M1/A1/B1 prompts work properly!
        if (markingSchemesMap && markingSchemesMap.size > 0) {
            for (const schemeEntry of markingSchemesMap.values()) {
                if (schemeEntry && typeof schemeEntry === 'object') {
                    schemeEntry.subjectProfile = subjectProfile;
                    if (schemeEntry.questionMarks && typeof schemeEntry.questionMarks === 'object') {
                        schemeEntry.questionMarks.subjectProfile = subjectProfile;
                    }
                }
            }
        }

        // 3. Run Fast Marking & Output Generation (marking -> generating_output)
        progressCallback(createProgressData(2, 'Re-marking with official rubric...', REMARK_STEPS));

        const pageDimensionsMap = new Map<number, { width: number; height: number }>();
        standardizedPages.forEach(p => {
            if (p.width && p.height) pageDimensionsMap.set(p.pageIndex, { width: p.width, height: p.height });
        });

        // Attach classificationResult to allPagesOcrData pages so createMarkingTasksFromClassification links lines properly
        allPagesOcrData.forEach(page => {
            const matches = allClassificationResults.filter((r: any) => r.pageIndex === page.pageIndex);
            if (matches.length > 0) {
                (page as any).classificationResult = {
                    questions: matches.flatMap((m: any) => m.result?.questions || m.questions || [])
                };
            }
        });

        const markingTasks = createMarkingTasksFromClassification(
            classificationResult,
            allPagesOcrData,
            markingSchemesMap,
            pageDimensionsMap,
            standardizedPages,
            allClassificationResults,
            []
        );

        const selectedTier = (options.model && options.model !== 'auto') ? options.model : getDefaultModel();
        const actualModel = selectedTier;

        const allQuestionResults: any[] = [];
        for (const task of markingTasks) {
            const mockRes = {
                write: (data: string) => {
                    if (data.startsWith('data: ')) {
                        try {
                            const parsed = JSON.parse(data.substring(6));
                            progressCallback(parsed);
                        } catch (e) {}
                    }
                }
            } as any;
            const result = await executeMarkingForQuestion(
                task,
                mockRes,
                resolvedSessionId,
                actualModel as ModelType,
                allPagesOcrData,
                usageTracker
            );
            if (!result.studentWork) {
                result.studentWork = task.classificationStudentWork || task.formattedOcrText || '';
            }
            if (!result.classificationBlocks && task.classificationBlocks) {
                result.classificationBlocks = task.classificationBlocks;
            }
            if (task.questionText && !result.questionText) {
                result.questionText = task.questionText;
            }
            if (task.databaseQuestionText && !result.databaseQuestionText) {
                result.databaseQuestionText = task.databaseQuestionText;
            }
            allQuestionResults.push(result);
        }

        progressCallback(createProgressData(3, 'Updating grade boundaries & annotations...', REMARK_STEPS));

        const dummyFiles: any[] = standardizedPages.map((p, idx) => ({
            originalname: p.originalFileName || `page-${idx + 1}.jpg`,
            buffer: Buffer.from(p.imageData.replace(/^data:image\/[a-z]+;base64,/, ''), 'base64'),
            size: p.imageData.length
        }));

        const {
            finalAnnotatedOutput,
            overallScore,
            totalPossibleScore,
            overallScoreText,
            updatedQuestionResults,
            sortedStandardizedPages
        } = await MarkingOutputService.generateOutput(
            standardizedPages,
            allQuestionResults,
            classificationResult,
            allClassificationResults,
            allPagesOcrData,
            dummyFiles,
            resolvedSessionId,
            { userId: options.userId },
            markingSchemesMap,
            progressCallback,
            REMARK_STEPS
        );

        let detectedQuestionForGrade: any = undefined;
        if (markingSchemesMap && markingSchemesMap.size > 0) {
            const allSchemes = Array.from(markingSchemesMap.values());
            const firstSchemeEntry = allSchemes.find((s: any) => !s?.isGeneric && s?.questionDetection?.found && s?.questionDetection?.match) || allSchemes[0];
            detectedQuestionForGrade = firstSchemeEntry?.questionDetection || undefined;
        }

        const gradeResult = await GradeBoundaryService.calculateGradeWithOrchestration(
            overallScore,
            totalPossibleScore,
            detectedQuestionForGrade,
            markingSchemesMap
        );

        const richMarkingContext = await ChatContextBuilder.buildMarkingContext({
            allQuestionResults: updatedQuestionResults,
            questionDetection: detectionResults?.[0] || null,
            markingSchemesMap,
            detectionResults,
            overallScore: {
                awardedMarks: overallScore,
                totalMarks: totalPossibleScore,
                percentage: totalPossibleScore > 0 ? Math.round((overallScore / totalPossibleScore) * 100) : 0,
                scoreText: overallScoreText
            },
            gradeBoundaryResult: gradeResult,
            standardizedPages: sortedStandardizedPages
        });

        // 4. Update Session In-Place using SessionManagementService.createAIMessageForDatabase
        const sessionRef = db.collection('unifiedSessions').doc(resolvedSessionId);
        const sessionSnap = await sessionRef.get();
        if (!sessionSnap.exists) {
            throw new Error(`Unified session ${resolvedSessionId} not found`);
        }
        const sessionDoc = sessionSnap.data() as any;
        const existingMessages: any[] = Array.isArray(sessionDoc.messages)
            ? [...sessionDoc.messages]
            : Array.isArray(sessionDoc.unifiedMessages)
                ? [...sessionDoc.unifiedMessages]
                : [];

        let assistantIndex = -1;
        for (let i = existingMessages.length - 1; i >= 0; i--) {
            if (existingMessages[i].role === 'assistant') {
                assistantIndex = i;
                break;
            }
        }

        const preservedAiMessageId = assistantIndex >= 0
            ? existingMessages[assistantIndex].id
            : (options.aiMessageId || `ai-${Date.now()}`);

        const stepTimings: any = {};
        const dbAiMessage = await SessionManagementService.createAIMessageForDatabase({
            allQuestionResults: updatedQuestionResults,
            finalAnnotatedOutput,
            files: dummyFiles as any,
            actualModel,
            startTime,
            markingSchemesMap,
            detectionResults,
            globalQuestionText: classificationResult?.questions?.[0]?.text || '',
            resolvedAIMessageId: preservedAiMessageId,
            studentScore: {
                totalMarks: totalPossibleScore,
                awardedMarks: overallScore,
                scoreText: overallScoreText
            },
            grade: gradeResult.grade,
            predictedGrade: gradeResult.predictedGrade,
            gradeBoundaryType: gradeResult.boundaryType,
            gradeBoundaries: gradeResult.boundaries,
            markingContext: richMarkingContext,
            usageTracker,
            stepTimings,
            standardizedPages: sortedStandardizedPages
        });

        (dbAiMessage as any).suggestedFollowUps = await getSuggestedFollowUps();
        (dbAiMessage as any).requiresMarkingScheme = false;
        (dbAiMessage as any).timestamp = new Date().toISOString();

        (dbAiMessage as any).questionResponses = updatedQuestionResults.map(qr => ({
            questionNumber: String(qr.questionNumber || ''),
            questionText: qr.questionText || '',
            markingScheme: qr.markingScheme || '',
            score: qr.score,
            annotations: Array.isArray(qr.annotations)
                ? [...qr.annotations].sort((a, b) => getQuestionSortValue(a.subQuestion) - getQuestionSortValue(b.subQuestion))
                : qr.annotations,
            studentWork: qr.studentWork,
            pageIndex: qr.pageIndex,
            overallPerformanceSummary: qr.overallPerformanceSummary || qr.feedback
        })).sort((a, b) => getQuestionSortValue(a.questionNumber) - getQuestionSortValue(b.questionNumber));

        if (assistantIndex >= 0) {
            existingMessages[assistantIndex] = dbAiMessage;
        } else {
            existingMessages.push(dbAiMessage);
        }

        const { generateSessionTitleFromDetectionResults } = await import('./questionDetectionService.js');
        const finalSessionTitle = detectionResults && detectionResults.length > 0
            ? generateSessionTitleFromDetectionResults(detectionResults, 'Marking')
            : `${options.paperTitle || 'Custom Mark Scheme'}${targetQNum ? ` Q${targetQNum}` : ''}`;

        const updatedSessionFields: any = {
            title: finalSessionTitle,
            sessionTitle: finalSessionTitle,
            messageType: 'Marking',
            usageMode: 'marking',
            isPastPaper: Boolean(options.paperTitle),
            studentScore: dbAiMessage.studentScore,
            detectedQuestion: dbAiMessage.detectedQuestion,
            messages: existingMessages,
            unifiedMessages: existingMessages,
            updatedAt: new Date().toISOString(),
            lastMessagePreview: {
                content: dbAiMessage.content,
                role: 'assistant',
                timestamp: dbAiMessage.timestamp
            }
        };

        await sessionRef.set(updatedSessionFields, { merge: true });

        const unifiedSessionPayload = {
            ...sessionDoc,
            ...updatedSessionFields,
            id: resolvedSessionId,
            sessionId: resolvedSessionId,
            messages: existingMessages
        };

        import('../subjectMarkingResultService.js').then(({ persistMarkingResultToSubject }) => {
            persistMarkingResultToSubject(unifiedSessionPayload, dbAiMessage).catch(() => {});
        }).catch(() => {});

        const finalOutput = {
            success: true,
            submissionId: resolvedSessionId,
            sessionId: resolvedSessionId,
            sessionTitle: finalSessionTitle,
            unifiedSession: unifiedSessionPayload,
            aiMessage: dbAiMessage,
            annotatedOutput: finalAnnotatedOutput,
            outputFormat: 'images',
            results: updatedQuestionResults,
            metadata: {
                totalQuestions: updatedQuestionResults.length,
                totalScore: overallScore,
                maxScore: totalPossibleScore,
                processingTime: (Date.now() - startTime) / 1000
            },
            processingStats: {
                modelUsed: actualModel,
                totalMarks: totalPossibleScore,
                awardedMarks: overallScore,
                questionCount: updatedQuestionResults.length
            }
        };

        progressCallback({ type: 'complete', result: finalOutput });
        return finalOutput;
    }
}
