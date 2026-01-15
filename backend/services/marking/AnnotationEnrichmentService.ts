/**
 * Annotation Enrichment Service
 * Handles map/enrich logic for annotations (moving them from MarkingExecutor)
 */

import type { Annotation, EnrichedAnnotation, MarkingTask } from '../../types/index.js';
import { getBaseQuestionNumber } from '../../utils/TextNormalizationUtils.js';

export const enrichAnnotationsWithPositions = (
    annotations: Annotation[],
    stepsDataForMapping: any[],
    questionId: string,
    defaultPageIndex: number = 0,
    pageDimensions?: Map<number, { width: number; height: number }>,
    classificationBlocks?: any[],
    task?: MarkingTask,
    visualObservation?: string
): EnrichedAnnotation[] => {
    let lastValidAnnotation: EnrichedAnnotation | null = null;
    const allMarks = (task?.markingScheme as any)?.marks || [];


    const results = annotations.map((anno, idx) => {
        // 🛡️ 1. ANNOTATION INTERCEPTOR: Prevent marks on printed question text (Fail-Safe Layer 3)
        // If the AI stubbornely matches a printed landmark despite our filters, we strip it here.
        let aiLineId = (anno as any).line_id || (anno as any).lineId || (anno as any).line || '';

        const targetOcrBlock = task?.mathBlocks?.find(b =>
            (b as any).globalBlockId === aiLineId || (b as any).id === aiLineId
        );

        if (targetOcrBlock && (targetOcrBlock as any).isHandwritten === false) {
            console.warn(`[🛡️ INTERCEPTOR] 🛑 Intercepted AI match to printed block ${aiLineId}. Stripping to force fallback.`);
            (anno as any).line_id = undefined;
            (anno as any).lineId = undefined;
            (anno as any).ocr_match_status = 'UNMATCHED';
            aiLineId = ''; // Clear local reference for subsequent matching
        }

        // Unified Identifier Standard: Use only lineId
        // aiLineId is already extracted above

        // Helper to normalize IDs
        function normalizeId(id: string) {
            return id.trim().toLowerCase().replace(/^line_/, '');
        }

        // Find the original step
        let originalStep = aiLineId ? stepsDataForMapping.find(s => {
            const stepId = s.line_id || s.lineId || s.unified_line_id || s.globalBlockId || s.id || '';
            // Direct match
            if (s.line_id === aiLineId || s.lineId === aiLineId || s.unified_line_id === aiLineId) return true;

            const isMatch = normalizeId(stepId) === normalizeId(aiLineId);

            // IDENTITY GUARD: If this is a drawing annotation, it should ONLY match a drawing placeholder
            if (isMatch && aiLineId.toLowerCase().includes('drawing')) {
                const isDrawingPlaceholder = (s.text || '').toLowerCase().includes('[drawing]');
                if (!isDrawingPlaceholder) return false;
            }
            return isMatch;
        }) : undefined;

        // determine pageIndex
        let pageIndex = originalStep?.pageIndex ?? defaultPageIndex;
        if ((anno as any)._immutable) {
            pageIndex = ((anno as any)._page?.global ?? (anno as any).pageIndex) as number;
        }

        // Check for AI Visual Position or missing/zeroed bbox
        const rawVisualPos = (anno as any).aiPosition || (anno as any).visual_position;
        let effectiveVisualPos = rawVisualPos;

        // Determine if we have a valid physical anchor
        const hasPhysicalAnchor = originalStep &&
            originalStep.bbox &&
            originalStep.bbox.length === 4 &&
            (originalStep.bbox[0] > 0 || originalStep.bbox[1] > 0 || originalStep.bbox[2] > 0 || originalStep.bbox[3] > 0);

        if (effectiveVisualPos || !hasPhysicalAnchor) {
            const isLazy = !effectiveVisualPos || (
                parseFloat(effectiveVisualPos.x) === 0 &&
                parseFloat(effectiveVisualPos.y) === 0 &&
                parseFloat(effectiveVisualPos.width) === 100 &&
                parseFloat(effectiveVisualPos.height) === 100
            );

            if (isLazy) {
                // Simple Slicing Fallback
                const questions = task?.questionsOnPage?.get(pageIndex) || [];
                const myQNum = getBaseQuestionNumber(String(questionId));
                const myIdx = questions.indexOf(myQNum);
                const count = questions.length || 1;
                const safeIdx = myIdx === -1 ? 0 : myIdx;

                const sliceSize = 100 / count;
                const centerY = (safeIdx * sliceSize) + (sliceSize / 2);

                effectiveVisualPos = {
                    x: "10",
                    y: String(centerY - (sliceSize * 0.4)),
                    width: "80",
                    height: String(sliceSize * 0.8)
                };
            }
        }

        if (!aiLineId && !effectiveVisualPos) {
            return null;
        }

        // FIX START: Extract sub-question target early so it's available for ALL paths (Visual, Unmatched, etc.)
        // FIX START: Infer sub-question from Page Content (Classification Blocks)
        // AI response includes 'subQuestion' (e.g., 'a', '6a', etc.)
        let targetSubQ: string | undefined = (anno as any).subQuestion;
        if (targetSubQ === 'null' || !targetSubQ) {
            targetSubQ = undefined;
        } else {
            // Normalize targetSubQ: strip question number if present (e.g. "6a" -> "a")
            const qNumStr = String(questionId);
            if (targetSubQ.startsWith(qNumStr)) {
                targetSubQ = targetSubQ.substring(qNumStr.length).toLowerCase();
            } else {
                targetSubQ = targetSubQ.toLowerCase();
            }
        }




        // --- SIMPLIFIED DRAWING DETECTION ---
        const drawingKeywordsRegex = /\b(draw|plot|sketch|shade|label|cumulative|frequency|graph|grid)\b/i;
        const isDrawingContext = drawingKeywordsRegex.test(task?.questionText || '') ||
            drawingKeywordsRegex.test(originalStep?.text || '') ||
            drawingKeywordsRegex.test(String(targetSubQ || ''));

        const aiMatchStatus = (anno as any).ocr_match_status;
        const isDrawingAnno = (anno as any).text?.includes('[DRAWING]') ||
            (anno as any).reasoning?.includes('[DRAWING]') ||
            aiLineId.toLowerCase().includes('drawing') ||
            (isDrawingContext && (aiMatchStatus === 'MATCHED' || !effectiveVisualPos));

        if (isDrawingAnno) {
            const calculatedBaseQNum = getBaseQuestionNumber(String(questionId));
            const partKey = targetSubQ ? targetSubQ.toLowerCase() : '';

            // Determine target page(s)
            let targetPages = [defaultPageIndex];
            if (partKey && task?.subQuestionPageMap && task.subQuestionPageMap[partKey] && task.subQuestionPageMap[partKey].length > 0) {
                targetPages = task.subQuestionPageMap[partKey];
            } else if (task?.allowedPageUnion && task.allowedPageUnion.length > 0) {
                targetPages = task.allowedPageUnion;
            }

            // Pick the best page and find the vertical slice
            let bestPage = targetPages[targetPages.length - 1]; // Assume drawing is usually on the later page of a range
            let sliceIndex = 0;
            let sliceCount = 1;

            for (const p of targetPages) {
                const questionsOnThisPage = task?.questionsOnPage?.get(p) || [];
                const fullSubQ = `${calculatedBaseQNum}${targetSubQ || ''}`;
                const idx = questionsOnThisPage.findIndex(q => q.toLowerCase().includes(fullSubQ.toLowerCase()));

                if (idx !== -1) {
                    bestPage = p;
                    sliceIndex = idx;
                    sliceCount = questionsOnThisPage.length;
                    break;
                }
            }

            const pDims = pageDimensions?.get(bestPage) || { width: 1000, height: 1400 };
            const sliceHeight = pDims.height / sliceCount;
            const sliceCenterY = (sliceIndex * sliceHeight) + (sliceHeight / 2);

            // Ensure it's not too high up if it's the first slice
            const visualY = sliceCenterY;
            const pixelBbox: [number, number, number, number] = [pDims.width * 0.1, visualY, pDims.width * 0.8, 100];


            return {
                ...anno,
                bbox: pixelBbox,
                pageIndex: bestPage,
                line_id: `drawing_slice_${bestPage}_${sliceIndex}`,
                ocr_match_status: 'VISUAL',
                subQuestion: targetSubQ || anno.subQuestion,
                isDrawing: true
            };
        }

        // [COORD SNAP] If we matched a classification line, try to snap to a nearby Mathpix block with similar text
        // This fixes the "Shifted Left" issue by using Mathpix pixels instead of Gemini percentages
        if (originalStep && originalStep.ocrSource === 'classification' && originalStep.text) {
            const pageIdx = originalStep.pageIndex ?? defaultPageIndex;
            const normalizedTarget = originalStep.text.trim().toLowerCase().replace(/\s+/g, '');

            // Find a Mathpix block on the same page with very similar text
            // SPATIAL AWARE: Only snap if the Mathpix block is relatively close to the AI's estimate
            // This prevents "teleporting" to the wrong instance of the same text (e.g. "0.4" on a tree diagram)
            const potentialTwins = stepsDataForMapping.filter(step =>
                step.pageIndex === pageIdx &&
                step.ocrSource !== 'classification' &&
                step.ocrSource !== 'estimated' &&
                step.text &&
                (
                    step.text.trim().toLowerCase().replace(/\s+/g, '') === normalizedTarget ||
                    normalizedTarget.includes(step.text.trim().toLowerCase().replace(/\s+/g, ''))
                )
            );

            if (potentialTwins.length > 0 && originalStep.bbox) {
                let bestTwin = null;
                let minDistance = Infinity;
                const [aX, aY] = originalStep.bbox;

                for (const twin of potentialTwins) {
                    if (!twin.bbox) continue;
                    const [tX, tY] = twin.bbox;
                    const distance = Math.sqrt(Math.pow(aX - tX, 2) + Math.pow(aY - tY, 2));

                    if (distance < minDistance) {
                        minDistance = distance;
                        bestTwin = twin;
                    }
                }

                // Distance Threshold: 350px (fairly generous but enough to stop cross-page hopping)
                const DISTANCE_THRESHOLD = 350;

                if (bestTwin && minDistance < DISTANCE_THRESHOLD) {
                    // Log removed
                    // originalStep = bestTwin; // DISABLED: Trust original AI classification position per user request
                    // (anno as any).ocr_match_status = 'MATCHED'; // Keep as UNMATCHED/VISUAL
                } else if (bestTwin) {
                    // Log removed
                }
            }
        }

        // Log removed

        // FIX: Check if we have visible position data even if Unmatched (e.g. Q11 C1/C1)
        // DISCARD LAZY POSITIONS: If AI returned 0/0/100/100 for an UNMATCHED annotation, treat it as missing position.
        // This prevents "completely messed up" boxes covering the whole page when mapping fails.
        // This block was moved to the top of the loop.

        const hasStudentWorkPosition = (anno as any).lineIndex !== undefined || (anno as any).line_index !== undefined || effectiveVisualPos;
        if (originalStep && (anno as any).ocr_match_status === 'UNMATCHED' && !hasStudentWorkPosition) {
            (anno as any).ocr_match_status = 'MATCHED';
        }

        // FIX: If match found but has empty bbox [0,0,0,0], treat as UNMATCHED to trigger robust fallbacks (Fixes Q16)
        // EXCEPTION: If it is a [DRAWING] synthetic placeholder, DO NOT nullify it. 
        // We need the originalStep to preserve the pageIndex for drawing annotations.
        if (originalStep && originalStep.bbox && originalStep.bbox.length === 4 &&
            originalStep.bbox[0] === 0 && originalStep.bbox[1] === 0 && originalStep.bbox[2] === 0 && originalStep.bbox[3] === 0) {

            const isDrawingPlaceholder = (originalStep.text || '').toLowerCase().includes('[drawing]');
            if (!isDrawingPlaceholder) {
                originalStep = undefined;
                (anno as any).ocr_match_status = 'UNMATCHED';
            }
        }



        // If not found, try flexible matching (handle line_1 vs q8_line_1, etc.)
        if (!originalStep && aiLineId) {
            // Extract line number from AI line_id (e.g., "line_2" -> "2", "q8_line_2" -> "2")
            const lineNumMatch = aiLineId.match(/line[_\s]*(\d+)/i);
            if (lineNumMatch && lineNumMatch[1]) {
                const lineNum = parseInt(lineNumMatch[1], 10);
                // Match by line index (1-based)
                if (lineNum > 0 && lineNum <= stepsDataForMapping.length) {
                    originalStep = stepsDataForMapping[lineNum - 1];
                }
            }

            // If still not found, check if AI is using OCR block ID format (block_X_Y)
            if (!originalStep) {
                // 1. Try to find the step in marking scheme marks using lineId (if persisted)
                const foundMark = (allMarks || []).find((m: any) =>
                    m.mark?.trim() === aiLineId || m.lineId?.trim() === aiLineId
                );

                if (foundMark) {
                    // If we found a mark with this ID, but no OCR block directly, 
                    // we can't do much for positioning here, but we acknowledge it.
                } else if (aiLineId.startsWith('block_')) {
                    originalStep = stepsDataForMapping.find(step =>
                        step.globalBlockId?.trim() === aiLineId
                    );
                }
            }
        }

        // FIX (Smart Validation): Prevent snapping to Header/Footer boilerplate
        // Even if AI explicitly matched this block, we reject it if it contains known header text.
        // This forces fallback to student work line (which is what we want).
        if (originalStep && originalStep.text) {
            const lowerText = originalStep.text.toLowerCase();
            const forbiddenPhrases = [
                'answer all questions',
                'total for question',
                'write your answers in the spaces provided',
                'lines in your working',
                'do not write in this area',
                'indicate which question you are answering'
            ];

            const isForbidden = forbiddenPhrases.some(phrase => lowerText.includes(phrase));

            if (isForbidden) {
                const RED = '\x1b[31m';
                const BOLD = '\x1b[1m';
                const RESET = '\x1b[0m';
                console.log(`${BOLD}${RED}[ERROR: BLOCKING PRINTED TEXT] Q${questionId}: Match refused for printed instruction: "${originalStep.text.substring(0, 50)}..."${RESET}`);
                originalStep = undefined;
                (anno as any).ocr_match_status = 'UNMATCHED';
            }
        }

        // Log removed


        // Special handling for [DRAWING] annotations
        // Since we now create separate synthetic blocks for each drawing, match by text content
        // AI might return line_id like "DRAWING_Triangle B..." instead of line_id
        if (!originalStep) {
            const annotationText = ((anno as any).textMatch || (anno as any).text || '').toLowerCase();
            const isDrawingAnnotation = annotationText.includes('[drawing]') || (aiLineId && aiLineId.toLowerCase().includes('drawing'));

            if (isDrawingAnnotation) {
                // First, try to match by line_id if it contains a line number
                const lineNumMatch = aiLineId ? aiLineId.match(/line[_\s]*(\d+)/i) : null;
                if (lineNumMatch && lineNumMatch[1]) {
                    const lineNum = parseInt(lineNumMatch[1], 10);
                    if (lineNum > 0 && lineNum <= stepsDataForMapping.length) {
                        const candidateStep = stepsDataForMapping[lineNum - 1];
                        if (candidateStep && (candidateStep.text || candidateStep.cleanedText || '').toLowerCase().includes('[drawing]')) {
                            originalStep = candidateStep;
                        }
                    }
                }

                // If line number matching failed, try text-based matching
                if (!originalStep) {
                    // Find synthetic block that matches this specific drawing
                    // Each synthetic block now contains only one drawing entry, so matching is simpler
                    originalStep = stepsDataForMapping.find(step => {
                        const stepText = (step.text || step.cleanedText || '').toLowerCase();
                        if (!stepText.includes('[drawing]')) return false;

                        // Extract key identifiers from both texts for matching (reuse existing logic)
                        const extractKeyWords = (text: string): string[] => {
                            // Extract meaningful words (skip common words like "drawn", "at", "vertices", etc.)
                            return text
                                .replace(/\[drawing\]/gi, '')
                                .replace(/\[position:.*?\]/gi, '')
                                .split(/[^a-z0-9]+/i)
                                .filter(word => word.length > 2 && !['the', 'and', 'at', 'drawn', 'vertices', 'position', 'point'].includes(word.toLowerCase()))
                                .map(word => word.toLowerCase());
                        };

                        const annotationWords = extractKeyWords(annotationText);
                        const stepWords = extractKeyWords(stepText);

                        // Check if annotation words appear in step text (at least 2 words match for confidence)
                        const matchingWords = annotationWords.filter(word => stepWords.includes(word));
                        return matchingWords.length >= 2 || (matchingWords.length > 0 && matchingWords.length === annotationWords.length);
                    });
                }
            }
        }
        // FIX: Extract lineIndex safely (ensure 0-based)
        let safeLineIndex = ((anno as any).lineIndex || (anno as any).line_index || 1) - 1;

        // RULE: For Standard Text Annotations (M1, A1, etc.), we IGNORE the AI's "visual_position" guess.
        // It is often hallucinated. We rely on the GROUND TRUTH Classification Position via line_index.
        const isTrulyVisualAnnotation = (anno as any).ocr_match_status === 'VISUAL' ||
            (anno as any).isDrawing === true ||
            (anno as any).line_id?.toString().toLowerCase().includes('drawing');

        if (!isTrulyVisualAnnotation) {
            // Force visual pos to undefined to trigger rigid Classification Fallback
            effectiveVisualPos = undefined;
        }
        // UNMATCHED: No OCR blocks available - extract position from classification
        if ((anno as any).ocr_match_status === 'UNMATCHED') {
            let lineIndex = ((anno as any).lineIndex || 1) - 1; // Use camelCase from toLegacyFormat


            let targetSubStartIndex = -1;
            let targetSubEndIndex = -1;


            // Find the position using line_index
            let classificationPosition: any = null;
            if (task?.classificationBlocks) {
                // Flatten all studentWorkLines from all blocks and sub-questions into a single global array
                // This matches the AI prompt format which numbers lines globally: [1], [2], [3]...
                const allLines: Array<{ text: string; position: any; pageIndex: number }> = [];

                task.classificationBlocks.forEach(block => {
                    // Add top-level studentWorkLines
                    if (block.studentWorkLines && block.studentWorkLines.length > 0) {
                        block.studentWorkLines.forEach(line => {
                            allLines.push({
                                text: line.text,
                                position: line.position,
                                pageIndex: block.pageIndex !== undefined ? block.pageIndex : defaultPageIndex
                            });
                        });
                    }

                    // Add studentWorkLines from all sub-questions
                    if (block.subQuestions) {
                        block.subQuestions.forEach(subQ => {
                            // Capture start index for this sub-question
                            if (targetSubQ && subQ.part === targetSubQ && targetSubStartIndex === -1) {
                                targetSubStartIndex = allLines.length;
                            }

                            if (subQ.studentWorkLines && subQ.studentWorkLines.length > 0) {
                                subQ.studentWorkLines.forEach(line => {
                                    allLines.push({
                                        text: line.text,
                                        position: line.position,
                                        pageIndex: block.pageIndex !== undefined ? block.pageIndex : defaultPageIndex
                                    });
                                });
                            }

                            // Capture end index
                            if (targetSubQ && subQ.part === targetSubQ) {
                                targetSubEndIndex = allLines.length - 1;
                            }
                        });
                    }
                });

                // FIX: If we found a target sub-question range, force the lineIndex into it
                if (targetSubStartIndex !== -1) {
                    // If defaulting to 0, move to the end of the sub-question (usually the answer line)
                    if (lineIndex <= 0) {
                        lineIndex = Math.max(targetSubStartIndex, targetSubEndIndex);
                    } else {
                        // If it's valid relative index, should we treat it as relative to sub-question?
                        // AI often returns 0-based. Let's assume absolute first. 
                        // If absolute is outside range, move it inside.
                        if (lineIndex < targetSubStartIndex || lineIndex > targetSubEndIndex) {
                            lineIndex = Math.max(targetSubStartIndex, targetSubEndIndex);
                        }
                    }
                }

                // Now use global lineIndex to find the correct line
                if (lineIndex >= 0 && lineIndex < allLines.length) {
                    const line = allLines[lineIndex];

                    if (line.position) {
                        classificationPosition = {
                            ...line.position,
                            pageIndex: line.pageIndex
                        };

                        // Log removed
                    }
                } else if (String(questionId).startsWith('6')) {
                    console.log(`[DEBUG LOCK Q${questionId}]   ↳ UNMATCHED fallback: Line index ${lineIndex + 1} out of range (Total lines: ${allLines.length})`);
                }
            }

            // If we found a classification position, use it BUT SHRINK-WRAP IT
            if (classificationPosition) {
                const pageIdx = classificationPosition.pageIndex;
                const pageDims = pageDimensions?.get(pageIdx);

                let finalX = classificationPosition.x;
                let finalY = classificationPosition.y;
                let finalW = classificationPosition.width || 100;
                let finalH = classificationPosition.height || 20;

                // 1. Convert Classification Percentages to Pixels (Search Zone)
                let pixelY = finalY;
                let pixelH = finalH;

                if (pageDims) {
                    finalX = (finalX / 100) * pageDims.width;
                    finalY = (finalY / 100) * pageDims.height;
                    finalW = (finalW / 100) * pageDims.width;
                    finalH = (finalH / 100) * pageDims.height;

                    pixelY = finalY;
                    pixelH = finalH;
                }

                // ==================================================================================
                // 🔥 NEW: INK DENSITY SCAN (HYBRID SHRINK-WRAP)
                // Use the Classification Y-Zone to find ACTUAL ink blocks and calculate real width
                // ==================================================================================

                // Identify source blocks: Prefer task.mathBlocks (likely contains everything), fallback to stepsDataForMapping
                const sourceBlocks = (task?.mathBlocks && task.mathBlocks.length > 0)
                    ? task.mathBlocks
                    : stepsDataForMapping;

                if (sourceBlocks && sourceBlocks.length > 0) {
                    // Filter blocks that:
                    // 1. Are on the same page
                    // 2. Are HANDWRITTEN (Ignore printed questions!)
                    // 3. Intersect the Classification Y-Zone vertically

                    const intersectingBlocks = sourceBlocks.filter(b => {
                        const bPage = (b as any).pageIndex !== undefined ? (b as any).pageIndex : defaultPageIndex;
                        if (bPage !== pageIdx) return false;

                        // Handwritten Check (Critical for ignoring Question Text)
                        // If isHandwritten is explicitly false, skip it. If undefined, assume true/unknown (safe to include).
                        if ((b as any).isHandwritten === false) return false;

                        // Vertical Intersection Check
                        const bbox = (b as any).bbox; // [x, y, w, h]
                        if (!bbox || bbox.length < 4) return false;

                        const bTop = bbox[1];
                        const bBottom = bbox[1] + bbox[3];
                        const searchTop = pixelY - 10; // 10px buffer
                        const searchBottom = pixelY + pixelH + 10;

                        // Check if block overlaps the search zone
                        return (bBottom > searchTop && bTop < searchBottom);
                    });

                    // If we found intersecting ink, calculate the UNION BBOX
                    if (intersectingBlocks.length > 0) {
                        let minX = Infinity;
                        let minY = Infinity;
                        let maxRight = -Infinity;
                        let maxBottom = -Infinity;

                        intersectingBlocks.forEach(b => {
                            const [bx, by, bw, bh] = (b as any).bbox;
                            if (bx < minX) minX = bx;
                            if (by < minY) minY = by;
                            if (bx + bw > maxRight) maxRight = bx + bw;
                            if (by + bh > maxBottom) maxBottom = by + bh;
                        });

                        // 🎯 REPLACEMENT: Use the SHRINK-WRAPPED dimensions!
                        // This ignores the wide Classification Box and uses the tight Ink Box.
                        finalX = minX;
                        finalY = minY; // Optionally adjust Y too, but X/Width is the main goal
                        finalW = maxRight - minX;
                        finalH = maxBottom - minY;

                        // Console Log for Debugging
                        console.log(`[SHRINK-WRAP] Q${questionId}: Replaced AI Width (${Math.round((classificationPosition.width / 100) * pageDims?.width || 0)}px) with Ink Width (${Math.round(finalW)}px) from ${intersectingBlocks.length} blocks.`);
                    }
                }

                // Safety: Ensure minimum visibility
                if (finalW < 10 || finalH < 10) {
                    if (finalW < 50) finalW = 50;
                    if (finalH < 30) finalH = 30;
                }

                return {
                    ...anno,
                    bbox: [finalX, finalY, finalW, finalH] as [number, number, number, number],
                    pageIndex: pageIdx,
                    line_id: (anno as any).line_id || `unmatched_${idx}`,
                    ocr_match_status: 'UNMATCHED',
                    subQuestion: targetSubQ || anno.subQuestion,
                    aiPosition: undefined,
                    visual_position: undefined,
                    visualPosition: undefined
                };
            }

            // FIX: Check if we have visible position data even if Unmatched (e.g. Q11 C1/C1)
            const visualPosForUnmatched = effectiveVisualPos;

            // Get dimensions for the relevant page
            const targetPageIndex = (visualPosForUnmatched?.pageIndex !== undefined)
                ? visualPosForUnmatched.pageIndex
                : defaultPageIndex;

            const pageDims = pageDimensions?.get(targetPageIndex);

            if (effectiveVisualPos && pageDims) {
                // Convert percentages to pixels
                const pWidth = pageDims.width;
                const pHeight = pageDims.height;
                let x = (parseFloat(effectiveVisualPos.x) / 100) * pWidth;
                let y = (parseFloat(effectiveVisualPos.y) / 100) * pHeight;
                let w = (parseFloat(effectiveVisualPos.width) / 100) * pWidth;
                let h = (parseFloat(effectiveVisualPos.height) / 100) * pHeight;

                // FIX: Ensure minimum visibility for fallback boxes (Q6 fix)
                // If box is microscopic (e.g. < 10px), scale it up to at least 50x30
                if (w < 10 || h < 10) {
                    if (w < 50) w = 50;
                    if (h < 30) h = 30;
                }

                // Log removed

                const lineIndex = (anno as any).lineIndex !== undefined ? (anno as any).lineIndex : (anno as any).line_index;
                const classificationLine = (task?.classificationBlocks || []).flatMap(b => b.subQuestions.flatMap(sq => sq.studentWorkLines || []))[lineIndex];

                // Log removed
                // Determine page index for UNMATCHED fallback
                // Priority: 1. Line's own pageIndex, 2. task.sourcePages[0], 3. defaultPageIndex
                const fallbackPageIndex = classificationLine?.pageIndex !== undefined ? classificationLine.pageIndex : (task?.sourcePages?.[0] ?? defaultPageIndex);

                return {
                    ...anno,
                    bbox: [x, y, w, h] as [number, number, number, number],
                    pageIndex: fallbackPageIndex,
                    line_id: (anno as any).line_id || `unmatched_${idx}`,
                    ocr_match_status: 'UNMATCHED',
                    hasLineData: false,
                    subQuestion: targetSubQ || anno.subQuestion
                };
            }

            // Fallback: Classification Block Anchoring (Prioritize Student Work Area)
            // If we know the sub-question identity (targetSubQ), find the corresponding Classification Block.
            // This block represents the "Student Work" area identified by the AI.
            // Anchoring here ensures we place the mark in the student work zone, not on the Question Text.
            if (targetSubQ && task?.classificationBlocks) {
                const matchingBlock = task.classificationBlocks.find(b =>
                    b.subQuestions && b.subQuestions.some((sq: any) => sq.part === targetSubQ)
                );

                if (matchingBlock && matchingBlock.studentWorkLines && matchingBlock.studentWorkLines.length > 0) {
                    // Use the first line of the student work block as the anchor
                    const firstLine = matchingBlock.studentWorkLines[0];
                    if (firstLine && firstLine.position) {
                        const pageIdx = firstLine.pageIndex ?? defaultPageIndex;
                        const dim = pageDimensions?.get(pageIdx);

                        let finalBbox: [number, number, number, number] = [
                            firstLine.position.x,
                            firstLine.position.y,
                            firstLine.position.width || 100,
                            firstLine.position.height || 20
                        ];

                        if (dim) {
                            // Convert percentages to pixels if position is small (percentage-based)
                            if (finalBbox[0] < 100) {
                                finalBbox = [
                                    (finalBbox[0] / 100) * dim.width,
                                    (finalBbox[1] / 100) * dim.height,
                                    (finalBbox[2] / 100) * dim.width,
                                    (finalBbox[3] / 100) * dim.height
                                ];
                            }
                        }

                        if (String(questionId).startsWith('6') || String(questionId).startsWith('2')) {
                            console.log(`[MARKING EXECUTOR] 🎯 CLASSIFICATION FALLBACK for Q${questionId} "${aiLineId}" -> Anchored to Student Work Area (SubQ: ${targetSubQ})`);
                        }

                        return {
                            ...anno,
                            bbox: finalBbox,
                            pageIndex: pageIdx,
                            line_id: (anno as any).line_id || `unmatched_${idx}`,
                            ocr_match_status: 'UNMATCHED',
                            hasLineData: false,
                            subQuestion: targetSubQ || anno.subQuestion
                        };
                    }
                }
            }

            // Fallback: staggered positioning if no classification position found
            // STRATEGY: Find the "Question X" header block and place the annotation BELOW it.
            // This is safer than guessing "student work" blocks which might be confused with question text.

            const questionHeaderBlock = stepsDataForMapping.find(s =>
                s.text.includes('Question ' + questionId)
            );

            if (questionHeaderBlock && questionHeaderBlock.bbox) {
                const headerBbox = questionHeaderBlock.bbox;
                // Place it 30px below the header, with a standard height
                const newY = headerBbox[1] + headerBbox[3] + 30;
                const newBbox = [headerBbox[0], newY, 200, 50];

                return {
                    ...anno,
                    bbox: newBbox as [number, number, number, number],
                    pageIndex: questionHeaderBlock.pageIndex ?? defaultPageIndex,
                    line_id: questionHeaderBlock.line_id || `unmatched_${idx}`,
                    ocr_match_status: 'UNMATCHED',
                    hasLineData: false,
                    subQuestion: targetSubQ || anno.subQuestion // FIX: Ensure subQuestion is propagated
                };
            }

            // Legacy "Largest Block" fallback removed as per user request.
            // It was causing marks to snap to Question Text blocks inappropriately.

            // Final Fallback: Robust Slice Center (Q15 Fix)
            // This is triggered if AI-matching and student work estimation both fail.
            const questionsOnPage = task?.questionsOnPage?.get(defaultPageIndex) || [];
            const baseQNum = getBaseQuestionNumber(String(questionId));
            const myIdx = questionsOnPage.indexOf(baseQNum);
            const count = questionsOnPage.length || 1;
            const safeIdxInSlice = myIdx === -1 ? 0 : myIdx;

            // Stagger within slice based on index
            const sliceSizePercent = 100 / count;
            const centerYPercent = (safeIdxInSlice * sliceSizePercent) + (sliceSizePercent / 2);
            const staggeredYPercent = centerYPercent + (idx % 3) * 2;

            const fallbackPageDims = pageDimensions?.get(defaultPageIndex) || { width: 1000, height: 1400 };
            const sliceCenterPixelY = (staggeredYPercent / 100) * fallbackPageDims.height;

            console.log(`[FALLBACK] Q${questionId} -> Unmatched, using slice ${safeIdxInSlice + 1}/${count} on Page ${defaultPageIndex}`);

            return {
                ...anno,
                bbox: [fallbackPageDims.width * 0.1, sliceCenterPixelY, fallbackPageDims.width * 0.2, 40] as [number, number, number, number],
                pageIndex: defaultPageIndex,
                line_id: `unmatched_${idx}`,
                ocr_match_status: 'UNMATCHED',
                hasLineData: false,
                subQuestion: targetSubQ || anno.subQuestion
            };


            // Log removed

            // Final fallback if absolutely no blocks found (rare)
            const RED = '\x1b[31m';
            const BOLD = '\x1b[1m';
            const RESET = '\x1b[0m';
            console.log(`${BOLD}${RED}[ERROR: COORDINATE FAILURE] Q${questionId}: No coordinates found for "${anno.text}". Annotation will not appear.${RESET}`);
            return null;
        }

        // Fallback logic for missing line ID (e.g., Q3b "No effect")
        // If we can't find the step, use the previous valid annotation's location
        // This keeps sub-questions together instead of dropping them or defaulting to Page 1
        if (!originalStep) {
            // NEW: Check if we have AI position to construct a synthetic bbox
            if (effectiveVisualPos) {
                // Construct bbox from aiPos (x, y, w, h are percentages)
                // We need to convert to whatever unit bbox uses (likely pixels or normalized 0-1?)
                // stepsDataForMapping.bbox seems to be [x, y, w, h] in pixels?
                // Actually, aiPos is already normalized to 0-100 or 0-1000 by MarkingInstructionService
                // But we don't know the image dimensions here easily unless we look at task.imageData
                // However, svgOverlayService handles aiPosition separately!
                // So we just need to pass a DUMMY valid bbox so it doesn't get filtered out.
                // And ensure pageIndex is valid.

                // FIX: Use defaultPageIndex if lastValidAnnotation is not available
                // This ensures we default to the question's known page (e.g. 13) instead of 0
                let pageIndex = lastValidAnnotation ? lastValidAnnotation.pageIndex : defaultPageIndex;

                // FIX: If AI provided a pageIndex (relative), use it!
                // CHECK: If annotation comes from immutable pipeline, pageIndex is ALREADY global
                if ((anno as any)._immutable) {
                    pageIndex = (anno as any).pageIndex;
                }

                // Try to map synthetic ID (e.g. line_5c_drawing) to a real line ID (e.g. line_5c)
                // This helps frontend group annotations correctly by sub-question
                let finalLineId = (anno as any).line_id || `synthetic_${idx}`;

                if (finalLineId.includes('_drawing')) {
                    // Extract potential sub-question part (e.g. "5c" from "line_5c_drawing")
                    const subQMatch = finalLineId.match(/line_(\d+[a-z])/i);
                    if (subQMatch && subQMatch[1]) {
                        const subQ = subQMatch[1]; // e.g. "5c"
                        // Find a real step that matches this sub-question
                        const realStep = stepsDataForMapping.find(s =>
                            s.line_id && s.line_id.includes(subQ)
                        );
                        if (realStep) {
                            finalLineId = realStep.line_id;

                            // FIX: If the real step is NOT a drawing question (e.g. "Use your graph to find..."),
                            // we should place the annotation near the text, NOT on the graph.
                            // This prevents Q5c marks from appearing on Q5b graph.
                            const stepText = (realStep.text || '').toLowerCase();
                            const isDrawingQuestion = stepText.includes('draw') || stepText.includes('sketch') || stepText.includes('plot') || stepText.includes('grid');

                            if (!isDrawingQuestion) {
                                // Use the real step's bbox and REMOVE aiPosition so it renders as a text annotation
                                return {
                                    ...anno,
                                    bbox: realStep.bbox as [number, number, number, number],
                                    pageIndex: (anno as any)._immutable ? pageIndex : (realStep.pageIndex ?? pageIndex),
                                    line_id: finalLineId,
                                    aiPosition: undefined // Clear aiPosition to force text-based rendering
                                };
                            }
                        }
                    }
                }

                // Calculate real pixel bbox from percentages if page dimensions are available
                let pixelBbox: [number, number, number, number] = [1, 1, 1, 1];
                const pageDims = pageDimensions?.get(pageIndex);
                if (pageDims) {
                    let x = (parseFloat(effectiveVisualPos.x) / 100) * pageDims.width;
                    let y = (parseFloat(effectiveVisualPos.y) / 100) * pageDims.height;
                    const w = (parseFloat(effectiveVisualPos.width || "50") / 100) * pageDims.width;
                    const h = (parseFloat(effectiveVisualPos.height || "30") / 100) * pageDims.height;

                    // ZONE CLAMPING REMOVED AS REQUESTED (Fancy snapping disabled)

                    pixelBbox = [x, y, w, h];
                }

                // NEW: Detect if this is a drawing annotation for color-coding in SVGOverlayService
                const isDrawing = (anno as any).line_id && (anno as any).line_id.toString().toLowerCase().includes('drawing');

                const enriched = {
                    ...anno,
                    bbox: pixelBbox,
                    pageIndex: (pageIndex !== undefined && pageIndex !== null) ? pageIndex : defaultPageIndex,
                    line_id: finalLineId,
                    visualPosition: effectiveVisualPos, // For DRAWING annotations only
                    subQuestion: targetSubQ || anno.subQuestion, // FIX: Ensure subQuestion is propagated
                    isDrawing: isDrawing // Flag for yellow border
                };
                // Debug log removed
                lastValidAnnotation = enriched; // Update last valid annotation
                return enriched;
            }

            // Check if we have a previous valid annotation to inherit from
            if (lastValidAnnotation) {
                const enriched = {
                    ...anno,
                    bbox: lastValidAnnotation.bbox,
                    pageIndex: lastValidAnnotation.pageIndex,
                    line_id: lastValidAnnotation.line_id
                };
                return enriched;
            }

            // FALLBACK: If unmatched, use standard geometric slicing
            const calculatedBaseQNum = getBaseQuestionNumber(String(questionId));
            const partKey = targetSubQ ? targetSubQ.toLowerCase() : '';

            let targetPages = [defaultPageIndex];
            if (partKey && task?.subQuestionPageMap && task.subQuestionPageMap[partKey] && task.subQuestionPageMap[partKey].length > 0) {
                targetPages = task.subQuestionPageMap[partKey];
            } else if (task?.allowedPageUnion && task.allowedPageUnion.length > 0) {
                targetPages = task.allowedPageUnion;
            }

            let bestPage = targetPages[0];
            let sliceIndex = 0;
            let sliceCount = 1;

            for (const p of targetPages) {
                const questionsOnThisPage = task?.questionsOnPage?.get(p) || [];
                const fullSubQ = `${calculatedBaseQNum}${targetSubQ || ''}`;
                const idx = questionsOnThisPage.findIndex(q => q.toLowerCase().includes(fullSubQ.toLowerCase()));

                if (idx !== -1) {
                    bestPage = p;
                    sliceIndex = idx;
                    sliceCount = questionsOnThisPage.length;
                    break;
                }
            }

            const pDims = pageDimensions?.get(bestPage) || { width: 1000, height: 1400 };
            const sliceHeight = pDims.height / sliceCount;
            const sliceCenterY = (sliceIndex * sliceHeight) + (sliceHeight / 2);

            const pixelBbox: [number, number, number, number] = [pDims.width * 0.1, sliceCenterY, pDims.width * 0.8, 40];

            return {
                ...anno,
                bbox: pixelBbox,
                pageIndex: bestPage,
                line_id: `unmatched_slice_${bestPage}_${sliceIndex}`,
                ocr_match_status: 'UNMATCHED',
                subQuestion: targetSubQ || anno.subQuestion
            };
        } else {
            // ----------------------------------------------------
            // MATCHED CASE (We found an OCR block "originalStep")
            // ----------------------------------------------------

            // For VISUAL annotations (drawings), ALWAYS use aiPosition, NOT OCR bbox
            // OCR bbox would point to question text, but visual_position points to drawing location
            const isVisualAnnotation = (anno as any).ocr_match_status === 'VISUAL';

            // Default processing for Matched or Visual items
            const isDrawing = (anno as any).line_id && (anno as any).line_id.toString().toLowerCase().includes('drawing');
            let pixelBbox: [number, number, number, number] = originalStep?.bbox ? [...originalStep.bbox] as [number, number, number, number] : [0, 0, 0, 0];

            // Prefer visual pos for drawings or if OCR missing (Matched but no Bbox)
            // CRITICAL FIX: If we have an AI Position but no OCR Bbox (e.g. Q6 "0.4" text), USE IT!
            if (effectiveVisualPos && (isDrawing || !originalStep?.bbox)) {
                const pIdx = (effectiveVisualPos.pageIndex !== undefined) ? effectiveVisualPos.pageIndex : pageIndex;
                const pageDims = pageDimensions?.get(pIdx);
                const effectiveWidth = pageDims?.width || 2000;
                const effectiveHeight = pageDims?.height || 3000;

                // DEFENSIVE: Treat as percentage if values are small, pixels if large
                const xVal = parseFloat(effectiveVisualPos.x);
                const isPercentage = xVal < 150;

                if (isPercentage) {
                    pixelBbox = [
                        (xVal / 100) * effectiveWidth,
                        (parseFloat(effectiveVisualPos.y) / 100) * effectiveHeight,
                        (parseFloat(effectiveVisualPos.width || "50") / 100) * effectiveWidth,
                        (parseFloat(effectiveVisualPos.height || "30") / 100) * effectiveHeight
                    ];
                } else {
                    // Already looks like pixels
                    pixelBbox = [
                        xVal,
                        parseFloat(effectiveVisualPos.y),
                        parseFloat(effectiveVisualPos.width || "100"),
                        parseFloat(effectiveVisualPos.height || "60")
                    ];
                }
            } else if (originalStep?.bbox) {
                // Default: Use Mathpix OCR BBox
                pixelBbox = originalStep.bbox;

                // [WIDTH ACCURACY FIX]
                // Compare Mathpix Width vs. Classification (AI) Width
                // If Mathpix is excessively wide (often due to capturing full line width instead of just the math formula),
                // we clamp it to the Classification estimate which requested "TIGHT BOUNDING BOXES".

                try {
                    if (task?.classificationBlocks && pixelBbox && pixelBbox[2] > 0) {
                        // 1. Find corresponding Classification Line
                        // We reuse the flattening logic to map lineIndex to the specific Classification Line
                        const lineIndex = ((anno as any).lineIndex || (anno as any).line_index || 1) - 1;

                        // Flatten all lines to find the standard index match
                        // (This matches how we prompt the AI: "Line 1, Line 2...")
                        const allLines: Array<{ text: string; position: any; pageIndex: number }> = [];
                        task.classificationBlocks.forEach(block => {
                            if (block.studentWorkLines) block.studentWorkLines.forEach((l: any) =>
                                allLines.push({ text: l.text, position: l.position, pageIndex: block.pageIndex ?? defaultPageIndex })
                            );
                            if (block.subQuestions) block.subQuestions.forEach((sq: any) => {
                                if (sq.studentWorkLines) sq.studentWorkLines.forEach((l: any) =>
                                    allLines.push({ text: l.text, position: l.position, pageIndex: block.pageIndex ?? defaultPageIndex })
                                );
                            });
                        });

                        const clsLine = allLines[lineIndex];

                        if (clsLine && clsLine.position) {
                            const pDims = pageDimensions?.get(clsLine.pageIndex || pageIndex);
                            if (pDims) {
                                // Convert Classification Width (%) to Pixels
                                const clsWidthPx = (parseFloat(clsLine.position.width) / 100) * pDims.width;
                                const ocrWidthPx = pixelBbox[2];

                                // Thresholds: 
                                // 1. Mathpix is at least 50% wider than Classification
                                // 2. Mathpix is wider than 300px (avoids clamping small items)
                                if (ocrWidthPx > (clsWidthPx * 1.5) && ocrWidthPx > 300) {
                                    const oldWidth = pixelBbox[2];

                                    // Clamp Width
                                    const newWidth = Math.max(clsWidthPx, 50); // Ensure min width

                                    // Re-center logic:
                                    // original center = x + w/2
                                    // new x = center - newW/2
                                    const centerX = pixelBbox[0] + (ocrWidthPx / 2);
                                    const newX = centerX - (newWidth / 2);

                                    pixelBbox = [newX, pixelBbox[1], newWidth, pixelBbox[3]];

                                    console.log(`[WIDTH FIX] Q${questionId} Line ${lineIndex + 1}: Clamped OCR Width ${Math.round(oldWidth)}px -> ${Math.round(newWidth)}px (Ref: AI Width ${Math.round(clsWidthPx)}px)`);
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.warn(`[WIDTH FIX ERROR] Failed to clamp width for Q${questionId}:`, err);
                }
            }

            const enriched: EnrichedAnnotation = {
                action: anno.action,
                text: anno.text,
                reasoning: anno.reasoning,
                ocr_match_status: ((anno as any).ocr_match_status === 'UNMATCHED') ? 'UNMATCHED' as any : (anno.ocr_match_status || 'MATCHED'),
                studentText: (anno as any).studentText || originalStep?.text || anno.text,
                subQuestion: targetSubQ || anno.subQuestion,
                line_id: (anno as any).line_id,
                bbox: pixelBbox,
                pageIndex: pageIndex,
                aiPosition: rawVisualPos, // Keep raw visual position for reference
                hasLineData: !!originalStep?.lines, // Set hasLineData flag
                isDrawing: isDrawing, // Pass drawing flag for specialized rendering
                visualObservation: visualObservation // Pass broad visual observation
            };

            lastValidAnnotation = enriched; // Update last valid annotation
            return enriched;
        }
    }).filter((a): a is EnrichedAnnotation => a !== null); // Remove nulls from filtering

    return results;
};
