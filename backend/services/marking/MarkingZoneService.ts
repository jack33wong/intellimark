export class MarkingZoneService {

    /**
     * Scans raw OCR blocks to find coordinates using Full-String Similarity.
     * This handles OCR errors in labels (e.g., '(f)' vs '(i)') by letting the 
     * accuracy of the question text compensate for the label error.
     */
    public static detectSemanticZones(
        rawBlocks: any[],
        pageHeight: number,
        expectedQuestions?: Array<{ label: string; text: string }>
    ) {
        const zones: Record<string, Array<{ startY: number; endY: number; pageIndex: number; x: number }>> = {};

        if (!rawBlocks || !expectedQuestions) return zones;

        // 1. Sort blocks physically
        const sortedBlocks = [...rawBlocks].sort((a, b) => {
            if (a.pageIndex !== b.pageIndex) return (a.pageIndex || 0) - (b.pageIndex || 0);
            return (a.coordinates?.y || 0) - (b.coordinates?.y || 0);
        });

        // 2. Sequential Scanning State
        let minSearchY = 0;
        let currentSearchPage = sortedBlocks[0]?.pageIndex || 0;
        const detectedLandmarks: Array<{ label: string; startY: number; pageIndex: number; x: number }> = [];

        // 3. Iterate through expected questions
        for (const eq of expectedQuestions) {

            // Construct the "Master String" to search for.
            // e.g. "bi write down the probability that this person"
            // We combine the Label + The first 40 chars of text (enough to be unique, short enough to avoid layout issues)
            const cleanLabel = eq.label.replace(/^\d+/, '').toLowerCase().trim(); // "10bi" -> "bi"
            const searchTarget = this.normalize(`${cleanLabel} ${eq.text}`).substring(0, 50);

            let bestBlock: any = null;
            let bestSimilarity = 0;

            // Scan blocks
            for (const block of sortedBlocks) {
                // FORCE ORDER: Skip blocks physically above the previous question
                if (block.pageIndex < currentSearchPage) continue;
                if (block.pageIndex === currentSearchPage && (block.coordinates?.y || 0) < minSearchY) continue;

                // Compare "Block Text" vs "Target String"
                // We combine current block + next block to handle line-breaks
                const blockText = this.normalize(block.text || "");

                const similarity = this.calculateSimilarity(searchTarget, blockText);

                if (similarity > bestSimilarity) {
                    bestSimilarity = similarity;
                    bestBlock = block;
                }
            }

            // Threshold: 0.4 (40%) similarity is usually enough if the text is unique.
            // e.g. "(f) write down..." vs "(i) write down..." is ~90% similar.
            if (bestBlock && bestSimilarity > 0.4) {
                detectedLandmarks.push({
                    label: eq.label,
                    startY: bestBlock.coordinates?.y,
                    pageIndex: bestBlock.pageIndex,
                    x: bestBlock.coordinates?.x
                });

                // Update constraints for next loop
                currentSearchPage = bestBlock.pageIndex;
                minSearchY = bestBlock.coordinates?.y + 10;

                console.log(`✅ [MATCH] ${eq.label} found. Similarity: ${(bestSimilarity * 100).toFixed(0)}%`);
            }
        }

        // 4. Build Zones
        for (let i = 0; i < detectedLandmarks.length; i++) {
            const current = detectedLandmarks[i];
            const next = detectedLandmarks[i + 1];

            let endY = pageHeight;
            if (next && next.pageIndex === current.pageIndex) {
                endY = next.startY;
            } else {
                // 🛡️ [ZONE-CONSTRAINT] If no expected question follows, scan for ANY physical Question Header (e.g. "Q13")
                // to prevent the zone from consuming the rest of the page.
                const nextPhysicalHeader = sortedBlocks.find(b =>
                    b.pageIndex === current.pageIndex &&
                    (b.coordinates?.y || 0) > (current.startY + 50) && // Must be below current
                    /^Q\s*\d+/i.test(b.text || '') // Looks like "Q13" or "Q 13"
                );

                if (nextPhysicalHeader) {
                    endY = nextPhysicalHeader.coordinates?.y || pageHeight;
                    console.log(`   🛑 [ZONE-CUT] Zone ${current.label} capped at physical header "${nextPhysicalHeader.text}" (Y=${endY})`);
                }
            }

            zones[current.label] = [{
                startY: current.startY,
                endY: endY,
                pageIndex: current.pageIndex,
                x: current.x
            }];
        }

        return zones;
    }

    // --- HELPER: String Normalization ---
    // Removes non-alphanumeric noise to make comparison "Fuzzy" by default
    private static normalize(text: string): string {
        return (text || '')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, ''); // Remove spaces, parens, dots
    }

    // --- HELPER: Dice Coefficient Similarity ---
    // Compares how many bigrams (2-letter pairs) are shared between strings.
    // "hello" -> "he", "el", "ll", "lo"
    private static calculateSimilarity(target: string, input: string): number {
        if (!target || !input) return 0;

        // If input is much shorter than target, it's likely noise or a page number
        if (input.length < target.length * 0.2) return 0;

        const getBigrams = (str: string) => {
            const bigrams = new Set<string>();
            for (let i = 0; i < str.length - 1; i++) {
                bigrams.add(str.substring(i, i + 2));
            }
            return bigrams;
        };

        const targetBigrams = getBigrams(target);
        const inputBigrams = getBigrams(input);

        let intersection = 0;
        targetBigrams.forEach(bg => {
            if (inputBigrams.has(bg)) intersection++;
        });

        // Dice Coefficient Formula: (2 * intersection) / (len1 + len2)
        return (2 * intersection) / (targetBigrams.size + inputBigrams.size);
    }
}