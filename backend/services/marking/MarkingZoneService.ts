import { verifyMatch } from './MarkingPositioningService.js';
import { SimilarityService } from './SimilarityService.js';

export class MarkingZoneService {

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
                    x: 0, // [WIDTH-FIX]: Zones take the full page width by default
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
            let finalStartY = Math.max(0, current.startY - 150);

            if (!pagesWithFirstLandmark.has(current.pageIndex)) {
                console.log(`[ZONE-SMART] First on P${current.pageIndex}: Snapping ${current.key} start with 150px buffer`);
                pagesWithFirstLandmark.add(current.pageIndex);
            }

            const dims = pageDimensionsMap.get(current.pageIndex) || Array.from(pageDimensionsMap.values())[0] || { width: 2480, height: 3508 };
            const pW = dims.width || 2480;
            const pH = dims.height || 3508;
            const margin = 80;

            let endY = pH - 50; // default: extend to footer

            if (next && next.pageIndex === current.pageIndex) {
                // Inter-question gap filling (Snap to start of next question)
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
                    // 🛡️ [FALLBACK]: If no stop marker and it's the solo/last question, 
                    // cap it at 800px below startY to avoid "The Infini-Zone"
                    endY = Math.min(pH - margin, current.startY + 800);
                }
            }

            if (!zones[current.key]) zones[current.key] = [];
            zones[current.key].push({
                label: current.key,
                startY: finalStartY,
                endY: endY,
                pageIndex: current.pageIndex,
                x: margin,
                width: pW - (margin * 2),
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
                for (let p = current.pageIndex + 1; p < next.pageIndex; p++) {
                    console.log(`[ZONE-UPSTREAM] Filling full gap page: ${current.key} for P${p}`);
                    const pDims = pageDimensionsMap.get(p) || { width: 2480, height: 3508 };
                    const pW_bridge = pDims.width || 2480;
                    const pH_bridge = pDims.height || 3508;
                    const margin_bridge = 80;

                    zones[current.key].push({
                        label: current.key,
                        pageIndex: p,
                        startY: 0,
                        endY: pH_bridge, // Full page
                        x: margin_bridge,
                        width: pW_bridge - (margin_bridge * 2),
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
            // If we are jumping more than 2 pages, and we aren't in "Rescue Mode" (bestSimilarity > 0.95), reject.
            // This prevents Q5a (P23) from being accepted when we are currently on P17.
            const pageDiff = blockPage - minPage;
            if (pageDiff > 2 && bestSimilarity < 0.95) {
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