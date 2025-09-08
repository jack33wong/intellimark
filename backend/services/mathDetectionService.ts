/**
 * Math Detection Service
 * Detects math-like text regions from Google Vision OCR output
 */

import type { ProcessedVisionResult, BoundingBox } from "../types/index";

export interface MathBlock {
  googleVisionText: string;
  mathpixLatex?: string;
  confidence: number;
  mathLikenessScore: number;
  coordinates: { x: number; y: number; width: number; height: number };
  suspicious?: boolean;
}

function scoreMathLikeness(text: string): number {
  const t = text || "";
  if (!t.trim()) return 0;

  const features = [
    /[=≠≈≤≥]/g,
    /[+\-×÷*/]/g,
    /\b\d+\b/g,
    /[()\[\]{}]/g,
    /\|.*\|/g,
    /√|∑|∫|π|θ|λ/g,
    /\b\w\^\d/g
  ];

  let score = 0;
  for (const re of features) {
    const m = t.match(re);
    score += m ? Math.min(1, m.length / 3) : 0;
  }

  const symbolCount = (t.match(/[^a-zA-Z0-9\s]/g) || []).length;
  const density = symbolCount / Math.max(8, t.length);
  score += density;

  return Math.max(0, Math.min(1, score / 4));
}

function mergeNearbyBoxes(boxes: BoundingBox[], maxGapPx = 18): BoundingBox[] {
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: BoundingBox[] = [];

  for (const box of sorted) {
    const last = merged[merged.length - 1];
    if (
      last &&
      Math.abs(box.y - last.y) < maxGapPx &&
      box.x <= last.x + last.width + maxGapPx
    ) {
      const minX = Math.min(last.x, box.x);
      const maxX = Math.max(last.x + last.width, box.x + box.width);
      const minY = Math.min(last.y, box.y);
      const maxY = Math.max(last.y + last.height, box.y + box.height);
      last.x = minX;
      last.y = minY;
      last.width = maxX - minX;
      last.height = maxY - minY;
      last.text = `${last.text} ${box.text}`.trim();
      last.confidence = Math.min(last.confidence || 1, box.confidence || 1);
    } else {
      merged.push({ ...box });
    }
  }

  return merged;
}

export class MathDetectionService {
  static detectMathBlocks(vision: ProcessedVisionResult | null, threshold = 0.35): MathBlock[] {
    if (!vision) return [];

    const candidateBoxes = mergeNearbyBoxes(vision.boundingBoxes || []);

    const blocks: MathBlock[] = [];
    for (const b of candidateBoxes) {
      const score = scoreMathLikeness(b.text || "");
      if (score >= threshold) {
        const pipes = (b.text.match(/\|/g) || []).length;
        const suspicious = pipes === 1 || ((b.text.match(/[+\-×÷*/=]/g) || []).length > 2 && !(b.text.match(/\d/g) || []).length);

        blocks.push({
          googleVisionText: b.text,
          confidence: b.confidence || vision.confidence || 0.6,
          mathLikenessScore: score,
          coordinates: { x: b.x, y: b.y, width: b.width, height: b.height },
          suspicious
        });
      }
    }
    return blocks;
  }

  static getCropOptions(coords: { x: number; y: number; width: number; height: number }) {
    return {
      left: Math.max(0, Math.floor(coords.x)),
      top: Math.max(0, Math.floor(coords.y)),
      width: Math.max(1, Math.floor(coords.width)),
      height: Math.max(1, Math.floor(coords.height))
    };
  }
}
