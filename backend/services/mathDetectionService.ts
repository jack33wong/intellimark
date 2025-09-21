/**
 * Math Detection Service
 * Detects math-like text regions from Google Vision OCR output
 */

import type { ProcessedVisionResult, BoundingBox } from "../types/index.js";

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

  // Check if it's clearly an English word/phrase (exclude these)
  const englishWordPattern = /^[a-zA-Z\s]+$/;
  if (englishWordPattern.test(t.trim()) && t.length > 3) {
    // Only exclude if it's a common English word, not mathematical terms
    const commonEnglishWords = [
      'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'question', 'answer', 'find', 'calculate', 'solve', 'show', 'prove', 'given',
      'particle', 'mass', 'attached', 'light', 'spring', 'natural', 'length',
      'modulus', 'elasticity', 'other', 'end', 'fixed', 'point', 'ceiling',
      'hanging', 'rest', 'vertically', 'below', 'pulled', 'downwards', 'released',
      'ignoring', 'external', 'resistances', 'speed', 'when', 'level', 'zero',
      'gravitational', 'potential', 'energy', 'kinetic', 'potential', 'elastic'
    ];
    
    const words = t.toLowerCase().split(/\s+/);
    const isCommonEnglish = words.every(word => commonEnglishWords.includes(word));
    if (isCommonEnglish) {
      return 0; // Exclude common English words
    }
  }

  // Mathematical features (more inclusive)
  const features = [
    /[=≠≈≤≥]/g,                    // Equality/inequality symbols
    /[+\-×÷*/]/g,                  // Basic operators
    /\b\d+\b/g,                    // Numbers
    /[()\[\]{}]/g,                 // Brackets
    /\|.*\|/g,                     // Absolute value
    /√|∑|∫|π|θ|λ|α|β|γ|δ|ε|ζ|η|θ|ι|κ|λ|μ|ν|ξ|ο|π|ρ|σ|τ|υ|φ|χ|ψ|ω/g, // Greek letters
    /\b\w\^\d/g,                   // Exponents
    /[^a-zA-Z0-9\s]/g              // Any non-alphanumeric characters (including foreign chars)
  ];

  let score = 0;
  for (const re of features) {
    const m = t.match(re);
    score += m ? Math.min(1, m.length / 3) : 0;
  }

  // Boost score for foreign characters (likely misrecognized math symbols)
  const foreignCharCount = (t.match(/[^\x00-\x7F]/g) || []).length;
  if (foreignCharCount > 0) {
    score += Math.min(0.5, foreignCharCount / 2); // Boost for foreign characters
  }

  // Boost score for short text with symbols (likely math)
  if (t.length <= 10 && (t.match(/[^a-zA-Z0-9\s]/g) || []).length > 0) {
    score += 0.3;
  }

  const symbolCount = (t.match(/[^a-zA-Z0-9\s]/g) || []).length;
  const numberCount = (t.match(/\b\d+\b/g) || []).length;
  const density = symbolCount / Math.max(4, t.length); // Lower threshold for shorter text
  const numberDensity = numberCount / Math.max(2, t.length); // Boost for number density
  score += density + numberDensity;

  return Math.max(0, Math.min(1, score / 2.5)); // Reduced divisor to be more inclusive
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

    // Use bounding boxes directly without additional merging
    const candidateBoxes = vision.boundingBoxes || [];

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
