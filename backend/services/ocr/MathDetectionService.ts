/**
 * Math Detection Service
 * Handles mathematical expression detection and scoring
 */

import type { ProcessedVisionResult, MathBlock } from '../../types/index.js';

// Inline MathBlock interface from MathDetectionService
// MathBlock type imported from types/index.js

// Inline MathDetectionService functionality
export function scoreMathLikeness(text: string): number {
  const t = text || "";
  if (!t.trim()) return 0;

  // Check if it's clearly an English word/phrase (exclude these)
  const englishWordPattern = /^[a-zA-Z\s]+$/;
  if (englishWordPattern.test(t.trim()) && t.length > 3) {
    const commonEnglishWords = [
      'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'question', 'answer', 'find', 'calculate', 'solve', 'show', 'prove', 'given'
    ];

    const words = t.toLowerCase().split(/\s+/);
    const isCommonEnglish = words.every(word => commonEnglishWords.includes(word));
    if (isCommonEnglish) {
      return 0; // Exclude common English words
    }
  }

  // Mathematical features
  const features = [
    /[=≠≈≤≥]/g,                    // Equality/inequality symbols
    /[+\-×÷*/]/g,                  // Basic operators
    /\b\d+\b/g,                    // Numbers
    /[()\[\]{}]/g,                 // Brackets
    /\|.*\|/g,                     // Absolute value
    /√|∑|∫|π|θ|λ|α|β|γ|δ|ε|ζ|η|θ|ι|κ|λ|μ|ν|ξ|ο|π|ρ|σ|τ|υ|φ|χ|ψ|ω/g, // Greek letters
    /\b\w\^\d/g,                   // Exponents
    /\b\w_\d/g,                    // Subscripts
    /\b(sin|cos|tan|log|ln|exp|sqrt|abs|max|min|lim|sum|prod|int)\b/g, // Functions
    /\b(infinity|∞|inf)\b/g,       // Infinity
    /\b(pi|e|phi|gamma|alpha|beta|theta|lambda|mu|sigma|omega)\b/g, // Constants
    /\b(and|or|not|implies|iff|forall|exists)\b/g, // Logic
    /\b(if|then|else|when|where|given|let|assume|suppose|prove|show|find|solve|calculate)\b/g // Math words
  ];

  let score = 0;
  for (const feature of features) {
    const matches = t.match(feature);
    if (matches) {
      score += matches.length * 0.1;
    }
  }

  return Math.min(1, score);
}

export function detectMathBlocks(vision: ProcessedVisionResult | null, threshold = 0.35): MathBlock[] {
  if (!vision) return [];

  const candidateBoxes = vision.boundingBoxes || [];
  const blocks: MathBlock[] = [];

  for (const b of candidateBoxes) {
    const score = scoreMathLikeness(b.text || "");
    if (score >= threshold) {
      const pipes = (b.text.match(/\|/g) || []).length;
      const suspicious = pipes === 1 || ((b.text.match(/[+\-×÷*/=]/g) || []).length > 2 && !(b.text.match(/\d/g) || []).length);

      const finalConfidence = b.confidence || vision.confidence || score;

      blocks.push({
        googleVisionText: b.text,
        confidence: finalConfidence,
        mathLikenessScore: score,
        coordinates: { x: b.x, y: b.y, width: b.width, height: b.height },
        suspicious
      });
    }
  }
  return blocks;
}

export function getCropOptions(coords: { x: number; y: number; width: number; height: number }) {
  return {
    left: Math.max(0, Math.floor(coords.x)),
    top: Math.max(0, Math.floor(coords.y)),
    width: Math.max(1, Math.floor(coords.width)),
    height: Math.max(1, Math.floor(coords.height))
  };
}
