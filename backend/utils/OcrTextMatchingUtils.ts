/**
 * OCR Text Matching Utilities
 * 
 * Provides OCR-optimized text matching for segmentation boundary calculation.
 * Reuses question detection's sophisticated matching algorithms but optimized for OCR format.
 * 
 * Key differences from question detection:
 * - More aggressive substring matching (OCR is often truncated)
 * - Higher weight on key phrases (50% vs 40%) - handles truncation better
 * - Higher weight on word similarity (50% vs 40%) - handles OCR errors better
 * - No order-based scoring (0% vs 20%) - OCR order may be wrong due to splitting
 * - Lower threshold (0.50-0.60 vs 0.70) - OCR is noisier
 */

import { normalizeTextForComparison } from './TextNormalizationUtils.js';

/**
 * Preprocess OCR block text to remove artifacts and extract key content
 * Handles LaTeX environment prefixes that appear in OCR but not in database
 */
function preprocessOcrBlockForMatching(blockText: string): string {
  if (!blockText || typeof blockText !== 'string') {
    return '';
  }
  
  // Remove LaTeX environment artifacts (beginaligned, beginarray, etc.)
  // These appear in OCR output but not in database question text
  let cleaned = blockText
    .replace(/^(beginaligned|beginarray|endaligned|endarray)\s*/gi, '')
    .replace(/\s*(beginaligned|beginarray|endaligned|endarray)\s*$/gi, '')
    .trim();
  
  return cleaned;
}

/**
 * Extract key phrases from text that are important for matching
 * Reuses question detection's key phrase patterns
 */
function extractKeyPhrases(text: string): string[] {
  const phrases: string[] = [];
  
  // Common question patterns
  const patterns = [
    /work out how much/g,
    /work out the/g,
    /find the/g,
    /calculate the/g,
    /show that/g,
    /prove that/g,
    /solve the/g,
    /write down/g,
    /draw a/g,
    /complete the/g
  ];
  
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      phrases.push(...matches);
    }
  }
  
  // Extract numbers and units
  const numberPatterns = [
    /\d+\s*m²/g,
    /\d+\s*£/g,
    /\d+\s*pounds/g,
    /\d+\s*per\s+\w+/g,
    /\d+\s*bags/g,
    /\d+\s*seeds/g
  ];
  
  for (const pattern of numberPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      phrases.push(...matches);
    }
  }
  
  return phrases.map(p => p.toLowerCase().trim());
}

/**
 * Calculate similarity based on key phrases
 */
function calculateKeyPhraseSimilarity(phrases1: string[], phrases2: string[]): number {
  if (phrases1.length === 0 && phrases2.length === 0) return 1.0;
  if (phrases1.length === 0 || phrases2.length === 0) return 0.0;
  
  let matchedPhrases = 0;
  const usedPhrases2: Set<number> = new Set();
  
  for (const phrase1 of phrases1) {
    for (let i = 0; i < phrases2.length; i++) {
      if (usedPhrases2.has(i)) continue;
      if (phrase1 === phrases2[i]) {
        matchedPhrases++;
        usedPhrases2.add(i);
        break;
      }
    }
  }
  
  return matchedPhrases / Math.max(phrases1.length, phrases2.length);
}

/**
 * Compute Levenshtein edit distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;

  const dp: number[] = new Array(lenB + 1);
  for (let j = 0; j <= lenB; j++) dp[j] = j;

  for (let i = 1; i <= lenA; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= lenB; j++) {
      const temp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        dp[j] + 1,        // deletion
        dp[j - 1] + 1,    // insertion
        prev + cost       // substitution
      );
      prev = temp;
    }
  }
  return dp[lenB];
}

/**
 * Calculate similarity between OCR block text and database text
 * Optimized for OCR format with truncated blocks, LaTeX artifacts, and OCR errors
 * 
 * @param ocrBlockText - OCR block text (may be truncated, have LaTeX artifacts)
 * @param databaseText - Database question text (clean, complete)
 * @returns Similarity score between 0 and 1
 */
export function calculateOcrToDatabaseSimilarity(
  ocrBlockText: string,
  databaseText: string
): number {
  if (!ocrBlockText || !databaseText) return 0;

  // 1. Preprocess OCR block (remove LaTeX artifacts)
  const preprocessedOcr = preprocessOcrBlockForMatching(ocrBlockText);
  
  // 2. Normalize both texts (shared utility ensures consistency)
  const normOcr = normalizeTextForComparison(preprocessedOcr);
  const normDb = normalizeTextForComparison(databaseText);

  // 3. Exact match check
  if (normOcr === normDb) return 1.0;
  
  // 4. Aggressive substring matching for short/truncated OCR blocks
  // OCR blocks are often incomplete, so substring matching is crucial
  if (normOcr.length < 50 || normDb.length < 50) {
    if (normOcr.includes(normDb) || normDb.includes(normOcr)) {
      // Calculate substring similarity: length of shorter / length of longer
      const shorter = normOcr.length < normDb.length ? normOcr : normDb;
      const longer = normOcr.length >= normDb.length ? normOcr : normDb;
      const substringScore = shorter.length / longer.length;
      // Boost score for substring matches (minimum 0.7 for good substring matches)
      return Math.max(0.7, substringScore);
    }
  }

  // 5. Extract key phrases (important for question text identification)
  const keyPhrases1 = extractKeyPhrases(normOcr);
  const keyPhrases2 = extractKeyPhrases(normDb);
  const keyPhraseScore = calculateKeyPhraseSimilarity(keyPhrases1, keyPhrases2);

  // 6. Word-based similarity with fuzzy matching (handles OCR errors)
  const words1 = normOcr.split(' ').filter(w => w.length > 0);
  const words2 = normDb.split(' ').filter(w => w.length > 0);

  let matchedCount = 0;
  const usedWord2Indexes: Set<number> = new Set();
  
  for (let i = 0; i < words1.length; i++) {
    const queryWord = words1[i];
    let foundExact = false;

    // Try exact match first
    for (let j = 0; j < words2.length; j++) {
      if (usedWord2Indexes.has(j)) continue;
      if (queryWord === words2[j]) {
        usedWord2Indexes.add(j);
        matchedCount++;
        foundExact = true;
        break;
      }
    }

    if (foundExact) continue;

    // Fuzzy match using Levenshtein distance (handles OCR character errors)
    for (let j = 0; j < words2.length; j++) {
      if (usedWord2Indexes.has(j)) continue;
      const candidateWord = words2[j];
      const maxLen = Math.max(queryWord.length, candidateWord.length);
      const threshold = Math.floor(maxLen / 5); // heuristic: word length / 5
      const distance = levenshteinDistance(queryWord, candidateWord);
      if (distance <= threshold) {
        usedWord2Indexes.add(j);
        matchedCount++;
        break;
      }
    }
  }

  const totalWords = Math.max(words1.length, words2.length);
  const wordSimilarity = totalWords === 0 ? 0 : matchedCount / totalWords;

  // 7. Combine scores with OCR-optimized weights
  // Key phrases: 50% (most reliable for truncated OCR)
  // Word similarity: 50% (handles OCR errors)
  // Order: 0% (OCR order may be wrong due to splitting across blocks)
  const combinedScore = (keyPhraseScore * 0.5) + (wordSimilarity * 0.5);
  
  // Return the best score (combined or word similarity)
  return Math.max(combinedScore, wordSimilarity);
}

