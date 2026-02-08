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

        // 1. Sort: MATCHED (Immovable) first.
        const sorted = [...annotations].sort((a, b) => {
            const scoreA = a.ocr_match_status === 'MATCHED' ? 2 : 1;
            const scoreB = b.ocr_match_status === 'MATCHED' ? 2 : 1;
            return scoreB - scoreA || (a.bbox?.[1] || 0) - (b.bbox?.[1] || 0);
        });

        for (let i = 0; i < sorted.length; i++) {
            const mobile = sorted[i];
            if (mobile.ocr_match_status === 'MATCHED' || !mobile.bbox) continue;

            // Find the "Legal Territory" for this specific annotation
            const zone = ZoneUtils.findMatchingZone(mobile.subQuestion || "", semanticZones || {});

            for (let j = 0; j < sorted.length; j++) {
                if (i === j) continue;
                const fixed = sorted[j];
                if (!fixed.bbox) continue;

                const mobileBox = { x: mobile.bbox[0], y: mobile.bbox[1], w: mobile.bbox[2], h: mobile.bbox[3] };
                const fixedBox = { x: fixed.bbox[0], y: fixed.bbox[1], w: fixed.bbox[2], h: fixed.bbox[3] };

                // Reuse the private isOverlapping helper
                if (this.isOverlapping({ x: mobileBox.x, y: mobileBox.y, width: mobileBox.w, height: mobileBox.h }, { x: fixedBox.x, y: fixedBox.y, width: fixedBox.w, height: fixedBox.h })) {
                    const isBelow = (mobileBox.y + mobileBox.h / 2) > (fixedBox.y + fixedBox.h / 2);
                    let suggestedY = isBelow ? fixedBox.y + fixedBox.h + 2 : fixedBox.y - mobileBox.h - 2;

                    if (zone) {
                        // 🏰 REBOUND LOGIC:
                        // If pushing UP violates the top of the zone, push DOWN instead
                        if (suggestedY < zone.startY) {
                            suggestedY = fixedBox.y + fixedBox.h + 2;
                        }

                        // Final boundary check to ensure it never leaves the box
                        // Give it 2px more breathing room so it doesn't trigger the boundary guard immediately
                        const finalClampedY = Math.max(zone.startY + 2, Math.min(suggestedY, zone.endY - mobileBox.h - 2));

                        // Apply the move (clamped position solves or improves overlap)
                        mobile.bbox[1] = finalClampedY;
                        mobileBox.y = finalClampedY;
                    } else {
                        mobile.bbox[1] = suggestedY;
                        mobileBox.y = suggestedY;
                    }
                }
            }
        }
        return sorted;
    }
}
