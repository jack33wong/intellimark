
import { getBaseQuestionNumber } from '../../../utils/TextNormalizationUtils.js';
import { MarkingTask } from '../../../types/index.js';

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
            const allNodes = this.flattenQuestionTree(q);
            allNodes.forEach((node: any) => {
                const nodeBox = node.box || node.region || node.rect || node.coordinates;
                if (nodeBox) {
                    masterLandmarks.push({
                        id: `master_block_${qBase}_${node.part || 'main'}`,
                        text: node.text || '',
                        box: nodeBox,
                        pageIndex: node.pageIndex ?? q.sourceImageIndex ?? 0,
                        part: node.part || 'main',
                        questionNumber: qBase
                    });
                }
            });
        }

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
                    const id = seg.line_id || seg.blockId || seg.sequentialId;
                    promptMainWork += `[ID: ${id}] ${clean}\n`;
                }
            });

            let allOcrBlocks: any[] = [];
            if (allPagesOcrData) {
                group.sourceImageIndices.forEach((pIdx: number) => {
                    const pageData = allPagesOcrData.find(p => p.pageIndex === pIdx);
                    const blocksSource = (pageData as any)?.ocrData?.mathBlocks || (pageData as any)?.mathBlocks || (pageData as any)?.blocks || [];
                    if (blocksSource.length > 0) {
                        const blocks = blocksSource.map((b: any, bIdx: number) => {
                            const blockId = `p${pIdx}_ocr_${bIdx}`;
                            return { ...b, pageIndex: pIdx, globalBlockId: blockId, id: blockId, text: b.text || b.mathpixLatex || b.latex || "" };
                        });
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
