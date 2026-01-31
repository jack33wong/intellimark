import { verifyMatch } from './MarkingPositioningService.js';

export class MarkingZoneService {

    public static detectSemanticZones(
        rawBlocks: any[],
        pageHeight: number,
        expectedQuestions?: Array<{ label: string; text: string }>,
        nextQuestionText?: string,
        questionId?: string
    ) {
        // Output structure
        const zones: Record<string, Array<{ label: string; startY: number; endY: number; pageIndex: number; x: number; headerBlockId?: string }>> = {};

        if (!rawBlocks || !expectedQuestions) return zones;

        // 1. Sort blocks
        const sortedBlocks = [...rawBlocks].sort((a, b) => {
            const pageDiff = (a.pageIndex || 0) - (b.pageIndex || 0);
            if (pageDiff !== 0) return pageDiff;
            return MarkingZoneService.getY(a) - MarkingZoneService.getY(b);
        });

        let minSearchY = 0;
        let currentSearchPage = sortedBlocks[0]?.pageIndex || 0;
        const detectedLandmarks: Array<{ key: string; label: string; startY: number; pageIndex: number; x: number; headerBlockId?: string }> = [];

        // 2. Find Zone STARTS (Standard Logic)
        for (const eq of expectedQuestions) {
            let finalKey = eq.label;
            if (questionId && !eq.label.startsWith(questionId)) {
                finalKey = `${questionId}${eq.label}`;
            }

            const match = this.findBestBlock(
                sortedBlocks,
                eq.label,
                eq.text,
                currentSearchPage,
                minSearchY,
                `Start-${finalKey}`
            );

            if (match) {
                const blockY = MarkingZoneService.getY(match.block);
                detectedLandmarks.push({
                    key: finalKey,
                    label: eq.label,
                    startY: blockY,
                    pageIndex: match.block.pageIndex,
                    x: MarkingZoneService.getX(match.block),
                    headerBlockId: match.block.id || match.block.globalBlockId
                });

                currentSearchPage = match.block.pageIndex;
                minSearchY = MarkingZoneService.getY(match.block) + 10;
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

            // 🏗️ TVC START: If this is the FIRST landmark found on this page, snap to 0
            // This captures grids and headers above the label.
            let finalStartY = current.startY;
            if (!pagesWithFirstLandmark.has(current.pageIndex)) {
                console.log(`[ZONE-TVC] First on P${current.pageIndex}: Snapping ${current.key} start to 0`);
                finalStartY = 0;
                pagesWithFirstLandmark.add(current.pageIndex);
            }

            let endY = pageHeight - 50; // default: extend to footer

            if (next && next.pageIndex === current.pageIndex) {
                // Inter-question gap filling (Snap to start of next question)
                endY = next.startY;
            }
            else {
                // Last question on this page (or solo)
                if (nextQuestionText) {
                    const stopMatch = this.findBestBlock(
                        sortedBlocks,
                        "",
                        nextQuestionText,
                        current.pageIndex,
                        current.startY + 50,
                        `Stop-For-${current.key}`
                    );

                    if (stopMatch && stopMatch.block.pageIndex === current.pageIndex) {
                        endY = MarkingZoneService.getY(stopMatch.block);
                        console.log(`[ZONE-TVC] ${current.key} stopped by Stop-Marker at ${endY}`);
                    }
                }
            }

            if (!zones[current.key]) zones[current.key] = [];
            zones[current.key].push({
                label: current.key,
                startY: finalStartY,
                endY: endY,
                pageIndex: current.pageIndex,
                x: current.x,
                headerBlockId: current.headerBlockId
            });
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
                    zones[current.key].push({
                        label: current.key,
                        pageIndex: p,
                        startY: 0,
                        endY: pageHeight, // Full page
                        x: 0,
                        width: 100
                    } as any);
                }
            }
        }

        return zones;
    }

    // ---------------------------------------------------------
    // 🛠️ HELPERS (Unchanged)
    // ---------------------------------------------------------
    private static findBestBlock(
        sortedBlocks: any[],
        labelRaw: string,
        textRaw: string,
        minPage: number,
        minY: number,
        debugContext: string
    ): { block: any, similarity: number } | null {

        const label = this.normalize(labelRaw);
        const text = this.normalize(textRaw);
        const targetFull = `${label}${text}`;

        // Anchor Logic
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

            let accumulatedText = "";

            // 🛡️ [ACCUMULATIVE-WINDOW]: Look ahead up to 5 blocks to handle fragmentation
            // Instead of judging each block in isolation, we see if adding the next line improves the match.
            for (let j = i; j < Math.min(i + 5, sortedBlocks.length); j++) {
                const currentBlock = sortedBlocks[j];
                if (currentBlock.pageIndex !== blockPage) break;

                accumulatedText += (currentBlock.text || "") + " ";
                const blockTextRaw = accumulatedText.trim();
                const blockNorm = this.normalize(blockTextRaw);

                // Nuclear gate check for noise
                if (j === i && blockNorm.length < 3 && labelRaw.length === 0) {
                    continue;
                }

                let anchorBonus = 0;
                let isAnchorMatch = false;

                if (labelRaw.length > 0) {
                    const exactRegex = new RegExp(`^${this.escapeRegExp(labelRaw)}(?:[\\s\\.\\)]|$)`, 'i');
                    const parentRegex = parentLabel ? new RegExp(`^${this.escapeRegExp(parentLabel)}(?:[\\s\\.\\)]|$)`, 'i') : null;

                    let suffixRegex: RegExp | null = null;
                    if (subPartLabel) {
                        suffixRegex = new RegExp(`^\\(?${this.escapeRegExp(subPartLabel)}\\)(?:[\\s\\.]|$)`, 'i');
                    }

                    const isLabelMatch = exactRegex.test(blockTextRaw.trim()) || MarkingZoneService.checkLabelMatch(blockTextRaw, labelRaw);

                    if (isLabelMatch) {
                        const isConfirmed = verifyMatch(textRaw, blockTextRaw);
                        if (isConfirmed) {
                            anchorBonus = 0.5;
                            isAnchorMatch = true;
                        }
                    }
                    else if (suffixRegex && suffixRegex.test(blockTextRaw.trim())) {
                        anchorBonus = 0.25;
                        isAnchorMatch = true;
                    }
                    else if (parentRegex && parentRegex.test(blockTextRaw.trim())) {
                        anchorBonus = 0.20;
                        isAnchorMatch = true;
                    }
                }

                const simFull = this.calculateSimilarity(targetFull, blockNorm, isAnchorMatch);
                let finalScore = simFull + anchorBonus;

                if (finalScore > bestSimilarity) {
                    bestSimilarity = finalScore;
                    bestBlock = firstBlock; // Always anchor the zone to the FIRST physical block of the match
                }
            }
        }
        // 🎯 [THRESHOLD-RESTORED]: Restored to 0.5 because Accomulative Matching 
        // recovers fragments, making low similarity scores less likely for valid matches.
        return (bestBlock && bestSimilarity > 0.5) ? { block: bestBlock, similarity: bestSimilarity } : null;
    }

    public static generateInstructionHeatMap(rawBlocks: any[], expected: any, nextText: any): Set<string> {
        return new Set(); // Simplified for brevity in this fix block
    }

    // 🛡️ REPLACEMENT NORMALIZER (Strict: No Numbers)
    private static normalize(text: string): string {
        if (!text) return '';
        // 🚨 KEY CHANGE: Remove '0-9' from the regex. 
        // "3:4:8" becomes "" (Empty string)
        // "Len has 8 parcels" becomes "lenhasparcels"
        return text.toLowerCase().replace(/[^a-z]/g, '');
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

        const escapedLabel = this.escapeRegExp(cleanLabel);
        const patterns = [
            new RegExp(`^${escapedLabel}(?:[\\s\\.\\)]|$)`, 'i'),
            new RegExp(`^Question\\s+${escapedLabel}`, 'i')
        ];

        return patterns.some(p => p.test(cleanText));
    }

    private static calculateSimilarity(target: string, input: string, isAnchorMatch: boolean = false): number {
        if (!target || !input) return 0;
        if (!isAnchorMatch && target.length > 5 && input.length < target.length * 0.2) return 0;

        const getBigrams = (str: string) => {
            const bigrams = new Set<string>();
            for (let i = 0; i < str.length - 1; i++) {
                bigrams.add(str.substring(i, i + 2));
            }
            return bigrams;
        };
        const tB = getBigrams(target);
        const iB = getBigrams(input);
        let intersection = 0;
        tB.forEach(bg => { if (iB.has(bg)) intersection++; });
        return (2 * intersection) / (tB.size + iB.size);
    }
}