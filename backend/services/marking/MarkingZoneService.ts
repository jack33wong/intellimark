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
        globalOffsetY: number,
        questionId?: string
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

                // 🛡️ [MULTI-PAGE OFFSET FIX]: Don't use a single global offset for all pages.
                // Find the zone for THIS specific page to determine the correct translation.
                let stepOffsetX = globalOffsetX;
                let stepOffsetY = globalOffsetY;

                const stepPage = (step as any).pageIndex;
                if (stepPage !== undefined && landmarks) {
                    const currentQuestionId = (questionId || "").replace(/\D/g, '');
                    const allZones = ZoneUtils.findAllMatchingZones(step.subQuestionLabel || "", (landmarks as any), currentQuestionId);
                    const zoneForPage = allZones.find(z => z.pageIndex === stepPage);

                    if (zoneForPage) {
                        stepOffsetX = zoneForPage.x || 0;
                        stepOffsetY = zoneForPage.startY || 0;
                    }
                }

                return {
                    text: step.text,
                    position: {
                        x: pos.x + stepOffsetX,
                        y: pos.y + stepOffsetY,
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
        expectedQuestions?: Array<{ label: string; text: string; targetPages?: number[] }>,
        nextQuestionText?: string,
        questionId?: string,
        metaPageIndices?: number[]
    ) {
        // Output structure
        const zones: Record<string, Array<{ label: string; startY: number; endY: number; pageIndex: number; x: number; headerBlockId?: string }>> = {};

        if (!rawBlocks || !expectedQuestions) return zones;

        const metaPages = new Set(metaPageIndices || []);
        console.log(` 📏 [ZONE-SERVICE] detectSemanticZones initialized with Meta Pages: ${[...metaPages].join(', ') || 'none'}`);


        // 1. Sort blocks strictly by Page and then Y
        const sortedBlocks = [...rawBlocks].sort((a, b) => {
            const pageIdA = a.pageId || `idx_${a.pageIndex || 0}`;
            const pageIdB = b.pageId || `idx_${b.pageIndex || 0}`;

            const pageDiff = (a.pageIndex || 0) - (b.pageIndex || 0);
            if (pageDiff !== 0) return pageDiff;
            return MarkingZoneService.getY(a) - MarkingZoneService.getY(b);
        });

        const distinctPages = [...new Set(sortedBlocks.map(b => b.pageIndex || 0))].sort((a, b) => a - b);
        // console.log(`[ZONE-SORT] 🏆 Physical Page Order: ${distinctPages.join(' -> ')}`);

        let minSearchY = 0;
        let currentSearchPage = sortedBlocks[0]?.pageIndex || 0;
        const detectedLandmarks: Array<{ key: string; label: string; startY: number; pageIndex: number; x: number; headerBlockId?: string }> = [];
        const claimedBlockIds = new Set<string>();

        // 2. Find Zone STARTS (Sequential Logic)
        for (let qIdx = 0; qIdx < expectedQuestions.length; qIdx++) {
            const eq = expectedQuestions[qIdx];
            const nextEq = expectedQuestions[qIdx + 1];

            const finalKey = eq.label;

            const match = this.findBestBlockSequential(
                sortedBlocks,
                eq.label,
                eq.text,
                currentSearchPage,
                minSearchY,
                `Start-${finalKey}`,
                pageDimensionsMap, // Pass the map
                nextEq?.label,
                nextEq?.targetPages ? nextEq.targetPages[0] : undefined,
                eq.targetPages,
                nextEq?.text, // [FIX]: Pass the Expected Text for Stopper Verification
                claimedBlockIds
            );

            if (match) {
                // [FIX]: Tag this block as a confirmed Instruction (Header)
                // Stores the specific question label (e.g. "2a") so it can be added to the AI Prompt tag.
                match.block._isInstruction = true;
                match.block._associatedQuestion = finalKey;
                // console.log(` 💎 [ZONE-TAG] ${finalKey} anchored on "${match.block.text.substring(0, 50)}" (P${match.block.pageIndex})`);

                // Mark this block as claimed so children/siblings don't re-anchor on it
                if (match.block.id) {
                    claimedBlockIds.add(match.block.id);
                }

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

                // [SHARED-CURSOR-FIX]: Questions in the same group (parent/child) should search from the same starting point.
                // This ensures Stage 3 has enough anchors to reconcile "Impossible Zones".
                const isEndOfGroup = !nextEq || !nextEq.label.startsWith(eq.label.replace(/[a-z]+$/, ''));

                if (isEndOfGroup) {
                    currentSearchPage = match.block.pageIndex;
                    minSearchY = MarkingZoneService.getY(match.block);
                } else {
                    // console.log(`[SHARED-CURSOR] Q${finalKey} sharing cursor with children from P${currentSearchPage}@${minSearchY}.`);
                }
            } else {
                console.log(`[ZONE-MISS] ⚠️ Question ${finalKey} could not be anchored. Exhausted search from P${currentSearchPage}@${minSearchY}`);
            }
        }

        // 3. Find Zone ENDS (TVC Logic)
        // 🛡️ Total Vertical Coverage: "First owns the top, Last owns the bottom"
        // 🏰 [DETETERMINISTIC FIX]: Sort landmarks by physical vertical order.
        // This prevents the current marked question from "stealing" the Top slot
        // 3. Stage 3: Reconciliation Pass (OCR-Based Order)
        MarkingZoneService.reconcileLandmarksByOCRIndex(detectedLandmarks, sortedBlocks);

        // 🏰 [BIG-ZONE-STRAY-DESIGN]: Pre-calculate Cluster Boundaries based on Signal B & C
        const finalLandmarks = detectedLandmarks;
        const clusterStarts: number[] = new Array(finalLandmarks.length);
        const clusterStoppers: (number | null)[] = new Array(finalLandmarks.length).fill(null);
        
        // Sort finalLandmarks for clustering logic
        finalLandmarks.sort((a, b) => {
            const pageDiff = (a.pageIndex || 0) - (b.pageIndex || 0);
            if (pageDiff !== 0) return pageDiff;
            return a.startY - b.startY;
        });

        for (let i = 0; i < finalLandmarks.length; ) {
            let baseEnd = i + 1;
            let groupHasALevelSignal = false;

            // 1. PRE-SCAN: Check if the entire SAME-BASE group satisfies A-Level signatures (Signal C)
            while (baseEnd < finalLandmarks.length) {
                const l1 = finalLandmarks[baseEnd - 1];
                const l2 = finalLandmarks[baseEnd];
                if (ZoneUtils.getBaseNumber(l1.key) !== ZoneUtils.getBaseNumber(l2.key)) break;

                // Signal C: Massive Whitespace Gap / Blank Intervening Pages
                const gapHeight = (l1.pageIndex === l2.pageIndex) ? (l2.startY - l1.startY) : 0;
                let hasEmptyInterveningPage = false;
                if (l2.pageIndex > l1.pageIndex) {
                    for (let p = l1.pageIndex + 1; p < l2.pageIndex; p++) {
                        // [GUARD]: Meta-pages (Front covers) are NOT valid empty intervening pages for Big Zone trigger.
                        if (metaPages.has(p)) continue;

                        if (sortedBlocks.filter(b => b.pageIndex === p).length < 8) {
                            hasEmptyInterveningPage = true;
                            break;
                        }
                    }
                }

                // Detector Upgrade: Only trigger A-Level mode for massive absences (>600px and sparse)
                let gapHasContent = false;
                if (gapHeight > 600) {
                    const gapY1 = l1.startY + 40;
                    const gapY2 = l2.startY;
                    const blocksInGap = sortedBlocks.filter(b => 
                        b.pageIndex === l1.pageIndex && 
                        MarkingZoneService.getY(b) > gapY1 && 
                        MarkingZoneService.getY(b) < gapY2
                    );
                    const gapDensity = blocksInGap.reduce((sum, b) => sum + (b.text || "").length, 0);
                    gapHasContent = gapDensity > 200; // If it has content, it's NOT an A-Level signal
                }
                
                if ((gapHeight > 600 && !gapHasContent) || hasEmptyInterveningPage) {
                    groupHasALevelSignal = true;
                    console.log(` 📊 [A-LEVEL-UPGRADE] Group ${ZoneUtils.getBaseNumber(l1.key)} upgraded via ${l1.key}->${l2.key} (H:${gapHeight}, EmptyPage:${hasEmptyInterveningPage})`);
                }
                baseEnd++;
            }

            // 2. FUSION CLUSTERING
            if (groupHasALevelSignal) {
                // [A-LEVEL MODE]: All landmarks with same base number fuse into One Big Zone (Iron Dome)
                const stopperIdx = baseEnd < finalLandmarks.length ? baseEnd : null;
                for (let k = i; k < baseEnd; k++) {
                    clusterStarts[k] = i; 
                    clusterStoppers[k] = stopperIdx;
                }
                i = baseEnd;
            } else {
                // [GCSE MODE]: PIECEWISE FUSION (Default)
                // Sub-parts only fuse if they satisfy the Tight Signal B (< 200 chars).
                // They NEVER fuse across page breaks unless they were physically empty (which Signal C handles).
                let currentIdx = i;
                while (currentIdx < baseEnd) {
                    let clusterEnd = currentIdx + 1;
                    while (clusterEnd < baseEnd) {
                        const l1 = finalLandmarks[clusterEnd - 1];
                        const l2 = finalLandmarks[clusterEnd];

                        if (l1.pageIndex !== l2.pageIndex) break; // GCSE piecewise never crosses pages

                        const gapY1 = l1.startY + 40;
                        const gapY2 = l2.startY;
                        const blocksInGap = sortedBlocks.filter(b => 
                            b.pageIndex === l1.pageIndex && 
                            MarkingZoneService.getY(b) > gapY1 && 
                            MarkingZoneService.getY(b) < gapY2
                        );
                        const gapDensity = blocksInGap.reduce((sum, b) => sum + (b.text || "").length, 0);
                        
                        if (gapDensity >= 200) break; // Blocked by content (Signal B)
                        clusterEnd++;
                    }

                    const stopperIdx = clusterEnd < finalLandmarks.length ? clusterEnd : null;
                    for (let k = currentIdx; k < clusterEnd; k++) {
                        clusterStarts[k] = currentIdx; 
                        clusterStoppers[k] = stopperIdx;
                    }
                    currentIdx = clusterEnd;
                }
                i = baseEnd; // Move to next base group
            }
        }

        for (let i = 0; i < finalLandmarks.length; i++) {
            const current = finalLandmarks[i];
            const clusterStart = finalLandmarks[clusterStarts[i]];
            const actualNext = clusterStoppers[i] !== null ? finalLandmarks[clusterStoppers[i]!] : null;

            const dims = pageDimensionsMap.get(current.pageIndex) || Array.from(pageDimensionsMap.values())[0] || { width: 2480, height: 3508 };
            const pW = dims.width || 2480;
            const pH = dims.height || 3508;
            const vMargin = Math.floor(pH * 0.06);

            // 🏗️ [ZERO MARGIN FIX]: Clustered members use the START of the whole cluster.
            let finalStartY = clusterStart.startY;
            if (i === 0 && finalStartY > vMargin) finalStartY = vMargin;

            let endY = pH; 
            if (actualNext && actualNext.pageIndex === current.pageIndex) {
                endY = actualNext.startY;
            } else {
                endY = pH - vMargin;
            }

            // 🛡️ [IRON DOME]: Key by Base Number
            const resultKey = ZoneUtils.getBaseNumber(clusterStart.key);
            if (!zones[resultKey]) zones[resultKey] = [];

            const horizontalMargin = Math.floor(pW * 0.06);
            let finalEndY = endY;
            if (finalEndY >= pH - 20) finalEndY = pH - vMargin;
            finalEndY = Math.max(finalEndY, finalStartY + 100);

            zones[resultKey].push({
                label: resultKey,
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

            console.log(` 🏗️ [ZONE-CREATE] ${resultKey}: [${finalStartY} - ${finalEndY}] (P${current.pageIndex})`);

            // 🌉 [BIBLE-BRIDGE]: Fill empty pages between this landmark and the next.
            // If the next milestone (next landmark or next cluster) is on a further page, 
            // create full-page zones on the intervening "Answer Pages".
            const nextMilestone = finalLandmarks[i + 1];
            if (nextMilestone && nextMilestone.pageIndex > current.pageIndex + 1) {
                // Determine which question owns the bridge.
                // If the next milestone is part of the SAME cluster, the current question obviously owns it.
                // If it's a NEW cluster, the current (last of previous cluster) owns the trailing answer pages.
                for (let p = current.pageIndex + 1; p < nextMilestone.pageIndex; p++) {
                    const bridgeDims = pageDimensionsMap.get(p) || dims;
                    const bW = bridgeDims.width || 2480;
                    const bH = bridgeDims.height || 3508;
                    const bVMargin = Math.floor(bH * 0.06);
                    const bHMargin = Math.floor(bW * 0.06);

                    zones[resultKey].push({
                        label: `${resultKey}-bridge`,
                        startY: bVMargin,
                        endY: bH - bVMargin,
                        startYPercent: 6,
                        endYPercent: 94,
                        pageIndex: p,
                        x: bHMargin,
                        width: bW - (bHMargin * 2),
                        origW: bW,
                        origH: bH
                    } as any);
                    console.log(` 🌉 [ZONE-BRIDGE] ${resultKey}: [FULL-PAGE] (P${p})`);
                }
            } else if (!nextMilestone) {
                // 🚩 [END-OF-PAPER BRIDGE]: If this is the last question, 
                // it owns every remaining page in the document.
                const lastDocPage = Math.max(...pageDimensionsMap.keys());
                for (let p = current.pageIndex + 1; p <= lastDocPage; p++) {
                    const bridgeDims = pageDimensionsMap.get(p) || dims;
                    const bW = bridgeDims.width || 2480;
                    const bH = bridgeDims.height || 3508;
                    const bVMargin = Math.floor(bH * 0.06);
                    const bHMargin = Math.floor(bW * 0.06);

                    zones[resultKey].push({
                        label: `${resultKey}-end-bridge`,
                        startY: bVMargin,
                        endY: bH - bVMargin,
                        startYPercent: 6,
                        endYPercent: 94,
                        pageIndex: p,
                        x: bHMargin,
                        width: bW - (bHMargin * 2),
                        origW: bW,
                        origH: bH
                    } as any);
                    console.log(` 🏁 [ZONE-END-BRIDGE] ${resultKey}: [FULL-PAGE] (P${p})`);
                }
            }
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

            // 🏰 [IRON-DOME FIX]: Use Base Number for zone access to prevent "push to undefined" crash.
            const resultKey = ZoneUtils.getBaseNumber(current.key);
            const qZones = zones[resultKey];
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

                    // 🛡️ [PARENT-NUMBER-GUARD]: 
                    // Only allow bridging if we are continuing the SAME question group (e.g. 2b -> 2c).
                    // If the parent number changes (e.g. 2b -> 3), we MUST NOT bridge, because the gap 
                    // likely belongs to the new question's preamble (e.g. Q3 Intro Text).
                    const currentParent = current.key.match(/^\d+/)?.[0];
                    const nextParent = next.key.match(/^\d+/)?.[0];

                    if (currentParent && nextParent && currentParent !== nextParent) {
                        // console.log(` 🛡️ [BRIDGE-VETO] ${current.key} (Child of ${currentParent}) -> ${next.key} (Child of ${nextParent}) cancelled. Mismatch Parent.`);
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

                        zones[resultKey].push({
                            label: resultKey,
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
                        zones[resultKey].push({
                            label: resultKey,
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
        targetCurrentPages?: number[],
        nextQuestionText?: string, // [FIX]: New Argument
        claimedBlockIds?: Set<string>
    ): { block: any, similarity: number } | null {

        const label = labelRaw.trim();
        const text = textRaw.trim();
        const targetFull = `${label} ${text}`.trim();

        let bestBlock: any = null;
        let bestSimilarity = 0;

        if (targetCurrentPages && targetCurrentPages.length > 0) {
            // console.log(`   📂 [BUCKET-DEBUG] ${labelRaw} Whitelist: [${targetCurrentPages.join(', ')}]`);
        }

        for (let i = 0; i < sortedBlocks.length; i++) {
            const firstBlock = sortedBlocks[i];

            // [FIX]: If this block has already been claimed by a previous question, we cannot start a new window here.
            if (claimedBlockIds && claimedBlockIds.has(firstBlock.id)) {
                continue;
            }

            const blockY = MarkingZoneService.getY(firstBlock);
            const blockPage = firstBlock.pageIndex || 0;

            // 🛡️ [BUCKET-STRICT WHITELIST]:
            // If the AI Mapper has identified specific pages for this question,
            // we ONLY allow anchoring on those pages. This stops jumping to the template!
            // 🚀 [CURSOR OVERRIDE]: Whitelisted pages ignore the previous question's cursor.
            if (targetCurrentPages && targetCurrentPages.length > 0) {
                if (!targetCurrentPages.includes(blockPage)) {
                    continue;
                }
            } else {
                // Only enforce sequential order if there is no bucket whitelist from the AI.
                if (blockPage < minPage) continue;
                // [FIX]: Expand Buffer to 100px and allow Page Overlap (same starting point).
                if (blockPage === minPage && blockY < (minY - 100)) continue;
            }

            // 🛡️ [SEQUENTIAL TERMINATOR]: 
            if (nextQuestionLabel) {
                const blockText = (firstBlock.text || "").trim();
                const nextMatch = blockText.match(/^(?:\W+)?(?:question\s+)?(\d+|[Qq]\d+)([a-z]+)?/i);

                if (nextMatch) {
                    const blockNum = nextMatch[1].replace(/[Qq]/i, '');
                    const blockSeq = (nextMatch[2] || "").toLowerCase();

                    const targetNextMatch = nextQuestionLabel.match(/^(\d+)([a-z]+)?/i);
                    const targetNextNum = targetNextMatch ? targetNextMatch[1] : null;
                    const targetNextSeq = targetNextMatch ? (targetNextMatch[2] || "").toLowerCase() : "";

                    if (blockNum === targetNextNum && blockSeq === targetNextSeq) {
                        const hasExplicitKeyword = /question/i.test(blockText);
                        let isValidStopper = true;

                        if (!hasExplicitKeyword && nextQuestionText) {
                            let stopperContext = blockText;
                            let contextLimit = 3;
                            for (let k = 1; k <= contextLimit; k++) {
                                if (i + k < sortedBlocks.length && sortedBlocks[i + k].pageIndex === firstBlock.pageIndex) {
                                    stopperContext += " " + (sortedBlocks[i + k].text || "");
                                }
                            }

                            const stopperScore = SimilarityService.calculateHybridScore(stopperContext, nextQuestionText, false);
                            if (stopperScore.total < 0.4) {
                                isValidStopper = false;
                            }
                        }

                        if (!hasExplicitKeyword) {
                            if (blockY > 95) {
                                isValidStopper = false;
                            }
                            else if (bestSimilarity < 0.4) {
                                isValidStopper = false;
                            }
                        }

                        if (targetNextPage !== undefined && blockPage !== targetNextPage) {
                            isValidStopper = false;
                        }

                        if (isValidStopper) {
                            break;
                        }
                    }
                }
            }

            // 🛡️ [CONFIDENCE LOCK]: If we have a high-confidence match on an early page, stop searching.
            if (bestBlock && bestBlock.pageIndex < blockPage && bestSimilarity > 0.75) {
                break;
            }

            let accumulatedText = "";

            // 🛡️ [ACCUMULATIVE-WINDOW]: Look ahead up to 5 blocks to handle fragmentation
            for (let j = i; j < Math.min(i + 5, sortedBlocks.length); j++) {
                const currentBlock = sortedBlocks[j];
                if (currentBlock.pageIndex !== blockPage) break;

                if (j > i && claimedBlockIds && claimedBlockIds.has(currentBlock.id)) {
                    break;
                }

                accumulatedText += (currentBlock.text || "") + " ";
                const blockTextRaw = accumulatedText.trim();

                const normalizedCandidate = blockTextRaw
                    .replace(/^[\\(\[\]\s\-\.\)]+/, '')
                    .replace(/^(\d+)\s*\(?([a-z]|[0-9]{1,2}|[ivx]+)\)?\s+/, '$1$2 ')
                    .replace(/^(\d+)[\.\)]\s+/, '$1 ')
                    .trim();

                const details = SimilarityService.calculateHybridScore(normalizedCandidate, targetFull, false);

                // 🛡️ [SAFE-RESTORE]: Re-apply label boost, but only if the block starts with the label.
                const isLabelMatch = MarkingZoneService.checkLabelMatch(normalizedCandidate, labelRaw);
                let finalScore = details.total;
                if (isLabelMatch) {
                    finalScore += 0.5;
                }

                // Apply directional penalties (Footers/Totals)
                const dims_match = pageDimensionsMap.get(blockPage) || { width: 2480, height: 3508 };
                const pH_match = dims_match.height || 3508;
                const isFooter = blockY > (pH_match * 0.9);
                const isTotalLine = /total/i.test(normalizedCandidate);

                if ((isFooter || isTotalLine) && (!targetCurrentPages || targetCurrentPages.length === 0)) {
                    finalScore -= 0.5;
                }

                if (finalScore > 0.3) {
                    // console.log(`   🕵️ [SIMILARITY-TRACE] Q${labelRaw} candidate: "${normalizedCandidate.substring(0, 40)}" | Score: ${finalScore.toFixed(3)} (Raw: ${details.total.toFixed(3)}, Boost: ${isLabelMatch ? '+0.5' : '0.0'}) | P${blockPage}`);
                }

                const similarityThreshold = (targetCurrentPages && targetCurrentPages.length > 0) ? 0.7 : 0.85;
                // [FIX]: Relax sub-question similarity (0.55) to handle noisy A-Level layouts.
                const isSubPart = label.length <= 3 && /^[a-z0-9]+$/i.test(label);
                const finalThreshold = (isSubPart && isLabelMatch) ? 0.55 : similarityThreshold;
                if (finalScore >= finalThreshold && finalScore > bestSimilarity) {
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

        const dynamicThreshold = targetFull.length < 15 ? 0.7 : 0.45;
        if (bestBlock && bestSimilarity > dynamicThreshold) {
            return { block: bestBlock, similarity: bestSimilarity };
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
            if ((step as any).ocrSource === 'system-injection' || (step as any).source === 'classification') {
                const qLabel = (step as any).subQuestionLabel || (step as any).part || 'main';
                const pIdx = step.pageIndex;
                if (pIdx === undefined) return;

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

    /**
     * Stage 3: Reconciliation Pass
     * Ensures that Parent questions (e.g. 2) are not anchored AFTER their Children (e.g. 2a).
     * If a sequence violation is found, snaps the parent back to the top of its group.
     */
    private static reconcileLandmarksByOCRIndex(landmarks: any[], sortedBlocks: any[]): void {
        const blockToIndex = new Map<string, number>();
        sortedBlocks.forEach((b, idx) => {
            const id = b.id || b.globalBlockId;
            if (id) blockToIndex.set(id, idx);
        });

        // Group landmarks by base question number
        const groups = new Map<string, any[]>();
        landmarks.forEach(l => {
            const baseMatch = l.label.match(/^(\d+)/);
            if (baseMatch) {
                const base = baseMatch[1];
                if (!groups.has(base)) groups.set(base, []);
                groups.get(base)!.push(l);
            }
        });

        groups.forEach((groupMembers, baseNum) => {
            const parent = groupMembers.find(m => m.label === baseNum);
            const children = groupMembers.filter(m => m.label !== baseNum);

            if (parent && children.length > 0) {
                // Find the physically EARLIEST child
                let earliestChild = children[0];
                let minChildIdx = blockToIndex.get(earliestChild.headerBlockId) ?? 999999;

                for (let i = 1; i < children.length; i++) {
                    const idx = blockToIndex.get(children[i].headerBlockId) ?? 999999;
                    if (idx < minChildIdx) {
                        minChildIdx = idx;
                        earliestChild = children[i];
                    }
                }

                const parentIdx = blockToIndex.get(parent.headerBlockId) ?? -1;

                // VALIDATE: If Parent is on a later page OR is a later block index than its child -> Reset it.
                const isParentLaterPage = parent.pageIndex > earliestChild.pageIndex;
                const isParentLaterBlock = parent.pageIndex === earliestChild.pageIndex && parentIdx > minChildIdx;

                if (isParentLaterPage || isParentLaterBlock) {
                    console.log(` ⚖️ [RECONCILE] Parent "${parent.label}" was anchored at block index ${parentIdx} (P${parent.pageIndex}).`);
                    console.log(` ⚖️ [RECONCILE] SNAPPING "${parent.label}" to match child "${earliestChild.label}" at block index ${minChildIdx} (P${earliestChild.pageIndex}).`);

                    // Clean up the false positive flag on the old parent block
                    const oldParentBlock = sortedBlocks[parentIdx];
                    if (oldParentBlock) {
                        oldParentBlock._isInstruction = false;
                        oldParentBlock.isLikelyInstruction = false;
                    }

                    // Snap parent to child's anchor
                    parent.startY = earliestChild.startY;
                    parent.pageIndex = earliestChild.pageIndex;
                    parent.headerBlockId = earliestChild.headerBlockId;
                }
            }
        });
    }

    private static checkLabelMatch(text: string, label: string): boolean {
        if (!text || !label) return false;

        const lowerText = text.toLowerCase().trim();
        const lowerLabel = label.toLowerCase().trim();

        // 1. Exact leading match (e.g. block starts with "12a")
        if (lowerText.startsWith(lowerLabel)) {
            // Ensure word boundary or bracket to avoid "12" matching "120"
            const nextChar = lowerText[lowerLabel.length];
            if (!nextChar || !/[0-9a-zA-Z]/.test(nextChar)) return true;
        }

        // 2. Sub-Part Extraction for labels like "12i"
        const match = label.match(/^(\d+)([a-z]+)?/i);
        const sub = match ? match[2] : null;

        if (sub) {
            // Handle sub-part brackets: matches "i) y=..." or "(i) y=..."
            const subPartPattern = new RegExp(`^\\(?[\\s]*${sub}[\\s]*[\\.\\)]`, 'i');
            return subPartPattern.test(lowerText);
        }

        // 3. Main Number Extraction for labels like "12"
        const numMatch = label.match(/^(\d+)/);
        if (numMatch) {
            const num = numMatch[1];
            // Matches "12. The diagram", "12) The diagram", or "Question 12"
            const anchoredNumPattern = new RegExp(`^\\(?[\\s]*${num}[\\s]*[\\.\\)]`, 'i');
            const explicitPattern = new RegExp(`^Question\\s+${num}`, 'i');
            return anchoredNumPattern.test(lowerText) || explicitPattern.test(lowerText);
        }

        return false;
    }
}