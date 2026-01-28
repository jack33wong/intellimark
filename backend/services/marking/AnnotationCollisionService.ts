import type { EnrichedAnnotation } from '../../types/index.js';
import { ZoneUtils } from '../../utils/ZoneUtils.js';

export class AnnotationCollisionService {
    /**
     * Helper: Check if two boxes overlap with optional padding
     */
    private static isOverlapping(a: { x: number, y: number, width: number, height: number }, b: { x: number, y: number, width: number, height: number }, padding = 5) {
        return (
            a.x < b.x + b.width + padding &&
            a.x + a.width + padding > b.x &&
            a.y < b.y + b.height + padding &&
            a.y + a.height + padding > b.y
        );
    }

    /**
     * Resolves collisions between annotations on the same page.
     * MATCHED annotations are immovable anchors.
     * UNMATCHED/VISUAL annotations are mobile and will be shifted vertically to resolve overlaps.
     */
    public static resolveCollisions(
        annotations: EnrichedAnnotation[],
        semanticZones?: Record<string, any>
    ): EnrichedAnnotation[] {
        if (annotations.length <= 1) return annotations;

        // 1. Sort: MATCHED (Immovable) first, so they claim space first.
        // Then sort by Y position to resolve top-down.
        const sorted = [...annotations].sort((a, b) => {
            const scoreA = a.ocr_match_status === 'MATCHED' ? 2 : 1;
            const scoreB = b.ocr_match_status === 'MATCHED' ? 2 : 1;
            if (scoreA !== scoreB) return scoreB - scoreA; // High priority first
            return (a.bbox?.[1] || 0) - (b.bbox?.[1] || 0); // Top to bottom
        });

        // 2. Resolve
        for (let i = 0; i < sorted.length; i++) {
            const mobile = sorted[i];

            // If it's MATCHED, it effectively refuses to move (it's anchored to printed text)
            // We only move UNMATCHED/VISUAL items
            if (mobile.ocr_match_status === 'MATCHED') continue;
            if (!mobile.bbox) continue;

            const mobileBox = {
                x: mobile.bbox[0],
                y: mobile.bbox[1],
                width: mobile.bbox[2],
                height: mobile.bbox[3]
            };

            // Check against all *other* annotations
            for (let j = 0; j < sorted.length; j++) {
                if (i === j) continue;
                const fixed = sorted[j];
                if (!fixed.bbox) continue;

                const fixedBox = {
                    x: fixed.bbox[0],
                    y: fixed.bbox[1],
                    width: fixed.bbox[2],
                    height: fixed.bbox[3]
                };

                if (this.isOverlapping(mobileBox, fixedBox)) {
                    // 💥 COLLISION DETECTED

                    // Direction: Is Mobile originally "below" the Fixed item?
                    const isBelow = (mobileBox.y + mobileBox.height / 2) > (fixedBox.y + fixedBox.height / 2);

                    // Calculate Shift Needed (Height overlap + 10px padding)
                    let newY = mobileBox.y;
                    if (isBelow) {
                        // Push Down
                        newY = fixedBox.y + fixedBox.height + 10;
                    } else {
                        // Push Up
                        newY = fixedBox.y - mobileBox.height - 10;
                    }

                    // 🛡️ ZONE PROTECTION
                    // Before applying the move, check if it stays within the Zone
                    if (semanticZones && mobile.subQuestion) {
                        const zone = ZoneUtils.findMatchingZone(mobile.subQuestion, semanticZones);
                        if (zone) {
                            // Clamp Logic
                            if (newY < zone.startY) newY = zone.startY; // Hit Ceiling

                            if (zone.endY && newY + mobileBox.height > zone.endY) {
                                // Hit Floor -> Clamp to floor to prevent zone breach.
                                newY = Math.max(zone.startY, zone.endY - mobileBox.height);
                            }
                        }
                    }

                    // Apply Move
                    mobile.bbox[1] = newY;
                    mobileBox.y = newY; // Update local box for next comparison
                }
            }
        }

        return sorted;
    }
}
