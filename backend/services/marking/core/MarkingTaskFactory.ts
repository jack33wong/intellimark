
import { getBaseQuestionNumber } from '../../../utils/TextNormalizationUtils.js';
import { MarkingTask } from '../../../types/index.js';
import { MarkingZoneService } from '../MarkingZoneService.js';

export class MarkingTaskFactory {

    /**
     * Faithfully migrates the original "createMarkingTasksFromClassification" logic.
     * Includes Phase 1 (Grouping), Phase 1.5 (Master Landmarks), and Phase 2 (Task Assembly).
     */
    static createTasksFromClassification(
        classificationResult: any,
        allPagesOcrData: any[],
        markingSchemesMap: Map<string, any>,
        pageDimensionsMap: Map<number, { width: number; height: number }>,
        standardizedPages: any[],
        mapperResults?: any[]
    ): MarkingTask[] {
        const tasks: MarkingTask[] = [];
        if (!classificationResult?.questions) return tasks;

        const questionGroups = new Map<string, any>();

        // =========================================================================
        // PHASE 1: GROUPING & TRUTH TRACKING
        // =========================================================================
        for (const q of classificationResult.questions) {
            const baseQNum = getBaseQuestionNumber(String(q.questionNumber || ''));
            if (!baseQNum) continue;

            const groupingKey = baseQNum;
            const sourceImageIndices = q.sourceImageIndices && q.sourceImageIndices.length > 0 ? q.sourceImageIndices : [q.sourceImageIndex ?? 0];

            // --- Anchor Page Logic (Standard) ---
            let anchorMainPage = sourceImageIndices[0] ?? 0;
            if (allPagesOcrData) {
                const snippet = q.text ? q.text.replace(/\n/g, ' ').substring(0, 25).trim() : null;
                if (snippet && snippet.length > 5) {
                    for (const page of allPagesOcrData) {
                        const match = (page as any).ocrData?.mathBlocks?.some((b: any) => (b.mathpixLatex || b.googleVisionText || '').includes(snippet));
                        if (match) { anchorMainPage = page.pageIndex; break; }
                    }
                }
            }

            if (!sourceImageIndices.includes(anchorMainPage)) sourceImageIndices.unshift(anchorMainPage);
            else if (sourceImageIndices[0] !== anchorMainPage) {
                const idx = sourceImageIndices.indexOf(anchorMainPage);
                sourceImageIndices.splice(idx, 1);
                sourceImageIndices.unshift(anchorMainPage);
            }

            let markingScheme = null;
            for (const [key, scheme] of markingSchemesMap.entries()) {
                if (key.startsWith(`${baseQNum}_`) && key.split('_')[0] === baseQNum) {
                    markingScheme = scheme;
                    break;
                }
            }

            if (!questionGroups.has(groupingKey)) {
                questionGroups.set(groupingKey, {
                    mainQuestion: q,
                    markingScheme: markingScheme,
                    baseQNum: baseQNum,
                    sourceImageIndices: sourceImageIndices,
                    classificationBlocks: [],
                    aiSegmentationResults: [],
                    subQuestionMetadata: { hasSubQuestions: false, subQuestions: [] },
                    lineCounter: 1,
                    processedSubQuestions: new Set<string>()
                });
            } else {
                const group = questionGroups.get(groupingKey);
                const combined = [...new Set([...group.sourceImageIndices, ...sourceImageIndices])].sort();
                group.sourceImageIndices = combined;
            }

            const group = questionGroups.get(groupingKey);
            const currentQPageIndex = anchorMainPage;
            (q as any).pageIndex = currentQPageIndex;

            const allNodes = this.flattenQuestionTree(q);

            allNodes.forEach((node: any) => {
                const blockId = `class_block_${baseQNum}_${node.part || 'main'}`;
                const nodeBox = node.box || node.region || node.rect || node.coordinates;

                if (nodeBox) {
                    group.classificationBlocks.push({
                        id: blockId,
                        text: node.text || '',
                        box: nodeBox,
                        pageIndex: node.pageIndex ?? currentQPageIndex,
                        part: node.part || 'main'
                    });
                }

                if (node.part && node.part !== 'main') {
                    const IGNORED = ['id', 'questionnumber', 'totalmarks'];
                    if (!IGNORED.includes(node.part.toLowerCase())) {
                        group.subQuestionMetadata.hasSubQuestions = true;
                        group.subQuestionMetadata.subQuestions.push({
                            part: node.part,
                            text: node.text || ''
                        });
                    }
                }

                let hasContent = false;
                if (node.studentWorkLines && node.studentWorkLines.length > 0) {
                    node.studentWorkLines.forEach((l: any) => {
                        const pIdx = l.pageIndex ?? node.pageIndex ?? currentQPageIndex;
                        const globalId = `p${pIdx}_q${baseQNum}_line_${group.lineCounter++}`;

                        if (l.text === '[DRAWING]') {
                            group.aiSegmentationResults.push({
                                line_id: `visual_drawing_${baseQNum}_${group.lineCounter}`,
                                content: '[DRAWING]',
                                source: 'classification',
                                blockId: `drawing_${baseQNum}_${group.lineCounter}`,
                                subQuestionLabel: node.part || 'main',
                                pageIndex: pIdx,
                                bbox: l.box || l.position || nodeBox || { x: 0, y: 0, width: 100, height: 50 }
                            });
                            hasContent = true;
                            return;
                        }

                        let rawBox = l.position || l.box || l.region || l.rect || l.coordinates;
                        if (!rawBox || (rawBox.x === 0 && rawBox.y === 0 && rawBox.width === 0)) {
                            rawBox = node.position || nodeBox;
                        }

                        const positionData = rawBox || { x: 0, y: 0, width: 0, height: 0, unit: 'percentage' };

                        group.aiSegmentationResults.push({
                            line_id: globalId,
                            content: l.text,
                            source: 'classification',
                            blockId: globalId,
                            subQuestionLabel: node.part || 'main',
                            pageIndex: pIdx,
                            bbox: positionData,
                            position: positionData
                        });
                        hasContent = true;
                    });
                }

                if (node.hasStudentDrawing) hasContent = true;
                if (hasContent && node.part) group.processedSubQuestions.add(node.part);
            });
        }

        // =========================================================================
        // PHASE 1.5: BUILD MASTER LANDMARKS (Global Page Context)
        // =========================================================================
        const masterLandmarks: any[] = [];
        for (const q of classificationResult.questions) {
            const qBase = getBaseQuestionNumber(String(q.questionNumber || ''));
            if (!qBase) continue;

            const targetPageIndex = q.sourceImageIndex ?? q.pageIndex ?? 0;
            console.log(`[ZONE-TRUTH] Q${qBase} Classifier Target: Page ${targetPageIndex}`);

            const allNodes = this.flattenQuestionTree(q);
            allNodes.forEach((node: any) => {
                const nodeBox = node.box || node.region || node.rect || node.coordinates;
                if (nodeBox) {
                    // 🛡️ [IDENTITY-PATCH]: Prepend the label (e.g. "1 ") to the text.
                    // This ensures the Dressing/Handshaking logic in MarkingZoneService can see the number.
                    const partLabel = node.part && node.part !== 'main' ? node.part : qBase;
                    const cleanTextWithNumber = `${partLabel} ${node.text || ''}`.trim();

                    masterLandmarks.push({
                        id: `master_block_${qBase}_${node.part || 'main'}`,
                        text: cleanTextWithNumber,
                        box: nodeBox,
                        pageIndex: node.pageIndex ?? targetPageIndex,
                        part: node.part || 'main',
                        questionNumber: qBase
                    });
                }
            });
        }

        // =========================================================================
        // PHASE 1.6: GLOBAL ZONE DETECTION
        // =========================================================================
        const allOcrBlocksGlobal: any[] = [];
        if (allPagesOcrData) {
            allPagesOcrData.forEach((pageData, pIdx) => {
                const blocksSource = (pageData as any)?.ocrData?.mathBlocks || (pageData as any)?.mathBlocks || (pageData as any)?.blocks || [];
                const blocks = blocksSource.map((b: any, bIdx: number) => {
                    const blockId = `p${pageData.pageIndex ?? pIdx}_ocr_${bIdx}`;
                    // [FIX]: Mutate original block to preserve references
                    b.pageIndex = pageData.pageIndex ?? pIdx;
                    b.globalBlockId = blockId;
                    b.id = blockId;
                    b.text = b.text || b.mathpixLatex || b.latex || "";
                    return b;
                });
                allOcrBlocksGlobal.push(...blocks);
            });
        }

        // 🛡️ [ZONE-FIX]: Include classification-based landmarks in the pool.
        // These are often more reliable and contain more complete question text than fragmented OCR blocks.
        masterLandmarks.forEach(l => {
            allOcrBlocksGlobal.push({
                id: l.id,
                text: l.text,
                coordinates: l.box,
                pageIndex: l.pageIndex,
                isHandwritten: false
            });
        });

        // 🏰 [UPSTREAM-SORT]: Enforce strict physical order (Page -> Y)
        // This is critical for the Sequential Zone Detector's "Stop if next question seen" logic.
        allOcrBlocksGlobal.sort((a, b) => {
            const pageDiff = (a.pageIndex || 0) - (b.pageIndex || 0);
            if (pageDiff !== 0) return pageDiff;
            const yA = a.coordinates?.y ?? 0;
            const yB = b.coordinates?.y ?? 0;
            return yA - yB;
        });

        const distinctPages = [...new Set(allOcrBlocksGlobal.map(b => b.pageIndex || 0))].sort((a, b) => a - b);
        console.log(`[UPSTREAM-SORT] 🏆 Fed ${allOcrBlocksGlobal.length} blocks in order: ${distinctPages.join(' -> ')}`);

        const globalExpectedQuestions: Array<{ label: string; text: string; targetPages?: number[] }> = [];
        for (const q of classificationResult.questions) {
            const basePrefix = getBaseQuestionNumber(String(q.questionNumber || ''));
            if (!basePrefix) continue;
            const nodes = this.flattenQuestionTree(q);
            nodes.forEach(node => {
                let partLabel = "";
                if (node.part && node.part !== 'main') {
                    partLabel = node.part.startsWith(basePrefix) ? node.part : `${basePrefix}${node.part}`;
                } else {
                    partLabel = basePrefix;
                }
                if (!globalExpectedQuestions.some(eq => eq.label === partLabel)) {
                    const sourceImageIndices = q.sourceImageIndices && q.sourceImageIndices.length > 0 ? q.sourceImageIndices : [q.sourceImageIndex ?? 0];
                    globalExpectedQuestions.push({
                        label: partLabel,
                        text: node.text || "",
                        targetPages: sourceImageIndices
                    });
                }
            });
        }

        // 🏰 [RESTORED]: Sort Numerically (1, 2, 2a, 10, 11...)
        // We MUST process questions in numerical order for the UI and AI context.
        // This ensures the pipeline flow is logical (Q1 -> Q2 -> Q3).
        globalExpectedQuestions.sort((a, b) => {
            const numA = parseInt(a.label.match(/\d+/)?.[0] || '0');
            const numB = parseInt(b.label.match(/\d+/)?.[0] || '0');
            if (numA !== numB) return numA - numB;
            return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
        });

        console.log(`[ZONE-DETECTOR] Deterministic Sort Order: ${globalExpectedQuestions.map(q => q.label).join(' -> ')}`);

        let globalZones = MarkingZoneService.detectSemanticZones(
            allOcrBlocksGlobal,
            pageDimensionsMap,
            globalExpectedQuestions
        );

        // [FIX] Refine zones to prevent overlap (User Rule: No Buffer)
        // This ensures Zone Fidelity respects the "Next Sub-Question Start = Current End" rule upstream.
        globalZones = MarkingZoneService.refineZones(globalZones);

        // 🔍 [EVIDENCE LOG]: Prove the zones are correctly tightened and using individual margins.
        console.log(`\n📦 [ZONE-EVIDENCE] FINAL UPSTREAM ZONES:`);
        Object.entries(globalZones).forEach(([lbl, zs]: [string, any[]]) => {
            zs.forEach(z => {
                const pW = pageDimensionsMap.get(z.pageIndex)?.width || 0;
                const pH = pageDimensionsMap.get(z.pageIndex)?.height || 0;
                const marginXPct = ((z.x / pW) * 100).toFixed(1);
                const marginYPct = ((z.startY / pH) * 100).toFixed(1);
                const marginTarget = 6.0;
                console.log(`   ✅ ${lbl.padEnd(6)} | P${z.pageIndex} | Y: ${String(Math.round(z.startY)).padStart(4)} (${marginYPct}%) to ${String(Math.round(z.endY)).padStart(4)} | X: ${z.x} (Margin: ${marginXPct}%) | W: ${z.width}`);
            });
        });
        console.log(`-------------------------------------------\n`);

        // =========================================================================
        // PHASE 2: TASK GENERATION
        // =========================================================================
        const sortedQuestionGroups = Array.from(questionGroups.entries()).sort((a, b) => {
            const numA = parseInt(String(a[0]).replace(/\D/g, '')) || 0;
            const numB = parseInt(String(b[0]).replace(/\D/g, '')) || 0;
            return numA - numB;
        });

        sortedQuestionGroups.forEach(([baseQNum, group], idx) => {
            let promptMainWork = "";
            let currentHeader = "";

            // [ID-LIE FIX]: Create a mapping of Absolute Page Index -> Relative Index (0, 1, 2...)
            // This ensures the AI prompt always sees questions starting from Page 0.
            const absPageIndices = [...group.sourceImageIndices].sort((a, b) => a - b);
            const pageMap: Record<number, number> = {};
            absPageIndices.forEach((abs, rel) => {
                pageMap[abs] = rel;
            });

            group.aiSegmentationResults.sort((a: any, b: any) => {
                if (a.subQuestionLabel === 'main') return -1;
                if (b.subQuestionLabel === 'main') return 1;
                return (a.subQuestionLabel || '').localeCompare(b.subQuestionLabel || '');
            });

            group.aiSegmentationResults.forEach((seg: any) => {
                const clean = seg.content.replace(/\s+/g, ' ').trim();
                const isContentValid = (clean.length > 0 && clean !== '--') || seg.isVisualPlaceholder;

                if (isContentValid) {
                    if (seg.subQuestionLabel && seg.subQuestionLabel !== currentHeader && seg.subQuestionLabel !== 'main') {
                        promptMainWork += `\n[SUB-QUESTION ${seg.subQuestionLabel}]\n`;
                        currentHeader = seg.subQuestionLabel;
                    }

                    // 🛡️ [OMNI-PRESENT SOURCE FIX]: 
                    // Explode [DRAWING] blocks into page-specific IDs if the question spans multiple pages.
                    if (clean === '[DRAWING]' && seg.subQuestionLabel) {
                        const fullLabel = seg.subQuestionLabel.startsWith(baseQNum)
                            ? seg.subQuestionLabel
                            : `${baseQNum}${seg.subQuestionLabel}`;

                        const zones = globalZones[fullLabel];
                        if (zones && zones.length > 0) {
                            const uniquePages = [...new Set(zones.map((z: any) => z.pageIndex))].sort((a, b) => a - b);
                            if (uniquePages.length > 0) {
                                uniquePages.forEach(pIdx => {
                                    const relIdx = pageMap[pIdx] ?? 0;
                                    const pageSpecificId = `p${relIdx}_${seg.line_id}`; // e.g. p0_visual_drawing_11_1
                                    promptMainWork += `[ID: ${pageSpecificId}] [DRAWING]\n`;
                                });
                                return; // Skip default generic line
                            }
                        }
                    }

                    let id = seg.line_id || seg.blockId || seg.sequentialId;

                    // 🛡️ [ID-LIE FIX]: Rewrite ID in prompt to use relative page index
                    if (id && id.startsWith('p')) {
                        const match = id.match(/^p(\d+)_/);
                        if (match) {
                            const absIdx = parseInt(match[1]);
                            if (pageMap[absIdx] !== undefined) {
                                id = id.replace(`p${absIdx}_`, `p${pageMap[absIdx]}_`);
                            }
                        }
                    }

                    promptMainWork += `[ID: ${id}] ${clean}\n`;
                }
            });

            // 🛡️ [OMNI-PRESENT SYNC]: Re-populate aiSegmentationResults with the exploded/relative versions
            const explodedResults: any[] = [];
            group.aiSegmentationResults.forEach((seg: any) => {
                const clean = seg.content.replace(/\s+/g, ' ').trim();
                if (clean === '[DRAWING]' && seg.subQuestionLabel) {
                    const fullLabel = seg.subQuestionLabel.startsWith(baseQNum)
                        ? seg.subQuestionLabel
                        : `${baseQNum}${seg.subQuestionLabel}`;

                    const zones = globalZones[fullLabel];
                    if (zones && zones.length > 0) {
                        const uniquePages = [...new Set(zones.map((z: any) => z.pageIndex))].sort((a, b) => a - b);
                        uniquePages.forEach(pIdx => {
                            const relIdx = pageMap[pIdx] ?? 0;
                            const newId = `p${pIdx}_${seg.line_id}`;
                            const relId = `p${relIdx}_${seg.line_id}`;
                            explodedResults.push({
                                ...seg,
                                line_id: newId,
                                relative_line_id: relId,
                                blockId: newId,
                                globalBlockId: newId,
                                pageIndex: pIdx,
                                isExploded: true
                            });
                        });
                        return;
                    }
                }

                const relIdx = seg.pageIndex !== undefined ? (pageMap[seg.pageIndex] ?? 0) : 0;
                explodedResults.push({
                    ...seg,
                    relative_line_id: (seg.line_id || seg.blockId)?.startsWith('p')
                        ? (seg.line_id || seg.blockId).replace(/^p(\d+)_/, `p${relIdx}_`)
                        : seg.line_id
                });
            });
            group.aiSegmentationResults = explodedResults;

            let allOcrBlocks: any[] = [];
            if (allPagesOcrData) {
                group.sourceImageIndices.forEach((pIdx: number) => {
                    const pageData = allPagesOcrData.find(p => p.pageIndex === pIdx);
                    // 🛡️ [PROMPT-SCOPE]: Get the specific zone for this question on this page
                    // We only want OCR blocks that are inside (or very close to) the question's zone.
                    const qZones = globalZones && globalZones[baseQNum] ? globalZones[baseQNum] : [];
                    const pageZone = qZones.find((z: any) => z.pageIndex === pIdx);

                    const validStartY = pageZone ? (pageZone.startY || 0) : 0;
                    const validEndY = pageZone ? (pageZone.endY || 99999) : 99999;

                    const blocksSource = (pageData as any)?.ocrData?.mathBlocks || (pageData as any)?.mathBlocks || (pageData as any)?.blocks || [];
                    if (blocksSource.length > 0) {
                        const relIdx = pageMap[pIdx] ?? 0;
                        const blocks = blocksSource.map((b: any, bIdx: number) => {
                            // ⚠️ [SAFETY-REVERT] Filter removed to prevent data loss.
                            // We construct the block ID preserving the original index bIdx.
                            const absId = `p${pIdx}_ocr_${bIdx}`;
                            const relId = `p${relIdx}_ocr_${bIdx}`;

                            // [FIX]: Preserve the original reference that was tagged in Phase 1.6
                            b.pageIndex = pIdx;
                            b.globalBlockId = absId;
                            b.id = absId;
                            b.relative_id = relId;
                            b.text = b.text || b.mathpixLatex || b.latex || "";
                            return b;
                        }).filter((b: any) => b !== null);
                        allOcrBlocks.push(...blocks);
                    }
                });
            }

            const siblingsOnSamePages = (classificationResult.questions || []).filter((otherQ: any) => {
                const otherPages = (otherQ.sourceImageIndices || [otherQ.sourceImageIndex ?? 0]).map((p: any) => Number(p));
                const currentPages = group.sourceImageIndices.map((p: any) => Number(p));
                return otherPages.some((p: any) => currentPages.includes(p));
            });

            const questionImages: string[] = [];
            group.sourceImageIndices.forEach((imageIdx: number) => {
                const page = standardizedPages.find(p => p.pageIndex === imageIdx);
                if (page?.imageData) questionImages.push(page.imageData);
            });

            let nextQuestionText: string | undefined;
            const nextGroup = sortedQuestionGroups[idx + 1];
            if (nextGroup) nextQuestionText = nextGroup[1].mainQuestion.text;

            tasks.push({
                questionNumber: baseQNum,
                questionText: group.mainQuestion.text,
                nextQuestionText: nextQuestionText,
                mathBlocks: allOcrBlocks,
                markingScheme: group.markingScheme,
                sourcePages: group.sourceImageIndices,
                classificationStudentWork: promptMainWork,
                classificationBlocks: group.classificationBlocks,
                allClassificationBlocks: masterLandmarks.filter(l => group.sourceImageIndices.includes(l.pageIndex)),
                pageDimensions: pageDimensionsMap,
                pageContext: siblingsOnSamePages,
                imageData: questionImages[0],
                images: questionImages,
                aiSegmentationResults: group.aiSegmentationResults,
                semanticZones: globalZones,
                pageMap: pageMap,
                subQuestionMetadata: {
                    hasSubQuestions: group.subQuestionMetadata.hasSubQuestions,
                    subQuestions: group.subQuestionMetadata.subQuestions
                }
            });
        });

        return tasks;
    }

    private static flattenQuestionTree(node: any, result: any[] = []) {
        result.push(node);
        if (node.subQuestions && Array.isArray(node.subQuestions)) {
            node.subQuestions.forEach((child: any) => this.flattenQuestionTree(child, result));
        }
        return result;
    }

    public static deriveExpectedQuestionsFromClassification(task: MarkingTask): Array<{ label: string; text: string }> {
        const classificationExpected: Array<{ label: string; text: string }> = [];

        const traverse = (nodes: any[], parentPart: string = "") => {
            nodes.forEach(qs => {
                const currentPart = qs.part || "";
                if (qs.subQuestions && qs.subQuestions.length > 0) {
                    traverse(qs.subQuestions, currentPart);
                } else {
                    if (currentPart) {
                        const label = currentPart.startsWith(String(task.questionNumber)) ? currentPart : `${task.questionNumber}${currentPart}`;
                        classificationExpected.push({ label, text: qs.text || "" });
                    }
                }
            });
        };

        if (task.subQuestionMetadata?.subQuestions) traverse(task.subQuestionMetadata.subQuestions);

        if (task.classificationBlocks) {
            task.classificationBlocks.forEach(cb => {
                let part = (cb as any).part || (cb as any).blockId?.split('_').pop();
                if (part && part !== 'main') {
                    const label = part.startsWith(String(task.questionNumber)) ? part : `${task.questionNumber}${part}`;
                    if (!classificationExpected.some(q => q.label === label)) {
                        classificationExpected.push({ label, text: cb.text || "" });
                    }
                }
            });
        }

        const baseNum = String(task.questionNumber).replace(/\D/g, '');
        if (baseNum && !classificationExpected.some(q => q.label === baseNum)) {
            classificationExpected.push({ label: baseNum, text: task.questionText || "" });
        }

        return classificationExpected.filter(q => q.label.length > 0);
    }
}
