export class MarkingZoneService {

    public static detectSemanticZones(
        rawBlocks: any[],
        pageHeight: number,
        expectedQuestions?: Array<{ label: string; text: string }>,
        nextQuestionText?: string,
        questionId?: string
    ) {
        // Output structure
        const zones: Record<string, Array<{ label: string; startY: number; endY: number; pageIndex: number; x: number }>> = {};

        if (!rawBlocks || !expectedQuestions) return zones;

        // 1. Sort blocks
        const sortedBlocks = [...rawBlocks].sort((a, b) => {
            const pageDiff = (a.pageIndex || 0) - (b.pageIndex || 0);
            if (pageDiff !== 0) return pageDiff;
            return MarkingZoneService.getY(a) - MarkingZoneService.getY(b);
        });

        let minSearchY = 0;
        let currentSearchPage = sortedBlocks[0]?.pageIndex || 0;
        const detectedLandmarks: Array<{ key: string; label: string; startY: number; pageIndex: number; x: number }> = [];

        // 2. Find Zone STARTS
        for (const eq of expectedQuestions) {
            let finalKey = eq.label;
            if (questionId && !eq.label.startsWith(questionId)) {
                finalKey = `${questionId}${eq.label}`;
            }

            // ✅ ROBUST SEARCH: Passes "6a" (Full Label) and "6" (Parent Label) implicitly logic
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
                if (isNaN(blockY)) {
                    console.log(`\x1b[31m[GETY-NaN] Q${questionId} matched block for ${eq.label} has NaN Y: ${JSON.stringify(match.block.coordinates || match.block.bbox)}\x1b[0m`);
                }

                detectedLandmarks.push({
                    key: finalKey,
                    label: eq.label,
                    startY: blockY,
                    pageIndex: match.block.pageIndex,
                    x: MarkingZoneService.getX(match.block)
                });

                currentSearchPage = match.block.pageIndex;
                minSearchY = MarkingZoneService.getY(match.block) + 10;

                // console.log(`✅ [MATCH] ${finalKey} found on P${match.block.pageIndex} (Sim: ${(match.similarity * 100).toFixed(0)}%)`);
            } else {
                // console.warn(`⚠️ [MISSING] Failed to find start for: ${finalKey}`);
            }
        }

        // 3. Find Zone ENDS
        for (let i = 0; i < detectedLandmarks.length; i++) {
            const current = detectedLandmarks[i];
            const next = detectedLandmarks[i + 1];

            let endY = pageHeight;
            let cutReason = "Page Bottom (Default)";

            if (next && next.pageIndex === current.pageIndex) {
                endY = next.startY;
                cutReason = `Next Sibling (${next.key})`;
            }
            else {
                // If there is no next sub-question on the same page, we MUST find a stop signal (next question text)
                if (nextQuestionText) {
                    const stopMatch = this.findBestBlock(
                        sortedBlocks,
                        "",
                        nextQuestionText,
                        current.pageIndex,
                        current.startY + 50,
                        `Stop-For-${current.key}`
                    );

                    if (stopMatch) {
                        if (stopMatch.block.pageIndex > current.pageIndex) {
                            endY = pageHeight;
                            cutReason = `Next Question is on P${stopMatch.block.pageIndex} (Fill Page)`;
                        } else {
                            endY = MarkingZoneService.getY(stopMatch.block);
                            cutReason = `Next Question Text (Sim: ${(stopMatch.similarity * 100).toFixed(0)}%)`;
                        }
                    } else {
                        // [STRICT-VETO] No next sibling and no stop signal found on current page
                        throw new Error(`[ZONE-REJECTION] Sub-question "${current.key}" has no clear ending. Next question text "${nextQuestionText.substring(0, 30)}..." was not found on Page ${current.pageIndex}.`);
                    }
                } else {
                    // No stop signal provided, and no next sibling on this or other pages.
                    // This is the terminal sub-question of the task.
                    endY = pageHeight;
                    cutReason = "Terminal Sub-question (End of Task)";
                }
            }

            zones[current.key] = [{
                label: current.key,
                startY: current.startY,
                endY: endY,
                pageIndex: current.pageIndex,
                x: current.x
            }];
        }

        // console.log(`🗺️ [ZONE-GEN] Final Keys: ${Object.keys(zones).join(', ')}`);
        return zones;
    }

    // ---------------------------------------------------------
    // 🛠️ MULTI-VIEW BLOCK FINDER (Updated for Parent Anchors)
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
        const targetContent = text;
        const targetSkeleton = this.mathSkeleton(textRaw);

        // Extract "Parent Label" (e.g. "6a" -> "6")
        // Matches leading digits
        const parentMatch = labelRaw.match(/^(\d+)/);
        const parentLabel = parentMatch ? parentMatch[1] : null;

        let bestBlock: any = null;
        let bestSimilarity = 0;

        for (const block of sortedBlocks) {
            const blockY = MarkingZoneService.getY(block);
            const blockPage = block.pageIndex || 0;

            if (blockPage < minPage) continue;
            if (blockPage === minPage && blockY < minY) continue;

            const blockTextRaw = block.text || "";
            const blockNorm = this.normalize(blockTextRaw);
            const blockSkeleton = this.mathSkeleton(blockTextRaw);

            // --- ANCHOR STRATEGY ---
            let anchorBonus = 0;
            let isAnchorMatch = false;

            if (labelRaw.length > 0) {
                // 1. Exact Anchor (Starts with "6a")
                const exactRegex = new RegExp(`^${this.escapeRegExp(labelRaw)}(?:[\\s\\.\\)]|$)`, 'i');
                if (exactRegex.test(blockTextRaw.trim())) {
                    anchorBonus = 0.3;
                    isAnchorMatch = true;
                }
                // 2. ✅ PARENT ANCHOR (Starts with "6") - New Fix!
                else if (parentLabel) {
                    const parentRegex = new RegExp(`^${this.escapeRegExp(parentLabel)}(?:[\\s\\.\\)]|$)`, 'i');
                    if (parentRegex.test(blockTextRaw.trim())) {
                        anchorBonus = 0.25; // High confidence for Parent ID
                        isAnchorMatch = true;
                    }
                }
            }

            // --- MULTI-VIEW SCORING ---
            const simFull = this.calculateSimilarity(targetFull, blockNorm, isAnchorMatch);
            const simContent = this.calculateSimilarity(targetContent, blockNorm, isAnchorMatch);
            const simSkeleton = this.calculateSimilarity(targetSkeleton, blockSkeleton, isAnchorMatch);

            const maxSim = Math.max(simFull, simContent, simSkeleton);
            const finalScore = maxSim + anchorBonus;

            if (finalScore > bestSimilarity) {
                bestSimilarity = finalScore;
                bestBlock = block;
            }
        }

        // Standard threshold 0.4.
        // With anchorBonus 0.25, even a 0.15 text match will pass.
        return (bestBlock && bestSimilarity > 0.4) ? { block: bestBlock, similarity: bestSimilarity } : null;
    }

    /**
     * NEW: Generates a Set of IDs for blocks that match the question text or instructions.
     * This "Heat Map" is used by Iron Dome to prevent bad anchors.
     */
    public static generateInstructionHeatMap(
        rawBlocks: any[],
        expectedQuestions?: Array<{ label: string; text: string }>,
        nextQuestionText?: string
    ): Set<string> {
        const heatMap = new Set<string>();
        if (!rawBlocks) return heatMap;

        const debugBuffer: string[] = [];
        // [DEBUG-HEATMAP] Log specific blocks of interest
        const targetBlocks = rawBlocks.filter(b => (b.text || "").includes("0.4"));
        if (targetBlocks.length > 0) {
            console.log(`\x1b[35m[HEATMAP-INPUT] Found ${targetBlocks.length} blocks with '0.4' in input: ${targetBlocks.map(b => b.id).join(', ')}\x1b[0m`);
        }

        const targets = expectedQuestions?.map(q => ({ label: q.label, text: q.text })).filter(t => !!t.text) || [];

        for (const block of rawBlocks) {
            const blockText = block.text || "";
            const normBlock = this.normalize(blockText);
            const skelBlock = this.mathSkeleton(blockText);

            // Check against each question target
            for (const target of targets) {
                const normTarget = this.normalize(target.text);
                const skelTarget = this.mathSkeleton(target.text);

                const simContent = this.calculateSimilarity(normTarget, normBlock);
                const simSkeleton = this.calculateSimilarity(skelTarget, skelBlock);

                // ALSO Check Label (Massive boost if block starts with "(a)" or "6a")
                let anchorBoost = 0;
                if (target.label) {
                    const exactRegex = new RegExp(`^\\(?${this.escapeRegExp(target.label)}[\\s\\.\\)]`, 'i');
                    if (exactRegex.test(blockText.trim())) anchorBoost = 0.3;
                }
                if (Math.max(simContent, simSkeleton) + anchorBoost > 0.4) {
                    const id = block.id || block.globalBlockId || block.blockId;
                    if (id) {
                        heatMap.add(id);
                        if (String(id).includes("p6_")) {
                            debugBuffer.push(`\x1b[32m[ACCEPT] ${id.padEnd(10)} | Sim: ${simContent.toFixed(2)} | Target: "${target.label}" | Text: "${blockText.substring(0, 40)}..."\x1b[0m`);
                        }
                    }
                    break;
                } else if (String(block.id).includes("p6_")) {
                    debugBuffer.push(`\x1b[31m[REJECT] ${String(block.id || 'NO-ID').padEnd(10)} | Sim: ${simContent.toFixed(2)} | Target: "${target.label}" | Text: "${blockText.substring(0, 40)}..."\x1b[0m`);
                }
            }

            // Check against Next Question Text (Stop Signal)
            if (nextQuestionText) {
                const normStop = this.normalize(nextQuestionText);
                const simStop = this.calculateSimilarity(normStop, normBlock);
                if (simStop > 0.4) {
                    const id = block.id || block.globalBlockId || block.blockId;
                    if (id) {
                        heatMap.add(id);
                    }
                }
            }
        }

        if (debugBuffer.length > 0) {
            console.log(`\n🔥 [HEAT MAP REPORT - Q6]`);
            console.log(debugBuffer.join('\n'));
            console.log(`--------------------------------------------------\n`);
        }

        return heatMap;
    }

    // --- HELPERS ---

    private static normalize(text: string): string {
        return (text || '')
            .toLowerCase()
            .replace(/\\(quad|mathrm|text|bf|it|tiny|small)/g, '')
            .replace(/[^a-z0-9]/g, '');
    }

    private static mathSkeleton(text: string): string {
        return (text || '')
            .toLowerCase()
            .replace(/\\[a-zA-Z]+/g, '')
            .replace(/[^a-z0-9]/g, '');
    }

    private static getY(block: any): number {
        if (Array.isArray(block.coordinates)) return block.coordinates[1];
        if (block.coordinates?.y != null) return block.coordinates.y;
        if (Array.isArray(block.bbox)) return block.bbox[1];
        if (Array.isArray(block.box_2d)) return block.box_2d[0]; // [ymin, xmin, ymax, xmax] pattern
        return 0;
    }

    private static getX(block: any): number {
        if (Array.isArray(block.coordinates)) return block.coordinates[0];
        if (block.coordinates?.x != null) return block.coordinates.x;
        if (Array.isArray(block.bbox)) return block.bbox[0];
        if (Array.isArray(block.box_2d)) return block.box_2d[1];
        return 0;
    }

    private static escapeRegExp(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private static calculateSimilarity(target: string, input: string, isAnchorMatch: boolean = false): number {
        if (!target || !input) return 0;

        // 🛡️ 20% LENGTH GUARD
        // IF we have a confirmed Anchor Match (e.g. "17"), we SKIP this check.
        // This allows a short block like "17 A ball..." (46 chars) to match a long target (266 chars).
        if (!isAnchorMatch) {
            if (target.length > 5 && input.length < target.length * 0.2) return 0;
        }

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