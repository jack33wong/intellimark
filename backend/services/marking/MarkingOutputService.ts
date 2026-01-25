import type { StandardizedPage, PageOcrResult } from '../../types/markingRouter.js';
import type { QuestionResult } from '../../types/marking.js';
import type { EnrichedAnnotation } from '../../types/index.js';
import { SVGOverlayService } from './svgOverlayService.js';
import { ImageStorageService } from '../imageStorageService.js';
import { calculateOverallScore, calculateQuestionFirstPageScores, buildClassificationPageToSubQuestionMap, buildPageToQuestionNumbersMap, getQuestionSortValue } from './MarkingHelpers.js';
import { createProgressData } from '../../utils/sseUtils.js';

export class MarkingOutputService {

    /**
     * Generates the final output for the marking process.
     * Handles:
     * 1. Hybrid Resolution (Coordinate Snapping) [NEW]
     * 2. Score Calculation
     * 3. Annotation Grouping
     * 4. Page Sorting (Metadata -> Question Number -> Page Number)
     * 5. Annotation Drawing (SVG Overlay)
     * 6. Image Upload (for authenticated users)
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
        updatedQuestionResults: QuestionResult[];
        sortedStandardizedPages: StandardizedPage[];
    }> {

        // ========================= HYBRID RESOLUTION: FIX COORDINATE DRIFT =========================
        // 🔧 FIX: Post-process annotations to snap fuzzy/semantic IDs to precise/physical Mathpix blocks.
        // This solves the "Split Brain" problem where AI picks a Semantic ID (meaning) but we need Physical Geometry (pixels).
        console.log('🔧 [HYBRID RESOLUTION] Applying coordinate snapping to marking results...');

        allQuestionResults.forEach(qr => {
            if (qr.annotations) {
                qr.annotations.forEach(annotation => {
                    // 1. Resolve Target ID: 
                    // Priority A: 'linked_ocr_id' (The AI explicitly linked a Semantic ID to a Physical Block)
                    // Priority B: 'line_id' (The AI selected a Physical Block directly)
                    const targetId = annotation.linked_ocr_id ||
                        (annotation.line_id && annotation.line_id.startsWith('p0_ocr') ? annotation.line_id : null);

                    if (targetId) {
                        // 2. Find the Physical Block in allPagesOcrData
                        let preciseBlock: any = null;

                        // Optimization: Check the page index associated with the annotation first
                        const targetPageIdx = annotation.pageIndex;
                        const pageData = allPagesOcrData.find(p => p.pageIndex === targetPageIdx);

                        if (pageData) {
                            if (pageData.ocrData?.mathBlocks) {
                                preciseBlock = pageData.ocrData.mathBlocks.find((b: any) => b.id === targetId || b.globalBlockId === targetId);
                            }
                            if (!preciseBlock && pageData.ocrData?.blocks) {
                                preciseBlock = pageData.ocrData.blocks.find((b: any) => b.id === targetId || b.globalBlockId === targetId);
                            }
                        }

                        // Fallback: Search all pages if not found (e.g. cross-page reference)
                        if (!preciseBlock) {
                            for (const p of allPagesOcrData) {
                                if (p.ocrData?.mathBlocks) {
                                    preciseBlock = p.ocrData.mathBlocks.find((b: any) => b.id === targetId || b.globalBlockId === targetId);
                                    if (preciseBlock) break;
                                }
                                if (p.ocrData?.blocks) {
                                    preciseBlock = p.ocrData.blocks.find((b: any) => b.id === targetId || b.globalBlockId === targetId);
                                    if (preciseBlock) break;
                                }
                            }
                        }

                        if (preciseBlock && preciseBlock.box) {
                            // 3. SNAP: Overwrite visual_position with Precise Mathpix Geometry
                            // Mathpix coordinates are typically absolute relative to the page image size.
                            // This bypasses any fuzzy estimation or offset calculation errors.
                            console.log(`🧲 [SNAP] Snapping annotation ${annotation.line_id} to physical block ${targetId}`);

                            annotation.visual_position = {
                                x: preciseBlock.box.x,
                                y: preciseBlock.box.y,
                                width: preciseBlock.box.width,
                                height: preciseBlock.box.height
                            };

                            // Mark as snapped for debugging/transparency
                            (annotation as any)._snappedToPhysical = true;
                        } else {
                            // console.warn(`⚠️ [SNAP] Could not find physical block for ID: ${targetId}`);
                        }
                    }
                });
            }
        });
        // ===========================================================================================


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
                // Collect semantic zones for this page to draw debug borders if enabled
                const zonesForThisPage: any[] = [];
                allQuestionResults.forEach(qr => {
                    if (qr.semanticZones) {
                        Object.entries(qr.semanticZones).forEach(([label, zones]: [string, any]) => {
                            zones.forEach((z: any) => {
                                if (z.pageIndex === pageIndex) {
                                    zonesForThisPage.push({ ...z, label });
                                }
                            });
                        });
                    }
                });

                try {
                    return await SVGOverlayService.burnSVGOverlayServerSide(
                        page.imageData,
                        annotationsForThisPage,
                        imageDimensions,
                        scoresToDraw,
                        totalScoreToDraw,
                        hasMetaPage,
                        zonesForThisPage
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
        const pageToQuestionNumbers = buildPageToQuestionNumbersMap(allQuestionResults, markingSchemesMap, classificationPageToSubQuestion, classificationResult);

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

        // Sort: metadata pages first, then strictly by logical question order, then by filename sequence
        pagesWithOutput.sort((a, b) => {
            if (a.isMetadataPage && !b.isMetadataPage) return -1;
            if (!a.isMetadataPage && b.isMetadataPage) return 1;

            // NEW: Prioritize Detected Question Order (Logical Ground Truth)
            const aHasQuestions = a.lowestQuestionNumber !== Infinity;
            const bHasQuestions = b.lowestQuestionNumber !== Infinity;

            if (aHasQuestions && bHasQuestions) {
                if (a.lowestQuestionNumber !== b.lowestQuestionNumber) {
                    return a.lowestQuestionNumber - b.lowestQuestionNumber;
                }
            }

            // Fallback: Physical Page Number Sorting (Filename sequence)
            if (a.pageNumber !== null && b.pageNumber !== null) {
                return a.pageNumber - b.pageNumber;
            }

            // Secondary fallback: questions before non-questions
            if (aHasQuestions && !bHasQuestions) return -1;
            if (!aHasQuestions && bHasQuestions) return 1;

            // Final fallback: original upload sequence
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