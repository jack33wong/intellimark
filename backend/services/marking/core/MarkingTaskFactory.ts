
import { getBaseQuestionNumber, combineQuestionAndPart } from '../../../utils/TextNormalizationUtils.js';
import { MarkingTask } from '../../../types/index.js';
import { MarkingZoneService } from '../MarkingZoneService.js';
import { CoordinateAuditLogger } from '../../../utils/LoggerUtils.js';

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
        mapperResults?: any[],
        metaPageIndices?: number[]
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
            
            if (q.confidence === 0.1) {
                console.log(`[DEBUG] Factory saw mock question ${q.questionNumber}. sourceImageIndex: ${q.sourceImageIndex}, sourceImageIndices: ${JSON.stringify(sourceImageIndices)}`);
            }

            // --- Anchor Page Logic (Standard) ---
            let anchorMainPage = sourceImageIndices[0] ?? 0;
            /* [SOFT DISABLE]: User requested to disable physical anchoring to prevent risky misalignments.
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
            */
            if (anchorMainPage !== undefined) {
                // console.log(`⚓ [ANCHOR-DISABLED] Safe Match Found at P${anchorMainPage}. (Override prevented)`);
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
                    sourceImageIndices: [...sourceImageIndices].sort((a: number, b: number) => a - b),
                    classificationBlocks: [],
                    aiSegmentationResults: [],
                    subQuestionMetadata: { hasSubQuestions: false, subQuestions: [] },
                    lineCounter: 1,
                    processedSubQuestions: new Set<string>()
                });
            } else {
                const group = questionGroups.get(groupingKey);
                const combined = [...new Set([...group.sourceImageIndices, ...sourceImageIndices])].sort((a: number, b: number) => a - b);
                group.sourceImageIndices = combined;
                // Deterministically preserve the first non-empty main question stem in physical page order
                if ((!group.mainQuestion?.text || String(group.mainQuestion.text).trim().length < 5) && q.text && String(q.text).trim().length >= 5) {
                    group.mainQuestion = { ...group.mainQuestion, text: q.text };
                }
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

                    // 🛡️ [AUDIT-1] Initial Question Mapping
                    const auditBox = nodeBox || node.bbox;
                    CoordinateAuditLogger.audit(1, `Q${baseQNum} Classification`, `Part: ${node.part || 'main'} | Page: ${node.pageIndex ?? currentQPageIndex} | Box: ${JSON.stringify(auditBox)}`);
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
                        const lineText = (l.text !== undefined ? l.text : (l.t !== undefined ? l.t : '')) || '';

                        if (lineText === '[DRAWING]') {
                            const drawingId = `p${pIdx}_visual_drawing_${baseQNum}_${group.lineCounter}`;
                            const drawingPos = l.position || (Array.isArray(l.p) ? { x: l.p[0], y: l.p[1], width: l.p[2], height: l.p[3] } : undefined) || (node as any).studentDrawingPosition;
                            const dX = drawingPos?.x ?? l.box?.x ?? (nodeBox?.x ?? 0);
                            const dY = drawingPos?.y ?? l.box?.y ?? (nodeBox?.y ?? 0);
                            const dW = drawingPos?.width ?? l.box?.width ?? (nodeBox?.width ?? 100);
                            const dH = drawingPos?.height ?? l.box?.height ?? (nodeBox?.height ?? 50);

                            group.aiSegmentationResults.push({
                                line_id: drawingId,
                                content: '[DRAWING]',
                                source: 'classification',
                                blockId: drawingId,
                                subQuestionLabel: node.part || 'main',
                                pageIndex: pIdx,
                                bbox: [dX, dY, dW, dH],
                                position: { x: dX, y: dY, width: dW, height: dH },
                                unit: 'percentage'
                            });
                            hasContent = true;
                            return;
                        }

                        let rawBox = l.position || l.box || l.region || l.rect || l.coordinates || l.p;
                        let positionData: any;
                        if (Array.isArray(rawBox) && rawBox.length === 4) {
                            positionData = { x: rawBox[0], y: rawBox[1], width: rawBox[2], height: rawBox[3] };
                        } else if (rawBox && typeof rawBox.x === 'number') {
                            positionData = rawBox;
                        } else {
                            rawBox = node.position || nodeBox;
                            positionData = (rawBox && typeof rawBox.x === 'number') ? rawBox : { x: 0, y: 0, width: 0, height: 0 };
                        }

                        const forcedUnit = (l.ocrSource === 'classification' || !l.ocrSource) ? 'percentage' : 'pixels';
                        // console.log(`🛡️ [UNIT-SYNC] Q${baseQNum} Source: ${l.ocrSource} | Raw Y: ${l.position?.y} | Forced Unit: ${forcedUnit}`);

                        group.aiSegmentationResults.push({
                            line_id: globalId,
                            content: lineText,
                            source: 'classification',
                            blockId: globalId,
                            subQuestionLabel: node.part || 'main',
                            pageIndex: pIdx,
                            bbox: positionData,
                            position: positionData,
                            unit: forcedUnit
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
            // console.log(`[ZONE-TRUTH] Q${qBase} Classifier Target: Page ${targetPageIndex}`);

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
            const pageDiff = (a.pageIndex ?? 0) - (b.pageIndex ?? 0);
            if (pageDiff !== 0) return pageDiff;
            const yA = a.coordinates?.y ?? 0;
            const yB = b.coordinates?.y ?? 0;
            return yA - yB;
        });

        const distinctPages = [...new Set(allOcrBlocksGlobal.map(b => b.pageIndex ?? 0))].sort((a, b) => a - b);
        // console.log(`[UPSTREAM-SORT] 🏆 Fed ${allOcrBlocksGlobal.length} blocks in order: ${distinctPages.join(' -> ')}`);

        const globalExpectedQuestions: Array<{ label: string; text: string; targetPages?: number[] }> = [];
        for (const q of classificationResult.questions) {
            const basePrefix = getBaseQuestionNumber(String(q.questionNumber || ''));
            if (!basePrefix) continue;
            const nodes = this.flattenQuestionTree(q);
            nodes.forEach(node => {
                let partLabel = "";
                if (node.part && node.part !== 'main') {
                    partLabel = combineQuestionAndPart(basePrefix, node.part);
                } else {
                    partLabel = basePrefix;
                }
                if (!globalExpectedQuestions.some(eq => eq.label === partLabel)) {
                    // 🛡️ [SUB-SPECIFIC]: Prefer node's specific page indices over parent's multi-page array.
                    // However, for Drawing questions without an already-detected drawing box on their page, allow a 2-page bridge context.
                    const parentPages = q.sourceImageIndices && q.sourceImageIndices.length > 0 ? q.sourceImageIndices : [q.sourceImageIndex ?? 0];
                    let targetPages = (node.sourceImageIndices && node.sourceImageIndices.length > 0)
                        ? node.sourceImageIndices
                        : (node.pageIndex !== undefined ? [node.pageIndex] : (node.sourceImageIndex !== undefined ? [node.sourceImageIndex] : parentPages));

                    // 🗺️ [BRIDGE-EXPANSION]: Only expand if the drawing box wasn't already located on node's page AND parent spans a 2-page bridge.
                    if (node.hasStudentDrawing && !(node as any).studentDrawingPosition && parentPages.length === 2) {
                        targetPages = parentPages;
                    }

                    globalExpectedQuestions.push({
                        label: partLabel,
                        text: node.text || "",
                        targetPages: targetPages
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


        let globalZones = MarkingZoneService.detectSemanticZones(
            allOcrBlocksGlobal,
            pageDimensionsMap,
            globalExpectedQuestions
        );

        // [FIX] Refine zones to prevent overlap (User Rule: No Buffer)
        // This ensures Zone Fidelity respects the "Next Sub-Question Start = Current End" rule upstream.
        globalZones = MarkingZoneService.refineZones(globalZones);

        // 🔍 [EVIDENCE LOG]: Prove the zones are correctly tightened and using individual margins.
        if (process.env.LOG_ZONE_SERVICE_DEBUG === 'true') {
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
        }

        // =========================================================================
        // PHASE 2: TASK GENERATION
        // =========================================================================
        const sortedQuestionGroups = Array.from(questionGroups.entries()).sort((a, b) => {
            const numA = parseInt(String(a[0]).replace(/\D/g, '')) || 0;
            const numB = parseInt(String(b[0]).replace(/\D/g, '')) || 0;
            return numA - numB;
        });

        // 🔗 [SIBLING CONTEXT INHERITANCE FOR MODIFIED / GENERIC QUESTIONS]:
        // When sibling questions (e.g. Q2–Q5) matched an official DB paper, inherit their
        // sourceExtracts, subject metadata, and quoted reading extracts onto any modified/generic
        // sibling question (e.g. Q1) while keeping Q1 in Generic Rubric Mode.
        const matchedSiblingSchemes = sortedQuestionGroups
            .map(([_, g]) => g.markingScheme)
            .filter((ms: any) => ms && !ms.isGeneric);

        if (matchedSiblingSchemes.length > 0) {
            const donorScheme = matchedSiblingSchemes.find((ms: any) =>
                (Array.isArray(ms.sourceExtracts) && ms.sourceExtracts.length > 0) ||
                (typeof ms.sourceExtracts === 'string' && ms.sourceExtracts.trim().length > 0) ||
                (Array.isArray(ms.questionMarks?.sourceExtracts) && ms.questionMarks.sourceExtracts.length > 0)
            ) || matchedSiblingSchemes[0];

            const inheritedExtracts =
                donorScheme?.sourceExtracts ||
                donorScheme?.questionMarks?.sourceExtracts ||
                [];

            // Also harvest any reading extract quoted inside sibling question stems (e.g. Q2's "from lines 7 to 17 of the source: ...")
            const siblingQuotedExtracts: string[] = [];
            for (const [sibQNum, sibGroup] of sortedQuestionGroups) {
                const sibText = String(sibGroup.mainQuestion?.text || '').trim();
                if (sibText.length > 150 && /from\s+lines?\s+\d+|extract|source/i.test(sibText)) {
                    siblingQuotedExtracts.push(`[Sibling Q${sibQNum} Source Extract Context]:\n${sibText}`);
                }
            }

            for (const [_, group] of sortedQuestionGroups) {
                if (group.markingScheme?.isGeneric) {
                    if (!group.markingScheme.sourceExtracts || group.markingScheme.sourceExtracts.length === 0) {
                        if (Array.isArray(inheritedExtracts) && inheritedExtracts.length > 0) {
                            group.markingScheme.sourceExtracts = inheritedExtracts;
                        } else if (typeof inheritedExtracts === 'string' && inheritedExtracts.trim().length > 0) {
                            group.markingScheme.sourceExtracts = inheritedExtracts;
                        } else if (siblingQuotedExtracts.length > 0) {
                            group.markingScheme.sourceExtracts = siblingQuotedExtracts.join('\n\n');
                        }
                    }
                    if (!group.markingScheme.subject && donorScheme?.subject) {
                        group.markingScheme.subject = donorScheme.subject;
                    }
                    if (!group.markingScheme.subjectProfile && donorScheme?.subjectProfile) {
                        group.markingScheme.subjectProfile = donorScheme.subjectProfile;
                    }
                    if (!group.markingScheme.guidance && donorScheme?.guidance) {
                        group.markingScheme.guidance = donorScheme.guidance;
                    }
                }
            }
        }

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
                const pageDiff = (a.pageIndex ?? 0) - (b.pageIndex ?? 0);
                if (pageDiff !== 0) return pageDiff;

                const labelA = a.subQuestionLabel || 'main';
                const labelB = b.subQuestionLabel || 'main';
                if (labelA !== labelB) {
                    if (labelA === 'main') return -1;
                    if (labelB === 'main') return 1;
                    return labelA.localeCompare(labelB, undefined, { numeric: true });
                }

                const yA = a.position?.y ?? a.coordinates?.y ?? (a.p ? a.p[1] : 0);
                const yB = b.position?.y ?? b.coordinates?.y ?? (b.p ? b.p[1] : 0);
                // Use 1.2% vertical line-height tolerance so words on the same line sort left-to-right (xA - xB)
                if (Math.abs(yA - yB) > 1.2) return yA - yB;

                const xA = a.position?.x ?? a.coordinates?.x ?? (a.p ? a.p[0] : 0);
                const xB = b.position?.x ?? b.coordinates?.x ?? (b.p ? b.p[0] : 0);
                if (Math.abs(xA - xB) > 0.1) return xA - xB;

                return String(a.content || '').localeCompare(String(b.content || ''));
            });

            // Re-number non-drawing student work lines sequentially AFTER sorting so line_N IDs are strictly monotonic
            let sortedLineSeq = 1;
            group.aiSegmentationResults.forEach((seg: any) => {
                if (seg.content !== '[DRAWING]') {
                    const pIdx = seg.pageIndex ?? 0;
                    const newId = `p${pIdx}_q${baseQNum}_line_${sortedLineSeq++}`;
                    seg.line_id = newId;
                    seg.blockId = newId;
                }
            });

            group.aiSegmentationResults.forEach((seg: any) => {
                // 🛡️ [VISUAL-FILTER]: Only include student work/drawings that belong to the current task's pages.
                if (seg.pageIndex !== undefined && !group.sourceImageIndices.includes(seg.pageIndex)) return;

                const clean = seg.content.replace(/\s+/g, ' ').trim();
                const isContentValid = (clean.length > 0 && clean !== '--') || seg.isVisualPlaceholder;

                if (isContentValid) {
                    if (seg.subQuestionLabel && seg.subQuestionLabel !== currentHeader && seg.subQuestionLabel !== 'main') {
                        const canonicalHeader = combineQuestionAndPart(baseQNum, seg.subQuestionLabel);
                        promptMainWork += `\n[SUB-QUESTION ${canonicalHeader}]\n`;
                        currentHeader = seg.subQuestionLabel;
                    }

                    // 🛡️ [OMNI-PRESENT SOURCE FIX]: 
                    // Explode [DRAWING] blocks into page-specific IDs if the question spans multiple pages.
                    if (clean === '[DRAWING]' && seg.subQuestionLabel) {
                        const fullLabel = combineQuestionAndPart(baseQNum, seg.subQuestionLabel);

                        const zones = globalZones[fullLabel];
                        if (zones && zones.length > 0) {
                            const uniquePages = [...new Set(zones.map((z: any) => z.pageIndex))].sort((a, b) => a - b);
                            if (uniquePages.length > 0) {
                                uniquePages.forEach(pIdx => {
                                    // [FIX]: Strip any existing pX_ prefix to prevent p0_p0_...
                                    const cleanId = seg.line_id.replace(/^p\d+_/, '');
                                    const pageSpecificId = `p${pIdx}_${cleanId}`; // e.g. p2_visual_drawing_11_1
                                    promptMainWork += `[ID: ${pageSpecificId}] [DRAWING]\n`;
                                });
                                return; // Skip default generic line
                            }
                        }
                    }

                    let id = seg.line_id || seg.blockId || seg.sequentialId;


                    promptMainWork += `[ID: ${id}] ${clean}\n`;
                }
            });

            // 🛡️ [OMNI-PRESENT SYNC]: Re-populate aiSegmentationResults with the exploded/relative versions
            const explodedResults: any[] = [];
            group.aiSegmentationResults.forEach((seg: any) => {
                const clean = seg.content.replace(/\s+/g, ' ').trim();
                if (clean === '[DRAWING]' && seg.subQuestionLabel) {
                    const fullLabel = combineQuestionAndPart(baseQNum, seg.subQuestionLabel);

                    const zones = globalZones[fullLabel];
                    if (zones && zones.length > 0) {
                        const uniquePages = [...new Set(zones.map((z: any) => z.pageIndex))].sort((a, b) => a - b);
                        uniquePages.forEach(pIdx => {
                            const cleanId = seg.line_id.replace(/^p\d+_/, '');
                            const newId = `p${pIdx}_${cleanId}`;
                            explodedResults.push({
                                ...seg,
                                line_id: newId,
                                relative_line_id: newId,
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
                    relative_line_id: seg.line_id || seg.blockId
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
                            // [TRUTH-FIRST]: Use the PHYSICAL page index (pIdx) for the block ID.
                            // We construct the block ID preserving the original index bIdx.
                            const absId = `p${pIdx}_ocr_${bIdx}`;

                            // [FIX]: Preserve the original reference that was tagged in Phase 1.6
                            b.pageIndex = pIdx;
                            b.globalBlockId = absId;
                            b.id = absId;
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

            // 🛡️ [STRICT-LOOKUP]: Populate the sub-question page map for downstream safety checks.
            const subQuestionPageMap: Record<string, number[]> = {};
            globalExpectedQuestions.forEach(eq => {
                // [FIX]: Only include questions relevant to the current group (e.g. "1", "1a", "1b")
                const isRelevant = eq.label === baseQNum || (eq.label.startsWith(baseQNum) && isNaN(Number(eq.label.charAt(baseQNum.length))));
                if (!isRelevant) return;

                if (eq.targetPages && eq.targetPages.length > 0) {
                    // Store both full label (3a) and normalized suffix (a) for maximum coverage
                    subQuestionPageMap[eq.label] = eq.targetPages;
                    const suffix = eq.label.replace(/^\d+/, '').toLowerCase();
                    if (suffix && suffix !== eq.label.toLowerCase()) {
                        subQuestionPageMap[suffix] = eq.targetPages;
                        if (suffix.startsWith('.')) {
                            const trimmedSuffix = suffix.substring(1);
                            if (trimmedSuffix) subQuestionPageMap[trimmedSuffix] = eq.targetPages;
                        }
                    }
                }
            });

            // 🛡️ [GENERIC-OCR-BUDGET-RECOVERY]:
            // In Generic Mode, Classification often strips "[ 1 mark ]" from sq.text, leaving subQuestionMaxScores incomplete.
            // Recover exact per-sub-question mark budgets from Mathpix OCR blocks (allOcrBlocks) via PRINTED_INSTRUCTION tags & zones.
            if (group.markingScheme?.isGeneric) {
                const subScores: Record<string, number> = {};
                for (const [k, v] of Object.entries(group.markingScheme.subQuestionMaxScores || {})) {
                    if (Number(v) > 0) subScores[k] = Number(v);
                }

                const markBracketRegex = /(?:\[\s*(\d{1,2})\s*marks?\s*\]|\(\s*(\d{1,2})\s*marks?\s*\)|Total\s*(?:for\s*Question\s*\d+\s*is\s*)?(\d{1,2})\s*marks?)/i;

                // Pass A: Sequential scan of allOcrBlocks using [PRINTED_INSTRUCTION [Q...]] landmarks on each page
                let currentSubLbl: string | null = null;
                let currentSubPage: number | null = null;
                let parentHeaderMarks = 0;
                let inParentHeader = false;

                for (const b of allOcrBlocks) {
                    const txt = String(b.text || '');
                    const tagMatch = txt.match(/\[PRINTED_INSTRUCTION\s*\[Q([^\]]+)\]\]/i);
                    const assocQ = tagMatch ? tagMatch[1] : ((b as any)._associatedQuestion ? String((b as any)._associatedQuestion) : null);
                    if (assocQ) {
                        const rawTag = assocQ.trim().replace(/^0+(?=\d)/, '');
                        if (rawTag === baseQNum) {
                            inParentHeader = true;
                            currentSubLbl = null;
                        } else if (rawTag.startsWith(baseQNum)) {
                            inParentHeader = false;
                            currentSubLbl = rawTag;
                            currentSubPage = b.pageIndex ?? null;
                        }
                    }
                    if (inParentHeader && parentHeaderMarks === 0) {
                        const pm = txt.match(markBracketRegex);
                        const parsedPM = pm ? parseInt(pm[1] || pm[2] || pm[3], 10) : 0;
                        if (parsedPM > 0 && parsedPM <= 30) {
                            parentHeaderMarks = parsedPM;
                        }
                    }
                    if (currentSubLbl && (currentSubPage === null || b.pageIndex === currentSubPage)) {
                        const m = txt.match(markBracketRegex);
                        const parsedM = m ? parseInt(m[1] || m[2] || m[3], 10) : 0;
                        if (parsedM > 0 && parsedM <= 30 && !(subScores[currentSubLbl] > 0)) {
                            subScores[currentSubLbl] = parsedM;
                        }
                    }
                }

                // Pass B: Zone-based fallback for any sub-question still missing its mark
                const subLabelsForQ = Object.keys(subQuestionPageMap).filter(
                    lbl => lbl !== baseQNum && lbl.startsWith(baseQNum) && !lbl.startsWith('.')
                );
                for (const subLbl of subLabelsForQ) {
                    if (subScores[subLbl] > 0) continue;
                    const zones = globalZones?.[subLbl] || [];
                    for (const z of zones) {
                        const zoneBlocks = allOcrBlocks.filter(
                            (b: any) => b.pageIndex === z.pageIndex &&
                                (b.coordinates?.y ?? 0) >= (z.startY ?? 0) - 15 &&
                                (b.coordinates?.y ?? 0) <= (z.endY ?? 99999) + 15
                        );
                        for (const zb of zoneBlocks) {
                            const m = String(zb.text || '').match(markBracketRegex);
                            const parsedM = m ? parseInt(m[1] || m[2] || m[3], 10) : 0;
                            if (parsedM > 0 && parsedM <= 30) {
                                subScores[subLbl] = parsedM;
                                break;
                            }
                        }
                        if (subScores[subLbl] > 0) break;
                    }
                }

                // Pass B2: Parent-zone & pre-sub-question header fallback for parentHeaderMarks
                // (Handles cases where masterLandmarks claimed _associatedQuestion on the parent header block)
                if (parentHeaderMarks === 0) {
                    const parentZones = globalZones?.[baseQNum] || [];
                    for (const z of parentZones) {
                        const zoneBlocks = allOcrBlocks.filter(
                            (b: any) => b.pageIndex === z.pageIndex &&
                                (b.coordinates?.y ?? 0) >= (z.startY ?? 0) - 15 &&
                                (b.coordinates?.y ?? 0) <= (z.endY ?? 99999) + 15
                        );
                        for (const zb of zoneBlocks) {
                            const pm = String(zb.text || '').match(markBracketRegex);
                            const parsedPM = pm ? parseInt(pm[1] || pm[2] || pm[3], 10) : 0;
                            if (parsedPM > 0 && parsedPM <= 30) {
                                parentHeaderMarks = parsedPM;
                                break;
                            }
                        }
                        if (parentHeaderMarks > 0) break;
                    }
                }
                if (parentHeaderMarks === 0 && group.sourceImageIndices?.length > 0) {
                    const firstPageIdx = group.sourceImageIndices[0];
                    let minSubStartY = Infinity;
                    for (const subLbl of subLabelsForQ) {
                        const zones = globalZones?.[subLbl] || [];
                        for (const z of zones) {
                            if (z.pageIndex === firstPageIdx && typeof z.startY === 'number' && z.startY < minSubStartY) {
                                minSubStartY = z.startY;
                            }
                        }
                    }
                    const preSubBlocks = allOcrBlocks.filter(
                        (b: any) => b.pageIndex === firstPageIdx && (b.coordinates?.y ?? 0) < minSubStartY
                    );
                    for (const pb of preSubBlocks) {
                        const pm = String(pb.text || '').match(markBracketRegex);
                        const parsedPM = pm ? parseInt(pm[1] || pm[2] || pm[3], 10) : 0;
                        if (parsedPM > 0 && parsedPM <= 30) {
                            parentHeaderMarks = parsedPM;
                            break;
                        }
                    }
                }
                if (parentHeaderMarks === 0) {
                    parentHeaderMarks = Number((group as any).mainQuestion?.marks || (group as any).mainQuestion?.totalMarks || 0);
                }

                // Pass C: Equal-Split Parent Budget Fallback (e.g. English Q1 "[ 4 marks ]" across 4 MCQ sub-questions 1.1–1.4)
                const distinctFullSubLabels = Array.from(new Set(
                    subLabelsForQ.filter(lbl => /^\d+(\.[a-z0-9]+|[a-z]+)$/i.test(lbl))
                ));
                const anySubHasScore = distinctFullSubLabels.some(lbl => subScores[lbl] > 0);
                const effectiveParentTotal = parentHeaderMarks || Number(group.markingScheme.totalMarks) || 0;
                if (!anySubHasScore && distinctFullSubLabels.length > 0 && effectiveParentTotal > 0 && effectiveParentTotal % distinctFullSubLabels.length === 0) {
                    const markPerSub = effectiveParentTotal / distinctFullSubLabels.length;
                    for (const lbl of distinctFullSubLabels) {
                        subScores[lbl] = markPerSub;
                    }
                }

                // Recompute canonical totalMarks across all distinct full sub-question keys (e.g. "1.1".."1.7")
                const fullSubKeys = Array.from(new Set([
                    ...distinctFullSubLabels,
                    ...Object.keys(subScores).filter(k => k !== baseQNum && k.startsWith(baseQNum))
                ]));

                let recoveredTotal = 0;
                for (const fk of fullSubKeys) {
                    if (subScores[fk] > 0) {
                        recoveredTotal += subScores[fk];
                    }
                }
                if (recoveredTotal === 0 && parentHeaderMarks > 0) {
                    recoveredTotal = parentHeaderMarks;
                }

                group.markingScheme.subQuestionMaxScores = subScores;
                if (recoveredTotal > 0) {
                    group.markingScheme.totalMarks = recoveredTotal;
                    group.markingScheme.parentQuestionMarks = recoveredTotal;
                }
            }

            if (metaPageIndices && metaPageIndices.length > 0) {
                // console.log(` 🏭 [FACTORY-META] Assigning Meta Indices ${metaPageIndices.join(', ')} to task Q${baseQNum}`);
            }
            tasks.push({
                questionNumber: baseQNum,
                questionText: group.mainQuestion.text,
                nextQuestionText: nextQuestionText,
                mathBlocks: allOcrBlocks,
                markingScheme: group.markingScheme,
                sourcePages: group.sourceImageIndices,
                classificationStudentWork: promptMainWork,
                classificationBlocks: group.classificationBlocks,
                isSeparateAnswerSheet: (group.mainQuestion as any)?.isSeparateAnswerSheet,
                allClassificationBlocks: masterLandmarks.filter(l => group.sourceImageIndices.includes(l.pageIndex)),
                pageDimensions: pageDimensionsMap,
                pageContext: siblingsOnSamePages,
                imageData: questionImages[0],
                images: questionImages,
                aiSegmentationResults: group.aiSegmentationResults,
                semanticZones: globalZones,
                pageMap: pageMap,
                subQuestionPageMap: subQuestionPageMap,
                metaPageIndices: metaPageIndices,
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
                        const label = combineQuestionAndPart(String(task.questionNumber), currentPart);
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
                    const label = combineQuestionAndPart(String(task.questionNumber), part);
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
