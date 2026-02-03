import { SimilarityService } from './SimilarityService.js';
import { CoordinateTransformationService } from './CoordinateTransformationService.js';
import { ZoneUtils } from '../../utils/ZoneUtils.js';

// 🛡️ [CRITICAL FIX] STRICT TEXT SANITIZER
// Removes ALL numbers and symbols. Keeps ONLY words.
export function normalizeText(text: string): string[] {
    if (!text) return [];
    return text
        .replace(/\\[a-zA-Z]+/g, ' ')       // Strip LaTeX commands
        .replace(/[^a-zA-Z\s]/g, '')        // 🚨 DELETE ALL NUMBERS (0-9) AND SYMBOLS
        .toLowerCase()
        .split(/\s+/)
        .filter(t => t.length > 2);         // Only keep words > 2 chars
}

export function verifyStrictMatch(dbText: string, ocrText: string): boolean {
    if (!dbText || !ocrText) return false;

    const dbTokens = normalizeText(dbText).slice(0, 15); // Fingerprint
    const ocrTokens = normalizeText(ocrText);

    if (dbTokens.length === 0) return false;

    const matches = dbTokens.filter(t => ocrTokens.includes(t));
    const confidence = matches.length / dbTokens.length;

    // 🎯 STRICT THRESHOLD: 40% Word Overlap Required
    return confidence >= 0.4;
}

export function verifyMatch(dbText: string, ocrText: string): boolean {
    return verifyStrictMatch(dbText, ocrText);
}

export class MarkingZoneService {

    /**
     * Calculates the global offset (x, y) for a question based on classification blocks,
     * landmarks, and question detection boxes.
     */
    public static calculateGlobalOffset(
        questionDetection: any[],
        targetQuestionObject: any,
        inputQuestionNumber: string,
        rawOcrBlocks: any[],
        processedImage: any
    ): { offsetX: number; offsetY: number } {
        let offsetX = 0;
        let offsetY = 0;

        // 1. [LEGACY REMOVED]: We no longer use raw classification blocks for offset.
        // We rely on Question Detection (Global) or Landmarks (Local) exclusively.

        // 2. Fallback: Question Detection (Global Position)
        if ((offsetX === 0 && offsetY === 0) && targetQuestionObject) {
            let qBox = targetQuestionObject.region || targetQuestionObject.box || targetQuestionObject.rect || targetQuestionObject.coordinates;
            // PARENT FALLBACK
            if (!qBox && questionDetection && Array.isArray(questionDetection)) {
                const currentBase = String(inputQuestionNumber).replace(/[a-z]/i, '');
                const parentQ = questionDetection.find((q: any) => String(q.questionNumber) === currentBase);
                if (parentQ) {
                    qBox = parentQ.box || parentQ.region || parentQ.rect || parentQ.coordinates;
                }
            }
            if (qBox) {
                const pixelBox = CoordinateTransformationService.ensurePixels(qBox, 2000, 3000, `OFFSET-DETECTION`);
                offsetX = pixelBox.x;
                offsetY = pixelBox.y;
            }
        }

        // 3. Landmark / Zone Detection (Hierarchical Fallback)
        if (offsetX === 0 && offsetY === 0) {
            const landmarks = (processedImage as any).landmarks || (processedImage as any).zones;
            const subQ = String(inputQuestionNumber || '').replace(/^\d+/, '').toLowerCase();

            if (landmarks && Array.isArray(landmarks)) {
                let match = landmarks.find((l: any) =>
                    (l.label && l.label.toLowerCase() === subQ && subQ !== "") ||
                    (l.label && l.label.toLowerCase() === inputQuestionNumber?.toLowerCase()) ||
                    (l.text && l.text.toLowerCase().includes(`(${subQ})`) && subQ !== "")
                );

                // Hierarchical "First Child" Fallback
                if (!match && landmarks.length > 0) {
                    const isRootQuery = subQ === "" || subQ === inputQuestionNumber?.toLowerCase();
                    if (isRootQuery) {
                        const firstL = landmarks[0];
                        const label = (firstL.label || "").toLowerCase();
                        if (["a", "i", "1"].includes(label)) {
                            match = firstL;
                        }
                    }
                }

                if (match) {
                    const pixelBox = CoordinateTransformationService.ensurePixels(match, 2000, 3000, `OFFSET-LANDMARK`);
                    offsetX = pixelBox.x;
                    offsetY = pixelBox.y;
                }
            }
        }

        // 4. "Smart Sub-Question Anchor" (OCR Block Fallback)
        if (offsetX === 0 && offsetY === 0 && rawOcrBlocks && rawOcrBlocks.length > 0) {
            const subQ = String(inputQuestionNumber || '').replace(/^\d+/, '');
            const baseQ = String(inputQuestionNumber || '').replace(/\D/g, '');
            const subQRegex = new RegExp(`^\\(?${subQ}[).]?`, 'i');
            const baseQRegex = new RegExp(`^Q?${baseQ}[.:]?`, 'i');

            let anchorBlock = rawOcrBlocks.find((b: any) => subQ && subQRegex.test(b.text));
            if (!anchorBlock) {
                anchorBlock = rawOcrBlocks.find((b: any) => baseQ && baseQRegex.test(b.text));
            }
            if (!anchorBlock) anchorBlock = rawOcrBlocks[0];

            if (anchorBlock) {
                const bCoords = anchorBlock.coordinates || anchorBlock.box || anchorBlock.geometry?.boundingBox;
                if (bCoords) {
                    const pixelBox = CoordinateTransformationService.ensurePixels(bCoords, 2000, 3000, `OFFSET-ANCHOR`);
                    offsetX = pixelBox.x;
                    offsetY = pixelBox.y;
                }
            }
        }

        return { offsetX, offsetY };
    }

    public static globalizeStudentWorkLines(
        classificationBlocks: any[],
        landmarks: any[],
        cleanDataForMarking: any,
        globalOffsetX: number,
        globalOffsetY: number
    ): Array<{ text: string; position: { x: number; y: number; width: number; height: number } }> {
        let studentWorkLines: Array<{ text: string; position: { x: number; y: number; width: number; height: number } }> = [];

        if (classificationBlocks && classificationBlocks.length > 0) {
            classificationBlocks.forEach((block: any) => {
                let blockOffsetX = globalOffsetX;
                let blockOffsetY = globalOffsetY;

                const blockText = (block.text || "").toLowerCase();
                const blockMatch = landmarks.find((l: any) =>
                    blockText.includes(`(${l.label?.toLowerCase()})`) ||
                    blockText.includes(`${l.label?.toLowerCase()})`)
                );

                if (blockMatch) {
                    blockOffsetX = blockMatch.x || blockMatch.left || 0;
                    blockOffsetY = blockMatch.y || blockMatch.top || 0;
                }

                const passThroughLine = (line: any) => {
                    if (!line.position) {
                        return {
                            ...line,
                            position: { x: blockOffsetX, y: blockOffsetY, width: 100, height: 40 }
                        };
                    }
                    const pos = line.position;
                    const dims = { width: 2000, height: 3000 };
                    const pixelBox = CoordinateTransformationService.ensurePixels(pos, dims.width, dims.height, `GLOBAL-LINE`);

                    return {
                        ...line,
                        position: {
                            x: pixelBox.x + blockOffsetX,
                            y: pixelBox.y + blockOffsetY,
                            width: pixelBox.width,
                            height: pixelBox.height
                        }
                    };
                };

                if (block.studentWorkLines && Array.isArray(block.studentWorkLines)) {
                    studentWorkLines = studentWorkLines.concat(block.studentWorkLines.map(passThroughLine));
                }
                if (block.subQuestions && Array.isArray(block.subQuestions)) {
                    block.subQuestions.forEach((sq: any) => {
                        if (sq.studentWorkLines) {
                            studentWorkLines = studentWorkLines.concat(sq.studentWorkLines.map(passThroughLine));
                        }
                    });
                }
            });
        } else if (cleanDataForMarking.steps && Array.isArray(cleanDataForMarking.steps)) {
            studentWorkLines = cleanDataForMarking.steps.map((step: any) => {
                if (!step.box && !step.position) return null;
                const pos = step.box || step.position;
                return {
                    text: step.text,
                    position: {
                        x: pos.x + globalOffsetX,
                        y: pos.y + globalOffsetY,
                        width: pos.width,
                        height: pos.height
                    }
                };
            }).filter((s: any) => s !== null);
        }

        return studentWorkLines;
    }

    public static refineZones(semanticZones: Record<string, any[]>): Record<string, any[]> {
        // 1. MERGE ZONES (Combine segments on same page)
        Object.keys(semanticZones).forEach(key => {
            const zones = semanticZones[key];
            const mergedZones: any[] = [];
            const byPage: Record<number, any[]> = {};
            zones.forEach(z => {
                if (!byPage[z.pageIndex]) byPage[z.pageIndex] = [];
                byPage[z.pageIndex].push(z);
            });
            Object.keys(byPage).forEach(pIdxStr => {
                const pIdx = Number(pIdxStr);
                const pageZones = byPage[pIdx];
                if (pageZones.length > 1) {
                    const startY = Math.min(...pageZones.map(z => z.startY));
                    const endY = Math.max(...pageZones.map(z => z.endY));
                    mergedZones.push({ ...pageZones[0], startY, endY });
                } else {
                    mergedZones.push(pageZones[0]);
                }
            });
            semanticZones[key] = mergedZones;
        });

        // 2. TIGHTEN OVERLAPS (Mutual Push-Pull)
        const allLabels = Object.keys(semanticZones);
        const zonesByPage: Record<number, any[]> = {};
        allLabels.forEach(lbl => {
            semanticZones[lbl].forEach(z => {
                if (!zonesByPage[z.pageIndex]) zonesByPage[z.pageIndex] = [];
                zonesByPage[z.pageIndex].push(z);
            });
        });

        Object.keys(zonesByPage).forEach(pIdxStr => {
            const pIdx = Number(pIdxStr);
            const pageList = zonesByPage[pIdx];
            pageList.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
            for (let i = 0; i < pageList.length - 1; i++) {
                const current = pageList[i];
                const next = pageList[i + 1];
                if (next.startY < current.endY) {
                    console.log(` ⚖️ [ZONE-TIGHTEN] Pulling Q${current.label} endY from ${current.endY} up to Q${next.label} startY (${next.startY})`);
                    current.endY = next.startY;
                }
            }
        });

        return semanticZones;
    }

    public static detectSemanticZones(
        rawBlocks: any[],
        pageDimensionsMap: Map<number, { width: number; height: number }>,
        expectedQuestions?: Array<{ label: string; text: string; targetPage?: number }>,
        nextQuestionText?: string,
        questionId?: string
    ) {
        // Output structure
        const zones: Record<string, Array<{ label: string; startY: number; endY: number; pageIndex: number; x: number; headerBlockId?: string }>> = {};

        if (!rawBlocks || !expectedQuestions) return zones;

        // 1. Sort blocks strictly by Page and then Y
        const sortedBlocks = [...rawBlocks].sort((a, b) => {
            const pageIdA = a.pageId || `idx_${a.pageIndex || 0}`;
            const pageIdB = b.pageId || `idx_${b.pageIndex || 0}`;

            const pageDiff = (a.pageIndex || 0) - (b.pageIndex || 0);
            if (pageDiff !== 0) return pageDiff;
            return MarkingZoneService.getY(a) - MarkingZoneService.getY(b);
        });

        const distinctPages = [...new Set(sortedBlocks.map(b => b.pageIndex || 0))].sort((a, b) => a - b);
        console.log(`[ZONE-SORT] 🏆 Physical Page Order: ${distinctPages.join(' -> ')}`);

        let minSearchY = 0;
        let currentSearchPage = sortedBlocks[0]?.pageIndex || 0;
        const detectedLandmarks: Array<{ key: string; label: string; startY: number; pageIndex: number; x: number; headerBlockId?: string }> = [];

        // 2. Find Zone STARTS (Sequential Logic)
        for (let qIdx = 0; qIdx < expectedQuestions.length; qIdx++) {
            const eq = expectedQuestions[qIdx];
            const nextEq = expectedQuestions[qIdx + 1];

            let finalKey = eq.label;
            if (questionId && !eq.label.startsWith(questionId)) {
                finalKey = `${questionId}${eq.label}`;
            }

            const match = this.findBestBlockSequential(
                sortedBlocks,
                eq.label,
                eq.text,
                currentSearchPage,
                minSearchY,
                `Start-${finalKey}`,
                pageDimensionsMap, // Pass the map
                nextEq?.label,
                nextEq?.targetPage,
                eq.targetPage,
                nextEq?.text // [FIX]: Pass the Expected Text for Stopper Verification
            );

            if (match) {
                // [FIX]: Tag this block as a confirmed Instruction (Header)
                // This allows MarkingInstructionService to safely append [PRINTED_INSTRUCTION] without risky text matching.
                match.block._isInstruction = true;

                const blockY = MarkingZoneService.getY(match.block);
                const pDims = pageDimensionsMap.get(match.block.pageIndex) || { width: 2480, height: 3508 };
                const pH = pDims.height || 3508;

                // 🔴 [RED-ALERT]: Log if the FIRST question on a page is found in the top half (< 50%)
                const isFirstOnPage = !detectedLandmarks.some(l => l.pageIndex === match.block.pageIndex);
                if (isFirstOnPage && blockY < (pH * 0.5)) {
                    // console.log(`\x1b[31m 🚩 [TOP-HALF-ANCHOR] Question ${finalKey} found at Y=${blockY} (${((blockY / pH) * 100).toFixed(1)}%) on Page ${match.block.pageIndex} \x1b[0m`);
                }

                detectedLandmarks.push({
                    key: finalKey,
                    label: eq.label,
                    startY: blockY,
                    pageIndex: match.block.pageIndex,
                    x: 75, // [FIX]: Default placeholder, will be refined per-page later
                    headerBlockId: match.block.id || match.block.globalBlockId
                });

                currentSearchPage = match.block.pageIndex;
                // [FIX]: Don't increment Y strictly. Sub-questions (2a) often share a line with their parent (2).
                minSearchY = MarkingZoneService.getY(match.block);
            } else {
                console.log(`[ZONE-MISS] ⚠️ Question ${finalKey} could not be anchored. Exhausted search from P${currentSearchPage}@${minSearchY}`);
            }
        }

        // 3. Find Zone ENDS (TVC Logic)
        // 🛡️ Total Vertical Coverage: "First owns the top, Last owns the bottom"
        // 🏰 [DETETERMINISTIC FIX]: Sort landmarks by physical vertical order.
        // This prevents the current marked question from "stealing" the Top slot
        // if it's physically lower than its neighbors.
        detectedLandmarks.sort((a, b) => {
            const pageDiff = (a.pageIndex || 0) - (b.pageIndex || 0);
            if (pageDiff !== 0) return pageDiff;
            return a.startY - b.startY;
        });

        // 🏰 [ABSORPTION FIX]: First Sub-question absorbs Main Intro
        // If "14" and "14a" are on the same page, "14" is likely just a header/intro.
        // We absorb "14" into "14a" so "14a" can own the top of the page (and any graphs there).
        const absorbedIndices = new Set<number>();
        for (let i = 0; i < detectedLandmarks.length - 1; i++) {
            const current = detectedLandmarks[i];
            const next = detectedLandmarks[i + 1];

            if (next.pageIndex === current.pageIndex) {
                const mainClean = current.key.replace(/\D/g, '');
                // Check if 'current' is purely numeric (e.g. "14")
                if (mainClean && current.key === mainClean) {
                    // Check if 'next' is a subpart of 'current' (e.g. "14a")
                    if (next.key.startsWith(mainClean) && next.key.length > mainClean.length) {
                        const suffix = next.key.substring(mainClean.length).toLowerCase().replace(/[^a-z0-9]/g, '');
                        // suffix 'a', '1', 'ai', 'i' etc implies first part
                        if (['a', '1', 'ai', 'i', 'parta'].includes(suffix)) {
                            // 🏰 [ABSORB-TRANSFER]: Transfer parent's startY to the sub-question
                            // Ensure the child question starts where the intro/group-header began.
                            next.startY = Math.min(next.startY, current.startY);
                            // console.log(`[ZONE-ABSORB] Q${next.key} absorbing Main Q${current.key} on P${current.pageIndex}. New StartY: ${next.startY}`);
                            absorbedIndices.add(i);
                        }
                    }
                }
            }
        }

        const finalLandmarks = detectedLandmarks.filter((_, idx) => !absorbedIndices.has(idx));
        // console.log(`[ZONE-TVC] Deterministic Order (Post-Absorb): ${finalLandmarks.map(l => `${l.key}(P${l.pageIndex}@${l.startY})`).join(' -> ')}`);

        const pagesWithFirstLandmark = new Set<number>();

        for (let i = 0; i < finalLandmarks.length; i++) {
            const current = finalLandmarks[i];
            const next = finalLandmarks[i + 1];

            // 🏗️ SMART MARGIN: Instead of snapping to 0, use a 150px safety buffer.
            // This catches "Answer ALL questions" without coveting the very top of the page.
            const dims = pageDimensionsMap.get(current.pageIndex) || Array.from(pageDimensionsMap.values())[0] || { width: 2480, height: 3508 };
            const pW = dims.width || 2480;
            const pH = dims.height || 3508;
            const vMargin = Math.floor(pH * 0.06);

            // 🏗️ [ZERO MARGIN FIX]: Zone starts EXACTLY at the question text landmark.
            // No safety buffers, no forced "Top-of-Page" ownership.
            let finalStartY = current.startY;

            // 🏗️ [Q1 TOP-FILL]: For the very first question in the paper,
            // capture any instructions/preamble orphans at the top of the page.
            if (i === 0 && finalStartY > vMargin) {
                // console.log(`🏗️ [Q1-TOP-FILL] Stretching Q${current.key} from ${finalStartY} to ${vMargin} (Page ${current.pageIndex})`);
                finalStartY = vMargin;
            }

            pagesWithFirstLandmark.add(current.pageIndex); // Maintain for potential logic tracking elsewhere

            let endY = pH; // Start at full page, only apply margin if it stays at full page

            if (next && next.pageIndex === current.pageIndex) {
                // Inter-question gap filling (Snap to start of next question)
                // [FIX]: "Don't touch the middle zone" - No vMargin for inter-question boundaries
                endY = next.startY;
            }
            else {
                // 🛡️ [SIMPLE DESIGN]: Last question on a page owns the bottom (6% margin).
                // We no longer search for fragile text-based "Total" stoppers.
                endY = pH - vMargin;
            }

            if (!zones[current.key]) zones[current.key] = [];

            // 🏛️ UNIVERSAL SLICE DESIGN (Bible 7.4)
            // We ignore detected widths. A Zone is ALWAYS a horizontal strip.
            // This ensures deterministic coverage for handwriting that drifts horizontally.
            // [FIX]: Update Margin to 6% (User Request)
            const horizontalMargin = Math.floor(pW * 0.06);
            const minHeight = 100;

            // [FIX]: Only apply BOTTOM margin (6%) if the zone naturally ends at the page boundary.
            let finalEndY = endY;
            if (finalEndY >= pH - 20) {
                finalEndY = pH - vMargin;
            }
            finalEndY = Math.max(finalEndY, finalStartY + minHeight);

            zones[current.key].push({
                label: current.key,
                startY: finalStartY,
                endY: finalEndY,
                startYPercent: (finalStartY / pH) * 100,
                endYPercent: (finalEndY / pH) * 100,
                pageIndex: current.pageIndex,
                x: horizontalMargin,
                width: pW - (horizontalMargin * 2),
                origW: pW,
                origH: pH
            } as any);
        }

        // =====================================================================
        // 🛡️ UPSTREAM FIX: MULTI-PAGE ZONE BACKFILL
        // Goal: If Q11b is on Page 0, but Q11c starts on Page 1, 
        //       we MUST create a zone for 11b on Page 1 to catch the graph.
        // =====================================================================

        // Iterate through the landmarks we found
        for (let i = 0; i < finalLandmarks.length; i++) {
            const current = finalLandmarks[i];
            const next = finalLandmarks[i + 1];

            // 🏰 [FIX]: Only bridge if the question actually reached the bottom of its current page.
            // If it was stopped by a "Total" marker, it should not leak into the next page.
            const qZones = zones[current.key];
            const lastZone = qZones ? qZones[qZones.length - 1] : null;
            let stoppedEarly = false;

            if (lastZone) {
                const pDimsThis = pageDimensionsMap.get(lastZone.pageIndex) || { width: 2480, height: 3508 };
                const vMarginThis = Math.floor((pDimsThis.height || 3508) * 0.06);
                // If endY is significantly less than (pageHeight - margin), it stopped early.
                stoppedEarly = lastZone.endY < (pDimsThis.height - vMarginThis - 100);
            }

            if (next && next.pageIndex > current.pageIndex) {
                const nextPDims = pageDimensionsMap.get(next.pageIndex) || { width: 2480, height: 3508 };
                const nextPH = nextPDims.height || 3508;
                // 🌉 [GAP-BASED BRIDGE]: 
                // Trigger bridge if there is a LARGE GAP (> 15%) above the first question on the second page.
                // This captures graphs/tables (like Q11 CF Graph) without false positives on tight packing.
                const hasLargeGapAbove = next.startY > (nextPH * 0.15);

                // 🏰 [ANTI-LEAK]: Forbid bridging if the question stopped early (Total marker found)
                if (hasLargeGapAbove && !stoppedEarly) {

                    // 🛡️ [NEXT-HEADER-PROTECTION]: Check if the "Next" question's label exists at the top-left of this page.
                    // If it does, then Page X truly belongs to 'Next', and 'Current' shouldn't bridge into it.
                    // This specifically fixes the "Q13 Drawer Grid" problem where Q12b leaks into P14.
                    const topBlocks = sortedBlocks.filter(b =>
                        b.pageIndex === next.pageIndex &&
                        MarkingZoneService.getY(b) < (nextPH * 0.15) &&
                        MarkingZoneService.getX(b) < (nextPDims.width * 0.3)
                    );

                    const nextLabelNormalized = ZoneUtils.normalizeLabel(next.label);
                    const isNextLabelPresentAtTop = topBlocks.some(b => {
                        const normalizedText = ZoneUtils.normalizeLabel(b.text || "");
                        return normalizedText === nextLabelNormalized || normalizedText.startsWith(nextLabelNormalized);
                    });

                    if (isNextLabelPresentAtTop) {
                        // console.log(` 🛡️ [BRIDGE-VETO] ${current.key} bridge to P${next.pageIndex} cancelled: Label "${next.label}" found in top-left.`);
                        continue;
                    }

                    // console.log(` 🌉 [BRIDGE-ACTIVATE] ${current.key} -> ${next.key} due to gap (NextY: ${next.startY} [15%= ${(nextPH * 0.15).toFixed(0)}])`);

                    // 1. Fill FULL gaps (e.g. P1 in P0->P2)
                    for (let p = current.pageIndex + 1; p < next.pageIndex; p++) {
                        const pDims = pageDimensionsMap.get(p) || { width: 2480, height: 3508 };
                        const pW_bridge = pDims.width || 2480;
                        const pH_bridge = pDims.height || 3508;
                        const margin_bridge = Math.floor(pW_bridge * 0.06);
                        const vMargin_bridge = Math.floor(pH_bridge * 0.06);

                        zones[current.key].push({
                            label: current.key,
                            pageIndex: p,
                            startY: vMargin_bridge,
                            endY: pH_bridge - vMargin_bridge,
                            startYPercent: (vMargin_bridge / pH_bridge) * 100,
                            endYPercent: ((pH_bridge - vMargin_bridge) / pH_bridge) * 100,
                            x: margin_bridge,
                            width: pW_bridge - (margin_bridge * 2),
                            origW: pW_bridge,
                            origH: pH_bridge
                        } as any);
                    }

                    // 2. Fill PARTIAL top of the next page
                    const nextPW = nextPDims.width || 2480;
                    const nextMargin = Math.floor(nextPW * 0.06);
                    const nextVMargin = Math.floor(nextPH * 0.06);

                    if (next.startY > nextVMargin + 50) {
                        zones[current.key].push({
                            label: current.key,
                            pageIndex: next.pageIndex,
                            startY: nextVMargin,
                            endY: next.startY,
                            startYPercent: (nextVMargin / nextPH) * 100,
                            endYPercent: (next.startY / nextPH) * 100,
                            x: nextMargin,
                            width: nextPW - (nextMargin * 2),
                            origW: nextPW,
                            origH: nextPH
                        } as any);
                    }
                } else {
                    // console.log(` 🚫 [BRIDGE-SKIP] ${current.key} -> ${next.key} (NextY: ${next.startY} [15%= ${(nextPH * 0.15).toFixed(0)}])`);
                }
            }
        }

        return zones;
    }

    // ---------------------------------------------------------
    // 🛠️ HELPERS (Unchanged)
    // ---------------------------------------------------------
    private static findBestBlockSequential(
        sortedBlocks: any[],
        labelRaw: string,
        textRaw: string,
        minPage: number,
        minY: number,
        debugContext: string,
        pageDimensionsMap: Map<number, { width: number; height: number }>,
        nextQuestionLabel?: string,
        targetNextPage?: number,
        targetCurrentPage?: number,
        nextQuestionText?: string // [FIX]: New Argument
    ): { block: any, similarity: number } | null {

        const label = labelRaw.trim();
        const text = textRaw.trim();
        const targetFull = `${label} ${text}`.trim();

        const parentMatch = labelRaw.match(/^(\d+)([a-z]+)?/i);
        const parentLabel = parentMatch ? parentMatch[1] : null;
        const subPartLabel = parentMatch ? parentMatch[2] : null;

        let bestBlock: any = null;
        let bestSimilarity = 0;

        for (let i = 0; i < sortedBlocks.length; i++) {
            const firstBlock = sortedBlocks[i];
            const blockY = MarkingZoneService.getY(firstBlock);
            const blockPage = firstBlock.pageIndex || 0;

            if (blockPage < minPage) continue;
            if (blockPage === minPage && blockY < minY) continue;

            // 🛡️ [GROUND-TRUTH START PROTECTION]:
            // If we know this question belongs on a specific page (from classifier),
            // don't let a stray "2" on Page 1 anchor Question 2.
            // [RELAXED]: Added 1-page buffer to handle classifier indexing errors (e.g. Q1 on P0 vs P1).
            if (targetCurrentPage !== undefined && blockPage < (targetCurrentPage - 1)) {
                continue;
            }

            // 🛡️ [WARP DRIVE PROTECTION]: Prevent jumping too far ahead
            // RELAXED (Bible 1.2): If this is the target page from the Truth stage, we allow the anchor 
            // even if it's a large jump from the previous question.
            const pageDiff = blockPage - minPage;
            const isTargetPage = targetCurrentPage !== undefined && blockPage === targetCurrentPage;

            if (pageDiff > 2 && bestSimilarity < 0.95 && !isTargetPage) {
                // If we hit a very high confidence match even far ahead, we might allow it,
                // but for sub-questions or fragmented text, we stay strict.
                continue;
            }

            // 🛡️ [SEQUENTIAL TERMINATOR]: 
            // If we encounter the NEXT question while looking for THIS one, we MUST stop.
            // [CONTEXT-AWARE]: Avoids killing search early on Summary Tables/Mark Grids.
            if (nextQuestionLabel) {
                const blockText = (firstBlock.text || "").trim();
                const nextMatch = blockText.match(/^(?:\W+)?(?:question\s+)?(\d+|[Qq]\d+)([a-z]+)?/i);

                if (nextMatch) {
                    const blockNum = nextMatch[1].replace(/[Qq]/i, '');
                    const blockSeq = (nextMatch[2] || "").toLowerCase();

                    const targetNextMatch = nextQuestionLabel.match(/^(\d+)([a-z]+)?/i);
                    const targetNextNum = targetNextMatch ? targetNextMatch[1] : null;
                    const targetNextSeq = targetNextMatch ? (targetNextMatch[2] || "").toLowerCase() : "";

                    // 1. Strict Number & Sequence Match
                    if (blockNum === targetNextNum && blockSeq === targetNextSeq) {
                        const hasExplicitKeyword = /question/i.test(blockText);
                        let isValidStopper = true;

                        // 🛡️ [STOPPER-VERIFICATION]: If it's a "Naked Number" (no "Question" keyword),
                        // we MUST verify the text matches the expected Next Question Text.
                        // This prevents "2 marks" from triggering "Question 2".
                        if (!hasExplicitKeyword && nextQuestionText) {
                            // Look ahead to capture text context
                            let stopperContext = blockText;
                            // Grab a few subsequent blocks to build context (similar to forward search)
                            // Simple lookahead for context
                            let contextLimit = 3;
                            for (let k = 1; k <= contextLimit; k++) {
                                if (i + k < sortedBlocks.length && sortedBlocks[i + k].pageIndex === firstBlock.pageIndex) {
                                    stopperContext += " " + (sortedBlocks[i + k].text || "");
                                }
                            }

                            const stopperScore = SimilarityService.calculateHybridScore(stopperContext, nextQuestionText, false, true);
                            if (stopperScore.total < 0.4) {
                                // console.log(`[STOPPER-REJECT] '2' found but text mismatch (${stopperScore.total.toFixed(2)}). Expected: '${nextQuestionText.substring(0,20)}...'`);
                                isValidStopper = false;
                            }
                        }


                        // 🕵️ HEURISTIC: "Physical Law" Stopper
                        // - STRONG STOP: If it says "Question X", it's a real header. STOP.
                        // - WEAK STOP: If it's just a naked "X", it could be a summary table or page number.
                        //   We only STOP if we have already found a decent match for the CURRENT question.

                        if (!hasExplicitKeyword) {
                            // 🛡️ [FOOTER NOISE REJECTION]: Skip digits in the bottom 5% (likely page numbers)
                            if (blockY > 95) {
                                isValidStopper = false;
                            }
                            // If it's a naked digit, and we haven't found a 40%+ match for THIS question yet,
                            // it's likely a Table of Contents or Mark Grid. Ignore it.
                            else if (bestSimilarity < 0.4) {
                                isValidStopper = false;
                            }
                        }

                        // 🛡️ [GROUND-TRUTH OVERRIDE]: 
                        // If we have a Target Page for the NEXT question, don't let it stop us on an EARLY page.
                        // This fixes the "Aggressive Stopper on P4 kills search for Q5 on P5" bug.
                        if (targetNextPage !== undefined && blockPage < targetNextPage) {
                            isValidStopper = false;
                        }

                        if (isValidStopper) {
                            // console.log(`[ZONE-SEQUENTIAL] 🛑 ABSOLUTE STOP: Detected next question "${nextQuestionLabel}" at P${blockPage}. Killing search for "${label}".`);
                            break;
                        }
                    }
                }
            }

            // 🛡️ [CONFIDENCE LOCK]: If we have a high-confidence match on an early page, stop searching.
            if (bestBlock && bestBlock.pageIndex < blockPage && bestSimilarity > 0.75) {
                // console.log(`[ZONE-SEQUENTIAL] 🛡️ Found early match for "${label}" at P${bestBlock.pageIndex}. Terminating search before P${blockPage}.`);
                break;
            }

            let accumulatedText = "";

            // 🛡️ [ACCUMULATIVE-WINDOW]: Look ahead up to 5 blocks to handle fragmentation
            for (let j = i; j < Math.min(i + 5, sortedBlocks.length); j++) {
                const currentBlock = sortedBlocks[j];
                if (currentBlock.pageIndex !== blockPage) break;

                accumulatedText += (currentBlock.text || "") + " ";
                const blockTextRaw = accumulatedText.trim();

                // [BUG-FIX]: Normalize notations (e.g., "2 (a) Write" -> "2a Write") so they match classification text
                const normalizedCandidate = blockTextRaw
                    .replace(/^[\\(\[\]\s\-\.\)]+/, '') // [FIX]: Strip leading LaTeX/noise (e.g. \( 1 -> 1)
                    .replace(/^(\d+)\s*\(?([a-z]|[0-9]{1,2}|[ivx]+)\)?\s+/, '$1$2 ') // [FIX]: Concatenate 2(a) -> 2a
                    .replace(/^(\d+)[\.\)]\s+/, '$1 ')
                    .trim();

                const details = SimilarityService.calculateHybridScore(normalizedCandidate, targetFull, false, true);

                let anchorBonus = 0;
                if (labelRaw.length > 0) {
                    const exactRegex = new RegExp(`^${MarkingZoneService.escapeRegExp(labelRaw)}(?:[\\s\\.\\)]|$)`, 'i');
                    const parentRegex = parentLabel ? new RegExp(`^${MarkingZoneService.escapeRegExp(parentLabel)}(?:[\\s\\.\\)]|$)`, 'i') : null;

                    const isLabelMatch = exactRegex.test(normalizedCandidate) || MarkingZoneService.checkLabelMatch(normalizedCandidate, labelRaw);

                    if (isLabelMatch) {
                        const dims_match = pageDimensionsMap.get(blockPage) || { width: 2480, height: 3508 };
                        const pH_match = dims_match.height || 3508;
                        const isFooter = blockY > (pH_match * 0.9);
                        const isTotalLine = /total/i.test(normalizedCandidate);

                        // We check the "Header Identity" vs "Footer Identity"
                        if (isFooter || isTotalLine) {
                            anchorBonus = -0.5; // Penalize footers
                        } else {
                            anchorBonus = 0.5; // Favor headers
                        }
                    }
                }

                let finalScore = details.total + anchorBonus;

                // 🎯 IDENTITY GATE:
                if (labelRaw) {
                    const targetMatch = labelRaw.match(/^(\d+)([a-z]+)?/i);
                    // [FIX]: Robust regex to capture "2 (a)" or "2.a" as Identity
                    const blockMatch = blockTextRaw.match(/^(?:\W+)?(?:question\s+)?(\d+|[Qq]\d+)(?:\s*[\(\[\]]?\s*)([a-z]+)?/i);

                    if (targetMatch && blockMatch) {
                        const targetNum = targetMatch[1];
                        const targetSeq = (targetMatch[2] || "").toLowerCase();

                        const blockNum = blockMatch[1].replace(/[Qq]/i, '');
                        const blockSeq = (blockMatch[2] || "").toLowerCase();

                        // 1. [BINARY NUMBER LOCK]: 1 vs 11 is absolute 0 similarity.
                        if (targetNum !== blockNum) {
                            finalScore = 0;
                        }
                        // 2. Exact Sequence Lock (Prevents 5a vs 5b)
                        else if (targetSeq && blockSeq && targetSeq !== blockSeq) {
                            finalScore -= 1.0;
                        }
                    }

                    // 🛡️ [ANTI-FALSE-POSITIVE]: Strong Penalty for "Number Match, Low Text Match"
                    // Triggered if text similarity is extremely low (< 0.2) or score is weak.
                    // This disqualifies marks indicators like (2) or (1) which have no textual content.
                    if (finalScore > 0 && details.total < 0.20 && normalizedCandidate.length < 50) {
                        finalScore -= 1.5; // Disqualify
                    }
                }

                // 🏅 [GREEDY BEST-MATCH]: If we find a block that matches both number AND has 80% similarity, stop.
                if (details.total > 0.8 && finalScore > bestSimilarity) {
                    bestBlock = firstBlock;
                    bestSimilarity = finalScore;
                    break;
                }

                if (finalScore > bestSimilarity) {
                    bestBlock = firstBlock;
                    bestSimilarity = finalScore;
                }
            }
        }

        // Dynamic threshold based on source length
        const dynamicThreshold = targetFull.length < 15 ? 0.7 : 0.45;
        if (bestBlock && bestSimilarity > dynamicThreshold) {
            return { block: bestBlock, similarity: bestSimilarity };
        }

        if (labelRaw === "2" || labelRaw === "2a") {
            console.log(`[ZONE-FAIL] ❌ Match failed for ${labelRaw}. Best candidate: "${bestBlock?.text?.substring(0, 50)}..." Score: ${bestSimilarity?.toFixed(3)} (Threshold: ${dynamicThreshold})`);
            console.log(`[ZONE-FAIL] 🎯 Target was: "${targetFull.substring(0, 50)}..."`);
        }
        return null;
    }

    private static getY(block: any): number {
        if (Array.isArray(block.coordinates)) return block.coordinates[1];
        if (block.coordinates?.y != null) return block.coordinates.y;
        if (Array.isArray(block.bbox)) return block.bbox[1];
        return 0;
    }

    private static getX(block: any): number {
        if (Array.isArray(block.coordinates)) return block.coordinates[0];
        if (block.coordinates?.x != null) return block.coordinates.x;
        if (Array.isArray(block.bbox)) return block.bbox[0];
        return 0;
    }

    private static escapeRegExp(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Backfills zones for injected steps (e.g. DRAWING) if they were missed.
     */
    public static backfillInjectedZones(
        semanticZones: Record<string, any[]>,
        stepsDataForMapping: any[],
        pageDimensionsMap: Map<number, { width: number; height: number }>
    ): void {
        stepsDataForMapping.forEach(step => {
            if ((step as any).ocrSource === 'system-injection') {
                const qLabel = (step as any).subQuestionLabel;
                const pIdx = step.pageIndex;
                const hasZoneOnPage = semanticZones[qLabel]?.some(z => z.pageIndex === pIdx);
                if (!hasZoneOnPage) {
                    const dims = pageDimensionsMap.get(pIdx) || Array.from(pageDimensionsMap.values())[0] || { width: 2480, height: 3508 };
                    const pW = dims.width || 2480;
                    const pH = dims.height || 3508;
                    const margin = Math.floor(pW * 0.05); // [FIX]: Dynamic Margin (5%)

                    let ceilingY = pH;
                    Object.values(semanticZones).flat().forEach(z => {
                        if (z.pageIndex === pIdx && z.startY < ceilingY && z.startY > 10 && z.label !== qLabel) {
                            ceilingY = z.startY;
                        }
                    });
                    if (!semanticZones[qLabel]) semanticZones[qLabel] = [];
                    semanticZones[qLabel].push({
                        label: qLabel,
                        pageIndex: pIdx,
                        startY: 0,
                        endY: ceilingY,
                        x: margin,
                        width: pW - (margin * 2),
                        origW: pW,
                        origH: pH
                    } as any);
                }
            }
        });
    }

    private static checkLabelMatch(text: string, label: string): boolean {
        if (!text || !label) return false;
        const cleanText = text.toLowerCase().trim();
        const cleanLabel = label.toLowerCase().trim();

        const escapedLabel = MarkingZoneService.escapeRegExp(cleanLabel);
        const patterns = [
            // [FIX]: Handle LaTeX delimiters like "\( 1" or "[1" or "1."
            new RegExp(`^[\\\\\\(\\[\\]\\s\\-\\.]*${escapedLabel}(?:[\\s\\.\\)\\],\\-]|$|\\\\)`, 'i'),
            new RegExp(`^Question\\s+${escapedLabel}`, 'i')
        ];

        return patterns.some(p => p.test(cleanText));
    }
}