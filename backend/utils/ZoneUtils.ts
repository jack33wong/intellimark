/**
 * ZoneUtils: The Single Source of Truth for Zone Lookup Logic.
 * eliminating the "Split-Brain" problem between Executor and Enrichment services.
 */

export interface SemanticZone {
    startY: number;
    endY: number;
    pageIndex: number;
    x?: number;
    label?: string; // Optional label for debugging
    headerBlockId?: string; // NEW: The ID of the question label block
}

export type SemanticZoneMap = Record<string, SemanticZone[]>;

export class ZoneUtils {

    /**
     * Standardizes label strings for comparison.
     * e.g., "(10)(b)(i)" -> "10bi", "Q1" -> "1"
     */
    static normalizeLabel(label: string): string {
        if (!label) return "";
        return label
            .toLowerCase()
            .replace(/[\(\)\s\[\]]/g, '') // Remove brackets, parens, spaces
            .replace(/^q/, '');           // Remove leading 'q' if present (e.g. q1 -> 1)
    }

    /**
     * Finds the correct zone for a given sub-question label.
     * Implements "Container Matching" to handle partial labels (e.g., "bi" -> "10bi").
     * * @param subQuestionLabel - The label from the AI (e.g., "bi", "a", "10bi")
     * @param zoneMap - The master map of physical zones
     * @returns The best matching zone, or null if not found.
     */
    static findMatchingZone(subQuestionLabel: string, zoneMap: SemanticZoneMap, questionPrefix?: string): SemanticZone | null {
        if (!subQuestionLabel || !zoneMap) return null;

        const target = this.normalizeLabel(subQuestionLabel); // e.g. "bi"
        const allKeys = Object.keys(zoneMap);

        // 1. Sort keys by length (Descending)
        // CRITICAL: We must check "10bii" before "10bi" to prevent "ii" matching the wrong container.
        const sortedKeys = allKeys.sort((a, b) => b.length - a.length);

        let bestMatchKey = "";

        for (const key of sortedKeys) {
            const normalizedKey = this.normalizeLabel(key); // e.g. "10bi"

            // 🛡️ [SCOPED MATCHING]: If we have a question prefix (e.g. "9"), 
            // ensure the zone key starts with it (e.g. "9a").
            // This prevents "a" from matching "11a" while marking Question 9.
            if (questionPrefix && !normalizedKey.startsWith(questionPrefix)) {
                continue;
            }

            // MATCHING STRATEGY:
            // 1. Exact Match: "10bi" === "10bi"
            // 2. Container Match (The Fix): "10bi".endsWith("bi") -> TRUE. 
            //    (The Zone Key contains the SubQ Label at the end)
            // 3. Forward Match (Rare): "bi".startsWith("10bi") (Usually false, but good safety)

            if (
                normalizedKey === target ||
                normalizedKey.endsWith(target) ||
                target.endsWith(normalizedKey)
            ) {
                bestMatchKey = key;
                break; // Stop at the first (longest) valid match
            }
        }

        if (bestMatchKey && zoneMap[bestMatchKey]?.length > 0) {
            return zoneMap[bestMatchKey][0];
        }

        return null;
    }

    /**
     * Helper to determine if a Y-coordinate is legally inside a zone.
     * Includes a standard tolerance buffer (default 5%).
     */
    static isPointInZone(y: number, zone: SemanticZone, tolerancePercent: number = 0.05): boolean {
        const height = zone.endY - zone.startY;
        const buffer = height * tolerancePercent;

        // Allow point to be slightly above or slightly below the strict lines
        return y >= (zone.startY - buffer) && y <= (zone.endY + buffer);
    }
}