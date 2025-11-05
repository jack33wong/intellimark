/**
 * SegmentationService
 * Maps OCR blocks to questions based on classification results.
 * 
 * Design principles:
 * - Fail fast: No fallbacks, throw clear errors if data is missing
 * - Single path: One clear logic flow, no complex fallback chains
 * - Question text filtering: Filter out question text blocks before passing to AI
 */

import * as stringSimilarity from 'string-similarity';
import type { PageOcrResult, MathBlock, MarkingTask } from '../../types/markingRouter.js';
import type { ClassificationResult } from './ClassificationService.js';

interface QuestionBoundary {
  questionNumber: string;
  pageIndex: number;
  y: number;
  questionText: string;
}

interface QuestionForFiltering {
  text?: string | null;
  databaseText?: string | null; // Database question text (from fullExamPapers)
  studentWork?: string | null; // Classification-extracted student work for main question
  subQuestions?: Array<{ 
    part?: string; 
    text?: string | null; 
    databaseText?: string | null;
    studentWork?: string | null; // Classification-extracted student work for sub-question
  }>;
  sourceImageIndex: number;
}

/**
 * Normalize text for comparison
 * Handles LaTeX formatting, question number prefixes, and punctuation
 */
function normalizeTextForComparison(text: string | null | undefined): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  // Remove LaTeX formatting: \( \), \[ \], \frac{}{}, \times, etc.
  let normalized = text
    .replace(/\\\(|\\\)/g, '') // Remove \( and \)
    .replace(/\\\[|\\\]/g, '') // Remove \[ and \]
    // IMPORTANT: Handle mixed numbers BEFORE converting \frac{}{} to a/b
    // Pattern: digit + \frac{}{} → "digit fraction" (e.g., "3\frac{4}{5}" → "3 4/5")
    .replace(/(\d+)\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 $2/$3') // Mixed numbers: 3\frac{4}{5} → 3 4/5
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1/$2') // Standalone fractions: \frac{a}{b} → a/b
    .replace(/\\times/g, 'x') // Convert \times to x
    .replace(/\\cdot/g, '*') // Convert \cdot to *
    .replace(/\\mathrm\{([^}]+)\}/g, '$1') // Remove \mathrm{}
    .replace(/\\/g, '') // Remove any remaining backslashes
    .replace(/\{|\}/g, '') // Remove braces
    .replace(/\$+/g, '') // Remove $ signs
  
  // Remove question number prefixes (e.g., "1 ", "2 (a)", "Q1 ", "Question 1")
  // BUT: Only if followed by common question words or if it's clearly a question number pattern
  // Don't remove numbers that are part of math expressions (e.g., "35 / 24")
  normalized = normalized
    .replace(/^q\d+[a-z]?\s+/i, '') // Remove "Q1 ", "Q2a ", etc.
    .replace(/^question\s+\d+[a-z]?\s+/i, '') // Remove "Question 1 ", etc.
    .replace(/^\d+[a-z]?\s*\([a-z]\)\s*/i, '') // Remove "2 (a) ", etc.
    // Only remove question number patterns if followed by question words (work, find, calculate, etc.)
    // CRITICAL: Don't remove if followed by math operators (=, +, -, /, ×, etc.) - this is a math expression
    // Match: "35 /" or "35=" or "35 +" etc. should NOT be removed (they're part of math)
    // Only remove if followed by question words like "35 work" or "35 find" (which shouldn't happen, but be safe)
    .replace(/^(\d+[a-z]?)\s+(?![+\-×÷*/=])/i, (match, num, offset, string) => {
      // Check what comes after the number and space
      const after = string.substring(offset + match.length);
      // If followed by math operator or number, keep it (it's part of a math expression)
      if (/^[+\-×÷*/=\d]/.test(after)) {
        return match; // Keep it (part of math expression like "35 / 24")
      }
      // If followed by question words, remove it (it's a question number)
      if (/^(work|find|calculate|simplify|solve|show|prove|write|draw|explain|state|give|describe|complete|fill|here|the|this|a\s|an\s|is|are|was|were)/i.test(after)) {
        return ''; // Remove it (it's a question number)
      }
      // Default: keep it (better safe than sorry - might be part of math expression)
      return match;
    })
  
  normalized = normalized
    .toLowerCase()
    .replace(/[^\w\s/]/g, ' ') // Remove punctuation (keep / for fractions)
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
  
  // Normalize whitespace around operators for better matching
  // This handles cases where "2 1/3 x 5/8" (with spaces) should match "2 1/3x5/8" (without spaces)
  normalized = normalized
    .replace(/\s+([x+\-×÷*/=])\s+/g, '$1') // Remove spaces around operators: "2 1/3 x 5/8" → "2 1/3x5/8"
    .replace(/\s+([x+\-×÷*/=])/g, '$1') // Remove space before operator: "2 1/3 x" → "2 1/3x"
    .replace(/([x+\-×÷*/=])\s+/g, '$1'); // Remove space after operator: "x 5/8" → "x5/8"
  
  return normalized.trim();
}

/**
 * Check if an OCR block matches classification-extracted student work
 * Used as a priority check to prevent filtering actual student work
 */
function matchesClassificationStudentWork(
  block: MathBlock & { pageIndex: number },
  classificationStudentWork: string
): boolean {
  if (!classificationStudentWork || !classificationStudentWork.trim()) {
    return false;
  }
  
  const blockText = block.mathpixLatex || block.googleVisionText || '';
  if (!blockText.trim()) return false;
  
  // Normalize both texts for comparison
  const normalizedBlock = normalizeTextForComparison(blockText);
  const normalizedStudentWork = normalizeTextForComparison(classificationStudentWork);
  
  if (!normalizedBlock || !normalizedStudentWork) return false;
  
  // Use fuzzy matching with threshold 0.70-0.80 (similar to question text matching)
  const similarity = stringSimilarity.compareTwoStrings(normalizedBlock, normalizedStudentWork);
  const threshold = 0.75; // Slightly higher threshold for student work matching
  
  // Also check for partial/substring matching (student work might be split across blocks)
  // Check both directions and use partial matching (first 20-30 chars) for better detection
  const blockContainsStudentWork = normalizedBlock.includes(normalizedStudentWork) || 
                                    normalizedStudentWork.includes(normalizedBlock) ||
                                    (normalizedBlock.length > 10 && normalizedStudentWork.length > 10 &&
                                     (normalizedBlock.includes(normalizedStudentWork.substring(0, Math.min(30, normalizedStudentWork.length))) ||
                                      normalizedStudentWork.includes(normalizedBlock.substring(0, Math.min(30, normalizedBlock.length)))));
  
  // Lower threshold if partial match is found (similarity 0.70+ is good enough if there's substring match)
  const isMatch = similarity >= threshold || 
                  (blockContainsStudentWork && similarity >= 0.70); // Increased from 0.60 to 0.70 for better accuracy
  
  if (isMatch) {
    console.log(`[STUDENT WORK MATCH] Block ${block.globalBlockId} matches classification student work (similarity: ${similarity.toFixed(3)})`);
  }
  
  return isMatch;
}

/**
 * Check if a block has student work indicators (negative check)
 * Used to prevent filtering actual student work that doesn't match question text
 */
function hasStudentWorkIndicators(block: MathBlock & { pageIndex: number }): boolean {
  const blockText = block.mathpixLatex || block.googleVisionText || '';
  if (!blockText.trim()) return false;
  
  // Remove LaTeX delimiters for matching
  const cleanedText = blockText.replace(/\\\[|\\\]/g, '').trim();
  
  // Indicator 1: Contains equals sign (definitive student work)
  if (cleanedText.includes('=')) {
    return true;
  }
  
  // Indicator 2: Math expression (number + operator/variable)
  const hasNumber = /\d/.test(cleanedText);
  const hasOperatorOrVariable = /[+\-^*/÷×nxyz£$€]/.test(cleanedText);
  if (hasNumber && hasOperatorOrVariable) {
    const wordCount = cleanedText.split(/\s+/).length;
    if (wordCount < 7) { // Short math expressions are likely student work
      return true;
    }
  }
  
  // Indicator 3: Standalone number or currency (likely answer)
  const isSingleNumOrCurrency = /^\s*[£$€]?[\d.,]+\s*$/.test(cleanedText.replace(/\\text\{.*?\}/g, ''));
  if (isSingleNumOrCurrency && cleanedText.length < 10) {
    return true;
  }
  
  // Indicator 4: Handwritten (from Google Vision)
  if ((block as any).isHandwritten === true) {
    return true;
  }
  
  return false;
}

function isQuestionTextBlock(
  block: MathBlock & { pageIndex: number },
  classificationQuestions: QuestionForFiltering[],
  similarityThreshold: number = 0.70
): boolean {
  const blockText = block.mathpixLatex || block.googleVisionText || '';
  if (!blockText.trim()) return false;
  
  const normalizedBlockText = normalizeTextForComparison(blockText);
  
  // Check if this is a Q2 block - dynamically determine Q2 page index
  // Q2 could be on different pages, so we check against classification questions
  let isQ2Block = false;
  for (const question of classificationQuestions) {
    const mainQNum = (question as any).questionNumber;
    if (mainQNum === '2' && question.sourceImageIndex === block.pageIndex) {
      isQ2Block = true;
      break;
    }
  }
  
  
  // PRIORITY CHECK: If block matches classification student work, don't filter it
  // This prevents filtering actual student work that classification identified
  for (const question of classificationQuestions) {
    if (question.sourceImageIndex !== block.pageIndex) continue;
    
  // Check main question student work
  if (question.studentWork) {
    if (matchesClassificationStudentWork(block, question.studentWork)) {
      console.log(`[QUESTION TEXT FILTER] Block ${block.globalBlockId} NOT filtered: matches classification student work for main question`);
      return false; // Don't filter - it's confirmed student work from classification
    }
  }
  
  // Check sub-question student work
  if (question.subQuestions && Array.isArray(question.subQuestions)) {
    for (const subQ of question.subQuestions) {
      if (subQ.studentWork) {
        if (matchesClassificationStudentWork(block, subQ.studentWork)) {
          console.log(`[QUESTION TEXT FILTER] Block ${block.globalBlockId} NOT filtered: matches classification student work for sub-question ${subQ.part || '?'}`);
          return false; // Don't filter - it's confirmed student work from classification
        }
      }
    }
  }
  }
  
  // Track best match for negative checking
  let bestSimilarity = 0;
  let bestMatch = false;
  
  // Check against all questions on the same page
  for (const question of classificationQuestions) {
    if (question.sourceImageIndex !== block.pageIndex) continue;
    
    // Use database question text (preferred) if available, otherwise fallback to classification text
    // This handles cases where questions are NOT past paper questions (not in database)
    const questionTextToUse = question.databaseText || question.text;
    if (questionTextToUse) {
      const normalizedQuestionText = normalizeTextForComparison(questionTextToUse);
      if (normalizedQuestionText) { // Only compare if normalized text is not empty
        const similarity = stringSimilarity.compareTwoStrings(normalizedBlockText, normalizedQuestionText);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
        }
        const source = question.databaseText ? 'database' : 'classification (fallback - not past paper)';
        if (isQ2Block) {
          console.log(`[Q2 DEBUG] Block ${block.globalBlockId} vs main Q2 text (${source}): similarity=${similarity.toFixed(3)} ${similarity >= similarityThreshold ? '→ FILTERED' : '→ PASS'}`);
        }
        if (similarity >= similarityThreshold) {
          bestMatch = true;
          console.log(`[QUESTION TEXT FILTER] Block ${block.globalBlockId} filtered: matches question text (${source}, similarity: ${similarity.toFixed(3)})`);
          return true;
        }
      }
    }
    
    // Check sub-question texts with simplified strategies
    if (question.subQuestions && Array.isArray(question.subQuestions)) {
      for (const subQ of question.subQuestions) {
        // Use database text (preferred) if available, otherwise fallback to classification text
        // This handles cases where questions are NOT past paper questions (not in database)
        const subQTextToUse = subQ.databaseText || subQ.text;
        if (subQTextToUse) { // Only check if text exists and is not null/empty
          const normalizedSubQText = normalizeTextForComparison(subQTextToUse);
          if (normalizedSubQText) { // Only compare if normalized text is not empty
            
            // Strategy 1: Full text similarity
            const similarity = stringSimilarity.compareTwoStrings(normalizedBlockText, normalizedSubQText);
            
            // Strategy 2: Simple substring matching - check if block is a substring of question text
            // Remove LaTeX environment prefixes (beginaligned, beginarray, etc.) for better matching
            // These prefixes appear in OCR output but not in database question text
            const blockWithoutEnv = normalizedBlockText.replace(/^(beginaligned|beginarray|endaligned|endarray)\s*/i, '').trim();
            const blockIsSubstringOfQuestion = normalizedSubQText.includes(normalizedBlockText) || 
                                               normalizedSubQText.includes(blockWithoutEnv);
            
            // For question text containing math expressions, use lower threshold to catch question text blocks
            // Math expressions in question text can have slight OCR variations (spacing, LaTeX formatting)
            const isMathExpressionInQuestion = /\d+[\s/]*\d*\s*[+\-×÷*/x]\s*\d+/.test(normalizedSubQText) || 
                                               /\d+\s*\/\s*\d+/.test(normalizedSubQText);
            const finalThreshold = isMathExpressionInQuestion ? 0.65 : similarityThreshold;
            
            // Match if: full similarity high OR block is substring of question text
            const isMatch = similarity >= finalThreshold || blockIsSubstringOfQuestion;
            
            // Track best similarity for negative checking
            if (similarity > bestSimilarity) {
              bestSimilarity = similarity;
            }
            
            if (isQ2Block) {
              const subQPart = (subQ as any).part || 'unknown';
              const source = subQ.databaseText ? 'database' : 'classification (fallback - not past paper)';
              const matchReason = blockIsSubstringOfQuestion ? 'substring' : 'full';
              console.log(`[Q2 DEBUG] Block ${block.globalBlockId} vs Q2${subQPart} text (${source}): similarity=${similarity.toFixed(3)}, substring=${blockIsSubstringOfQuestion} ${isMatch ? `→ FILTERED (${matchReason})` : '→ PASS'}`);
            }
            
            if (isMatch) {
              bestMatch = true;
              const source = subQ.databaseText ? 'database' : 'classification (fallback - not past paper)';
              console.log(`[QUESTION TEXT FILTER] Block ${block.globalBlockId} filtered: matches sub-question text (${source}, similarity: ${similarity.toFixed(3)})`);
              return true;
            }
          }
        }
      }
    }
  }
  
  // Negative check: If block doesn't match question text (low similarity) but has student work indicators,
  // don't filter it - it's likely student work, not question text
  // BUT: Only if it's NOT a substring of question text (e.g., example working in question text)
  const LOW_SIMILARITY_THRESHOLD = 0.30; // If similarity < 0.30, it's definitely not question text
  if (bestSimilarity < LOW_SIMILARITY_THRESHOLD && !bestMatch) {
    // Simple substring check: Remove LaTeX environment prefixes and check if block is substring of question text
    const blockWithoutEnv = normalizedBlockText.replace(/^(beginaligned|beginarray|endaligned|endarray)\s*/i, '').trim();
    
    let isSubstringOfAnyQuestion = false;
    for (const question of classificationQuestions) {
      if (question.sourceImageIndex !== block.pageIndex) continue;
      const questionTextToCheck = question.databaseText || question.text;
      if (questionTextToCheck) {
        const normalizedQuestionText = normalizeTextForComparison(questionTextToCheck);
        if (normalizedQuestionText && (
          normalizedQuestionText.includes(normalizedBlockText) || 
          normalizedQuestionText.includes(blockWithoutEnv)
        )) {
          isSubstringOfAnyQuestion = true;
          break;
        }
      }
      if (question.subQuestions && Array.isArray(question.subQuestions)) {
        for (const subQ of question.subQuestions) {
          const subQTextToCheck = subQ.databaseText || subQ.text;
          if (subQTextToCheck) {
            const normalizedSubQText = normalizeTextForComparison(subQTextToCheck);
            if (normalizedSubQText && (
              normalizedSubQText.includes(normalizedBlockText) || 
              normalizedSubQText.includes(blockWithoutEnv)
            )) {
              isSubstringOfAnyQuestion = true;
              break;
            }
          }
        }
      }
      if (isSubstringOfAnyQuestion) break;
    }
    
    if (hasStudentWorkIndicators(block) && !isSubstringOfAnyQuestion) {
      if (isQ2Block) {
        console.log(`[Q2 DEBUG] Block ${block.globalBlockId} → PASS (negative check: similarity=${bestSimilarity.toFixed(3)} < ${LOW_SIMILARITY_THRESHOLD}, has student work indicators, NOT substring of question)`);
      }
      console.log(`[QUESTION TEXT FILTER] Block ${block.globalBlockId} NOT filtered: low similarity (${bestSimilarity.toFixed(3)}) but has student work indicators`);
      return false; // Don't filter - it's student work
    } else if (isSubstringOfAnyQuestion) {
      // Block is a substring of question text - filter it even if it has student work indicators
      console.log(`[QUESTION TEXT FILTER] Block ${block.globalBlockId} filtered: is substring of question text`);
      return true; // Filter it - it's question text
    }
  }
  
  return false;
}

/**
 * Find question start boundaries using fuzzy text matching
 * NOTE: This is currently unused - we use page-based assignment instead
 * Kept for potential future use or debugging
 */
function findQuestionStartBoundaries(
  allRawLines: Array<any & { pageIndex: number; globalIndex: number }>,
  questions: Array<{ questionNumber?: string | null; text?: string | null; sourceImageIndex?: number }>
): QuestionBoundary[] {
  const boundaries: QuestionBoundary[] = [];
  
  for (const question of questions) {
    if (!question.questionNumber) continue;
    if (!question.text) {
      console.warn(`[SEGMENTATION] Skipping boundary detection for Q${question.questionNumber} - no text available`);
      continue;
    }
    
    const pageIndex = question.sourceImageIndex ?? 0;
    const questionText = question.text;
    console.log(`[SEGMENTATION] Looking for boundary: Q${question.questionNumber} on Page ${pageIndex}, text: "${questionText.substring(0, 50)}..."`);
    const normalizedQuestionText = normalizeTextForComparison(questionText);
    const questionStartSnippet = normalizedQuestionText.slice(0, 50); // First 50 chars for matching
    const questionEndSnippet = normalizedQuestionText.slice(-30); // Last 30 chars for matching
    
    // Get all OCR lines for this page
    const pageLines = allRawLines.filter(line => line.pageIndex === pageIndex);
    if (pageLines.length === 0) {
      console.warn(`[SEGMENTATION] ⚠️ No OCR lines found for Page ${pageIndex} (Q${question.questionNumber})`);
      console.warn(`[SEGMENTATION]   Available page indices in OCR: ${[...new Set(allRawLines.map(l => l.pageIndex))].sort().join(', ')}`);
      console.warn(`[SEGMENTATION]   Question text: "${questionText.substring(0, 60)}..."`);
      continue;
    }
    
    // Try matching against combined text (concatenate up to 5 consecutive lines)
    let bestMatch: { lineIndex: number; score: number; y: number; matchedText: string } | null = null;
    
    // First, try to find a line that contains the question text (even if split)
    // We'll match against the first significant words of the question
    const questionWords = normalizedQuestionText.split(/\s+/).filter(w => w.length > 2).slice(0, 5).join(' ');
    
    for (let i = 0; i < pageLines.length; i++) {
      // Try single line first
      const singleLine = pageLines[i];
      const singleLineText = (singleLine.text || '').trim();
      if (!singleLineText) continue;
      
      const normalizedLine = normalizeTextForComparison(singleLineText);
      
      // Try matching start snippet (first 50 chars)
      const startMatch = normalizedLine.includes(questionStartSnippet) ? 0.70 : 0;
      
      // Try matching end snippet (last 30 chars)
      const endMatch = normalizedLine.includes(questionEndSnippet) ? 0.75 : 0;
      
      // Try full similarity
      const fullSimilarity = stringSimilarity.compareTwoStrings(normalizedLine, normalizedQuestionText);
      
      // Try partial similarity (first 50 chars)
      const partialSimilarity = stringSimilarity.compareTwoStrings(
        normalizedLine.slice(0, 50),
        questionStartSnippet
      );
      
      // Try substring matching (OCR might contain question text as substring)
      // Check if OCR line contains the normalized question text (or vice versa)
      const containsMatch = normalizedLine.includes(questionStartSnippet) || 
                           normalizedQuestionText.includes(normalizedLine.slice(0, 50)) ? 0.65 : 0;
      
      // Try matching key words (first 5 significant words)
      const keyWordsMatch = normalizedLine.includes(questionWords) ? 0.60 : 0;
      
      const score = Math.max(fullSimilarity, partialSimilarity, startMatch, endMatch, containsMatch, keyWordsMatch);
      
      // Use lower threshold: 0.50 for short text, 0.55 for long text
      const threshold = normalizedQuestionText.length < 50 ? 0.50 : 0.55;
      
      if (score >= threshold && (!bestMatch || score > bestMatch.score)) {
        const coords = extractBoundingBox(singleLine);
        if (coords) {
          bestMatch = {
            lineIndex: i,
            score,
            y: coords.y,
            matchedText: singleLineText.substring(0, 80)
          };
        }
      }
      
      // Try combining with next 1-4 lines (up to 5 lines total)
      let combinedText = singleLineText;
      for (let j = 1; j <= 4 && i + j < pageLines.length; j++) {
        const nextLine = pageLines[i + j];
        const nextLineText = (nextLine.text || '').trim();
        if (!nextLineText) continue; // Skip empty lines but continue
        
        combinedText += ' ' + nextLineText;
        const normalizedCombined = normalizeTextForComparison(combinedText);
        
        // Try matching against combined text
        const combinedSimilarity = stringSimilarity.compareTwoStrings(normalizedCombined, normalizedQuestionText);
        const combinedStartMatch = normalizedCombined.includes(questionStartSnippet) ? 0.70 : 0;
        const combinedEndMatch = normalizedCombined.includes(questionEndSnippet) ? 0.75 : 0;
        
        // Try substring matching for combined text
        const combinedContainsMatch = normalizedCombined.includes(questionStartSnippet) || 
                                     normalizedQuestionText.includes(normalizedCombined.slice(0, 50)) ? 0.65 : 0;
        
        // Try key words matching for combined text
        const combinedKeyWordsMatch = normalizedCombined.includes(questionWords) ? 0.60 : 0;
        
        const combinedScore = Math.max(combinedSimilarity, combinedStartMatch, combinedEndMatch, combinedContainsMatch, combinedKeyWordsMatch);
        const threshold = normalizedQuestionText.length < 50 ? 0.50 : 0.55;
        
        if (combinedScore >= threshold && (!bestMatch || combinedScore > bestMatch.score)) {
          const coords = extractBoundingBox(singleLine);
          if (coords) {
            bestMatch = {
              lineIndex: i,
              score: combinedScore,
              y: coords.y,
              matchedText: combinedText.substring(0, 80)
            };
          }
        }
      }
    }
    
    if (bestMatch) {
      boundaries.push({
        questionNumber: String(question.questionNumber),
        pageIndex: pageIndex,
        y: bestMatch.y,
        questionText
      });
      console.log(`[SEGMENTATION] ✅ Found boundary for Q${question.questionNumber} on Page ${pageIndex} (Y: ${bestMatch.y}, similarity: ${bestMatch.score.toFixed(3)})`);
      console.log(`[SEGMENTATION]   Matched text: "${bestMatch.matchedText}..."`);
    } else {
      // Debug: show what OCR text is available on this page
      const sampleTexts = pageLines.slice(0, 5).map(line => (line.text || '').substring(0, 60)).filter(t => t);
      console.warn(`[SEGMENTATION] ⚠️ Could not find boundary for Q${question.questionNumber} on Page ${pageIndex}`);
      console.warn(`[SEGMENTATION]   Question text: "${questionText.substring(0, 60)}..."`);
      console.warn(`[SEGMENTATION]   Normalized question: "${normalizedQuestionText.substring(0, 60)}..."`);
      console.warn(`[SEGMENTATION]   Question words: "${questionWords}"`);
      console.warn(`[SEGMENTATION]   Available OCR lines (first 5): ${sampleTexts.length > 0 ? sampleTexts.join(' | ') : 'none'}`);
      
      // Show normalized versions of first few OCR lines
      const normalizedSampleTexts = pageLines.slice(0, 3).map(line => {
        const normalized = normalizeTextForComparison(line.text || '');
        return normalized.substring(0, 60);
      }).filter(t => t);
      console.warn(`[SEGMENTATION]   Normalized OCR lines (first 3): ${normalizedSampleTexts.join(' | ')}`);
    }
  }
  
  return boundaries;
}

/**
 * Extract bounding box from OCR line
 */
function extractBoundingBox(line: any): { x: number; y: number; width: number; height: number } | null {
  if (line.bounding_box) {
    const bbox = line.bounding_box;
    return {
      x: bbox.x0 || 0,
      y: bbox.y0 || 0,
      width: (bbox.x1 || 0) - (bbox.x0 || 0),
      height: (bbox.y1 || 0) - (bbox.y0 || 0)
    };
  }
  if (line.coordinates) {
    return line.coordinates;
  }
  return null;
}

/**
 * Assign block to question based on Y position
 * NOTE: This is currently unused - we use page-based assignment instead
 * Kept for potential future use or debugging
 */
function assignBlockToQuestion(
  block: MathBlock & { pageIndex: number },
  boundaries: QuestionBoundary[]
): string | null {
  if (!block.coordinates?.y) return null;
  
  const blockY = block.coordinates.y;
  const blockPage = block.pageIndex;
  
  // Find the question boundary that this block is below
  // Sort boundaries by Y position (top to bottom)
  const pageBoundaries = boundaries
    .filter(b => b.pageIndex === blockPage)
    .sort((a, b) => a.y - b.y);
  
  // Find the last (bottommost) boundary that the block is below
  let assignedQuestion: string | null = null;
  for (const boundary of pageBoundaries) {
    if (blockY >= boundary.y) {
      assignedQuestion = boundary.questionNumber;
    } else {
      break; // Block is above this boundary, stop searching
    }
  }
  
  return assignedQuestion;
}

/**
 * Extract base question number (e.g., "2a" -> "2", "21" -> "21")
 */
function getBaseQuestionNumber(questionNumber: string): string {
  return questionNumber.replace(/[a-z]/i, '');
}

/**
 * Map classification question numbers to marking scheme keys
 * Returns a map: questionNumber -> schemeKey
 */
function mapQuestionsToSchemes(
  classificationQuestions: Array<{ questionNumber?: string | null; sourceImageIndex?: number }>,
  detectedSchemesMap: Map<string, any>
): Map<string, string> {
  const questionToSchemeMap = new Map<string, string>();
  const allSchemeKeys = Array.from(detectedSchemesMap.keys());
  
  for (const question of classificationQuestions) {
    if (!question.questionNumber) continue;
    
    const aiDetectedQNum = String(question.questionNumber);
    const baseQNum = getBaseQuestionNumber(aiDetectedQNum);
    
    // Find matching scheme key
    const matchingSchemeKey = allSchemeKeys.find(schemeKey => {
      const schemeQNum = schemeKey.split('_')[0];
      const baseSchemeQNum = getBaseQuestionNumber(schemeQNum);
      return baseSchemeQNum === baseQNum;
    });
    
    if (matchingSchemeKey) {
      questionToSchemeMap.set(aiDetectedQNum, matchingSchemeKey);
      console.log(`[SEGMENTATION] Mapped Q${aiDetectedQNum} → ${matchingSchemeKey}`);
    } else {
      console.warn(`[SEGMENTATION] ⚠️ No matching scheme found for Q${aiDetectedQNum}`);
    }
  }
  
  return questionToSchemeMap;
}

/**
 * Main segmentation function
 * 
 * @throws Error if required inputs are missing
 */
export function segmentOcrResultsByQuestion(
  allPagesOcrData: PageOcrResult[],
  classificationResult: ClassificationResult,
  detectedSchemesMap: Map<string, any>
): MarkingTask[] {
  // Fail fast: Validate inputs
  if (!allPagesOcrData || allPagesOcrData.length === 0) {
    throw new Error('[SEGMENTATION] No OCR data provided');
  }
  
  if (!classificationResult || !classificationResult.questions || classificationResult.questions.length === 0) {
    throw new Error('[SEGMENTATION] No classification questions found. Classification must succeed before segmentation.');
  }
  
  if (!detectedSchemesMap || detectedSchemesMap.size === 0) {
    throw new Error('[SEGMENTATION] No marking schemes detected. Question detection must succeed before segmentation.');
  }
  
  // 1. Consolidate all math blocks
  let allMathBlocks: Array<MathBlock & { pageIndex: number; globalBlockId: string }> = [];
  let blockCounter = 0;
  
  // Find Q2 page index for debugging
  let q2PageIndex: number | null = null;
  classificationResult.questions.forEach((q: any) => {
    const mainQuestionNumber = q.questionNumber;
    const pageIndex = (q as any).sourceImageIndex ?? 0;
    if (mainQuestionNumber === '2' || mainQuestionNumber === '2a' || mainQuestionNumber === '2b') {
      q2PageIndex = pageIndex;
    }
  });
  
  allPagesOcrData.forEach((pageResult) => {
    const mathBlocks = pageResult.ocrData?.mathBlocks || [];
    
    // Q2 debugging: Show math blocks from OCR parsing
    if (q2PageIndex !== null && pageResult.pageIndex === q2PageIndex) {
      console.log(`[Q2 DEBUG] Math blocks from OCR parsing on Page ${pageResult.pageIndex}: ${mathBlocks.length} blocks`);
      mathBlocks.forEach((block, idx) => {
        const text = block.mathpixLatex || block.googleVisionText || '';
        const yPos = block.coordinates?.y ?? -1;
        console.log(`[Q2 DEBUG] OCR parsed block ${idx + 1}/${mathBlocks.length} (Y=${yPos}): "${text.substring(0, 80)}${text.length >= 80 ? '...' : ''}"`);
      });
    }
    
    mathBlocks.forEach((block) => {
      allMathBlocks.push({
        ...block,
        pageIndex: pageResult.pageIndex,
        globalBlockId: `block_${blockCounter++}`
      });
    });
  });
  
  console.log(`[SEGMENTATION] Consolidated ${allMathBlocks.length} math blocks`);
  
  // 2. Filter out empty blocks
  const studentWorkBlocks = allMathBlocks.filter(block =>
    (block.mathpixLatex || block.googleVisionText || '').trim().length > 0
  );
  
  if (studentWorkBlocks.length === 0) {
    console.warn(`[SEGMENTATION] No student work blocks found`);
    return [];
  }
  
  // 3. Flatten hierarchical questions structure (main + subQuestions -> flat array)
  const flattenedQuestions: Array<{
    questionNumber: string;
    text?: string | null;
    sourceImageIndex: number;
    subQuestionPart?: string;
  }> = [];
  
  classificationResult.questions.forEach((q: any) => {
    const mainQuestionNumber = q.questionNumber;
    const pageIndex = (q as any).sourceImageIndex ?? 0;
    
    // If question has sub-questions, create separate entries for each sub-question
    if (q.subQuestions && Array.isArray(q.subQuestions) && q.subQuestions.length > 0) {
      q.subQuestions.forEach((subQ) => {
        const combinedQuestionNumber = mainQuestionNumber 
          ? `${mainQuestionNumber}${subQ.part || ''}` 
          : null;
        if (combinedQuestionNumber) {
          flattenedQuestions.push({
            questionNumber: combinedQuestionNumber,
            text: subQ.text || q.text || null,
            sourceImageIndex: pageIndex,
            subQuestionPart: subQ.part
          });
        }
      });
    } else if (mainQuestionNumber) {
      // Main question without sub-questions
      flattenedQuestions.push({
        questionNumber: String(mainQuestionNumber),
        text: q.text || null,
        sourceImageIndex: pageIndex
      });
    }
  });
  
  if (flattenedQuestions.length === 0) {
    throw new Error('[SEGMENTATION] No valid questions found after flattening classification structure');
  }
  
  console.log(`[SEGMENTATION] Flattened ${flattenedQuestions.length} question(s) from classification`);
  
  // 4. Map questions to marking schemes
  const questionToSchemeMap = mapQuestionsToSchemes(flattenedQuestions, detectedSchemesMap);
  
  if (questionToSchemeMap.size === 0) {
    throw new Error('[SEGMENTATION] No questions could be mapped to marking schemes');
  }
  
  // 5. Build originalQuestionsForFiltering with database question text (directly from detectedSchemesMap to avoid duplication)
  const originalQuestionsForFiltering: QuestionForFiltering[] = [];
  
  classificationResult.questions.forEach((q: any) => {
    const mainQuestionNumber = q.questionNumber;
    const pageIndex = (q as any).sourceImageIndex ?? 0;
    
    // Look up scheme directly using questionToSchemeMap to get database question text
    // This avoids duplication - we get the text directly from detectedSchemesMap
    // For grouped sub-questions, the map might have "2a" or "2b" but not "2", so try sub-questions first
    let schemeKey: string | undefined = questionToSchemeMap.get(mainQuestionNumber);
    let scheme = schemeKey ? detectedSchemesMap.get(schemeKey) : null;
    
    // If not found and has sub-questions, try looking up using the first sub-question number
    if (!scheme && q.subQuestions && Array.isArray(q.subQuestions) && q.subQuestions.length > 0) {
      const firstSubQNumber = `${mainQuestionNumber}${q.subQuestions[0].part || ''}`;
      schemeKey = questionToSchemeMap.get(firstSubQNumber);
      scheme = schemeKey ? detectedSchemesMap.get(schemeKey) : null;
    }
    
    const databaseQuestionText = scheme?.databaseQuestionText || null;
    
    // For sub-questions: check if they're grouped or individual
    const subQuestionsWithDatabaseText: Array<{ 
      part?: string; 
      text?: string | null; 
      databaseText?: string | null;
      studentWork?: string | null;
    }> = [];
    
    if (q.subQuestions && Array.isArray(q.subQuestions)) {
      q.subQuestions.forEach((subQ: any) => {
        // For grouped sub-questions: use the same combined database text (no duplication)
        // For individual sub-questions: look up their own scheme
        let subQDatabaseText: string | null = null;
        
        if (scheme?.subQuestionNumbers && Array.isArray(scheme.subQuestionNumbers) && scheme.subQuestionNumbers.length > 1) {
          // This is a grouped question - all sub-questions share the same combined database text
          subQDatabaseText = databaseQuestionText; // Reuse the same text reference (no duplication)
        } else {
          // Individual sub-question - try to find its own scheme
          const subQNumber = `${mainQuestionNumber}${subQ.part || ''}`;
          const subQSchemeKey = questionToSchemeMap.get(subQNumber);
          const subQScheme = subQSchemeKey ? detectedSchemesMap.get(subQSchemeKey) : null;
          subQDatabaseText = subQScheme?.databaseQuestionText || null;
        }
        
        subQuestionsWithDatabaseText.push({
          part: subQ.part,
          text: subQ.text, // Classification text (fallback)
          databaseText: subQDatabaseText, // Database question text (preferred, no duplication)
          studentWork: subQ.studentWork !== undefined ? (subQ.studentWork || null) : undefined // Classification-extracted student work
        });
      });
    }
    
    // Store original for filtering
    // IMPORTANT: Use database text if available (past paper questions), otherwise fallback to classification text (non-past paper questions)
    // This ensures ALL questions are included in filtering, whether they're in the database or not
    originalQuestionsForFiltering.push({
      text: q.text, // Classification text (always available, used as fallback for non-past paper questions)
      databaseText: databaseQuestionText, // Database question text (only available for past paper questions, no duplication)
      studentWork: q.studentWork !== undefined ? (q.studentWork || null) : undefined, // Classification-extracted student work for main question
      subQuestions: subQuestionsWithDatabaseText.length > 0 ? subQuestionsWithDatabaseText : q.subQuestions,
      sourceImageIndex: pageIndex
    });
  });
  
  // 6. Build raw lines for question text filtering only
  // Note: We don't use boundary detection anymore since classification is unstable
  // We rely on page-based assignment instead
  let allRawLines: Array<any & { pageIndex: number; globalIndex: number }> = [];
  let lineCounter = 0;
  allPagesOcrData.forEach((pageResult, pageIdx) => {
    const rawLineData = pageResult.ocrData?.rawResponse?.rawLineData || [];
    
    // Q2 debugging: Show raw OCR lines for Q2 page
    if (q2PageIndex !== null && pageIdx === q2PageIndex) {
      console.log(`[Q2 DEBUG] Raw OCR lines on Page ${pageIdx}: ${rawLineData.length} lines`);
      rawLineData.forEach((line: any, i: number) => {
        const text = line.latex_styled || line.text || '';
        const coords = line.region ? `(x=${line.region.x || line.region.top_left_x}, y=${line.region.y || line.region.top_left_y})` : 'no coords';
        console.log(`[Q2 DEBUG] Raw line ${i + 1}/${rawLineData.length} ${coords}: "${text.substring(0, 80)}${text.length >= 80 ? '...' : ''}"`);
      });
    }
    
    allRawLines.push(...rawLineData.map((line: any, i: number) => ({
      ...line,
      pageIndex: pageIdx,
      globalIndex: lineCounter++
    })));
  });
  
  // 6. Assign blocks to questions (simplified: use page-based assignment only)
  // Since classification is unstable, we rely on page index and question number mapping
  // rather than trying to match text for precise boundary detection
  const blocksByQuestion: Map<string, (MathBlock & { pageIndex: number })[]> = new Map();
  
  // Group blocks by page
  const blocksByPage = new Map<number, Array<MathBlock & { pageIndex: number }>>();
  studentWorkBlocks.forEach(block => {
    if (!blocksByPage.has(block.pageIndex)) {
      blocksByPage.set(block.pageIndex, []);
    }
    blocksByPage.get(block.pageIndex)!.push(block);
  });
  
  // Q2 debugging: Show all blocks on all pages
  if (q2PageIndex !== null) {
    console.log(`[Q2 DEBUG] Q2 pageIndex from classification: ${q2PageIndex}`);
    console.log(`[Q2 DEBUG] Total blocks by page: ${Array.from(blocksByPage.entries()).map(([p, b]) => `Page ${p}: ${b.length} blocks`).join(', ')}`);
    if (blocksByPage.has(q2PageIndex)) {
      const q2PageBlocks = blocksByPage.get(q2PageIndex)!;
      console.log(`[Q2 DEBUG] Blocks on Q2 page (${q2PageIndex}): ${q2PageBlocks.length} blocks`);
      q2PageBlocks.forEach((block, idx) => {
        const blockText = (block.mathpixLatex || block.googleVisionText || '').substring(0, 60);
        const yPos = block.coordinates?.y ?? -1;
        console.log(`[Q2 DEBUG] Q2 page block ${idx + 1}/${q2PageBlocks.length} (${block.globalBlockId}, Y=${yPos}): "${blockText}${blockText.length >= 60 ? '...' : ''}"`);
      });
    } else {
      console.log(`[Q2 DEBUG] ⚠️ No blocks found on Q2 page (${q2PageIndex})!`);
    }
  }
  
  // Create a map of page -> question numbers from flattenedQuestions
  const pageToQuestionMap = new Map<number, Array<{ questionNumber: string; schemeKey: string }>>();
  flattenedQuestions.forEach(q => {
    const pageIdx = q.sourceImageIndex;
    const schemeKey = questionToSchemeMap.get(q.questionNumber);
    if (schemeKey) {
      if (!pageToQuestionMap.has(pageIdx)) {
        pageToQuestionMap.set(pageIdx, []);
      }
      pageToQuestionMap.get(pageIdx)!.push({ questionNumber: q.questionNumber, schemeKey });
    }
  });
  
  // Assign blocks by page index and question number mapping
  // All blocks on a page are assigned to the first question detected on that page
  // Sub-questions on the same page share the same scheme key (already grouped)
  for (const [pageIndex, blocksOnPage] of blocksByPage.entries()) {
    const questionsOnPage = pageToQuestionMap.get(pageIndex);
    if (!questionsOnPage || questionsOnPage.length === 0) {
      console.warn(`[SEGMENTATION] ⚠️ No questions found for Page ${pageIndex}, skipping blocks`);
      continue;
    }
    
    // Use the first question on this page (sub-questions share the same scheme key)
    const firstQuestion = questionsOnPage[0];
    const schemeKey = firstQuestion.schemeKey;
    
    // Q2 debugging: Check if this page contains Q2 blocks
    const isQ2Page = schemeKey.includes('2_');
    if (isQ2Page) {
      console.log(`[Q2 DEBUG] Page ${pageIndex}: ${blocksOnPage.length} total blocks before filtering`);
      console.log(`[Q2 DEBUG] Scheme key: ${schemeKey}`);
      blocksOnPage.forEach((block, idx) => {
        const blockText = (block.mathpixLatex || block.googleVisionText || '').substring(0, 80);
        const yPos = block.coordinates?.y ?? -1;
        console.log(`[Q2 DEBUG] Block ${idx + 1}/${blocksOnPage.length} (${block.globalBlockId}, Y=${yPos}): "${blockText}${blockText.length >= 80 ? '...' : ''}"`);
      });
    }
    
    // Step 1: First pass - filter out question text blocks using text matching
    const questionTextBlocks: Array<MathBlock & { pageIndex: number }> = [];
    const initiallyFilteredBlocks = blocksOnPage.filter(block => {
      if (isQuestionTextBlock(block, originalQuestionsForFiltering)) {
        questionTextBlocks.push(block);
        console.log(`[QUESTION TEXT FILTER] Block ${block.globalBlockId} filtered out (matches question text)`);
        return false;
      }
      return true;
    });
    
    // Step 2: Calculate Y range from question text blocks (if any were found)
    let questionTextYRange: { minY: number; maxY: number } | null = null;
    if (questionTextBlocks.length > 0) {
      const yPositions = questionTextBlocks
        .map(block => {
          const y = block.coordinates?.y ?? null;
          const height = block.coordinates?.height ?? 50; // Default height if missing
          return y !== null ? { startY: y, endY: y + height } : null;
        })
        .filter((range): range is { startY: number; endY: number } => range !== null);
      
      if (yPositions.length > 0) {
        const minY = Math.min(...yPositions.map(r => r.startY));
        const maxY = Math.max(...yPositions.map(r => r.endY));
        questionTextYRange = { minY, maxY };
        
        if (isQ2Page) {
          console.log(`[Y-RANGE FILTER] Calculated question text Y range for Page ${pageIndex}: ${minY} - ${maxY} (from ${questionTextBlocks.length} question text blocks)`);
          questionTextBlocks.forEach((block, idx) => {
            const y = block.coordinates?.y ?? -1;
            const height = block.coordinates?.height ?? 50;
            console.log(`[Y-RANGE FILTER] Question text block ${idx + 1}/${questionTextBlocks.length}: Y=${y}, height=${height}`);
          });
        }
      }
    }
    
    // Step 3: Second pass - filter blocks within Y range (unless confirmed student work)
    const filteredBlocks = initiallyFilteredBlocks.filter(block => {
      // If we have a Y range and this block is within it, check if it should be filtered
      if (questionTextYRange) {
        const blockY = block.coordinates?.y ?? null;
        const blockHeight = block.coordinates?.height ?? 50;
        
        if (blockY !== null) {
          const blockStartY = blockY;
          const blockEndY = blockY + blockHeight;
          
          // Check if block overlaps with question text Y range
          const isWithinRange = (
            (blockStartY >= questionTextYRange.minY && blockStartY <= questionTextYRange.maxY) ||
            (blockEndY >= questionTextYRange.minY && blockEndY <= questionTextYRange.maxY) ||
            (blockStartY <= questionTextYRange.minY && blockEndY >= questionTextYRange.maxY)
          );
          
          if (isWithinRange) {
            // Check if this block matches classification student work (don't filter if it does)
            let matchesStudentWork = false;
            for (const question of originalQuestionsForFiltering) {
              if (question.sourceImageIndex !== block.pageIndex) continue;
              
              // Check main question student work
              if (question.studentWork) {
                if (matchesClassificationStudentWork(block, question.studentWork)) {
                  matchesStudentWork = true;
                  break;
                }
              }
              
              // Check sub-question student work
              if (question.subQuestions && Array.isArray(question.subQuestions)) {
                for (const subQ of question.subQuestions) {
                  if (subQ.studentWork) {
                    if (matchesClassificationStudentWork(block, subQ.studentWork)) {
                      matchesStudentWork = true;
                      break;
                    }
                  }
                }
                if (matchesStudentWork) break;
              }
            }
            
            if (!matchesStudentWork) {
              console.log(`[Y-RANGE FILTER] Block ${block.globalBlockId} filtered out (Y=${blockY} within question text range ${questionTextYRange.minY}-${questionTextYRange.maxY})`);
              if (isQ2Page) {
                const blockText = (block.mathpixLatex || block.googleVisionText || '').substring(0, 60);
                console.log(`[Y-RANGE FILTER] Block text: "${blockText}${blockText.length >= 60 ? '...' : ''}"`);
              }
              return false; // Filter it out
            } else {
              if (isQ2Page) {
                console.log(`[Y-RANGE FILTER] Block ${block.globalBlockId} NOT filtered (Y=${blockY} within range but matches classification student work)`);
              }
            }
          }
        }
      }
      return true; // Keep the block
    });
    
    if (isQ2Page) {
      const filteredCount = blocksOnPage.length - filteredBlocks.length;
      console.log(`[Q2 DEBUG] Page ${pageIndex}: ${filteredBlocks.length} blocks passed filter (${filteredCount} filtered out)`);
      if (filteredCount > 0) {
        const filteredOutBlocks = blocksOnPage.filter(block => 
          !filteredBlocks.some(fb => fb.globalBlockId === block.globalBlockId)
        );
        filteredOutBlocks.forEach((block, idx) => {
          const blockText = (block.mathpixLatex || block.googleVisionText || '').substring(0, 60);
          console.log(`[Q2 DEBUG] Filtered out block ${idx + 1}/${filteredCount} (${block.globalBlockId}): "${blockText}${blockText.length >= 60 ? '...' : ''}"`);
        });
      }
      filteredBlocks.forEach((block, idx) => {
        const blockText = (block.mathpixLatex || block.googleVisionText || '').substring(0, 80);
        const yPos = block.coordinates?.y ?? -1;
        console.log(`[Q2 DEBUG] Passed block ${idx + 1}/${filteredBlocks.length} (${block.globalBlockId}, Y=${yPos}): "${blockText}${blockText.length >= 80 ? '...' : ''}"`);
      });
    }
    
    if (filteredBlocks.length > 0) {
      if (!blocksByQuestion.has(schemeKey)) {
        blocksByQuestion.set(schemeKey, []);
      }
      blocksByQuestion.get(schemeKey)!.push(...filteredBlocks);
      console.log(`[SEGMENTATION] Assigned ${filteredBlocks.length} blocks from Page ${pageIndex} to ${schemeKey}`);
    }
  }
  
  // 8. Create marking tasks
  const tasks: MarkingTask[] = [];
  for (const [schemeKey, blocks] of blocksByQuestion.entries()) {
    // Q2 debugging: Log what blocks are being passed to AI for Q2
    if (schemeKey.includes('2_')) {
      console.log(`[Q2 DEBUG] Creating marking task for ${schemeKey} with ${blocks.length} blocks`);
      blocks.forEach((block, idx) => {
        const blockText = (block.mathpixLatex || block.googleVisionText || '').substring(0, 80);
        console.log(`[Q2 DEBUG] Task block ${idx + 1}/${blocks.length} (${block.globalBlockId}, page ${block.pageIndex}): "${blockText}${blockText.length >= 80 ? '...' : ''}"`);
      });
    }
    
    if (blocks.length === 0) {
      console.warn(`[SEGMENTATION] No blocks assigned to ${schemeKey}, skipping`);
      continue;
    }
    
    // Sort blocks by page and Y position
    blocks.sort((a, b) => {
      if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
      return (a.coordinates?.y ?? 0) - (b.coordinates?.y ?? 0);
    });
    
    const sourcePages = [...new Set(blocks.map(b => b.pageIndex))].sort((a, b) => a - b);
    
    tasks.push({
      questionNumber: schemeKey,
      mathBlocks: blocks,
      markingScheme: null, // Will be set by router
      sourcePages
    });
    
    console.log(`[SEGMENTATION] Created task for ${schemeKey}: ${blocks.length} blocks from pages [${sourcePages.join(', ')}]`);
  }
  
  console.log(`[SEGMENTATION] ✅ Created ${tasks.length} marking task(s)`);
  return tasks;
}

