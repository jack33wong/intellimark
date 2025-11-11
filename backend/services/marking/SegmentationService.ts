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
    
    // Try to match against main question student work only
    // All blocks (including sub-question blocks) will be assigned to main question scheme
    // Marking router will merge sub-question schemes automatically
    let studentWorkToMatch: string | null = null;
    if (classificationQ.studentWork) {
      studentWorkToMatch = classificationQ.studentWork;
    }
    
    // If no main student work, skip this question (don't try sub-question matching)
    // This ensures all blocks go to main question scheme, not individual sub-questions
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

function isQuestionTextBlock(
  block: MathBlock & { pageIndex: number },
  classificationQuestions: QuestionForFiltering[],
  similarityThreshold: number = 0.70,
  boundaries?: QuestionBoundary[]
): { isQuestionText: boolean; confidence?: number; matchedQuestion?: string } {
  const blockText = block.mathpixLatex || block.googleVisionText || '';
  if (!blockText.trim()) return { isQuestionText: false };
  
  // PRIORITY CHECK -1: If block matches classification student work, don't filter as metadata/question text
  // This prevents student work blocks (like "40", "5/9", equations) from being incorrectly filtered as question text
  // Use OCR-optimized matching for better accuracy with OCR format variations
  const matchesClassification = classificationQuestions.some(q => {
    if (q.sourceImageIndex !== block.pageIndex) return false;
    
    // Check main question student work
    if (q.studentWork) {
      const studentWorkLines = q.studentWork.split(/\n|\\newline|\\\\/).map(l => l.trim()).filter(l => l.length > 0);
      // Try matching against each line with OCR-optimized matching
      for (const line of studentWorkLines) {
        // Use OCR-optimized similarity for better matching with OCR format variations
        const similarity = calculateOcrToDatabaseSimilarity(blockText, line);
        // Also check substring matching (handles truncated blocks)
        const normalizedBlock = normalizeTextForComparison(blockText);
        const normalizedLine = normalizeTextForComparison(line);
        const isSubstring = normalizedLine.includes(normalizedBlock) || 
                           (normalizedBlock.length > 10 && normalizedLine.includes(normalizedBlock.slice(0, 30)));
        
        // Lower threshold (0.40) since we're matching OCR to classification (both may have format differences)
        if (similarity >= 0.40 || isSubstring || matchesClassificationStudentWork(block, line)) {
          return true;
        }
      }
    }
    
    // Check sub-question student work
    if (q.subQuestions) {
      return q.subQuestions.some(subQ => {
        if (subQ.studentWork) {
          const subQLines = subQ.studentWork.split(/\n|\\newline|\\\\/).map(l => l.trim()).filter(l => l.length > 0);
          // Try matching against each line with OCR-optimized matching
          for (const line of subQLines) {
            const similarity = calculateOcrToDatabaseSimilarity(blockText, line);
            const normalizedBlock = normalizeTextForComparison(blockText);
            const normalizedLine = normalizeTextForComparison(line);
            const isSubstring = normalizedLine.includes(normalizedBlock) || 
                               (normalizedBlock.length > 10 && normalizedLine.includes(normalizedBlock.slice(0, 30)));
            
            if (similarity >= 0.40 || isSubstring || matchesClassificationStudentWork(block, line)) {
              return true;
            }
          }
        }
        return false;
      });
    }
    return false;
  });
  
  if (matchesClassification) {
    // Block matches classification student work → keep it (don't filter as question text/metadata)
    return { isQuestionText: false };
  }
  
  // PRIORITY CHECK 0: Filter page footers/metadata immediately
  if (isPageFooterOrMetadata(block)) {
    return { isQuestionText: true, confidence: 1.0, matchedQuestion: 'metadata' };
  }

  // PRIORITY CHECK 0.2: Filter noise blocks - single characters/numbers that don't match classification student work
  // This catches OCR errors like "a", "へ", "111", "15", "16" that are not valid student work
  const trimmedBlockText = blockText.trim();
  const isNoiseBlock = (() => {
    // Single character (except if it's a valid answer like "H", "F", "J" for Q12)
    if (trimmedBlockText.length === 1) {
      // Check if it matches classification student work (e.g., "H", "F", "J" for Q12)
      const matchesStudentWork = classificationQuestions.some(q => {
        if (q.sourceImageIndex !== block.pageIndex) return false;
        if (q.studentWork && q.studentWork.trim() === trimmedBlockText) return true;
        if (q.subQuestions) {
          return q.subQuestions.some(subQ => {
            return subQ.studentWork && subQ.studentWork.trim() === trimmedBlockText;
          });
        }
        return false;
      });
      // If it doesn't match student work, it's noise
      if (!matchesStudentWork) {
        return true;
      }
    }
    
    // Very short blocks (2-3 chars) that are just numbers or random characters
    if (trimmedBlockText.length <= 3) {
      // Check if it's just numbers (like "11", "12", "13", "14", "15", "111")
      if (/^\d+$/.test(trimmedBlockText)) {
        // Check if it matches classification student work
        const matchesStudentWork = classificationQuestions.some(q => {
          if (q.sourceImageIndex !== block.pageIndex) return false;
          if (q.studentWork && q.studentWork.includes(trimmedBlockText)) {
            // Make sure it's not just a substring of a larger number
            const studentWorkLines = q.studentWork.split(/\n|\\newline|\\\\/);
            return studentWorkLines.some(line => {
              const normalizedLine = normalizeTextForComparison(line);
              const normalizedBlock = normalizeTextForComparison(trimmedBlockText);
              return normalizedLine === normalizedBlock || normalizedLine.endsWith(normalizedBlock);
            });
          }
          return false;
        });
        if (!matchesStudentWork) {
          return true; // It's noise
        }
      }
      
      // Check for random characters like "a ?", "a", "へ"
      if (trimmedBlockText.length <= 2 && !/^[A-Za-z0-9]$/.test(trimmedBlockText)) {
        // Check if it matches classification student work
        const matchesStudentWork = classificationQuestions.some(q => {
          if (q.sourceImageIndex !== block.pageIndex) return false;
          if (q.studentWork && q.studentWork.includes(trimmedBlockText)) return true;
          return false;
        });
        if (!matchesStudentWork) {
          return true; // It's noise
        }
      }
    }
    
    return false;
  })();
  
  if (isNoiseBlock) {
    return { isQuestionText: true, confidence: 0.90, matchedQuestion: 'noise' };
  }

  // PRIORITY CHECK 0.3: Filter mark allocation labels like "(1)", "(2)", "(3)" - these are always question text
  const markAllocationPattern = /^\(?\d+\)?\s*$/;
  if (markAllocationPattern.test(trimmedBlockText)) {
    return { isQuestionText: true, confidence: 0.95, matchedQuestion: 'mark-allocation' };
  }

  // PRIORITY CHECK 0.4: Filter question number labels at start of blocks (e.g., "10", "11", "12", "13", "14")
  // These are typically question text headers, not student work
  const questionNumberPattern = /^(\d+)\s*$/;
  const questionNumberMatch = trimmedBlockText.match(questionNumberPattern);
  if (questionNumberMatch) {
    const qNum = questionNumberMatch[1];
    // Check if this matches a question number on the same page
    const matchesQuestionNumber = classificationQuestions.some(q => {
      if (q.sourceImageIndex !== block.pageIndex) return false;
      const qNumStr = String(q.questionNumber || '').replace(/[^0-9]/g, '');
      return qNumStr === qNum;
    });
    if (matchesQuestionNumber) {
      return { isQuestionText: true, confidence: 0.90, matchedQuestion: 'question-number' };
    }
  }

  // PRIORITY CHECK 0.5: Filter short LaTeX expressions (like "$1$", "$2$") that appear in question text
  // These are often question text examples or references, not student work
  // Check if block is a short LaTeX expression (e.g., "$1$", "$x$", "$y=x^2$") and if it appears in question text
  const isShortLatexExpression = /^\$[^$]+\$$/.test(blockText.trim()) && blockText.trim().length <= 20;
  if (isShortLatexExpression) {
    for (const question of classificationQuestions) {
      if (question.sourceImageIndex !== block.pageIndex) continue;
      
      // Check main question text
      const questionTextToUse = question.databaseText || question.text;
      if (questionTextToUse && questionTextToUse.includes(blockText.trim())) {
        return { isQuestionText: true, confidence: 0.85, matchedQuestion: question.questionNumber || undefined };
      }
      
      // Check sub-question texts
      if (question.subQuestions && Array.isArray(question.subQuestions)) {
        for (const subQ of question.subQuestions) {
          const subQTextToUse = subQ.databaseText || subQ.text;
          if (subQTextToUse && subQTextToUse.includes(blockText.trim())) {
            const matchedQuestion = subQ.part ? `${question.questionNumber}${subQ.part}` : question.questionNumber || undefined;
            return { isQuestionText: true, confidence: 0.85, matchedQuestion };
          }
        }
      }
    }
  }

  const normalizedBlockText = normalizeTextForComparison(blockText);
  
  // PRIORITY CHECK 1: Quick question text matching (before Y-position check)
  // If block clearly matches question text, filter it immediately (even if below boundary)
  // This prevents question text blocks from being kept just because they're slightly below the boundary
  // Use OCR-optimized matching for consistency with boundary calculation
  let quickMatch = false;
  let quickMatchQuestion: string | undefined;
  for (const question of classificationQuestions) {
    if (question.sourceImageIndex !== block.pageIndex) continue;
    
    // Check sub-question texts first (more specific)
    if (question.subQuestions && Array.isArray(question.subQuestions)) {
      for (const subQ of question.subQuestions) {
        const subQTextToUse = subQ.databaseText || subQ.text;
        if (subQTextToUse) {
          // Use OCR-optimized similarity (handles truncation, LaTeX artifacts, OCR errors)
          const similarity = calculateOcrToDatabaseSimilarity(blockText, subQTextToUse);
          
          // Also check substring matching (handles very truncated blocks)
          const normalizedSubQText = normalizeTextForComparison(subQTextToUse);
          if (normalizedSubQText) {
            const blockWithoutLabel = normalizedBlockText.replace(/^\(?[a-zivx]+\)?\s*/i, '').trim();
            const isSubstring = normalizedSubQText.includes(normalizedBlockText) || 
                               (normalizedBlockText.length > 10 && normalizedSubQText.includes(normalizedBlockText.slice(0, 30))) ||
                               (blockWithoutLabel.length > 5 && normalizedSubQText.includes(blockWithoutLabel));
            
            // Lower threshold for OCR matching (0.45) to be more aggressive
            if (similarity >= 0.45 || isSubstring) {
              quickMatch = true;
              quickMatchQuestion = subQ.part ? `${question.questionNumber}${subQ.part}` : question.questionNumber || undefined;
              break;
            }
          }
        }
      }
      if (quickMatch) break;
    }
    
    // Check main question text
    const questionTextToUse = question.databaseText || question.text;
    if (questionTextToUse) {
      // Use OCR-optimized similarity (handles truncation, LaTeX artifacts, OCR errors)
      const similarity = calculateOcrToDatabaseSimilarity(blockText, questionTextToUse);
      
      // Also check substring matching (handles very truncated blocks)
      const normalizedQuestionText = normalizeTextForComparison(questionTextToUse);
      if (normalizedQuestionText) {
        // More aggressive substring matching: check if block starts with question text or vice versa
        const blockStartsWithQuestion = normalizedBlockText.length > 5 && normalizedQuestionText.startsWith(normalizedBlockText.slice(0, Math.min(50, normalizedBlockText.length)));
        const questionStartsWithBlock = normalizedBlockText.length > 5 && normalizedBlockText.startsWith(normalizedQuestionText.slice(0, Math.min(50, normalizedQuestionText.length)));
        const isSubstring = normalizedQuestionText.includes(normalizedBlockText) || 
                           (normalizedBlockText.length > 10 && normalizedQuestionText.includes(normalizedBlockText.slice(0, 30))) ||
                           blockStartsWithQuestion || questionStartsWithBlock;
        
        // Lower threshold for OCR matching (0.45) to be more aggressive
        if (similarity >= 0.45 || isSubstring) {
          quickMatch = true;
          quickMatchQuestion = question.questionNumber || undefined;
          break;
        }
      }
    }
  }
  
  if (quickMatch) {
    return { isQuestionText: true, confidence: 0.80, matchedQuestion: quickMatchQuestion || 'quick-match' };
  }
  
  // PRIORITY CHECK 1.5: Y-position check (if boundaries are provided)
  // Filter blocks that are within question text boundaries (Y < boundary.startY)
  // RELAXED: Use startY instead of endY to allow student work blocks that are slightly above endY
  // Classification matching (PRIORITY CHECK -1) will prevent actual student work from being filtered
  if (boundaries && boundaries.length > 0 && block.coordinates?.y != null) {
    const blockY = block.coordinates.y;
    const blockPage = block.pageIndex;
    
    // Find boundaries on the same page
    const pageBoundaries = boundaries.filter(b => b.pageIndex === blockPage);
    
    // Check if block is within any question text boundary (above startY)
    // RELAXED: Use startY instead of endY to be more lenient
    for (const boundary of pageBoundaries) {
      if (boundary.startY != null && blockY < boundary.startY) {
        // Block is above question text start → filter as question text
        return { isQuestionText: true, confidence: 0.75, matchedQuestion: boundary.questionNumber };
      }
    }
  }
  
  // PRIORITY CHECK 2: Check against all questions on the same page (more thorough matching)
  for (const question of classificationQuestions) {
    if (question.sourceImageIndex !== block.pageIndex) continue;
    
    // Use database question text (preferred) if available, otherwise fallback to classification text
    // This handles cases where questions are NOT past paper questions (not in database)
    const questionTextToUse = question.databaseText || question.text;
    if (questionTextToUse) {
      // Use OCR-optimized similarity (handles truncation, LaTeX artifacts, OCR errors)
      const similarity = calculateOcrToDatabaseSimilarity(blockText, questionTextToUse);
      
      // Also check substring matching (handles very truncated blocks)
      const normalizedQuestionText = normalizeTextForComparison(questionTextToUse);
      if (normalizedQuestionText) { // Only compare if normalized text is not empty
        // More aggressive substring matching
        const blockStartsWithQuestion = normalizedBlockText.length > 5 && normalizedQuestionText.startsWith(normalizedBlockText.slice(0, Math.min(50, normalizedBlockText.length)));
        const questionStartsWithBlock = normalizedBlockText.length > 5 && normalizedBlockText.startsWith(normalizedQuestionText.slice(0, Math.min(50, normalizedQuestionText.length)));
        const isSubstring = normalizedQuestionText.includes(normalizedBlockText) || 
                           (normalizedBlockText.length > 10 && normalizedQuestionText.includes(normalizedBlockText.slice(0, 30))) ||
                           blockStartsWithQuestion || questionStartsWithBlock;
        
        // Lower threshold for OCR matching (0.45) to be more aggressive
        if (similarity >= 0.45 || isSubstring) {
          return { isQuestionText: true, confidence: similarity, matchedQuestion: question.questionNumber || undefined };
        }
      }
    }
    
    // Check sub-question texts with simplified OCR-optimized matching
    // Simplified: Use OCR matching utility but with pattern-based filtering for sub-question labels
    if (question.subQuestions && Array.isArray(question.subQuestions)) {
      for (const subQ of question.subQuestions) {
        // Use database text (preferred) if available, otherwise fallback to classification text
        const subQTextToUse = subQ.databaseText || subQ.text;
        if (!subQTextToUse) continue;
        
        // Use OCR-optimized similarity (handles truncation, LaTeX artifacts, OCR errors)
        const similarity = calculateOcrToDatabaseSimilarity(blockText, subQTextToUse);
        
        // Also check substring matching (handles very truncated blocks)
        const normalizedBlockTextForSubQ = normalizeTextForComparison(blockText);
        const normalizedSubQText = normalizeTextForComparison(subQTextToUse);
        const blockStartsWithSubQ = normalizedBlockTextForSubQ.length > 5 && normalizedSubQText.startsWith(normalizedBlockTextForSubQ.slice(0, Math.min(50, normalizedBlockTextForSubQ.length)));
        const subQStartsWithBlock = normalizedBlockTextForSubQ.length > 5 && normalizedBlockTextForSubQ.startsWith(normalizedSubQText.slice(0, Math.min(50, normalizedSubQText.length)));
        const isSubstring = normalizedSubQText.includes(normalizedBlockTextForSubQ) || 
                           (normalizedBlockTextForSubQ.length > 10 && normalizedSubQText.includes(normalizedBlockTextForSubQ.slice(0, 30))) ||
                           blockStartsWithSubQ || subQStartsWithBlock;
        
        // Pattern-based check: Remove sub-question label (e.g., "(i)", "i)", "i)") and check if remaining text matches
        // This handles cases where OCR block has sub-question label but database text doesn't
        const blockWithoutLabel = normalizedBlockTextForSubQ.replace(/^\(?[a-zivx]+\)?\s*/i, '').trim();
        const blockWithoutLabelIsSubstring = blockWithoutLabel.length > 5 && normalizedSubQText.includes(blockWithoutLabel);
        
        // Lower threshold for sub-question text (0.45) to be more aggressive
        // Match if: OCR similarity high OR substring match OR block without label matches
        const isMatch = similarity >= 0.45 || isSubstring || blockWithoutLabelIsSubstring;
        
        if (isMatch) {
          const matchedQuestion = subQ.part ? `${question.questionNumber}${subQ.part}` : question.questionNumber || undefined;
          return { isQuestionText: true, confidence: similarity, matchedQuestion };
        }
      }
    }
  }
  
  // PRIORITY CHECK 2.5: Filter table data (tabular environments) - these are question context, not student work
  // Check for LaTeX tabular patterns
  if (blockText.includes('\\begin{tabular}') || blockText.includes('\\hline') || blockText.includes('tabular') || 
      blockText.includes('\\end{tabular}') || (blockText.includes('Time') && blockText.includes('Frequency'))) {
    return { isQuestionText: true, confidence: 0.90, matchedQuestion: 'table-data' };
  }
  
  // PRIORITY CHECK 2.55: Filter question text that starts with question numbers followed by question text
  // Pattern: "10 Solve the simultaneous equations", "12 Here are some graphs", "14 Expand and simplify"
  const questionHeaderPattern = /^(\d+)\s+[A-Z]/i;
  if (questionHeaderPattern.test(blockText)) {
    const qNumMatch = blockText.match(/^(\d+)/);
    if (qNumMatch) {
      const qNum = qNumMatch[1];
      // Check if this matches a question number on the same page
      const matchesQuestionNumber = classificationQuestions.some(q => {
        if (q.sourceImageIndex !== block.pageIndex) return false;
        const qNumStr = String(q.questionNumber || '').replace(/[^0-9]/g, '');
        return qNumStr === qNum;
      });
      if (matchesQuestionNumber) {
        // Check if the rest of the text matches question text patterns
        const restOfText = blockText.substring(qNumMatch[0].length).trim();
        const commonQuestionPatterns = [
          /^Solve the/i,
          /^Here are/i,
          /^Expand and simplify/i,
          /^Triangle/i,
          /^The table gives/i
        ];
        const matchesQuestionPattern = commonQuestionPatterns.some(pattern => pattern.test(restOfText));
        if (matchesQuestionPattern) {
          return { isQuestionText: true, confidence: 0.95, matchedQuestion: 'question-header' };
        }
      }
    }
  }
  
  // PRIORITY CHECK 2.6: Filter common question text patterns
  // Patterns like "Here are some graphs", "Write down", "On the grid", "Solve the", "Expand and simplify"
  const commonQuestionPatterns = [
    /^Here are/i,
    /^Write down/i,
    /^On the grid/i,
    /^Solve the/i,
    /^Expand and simplify/i,
    /^Triangle.*is translated/i,
    /^Triangle.*is rotated/i,
    /^Describe fully/i,
    /^The table gives/i,
    /^Work out an estimate/i
  ];
  
  for (const pattern of commonQuestionPatterns) {
    if (pattern.test(blockText)) {
      // Double-check: make sure it's not student work by checking classification
      // If it matches classification student work, don't filter
      const matchesStudentWork = classificationQuestions.some(q => {
        if (q.sourceImageIndex !== block.pageIndex) return false;
        if (q.studentWork && q.studentWork.includes(blockText.slice(0, 30))) return true;
        return false;
      });
      
      if (!matchesStudentWork) {
        return { isQuestionText: true, confidence: 0.85, matchedQuestion: 'question-pattern' };
      }
    }
  }
  
  // Block doesn't match any question text → keep it (don't filter)
  // Assignment stage will handle Y-position and assign blocks below boundary
  return { isQuestionText: false };
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
    const studentWorkBlocks = blocksOnPage.filter(block => {
      const blockText = (block.mathpixLatex || block.googleVisionText || '').trim();
      const blockTextFull = blockText;
      
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
        if (isQ5aBlock40) {
          console.warn(`[Q5a "40" TRACE] Block "${blockText}" (Y=${block.coordinates?.y ?? 'null'}) → FILTERED as question text (confidence=${result.confidence?.toFixed(3) ?? 'N/A'}, matched=${result.matchedQuestion ?? 'none'})`);
        }
        return false; // Filter out question text
      } else {
        if (isQ5aBlock40) {
          console.log(`[Q5a "40" TRACE] Block "${blockText}" (Y=${block.coordinates?.y ?? 'null'}) → KEPT as student work`);
        }
        return true; // Keep student work
      }
    });
    
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
      // STEP 6: Apply Y-position check and assign blocks to schemes (uses pre-filtered studentWorkBlocks, no additional filtering)
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
            // Check for block "F" - handle both plain "F" and LaTeX "\( F \)" or "$F$"
            const blockTextNormalized = blockText.replace(/^\\?\(?\s*\$?\s*F\s*\$?\s*\\?\)?$/, 'F').trim();
            const isQ12BlockF = blockTextNormalized === 'F' || blockText === 'F' || blockText.includes('F') && blockText.length <= 10;
            
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
              
              // Check: block Y > boundary.startY means block is below question text start
              // RELAXED: Use startY instead of endY to allow blocks slightly above endY
              // So block Y > boundaryStartY, which means block is below the boundary start (correct for student work)
              
              // Find which scheme this boundary belongs to
              const questionInfo = questionsOnPage.find(q => q.questionNumber === nearestBoundary.questionNumber);
              if (questionInfo && questionInfo.schemeKey === schemeKey) {
                // Block is below this scheme's question boundary start → assign to scheme
                blocksToAssign.push(block);
                assignedBlocksInPage.add(blockId);
              }
            }
          }
        } else {
          // No boundaries for this page → assign all student work blocks
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
    
    // Filter out already-assigned blocks only (no question text filtering - already done in Step 1)
    const unassignedBlocks = pageFilteredBlocksForPage.filter(block => {
      const blockId = (block as any).globalBlockId || `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
      if (assignedBlockIds.has(blockId)) return false; // Already assigned to another question
      return true; // Keep unassigned blocks (already filtered for question text)
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
  
  // Track question text blocks per scheme for statistics
  const schemeKeyToQuestionTextCount = new Map<string, number>();
  
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
    
    // Count question text blocks in the assigned blocks (for statistics)
    // CRITICAL: Use the SAME isQuestionTextBlock function that was used for filtering
    // This ensures statistics match the actual filtering behavior
    let questionTextCount = 0;
    
    // Get boundaries for this scheme's pages (needed for isQuestionTextBlock)
    const schemePages = [...new Set(blocks.map(b => b.pageIndex))];
    const schemeBoundaries = allBoundaries.filter(b => schemePages.includes(b.pageIndex));
    
    // Check each block using the EXACT SAME function used for filtering
    for (const block of blocks) {
      const result = isQuestionTextBlock(block, originalQuestionsForFiltering, 0.70, schemeBoundaries);
      if (result.isQuestionText) {
        questionTextCount++;
      }
    }
    schemeKeyToQuestionTextCount.set(schemeKey, questionTextCount);
    
    tasks.push({
      questionNumber: schemeKey,
      mathBlocks: blocks,
      markingScheme: markingScheme || null, // Allow null for non-past paper questions
      sourcePages,
      classificationStudentWork, // Pass classification-extracted student work (may include [DRAWING])
      pageDimensions // Pass page dimensions for accurate bbox estimation
    });
    
    const studentWorkInfo = classificationStudentWork ? ` (with student work: ${classificationStudentWork.substring(0, 50)}...)` : '';
    console.log(`[SEGMENTATION] Created task for ${schemeKey}: ${blocks.length} blocks from pages [${sourcePages.join(', ')}]${studentWorkInfo}`);
  }
  
  console.log(`[SEGMENTATION] ✅ Created ${tasks.length} marking task(s)`);
  
  // Print detailed summary table with column format
  console.log('\n[SEGMENTATION SUMMARY]');
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
    const baseQuestionNumberFromSchemeKey = schemeKey.split('_')[0].replace(/^Q?(\d+).*/, '$1');
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
    
    // Calculate statistics
    const questionTextCount = schemeKeyToQuestionTextCount.get(schemeKey) || 0;
    const totalBlocks = task.mathBlocks.length;
    const studentWorkBlocks = totalBlocks - questionTextCount;
    
    // Count classification student work blocks (lines)
    let classificationStudentWorkCount = 0;
    if (classificationQuestionsForScheme.length > 0) {
      classificationQuestionsForScheme.forEach(cq => {
        if (cq.mainStudentWork) {
          const mainLines = cq.mainStudentWork.split(/\n|\\n/).filter(l => l.trim().length > 0);
          classificationStudentWorkCount += mainLines.length;
        }
        if (cq.subQuestions.length > 0) {
          cq.subQuestions.forEach(sq => {
            if (sq.studentWork) {
              const subLines = sq.studentWork.split(/\n|\\n/).filter(l => l.trim().length > 0);
              classificationStudentWorkCount += subLines.length;
            }
          });
        }
      });
    }
    
    // Calculate percentage of relevant blocks (student work / total)
    const relevantPercentage = totalBlocks > 0 ? Math.round((studentWorkBlocks / totalBlocks) * 100) : 0;
    
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
    
    // Build stats string
    const statsString = `Stats: Class=${classificationStudentWorkCount}, Blocks=${totalBlocks} (QT=${questionTextCount}, SW=${studentWorkBlocks}), ${relevantPercentage}% relevant`;
    
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
                tableRows.push({ 
                  classification: `  ${dl}`, 
                  blocks: idx === 0 ? '' : '' 
                });
              });
            } else {
              tableRows.push({ classification: `  ${trimmed}`, blocks: '' });
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
                    tableRows.push({ 
                      classification: `  ${dl}`, 
                      blocks: idx === 0 ? '' : '' 
                    });
                  });
                } else {
                  tableRows.push({ classification: `  ${trimmed}`, blocks: '' });
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
    let blockRowIndex = 0;
    if (tableRows.length > 0) {
      tableRows[blockRowIndex].blocks = `Blocks (${task.mathBlocks.length}):`;
      blockRowIndex++;
    } else {
      tableRows.push({ classification: '', blocks: `Blocks (${task.mathBlocks.length}):` });
      blockRowIndex = 1;
    }
    
    task.mathBlocks.forEach((block, idx) => {
      const blockText = (block.mathpixLatex || block.googleVisionText || '').trim();
      const truncated = blockText.length > 80 ? blockText.substring(0, 80) + '...' : blockText;
      if (blockRowIndex < tableRows.length) {
        tableRows[blockRowIndex].blocks = `  ${idx + 1}. "${truncated}"`;
        blockRowIndex++;
      } else {
        tableRows.push({ classification: '', blocks: `  ${idx + 1}. "${truncated}"` });
        blockRowIndex++;
      }
    });
    
    // Add synthetic drawing blocks if any
    if (task.classificationStudentWork && task.classificationStudentWork.includes('[DRAWING]')) {
      const drawingEntries = task.classificationStudentWork.split(/\n|\\n/).filter(e => e.trim().includes('[DRAWING]'));
      drawingEntries.forEach((drawing, idx) => {
        // Format drawing (truncate to 20 words, wrap to fit column)
        const formatted = formatDrawingText(drawing.trim(), 45);
        const drawingLines = formatted.split('\n');
        drawingLines.forEach((dl, lineIdx) => {
          const prefix = lineIdx === 0 ? `  ${task.mathBlocks.length + idx + 1}. [SYNTHETIC] "` : '    ';
          const suffix = lineIdx === drawingLines.length - 1 ? '"' : '';
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
    
    // Print column-based table
    console.log(`Q${questionId}${schemeHeader} | ${statsString}`);
    console.log('─'.repeat(150));
    console.log('Classification Student Work'.padEnd(75) + ' | ' + 'Blocks to AI');
    console.log('─'.repeat(150));
    
    tableRows.forEach(row => {
      console.log(row.classification.padEnd(75) + ' | ' + row.blocks);
    });
    console.log('─'.repeat(150));
  }
  console.log('═'.repeat(150));
  console.log('');
  
  return tasks;
}

