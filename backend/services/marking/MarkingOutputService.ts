import type { StandardizedPage, PageOcrResult } from '../../types/markingRouter.js';
import type { QuestionResult, EnrichedAnnotation } from './MarkingExecutor.js';
import { SVGOverlayService } from './svgOverlayService.js';
import { ImageStorageService } from '../imageStorageService.js';
import { calculateOverallScore, calculateQuestionFirstPageScores, buildClassificationPageToSubQuestionMap, buildPageToQuestionNumbersMap, getQuestionSortValue } from './MarkingHelpers.js';
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
        MULTI_IMAGE_STEPS: string[],
        isProduction: boolean = false
    ): Promise<{
        finalAnnotatedOutput: string[];
        overallScore: number;
        totalPossibleScore: number;
        overallScoreText: string;
        updatedQuestionResults: QuestionResult[];
        sortedStandardizedPages: StandardizedPage[];
    }> {
        // --- Calculate Overall Score and Per-Page Scores ---
        const { overallScore, totalPossibleScore, overallScoreText } = calculateOverallScore(allQuestionResults);
        const questionFirstPageScores = calculateQuestionFirstPageScores(allQuestionResults, classificationResult);


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

        // --- Determine First Page After Sorting (for total score placement) ---
        // Create array to determine which page will be first after sorting
        const pagesForSorting = standardizedPages.map((page, index) => {
            const classificationForPage = allClassificationResults.find(c => c.pageIndex === page.pageIndex);
            const mapperCategory = classificationForPage?.result?.category;

            return {
                page,
                pageIndex: page.pageIndex,
                pageNumber: extractPageNumber(page.originalFileName),
                isMetadataPage: mapperCategory === 'metadata' || mapperCategory === 'frontPage',
                originalIndex: index
            };
        });

        // Sort to find first page (metadata first, then by page number, then by original index)
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

        const hasMetaPage = pagesForSorting.some(p => p.isMetadataPage);
        const firstPageIndexAfterSorting = pagesForSorting[0]?.pageIndex ?? 0;

        // --- Parallel Annotation Drawing using SVGOverlayService ---
        // Note: Pages passed here are already filtered (metadata + questionAnswer only)
        progressCallback(createProgressData(7, `Drawing annotations on ${standardizedPages.length} pages...`, MULTI_IMAGE_STEPS));

        const annotationPromises = standardizedPages.map(async (page) => {
            const pageIndex = page.pageIndex;
            const annotationsForThisPage = annotationsByPage[pageIndex] || [];
            const imageDimensions = { width: page.width, height: page.height };

            // Draw question-specific scores on their first pages
            const scoresToDraw = questionFirstPageScores.get(pageIndex);
            // Add total score with double underline on first page AFTER reordering
            const totalScoreToDraw = (pageIndex === firstPageIndexAfterSorting) ? overallScoreText : undefined;

            // Only call service if there's something to draw
            if (annotationsForThisPage.length > 0 || scoresToDraw || totalScoreToDraw) {
                try {
                    return await SVGOverlayService.burnSVGOverlayServerSide(
                        page.imageData,
                        annotationsForThisPage,
                        imageDimensions,
                        scoresToDraw,
                        totalScoreToDraw,
                        hasMetaPage,
                        isProduction
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

            // Use mapper's classification category as source of truth
            const classificationForPage = allClassificationResults.find(c => c.pageIndex === page.pageIndex);
            const mapperCategory = classificationForPage?.result?.category;

            // A page is metadata if the mapper classified it as such
            let isLikelyMetadata = mapperCategory === 'metadata' || mapperCategory === 'frontPage';

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

            // CRITICAL FIX: Trust the mapper's classification
            // If mapper said it's metadata, DON'T override even if we detect question numbers
            // (Front pages often contain spurious numbers like "Total Marks: 80")
            // Only override metadata status if:
            // 1. Questions were detected, AND
            // 2. Mapper did NOT classify as metadata/frontPage
            if (lowestQ !== Infinity && mapperCategory !== 'metadata' && mapperCategory !== 'frontPage') {
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
        // Sort: metadata pages first, then strictly by page number
        // Rationale: Question numbers can be detected out of order (e.g. Q11 appearing on an earlier page due to errors)
        // or misidentified. Page numbers are the physical truth of the exam paper structure.
        pagesWithOutput.sort((a, b) => {
            if (a.isMetadataPage && !b.isMetadataPage) return -1;
            if (!a.isMetadataPage && b.isMetadataPage) return 1;

            // Strict Page Number Sorting
            // Only use question number if page numbers are totally missing (rare) or equal
            if (a.pageNumber !== null && b.pageNumber !== null) {
                return a.pageNumber - b.pageNumber;
            }

            // Fallback for missing page numbers:
            const aHasQuestions = a.lowestQuestionNumber !== Infinity;
            const bHasQuestions = b.lowestQuestionNumber !== Infinity;

            if (aHasQuestions && !bHasQuestions) return -1;
            if (!aHasQuestions && bHasQuestions) return 1;

            if (aHasQuestions && bHasQuestions) {
                return a.lowestQuestionNumber - b.lowestQuestionNumber;
            }

            return a.originalIndex - b.originalIndex;
        });

        // Extract sorted annotated output
        const finalAnnotatedOutput: string[] = pagesWithOutput.map(item => item.annotatedOutput);

        // Log the EXACT order of pages sent to frontend
        const pageOrderLog = pagesWithOutput.map((p, i) => {
            let qInfo = 'NoQ';

            // If this is a metadata/front page, show that clearly
            if (p.isMetadataPage) {
                qInfo = 'FRONT PAGE';
            } else {
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
            }

            return `[${i + 1}] Page ${p.pageNumber} (\x1b[37m${qInfo}\x1b[32m)`;
        }).join(' -> ');

        // ========================= LOGICAL RE-INDEXING (FOR FRONTEND SYNC) =========================
        console.log(`\x1b[32m🔄 [LOGICAL RE-INDEXING] Aligning logical indices with sorted physical order...\x1b[0m`);

        // 1. Create mapping from OLD pageIndex to NEW sorted position
        const oldToNewIndex = new Map<number, number>();
        pagesWithOutput.forEach((item, newIdx) => {
            oldToNewIndex.set(item.pageIndex, newIdx);
        });

        // 2. Identify the sorted standardizedPages
        const sortedStandardizedPages = pagesWithOutput.map((item, newIdx) => {
            // Update the pageIndex in the StandardizedPage object itself to match its new position
            return {
                ...item.page,
                pageIndex: newIdx,
                originalPageIndex: item.pageIndex // Store the original index for re-alignment mapping
            };
        });

        // 3. Deep-update allQuestionResults to point to these new indices
        const updatedQuestionResults = allQuestionResults.map(qr => {
            const newQr = { ...qr };

            // Update top-level pageIndex for the result (if it exists)
            if (qr.pageIndex !== undefined && qr.pageIndex >= 0) {
                newQr.pageIndex = oldToNewIndex.get(qr.pageIndex) ?? qr.pageIndex;
            }

            // Update all sourceImageIndices (for multi-page questions)
            if (qr.sourceImageIndices) {
                newQr.sourceImageIndices = qr.sourceImageIndices.map(idx => oldToNewIndex.get(idx) ?? idx);
            }

            // Update all annotations
            if (qr.annotations) {
                newQr.annotations = qr.annotations.map(anno => ({
                    ...anno,
                    pageIndex: oldToNewIndex.get(anno.pageIndex) ?? anno.pageIndex
                }));
            }

            return newQr;
        });

        console.log(`\x1b[32m✅ [LOGICAL RE-INDEXING] Re-indexed ${updatedQuestionResults.length} questions and ${sortedStandardizedPages.length} pages.\x1b[0m`);
        // =========================================================================================

        console.log(`\x1b[32m✅ \x1b[1m[FINAL PAGE ORDER]\x1b[0m \x1b[32m${pageOrderLog}\x1b[0m`);

        return {
            finalAnnotatedOutput,
            overallScore,
            totalPossibleScore,
            overallScoreText,
            updatedQuestionResults,
            sortedStandardizedPages
        };
    }
}
