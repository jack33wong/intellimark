
import { ZoneUtils } from '../../../utils/ZoneUtils.js';
import { sanitizeAiLineId } from '../MarkingHelpers.js';

export class AnnotationLinker {

    /**
     * Faithfully migrates the "Splitting" and "Initial Sanitization" logic.
     * Prevents logic drift by ensuring compound marks (e.g. "M1, A1") are exploded early.
     */
    static preProcess(annotations: any[]): any[] {
        const exploded: any[] = [];
        (annotations || []).forEach((anno: any) => {
            const cleaned = (anno.text || '').replace(/,/g, ' ').trim();
            const parts = cleaned.split(/\s+/);

            if (parts.length > 1 && parts.every(p => /^[A-Z]+\d+$/.test(p))) {
                console.warn(` ⚠️ [CLUMP-SPLIT] Splitting "${anno.text}" into ${parts.length} atoms early.`);
                parts.forEach(part => {
                    exploded.push({
                        ...anno,
                        text: part,
                        ocr_match_status: anno.ocr_match_status,
                        line_id: anno.line_id?.startsWith('visual_redirect_')
                            ? `${anno.line_id}_${Math.random().toString(36).substr(2, 5)}`
                            : (anno.line_id || anno.lineId)
                    });
                });
            } else {
                exploded.push(anno);
            }
        });
        return exploded;
    }

    /**
     * Faithfully migrates "resolveLinksWithZones" (The Normalizer).
     */
    static resolveLinksWithZones(
        annotations: any[],
        semanticZones: Record<string, any[]>,
        allOcrBlocks: any[],
        vetoList: string[],
        questionNumber: string,
        stepsDataForMapping: any[],
        pageDimensionsMap?: Map<number, { width: number; height: number }>,
        allLabels: string[] = []
    ): any[] {
        // [DEBUG-VETO-CHECK-FINAL]: What exactly does p0_ocr_0 look like here?
        const debugBlock = allOcrBlocks.find(b => b.id === 'p0_ocr_0');
        if (debugBlock) {
            console.log(` 🕵️ [LINKER-INPUT-DEBUG-FINAL] p0_ocr_0 Content: "${debugBlock.text}"`);
            console.log(` 🕵️ [LINKER-INPUT-DEBUG-FINAL] p0_ocr_0 Has Tag? ${(debugBlock.text || '').includes('PRINTED_INSTRUCTION')}`);
        }

        return annotations.map(anno => {
            if (!(anno as any).ai_raw_status) (anno as any).ai_raw_status = anno.ocr_match_status;

            const hasId = anno.linked_ocr_id || anno.linkedOcrId;
            if (anno.ocr_match_status === "MATCHED" && !hasId) {
                anno.ocr_match_status = "UNMATCHED";
            }

            const primaryPage = (anno as any).pageIndex ?? 0;
            // [FIX] Try exact match first ("a"), then composite match ("5a")
            let zoneData = this.getEffectiveZone(anno.subQuestion, semanticZones, primaryPage);
            if (!zoneData) {
                const compositeKey = `${questionNumber}${anno.subQuestion}`;
                zoneData = this.getEffectiveZone(compositeKey, semanticZones, primaryPage);
            }

            let physicalId = anno.linked_ocr_id || anno.linkedOcrId;

            const lineId = anno.line_id || anno.lineId;
            const sourceStep = stepsDataForMapping.find(s => s.line_id === lineId || s.globalBlockId === lineId);
            const realStudentContent = sourceStep ? sourceStep.text : (anno.text || anno.studentText || "");

            if (anno.ocr_match_status === "UNMATCHED" && zoneData && (anno.line_id || anno.lineId)) {
                const targetText = this.normalizeForRescue(realStudentContent);
                const isTooShort = targetText.length < 2;
                const isRiskOfFalsePositive = targetText.length < 4 && /^[a-z]?[0-9]+$/.test(targetText);

                if (!isTooShort && !isRiskOfFalsePositive) {
                    const candidates = allOcrBlocks.filter(b => {
                        const bY = b.coordinates?.y ?? b.bbox?.[1];
                        if (bY === undefined || !ZoneUtils.isPointInZone(bY, zoneData, 0)) return false;

                        const bTextNorm = this.normalizeForMatching(b.text || "");
                        for (const vetoItem of vetoList) {
                            if (vetoItem.length < 2) continue;
                            if (vetoItem.includes(bTextNorm) || bTextNorm.includes(vetoItem)) {
                                console.log(` 🚫 [VETO-REJECT] Candidate "${b.text}" matches Veto "${vetoItem}"`);
                                return false;
                            }
                        }

                        const bText = this.normalizeForRescue(b.text || "");
                        const ocrContainsStudent = bText.includes(targetText);
                        const studentContainsOcr = targetText.includes(bText) && bText.length > 3;
                        return ocrContainsStudent || studentContainsOcr;
                    });

                    if (candidates.length > 0) {
                        let bestBlock = candidates[0];
                        if (candidates.length > 1) {
                            const aiY = sourceStep?.bbox?.[1] || sourceStep?.position?.y || 0;
                            bestBlock = candidates.sort((a, b) => {
                                const yA = a.coordinates?.y || 0;
                                const yB = b.coordinates?.y || 0;
                                return Math.abs(yA - aiY) - Math.abs(yB - aiY);
                            })[0];
                        }
                        console.log(` 🧲 [LINKER-RESCUE] ${anno.subQuestion}: Snapped UNMATCHED "${realStudentContent}" to Block ${bestBlock.id}`);
                        physicalId = bestBlock.id;
                        anno.linked_ocr_id = bestBlock.id;
                        anno.ocr_match_status = "MATCHED";
                        anno.pageIndex = bestBlock.pageIndex;
                    }
                }
            }

            if (physicalId && zoneData) {
                const block = allOcrBlocks.find(b => b.id === physicalId);
                if (block) {
                    const markY = block.coordinates?.y ?? block.bbox?.[1];
                    const isHeader = (physicalId === (zoneData as any).headerBlockId);

                    const blockTextNorm = this.normalizeForMatching(block.text);
                    let isClassificationText = false;

                    let isInstructionTag = (block.text || '').includes('[PRINTED_INSTRUCTION');
                    let isQuestionLabel = false;
                    if (block.isHandwritten !== true) {
                        const cleanBlockText = (block.text || '').replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
                        const trapLabels = allLabels.map(l => l.replace(/[^0-9a-zA-Z]/g, '').toLowerCase());
                        if (trapLabels.some(l => cleanBlockText === l || cleanBlockText === `q${l}`)) {
                            isQuestionLabel = true;
                        }
                        if (block.text && block.text.includes('[PRINTED_INSTRUCTION')) {
                            isInstructionTag = true;
                        }
                    }

                    let isVetoed = false;
                    for (const vetoItem of vetoList) {
                        if (vetoItem.length < 3) continue;
                        if (vetoItem.includes(blockTextNorm) || blockTextNorm.includes(vetoItem)) {
                            isVetoed = true;
                            break;
                        }
                    }

                    if (isHeader || isClassificationText || isQuestionLabel || isInstructionTag || isVetoed) {
                        console.log(` 🚫 [SEMANTIC-VETO] Q${anno.subQuestion}: Detaching from "${block.text}" (Tag=${isInstructionTag}, Veto=${isVetoed})`);
                        physicalId = null;
                        anno.linked_ocr_id = null;
                        anno.ocr_match_status = "UNMATCHED";
                    } else if (markY !== null) {
                        // --- IRON DOME VETOES ---
                        const inZone = ZoneUtils.isPointInZone(markY, zoneData, 0);

                        // 1. [NUMERICAL FIDELITY VETO]: 
                        // If student work contains numbers (e.g. "16.1"), verify the block contains AT LEAST one of them.
                        // Helps prevent "16.1" being linked to Page Number "2".
                        let fidelityVeto = false;
                        if (block.isHandwritten !== true && !isInstructionTag) {
                            const studentNums = (realStudentContent || '').match(/\d+(\.\d+)?/g) || [];
                            const blockNums = (block.text || '').match(/\d+(\.\d+)?/g) || [];

                            if (studentNums.length > 0 && blockNums.length > 0) {
                                const hasOverlap = studentNums.some(sn => blockNums.some(bn => bn === sn || bn.includes(sn) || sn.includes(bn)));
                                if (!hasOverlap) {
                                    console.log(` 🛡️ [FIDELITY-VETO] ${anno.subQuestion}: Student has "${studentNums.join(',')}", but Block has "${blockNums.join(',')}". Rejecting Hallucination.`);
                                    fidelityVeto = true;
                                }
                            }
                        }

                        // 2. [EXTREME MARGIN VETO]:
                        // Reject short numeric printed blocks in the top/bottom 5% (likely page numbers).
                        let marginVeto = false;
                        if (pageDimensionsMap && block.isHandwritten !== true && !isInstructionTag) {
                            const dims = pageDimensionsMap.get(block.pageIndex ?? primaryPage);
                            if (dims && dims.height > 0) {
                                const relY = markY / dims.height;
                                const isShortNumeric = /^\d+$/.test((block.text || '').trim()) && block.text.length < 3;
                                if (isShortNumeric && (relY < 0.05 || relY > 0.95)) {
                                    console.log(` 🛡️ [MARGIN-VETO] ${anno.subQuestion}: Naked digit "${block.text}" at RelY=${relY.toFixed(3)} is likely a page number. Rejecting.`);
                                    marginVeto = true;
                                }
                            }
                        }

                        const isVisualPlaceholder = (block.text || '').includes('VISUAL') || physicalId.includes('visual');
                        const isNextPage = (block.pageIndex === (zoneData.pageIndex + 1));

                        if (fidelityVeto || marginVeto || (!inZone && !(isVisualPlaceholder && isNextPage))) {
                            const snippet = (block.text || '').substring(0, 20).replace(/\n/g, ' ');
                            const reason = fidelityVeto ? "Fidelity" : (marginVeto ? "Margin" : "Zone");
                            console.log(` ⚖️ [IRON-DOME-VETO] ${anno.subQuestion}: Block "${snippet}" (ID ${physicalId}) rejected [${reason}].`);
                            anno.ocr_match_status = "UNMATCHED";
                            anno.linked_ocr_id = null;
                        }
                    }
                }
            }

            return anno;
        });
    }

    /**
     * Faithfully migrates the Path 3 recovery, Staggering, Iron Dome Snap, and Fuzzy Recovery.
     */
    static postProcess(
        annotations: any[],
        stepsDataForMapping: any[],
        task: any,
        semanticZones: any,
        pageDimensionsMap?: Map<number, { width: number; height: number }>
    ): any[] {
        const unmatchedLineUsage: Record<string, number> = {};

        return annotations.map(anno => {
            const currentId = sanitizeAiLineId(anno.line_id || anno.lineId || "");
            anno.line_id = currentId;

            const sourceStep = stepsDataForMapping.find(s => s.line_id === currentId || s.globalBlockId === currentId);

            const isDrawingLine = sourceStep?.text === '[DRAWING]' || (sourceStep as any)?.content === '[DRAWING]' || (sourceStep as any)?.source === 'system-injection';

            if (sourceStep && sourceStep.pageIndex !== undefined && !isDrawingLine) {
                if (anno.pageIndex !== sourceStep.pageIndex) anno.pageIndex = sourceStep.pageIndex;
            } else if (task.sourcePages?.length === 1 && !isDrawingLine) {
                anno.pageIndex = task.sourcePages[0];
            }

            // Path 3: UNMATCHED Position Recovery & Staggering
            if (anno.ocr_match_status === 'UNMATCHED') {
                if (sourceStep && (sourceStep.bbox || (sourceStep as any).position)) {
                    const box: any = sourceStep.bbox || (sourceStep as any).position;
                    let x = box.x !== undefined ? box.x : box[0];
                    let y = box.y !== undefined ? box.y : box[1];
                    let w = box.width !== undefined ? box.width : box[2];
                    let h = box.height !== undefined ? box.height : box[3];

                    const isNormalized = x <= 1 && y <= 1 && w <= 1 && h <= 1 && (x > 0 || y > 0);
                    if (isNormalized) { x *= 100; y *= 100; w *= 100; h *= 100; }

                    const usageKey = currentId;
                    const usageCount = unmatchedLineUsage[usageKey] || 0;
                    unmatchedLineUsage[usageKey] = usageCount + 1;
                    const staggerAmount = isNormalized ? 2 : 15;
                    const staggerX = usageCount * staggerAmount;

                    console.log(` 📍 [PATH 3] Q${anno.subQuestion}: Line "${currentId}" is UNMATCHED. Recovering position.`);
                    anno.visual_position = {
                        x: x + (w / 2) + staggerX,
                        y: y + (h / 2),
                        width: isNormalized ? 2 : 10,
                        height: isNormalized ? 2 : 10
                    };
                }
            }

            // Iron Dome Page Snap
            const validZones = (semanticZones && semanticZones[anno.subQuestion]) || [];
            const validPageIndices = validZones.map((z: any) => z.pageIndex);

            if (validPageIndices.length > 0 && !validPageIndices.includes(anno.pageIndex ?? 1000)) {
                const targetZone = validZones.sort((a: any, b: any) => a.pageIndex - b.pageIndex)[0];
                if (targetZone) {
                    const isVisual = (anno.ocr_match_status === 'VISUAL') ||
                        (anno.line_id === null) ||
                        (anno.text && ['M1', 'A1', 'B1', 'B2', 'B3'].includes(anno.text));

                    if (isVisual) {
                        console.log(` 🧲 [IRON-DOME-PATCH] Snapping Q${anno.subQuestion} from P${anno.pageIndex} -> P${targetZone.pageIndex}`);
                        anno.pageIndex = targetZone.pageIndex;
                    }
                }
            }

            // Fuzzy Printed Recovery
            const isPrinted = !sourceStep || sourceStep.isHandwritten === false;
            if (isPrinted) {
                const isDrawing = (anno as any).ocr_match_status === 'VISUAL' || (anno.text || '').includes('[DRAWING]') || (anno.reasoning && (anno.reasoning.includes('[DRAWING]') || anno.reasoning.includes('plan')));
                if (!isDrawing) {
                    const targetText = this.normalizeForRescue(anno.studentText || anno.text || "");
                    if (targetText.length > 0) {
                        let betterMatch = stepsDataForMapping.find(s =>
                            s.line_id.startsWith('block_') && s.isHandwritten !== false && this.normalizeForRescue(s.text) === targetText
                        ) || stepsDataForMapping.find(s =>
                            s.line_id.startsWith('block_') && s.isHandwritten !== false && this.normalizeForRescue(s.text).includes(targetText)
                        );
                        if (!betterMatch) {
                            const numbers = targetText.match(/\d+/g);
                            if (numbers && numbers.length > 0) {
                                betterMatch = stepsDataForMapping.find(s =>
                                    s.line_id.startsWith('block_') && s.isHandwritten !== false && numbers.every(n => this.normalizeForRescue(s.text).includes(n))
                                );
                            }
                        }
                        if (betterMatch) {
                            (anno as any).aiMatchedId = currentId;
                            anno.line_id = betterMatch.line_id;
                            anno.pageIndex = betterMatch.pageIndex;
                        }
                    }
                }
            }

            return anno;
        });
    }

    public static normalizeForMatching(text: string): string {
        if (!text) return "";
        return text.toLowerCase().replace(/\\[a-zA-Z]+/g, ' ').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    }

    public static normalizeForRescue(text: string): string {
        if (!text) return "";
        return text.toLowerCase().replace(/\s+/g, '').replace(/\\times/g, 'x').replace(/×/g, 'x').replace(/\*/g, 'x').replace(/[^a-z0-9.]/g, '');
    }

    public static getEffectiveZone(subQuestion: string, zonesMap: any, pageIndex: number) {
        const list = zonesMap[subQuestion];
        if (!list || list.length === 0) return null;
        const pageZones = list.filter((z: any) => z.pageIndex === pageIndex);
        if (pageZones.length === 0) return list[0];
        if (pageZones.length === 1) return pageZones[0];
        const startY = Math.min(...pageZones.map((z: any) => z.startY));
        const endY = Math.max(...pageZones.map((z: any) => z.endY));
        return { ...pageZones[0], startY, endY };
    }
}
