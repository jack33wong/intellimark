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
import { getBaseQuestionNumber, normalizeTextForComparison, normalizeSubQuestionPart } from '../../utils/TextNormalizationUtils.js';
import { calculateOcrToDatabaseSimilarity } from '../../utils/OcrTextMatchingUtils.js';
import { QuestionTextFilter, type QuestionForFiltering as FilterQuestionForFiltering, type QuestionBoundary as FilterQuestionBoundary } from '../../utils/QuestionTextFilter.js';

interface QuestionBoundary {
  questionNumber: string;
  pageIndex: number;
  startY: number; // Start Y position of question text (top)
  endY: number | null; // End Y position of question text (bottom), null if not found
  questionText: string;
  maxOrderIndex?: number; // Maximum originalOrderIndex of question text blocks (for order-based assignment)
}

interface QuestionForFiltering {
  questionNumber?: string | null; // Question number from classification (e.g., "13", "14")
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

// normalizeTextForComparison is imported from TextNormalizationUtils
// Removed duplicate function definition - using shared utility

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
  
  const isQ5aBlock40 = block.pageIndex === 1 && (blockText.trim() === '40' || blockText.trim() === '40.' || blockText.trim() === '40,' || (blockText.includes('40') && blockText.length <= 5));
  const isQ4bBlock59 = block.pageIndex === 0 && (
    blockText.trim() === '5/9' || blockText.trim() === '5 / 9' || blockText.trim().includes('5/9') || 
    blockText.trim() === '\\frac{5}{9}' || blockText.trim().includes('frac{5}{9}')
  );
  
  // Special handling for single-letter blocks (e.g., "H", "F", "J" for Q12)
  // These are often answers to multiple-choice questions and need exact matching
  const blockTextTrimmed = blockText.trim();
  const isSingleLetter = blockTextTrimmed.length === 1 && /^[A-Z]$/i.test(blockTextTrimmed);
  const classificationTrimmed = classificationStudentWork.trim();
  const isSingleLetterInClassification = classificationTrimmed.length === 1 && /^[A-Z]$/i.test(classificationTrimmed);
  
  // For single letters, use exact case-insensitive matching (no normalization needed)
  if (isSingleLetter && isSingleLetterInClassification) {
    const match = blockTextTrimmed.toLowerCase() === classificationTrimmed.toLowerCase();
    if (match) {
      return true;
    }
  }
  
  // Normalize both texts for comparison
  const normalizedBlock = normalizeTextForComparison(blockText);
  const normalizedStudentWork = normalizeTextForComparison(classificationStudentWork);
  
  if (!normalizedBlock || !normalizedStudentWork) {
    if (isQ5aBlock40) {
      console.warn(`[Q5a "40" TRACE] matchesClassificationStudentWork: normalizedBlock="${normalizedBlock}", normalizedStudentWork="${normalizedStudentWork}"`);
    }
    return false;
  }
  
  // For single-letter blocks, also check if the normalized classification contains the letter
  // (e.g., classification might be "H\nF\nJ" but we're checking against "F")
  if (isSingleLetter) {
    const letterLower = blockTextTrimmed.toLowerCase();
    // Check if the classification student work (possibly multi-line) contains this single letter
    const classificationLines = classificationStudentWork.split(/\n|\\newline|\\\\/).map(l => l.trim()).filter(l => l.length > 0);
    if (classificationLines.some(line => line.toLowerCase() === letterLower)) {
      return true;
    }
  }
  
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
  
  // For short blocks (like "R=30", "3:4", "S:M:L"), use lower threshold
  // This handles cases where OCR format differs slightly from classification format
  const isShortBlock = normalizedBlock.length < 20 || normalizedStudentWork.length < 20;
  const shortBlockThreshold = isShortBlock ? 0.60 : 0.70; // Lowered from 0.65 to 0.60 for better short block matching
  
  // For very short blocks (like "3:4", "1:2", "S:M:L"), use even lower threshold
  // These are often ratios or simple expressions that OCR might format differently
  const isVeryShortBlock = normalizedBlock.length < 10 || normalizedStudentWork.length < 10;
  const veryShortBlockThreshold = isVeryShortBlock ? 0.50 : shortBlockThreshold;
  
  // Lower threshold if partial match is found (similarity 0.70+ is good enough if there's substring match)
  // For short blocks, use even lower threshold if there's substring match
  const isMatch = similarity >= threshold || 
                  (blockContainsStudentWork && similarity >= veryShortBlockThreshold);
  
  if (isQ5aBlock40) {
    console.log(`[Q5a "40" TRACE] matchesClassificationStudentWork: block="${blockText}" vs classification="${classificationStudentWork}"`);
    console.log(`[Q5a "40" TRACE] normalized: block="${normalizedBlock}" vs classification="${normalizedStudentWork}"`);
    console.log(`[Q5a "40" TRACE] similarity=${similarity.toFixed(3)}, threshold=${threshold}, shortBlockThreshold=${shortBlockThreshold}, veryShortBlockThreshold=${veryShortBlockThreshold}`);
    console.log(`[Q5a "40" TRACE] blockContainsStudentWork=${blockContainsStudentWork}, isShortBlock=${isShortBlock}, isVeryShortBlock=${isVeryShortBlock}`);
    console.log(`[Q5a "40" TRACE] isMatch=${isMatch}`);
  }
  
  if (isQ4bBlock59) {
    console.log(`[Q4b "5/9" TRACE] matchesClassificationStudentWork: block="${blockText}" vs classification="${classificationStudentWork}"`);
    console.log(`[Q4b "5/9" TRACE] normalized: block="${normalizedBlock}" vs classification="${normalizedStudentWork}"`);
    console.log(`[Q4b "5/9" TRACE] similarity=${similarity.toFixed(3)}, threshold=${threshold}, shortBlockThreshold=${shortBlockThreshold}, veryShortBlockThreshold=${veryShortBlockThreshold}`);
    console.log(`[Q4b "5/9" TRACE] blockContainsStudentWork=${blockContainsStudentWork}, isShortBlock=${isShortBlock}, isVeryShortBlock=${isVeryShortBlock}`);
    console.log(`[Q4b "5/9" TRACE] isMatch=${isMatch}`);
  }
  
  return isMatch;
}

/**
 * Check if OCR block matches any line in combined classification student work string
 * Used for validation in Step 3 (Y-position assignment)
 * Splits combined string into lines and checks each line individually
 */
function matchesClassificationStudentWorkByLine(
  block: MathBlock & { pageIndex: number },
  combinedClassificationStudentWork: string
): boolean {
  if (!combinedClassificationStudentWork || !combinedClassificationStudentWork.trim()) {
    return false;
  }
  
  const blockText = block.mathpixLatex || block.googleVisionText || '';
  if (!blockText.trim()) return false;
  
  // Split combined classification string into individual lines
  const classificationLines = combinedClassificationStudentWork.split(/\n|\\newline|\\\\/).map(l => l.trim()).filter(l => l.length > 0);
  
  // Check block against each line individually
  return classificationLines.some(line => {
    // For single letters, exact match
    const blockTextTrimmed = blockText.trim();
    if (blockTextTrimmed.length === 1 && /^[A-Z]$/i.test(blockTextTrimmed) && line.trim().length === 1) {
      return blockTextTrimmed.toLowerCase() === line.trim().toLowerCase();
    }
    
    // Use OCR-optimized similarity for better matching with OCR artifacts
    // Lower threshold for validation (0.30-0.45) to be more lenient for OCR variations
    // This is validation, not filtering, so we want to catch valid student work even with OCR errors
    // CRITICAL: For very short blocks (< 5 chars), require higher similarity to prevent noise matching
    // Footer noise like "m \( \| \) - \( n \) - \( n \) -" normalizes to "mnn" (3 chars)
    // This should NOT match equations like "= (6x^2 + 7x - 3)(x-5)" which normalizes to "6x27x3x5"
    const similarity = calculateOcrToDatabaseSimilarity(blockText, line);
    // For short blocks (< 5 chars), require much higher similarity (0.60) to prevent noise matching
    // For longer blocks (>= 5 chars), use lower threshold (0.30) to catch OCR variations
    const minSimilarity = blockTextTrimmed.length >= 5 ? 0.30 : 0.60;
    
    // CRITICAL: Additional check - if block is very short (< 5 chars) and similarity is low (< 0.50),
    // it's likely noise (like footer "mnn") matching equations by chance
    // Require either high similarity OR the block must be substantial (>= 5 chars)
    if (blockTextTrimmed.length < 5 && similarity < 0.50) {
      return false; // Short block with low similarity = likely noise, don't match
    }
    
    if (similarity >= minSimilarity) return true;
    
    // Exact match after normalization
    const normalizedBlock = normalizeTextForComparison(blockText);
    const normalizedLine = normalizeTextForComparison(line);
    if (!normalizedBlock || !normalizedLine) return false;
    
    if (normalizedBlock === normalizedLine) return true;
    
    // Substring matching for longer blocks (handles OCR truncation)
    // More lenient for validation: check if significant portion matches (>= 20 chars or 50% of shorter)
    // CRITICAL: Only use substring matching if both blocks are substantial (>= 10 chars)
    // This prevents short noise patterns (like "mnn" from footer) from matching equations
    if (normalizedBlock.length >= 10 && normalizedLine.length >= 10) {
      const minLength = Math.min(normalizedBlock.length, normalizedLine.length);
      const checkLength = Math.max(20, Math.floor(minLength * 0.5)); // At least 20 chars or 50% of shorter
      const blockSlice = normalizedBlock.slice(0, Math.min(checkLength, normalizedBlock.length));
      const lineSlice = normalizedLine.slice(0, Math.min(checkLength, normalizedLine.length));
      // CRITICAL: Require minimum overlap of 10 chars for substring matching
      // This prevents "mnn" from matching "6x27x3x5" just because one char matches
      if (blockSlice.length >= 10 && lineSlice.length >= 10) {
        if (lineSlice.includes(blockSlice) || blockSlice.includes(lineSlice)) {
          return true;
        }
      }
    }
    
    return false;
  });
}

/**
 * Match a block to a question using classification student work
 * Returns the best matching question number and similarity score
 */
function matchBlockToQuestion(
  block: MathBlock & { pageIndex: number },
  questionsOnPage: Array<{ questionNumber: string; schemeKey: string }>,
  classificationResult: ClassificationResult
): { questionNumber: string; schemeKey: string; similarity: number } | null {
  const blockText = block.mathpixLatex || block.googleVisionText || '';
  if (!blockText.trim()) return null;
  
  let bestMatch: { questionNumber: string; schemeKey: string; similarity: number } | null = null;
  let bestSimilarity = 0;
  
  // Find classification questions on this page
  const classificationQuestionsOnPage = (classificationResult.questions || []).filter((q: any) => {
    const pageIdx = (q as any).sourceImageIndex ?? 0;
    return pageIdx === block.pageIndex;
  });
  
  for (const qInfo of questionsOnPage) {
    // Find matching classification question by question number
    const classificationQ = classificationQuestionsOnPage.find((q: any) => {
      const mainQNum = String(q.questionNumber || '');
      const qNum = qInfo.questionNumber;
      
      // Extract base question number (e.g., "8" from "8", "8a" from "8a", "12ii" from "12ii")
      const baseQNum = getBaseQuestionNumber(qNum);
      
      // Match main question number
      if (mainQNum === baseQNum || mainQNum === qNum) {
        return true;
      }
      return false;
    });
    
    if (!classificationQ) continue;
    
    // Try to match against main question student work first
    // If main question has no student work but has sub-questions, try sub-question student work
    // All blocks (including sub-question blocks) will be assigned to main question scheme
    // Marking router will merge sub-question schemes automatically
    let studentWorkToMatch: string | null = null;
    if (classificationQ.studentWork) {
      studentWorkToMatch = classificationQ.studentWork;
    } else if (classificationQ.subQuestions && Array.isArray(classificationQ.subQuestions) && classificationQ.subQuestions.length > 0) {
      // Main question has no student work, but has sub-questions - combine sub-question student work
      const subQStudentWork = classificationQ.subQuestions
        .map((sq: any) => sq.studentWork)
        .filter((sw: any) => sw && sw !== 'null' && sw.trim().length > 0)
        .join('\n');
      if (subQStudentWork) {
        studentWorkToMatch = subQStudentWork;
      }
    }
    
    // If no student work at all (main or sub-questions), skip this question
    if (!studentWorkToMatch) continue;
    
    // Split multi-line student work into individual lines for better matching
    // Classification should use "\n" (backslash + n) as line separator per prompt specification
    // But handle legacy formats for backward compatibility: "\n", "\\newline", "\\\\" (double backslash)
    // OCR extracts these as separate blocks, so we need to match each block against individual lines
    const studentWorkLines = studentWorkToMatch
      .split(/\n|\\newline|\\\\/) // Split by newline, \newline, or double backslash (handle legacy formats)
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    // Calculate similarity against each line and take the best match
    const normalizedBlock = normalizeTextForComparison(blockText);
    if (!normalizedBlock) continue;
    
    let bestLineSimilarity = 0;
    
    for (const studentWorkLine of studentWorkLines) {
      const normalizedStudentWorkLine = normalizeTextForComparison(studentWorkLine);
      if (!normalizedStudentWorkLine) continue;
      
      const similarity = stringSimilarity.compareTwoStrings(normalizedBlock, normalizedStudentWorkLine);
      
      // Also check for partial/substring matching
      const blockContainsStudentWork = normalizedBlock.includes(normalizedStudentWorkLine) || 
                                        normalizedStudentWorkLine.includes(normalizedBlock) ||
                                        (normalizedBlock.length > 10 && normalizedStudentWorkLine.length > 10 &&
                                         (normalizedBlock.includes(normalizedStudentWorkLine.substring(0, Math.min(30, normalizedStudentWorkLine.length))) ||
                                         normalizedStudentWorkLine.includes(normalizedBlock.substring(0, Math.min(30, normalizedBlock.length)))));
      
      // Boost similarity if partial match
      const finalSimilarity = blockContainsStudentWork ? Math.max(similarity, 0.70) : similarity;
      
      if (finalSimilarity > bestLineSimilarity) {
        bestLineSimilarity = finalSimilarity;
      }
    }
    
    // Use bestLineSimilarity directly (threshold check happens at the end)
    if (bestLineSimilarity > bestSimilarity) {
      bestSimilarity = bestLineSimilarity;
      bestMatch = { questionNumber: qInfo.questionNumber, schemeKey: qInfo.schemeKey, similarity: bestLineSimilarity };
    }
    
  }
  
    // Only return if similarity is above threshold
    // Since Step 1 already filtered out question text, any block reaching here must be student work
    // Use lower threshold to handle OCR errors (e.g., "i" vs "\dot{2}")
    const threshold = 0.40; // Lowered from 0.55 - we know it's student work, just need to match which question
    return bestSimilarity >= threshold ? bestMatch : null;
}


/**
 * Check if block is page footer/metadata (e.g., "Turn over", "(2)", page numbers)
 */
function isPageFooterOrMetadata(block: MathBlock & { pageIndex: number }): boolean {
  const blockText = (block.mathpixLatex || block.googleVisionText || '').trim();
  if (!blockText) return false;
  
  const normalized = blockText.toLowerCase();
  
  // Common page footers/metadata patterns
  const footerPatterns = [
    /^turn\s+over$/i,
    /^\(?\d+\)?$/, // Standalone numbers in parentheses like "(2)", "2", "(17)"
    /^page\s+\d+$/i,
    /^\d+$/ // Standalone single/double digit numbers (likely page numbers or mark allocations)
  ];
  
  // Check if block matches any footer pattern
  for (const pattern of footerPatterns) {
    if (pattern.test(blockText)) {
      return true;
    }
  }
  
  // Check for very short blocks that are likely metadata
  if (blockText.length <= 3 && /^[()\d]+$/.test(blockText)) {
    return true;
  }
  
  return false;
}

/**
 * Wrapper function that uses the new QuestionTextFilter helper class
 * Converts local interfaces to the filter's expected types
 */
function isQuestionTextBlock(
  block: MathBlock & { pageIndex: number },
  classificationQuestions: QuestionForFiltering[],
  similarityThreshold: number = 0.70,
  boundaries?: QuestionBoundary[]
): { isQuestionText: boolean; confidence?: number; matchedQuestion?: string; matchedClassificationLines?: Array<{ classificationLine: string; similarity: number; questionNumber?: string; subQuestionPart?: string }> } {
  // Convert local QuestionForFiltering to FilterQuestionForFiltering
  const filterQuestions: FilterQuestionForFiltering[] = classificationQuestions.map(q => ({
    questionNumber: q.questionNumber || null,
    text: q.text || null,
    databaseText: q.databaseText || null,
    studentWork: q.studentWork || null,
    subQuestions: q.subQuestions?.map(subQ => ({
      part: subQ.part,
      text: subQ.text || null,
      databaseText: subQ.databaseText || null,
      studentWork: subQ.studentWork || null
    })),
    sourceImageIndex: q.sourceImageIndex
  }));
  
  // Convert local QuestionBoundary to FilterQuestionBoundary
  const filterBoundaries: FilterQuestionBoundary[] | undefined = boundaries?.map(b => ({
    questionNumber: b.questionNumber,
    pageIndex: b.pageIndex,
    startY: b.startY,
    endY: b.endY // Can be null, which is fine
  }));
  
  // Use the new QuestionTextFilter class
  const result = QuestionTextFilter.filter(block, filterQuestions, filterBoundaries, similarityThreshold);
            
  // Return in the expected format (including matchedClassificationLines)
  return {
    isQuestionText: result.isQuestionText,
    matchedClassificationLines: result.matchedClassificationLines,
    confidence: result.confidence,
    matchedQuestion: result.matchedQuestion
  };
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
      // Calculate endY from the matched line (if height is available)
      const coords = extractBoundingBox(pageLines[bestMatch.lineIndex]);
      const endY = coords ? bestMatch.y + (coords.height || 0) : null;
      
      boundaries.push({
        questionNumber: String(question.questionNumber),
        pageIndex: pageIndex,
        startY: bestMatch.y,
        endY: endY,
        questionText
      });
      console.log(`[SEGMENTATION] ✅ Found boundary for Q${question.questionNumber} on Page ${pageIndex} (startY: ${bestMatch.y}, endY: ${endY !== null ? endY : 'null'}, similarity: ${bestMatch.score.toFixed(3)})`);
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
 * Calculate question boundaries from question text blocks
 * More reliable than text matching - uses already-identified question text blocks
 * Matches question text blocks to questions by comparing with question text
 */
function calculateQuestionBoundariesFromTextBlocks(
  questionTextBlocks: Array<MathBlock & { pageIndex: number }>,
  questionsOnPage: Array<{ questionNumber: string; schemeKey: string }>,
  pageIndex: number,
  originalQuestionsForFiltering: QuestionForFiltering[]
): QuestionBoundary[] {
  const boundaries: QuestionBoundary[] = [];
  
  // Get questions for this page from originalQuestionsForFiltering
  const pageQuestions = originalQuestionsForFiltering.filter(q => q.sourceImageIndex === pageIndex);
  
  // Group questions by schemeKey to identify grouped sub-questions
  const questionsByScheme = new Map<string, Array<{ questionNumber: string; schemeKey: string }>>();
  questionsOnPage.forEach(q => {
    if (!questionsByScheme.has(q.schemeKey)) {
      questionsByScheme.set(q.schemeKey, []);
    }
    questionsByScheme.get(q.schemeKey)!.push(q);
  });
  
  // For each unique scheme key, calculate boundary
  for (const [schemeKey, schemeQuestions] of questionsByScheme.entries()) {
    // If multiple questions share the same schemeKey (grouped sub-questions),
    // use the main question text (base question number) instead of individual sub-question texts
    const isGroupedSubQuestions = schemeQuestions.length > 1;
    const baseQuestionNumber = isGroupedSubQuestions 
      ? getBaseQuestionNumber(schemeQuestions[0].questionNumber)
      : null;
    
    // For grouped sub-questions, calculate ONE boundary from main question text and assign to all sub-questions
    // For single questions, calculate boundary from the question's own text
    if (isGroupedSubQuestions && baseQuestionNumber) {
      // Find main question info (base question number, e.g., "12")
      const mainQuestionInfo = pageQuestions.find(q => {
        if (q.questionNumber) {
          const baseQNumFromFilter = getBaseQuestionNumber(q.questionNumber);
          return baseQNumFromFilter === baseQuestionNumber;
        }
        const qNumMatch = (q.text || q.databaseText || '').match(/Q?(\d+[a-z]*)/i);
        const qNum = qNumMatch ? qNumMatch[1] : '';
        const baseQNum = getBaseQuestionNumber(qNum);
        return baseQNum === baseQuestionNumber;
      });
      
      if (mainQuestionInfo) {
        const mainQuestionText = mainQuestionInfo.databaseText || mainQuestionInfo.text;
        if (mainQuestionText) {
          // Find question text blocks that match the main question text
          const matchingBlocksWithConfidence: Array<{
            block: MathBlock & { pageIndex: number };
            confidence: number;
          }> = [];
          
          questionTextBlocks.forEach(block => {
            if (block.pageIndex !== pageIndex) return;
            
            const blockText = (block.mathpixLatex || block.googleVisionText || '').trim();
            if (!blockText) return;
            
            // Use OCR-optimized similarity calculation (handles truncation, LaTeX artifacts, OCR errors)
            const similarity = calculateOcrToDatabaseSimilarity(blockText, mainQuestionText);
            
            // Lower threshold for OCR matching (0.50-0.60) since OCR is noisier than classification text
            // Also check substring matching as fallback (handles very truncated blocks)
            const normalizedBlock = normalizeTextForComparison(blockText);
            const normalizedQuestion = normalizeTextForComparison(mainQuestionText);
            const isSubstring1 = normalizedQuestion.includes(normalizedBlock);
            const isSubstring2 = normalizedBlock.length > 10 && normalizedQuestion.includes(normalizedBlock.slice(0, 30));
            
            // Match if: OCR similarity high OR substring match (for very truncated blocks)
            const matches = similarity >= 0.50 || isSubstring1 || isSubstring2;
            
            if (matches) {
              // Boost confidence for substring matches (they're reliable even if similarity is lower)
              const confidence = isSubstring1 || isSubstring2 ? Math.max(similarity, 0.75) : similarity;
              matchingBlocksWithConfidence.push({ block, confidence });
            }
          });
          
          if (matchingBlocksWithConfidence.length > 0) {
            // Calculate boundary from main question text blocks
            const yRanges = matchingBlocksWithConfidence
              .map(({ block }) => {
                const y = block.coordinates?.y;
                const height = block.coordinates?.height ?? 0;
                if (y !== null && y !== undefined) {
                  return { startY: y, endY: y + height };
                }
                return null;
              })
              .filter((range): range is { startY: number; endY: number } => range !== null);
            
            const orderIndices = matchingBlocksWithConfidence
              .map(({ block }) => (block as any).originalOrderIndex)
              .filter((order): order is number => order != null);
            const maxOrderIndex = orderIndices.length > 0 ? Math.max(...orderIndices) : undefined;
            
            if (yRanges.length > 0) {
              const minY = Math.min(...yRanges.map(r => r.startY));
              const maxEndY = Math.max(...yRanges.map(r => r.endY));
              const avgConfidence = matchingBlocksWithConfidence.reduce((sum, m) => sum + m.confidence, 0) / matchingBlocksWithConfidence.length;
              
              // Assign the SAME boundary to all sub-questions in the group
              for (const question of schemeQuestions) {
                boundaries.push({
                  questionNumber: question.questionNumber,
                  pageIndex,
                  startY: minY,
                  endY: maxEndY,
                  questionText: mainQuestionText,
                  maxOrderIndex
                });
                
                (boundaries[boundaries.length - 1] as any).logInfo = {
                  questionNumber: question.questionNumber,
                  pageIndex,
                  blockCount: matchingBlocksWithConfidence.length,
                  avgConfidence,
                  minY,
                  maxEndY,
                  maxOrderIndex
                };
              }
            }
          }
        }
      }
    } else {
      // Single question: calculate boundary from its own text
      for (const question of schemeQuestions) {
    const questionNumber = question.questionNumber;
    
    const questionInfo = pageQuestions.find(q => {
      if (q.questionNumber) {
        const baseQNum = getBaseQuestionNumber(questionNumber);
        const baseQNumFromFilter = getBaseQuestionNumber(q.questionNumber);
        if (q.questionNumber === questionNumber || baseQNumFromFilter === baseQNum) {
          return true;
        }
      }
      const qNumMatch = (q.text || q.databaseText || '').match(/Q?(\d+[a-z]*)/i);
      const qNum = qNumMatch ? qNumMatch[1] : '';
      const baseQNum = getBaseQuestionNumber(questionNumber);
      return qNum === baseQNum || qNum === questionNumber;
    });
    
    if (!questionInfo) {
      continue;
    }
    
    const questionTextToUse = questionInfo.databaseText || questionInfo.text;
    if (!questionTextToUse) {
      continue;
    }
    
    // Find question text blocks that match this question
    const matchingBlocksWithConfidence: Array<{
      block: MathBlock & { pageIndex: number };
      confidence: number;
    }> = [];
    
    questionTextBlocks.forEach(block => {
      if (block.pageIndex !== pageIndex) return;
      
      const blockText = (block.mathpixLatex || block.googleVisionText || '').trim();
      if (!blockText) return;
      
          // Use OCR-optimized similarity calculation (handles truncation, LaTeX artifacts, OCR errors)
          const similarity = calculateOcrToDatabaseSimilarity(blockText, questionTextToUse);
          
          // Lower threshold for OCR matching (0.50-0.60) since OCR is noisier than classification text
          // Also check substring matching as fallback (handles very truncated blocks)
      const normalizedBlock = normalizeTextForComparison(blockText);
      const normalizedQuestion = normalizeTextForComparison(questionTextToUse);
      const isSubstring1 = normalizedQuestion.includes(normalizedBlock);
          const isSubstring2 = normalizedBlock.length > 10 && normalizedQuestion.includes(normalizedBlock.slice(0, 30));
          
          // Match if: OCR similarity high OR substring match (for very truncated blocks)
          const matches = similarity >= 0.50 || isSubstring1 || isSubstring2;
      
      if (matches) {
            // Boost confidence for substring matches (they're reliable even if similarity is lower)
            const confidence = isSubstring1 || isSubstring2 ? Math.max(similarity, 0.75) : similarity;
        matchingBlocksWithConfidence.push({ block, confidence });
      }
    });
    
    if (matchingBlocksWithConfidence.length > 0) {
      const yRanges = matchingBlocksWithConfidence
        .map(({ block }) => {
          const y = block.coordinates?.y;
          const height = block.coordinates?.height ?? 0;
          if (y !== null && y !== undefined) {
            return { startY: y, endY: y + height };
          }
          return null;
        })
        .filter((range): range is { startY: number; endY: number } => range !== null);
      
      const orderIndices = matchingBlocksWithConfidence
        .map(({ block }) => (block as any).originalOrderIndex)
        .filter((order): order is number => order != null);
      const maxOrderIndex = orderIndices.length > 0 ? Math.max(...orderIndices) : undefined;
      
      if (yRanges.length > 0) {
        const minY = Math.min(...yRanges.map(r => r.startY));
        const maxEndY = Math.max(...yRanges.map(r => r.endY));
        const avgConfidence = matchingBlocksWithConfidence.reduce((sum, m) => sum + m.confidence, 0) / matchingBlocksWithConfidence.length;
        
        boundaries.push({
          questionNumber,
          pageIndex,
          startY: minY,
          endY: maxEndY,
          questionText: questionTextToUse,
              maxOrderIndex
        });
        
        (boundaries[boundaries.length - 1] as any).logInfo = {
          questionNumber,
          pageIndex,
          blockCount: matchingBlocksWithConfidence.length,
          avgConfidence,
          minY,
          maxEndY,
          maxOrderIndex
        };
          }
        }
      }
    }
  }
  
  return boundaries;
}

/**
 * Assign block to question based on Y position
 * Returns the question number that this block belongs to
 * Works with either startY or endY - if endY is available, uses it for more precise assignment
 * For blocks with estimated Y coordinates, this may be inaccurate
 */
function assignBlockToQuestionByY(
  block: MathBlock & { pageIndex: number },
  boundaries: QuestionBoundary[]
): string | null {
  if (!block.coordinates?.y) return null;
  
  const blockY = block.coordinates.y;
  const blockPage = block.pageIndex;
  
  // Find the question boundary that this block is below
  // Sort boundaries by startY position (top to bottom)
  const pageBoundaries = boundaries
    .filter(b => b.pageIndex === blockPage)
    .sort((a, b) => a.startY - b.startY);
  
  if (pageBoundaries.length === 0) return null;
  
  // Find the last (bottommost) boundary that the block is below
  // If endY is available, use it for more precise assignment (block must be below endY)
  // If endY is not available, use startY (block must be below startY)
  let assignedQuestion: string | null = null;
  for (const boundary of pageBoundaries) {
    // Use endY if available, otherwise use startY
    const thresholdY = boundary.endY !== null ? boundary.endY : boundary.startY;
    
    if (blockY >= thresholdY) {
      assignedQuestion = boundary.questionNumber;
    } else {
      break; // Block is above this boundary, stop searching
    }
  }
  
  return assignedQuestion;
}

/**
 * Assign block to question based on original OCR reading order
 * For blocks with estimated/null Y coordinates, use order relative to blocks with real Y
 * Returns the question number that this block belongs to, or null if no match found
 */
function assignBlockToQuestionByOrder(
  block: MathBlock & { pageIndex: number; originalOrderIndex?: number },
  alreadyAssignedBlocks: Map<string, { block: MathBlock & { pageIndex: number; originalOrderIndex?: number }; questionNumber: string; schemeKey: string }>,
  questionsOnPage: Array<{ questionNumber: string; schemeKey: string }>
): string | null {
  if (block.originalOrderIndex == null) return null; // No order index available
  
  const blockPage = block.pageIndex;
  const blockOrder = block.originalOrderIndex;
  
  // Find blocks on the same page that are already assigned and have real Y coordinates
  const assignedBlocksOnPage: Array<{ block: MathBlock & { pageIndex: number; originalOrderIndex?: number }; questionNumber: string; schemeKey: string; orderIndex: number }> = [];
  
  for (const [blockId, assigned] of alreadyAssignedBlocks.entries()) {
    if (assigned.block.pageIndex === blockPage && 
        assigned.block.originalOrderIndex != null &&
        assigned.block.coordinates?.y != null) { // Only use blocks with real Y coordinates
      assignedBlocksOnPage.push({
        block: assigned.block,
        questionNumber: assigned.questionNumber,
        schemeKey: assigned.schemeKey,
        orderIndex: assigned.block.originalOrderIndex!
      });
    }
  }
  
  if (assignedBlocksOnPage.length === 0) return null; // No reference blocks available
  
  // Sort by order index
  assignedBlocksOnPage.sort((a, b) => a.orderIndex - b.orderIndex);
  
  // Find the nearest block before this one in order
  let nearestBefore: typeof assignedBlocksOnPage[0] | null = null;
  for (let i = assignedBlocksOnPage.length - 1; i >= 0; i--) {
    if (assignedBlocksOnPage[i].orderIndex < blockOrder) {
      nearestBefore = assignedBlocksOnPage[i];
      break;
    }
  }
  
  // Find the nearest block after this one in order
  let nearestAfter: typeof assignedBlocksOnPage[0] | null = null;
  for (let i = 0; i < assignedBlocksOnPage.length; i++) {
    if (assignedBlocksOnPage[i].orderIndex > blockOrder) {
      nearestAfter = assignedBlocksOnPage[i];
      break;
    }
  }
  
  // Prefer the block before (more reliable for reading order)
  if (nearestBefore) {
    return nearestBefore.questionNumber;
  }
  
  // Fallback to block after
  if (nearestAfter) {
    return nearestAfter.questionNumber;
  }
  
  return null;
}

/**
 * Map classification question numbers to marking scheme keys
 * Returns a map: questionNumber -> schemeKey
 */
function mapQuestionsToSchemes(
  classificationQuestions: Array<{ questionNumber?: string | null; sourceImageIndex?: number; text?: string | null }>,
  detectedSchemesMap: Map<string, any>
): Map<string, string> {
  const questionToSchemeMap = new Map<string, string>();
  const allSchemeKeys = Array.from(detectedSchemesMap.keys());
  
  for (const question of classificationQuestions) {
    if (!question.questionNumber) continue;
    
    const aiDetectedQNum = String(question.questionNumber);
    
    // Normalize question number to handle parentheses (e.g., "12(i)" -> "12i")
    // This allows consistent matching regardless of classification format
    const normalizedQNum = aiDetectedQNum.replace(/[()]/g, '');
    
    // Check if this is a numeric question number (past paper) or text key (non-past paper)
    // Support multiple letters for Roman numerals (i, ii, iii) with or without parentheses
    // After normalization, "12(i)" becomes "12i", which matches the regex
    const isNumericKey = /^\d+[a-z]*$/i.test(normalizedQNum);
    
    if (isNumericKey) {
      // Past paper: match by question number (use normalized version for base extraction)
      const baseQNum = getBaseQuestionNumber(normalizedQNum);
      
      // Find matching scheme key
      const matchingSchemeKey = allSchemeKeys.find(schemeKey => {
        const schemeQNum = schemeKey.split('_')[0];
        const baseSchemeQNum = getBaseQuestionNumber(schemeQNum);
        return baseSchemeQNum === baseQNum;
      });
      
      if (matchingSchemeKey) {
        // Map the original question number (with parentheses if present) to the scheme key
        questionToSchemeMap.set(aiDetectedQNum, matchingSchemeKey);
      } else {
        console.warn(`[SEGMENTATION] ⚠️ No matching scheme found for Q${aiDetectedQNum}`);
      }
    } else {
      // Non-past paper: match by question text similarity
      const questionText = question.text || '';
      if (questionText) {
        let bestMatch: { schemeKey: string; similarity: number } | null = null;
        let bestSimilarity = 0;
        
        for (const [schemeKey, scheme] of detectedSchemesMap.entries()) {
          const schemeQuestionText = scheme.databaseQuestionText || scheme.questionText || '';
          if (schemeQuestionText) {
            const normalizedQText = normalizeTextForComparison(questionText);
            const normalizedSchemeText = normalizeTextForComparison(schemeQuestionText);
            if (normalizedQText && normalizedSchemeText) {
              const similarity = stringSimilarity.compareTwoStrings(normalizedQText, normalizedSchemeText);
              if (similarity > bestSimilarity && similarity >= 0.60) {
                bestSimilarity = similarity;
                bestMatch = { schemeKey, similarity };
              }
            }
          }
        }
        
        if (bestMatch) {
          questionToSchemeMap.set(aiDetectedQNum, bestMatch.schemeKey);
        }
        // If no match found, that's okay - it's a non-past paper question without a scheme
      }
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
  detectedSchemesMap: Map<string, any>,
  pageDimensions?: Map<number, { width: number; height: number }>
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
  
  // 1. Consolidate all math blocks and preserve original OCR reading order
  let allMathBlocks: Array<MathBlock & { pageIndex: number; globalBlockId: string; originalOrderIndex: number }> = [];
  let blockCounter = 0;
  let originalOrderIndex = 0; // Track original order from OCR response
  
  allPagesOcrData.forEach((pageResult) => {
    const mathBlocks = pageResult.ocrData?.mathBlocks || [];
    
    mathBlocks.forEach((block) => {
      allMathBlocks.push({
        ...block,
        pageIndex: pageResult.pageIndex,
        globalBlockId: `block_${blockCounter++}`,
        originalOrderIndex: originalOrderIndex++ // Preserve original OCR reading order
      });
    });
  });
  
  
  // 2. Filter out empty blocks (preserve originalOrderIndex)
  const studentWorkBlocks: Array<MathBlock & { pageIndex: number; globalBlockId: string; originalOrderIndex: number }> = allMathBlocks.filter(block => {
    const blockText = (block.mathpixLatex || block.googleVisionText || '').trim();
    const isQ12BlockF = block.pageIndex === 2 && blockText === 'F';
    return blockText.length > 0;
  }) as Array<MathBlock & { pageIndex: number; globalBlockId: string; originalOrderIndex: number }>;
  
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
    let mainQuestionNumber = q.questionNumber;
    // For merged questions, use sourceImageIndices array; otherwise use single sourceImageIndex
    const pageIndices = (q as any).sourceImageIndices && Array.isArray((q as any).sourceImageIndices)
      ? (q as any).sourceImageIndices
      : [(q as any).sourceImageIndex ?? 0];
    
    // Fix: If questionNumber is "null" or null, try to find matching scheme (past paper case)
    if (!mainQuestionNumber || mainQuestionNumber === 'null' || mainQuestionNumber === 'undefined') {
      // Try to match by question text against detectedSchemesMap (past paper detection)
      const questionText = q.text || '';
      if (questionText) {
        let bestMatch: { scheme: any; schemeKey: string; similarity: number } | null = null;
        let bestSimilarity = 0;
        
        for (const [schemeKey, scheme] of detectedSchemesMap.entries()) {
          const schemeQuestionText = scheme.databaseQuestionText || scheme.questionText || '';
          if (schemeQuestionText) {
            const normalizedQText = normalizeTextForComparison(questionText);
            const normalizedSchemeText = normalizeTextForComparison(schemeQuestionText);
            if (normalizedQText && normalizedSchemeText) {
              const similarity = stringSimilarity.compareTwoStrings(normalizedQText, normalizedSchemeText);
              if (similarity > bestSimilarity && similarity >= 0.60) {
                bestSimilarity = similarity;
                bestMatch = { scheme, schemeKey, similarity };
              }
            }
          }
        }
        
        if (bestMatch && bestMatch.scheme.questionNumber) {
          // Past paper: use scheme's question number
          mainQuestionNumber = String(bestMatch.scheme.questionNumber);
        } else {
          // Non-past paper: use normalized question text as key (first 30 chars)
          const normalizedText = normalizeTextForComparison(questionText);
          mainQuestionNumber = normalizedText.substring(0, 30) || 'unknown';
        }
      } else {
        // No question text either, use fallback
        mainQuestionNumber = 'unknown';
      }
    }
    
    // Create entries for all pages this question spans (for multi-page merged questions)
    pageIndices.forEach((pageIndex: number) => {
      // If question has sub-questions, create separate entries for each sub-question
      // ALSO add the main question number entry to support merged scheme keys (e.g., "17_..." for grouped Q17a, Q17b)
      if (q.subQuestions && Array.isArray(q.subQuestions) && q.subQuestions.length > 0) {
        // Add main question number entry first (for merged scheme key matching)
        if (mainQuestionNumber) {
          flattenedQuestions.push({
            questionNumber: String(mainQuestionNumber),
            text: q.text || null,
            sourceImageIndex: pageIndex
          });
        }
        // Then add sub-question entries
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
  });
  
  if (flattenedQuestions.length === 0) {
    throw new Error('[SEGMENTATION] No valid questions found after flattening classification structure');
  }
  
  
  // 4. Map questions to marking schemes
  const questionToSchemeMap = mapQuestionsToSchemes(flattenedQuestions, detectedSchemesMap);
  
  // Allow questions without schemes (non-past paper questions) - they'll be marked without a scheme
  // if (questionToSchemeMap.size === 0) {
  //   throw new Error('[SEGMENTATION] No questions could be mapped to marking schemes');
  // }
  
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
      questionNumber: mainQuestionNumber, // Store classification question number directly (more reliable than extracting from text)
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
  
  // Group blocks by page (preserve originalOrderIndex)
  const blocksByPage = new Map<number, Array<MathBlock & { pageIndex: number; originalOrderIndex: number }>>();
  studentWorkBlocks.forEach(block => {
    if (!blocksByPage.has(block.pageIndex)) {
      blocksByPage.set(block.pageIndex, []);
    }
    blocksByPage.get(block.pageIndex)!.push(block);
  });
  
  // STEP 3: Estimate Y coordinates for blocks with null Y based on block order
  // This ensures all blocks can be assigned by Y-position in STEP 6
  for (const [pageIndex, blocksOnPage] of blocksByPage.entries()) {
    
    // Sort blocks by order index (reading order)
    const sortedBlocks = [...blocksOnPage].sort((a, b) => a.originalOrderIndex - b.originalOrderIndex);
    
    // Find blocks with real Y coordinates (reference blocks)
    const blocksWithY = sortedBlocks.filter(b => b.coordinates?.y != null);
    
    if (blocksWithY.length === 0) {
      // No reference blocks on this page - skip Y estimation
      continue;
    }
    
    // Estimate Y for blocks with null Y by interpolating between surrounding blocks
    for (let i = 0; i < sortedBlocks.length; i++) {
      const block = sortedBlocks[i];
      if (block.coordinates?.y != null) continue; // Already has Y coordinate
      
      // Find nearest blocks before and after with real Y
      let beforeBlock: typeof sortedBlocks[0] | null = null;
      let afterBlock: typeof sortedBlocks[0] | null = null;
      
      // Search backwards for block with Y
      for (let j = i - 1; j >= 0; j--) {
        if (sortedBlocks[j].coordinates?.y != null) {
          beforeBlock = sortedBlocks[j];
          break;
        }
      }
      
      // Search forwards for block with Y
      for (let j = i + 1; j < sortedBlocks.length; j++) {
        if (sortedBlocks[j].coordinates?.y != null) {
          afterBlock = sortedBlocks[j];
          break;
        }
      }
      
      // Estimate Y coordinate
      if (beforeBlock && afterBlock) {
        // Linear interpolation between before and after blocks
        const orderDiff = afterBlock.originalOrderIndex - beforeBlock.originalOrderIndex;
        const yDiff = afterBlock.coordinates!.y! - beforeBlock.coordinates!.y!;
        const orderRatio = (block.originalOrderIndex - beforeBlock.originalOrderIndex) / orderDiff;
        const estimatedY = beforeBlock.coordinates!.y! + (yDiff * orderRatio);
        
        // Ensure coordinates object exists
        if (!block.coordinates) {
          block.coordinates = { x: 0, y: estimatedY, width: 0, height: 0 };
        } else {
          block.coordinates.y = estimatedY;
        }
      } else if (beforeBlock) {
        // Only before block available - estimate slightly below
        const estimatedY = beforeBlock.coordinates!.y! + 50; // 50px below
        
        if (!block.coordinates) {
          block.coordinates = { x: 0, y: estimatedY, width: 0, height: 0 };
        } else {
          block.coordinates.y = estimatedY;
        }
      } else if (afterBlock) {
        // Only after block available - estimate slightly above
        const estimatedY = afterBlock.coordinates!.y! - 50; // 50px above
        
        if (!block.coordinates) {
          block.coordinates = { x: 0, y: estimatedY, width: 0, height: 0 };
        } else {
          block.coordinates.y = estimatedY;
        }
      }
      // If no reference blocks found, leave Y as null (will use order-based assignment fallback)
    }
  }
  
  // Create a map of page -> question numbers from flattenedQuestions
  // Allow questions without schemes (non-past paper questions) - use question number as scheme key
  const pageToQuestionMap = new Map<number, Array<{ questionNumber: string; schemeKey: string }>>();
  flattenedQuestions.forEach(q => {
    const pageIdx = q.sourceImageIndex;
    const schemeKey = questionToSchemeMap.get(q.questionNumber) || q.questionNumber; // Use question number as fallback scheme key
    if (!pageToQuestionMap.has(pageIdx)) {
      pageToQuestionMap.set(pageIdx, []);
    }
    pageToQuestionMap.get(pageIdx)!.push({ questionNumber: q.questionNumber, schemeKey });
  });
  
  // Assign blocks by page index and question number mapping
  // Fix: Handle multiple questions per page and multi-page sub-questions
  // Store pre-filtered blocks per page for reuse in fallback assignment (preserve originalOrderIndex)
  const pageFilteredBlocks = new Map<number, Array<MathBlock & { pageIndex: number; originalOrderIndex: number }>>();
  // Store question text max order per page (main question order)
  const pageQuestionTextMaxOrderMap = new Map<number, Map<string, number>>();
  // Store OCR block → classification line mapping (resolved, one-to-one) per page
  const pageBlockToClassificationMap = new Map<number, Map<string, { classificationLine: string; similarity: number; questionNumber?: string; subQuestionPart?: string }>>();
  // Store all boundaries from all pages for statistics calculation
  const allBoundaries: QuestionBoundary[] = [];
  
  for (const [pageIndex, blocksOnPage] of blocksByPage.entries()) {
    const questionsOnPage = pageToQuestionMap.get(pageIndex);
    if (!questionsOnPage || questionsOnPage.length === 0) {
      console.warn(`[SEGMENTATION] ⚠️ No questions found for Page ${pageIndex}, skipping blocks`);
      continue;
    }
    
    // Group questions by scheme key (same scheme key = grouped sub-questions or same question)
    const questionsByScheme = new Map<string, Array<{ questionNumber: string; schemeKey: string }>>();
    questionsOnPage.forEach(q => {
      if (!questionsByScheme.has(q.schemeKey)) {
        questionsByScheme.set(q.schemeKey, []);
      }
      questionsByScheme.get(q.schemeKey)!.push(q);
    });
    
    // Fix: If multiple questions with DIFFERENT scheme keys on same page (e.g., Q8 and Q9),
    // match blocks to questions using classification student work
    const hasMultipleDifferentSchemes = questionsByScheme.size > 1;
    const assignedBlocksInPage = new Set<string>(); // Track blocks assigned in this page iteration
    
    if (hasMultipleDifferentSchemes) {
      console.log(`[SEGMENTATION] Page ${pageIndex} has ${questionsByScheme.size} different questions (${questionsOnPage.map(q => `Q${q.questionNumber}`).join(', ')}), using student work matching`);
    }
    
    // STEP 4: Identify question text and student work blocks (single pass)
    // Filter question text blocks ONCE per page (text matching only, to get boundaries)
    const preliminaryQuestionTextBlocks: Array<MathBlock & { pageIndex: number }> = [];
    blocksOnPage.forEach(block => {
      const blockText = (block.mathpixLatex || block.googleVisionText || '').trim();
      const result = isQuestionTextBlock(block, originalQuestionsForFiltering, 0.70);
      if (result.isQuestionText) {
        preliminaryQuestionTextBlocks.push(block);
      } else {
        // Debug: Log blocks that are NOT identified as question text (for Q12 page)
      }
    });
    
    // STEP 5: Calculate question boundaries from preliminary question text blocks
    const boundaries = calculateQuestionBoundariesFromTextBlocks(
      preliminaryQuestionTextBlocks,
      questionsOnPage,
      pageIndex,
      originalQuestionsForFiltering
    );
    
    // Store boundaries for statistics calculation
    allBoundaries.push(...boundaries);
    
    // Reuse: Extract max order index from boundaries (already calculated in calculateQuestionBoundariesFromTextBlocks)
    const questionTextMaxOrderMap = new Map<string, number>();
    boundaries.forEach(boundary => {
      if (boundary.maxOrderIndex != null) {
        questionTextMaxOrderMap.set(boundary.questionNumber, boundary.maxOrderIndex);
        if ((pageIndex === 0 || pageIndex === 1) && (boundary.questionNumber === '4' || boundary.questionNumber === '5' || boundary.questionNumber === '4a' || boundary.questionNumber === '4b' || boundary.questionNumber === '5a' || boundary.questionNumber === '5b')) {
          console.log(`[DEBUG] Q${boundary.questionNumber} maxOrder=${boundary.maxOrderIndex} (reused from boundary calculation)`);
        }
      }
    });
    
    // Log question text max order summary for Q4/Q5
    if (pageIndex === 0 || pageIndex === 1) {
      const orderSummary = Array.from(questionTextMaxOrderMap.entries())
        .map(([q, max]) => `Q${q}:maxOrder=${max}`).join(', ') || 'none';
      console.log(`[DEBUG] Page ${pageIndex} question text max order: [${orderSummary}]`);
    }
    
    // Log all question text detection results together (before segmentation logs)
    const questionTextDetectionLogs: Array<{ questionNumber: string; pageIndex: number; blockCount: number; avgConfidence: number; minY: number; maxEndY: number }> = [];
    boundaries.forEach(boundary => {
      const logInfo = (boundary as any).logInfo;
      if (logInfo) {
        questionTextDetectionLogs.push(logInfo);
      }
    });
    
    // Print all question text detection logs together with consistent color coding
    if (questionTextDetectionLogs.length > 0) {
      const resetCode = '\x1b[0m';
      const greenCode = '\x1b[32m';
      const yPosColor = greenCode;
      questionTextDetectionLogs.forEach(log => {
        // All confidences >= 0.80 should be green (use >= 0.80 for consistency)
        const confidenceColor = log.avgConfidence >= 0.80 ? greenCode : '\x1b[33m'; // yellow if < 0.80
        console.log(`[QUESTION TEXT DETECTION] Q${log.questionNumber} (Page ${log.pageIndex}): ${log.blockCount} block(s), ${confidenceColor}confidence=${log.avgConfidence.toFixed(3)}${resetCode}, ${yPosColor}Y=${log.minY}-${log.maxEndY}${resetCode}`);
      });
    }
    
    // STEP 4 (continued): Filter question text blocks ONCE per page (with Y-position check as priority)
    const questionTextBlocks: Array<MathBlock & { pageIndex: number }> = [];
    
    // Get questions on this page for debug logging
    const questionsOnThisPage = questionsOnPage.map(q => q.questionNumber).join(', ');
    
    // Track OCR block → classification line mapping (with similarity scores)
    // This will be used to pass classification content to AI instead of OCR blocks
    const blockToClassificationMap = new Map<string, { block: MathBlock & { pageIndex: number }, matches: Array<{ classificationLine: string; similarity: number; questionNumber?: string; subQuestionPart?: string }> }>();
    
    // TEMPORARY DEBUG: Track filtering results
    const filteringResults: Array<{ blockText: string; isQuestionText: boolean; reason?: string; confidence?: number }> = [];
    
    const studentWorkBlocks = blocksOnPage.filter(block => {
      const blockText = (block.mathpixLatex || block.googleVisionText || '').trim();
      const blockTextFull = blockText;
      const blockId = (block as any).globalBlockId || `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
      
      const isQ5aBlock40 = pageIndex === 1 && (blockText === '40' || blockText === '40.' || blockText === '40,' || blockText.includes('40') && blockText.length <= 5);
      // Check for block "F" - handle both plain "F" and LaTeX "\( F \)" or "$F$"
      const blockTextNormalized = blockText.replace(/^\\?\(?\s*\$?\s*F\s*\$?\s*\\?\)?$/, 'F').trim();
      const isQ12BlockF = blockTextNormalized === 'F' || (blockText.includes('F') && blockText.length <= 10);
      // Check for block "H" - handle both plain "H" and LaTeX "\( H \)" or "$H$"
      const blockTextNormalizedH = blockText.replace(/^\\?\(?\s*\$?\s*H\s*\$?\s*\\?\)?$/, 'H').trim();
      const isQ12BlockH = (pageIndex === 0 || pageIndex === 2) && (blockTextNormalizedH === 'H' || (blockText.includes('H') && blockText.length <= 10 && !blockText.includes('Here')));
      
      const result = isQuestionTextBlock(block, originalQuestionsForFiltering, 0.70, boundaries);
      if (result.isQuestionText) {
        questionTextBlocks.push(block);
        filteringResults.push({
          blockText: blockText.substring(0, 80),
          isQuestionText: true,
          reason: result.matchedQuestion || 'unknown',
          confidence: result.confidence
        });
        if (isQ5aBlock40) {
          console.warn(`[Q5a "40" TRACE] Block "${blockText}" (Y=${block.coordinates?.y ?? 'null'}) → FILTERED as question text (confidence=${result.confidence?.toFixed(3) ?? 'N/A'}, matched=${result.matchedQuestion ?? 'none'})`);
        }
        return false; // Filter out question text
      } else {
        filteringResults.push({
          blockText: blockText.substring(0, 80),
          isQuestionText: false,
          reason: 'student-work',
          confidence: result.confidence
        });
        // Track classification matches for student work blocks
        // CRITICAL: Even if similarity is low, we still want to track potential matches
        // The order-based boost and positional fallback can improve these matches later
        if (result.matchedClassificationLines && result.matchedClassificationLines.length > 0) {
          blockToClassificationMap.set(blockId, {
            block,
            matches: result.matchedClassificationLines
          });
        } else {
          // If no matches found during filtering, still add block to map with empty matches
          // This allows positional fallback to process it in the third pass
          // Only do this if we have classification student work for questions on this page
          const hasClassificationForPage = originalQuestionsForFiltering.some(q => 
            q.sourceImageIndex === pageIndex && 
            (q.studentWork || (q.subQuestions && q.subQuestions.some(sq => sq.studentWork)))
          );
          if (hasClassificationForPage) {
            blockToClassificationMap.set(blockId, {
              block,
              matches: [] // Empty matches - will be filled by positional fallback
            });
          }
        }
        
        if (isQ5aBlock40) {
          console.log(`[Q5a "40" TRACE] Block "${blockText}" (Y=${block.coordinates?.y ?? 'null'}) → KEPT as student work`);
        }
        return true; // Keep student work
      }
    });
    
    // TEMPORARY DEBUG: Log filtering results
    console.log(`\n[FILTERING] ========== Page ${pageIndex} (Questions: ${questionsOnThisPage}) ==========`);
    console.log(`[FILTERING] Total blocks: ${blocksOnPage.length}, Filtered (QT): ${questionTextBlocks.length}, Kept (SW): ${studentWorkBlocks.length}`);
    filteringResults.forEach((result, idx) => {
      const status = result.isQuestionText ? '❌ FILTERED' : '✅ KEPT';
      const reason = result.reason || 'unknown';
      const conf = result.confidence !== undefined ? ` (conf=${result.confidence.toFixed(2)})` : '';
      console.log(`[FILTERING]   Block ${idx + 1}: ${status} - "${result.blockText}${result.blockText.length >= 80 ? '...' : ''}" → ${reason}${conf}`);
    });
    console.log(`[FILTERING] ============================================================\n`);
    
    // Resolve one-to-many and many-to-one mappings using highest similarity + order-based matching
    // Map: classificationLine -> { bestBlock, similarity }
    const classificationToBlockMap = new Map<string, { blockId: string; block: MathBlock & { pageIndex: number }; similarity: number }>();
    // Map: blockId -> { bestClassificationLine, similarity }
    const resolvedBlockToClassificationMap = new Map<string, { classificationLine: string; similarity: number; questionNumber?: string; subQuestionPart?: string }>();
    
    // Helper: Apply order-based boost to similarity scores
    // For blocks that match classification lines at the same position, boost similarity
    const applyOrderBasedBoost = (
      block: MathBlock & { pageIndex: number },
      matches: Array<{ classificationLine: string; similarity: number; questionNumber?: string; subQuestionPart?: string }>,
      questionsOnPage: Array<{ questionNumber: string; schemeKey: string }>
    ): Array<{ classificationLine: string; similarity: number; questionNumber?: string; subQuestionPart?: string }> => {
      const blockOrderIndex = (block as any).originalOrderIndex;
      if (blockOrderIndex == null) return matches; // No order info available
      
      // Get classification student work for questions on this page
      const classificationQuestionsOnPage = (classificationResult.questions || []).filter((q: any) => {
        const pageIdx = q.sourceImageIndex ?? 0;
        return pageIdx === block.pageIndex;
      });
      
      // For each question, get student work lines in order
      for (const qInfo of questionsOnPage) {
        const classificationQ = classificationQuestionsOnPage.find((q: any) => {
          const mainQNum = String(q.questionNumber || '');
          const qNum = qInfo.questionNumber;
          const baseQNum = getBaseQuestionNumber(qNum);
          return mainQNum === baseQNum || mainQNum === qNum;
        });
        
        if (!classificationQ) continue;
        
        // Get student work lines in order
        let studentWorkLines: string[] = [];
        if (classificationQ.studentWork) {
          studentWorkLines = classificationQ.studentWork.split(/\n|\\newline|\\\\/)
            .map(l => l.trim())
            .filter(l => l.length > 0);
        } else if (classificationQ.subQuestions && Array.isArray(classificationQ.subQuestions)) {
          // Combine sub-question student work lines
          for (const subQ of classificationQ.subQuestions) {
            if (subQ.studentWork) {
              const subQLines = subQ.studentWork.split(/\n|\\newline|\\\\/)
                .map(l => l.trim())
                .filter(l => l.length > 0);
              studentWorkLines.push(...subQLines);
            }
          }
        }
        
        if (studentWorkLines.length === 0) continue;
        
        // For order-based boost, we need to find this block's position relative to blocks
        // that belong to THIS question. Since we don't know which blocks belong to which
        // question yet, we'll use a conservative approach: only boost if the match's
        // classification line is already in the matches list AND the block's position
        // (relative to all blocks) aligns with the classification line's position.
        // This prevents incorrect cross-question matching.
        
        // Get all student work blocks sorted by orderIndex
        const allBlocksSorted = studentWorkBlocks
          .map(b => ({ block: b, orderIndex: (b as any).originalOrderIndex ?? Infinity }))
          .filter(b => b.orderIndex !== Infinity)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        
        // Find this block's position in the sorted list
        const blockPosition = allBlocksSorted.findIndex(b => b.block === block);
        if (blockPosition === -1) continue;
        
        // Only apply order-based boost if:
        // 1. The block position is within the range of classification lines for this question
        // 2. The match's classification line is already in the matches (indicating some similarity)
        // 3. The match's classification line is at the expected position
        // 4. CRITICAL: Only boost if there's no high-similarity match already (>= 0.65)
        //    This prevents overriding correct matches with position-based incorrect ones
        const hasHighSimilarityMatch = matches.some(m => m.similarity >= 0.65);
        
        if (blockPosition < studentWorkLines.length && !hasHighSimilarityMatch) {
          const expectedLine = studentWorkLines[blockPosition];
          
          // Boost similarity for matches at the same position
          return matches.map(match => {
            // Only boost if:
            // - The match line is the expected line at this position
            // - Similarity is already decent (>= 0.30) but not too high (< 0.65) to avoid overriding good matches
            // - The match is for this question (questionNumber matches)
            if (match.classificationLine === expectedLine && 
                match.similarity >= 0.30 && match.similarity < 0.65 &&
                (match.questionNumber === qInfo.questionNumber || 
                 getBaseQuestionNumber(match.questionNumber || '') === getBaseQuestionNumber(qInfo.questionNumber))) {
              // Position matches - boost similarity by 0.15-0.20
              // Larger boost for lower similarity (helps borderline cases like Q18)
              const boost = Math.min(0.20, (0.60 - match.similarity) * 0.5);
              return {
                ...match,
                similarity: Math.min(1.0, match.similarity + boost)
              };
            }
            return match;
          });
        }
      }
      
      return matches;
    };
    
    // First pass: For each classification line, find the best matching OCR block
    for (const [blockId, { block, matches }] of blockToClassificationMap.entries()) {
      // Apply order-based boost to matches
      const boostedMatches = applyOrderBasedBoost(block, matches, questionsOnPage);
      
      for (const match of boostedMatches) {
        const existing = classificationToBlockMap.get(match.classificationLine);
        if (!existing || match.similarity > existing.similarity) {
          classificationToBlockMap.set(match.classificationLine, {
            blockId,
            block,
            similarity: match.similarity
          });
        }
      }
    }
    
    // Second pass: For each OCR block, find the best matching classification line
    // Also try positional matching for blocks with no matches or low similarity
    for (const [blockId, { block, matches }] of blockToClassificationMap.entries()) {
      // Apply order-based boost
      const boostedMatches = applyOrderBasedBoost(block, matches, questionsOnPage);
      
      // Find the best match for this block (highest similarity)
      const bestMatch = boostedMatches.length > 0 
        ? boostedMatches.reduce((best, current) => 
            current.similarity > best.similarity ? current : best
          )
        : null;
      
      if (bestMatch) {
        // Check if this classification line is already taken by a better block
        const existingForLine = classificationToBlockMap.get(bestMatch.classificationLine);
        if (existingForLine && existingForLine.blockId === blockId) {
          // This block is the best match for this classification line
          resolvedBlockToClassificationMap.set(blockId, bestMatch);
        } else if (!existingForLine || bestMatch.similarity > existingForLine.similarity) {
          // This block is better than the existing one, or no existing one
          resolvedBlockToClassificationMap.set(blockId, bestMatch);
          if (existingForLine) {
            // Remove the old mapping
            resolvedBlockToClassificationMap.delete(existingForLine.blockId);
          }
        }
      }
    }
    
    // Third pass: Best-match fallback for blocks with no matches or very low similarity
    // This helps cases like Q18 and Q20 where OCR quality is low but order is preserved
    // NEW DESIGN: Find best match for each block (not index-based), use position as tie-breaker
    const blocksWithoutMapping = studentWorkBlocks.filter(b => {
      const blockId = (b as any).globalBlockId || `${b.pageIndex}_${b.coordinates?.x}_${b.coordinates?.y}`;
      return !resolvedBlockToClassificationMap.has(blockId);
    });
    
    // Debug: Log unmapped blocks for Q18 and Q20
    if (blocksWithoutMapping.length > 0 && (pageIndex === 3 || pageIndex === 7)) {
      console.log(`[DEBUG] Page ${pageIndex}: ${blocksWithoutMapping.length} blocks without mapping`);
    }
    
    if (blocksWithoutMapping.length > 0) {
      // Group blocks by question and try best-match with positional boost
      for (const qInfo of questionsOnPage) {
        const classificationQ = (classificationResult.questions || []).find((q: any) => {
          const pageIdx = q.sourceImageIndex ?? 0;
          const mainQNum = String(q.questionNumber || '');
          const qNum = qInfo.questionNumber;
          const baseQNum = getBaseQuestionNumber(qNum);
          return pageIdx === pageIndex && (mainQNum === baseQNum || mainQNum === qNum);
        });
        
        if (!classificationQ) continue;
        
        // Get student work lines in order
        let studentWorkLines: string[] = [];
        if (classificationQ.studentWork) {
          studentWorkLines = classificationQ.studentWork.split(/\n|\\newline|\\\\/)
            .map(l => l.trim())
            .filter(l => l.length > 0);
        } else if (classificationQ.subQuestions && Array.isArray(classificationQ.subQuestions)) {
          for (const subQ of classificationQ.subQuestions) {
            if (subQ.studentWork) {
              const subQLines = subQ.studentWork.split(/\n|\\newline|\\\\/)
                .map(l => l.trim())
                .filter(l => l.length > 0);
              studentWorkLines.push(...subQLines);
            }
          }
        }
        
        if (studentWorkLines.length === 0) continue;
        
        // Get blocks for this question (sorted by orderIndex)
        const blocksForQuestion = blocksWithoutMapping
          .map(b => ({ block: b, orderIndex: (b as any).originalOrderIndex ?? Infinity }))
          .filter(b => b.orderIndex !== Infinity)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        
        if (blocksForQuestion.length === 0) continue;
        
        // NEW APPROACH: For each block, find the best matching classification line
        // Use position as a boost when similarity is close, not as a hard requirement
        // This handles missing blocks, out-of-order blocks, and count mismatches
        const usedLines = new Set<number>(); // Track which classification lines are already matched
        
        for (const { block, orderIndex } of blocksForQuestion) {
          const blockId = (block as any).globalBlockId || `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
          if (resolvedBlockToClassificationMap.has(blockId)) continue;
          
          const blockText = (block.mathpixLatex || block.googleVisionText || '').trim();
          
          // Skip obviously invalid blocks (very short, empty, or just punctuation)
          // Also skip LaTeX empty patterns like "\( \_\_\_\_ \)" or similar
          if (blockText.length < 3 || 
              /^[_\-\s]+$/.test(blockText) ||
              /^\\?\(?\s*[_\-\s]+\s*\\?\)?$/.test(blockText) ||
              /^\\?\(?\s*\\_+\\_+\\_+\\_+\s*\\?\)?$/.test(blockText)) {
            continue;
          }
          
          // CRITICAL: Skip blocks that look like question text
          // Check if block contains question text patterns (e.g., "Given that", "Work out", "Show that")
          // This prevents question text blocks from matching student work
          const questionTextPatterns = [
            /given\s+that/i,
            /work\s+out/i,
            /show\s+that/i,
            /find\s+the/i,
            /calculate/i,
            /determine/i,
            /solve/i,
            /prove/i,
            /sketch/i,
            /draw/i,
            /plot/i
          ];
          
          // If block contains question text patterns and is long (> 20 chars), likely question text
          // Short blocks (< 10 chars) might be valid student work even with these words
          if (blockText.length > 20 && questionTextPatterns.some(pattern => pattern.test(blockText))) {
            // Additional check: if it also contains math expressions that look like question setup
            // (e.g., "2^x = \frac{2^n}{\sqrt{2}}" is question text, not student work)
            if (blockText.includes('=') && blockText.length > 30) {
              continue; // Skip - likely question text
            }
          }
          
          // CRITICAL: Detect question setup blocks (multiple equations with exponents/fractions)
          // These are typically the "given" equations in the question, not student work
          // Pattern: Multiple equations (multiple '=' signs) with exponents (^{}) or fractions (\frac{})
          // Example: "2^x = \frac{2^n}{\sqrt{2}} \quad 2^y = (\sqrt{2})^5" is question setup
          const equationCount = (blockText.match(/=/g) || []).length;
          const hasExponents = /\\?\^\{?[^}]+\}?/.test(blockText) || /\^[0-9a-zA-Z]/.test(blockText);
          const hasFractions = /\\frac\{[^}]+\}\{[^}]+\}/.test(blockText);
          const hasRoots = /\\sqrt/.test(blockText);
          
          // If block has multiple equations (>= 2) with exponents/fractions/roots, likely question setup
          // Student work typically has one equation per block, or sequential equations
          // Question setup often has multiple equations side-by-side (separated by \quad or spaces)
          if (equationCount >= 2 && (hasExponents || hasFractions || hasRoots) && blockText.length > 30) {
            // Additional check: if it contains \quad (LaTeX spacing) or multiple equations on same line
            // This is a strong indicator of question setup (given equations)
            if (blockText.includes('\\quad') || blockText.includes('\\qquad')) {
              continue; // Skip - likely question setup (given equations)
            }
            // Also check if equations are side-by-side (no newlines between them)
            // Student work typically has equations on separate lines
            const equations = blockText.split('=');
            if (equations.length >= 3) {
              // Multiple equations in one block - likely question setup
              continue; // Skip - likely question setup
            }
          }
          
          // Find best matching classification line for this block
          let bestMatch: { lineIndex: number; similarity: number; classificationLine: string } | null = null;
          
          for (let lineIdx = 0; lineIdx < studentWorkLines.length; lineIdx++) {
            if (usedLines.has(lineIdx)) continue; // Skip already matched lines
            
            const classificationLine = studentWorkLines[lineIdx];
            const similarity = calculateOcrToDatabaseSimilarity(blockText, classificationLine);
            
            // Calculate position-based boost
            // If block position aligns with line position, boost similarity
            // This helps when blocks are in correct order
            let boostedSimilarity = similarity;
            const expectedPosition = lineIdx; // Expected position of this line
            const blockPosition = blocksForQuestion.findIndex(b => b.block === block);
            
            // If block is at expected position (within ±1), boost similarity slightly
            // BUT: Only boost if similarity is already reasonable (>= 0.40)
            // This prevents wrong matches from being boosted just because they're in the right position
            if (Math.abs(blockPosition - expectedPosition) <= 1 && similarity >= 0.40) {
              // Boost by 0.05-0.10 if similarity is already decent (>= 0.40)
              // Smaller boost to avoid overriding content validation
              const positionBoost = Math.min(0.10, (0.60 - similarity) * 0.2);
              boostedSimilarity = Math.min(1.0, similarity + positionBoost);
            }
            
            // Track best match (considering both similarity and position boost)
            if (!bestMatch || boostedSimilarity > bestMatch.similarity) {
              bestMatch = {
                lineIndex: lineIdx,
                similarity: boostedSimilarity,
                classificationLine
              };
            }
          }
          
          // Only create mapping if best match has reasonable similarity
          // Require minimum 0.45 similarity to ensure content validation
          // This prevents question text blocks and wrong matches from being mapped
          // Position boost helps borderline cases (0.40-0.45) by boosting them above 0.45
          if (bestMatch && bestMatch.similarity >= 0.45) {
            resolvedBlockToClassificationMap.set(blockId, {
              classificationLine: bestMatch.classificationLine,
              similarity: Math.max(bestMatch.similarity, 0.50), // Boost to at least 0.50 for matches
              questionNumber: qInfo.questionNumber,
              subQuestionPart: undefined
            });
            usedLines.add(bestMatch.lineIndex); // Mark this line as used
            
            // Debug: Log successful best-match for Q18 and Q20
            if (pageIndex === 3 || pageIndex === 7) {
              console.log(`[DEBUG] Best-match: block "${blockText.substring(0, 40)}..." → line[${bestMatch.lineIndex}] "${bestMatch.classificationLine.substring(0, 40)}..." (sim=${bestMatch.similarity.toFixed(3)})`);
            }
          } else if (pageIndex === 3 || pageIndex === 7) {
            // Debug: Log failed best-match for Q18 and Q20
            console.log(`[DEBUG] Best-match failed: block "${blockText.substring(0, 40)}..." (best sim=${bestMatch?.similarity.toFixed(3) ?? 'N/A'} < 0.35)`);
          }
        }
      }
    }
    
    // Store resolved mapping for this page (will be merged later)
    pageBlockToClassificationMap.set(pageIndex, resolvedBlockToClassificationMap);
    
    // Diagnostic: Log if Q2 or Q5 pages have very few student work blocks (potential filtering issue)
    if (pageIndex === 1 || pageIndex === 5) {
      const questionNumbers = questionsOnPage.map(q => `Q${q.questionNumber}`).join(', ');
      if (studentWorkBlocks.length < 3) {
        console.warn(`[SEGMENTATION] ⚠️ Page ${pageIndex} (${questionNumbers}): Only ${studentWorkBlocks.length} student work block(s) after filtering (${blocksOnPage.length} total blocks, ${questionTextBlocks.length} question text blocks). This may indicate over-filtering.`);
      } else {
        console.log(`[SEGMENTATION] Page ${pageIndex} (${questionNumbers}): ${studentWorkBlocks.length} student work blocks, ${questionTextBlocks.length} question text blocks`);
      }
    }
    
    // Store filtered blocks for reuse in fallback assignment
    pageFilteredBlocks.set(pageIndex, studentWorkBlocks);
    // Store question text max order for this page
    pageQuestionTextMaxOrderMap.set(pageIndex, questionTextMaxOrderMap);
    
    if (hasMultipleDifferentSchemes && boundaries.length === 0) {
      console.warn(`[SEGMENTATION] ⚠️ Page ${pageIndex}: No boundaries found for questions ${questionsOnPage.map(q => `Q${q.questionNumber}`).join(', ')}, will use text matching fallback`);
    } else if (hasMultipleDifferentSchemes && boundaries.length > 0) {
      const boundaryInfo = boundaries.map(b => {
        const endYInfo = b.endY !== null ? `-${b.endY}` : '(no endY)';
        return `Q${b.questionNumber}@startY${b.startY}${endYInfo}`;
      }).join(', ');
      console.log(`[SEGMENTATION] Page ${pageIndex}: Found ${boundaries.length} boundary(ies): ${boundaryInfo}`);
      
      // Log Q14 specifically if present
      const q14Boundary = boundaries.find(b => b.questionNumber === '14');
      if (q14Boundary) {
        console.log(`[SEGMENTATION] Q14 boundary: startY=${q14Boundary.startY}, endY=${q14Boundary.endY !== null ? q14Boundary.endY : 'null'}`);
      }
    }
    
    // For each unique scheme key, assign blocks
    // If multiple questions share the same scheme key (grouped sub-questions), assign all blocks to that scheme
    for (const [schemeKey, schemeQuestions] of questionsByScheme.entries()) {
      // STEP 6: Apply Y-position check and assign blocks to schemes (uses pre-filtered studentWorkBlocks from STEP 4)
      // Trust STEP 4 filtering - no additional classification validation needed
      let blocksToAssign: Array<MathBlock & { pageIndex: number; originalOrderIndex: number }> = [];
      
      // For each student block, find nearest question boundary above it
      // Check if block Y < boundary.endY (block is below question text)
      // This handles multiple schemes on the same page correctly
      if (boundaries.length > 0) {
        // Get all boundaries for this page
        const pageBoundaries = boundaries.filter(b => b.pageIndex === pageIndex);
        
        if (pageBoundaries.length > 0) {
          for (const block of studentWorkBlocks) {
            const blockId = (block as any).globalBlockId || `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
            if (assignedBlocksInPage.has(blockId)) continue;
            
            // Page index match
            if (block.pageIndex !== pageIndex) continue;
            
            const blockY = block.coordinates?.y;
            const blockText = (block.mathpixLatex || block.googleVisionText || '').trim();
            
            if (blockY == null) {
              // Y estimation should have filled this, but if still null, skip (will use order-based assignment fallback)
              continue;
            }
            
            // Find the nearest question boundary ABOVE the block (boundary.startY < blockY)
            // RELAXED: Use startY instead of endY to allow blocks slightly above endY
            // Sort boundaries by startY (top to bottom)
            const boundariesAboveBlock = pageBoundaries
              .filter(b => {
                const boundaryStartY = b.startY;
                return boundaryStartY < blockY; // Boundary is above the block
              })
              .sort((a, b) => {
                return b.startY - a.startY; // Sort descending (bottommost boundary first)
              });
            
            if (boundariesAboveBlock.length > 0) {
              // Found nearest boundary above block - it's the first one (bottommost)
              const nearestBoundary = boundariesAboveBlock[0];
              const boundaryStartY = nearestBoundary.startY;
              
              // Check if multiple boundaries have the same Y position (ambiguous assignment)
              // If so, use student work matching instead of Y-position
              const boundariesWithSameY = boundariesAboveBlock.filter(b => b.startY === boundaryStartY);
              
              if (boundariesWithSameY.length > 1 && hasMultipleDifferentSchemes) {
                // Multiple boundaries at same Y position → use student work matching for disambiguation
                const matchResult = matchBlockToQuestion(block, questionsOnPage, classificationResult);
                if (matchResult && matchResult.schemeKey === schemeKey) {
                  // Block matches this scheme's student work → assign to scheme
                  blocksToAssign.push(block);
                  assignedBlocksInPage.add(blockId);
                }
              } else {
                // Single boundary or no ambiguity → use Y-position assignment
                // Check: block Y > boundary.startY means block is below question text start
                // RELAXED: Use startY instead of endY to allow blocks slightly above endY
                // So block Y > boundaryStartY, which means block is below the boundary start (correct for student work)
                
                // Find which scheme this boundary belongs to
                const questionInfo = questionsOnPage.find(q => q.questionNumber === nearestBoundary.questionNumber);
                
                if (questionInfo && questionInfo.schemeKey === schemeKey) {
                  // Block is below this scheme's question boundary start → assign to scheme
                  // STEP 4 already filtered question text, so we trust these blocks are student work
                  blocksToAssign.push(block);
                  assignedBlocksInPage.add(blockId);
                }
              }
            }
          }
        } else {
          // No boundaries for this page → assign all student work blocks
          // STEP 4 already filtered question text, so we trust these blocks are student work
          for (const block of studentWorkBlocks) {
            const blockId = (block as any).globalBlockId || `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
            if (assignedBlocksInPage.has(blockId)) continue;
            if (block.pageIndex !== pageIndex) continue;
            
            blocksToAssign.push(block);
            assignedBlocksInPage.add(blockId);
          }
        }
      } else {
        // No boundaries found → assign all student work blocks
        // STEP 4 already filtered question text, so we trust these blocks are student work
        for (const block of studentWorkBlocks) {
          const blockId = (block as any).globalBlockId || `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
          if (assignedBlocksInPage.has(blockId)) continue;
          if (block.pageIndex !== pageIndex) continue;
          
          blocksToAssign.push(block);
          assignedBlocksInPage.add(blockId);
        }
      }
      
      // Fallback for blocks with null Y coordinates: use order-based assignment
      const assignedBlocksMap = new Map<string, { block: MathBlock & { pageIndex: number; originalOrderIndex?: number }; questionNumber: string; schemeKey: string }>();
      for (const block of blocksToAssign) {
        const blockId = (block as any).globalBlockId || `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
        // For grouped sub-questions, use first question number as representative
        const representativeQuestion = schemeQuestions.length > 0 ? schemeQuestions[0].questionNumber : null;
        if (representativeQuestion) {
          assignedBlocksMap.set(blockId, { block, questionNumber: representativeQuestion, schemeKey });
        }
      }
      
      // Handle blocks with null Y coordinates using order-based assignment
      for (const block of studentWorkBlocks) {
        const blockId = (block as any).globalBlockId || `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
        if (assignedBlocksInPage.has(blockId)) continue;
        if (block.pageIndex !== pageIndex) continue;
        
        if (block.coordinates?.y == null && block.originalOrderIndex != null && assignedBlocksMap.size > 0) {
          const orderAssigned = assignBlockToQuestionByOrder(block, assignedBlocksMap, questionsOnPage);
          if (orderAssigned) {
            const questionInfo = questionsOnPage.find(q => q.questionNumber === orderAssigned);
            if (questionInfo && questionInfo.schemeKey === schemeKey) {
              // STEP 4 already filtered question text, so we trust these blocks are student work
              blocksToAssign.push(block);
              assignedBlocksInPage.add(blockId);
              assignedBlocksMap.set(blockId, { block, questionNumber: orderAssigned, schemeKey });
            }
          }
        }
      }
      
      // Handle remaining blocks that weren't assigned (fallback)
      if (blocksToAssign.length === 0) {
        // No blocks assigned via Y-position → assign all student work blocks as fallback
        // STEP 4 already filtered question text, so we trust these blocks are student work
        for (const block of studentWorkBlocks) {
          const blockId = (block as any).globalBlockId || `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
          if (assignedBlocksInPage.has(blockId)) continue;
          if (block.pageIndex !== pageIndex) continue;
          
          blocksToAssign.push(block);
          assignedBlocksInPage.add(blockId);
        }
      }
      
      // Assign blocks directly (no redundant filtering - already filtered in Step 1)
      if (blocksToAssign.length > 0) {
        if (!blocksByQuestion.has(schemeKey)) {
          blocksByQuestion.set(schemeKey, []);
        }
        blocksByQuestion.get(schemeKey)!.push(...blocksToAssign);
      }
    }
  }
  
  // Fix: Assign blocks from pages where sub-questions are detected but main question wasn't
  // This handles cases like Q3b on page 4 when Q3a is on page 3, and Q9 on page 9 when Q8 is also on page 9
  const assignedBlockIds = new Set<string>(); // Track which blocks have been assigned
  for (const [schemeKey, blocks] of blocksByQuestion.entries()) {
    blocks.forEach(block => {
      assignedBlockIds.add((block as any).globalBlockId || `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`);
    });
  }
  
  for (const q of flattenedQuestions) {
    const schemeKey = questionToSchemeMap.get(q.questionNumber) || q.questionNumber; // Use question number as fallback
    
    // Check if this question's page has unassigned blocks
    // Use pre-filtered blocks from page-level filtering (no re-filtering)
    const pageFilteredBlocksForPage = pageFilteredBlocks.get(q.sourceImageIndex) || [];
    if (pageFilteredBlocksForPage.length === 0) continue;
    
    // Check if blocks from this page are already assigned to this scheme
    const existingBlocks = blocksByQuestion.get(schemeKey) || [];
    const existingPages = new Set(existingBlocks.map(b => b.pageIndex));
    if (existingPages.has(q.sourceImageIndex)) continue; // Already has blocks from this page
    
    // Filter out already-assigned blocks only (no question text filtering - already done in STEP 4)
    // STEP 4 already filtered question text, so we trust these blocks are student work
    const unassignedBlocks = pageFilteredBlocksForPage.filter(block => {
      const blockId = (block as any).globalBlockId || `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
      if (assignedBlockIds.has(blockId)) return false; // Already assigned to another question
      
      return true; // Keep unassigned blocks (already filtered for question text in STEP 4)
    });
    
    if (unassignedBlocks.length > 0) {
      console.log(`[SEGMENTATION] Assigning ${unassignedBlocks.length} blocks from Page ${q.sourceImageIndex} to ${schemeKey} (Q${q.questionNumber}, missed during initial assignment)`);
      if (!blocksByQuestion.has(schemeKey)) {
        blocksByQuestion.set(schemeKey, []);
      }
      blocksByQuestion.get(schemeKey)!.push(...unassignedBlocks);
      // Track these as assigned
      unassignedBlocks.forEach(block => {
        assignedBlockIds.add((block as any).globalBlockId || `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`);
      });
    }
  }
  
  // 7.5. Create map from schemeKey to classificationStudentWork
  // This allows us to pass student work (including [DRAWING]) to marking tasks
  const schemeKeyToStudentWork = new Map<string, string | null>();
  classificationResult.questions.forEach((q: any) => {
    const questionNumber = q.questionNumber;
    if (!questionNumber) return;
    
    // Find the scheme key for this question
    // For grouped sub-questions, the main question number might not be in the map
    // (only flattened sub-question numbers like "12i", "12ii" are in the map)
    // So we need a fallback: if main question lookup fails, try sub-question numbers
    let schemeKey = questionToSchemeMap.get(questionNumber);
    
    // If not found and has sub-questions, try looking up using sub-question numbers
    // Try all sub-questions to find the scheme key (they should all map to the same merged scheme)
    if (!schemeKey && q.subQuestions && Array.isArray(q.subQuestions) && q.subQuestions.length > 0) {
      for (const subQ of q.subQuestions) {
        const subQNumber = `${questionNumber}${subQ.part || ''}`;
        const foundSchemeKey = questionToSchemeMap.get(subQNumber);
        if (foundSchemeKey) {
          schemeKey = foundSchemeKey;
          break; // All sub-questions map to the same scheme, so we only need to find it once
        }
      }
    }
    
    if (schemeKey) {
      // For grouped sub-questions, collect student work from all sub-questions
      let combinedStudentWork: string | null = null;
      
      // Main question student work
      if (q.studentWork && q.studentWork !== 'null' && q.studentWork.trim().length > 0) {
        combinedStudentWork = q.studentWork;
      }
      
      // Sub-question student work (append with \n if main work exists)
      // CRITICAL: Include [DRAWING] entries even if they don't have text (they're valid student work)
      if (q.subQuestions && Array.isArray(q.subQuestions)) {
        const subQStudentWork = q.subQuestions
          .map((sq: any) => sq.studentWork)
          .filter((sw: any) => sw && sw !== 'null' && (sw.trim() || sw.includes('[DRAWING]'))) // Keep [DRAWING] even if empty after trim
          .join('\\n');
        
        if (subQStudentWork) {
          if (combinedStudentWork) {
            combinedStudentWork = `${combinedStudentWork}\\n${subQStudentWork}`;
          } else {
            combinedStudentWork = subQStudentWork;
          }
        }
      }
      
      // Store the combined student work for this scheme key
      // If multiple questions map to same scheme (grouped sub-questions), combine them
      if (combinedStudentWork) {
        const existing = schemeKeyToStudentWork.get(schemeKey);
        if (existing) {
          schemeKeyToStudentWork.set(schemeKey, `${existing}\\n${combinedStudentWork}`);
        } else {
          schemeKeyToStudentWork.set(schemeKey, combinedStudentWork);
        }
      } else {
        // Set to null if no student work (so we know it was checked)
        schemeKeyToStudentWork.set(schemeKey, null);
      }
    }
  });
  
  // 8. Create marking tasks
  const tasks: MarkingTask[] = [];
  for (const [schemeKey, blocks] of blocksByQuestion.entries()) {
    if (blocks.length === 0) {
      console.warn(`[SEGMENTATION] No blocks assigned to ${schemeKey}, skipping`);
      continue;
    }
    
    // Sort blocks by page and Y position
    // Preserve MathPix reading order for blocks with null Y coordinates
    // This allows order-based interpolation for drawing positions
    blocks.sort((a, b) => {
      if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
      
      const aY = a.coordinates?.y;
      const bY = b.coordinates?.y;
      
      // If both have Y coordinates, sort by Y
      if (aY != null && bY != null) {
        return aY - bY;
      }
      
      // If one has Y and one doesn't, put null Y at the end (preserves relative order)
      if (aY == null && bY == null) {
        // Both null - preserve original MathPix order (stable sort)
        return 0;
      }
      if (aY == null) return 1; // a goes after b
      if (bY == null) return -1; // b goes after a
      
      return 0; // Shouldn't reach here
    });
    
    const sourcePages = [...new Set(blocks.map(b => b.pageIndex))].sort((a, b) => a - b);
    
    // Attach marking scheme directly from detectedSchemesMap
    // If no scheme found (non-past paper question), allow null scheme for basic marking
    const markingScheme = detectedSchemesMap.get(schemeKey);
    if (!markingScheme) {
      console.warn(`[SEGMENTATION] ⚠️ No marking scheme found for ${schemeKey}, will use basic marking (no scheme)`);
    }
    
    // Get classification student work for this scheme key
    const classificationStudentWork = schemeKeyToStudentWork.get(schemeKey) || null;
    
    // Collect block-to-classification mapping for blocks in this task
    const taskBlockToClassificationMap = new Map<string, { classificationLine: string; similarity: number; questionNumber?: string; subQuestionPart?: string }>();
    for (const block of blocks) {
      const blockId = (block as any).globalBlockId || `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
      const pageMapping = pageBlockToClassificationMap.get(block.pageIndex);
      if (pageMapping && pageMapping.has(blockId)) {
        taskBlockToClassificationMap.set(blockId, pageMapping.get(blockId)!);
      }
    }
    
    tasks.push({
      questionNumber: schemeKey,
      mathBlocks: blocks,
      markingScheme: markingScheme || null, // Allow null for non-past paper questions
      sourcePages,
      classificationStudentWork, // Pass classification-extracted student work (may include [DRAWING])
      pageDimensions, // Pass page dimensions for accurate bbox estimation
      blockToClassificationMap: taskBlockToClassificationMap.size > 0 ? taskBlockToClassificationMap : undefined
    });
    
    const studentWorkInfo = classificationStudentWork ? ` (with student work: ${classificationStudentWork.substring(0, 50)}...)` : '';
    console.log(`[SEGMENTATION] Created task for ${schemeKey}: ${blocks.length} blocks from pages [${sourcePages.join(', ')}]${studentWorkInfo}`);
  }
  
  console.log(`[SEGMENTATION] ✅ Created ${tasks.length} marking task(s)`);
  
  // Print detailed summary table with column format
  // ANSI color codes for terminal output
  const GREEN = '\x1b[32m';
  const RESET = '\x1b[0m';
  const CYAN = '\x1b[36m';
  const YELLOW = '\x1b[33m';
  const BLUE = '\x1b[34m';
  
  console.log(`\n${CYAN}[SEGMENTATION SUMMARY]${RESET}`);
  console.log('═'.repeat(150));
  for (const task of tasks) {
    // Find original classification questions for this scheme key
    const schemeKey = task.questionNumber;
    const classificationQuestionsForScheme: Array<{
      questionNumber: string;
      mainStudentWork?: string | null;
      subQuestions: Array<{ part: string; studentWork?: string | null }>;
      drawings: number;
    }> = [];
    
    // Extract base question number from scheme key (e.g., "11" from "11" or "12_Pearson Edexcel_1MA1/1H")
    const baseQuestionNumberFromSchemeKey = String(schemeKey).split('_')[0].replace(/^Q?(\d+).*/, '$1');
    // Simplify question identifier (e.g., "10_Pearson Edexcel_1MA1/1H" → "10")
    const questionId = baseQuestionNumberFromSchemeKey;
    
    // Map scheme key back to original classification questions
    classificationResult.questions.forEach((q: any) => {
      const questionNumber = q.questionNumber;
      if (!questionNumber) return;
      
      // Check if this question maps to the current scheme key
      const qSchemeKey = questionToSchemeMap.get(questionNumber);
      // Also check if question number matches base question number from scheme key (for questions without scheme like Q11)
      const questionNumberMatches = questionNumber === baseQuestionNumberFromSchemeKey;
      
      // Check if this question matches the scheme key
      const matchesBySchemeKey = qSchemeKey === schemeKey;
      // For questions without scheme (like Q11), match by question number
      const matchesByQuestionNumber = questionNumberMatches && !qSchemeKey && questionNumber === baseQuestionNumberFromSchemeKey;
      
      if (matchesBySchemeKey || matchesByQuestionNumber) {
        // Check if we already added this question (prevent duplicates)
        const existing = classificationQuestionsForScheme.find(cq => cq.questionNumber === questionNumber);
        if (!existing) {
          // Count drawings in main student work
          const mainDrawings = q.studentWork ? (q.studentWork.match(/\[DRAWING\]/g) || []).length : 0;
          
          // Count drawings in sub-question student work
          let subDrawings = 0;
          const subQuestions: Array<{ part: string; studentWork?: string | null }> = [];
          if (q.subQuestions && Array.isArray(q.subQuestions)) {
            q.subQuestions.forEach((subQ: any) => {
              const subQStudentWork = subQ.studentWork || null;
              const subQDrawings = subQStudentWork ? (subQStudentWork.match(/\[DRAWING\]/g) || []).length : 0;
              subDrawings += subQDrawings;
              subQuestions.push({
                part: subQ.part || '',
                studentWork: subQStudentWork
              });
            });
          }
          
          classificationQuestionsForScheme.push({
            questionNumber,
            mainStudentWork: q.studentWork || null,
            subQuestions,
            drawings: mainDrawings + subDrawings
          });
        }
      }
    });
    
    // Helper function to truncate and format drawing text to 20 words, wrapped to fit column
    const formatDrawingText = (text: string, maxWidth: number = 45): string => {
      const words = text.split(/\s+/);
      const truncatedWords = words.slice(0, 20);
      const truncated = truncatedWords.join(' ');
      const result = truncated + (words.length > 20 ? '...' : '');
      
      // Wrap text to fit within column width
      const lines: string[] = [];
      let currentLine = '';
      const wordsInResult = result.split(/\s+/);
      wordsInResult.forEach(word => {
        if ((currentLine + ' ' + word).length > maxWidth && currentLine.length > 0) {
          lines.push(currentLine.trim());
          currentLine = word;
        } else {
          currentLine = currentLine ? currentLine + ' ' + word : word;
        }
      });
      if (currentLine) {
        lines.push(currentLine.trim());
      }
      // Join lines with newline, but we'll handle multi-line display differently
      return lines.join('\n');
    };
    
    // Build marking scheme content for header
    let schemeHeader = '';
    if (task.markingScheme) {
      // Extract marks array - handle different structures
      let marks: any[] = [];
      if (task.markingScheme.questionMarks?.marks) {
        marks = task.markingScheme.questionMarks.marks;
      } else if (Array.isArray(task.markingScheme.questionMarks)) {
        marks = task.markingScheme.questionMarks;
      } else if (Array.isArray(task.markingScheme.marks)) {
        marks = task.markingScheme.marks;
      }
      
      if (Array.isArray(marks) && marks.length > 0) {
        const markCodes = marks.map((m: any) => {
          if (typeof m === 'string') return m;
          if (m.mark) return m.mark;
          if (m.type) return m.type;
          return '?';
        }).filter(Boolean);
        const totalMarks = task.markingScheme.totalMarks || marks.length;
        schemeHeader = ` (Scheme: ${totalMarks} marks - ${markCodes.join(', ')})`;
      } else {
        const totalMarks = task.markingScheme.totalMarks || 0;
        schemeHeader = ` (Scheme: ${totalMarks} marks)`;
      }
    } else {
      schemeHeader = ' (No scheme)';
    }
    
    // Helper function to find matching OCR block numbers for a classification line
    // Uses the real mapping from STEP 4 (blockToClassificationMap) instead of separate matching logic
    const findMatchingBlockNumbers = (classificationLine: string): number[] => {
      const matchingBlocks: number[] = [];
      if (!task.blockToClassificationMap) return matchingBlocks;
      
      task.mathBlocks.forEach((block, idx) => {
        const blockId = (block as any).globalBlockId || `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
        const mapping = task.blockToClassificationMap!.get(blockId);
        if (mapping && mapping.classificationLine.trim() === classificationLine.trim()) {
          matchingBlocks.push(idx + 1); // 1-based index for display
        }
      });
      return matchingBlocks;
    };
    
    // Helper function to format block numbers in blue
    const formatBlockNumbers = (blockNumbers: number[]): string => {
      if (blockNumbers.length === 0) return '';
      return `${BLUE}[${blockNumbers.join(',')}]${RESET} `;
    };
    
    // Build classification student work content with line breaks
    // We'll build a structure that tracks multi-line entries to maintain column alignment
    interface TableRow {
      classification: string;
      blocks: string;
    }
    const tableRows: TableRow[] = [];
    
    if (classificationQuestionsForScheme.length > 0) {
      classificationQuestionsForScheme.forEach(cq => {
        // Main question student work
        if (cq.mainStudentWork) {
          tableRows.push({ classification: 'Main:', blocks: '' });
          const mainLines = cq.mainStudentWork.split(/\n|\\n/).filter(l => l.trim().length > 0);
          mainLines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.includes('[DRAWING]')) {
              // Format drawing (truncate to 20 words, wrap to fit column)
              const formatted = formatDrawingText(trimmed, 45);
              const drawingLines = formatted.split('\n');
              drawingLines.forEach((dl, idx) => {
                // For drawings, find matching blocks (usually none, as drawings are synthetic)
                const matchingBlocks = idx === 0 ? findMatchingBlockNumbers(trimmed) : [];
                const blockNumbersStr = formatBlockNumbers(matchingBlocks);
                tableRows.push({ 
                  classification: `  ${blockNumbersStr}${dl}`, 
                  blocks: idx === 0 ? '' : '' 
                });
              });
            } else {
              // Find matching OCR block numbers for this classification line
              const matchingBlocks = findMatchingBlockNumbers(trimmed);
              const blockNumbersStr = formatBlockNumbers(matchingBlocks);
              tableRows.push({ classification: `  ${blockNumbersStr}${trimmed}`, blocks: '' });
            }
          });
        }
        
        // Sub-question student work
        if (cq.subQuestions.length > 0) {
          cq.subQuestions.forEach((sq, idx) => {
            if (sq.studentWork) {
              // Handle null/empty parts (e.g., Q11 sub-questions have null parts)
              const subPart = sq.part && sq.part.trim() ? sq.part : `[${idx + 1}]`;
              tableRows.push({ classification: `Sub[${subPart}]:`, blocks: '' });
              const subLines = sq.studentWork.split(/\n|\\n/).filter(l => l.trim().length > 0);
              subLines.forEach(line => {
                const trimmed = line.trim();
                if (trimmed.includes('[DRAWING]')) {
                  // Format drawing (truncate to 20 words, wrap to fit column)
                  const formatted = formatDrawingText(trimmed, 45);
                  const drawingLines = formatted.split('\n');
                  drawingLines.forEach((dl, idx) => {
                    // For drawings, find matching blocks (usually none, as drawings are synthetic)
                    const matchingBlocks = idx === 0 ? findMatchingBlockNumbers(trimmed) : [];
                    const blockNumbersStr = formatBlockNumbers(matchingBlocks);
                    tableRows.push({ 
                      classification: `  ${blockNumbersStr}${dl}`, 
                      blocks: idx === 0 ? '' : '' 
                    });
                  });
                } else {
                  // Find matching OCR block numbers for this classification line
                  const matchingBlocks = findMatchingBlockNumbers(trimmed);
                  const blockNumbersStr = formatBlockNumbers(matchingBlocks);
                  tableRows.push({ classification: `  ${blockNumbersStr}${trimmed}`, blocks: '' });
                }
              });
            }
          });
        }
      });
    } else {
      tableRows.push({ classification: 'None', blocks: '' });
    }
    
    // Build OCR blocks content - add to tableRows
    // Find the first row that has classification but no blocks (the "Main:" or "Sub[...]:" header)
    let blockRowIndex = 0;
    for (let i = 0; i < tableRows.length; i++) {
      if (tableRows[i].classification && !tableRows[i].blocks) {
        blockRowIndex = i;
        break;
      }
    }
    
    // Count synthetic drawing blocks separately
    const drawingEntries = task.classificationStudentWork && task.classificationStudentWork.includes('[DRAWING]')
      ? task.classificationStudentWork.split(/\n|\\n/).filter(e => e.trim().includes('[DRAWING]')).length
      : 0;
    const totalBlocks = task.mathBlocks.length + drawingEntries;
    
    // Add blocks header
    if (tableRows.length > 0 && blockRowIndex < tableRows.length) {
      tableRows[blockRowIndex].blocks = `Blocks (${task.mathBlocks.length} OCR + ${drawingEntries} synthetic):`;
      blockRowIndex++;
    } else {
      tableRows.push({ classification: '', blocks: `Blocks (${task.mathBlocks.length} OCR + ${drawingEntries} synthetic):` });
      blockRowIndex = tableRows.length;
    }
    
    // Add OCR blocks only (not synthetic drawing blocks)
    // Skip rows that already have blocks (from multi-line classification entries)
    task.mathBlocks.forEach((block, idx) => {
      const blockText = (block.mathpixLatex || block.googleVisionText || '').trim();
      const truncated = blockText.length > 80 ? blockText.substring(0, 80) + '...' : blockText;
      const blockNumber = `${BLUE}${idx + 1}${RESET}`;
      
      // Find next available row (one without blocks or with empty blocks)
      while (blockRowIndex < tableRows.length && tableRows[blockRowIndex].blocks && tableRows[blockRowIndex].blocks.trim().length > 0) {
        blockRowIndex++;
      }
      
      if (blockRowIndex < tableRows.length) {
        tableRows[blockRowIndex].blocks = `  ${blockNumber}. "${truncated}"`;
        blockRowIndex++;
      } else {
        tableRows.push({ classification: '', blocks: `  ${blockNumber}. "${truncated}"` });
        blockRowIndex++;
      }
    });
    
    // Add synthetic drawing blocks separately (clearly marked as synthetic, not OCR)
    if (drawingEntries > 0) {
      const drawingEntriesList = task.classificationStudentWork!.split(/\n|\\n/).filter(e => e.trim().includes('[DRAWING]'));
      drawingEntriesList.forEach((drawing, idx) => {
        // Format drawing (truncate to 20 words, wrap to fit column)
        const formatted = formatDrawingText(drawing.trim(), 45);
        const drawingLines = formatted.split('\n');
        const blockNumber = `${BLUE}${task.mathBlocks.length + idx + 1}${RESET}`;
        drawingLines.forEach((dl, lineIdx) => {
          const prefix = lineIdx === 0 ? `  ${blockNumber}. [SYNTHETIC] "` : '    ';
          const suffix = lineIdx === drawingLines.length - 1 ? '"' : '';
          
          // Find next available row (one without blocks or with empty blocks)
          while (blockRowIndex < tableRows.length && tableRows[blockRowIndex].blocks && tableRows[blockRowIndex].blocks.trim().length > 0) {
            blockRowIndex++;
          }
          
          if (blockRowIndex < tableRows.length) {
            tableRows[blockRowIndex].blocks = `${prefix}${dl}${suffix}`;
            blockRowIndex++;
          } else {
            tableRows.push({ classification: '', blocks: `${prefix}${dl}${suffix}` });
            blockRowIndex++;
          }
        });
      });
    }
    
    // Helper function to strip ANSI color codes for width calculation
    const stripAnsiCodes = (str: string): string => {
      return str.replace(/\x1b\[[0-9;]*m/g, '');
    };
    
    // Helper function to pad string accounting for ANSI codes
    const padWithAnsi = (str: string, width: number): string => {
      const visibleLength = stripAnsiCodes(str).length;
      const padding = Math.max(0, width - visibleLength);
      return str + ' '.repeat(padding);
    };
    
    // Print column-based table with green question number
    const questionNumberColored = `${GREEN}Q${questionId}${RESET}`;
    console.log(`${questionNumberColored}${schemeHeader}`);
    console.log('─'.repeat(150));
    
    // Fixed column width for consistent alignment (accounting for ANSI codes)
    const COLUMN_WIDTH = 75;
    tableRows.forEach(row => {
      // Split classification into lines if it contains newlines
      const classificationLines = row.classification.split('\n');
      const blocksLines = row.blocks.split('\n');
      const maxLines = Math.max(classificationLines.length, blocksLines.length);
      
      for (let i = 0; i < maxLines; i++) {
        const classificationLine = classificationLines[i] || '';
        const blocksLine = blocksLines[i] || '';
        // Use ANSI-aware padding to ensure alignment
        const paddedClassification = padWithAnsi(classificationLine, COLUMN_WIDTH);
        console.log(paddedClassification + ' | ' + blocksLine);
      }
    });
    console.log('─'.repeat(150));
  }
  console.log('═'.repeat(150));
  console.log('');
  
  return tasks;
}

