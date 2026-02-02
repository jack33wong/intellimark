import { SimilarityService } from './SimilarityService.js';
import { CoordinateTransformationService } from './CoordinateTransformationService.js';

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
        classificationBlocks: any[],
        questionDetection: any[],
        targetQuestionObject: any,
        inputQuestionNumber: string,
        rawOcrBlocks: any[],
        processedImage: any
    ): { offsetX: number; offsetY: number } {
        let offsetX = 0;
        let offsetY = 0;

        // 1. Try Classification Block (Primary Source)
        if (classificationBlocks && classificationBlocks.length > 0) {
            const sample = classificationBlocks[0];
            const rawBox = sample.box || sample.coordinates || { x: sample.x, y: sample.y, width: 0, height: 0 };
            const pixelBox = CoordinateTransformationService.ensurePixels(rawBox, 2000, 3000, `OFFSET-CLASS`);
            offsetX = pixelBox.x;
            offsetY = pixelBox.y;
        }

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
                nextEq?.label, // [STOPPER]: Stop if we see the next question
                nextEq?.targetPage, // 🛡️ [GROUND-TRUTH STOP]: Only stop if it's on/after the expected page
                eq.targetPage // 🛡️ [GROUND-TRUTH START]: Don't match earlier than expected
            );

            if (match) {
                const blockY = MarkingZoneService.getY(match.block);
                detectedLandmarks.push({
                    key: finalKey,
                    label: eq.label,
                    startY: blockY,
                    pageIndex: match.block.pageIndex,
                    x: 75, // [FIX]: Default placeholder, will be refined per-page later
                    headerBlockId: match.block.id || match.block.globalBlockId
                });

                currentSearchPage = match.block.pageIndex;
                minSearchY = MarkingZoneService.getY(match.block) + 10;
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
                            console.log(`[ZONE-ABSORB] Q${next.key} absorbing Main Q${current.key} on P${current.pageIndex}`);
                            absorbedIndices.add(i);
                        }
                    }
                }
            }
        }

        const finalLandmarks = detectedLandmarks.filter((_, idx) => !absorbedIndices.has(idx));
        console.log(`[ZONE-TVC] Deterministic Order (Post-Absorb): ${finalLandmarks.map(l => `${l.key}(P${l.pageIndex}@${l.startY})`).join(' -> ')}`);

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

            // 🏗️ SMART MARGIN: First question on a page owns the top (6% margin).
            let finalStartY = current.startY - 150;
            if (!pagesWithFirstLandmark.has(current.pageIndex)) {
                console.log(`[ZONE-SMART] First on P${current.pageIndex}: ${current.key} owning Top-of-Page`);
                finalStartY = vMargin;
                pagesWithFirstLandmark.add(current.pageIndex);
            }
            finalStartY = Math.max(vMargin, finalStartY);

            let endY = pH; // Start at full page, only apply margin if it stays at full page

            if (next && next.pageIndex === current.pageIndex) {
                // Inter-question gap filling (Snap to start of next question)
                // [FIX]: "Don't touch the middle zone" - No vMargin for inter-question boundaries
                endY = next.startY;
            }
            else {
                // LAST question on this page: Search for a "Total" stopper or "End of session" marker.
                const markers = ["total for question", "marks)", "total marks"];
                if (nextQuestionText) markers.push(nextQuestionText.toLowerCase());

                const stopMarker = sortedBlocks.find(b => {
                    if (b.pageIndex !== current.pageIndex) return false;
                    const bY = MarkingZoneService.getY(b);
                    if (bY < (current as any).startY + 50) return false; // Use original startY for check

                    const t = (b.text || "").toLowerCase();
                    return markers.some(m => t.includes(m));
                });

                if (stopMarker) {
                    const stopY = MarkingZoneService.getY(stopMarker);
                    console.log(`[ZONE-SMART] Detected STOP marker for ${current.key} at Y=${stopY}`);
                    endY = stopY + 50; // Include the "Total" line itself + small margin
                } else {
                    // 🛡️ [FALLBACK]: Last question on a page owns the bottom (6% margin).
                    endY = pH - vMargin;
                }
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
                pageIndex: current.pageIndex,
                x: horizontalMargin,
                width: pW - (horizontalMargin * 2),
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

            // 🏰 [FIX]: Only bridge FULL gap pages. 
            // Do NOT extend into 'next.pageIndex' itself, because TVC logic 
            // already ensures the first question on a page owns the top.
            if (next && next.pageIndex > current.pageIndex) {
                // 1. Fill FULL gaps (e.g. P1 in P0->P2)
                for (let p = current.pageIndex + 1; p < next.pageIndex; p++) {
                    console.log(`[ZONE-UPSTREAM] Filling full gap page: ${current.key} for P${p}`);
                    const pDims = pageDimensionsMap.get(p) || { width: 2480, height: 3508 };
                    const pW_bridge = pDims.width || 2480;
                    const pH_bridge = pDims.height || 3508;
                    const margin_bridge = Math.floor(pW_bridge * 0.06); // [FIX]: Dynamic Margin (6%)
                    const vMargin_bridge = Math.floor(pH_bridge * 0.06);

                    zones[current.key].push({
                        label: current.key,
                        pageIndex: p,
                        startY: vMargin_bridge, // [FIX]: Enforce TOP margin
                        endY: pH_bridge - vMargin_bridge, // [FIX]: Enforce BOTTOM margin
                        x: margin_bridge,
                        width: pW_bridge - (margin_bridge * 2),
                    } as any);
                }

                // 2. Fill PARTIAL top of the next page (e.g. Top of P1 before 11c starts)
                // This gives 11b ownership of the space above 11c on P1.
                console.log(`[ZONE-UPSTREAM] Bridging partial top of P${next.pageIndex} for ${current.key} (ends at ${next.key}@${next.startY})`);
                const nextPDims = pageDimensionsMap.get(next.pageIndex) || { width: 2480, height: 3508 };
                const nextPW = nextPDims.width || 2480;
                const nextPH = nextPDims.height || 3508;
                const nextMargin = Math.floor(nextPW * 0.06); // [FIX]: Dynamic Margin (6%)
                const nextVMargin = Math.floor(nextPH * 0.06);

                // Only create if there is actual space (> vMargin + 50)
                if (next.startY > nextVMargin + 50) {
                    zones[current.key].push({
                        label: current.key,
                        pageIndex: next.pageIndex,
                        startY: nextVMargin, // [FIX]: Enforce TOP margin
                        endY: next.startY, // Stop where the next question starts (Tighten logic will handle refinement)
                        x: nextMargin,
                        width: nextPW - (nextMargin * 2),
                    } as any);
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
        nextQuestionLabel?: string,
        targetNextPage?: number, // 🛡️ [GROUND-TRUTH STOP]: The expected page for the stopper
        targetCurrentPage?: number // 🛡️ [GROUND-TRUTH START]: The expected page for THIS question
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
            if (targetCurrentPage !== undefined && blockPage < targetCurrentPage) {
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

                        // 🕵️ HEURISTIC: "Physical Law" Stopper
                        // - STRONG STOP: If it says "Question X", it's a real header. STOP.
                        // - WEAK STOP: If it's just a naked "X", it could be a summary table or page number.
                        //   We only STOP if we have already found a decent match for the CURRENT question.
                        let isValidStopper = true;

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
                            console.log(`[ZONE-SEQUENTIAL] 🛑 ABSOLUTE STOP: Detected next question "${nextQuestionLabel}" at P${blockPage}. Killing search for "${label}".`);
                            break;
                        }
                    }
                }
            }

            // 🛡️ [CONFIDENCE LOCK]: If we have a high-confidence match on an early page, stop searching.
            if (bestBlock && bestBlock.pageIndex < blockPage && bestSimilarity > 0.75) {
                console.log(`[ZONE-SEQUENTIAL] 🛡️ Found early match for "${label}" at P${bestBlock.pageIndex}. Terminating search before P${blockPage}.`);
                break;
            }

            let accumulatedText = "";

            // 🛡️ [ACCUMULATIVE-WINDOW]: Look ahead up to 5 blocks to handle fragmentation
            for (let j = i; j < Math.min(i + 5, sortedBlocks.length); j++) {
                const currentBlock = sortedBlocks[j];
                if (currentBlock.pageIndex !== blockPage) break;

                accumulatedText += (currentBlock.text || "") + " ";
                const blockTextRaw = accumulatedText.trim();

                const details = SimilarityService.calculateHybridScore(blockTextRaw, targetFull, false, true);

                let anchorBonus = 0;
                if (labelRaw.length > 0) {
                    const exactRegex = new RegExp(`^${MarkingZoneService.escapeRegExp(labelRaw)}(?:[\\s\\.\\)]|$)`, 'i');
                    const parentRegex = parentLabel ? new RegExp(`^${MarkingZoneService.escapeRegExp(parentLabel)}(?:[\\s\\.\\)]|$)`, 'i') : null;
                    let suffixRegex: RegExp | null = null;
                    if (subPartLabel) {
                        suffixRegex = new RegExp(`^\\(?${MarkingZoneService.escapeRegExp(subPartLabel)}\\)(?:[\\s\\.]|$)`, 'i');
                    }

                    let isLabelMatch = exactRegex.test(blockTextRaw.trim()) || MarkingZoneService.checkLabelMatch(blockTextRaw, labelRaw);

                    // 🛡️ [NOISE-REJECTION]: Avoid matching naked page numbers as question anchors
                    if (isLabelMatch && !/question/i.test(blockTextRaw)) {
                        if (blockY > 92) { // Footer margin
                            isLabelMatch = false;
                        }
                    }

                    if (isLabelMatch && verifyMatch(textRaw, blockTextRaw)) {
                        anchorBonus = 0.5;
                    } else if (suffixRegex && suffixRegex.test(blockTextRaw.trim())) {
                        anchorBonus = 0.25;
                    } else if (parentRegex && parentRegex.test(blockTextRaw.trim())) {
                        anchorBonus = 0.20;
                    }
                }

                let finalScore = details.total + anchorBonus;

                // 🎯 IDENTITY GATE:
                if (labelRaw) {
                    const targetMatch = labelRaw.match(/^(\d+)([a-z]+)?/i);
                    const blockMatch = blockTextRaw.match(/^(?:\W+)?(?:question\s+)?(\d+|[Qq]\d+)([a-z]+)?/i);

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
                }

                if (finalScore > bestSimilarity) {
                    bestBlock = currentBlock;
                    bestSimilarity = finalScore;
                }
            }
        }

        // Dynamic threshold based on source length
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

    private static checkLabelMatch(text: string, label: string): boolean {
        if (!text || !label) return false;
        const cleanText = text.toLowerCase().trim();
        const cleanLabel = label.toLowerCase().trim();

        const escapedLabel = MarkingZoneService.escapeRegExp(cleanLabel);
        const patterns = [
            new RegExp(`^${escapedLabel}(?:[\\s\\.\\)]|$)`, 'i'),
            new RegExp(`^Question\\s+${escapedLabel}`, 'i')
        ];

        return patterns.some(p => p.test(cleanText));
    }
}