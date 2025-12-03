import type { StandardizedPage, PageOcrResult } from '../../types/markingRouter.js';
import type { QuestionResult, EnrichedAnnotation } from './MarkingExecutor.js';
import { SVGOverlayService } from './svgOverlayService.js';
import { ImageStorageService } from '../imageStorageService.js';
import { calculateOverallScore, calculatePerPageScores, buildClassificationPageToSubQuestionMap, buildPageToQuestionNumbersMap, getQuestionSortValue } from './MarkingHelpers.js';
import { createProgressData } from '../../utils/sseUtils.js';

export class MarkingOutputService {

    /**
     * Generates the final output for the marking process.
     * Handles:
     * 1. Score Calculation
     * 2. Annotation Grouping
     * 3. Page Sorting (Metadata -> Question Number -> Page Number)
     * 4. Annotation Drawing (SVG Overlay)
     * 5. Image Upload (for authenticated users)
     */
    static async generateOutput(
        standardizedPages: StandardizedPage[],
        allQuestionResults: QuestionResult[],
        classificationResult: any,
        allClassificationResults: any[],
        allPagesOcrData: PageOcrResult[],
        files: Express.Multer.File[],
        submissionId: string,
        options: { userId?: string },
        markingSchemesMap: Map<string, any>,
        progressCallback: (data: any) => void,
        MULTI_IMAGE_STEPS: string[]
    ): Promise<{
        finalAnnotatedOutput: string[];
        overallScore: number;
        totalPossibleScore: number;
        overallScoreText: string;
    }> {
        // --- Calculate Overall Score and Per-Page Scores ---
        const { overallScore, totalPossibleScore, overallScoreText } = calculateOverallScore(allQuestionResults);
        const pageScores = calculatePerPageScores(allQuestionResults, classificationResult);

        // --- Annotation Grouping ---
        const annotationsByPage: { [pageIndex: number]: EnrichedAnnotation[] } = {};

        allQuestionResults.forEach((qr) => {
            const currentAnnotations = qr.annotations || [];
            currentAnnotations.forEach((anno) => {
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

        // --- Determine First Page After Sorting (for total score placement) ---
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
                    if (!isNaN(pageNum) && pageNum >= 0) {
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

        const firstPageIndexAfterSorting = pagesForSorting[0]?.pageIndex ?? 0;

        // --- Parallel Annotation Drawing using SVGOverlayService ---
        progressCallback(createProgressData(7, `Drawing annotations on ${standardizedPages.length} pages...`, MULTI_IMAGE_STEPS));

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
        progressCallback(createProgressData(7, 'Annotation drawing complete.', MULTI_IMAGE_STEPS));

        // --- Upload Annotated Images to Storage (for authenticated users) ---
        let annotatedImageLinks: string[] = [];
        const isAuthenticated = !!options.userId;

        if (isAuthenticated) {
            const uploadPromises = annotatedImagesBase64.map(async (imageData, index) => {
                const originalFileName = files[index]?.originalname || `image-${index + 1}.png`;
                try {
                    const imageLink = await ImageStorageService.uploadImage(
                        imageData,
                        options.userId!,
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
                    throw new Error(`Failed to upload annotated image ${index} (${originalFileName}): ${errorMessage}`);
                }
            });
            annotatedImageLinks = await Promise.all(uploadPromises);
        }

        // --- Sort Final Annotated Output ---

        // Create mapping from pageIndex to question numbers using MARKING RESULTS (Ground Truth)
        const classificationPageToSubQuestion = buildClassificationPageToSubQuestionMap(classificationResult);
        const pageToQuestionNumbers = buildPageToQuestionNumbersMap(allQuestionResults, markingSchemesMap, classificationPageToSubQuestion);

        // Create array with page info and annotated output for sorting
        const pagesWithOutput = standardizedPages.map((page, index) => {
            const pageNum = extractPageNumber(page.originalFileName);
            let isLikelyMetadata = (page as any).isMetadataPage || (pageNum === 1 && (!pageToQuestionNumbers.has(page.pageIndex)));

            let lowestQ = (pageToQuestionNumbers.get(page.pageIndex) || []).sort((a, b) => a - b)[0] || Infinity;

            // HEURISTIC FALLBACK: If Marking AI missed this page (Infinity), try to find Q# in OCR data
            if (lowestQ === Infinity) {
                const ocrData = allPagesOcrData.find(d => d.pageIndex === page.pageIndex);
                if (ocrData) {
                    const textToCheck = ocrData.classificationText || ocrData.ocrData?.text || '';
                    const match = textToCheck.match(/(?:^|\s)(?:Q)?(\d+)([a-z])?(?:\s|$)/i);
                    if (match) {
                        const mainNum = match[1];
                        const subPart = match[2] || '';
                        const questionStr = `${mainNum}${subPart}`;

                        const sortValue = getQuestionSortValue(questionStr);
                        if (sortValue !== Infinity) {
                            lowestQ = sortValue;
                        }
                    }
                }
            }

            // FIX: If questions detected, override metadata flag (e.g. back cover with questions)
            // EXCEPTION: If it's the FIRST page (index 0), trust the metadata classification (Front Page)
            // This prevents the front page from being sorted to the end if it contains numbers (e.g. "Total Marks: 80")
            if (lowestQ !== Infinity && page.pageIndex > 0) {
                isLikelyMetadata = false;
            }

            return {
                page,
                annotatedOutput: isAuthenticated ? annotatedImageLinks[index] : annotatedImagesBase64[index],
                pageNumber: pageNum,
                isMetadataPage: isLikelyMetadata,
                originalIndex: index,
                pageIndex: page.pageIndex,
                lowestQuestionNumber: lowestQ
            };
        });

        // Sort: metadata pages first, then by question number, then by page number
        pagesWithOutput.sort((a, b) => {
            if (a.isMetadataPage && !b.isMetadataPage) return -1;
            if (!a.isMetadataPage && b.isMetadataPage) return 1;

            const aHasQuestions = a.lowestQuestionNumber !== Infinity;
            const bHasQuestions = b.lowestQuestionNumber !== Infinity;

            if (aHasQuestions && !bHasQuestions) return -1;
            if (!aHasQuestions && bHasQuestions) return 1;

            if (aHasQuestions && bHasQuestions) {
                return a.lowestQuestionNumber - b.lowestQuestionNumber;
            }

            return a.pageNumber - b.pageNumber;
        });

        // Extract sorted annotated output
        const finalAnnotatedOutput: string[] = pagesWithOutput.map(item => item.annotatedOutput);

        // Log the EXACT order of pages sent to frontend
        const pageOrderLog = pagesWithOutput.map((p, i) => {
            let qInfo = 'NoQ';

            // Get all question labels for this page from classification map
            const pageLabels: string[] = [];
            if (classificationPageToSubQuestion.has(p.pageIndex)) {
                const subQList = classificationPageToSubQuestion.get(p.pageIndex);
                if (subQList) {
                    // Collect all sub-question labels
                    subQList.forEach((subQNum) => {
                        pageLabels.push(`Q${subQNum}`);
                    });
                }
            }

            // Deduplicate labels
            const uniqueLabels = [...new Set(pageLabels)];

            // If no labels found but we have a lowestQuestionNumber, try to format it
            if (uniqueLabels.length === 0 && p.lowestQuestionNumber !== Infinity) {
                qInfo = `Q${p.lowestQuestionNumber}`; // Fallback
            } else if (uniqueLabels.length > 0) {
                // Sort labels naturally (e.g. Q3a before Q3b, Q3 before Q4)
                uniqueLabels.sort((a, b) => {
                    return getQuestionSortValue(a) - getQuestionSortValue(b);
                });
                qInfo = uniqueLabels.join(', ');
            }

            return `[${i + 1}] Page ${p.pageNumber} (\x1b[37m${qInfo}\x1b[32m)`;
        }).join(' -> ');

        console.log(`\x1b[32m✅ \x1b[1m[FINAL PAGE ORDER]\x1b[0m \x1b[32m${pageOrderLog}\x1b[0m`);

        return {
            finalAnnotatedOutput,
            overallScore,
            totalPossibleScore,
            overallScoreText
        };
    }
}
