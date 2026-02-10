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

            // 🛡️ [PAGE-AWARE LOOKUP]: Find the specific zone for this exact page
            const zone = ZoneUtils.findMatchingZone(
                mobile.subQuestion || "",
                semanticZones || {},
                undefined,
                mobile.pageIndex
            );

            for (let j = 0; j < sorted.length; j++) {
                if (i === j) continue;
                const fixed = sorted[j];
                if (!fixed.bbox) continue;

                // 🛡️ [PAGE-ISOLATION]: Only bonk into things on the same physical page
                if (mobile.pageIndex !== fixed.pageIndex) continue;

                const mobileBox = { x: mobile.bbox[0], y: mobile.bbox[1], w: mobile.bbox[2], h: mobile.bbox[3] };
                const fixedBox = { x: fixed.bbox[0], y: fixed.bbox[1], w: fixed.bbox[2], h: fixed.bbox[3] };

                // Reuse the private isOverlapping helper
                if (this.isOverlapping({ x: mobileBox.x, y: mobileBox.y, width: mobileBox.w, height: mobileBox.h }, { x: fixedBox.x, y: fixedBox.y, width: fixedBox.w, height: fixedBox.h })) {

                    // 🛡️ DESIGN REINFORCEMENT: 
                    // If both annotations are drawings in the same zone, allow them to overlap.
                    const isBothVisual = mobile.ocr_match_status === 'VISUAL' && fixed.ocr_match_status === 'VISUAL';
                    const isSameZone = mobile.subQuestion === fixed.subQuestion;

                    if (isBothVisual && isSameZone) {
                        // If they are almost exactly on top of each other
                        if (Math.abs(mobileBox.y - fixedBox.y) < 30) {
                            // Apply a diagonal shift to uncover the reasoning box below
                            mobile.bbox[1] += 120; // Move Down 120px
                            mobile.bbox[0] += 30; // Move Right 30px

                            // Boundary safety
                            if (zone) {
                                mobile.bbox[1] = Math.min(mobile.bbox[1], zone.endY - mobileBox.h - 15);
                            }
                        }
                        // Skip the "Push" logic entirely for these specific items
                        continue;
                    }

                    const isBelow = (mobileBox.y + mobileBox.h / 2) > (fixedBox.y + fixedBox.h / 2);
                    const padding = 2; // Tighter padding for cleaner look
                    let suggestedY = isBelow ? fixedBox.y + fixedBox.h + padding : fixedBox.y - mobileBox.h - padding;

                    if (zone) {
                        // REBOUND: If pushing UP hits the ceiling, push DOWN instead
                        if (suggestedY < zone.startY + 5) {
                            suggestedY = fixedBox.y + fixedBox.h + padding;
                        }
                        // Hard floor cap
                        suggestedY = Math.min(suggestedY, zone.endY - mobileBox.h - 5);
                    }
                    mobile.bbox[1] = suggestedY;
                    mobileBox.y = suggestedY;
                }
            }
        }
        return sorted;
    }
}
