import type { StandardizedPage, PageOcrResult } from '../../types/markingRouter.js';
import type { QuestionResult } from '../../types/marking.js';
import type { EnrichedAnnotation } from '../../types/index.js';
import { SVGOverlayService } from './svgOverlayService.js';
import { ImageStorageService } from '../imageStorageService.js';
import { calculateOverallScore, calculateQuestionFirstPageScores, buildClassificationPageToSubQuestionMap, getQuestionSortValue } from './MarkingHelpers.js';
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
        standardizedPages: StandardizedPage[], // ✅ This comes in ALREADY SORTED by the Pipeline
        markingResults: QuestionResult[],
        classificationResult: any,
        allClassificationResults: any[],
        allPagesOcrData: PageOcrResult[],
        files: Express.Multer.File[],
        submissionId: string,
        options: { userId?: string },
        markingSchemesMap: Map<string, any>,
        progressCallback: (data: any) => void,
        MULTI_IMAGE_STEPS: string[]
    ) {
        const startTime = Date.now();
        const isAuthenticated = !!options.userId;

        // --- 1. Draw Annotations (Zones & Marks) ---
        // We iterate through the standardizedPages in their CURRENT (Correct) order.
        const annotatedImagesBase64 = await Promise.all(standardizedPages.map(async (page, i) => {
            const pageIndex = page.pageIndex;
            // Find questions that belong to this page index
            // Note: markingResults have updated pageIndex from the Pipeline's Re-Indexing step
            // Find questions that belong to this physical page (by primary anchor OR by having annotations on this page)
            const pageQuestions = markingResults.filter(r =>
                r.pageIndex === pageIndex ||
                r.annotations?.some(a => a.pageIndex === pageIndex) ||
                (r.sourceImageIndices && r.sourceImageIndices.includes(pageIndex))
            );

            // ========================= 🎨 [RENDERER AUDIT] =========================
            // CRITICAL DEBUG: Check if the Zone Coordinates actually reached the renderer.
            // If this logs "❌ NO ZONE", then 'MarkingExecutor' failed to attach the data to the final result.
            if (pageQuestions.length > 0) {
                console.log(`\n🎨 [RENDERER AUDIT] Page ${i} (Physical Index: ${pageIndex}) (W: ${page.width}, H: ${page.height}) - ${pageQuestions.length} Questions:`);
                pageQuestions.forEach(q => {
                    // 🛡️ [SINGLE SOURCE OF TRUTH AUDIT]: Check semanticZones instead of legacy props
                    const label = q.questionNumber;
                    const zoneMap = (q as any).semanticZones;
                    const zonesForThisQ = zoneMap ? zoneMap[label] || zoneMap[String(label)] : null;
                    const zoneOnThisPage = zonesForThisQ?.find((z: any) => z.pageIndex === pageIndex);

                    if (zoneOnThisPage) {
                        const coords = `x:${zoneOnThisPage.x.toFixed(0)}, y:${zoneOnThisPage.startY.toFixed(0)}, w:${zoneOnThisPage.width.toFixed(0)}, h:${(zoneOnThisPage.endY - zoneOnThisPage.startY).toFixed(0)}`;
                        console.log(`   ✅ Q${q.questionNumber}: SEMANTIC ZONE FOUND [${coords}] (P${zoneOnThisPage.pageIndex})`);
                    } else {
                        console.log(`   ❌ Q${q.questionNumber}: NO SEMANTIC ZONE DATA for Page ${pageIndex}`);
                    }
                });
            }
            // =======================================================================

            // Render the image with annotations
            // Note: We need to adapt the existing logic slightly as the user provided a conceptual 'AnnotationService.overlayAnnotations'
            // but the original code used SVGOverlayService directly. I will adapt to use the original logic but IN ORDER.

            const annotationsForThisPage = pageQuestions.flatMap(q => q.annotations || []).filter(a => a.pageIndex === pageIndex);
            // Also need to handle 'annotationsByPage' grouping if we want to be robust, but filtering from results is cleaner.

            // Wait, I should stick closer to the user's provided logic structure BUT use the existing services.
            // The user's code calls `AnnotationService.overlayAnnotations`. That doesn't exist in the import list.
            // I must use `SVGOverlayService.burnSVGOverlayServerSide` which IS imported.

            // Re-implementing the drawing logic using the existing service:

            const imageDimensions = { width: page.width, height: page.height };

            // Calculate scores like before
            const { overallScore, totalPossibleScore, overallScoreText } = calculateOverallScore(markingResults);
            const questionFirstPageScores = calculateQuestionFirstPageScores(markingResults, classificationResult);

            const scoresToDraw = questionFirstPageScores.get(pageIndex);

            // First page logic: Check if this is the very first page in the array
            const isFirstOutputPage = (i === 0);
            const totalScoreToDraw = isFirstOutputPage ? overallScoreText : undefined;

            const mapperCategory = allClassificationResults.find(c => c.pageIndex === pageIndex)?.result?.category;
            const hasMetaPage = mapperCategory === 'metadata' || mapperCategory === 'frontPage';

            // Deduplicate zones (copied from original)
            const uniqueZonesMap = new Map<string, any>();
            console.log(`   🔍 [OUTPUT-SERVICE] Page ${pageIndex}: Processing ${markingResults.length} marking results for zones...`);
            markingResults.forEach(qr => {
                if (qr.semanticZones) {
                    Object.entries(qr.semanticZones).forEach(([label, zones]: [string, any]) => {
                        zones.forEach((z: any) => {
                            if (z.pageIndex === pageIndex) {
                                const key = `${label}_p${pageIndex}`;
                                if (!uniqueZonesMap.has(key)) {
                                    // 🛡️ [RESOLUTION-SYNC]: Scale zones from OCR resolution to burn resolution
                                    const origW = z.origW || page.width || 2480;
                                    const origH = z.origH || page.height || 3508;
                                    const sX = page.width / origW;
                                    const sY = page.height / origH;

                                    const scaledZone = {
                                        ...z,
                                        label,
                                        x: z.x * sX,
                                        width: z.width * sX,
                                        startY: z.startY * sY,
                                        endY: z.endY * sY
                                    };

                                    uniqueZonesMap.set(key, scaledZone);
                                }
                            }
                        });
                    });
                }
            });
            const zonesForThisPage = Array.from(uniqueZonesMap.values());

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
        }));

        // --- 2. Upload Images (Maintain Order) ---
        let annotatedImageLinks: string[] = [];
        if (isAuthenticated) {
            // Upload in parallel, but keep the array index aligned
            annotatedImageLinks = await Promise.all(annotatedImagesBase64.map(async (imageData, i) => {
                const page = standardizedPages[i];
                // Generate a unique safe filename: "doc_p0_timestamp.png"
                // This prevents the "Overwrite Bug" where identical filenames destroyed data
                const safeName = (page.originalFileName || 'image').replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\.[^/.]+$/, "");
                const uniqueName = `${safeName}_p${i}_${Date.now()}.png`;

                try {
                    return await ImageStorageService.uploadImage(
                        imageData,
                        options.userId!,
                        `multi-${submissionId}`,
                        'annotated',
                        uniqueName
                    );
                } catch (e) {
                    console.error(`❌ Upload failed for page ${i}:`, e);
                    return ''; // Fallback to empty string or handle error
                }
            }));
        } else {
            // For guests, return base64
            annotatedImageLinks = annotatedImagesBase64;
        }

        // --- 3. Construct Final Output Array ---
        // 🛑 CRITICAL FIX: DO NOT SORT HERE. 
        // The Pipeline has already done the "God Sort" (DB > AI > Scan).
        // We simply map the results 1:1 to preserve that perfect order.

        const finalAnnotatedOutput = annotatedImageLinks;

        // Map the sorted pages back to the structure expected by the frontend
        const sortedStandardizedPages = standardizedPages.map((p, i) => ({
            ...p,
            // Ensure the frontend knows this is the definitive index
            pageIndex: i,
            annotatedOutput: annotatedImageLinks[i]
        }));

        // --- 4. Re-Align Question Results (Just in case) ---
        // Ensure question results are sorted by Question Number for the JSON data
        const updatedQuestionResults = [...markingResults].sort((a, b) => {
            const numA = parseFloat(String(a.questionNumber).replace(/[^\d.]/g, '')) || 0;
            const numB = parseFloat(String(b.questionNumber).replace(/[^\d.]/g, '')) || 0;
            return numA - numB;
        });

        // --- 5. Calculate Totals (Recalculate for return) ---
        const { overallScore, totalPossibleScore, overallScoreText } = calculateOverallScore(markingResults);

        // ========================= 🔍 [DEBUG: CONTENT VERIFICATION] =========================
        // Map Page Index -> Sub-Content to prove exactly what lives on each page
        const pageToContent = new Map<number, Set<string>>();

        updatedQuestionResults.forEach(r => {
            // Priority 1: Semantic Zones (Detailed Sub-questions)
            if (r.semanticZones && Object.keys(r.semanticZones).length > 0) {
                Object.entries(r.semanticZones).forEach(([subLabel, zones]: [string, any]) => {
                    zones.forEach((z: any) => {
                        if (z.pageIndex !== undefined) {
                            if (!pageToContent.has(z.pageIndex)) pageToContent.set(z.pageIndex, new Set());
                            pageToContent.get(z.pageIndex)?.add(subLabel);
                        }
                    });
                });
            }
            // Priority 2: Fallback to Main Question Number (if no zones detected)
            else {
                const pIdx = r.pageIndex;
                if (!pageToContent.has(pIdx)) pageToContent.set(pIdx, new Set());
                pageToContent.get(pIdx)?.add(String(r.questionNumber));
            }
        });

        console.log('\n✅ [OUTPUT SERVICE] Final Page Order (Verified Content):');
        console.log('---------------------------------------------------------------------------------');
        console.log('| Seq | Index | Original Filename      | Content (Questions)                  |');
        console.log('---------------------------------------------------------------------------------');

        sortedStandardizedPages.forEach((p, i) => {
            // Get questions on this page, naturally sorted
            const contentSet = pageToContent.get(i);
            let content = contentSet ? Array.from(contentSet).sort(getQuestionSortValue).join(', ') : '';

            if (!content || content.length === 0) {
                // If no questions, check if it was metadata
                const classification = allClassificationResults.find(c => c.pageIndex === i); // Look up by new index
                if (classification?.result?.category === 'metadata' || classification?.result?.category === 'frontPage') {
                    content = "METADATA / FRONT PAGE";
                } else {
                    content = "--- (Empty/Ghost) ---";
                }
            }

            const fileName = (p.originalFileName || 'unknown').padEnd(22).slice(0, 22);
            const contentStr = content.padEnd(36);

            console.log(`| [${i}] |  ${String(p.pageIndex).padEnd(3)}  | ${fileName} | ${contentStr} |`);
        });
        console.log('---------------------------------------------------------------------------------\n');

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