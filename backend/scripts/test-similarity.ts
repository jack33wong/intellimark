/**
 * Test similarity calculation between test question and database question
 */

import { getFirestore } from '../config/firebase.js';

// Copy the IMPROVED similarity calculation from QuestionDetectionService
function calculateSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;

  // Enhanced normalization - remove diagram descriptions and extra details
  const normalize = (str: string) => str.toLowerCase()
    .replace(/\[.*?\]/g, '') // Remove [diagram description] blocks
    .replace(/diagram description.*?\./g, '') // Remove diagram descriptions
    .replace(/supplementary info.*?\./g, '') // Remove supplementary info
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  const norm1 = normalize(str1);
  const norm2 = normalize(str2);

  if (norm1 === norm2) return 1.0;

  // Extract key phrases that should match
  const keyPhrases1 = extractKeyPhrases(norm1);
  const keyPhrases2 = extractKeyPhrases(norm2);

  // Calculate key phrase similarity (higher weight)
  const keyPhraseScore = calculateKeyPhraseSimilarity(keyPhrases1, keyPhrases2);

  // Word-based similarity with fuzzy matching (Levenshtein)
  const words1 = norm1.split(' ');
  const words2 = norm2.split(' ');

  let matchedCount = 0;
  const usedWord2Indexes: Set<number> = new Set();
  const matchedWord2Indexes: Array<number | null> = [];
  const totalWords = Math.max(words1.length, words2.length);

  for (let i = 0; i < words1.length; i++) {
    const queryWord = words1[i];
    let foundExact = false;

    for (let j = 0; j < words2.length; j++) {
      if (usedWord2Indexes.has(j)) continue;
      if (queryWord === words2[j]) {
        usedWord2Indexes.add(j);
        matchedCount++;
        matchedWord2Indexes.push(j);
        foundExact = true;
        break;
      }
    }

    if (foundExact) continue;

    // Fuzzy match using Levenshtein distance
    for (let j = 0; j < words2.length; j++) {
      if (usedWord2Indexes.has(j)) continue;
      const candidateWord = words2[j];
      const maxLen = Math.max(queryWord.length, candidateWord.length);
      const threshold = Math.floor(maxLen / 5); // heuristic: word length / 5
      const distance = levenshteinDistance(queryWord, candidateWord);
      if (distance <= threshold) {
        usedWord2Indexes.add(j);
        matchedCount++;
        matchedWord2Indexes.push(j);
        break;
      }
    }

    // If no match found for this query word, record null to maintain order tracking
    if (matchedWord2Indexes.length < i + 1) {
      matchedWord2Indexes.push(null);
    }
  }

  const wordSimilarity = totalWords === 0 ? 0 : matchedCount / totalWords;

  // Order-based score: reward longest run of consecutive, in-order matches
  let longestRun = 0;
  let currentRun = 0;
  let prevJ: number | null = null;
  for (const j of matchedWord2Indexes) {
    if (j === null) {
      currentRun = 0;
      prevJ = null;
      continue;
    }
    if (prevJ !== null && j === prevJ + 1) {
      currentRun += 1;
    } else {
      currentRun = 1;
    }
    longestRun = Math.max(longestRun, currentRun);
    prevJ = j;
  }
  const orderScore = totalWords === 0 ? 0 : longestRun / totalWords;

  // Combine scores with weighted approach
  // Key phrases get 40% weight, word similarity gets 40%, order gets 20%
  const combinedScore = (keyPhraseScore * 0.4) + (wordSimilarity * 0.4) + (orderScore * 0.2);
  
  return Math.max(combinedScore, wordSimilarity, orderScore);
}

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

function levenshteinDistance(str1: string, str2: string): number {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
  
  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,     // deletion
        matrix[j - 1][i] + 1,     // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }
  
  return matrix[str2.length][str1.length];
}

async function testSimilarity() {
  try {
    const db = getFirestore();
    const doc = await db.collection('fullExamPapers').doc('c5396ea8-0d8e-4d26-bbd6-109ce48af49f').get();
    const data = doc.data();
    
    const question21 = data?.questions?.find((q: any) => q.question_number === '21');
    if (!question21) {
      console.log('Question 21 not found');
      return;
    }
    
    const dbQuestion = question21.question_text;
    const testQuestion = `The diagram shows a plan of Jason's garden.
ABCO and DEFO are rectangles.
CDO is a right-angled triangle.
AFO is a sector of a circle with centre O and angle AOF = 90°.

[D diagram description: A composite shape representing a garden plan. It consists of a rectangle ABCO with AB = 11m and BC = 7m. A rectangle DEFO with DE = 7m and EF = 9m. A right-angled triangle CDO. A sector of a circle AFO with centre O and angle AOF = 90°. The dimensions shown are AB = 11m, BC = 7m, EF = 9m, DE = 7m. Right angles are indicated at B, C, E, and at O for the sector AOF.]

Jason is going to cover his garden with grass seed.
Each bag of grass seed covers 14 m² of garden.
Each bag of grass seed costs £10.95

Work out how much it will cost Jason to buy all the bags of grass seed he needs.`;
    
    console.log('🔍 [SIMILARITY TEST]');
    console.log('=' .repeat(80));
    console.log('📋 [DATABASE QUESTION]:');
    console.log(dbQuestion);
    console.log('\n📋 [TEST QUESTION]:');
    console.log(testQuestion);
    
    const similarity = calculateSimilarity(testQuestion, dbQuestion);
    console.log('\n📊 [SIMILARITY SCORE]:', similarity);
    console.log('📊 [THRESHOLD NEEDED]: 0.5');
    console.log('📊 [MATCH RESULT]:', similarity > 0.5 ? '✅ MATCH' : '❌ NO MATCH');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testSimilarity();
