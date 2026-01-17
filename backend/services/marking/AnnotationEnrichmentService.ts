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
        let aiLineId = (anno as any).line_id || (anno as any).lineId || (anno as any).line || '';

        const targetOcrBlock = task?.mathBlocks?.find(b =>
            (b as any).globalBlockId === aiLineId || (b as any).id === aiLineId
        );

        if (targetOcrBlock && (targetOcrBlock as any).isHandwritten === false) {
            console.log(`[⚠️ MIXED CONTENT] AI matched a Printed Block (${aiLineId}). Allowing it as per Show Everything strategy.`);
            // Do NOT strip the ID. Keep it MATCHED.
        }

        function normalizeId(id: string) {
            return id.trim().toLowerCase().replace(/^line_/, '');
        }

        // Find the original step
        let originalStep = aiLineId ? stepsDataForMapping.find(s => {
            const stepId = s.line_id || s.lineId || s.unified_line_id || s.globalBlockId || s.id || '';
            if (s.line_id === aiLineId || s.lineId === aiLineId || s.unified_line_id === aiLineId) return true;
            const isMatch = normalizeId(stepId) === normalizeId(aiLineId);
            if (isMatch && aiLineId.toLowerCase().includes('drawing')) {
                const isDrawingPlaceholder = (s.text || '').toLowerCase().includes('[drawing]');
                if (!isDrawingPlaceholder) return false;
            }
            return isMatch;
        }) : undefined;

        let pageIndex = originalStep?.pageIndex ?? defaultPageIndex;
        if ((anno as any)._immutable) {
            pageIndex = ((anno as any)._page?.global ?? (anno as any).pageIndex) as number;
        }

        const rawVisualPos = (anno as any).aiPosition || (anno as any).visual_position;
        let effectiveVisualPos = rawVisualPos;

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

        let targetSubQ: string | undefined = (anno as any).subQuestion;
        if (targetSubQ === 'null' || !targetSubQ) {
            targetSubQ = undefined;
        } else {
            const qNumStr = String(questionId);
            if (targetSubQ.startsWith(qNumStr)) {
                targetSubQ = targetSubQ.substring(qNumStr.length).toLowerCase();
            } else {
                targetSubQ = targetSubQ.toLowerCase();
            }
        }

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
            let targetPages = [defaultPageIndex];
            if (partKey && task?.subQuestionPageMap && task.subQuestionPageMap[partKey] && task.subQuestionPageMap[partKey].length > 0) {
                targetPages = task.subQuestionPageMap[partKey];
            } else if (task?.allowedPageUnion && task.allowedPageUnion.length > 0) {
                targetPages = task.allowedPageUnion;
            }
            let bestPage = targetPages[targetPages.length - 1];
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

        if (originalStep && originalStep.ocrSource === 'classification' && originalStep.text) {
            const pageIdx = originalStep.pageIndex ?? defaultPageIndex;
            const normalizedTarget = originalStep.text.trim().toLowerCase().replace(/\s+/g, '');
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
            }
        }

        const hasStudentWorkPosition = (anno as any).lineIndex !== undefined || (anno as any).line_index !== undefined || effectiveVisualPos;
        if (originalStep && (anno as any).ocr_match_status === 'UNMATCHED' && !hasStudentWorkPosition) {
            (anno as any).ocr_match_status = 'MATCHED';
        }

        if (originalStep && originalStep.bbox && originalStep.bbox.length === 4 &&
            originalStep.bbox[0] === 0 && originalStep.bbox[1] === 0 && originalStep.bbox[2] === 0 && originalStep.bbox[3] === 0) {
            const isDrawingPlaceholder = (originalStep.text || '').toLowerCase().includes('[drawing]');
            if (!isDrawingPlaceholder) {
                originalStep = undefined;
                (anno as any).ocr_match_status = 'UNMATCHED';
            }
        }

        if (!originalStep && aiLineId) {
            const lineNumMatch = aiLineId.match(/line[_\s]*(\d+)/i);
            if (lineNumMatch && lineNumMatch[1]) {
                const lineNum = parseInt(lineNumMatch[1], 10);
                if (lineNum > 0 && lineNum <= stepsDataForMapping.length) {
                    originalStep = stepsDataForMapping[lineNum - 1];
                }
            }
            if (!originalStep) {
                const foundMark = (allMarks || []).find((m: any) =>
                    m.mark?.trim() === aiLineId || m.lineId?.trim() === aiLineId
                );
                if (foundMark) {
                } else if (aiLineId.startsWith('block_')) {
                    originalStep = stepsDataForMapping.find(step =>
                        step.globalBlockId?.trim() === aiLineId
                    );
                }
            }
        }

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
                console.log(`[ERROR: BLOCKING PRINTED TEXT] Q${questionId}: Match refused for printed instruction.`);
                originalStep = undefined;
                (anno as any).ocr_match_status = 'UNMATCHED';
            }
        }

        if (!originalStep) {
            const annotationText = ((anno as any).textMatch || (anno as any).text || '').toLowerCase();
            const isDrawingAnnotation = annotationText.includes('[drawing]') || (aiLineId && aiLineId.toLowerCase().includes('drawing'));
            if (isDrawingAnnotation) {
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
                if (!originalStep) {
                    originalStep = stepsDataForMapping.find(step => {
                        const stepText = (step.text || step.cleanedText || '').toLowerCase();
                        if (!stepText.includes('[drawing]')) return false;
                        const extractKeyWords = (text: string): string[] => {
                            return text
                                .replace(/\[drawing\]/gi, '')
                                .replace(/\[position:.*?\]/gi, '')
                                .split(/[^a-z0-9]+/i)
                                .filter(word => word.length > 2 && !['the', 'and', 'at', 'drawn', 'vertices', 'position', 'point'].includes(word.toLowerCase()))
                                .map(word => word.toLowerCase());
                        };
                        const annotationWords = extractKeyWords(annotationText);
                        const stepWords = extractKeyWords(stepText);
                        const matchingWords = annotationWords.filter(word => stepWords.includes(word));
                        return matchingWords.length >= 2 || (matchingWords.length > 0 && matchingWords.length === annotationWords.length);
                    });
                }
            }
        }

        const isTrulyVisualAnnotation = (anno as any).ocr_match_status === 'VISUAL' ||
            (anno as any).isDrawing === true ||
            (anno as any).line_id?.toString().toLowerCase().includes('drawing');

        if (!isTrulyVisualAnnotation) {
            effectiveVisualPos = undefined;
        }

        // ---------------------------------------------------------
        //  UNMATCHED / FALLBACK LOGIC
        // ---------------------------------------------------------
        if ((anno as any).ocr_match_status === 'UNMATCHED') {
            let lineIndex = ((anno as any).lineIndex || 1) - 1;

            // Find the position using line_index from Classification Blocks
            let classificationPosition: any = null;
            if (task?.classificationBlocks) {
                const allLines: Array<{ text: string; position: any; pageIndex: number }> = [];
                task.classificationBlocks.forEach(block => {
                    if (block.studentWorkLines) {
                        block.studentWorkLines.forEach(line => allLines.push({ text: line.text, position: line.position, pageIndex: block.pageIndex ?? defaultPageIndex }));
                    }
                    if (block.subQuestions) {
                        block.subQuestions.forEach(subQ => {
                            if (subQ.studentWorkLines) {
                                subQ.studentWorkLines.forEach(line => allLines.push({ text: line.text, position: line.position, pageIndex: block.pageIndex ?? defaultPageIndex }));
                            }
                        });
                    }
                });
                if (lineIndex >= 0 && lineIndex < allLines.length) {
                    const line = allLines[lineIndex];
                    if (line.position) {
                        classificationPosition = { ...line.position, pageIndex: line.pageIndex };
                    }
                }
            }

            // If we found a classification position, use it
            if (classificationPosition) {
                const pageIdx = classificationPosition.pageIndex;
                const pageDims = pageDimensions?.get(pageIdx);

                let finalX = classificationPosition.x;
                let finalY = classificationPosition.y;
                let finalW = classificationPosition.width || 100;
                let finalH = classificationPosition.height || 20;

                if (pageDims) {
                    finalX = (finalX / 100) * pageDims.width;
                    finalY = (finalY / 100) * pageDims.height;
                    finalW = (finalW / 100) * pageDims.width;
                    finalH = (finalH / 100) * pageDims.height;
                }

                // 🔥 CRITICAL FIX: FORCE MINIMUM SAFE WIDTH
                // The AI often returns tiny widths (e.g. 4% = 99px).
                // We enforce a minimum of 300px to ensure the annotation box is usable
                // and to prevent the SVG Layout engine from flipping left or pushing marks too far.
                const MIN_SAFE_WIDTH = 300;
                if (finalW < MIN_SAFE_WIDTH) {
                    console.log(`[WIDTH FIX] Boosting tiny width ${finalW.toFixed(0)}px to ${MIN_SAFE_WIDTH}px for Q${questionId}`);
                    finalW = MIN_SAFE_WIDTH;
                }

                const MIN_SAFE_HEIGHT = 50;
                if (finalH < MIN_SAFE_HEIGHT) {
                    finalH = MIN_SAFE_HEIGHT;
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

            const visualPosForUnmatched = effectiveVisualPos;
            const targetPageIndex = (visualPosForUnmatched?.pageIndex !== undefined) ? visualPosForUnmatched.pageIndex : defaultPageIndex;
            const pDimsUnmatched = pageDimensions?.get(targetPageIndex);

            if (effectiveVisualPos && pDimsUnmatched) {
                let x = (parseFloat(effectiveVisualPos.x) / 100) * pDimsUnmatched.width;
                let y = (parseFloat(effectiveVisualPos.y) / 100) * pDimsUnmatched.height;
                let w = (parseFloat(effectiveVisualPos.width) / 100) * pDimsUnmatched.width;
                let h = (parseFloat(effectiveVisualPos.height) / 100) * pDimsUnmatched.height;

                if (w < 10) w = 300; // Force min width here too
                if (h < 10) h = 30;

                return {
                    ...anno,
                    bbox: [x, y, w, h] as [number, number, number, number],
                    pageIndex: targetPageIndex,
                    line_id: (anno as any).line_id || `unmatched_${idx}`,
                    ocr_match_status: 'UNMATCHED',
                    hasLineData: false,
                    subQuestion: targetSubQ || anno.subQuestion
                };
            }

            if (targetSubQ && task?.classificationBlocks) {
                const matchingBlock = task.classificationBlocks.find(b => b.subQuestions && b.subQuestions.some((sq: any) => sq.part === targetSubQ));
                if (matchingBlock && matchingBlock.studentWorkLines && matchingBlock.studentWorkLines.length > 0) {
                    const firstLine = matchingBlock.studentWorkLines[0];
                    if (firstLine && firstLine.position) {
                        const pageIdx = firstLine.pageIndex ?? defaultPageIndex;
                        const dim = pageDimensions?.get(pageIdx);
                        let fb = [firstLine.position.x, firstLine.position.y, firstLine.position.width || 100, firstLine.position.height || 20] as [number, number, number, number];
                        if (dim && fb[0] < 100) {
                            fb = [(fb[0] / 100) * dim.width, (fb[1] / 100) * dim.height, (fb[2] / 100) * dim.width, (fb[3] / 100) * dim.height];
                        }

                        // Apply safety width
                        if (fb[2] < 300) fb[2] = 300;

                        return {
                            ...anno,
                            bbox: fb,
                            pageIndex: pageIdx,
                            line_id: `unmatched_${idx}`,
                            ocr_match_status: 'UNMATCHED',
                            hasLineData: false,
                            subQuestion: targetSubQ || anno.subQuestion
                        };
                    }
                }
            }

            const questionsOnPage = task?.questionsOnPage?.get(defaultPageIndex) || [];
            const baseQNum = getBaseQuestionNumber(String(questionId));
            const myIdx = questionsOnPage.indexOf(baseQNum);
            const count = questionsOnPage.length || 1;
            const safeIdxInSlice = myIdx === -1 ? 0 : myIdx;
            const sliceSizePercent = 100 / count;
            const centerYPercent = (safeIdxInSlice * sliceSizePercent) + (sliceSizePercent / 2);
            const staggeredYPercent = centerYPercent + (idx % 3) * 2;
            const fbDims = pageDimensions?.get(defaultPageIndex) || { width: 1000, height: 1400 };
            const sliceCenterPixelY = (staggeredYPercent / 100) * fbDims.height;

            return {
                ...anno,
                bbox: [fbDims.width * 0.1, sliceCenterPixelY, fbDims.width * 0.2, 40] as [number, number, number, number],
                pageIndex: defaultPageIndex,
                line_id: `unmatched_${idx}`,
                ocr_match_status: 'UNMATCHED',
                hasLineData: false,
                subQuestion: targetSubQ || anno.subQuestion
            };
        }

        // MATCHED CASE
        let pixelBbox: [number, number, number, number] = originalStep?.bbox ? [...originalStep.bbox] as [number, number, number, number] : [0, 0, 0, 0];

        // Also clamp Matched boxes if they seem dangerously narrow
        if (pixelBbox[2] > 0 && pixelBbox[2] < 100) {
            pixelBbox[2] = 300; // Safety boost
        }

        if (effectiveVisualPos && (isDrawingAnno || !originalStep?.bbox)) {
            const pIdx = (effectiveVisualPos.pageIndex !== undefined) ? effectiveVisualPos.pageIndex : pageIndex;
            const pageDims = pageDimensions?.get(pIdx);
            const effectiveWidth = pageDims?.width || 2000;
            const effectiveHeight = pageDims?.height || 3000;
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
                pixelBbox = [
                    xVal,
                    parseFloat(effectiveVisualPos.y),
                    parseFloat(effectiveVisualPos.width || "100"),
                    parseFloat(effectiveVisualPos.height || "60")
                ];
            }
        } else if (originalStep?.bbox) {
            pixelBbox = originalStep.bbox;
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
            aiPosition: rawVisualPos,
            hasLineData: !!originalStep?.lines,
            isDrawing: (anno as any).line_id?.toString().toLowerCase().includes('drawing'),
            visualObservation: visualObservation
        };

        lastValidAnnotation = enriched;
        return enriched;
    }).filter((a): a is EnrichedAnnotation => a !== null);

    return results;
};
