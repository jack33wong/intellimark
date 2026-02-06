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
        const matches = this.findAllMatchingZones(subQuestionLabel, zoneMap, questionPrefix);
        return matches.length > 0 ? matches[0] : null;
    }

    /**
     * Finds ALL correct zones for a given sub-question label (useful for questions spanning pages).
     */
    static findAllMatchingZones(subQuestionLabel: string, zoneMap: SemanticZoneMap, questionPrefix?: string): SemanticZone[] {
        if (!subQuestionLabel || !zoneMap) return [];

        const target = this.normalizeLabel(subQuestionLabel); // e.g. "bi"
        const allKeys = Object.keys(zoneMap);

        // 1. Sort keys by length (Descending)
        // CRITICAL: We must check "10bii" before "10bi" to prevent "ii" matching the wrong container.
        const sortedKeys = allKeys.sort((a, b) => b.length - a.length);

        let bestMatchKey = "";

        for (const key of sortedKeys) {
            const normalizedKey = this.normalizeLabel(key); // e.g. "10bi"

            if (questionPrefix && !normalizedKey.startsWith(questionPrefix)) {
                continue;
            }

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
            return zoneMap[bestMatchKey];
        }

        return [];
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

    /**
     * MASTER CLAMP: Ensures a bounding box is physically inside its Semantic Zone.
     * Handles both X and Y axes.
     * @param box - The pixel box {x, y, width, height}
     * @param zone - The SemanticZone to clamp to
     * @param paddingPercent - The internal safe margin (default 5%)
     */
    static clampToZone(
        box: { x: number, y: number, width: number, height: number },
        zone: SemanticZone,
        paddingPercent: number = 0.05
    ): { x: number, y: number } {
        const zoneHeight = (zone.endY - zone.startY);
        const yPadding = Math.min(30, Math.round(zoneHeight * paddingPercent));

        // Horizontal clamping (User Request: Same margin for X,Y)
        const zoneStartX = zone.x ?? 0;
        const zoneWidth = (zone as any).width ?? 2000;
        const zoneEndX = zoneStartX + zoneWidth;
        const xPadding = Math.min(30, Math.round(zoneWidth * paddingPercent));

        let x = box.x;
        let y = box.y;

        // Vertical Clamping
        if (y < zone.startY + yPadding) {
            y = zone.startY + yPadding;
        } else if (y + box.height > zone.endY - yPadding) {
            y = Math.max(zone.startY + yPadding, zone.endY - box.height - yPadding);
        }

        // Horizontal Clamping
        if (x < zoneStartX + xPadding) {
            x = zoneStartX + xPadding;
        } else if (x + box.width > zoneEndX - xPadding) {
            x = Math.max(zoneStartX + xPadding, zoneEndX - box.width - xPadding);
        }

        return { x, y };
    }
}