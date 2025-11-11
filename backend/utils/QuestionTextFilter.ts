/**
 * Helper class for filtering question text, headers, footers, mark allocations, noise, and page numbers
 * from OCR blocks to ensure only student work is passed to AI marking.
 * 
 * Key design principles:
 * 1. Always check classification student work FIRST (PRIORITY -1) to prevent filtering valid student work
 * 2. For single characters/numbers, check ALL pages (not just same page) to handle cross-page questions
 * 3. Use flexible pattern matching to handle OCR variations
 * 4. Be aggressive in filtering but safe for student work
 */

import { MathBlock } from '../types/ocr';
import { normalizeTextForComparison, getBaseQuestionNumber } from './TextNormalizationUtils';
import { calculateOcrToDatabaseSimilarity } from './OcrTextMatchingUtils';

export interface QuestionForFiltering {
  questionNumber: string | null;
  text?: string | null;
  databaseText?: string | null;
  studentWork?: string | null;
  subQuestions?: Array<{
    part?: string;
    text?: string | null;
    databaseText?: string | null;
    studentWork?: string | null;
  }>;
  sourceImageIndex: number;
}

export interface QuestionBoundary {
  questionNumber: string;
  pageIndex: number;
  startY: number;
  endY: number | null; // Can be null if not found
  maxOrderIndex?: number;
}

export interface FilterResult {
  isQuestionText: boolean;
  confidence?: number;
  matchedQuestion?: string;
  reason?: string;
}

/**
 * Check if an OCR block matches classification-extracted student work
 * Used as a conservative whitelist to prevent filtering actual student work
 * 
 * @param exactMatchOnly If true, only matches exact normalized text (no substring matching, higher similarity threshold)
 */
function matchesClassificationStudentWork(
  block: MathBlock & { pageIndex: number },
  classificationStudentWork: string,
  exactMatchOnly: boolean = false
): boolean {
  if (!classificationStudentWork || !classificationStudentWork.trim()) {
    return false;
  }
  
  const blockText = block.mathpixLatex || block.googleVisionText || '';
  if (!blockText.trim()) return false;
  
  const blockTextTrimmed = blockText.trim();
  const isSingleLetter = blockTextTrimmed.length === 1 && /^[A-Z]$/i.test(blockTextTrimmed);
  const classificationTrimmed = classificationStudentWork.trim();
  const isSingleLetterInClassification = classificationTrimmed.length === 1 && /^[A-Z]$/i.test(classificationTrimmed);
  
  // For single letters, use exact case-insensitive matching (e.g., "H", "F", "J" for Q12)
  if (isSingleLetter && isSingleLetterInClassification) {
    return blockTextTrimmed.toLowerCase() === classificationTrimmed.toLowerCase();
  }
  
  // Normalize both texts for comparison
  const normalizedBlock = normalizeTextForComparison(blockText);
  const normalizedStudentWork = normalizeTextForComparison(classificationStudentWork);
  
  if (!normalizedBlock || !normalizedStudentWork) {
    return false;
  }
  
  // For single-letter blocks, also check if the normalized classification contains the letter
  // (e.g., classification might be "H\nF\nJ" but we're checking against "F")
  if (isSingleLetter) {
    const letterLower = blockTextTrimmed.toLowerCase();
    const classificationLines = classificationStudentWork.split(/\n|\\newline|\\\\/).map(l => l.trim()).filter(l => l.length > 0);
    if (classificationLines.some(line => line.toLowerCase() === letterLower)) {
      return true;
    }
  }
  
  // For exact match only mode, use strict matching
  if (exactMatchOnly) {
    // Exact match after normalization
    if (normalizedBlock === normalizedStudentWork) {
      return true;
    }
    // For single chars/short numbers, also check if it appears as a standalone word
    if (blockTextTrimmed.length <= 3 && /^[A-Za-z0-9]+$/.test(blockTextTrimmed)) {
      const normalizedBlockLower = normalizedBlock.toLowerCase();
      const normalizedStudentWorkLower = normalizedStudentWork.toLowerCase();
      // Check if block appears as a standalone word in student work
      const wordBoundaryRegex = new RegExp(`\\b${normalizedBlockLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (wordBoundaryRegex.test(normalizedStudentWorkLower)) {
        return true;
      }
    }
    return false;
  }
  
  // Use OCR-optimized similarity for better matching with OCR format variations
  const similarity = calculateOcrToDatabaseSimilarity(blockText, classificationStudentWork);
  const normalizedBlockForSubstring = normalizeTextForComparison(blockText);
  const normalizedStudentWorkForSubstring = normalizeTextForComparison(classificationStudentWork);
  
  // For conservative matching, avoid substring matching that causes false positives
  // Only use substring matching for longer blocks (>= 10 chars) to avoid matching "11" in "$11y=46-90$"
  const isSubstring = normalizedBlockForSubstring.length >= 10 && (
    normalizedStudentWorkForSubstring.includes(normalizedBlockForSubstring) || 
    normalizedStudentWorkForSubstring.includes(normalizedBlockForSubstring.slice(0, 30))
  );
  
  // Higher threshold for conservative matching
  return similarity >= 0.50 || isSubstring;
}

/**
 * Check if block matches classification student work across ALL pages
 * This is critical for single characters/numbers that might be valid answers
 * (e.g., "H", "F", "J" for Q12 might be on different pages than the question)
 * 
 * @param exactMatchOnly If true, only matches exact normalized text (no substring matching)
 */
function matchesClassificationStudentWorkAnyPage(
  block: MathBlock & { pageIndex: number },
  classificationQuestions: QuestionForFiltering[],
  exactMatchOnly: boolean = false
): boolean {
  const blockText = block.mathpixLatex || block.googleVisionText || '';
  if (!blockText.trim()) return false;
  
  // Check ALL questions across ALL pages (not just same page)
  // This is important for single characters/numbers that might be valid answers
  for (const q of classificationQuestions) {
    // Check main question student work
    if (q.studentWork) {
      const studentWorkLines = q.studentWork.split(/\n|\\newline|\\\\/).map(l => l.trim()).filter(l => l.length > 0);
      for (const line of studentWorkLines) {
        if (matchesClassificationStudentWork(block, line, exactMatchOnly)) {
          return true;
        }
      }
    }
    
    // Check sub-question student work
    if (q.subQuestions) {
      for (const subQ of q.subQuestions) {
        if (subQ.studentWork) {
          const subQLines = subQ.studentWork.split(/\n|\\newline|\\\\/).map(l => l.trim()).filter(l => l.length > 0);
          for (const line of subQLines) {
            if (matchesClassificationStudentWork(block, line, exactMatchOnly)) {
              return true;
            }
          }
        }
      }
    }
  }
  
  return false;
}

export class QuestionTextFilter {
  /**
   * Main filtering function - determines if a block should be filtered as question text
   * 
   * NEW DESIGN: Use stable database content (fullExamPaper) as primary filter,
   * classification student work as conservative whitelist
   * 
   * Priority order:
   * 0: Page footers/metadata
   * 0.2: Noise detection (single chars/numbers that don't match student work)
   * 0.3: Mark allocation labels
   * 0.4: Question number labels
   * 0.5: Short LaTeX expressions in question text
   * 0.6: Question header patterns (using database text)
   * 0.7: Common question text patterns (using database text)
   * 1: Quick question text matching (using database text - PRIMARY FILTER)
   * 2: Thorough question text matching (using database text - PRIMARY FILTER)
   * 2.5: Table data
   * -1: Classification student work whitelist (conservative, only for specific cases)
   */
  static filter(
    block: MathBlock & { pageIndex: number },
    classificationQuestions: QuestionForFiltering[],
    boundaries?: QuestionBoundary[],
    similarityThreshold: number = 0.70
  ): FilterResult {
    const blockText = block.mathpixLatex || block.googleVisionText || '';
    if (!blockText.trim()) {
      return { isQuestionText: false };
    }
    
    const trimmedBlockText = blockText.trim();
    
    // PRIORITY CHECK 0: Filter page footers/metadata
    if (this.isPageFooterOrMetadata(block)) {
      return { isQuestionText: true, confidence: 1.0, matchedQuestion: 'metadata', reason: 'page-footer-metadata' };
    }
    
    // PRIORITY CHECK 0.2: Filter noise blocks
    const noiseResult = this.checkNoise(block, classificationQuestions);
    if (noiseResult.isQuestionText) {
      return noiseResult;
    }
    
    // PRIORITY CHECK 0.3: Filter mark allocation labels
    const markAllocationResult = this.checkMarkAllocation(trimmedBlockText);
    if (markAllocationResult.isQuestionText) {
      return markAllocationResult;
    }
    
    // PRIORITY CHECK 0.4: Filter question number labels
    const questionNumberResult = this.checkQuestionNumber(block, trimmedBlockText, classificationQuestions);
    if (questionNumberResult.isQuestionText) {
      return questionNumberResult;
    }
    
    // PRIORITY CHECK 0.5: Filter short LaTeX expressions
    const latexResult = this.checkShortLatexExpression(block, blockText, classificationQuestions);
    if (latexResult.isQuestionText) {
      return latexResult;
    }
    
    // PRIORITY CHECK 0.6: Filter question header patterns (using database text)
    const headerResult = this.checkQuestionHeader(block, blockText, classificationQuestions);
    if (headerResult.isQuestionText) {
      // CRITICAL: Question headers should ALWAYS be filtered, even if they match classification
      // Question headers like "14 Expand and simplify..." are question text, not student work
      // The whitelist check is only to prevent filtering valid student work that happens to start with a number
      // But if it matches a question header pattern, it's definitely question text
      return headerResult;
    }
    
    // PRIORITY CHECK 0.7: Filter common question text patterns (using database text)
    const patternResult = this.checkCommonQuestionPatterns(block, blockText, classificationQuestions);
    if (patternResult.isQuestionText) {
      // Before filtering, check if it matches classification student work (whitelist)
      // Use STRICT threshold (0.70) for pattern matches - question text patterns are very reliable
      if (!this.matchesClassificationStudentWorkConservative(block, classificationQuestions, 0.70)) {
        return patternResult;
      }
    }
    
    // PRIORITY CHECK 1: Quick question text matching (using database text - PRIMARY FILTER)
    const quickMatchResult = this.checkQuickQuestionTextMatch(block, blockText, classificationQuestions);
    if (quickMatchResult.isQuestionText) {
      // PRIORITIZE DATABASE MATCH: If database match confidence is high (>= 0.50), require stronger classification match
      const databaseConfidence = quickMatchResult.confidence || 0.80; // Default to 0.80 if not provided
      const requiresStrongClassificationMatch = databaseConfidence >= 0.50;
      
      // Before filtering, check if it matches classification student work (whitelist)
      // Use stricter threshold if database match is strong
      const classificationThreshold = requiresStrongClassificationMatch ? 0.70 : 0.60;
      const matchesClassification = this.matchesClassificationStudentWorkConservative(block, classificationQuestions, classificationThreshold);
      
      if (!matchesClassification) {
        return quickMatchResult; // No classification match → filter as question text
      }
      
      // If it matches BOTH database question text AND classification, use order index to break tie
      // If block appears before/with question text (order <= maxOrderIndex), prioritize database match (filter it)
      // If block appears after question text (order > maxOrderIndex), prioritize classification match (keep it)
      if (matchesClassification && boundaries) {
        const blockOrder = (block as any).originalOrderIndex;
        if (blockOrder != null) {
          // Find the maxOrderIndex for this question from boundaries
          // CRITICAL: Normalize question numbers (e.g., "12(i)" → "12") to match boundary questionNumber
          const matchedQuestion = quickMatchResult.matchedQuestion;
          if (matchedQuestion) {
            const baseMatchedQuestion = getBaseQuestionNumber(matchedQuestion);
            // Try exact match first, then try base question number match
            let questionBoundary = boundaries.find(b => 
              b.questionNumber === matchedQuestion && b.pageIndex === block.pageIndex
            );
            if (!questionBoundary && baseMatchedQuestion) {
              questionBoundary = boundaries.find(b => 
                getBaseQuestionNumber(b.questionNumber) === baseMatchedQuestion && b.pageIndex === block.pageIndex
              );
            }
            if (questionBoundary?.maxOrderIndex != null) {
              // If block order <= maxOrderIndex, it appears with question text → filter it
              if (blockOrder <= questionBoundary.maxOrderIndex) {
                return quickMatchResult; // Filter as question text
              }
              // If block order > maxOrderIndex, it appears after question text
              // BUT: If database match is very strong (>= 0.70), still filter it (question text can continue later)
              // Only keep it if classification match is also very strong (>= 0.70)
              if (databaseConfidence >= 0.70) {
                // Database match is very strong → filter it even if order > maxOrderIndex
                return quickMatchResult;
              }
              // Database match is moderate (0.50-0.70) and order > maxOrderIndex → keep it as student work
              // (Don't filter, let it pass through)
            }
          }
        }
      }
      
      // CONSERVATIVE FALLBACK: If we're not sure, keep the block (don't filter student work)
      // Rule: Only filter when we're very confident it's question text
      if (requiresStrongClassificationMatch) {
        // Database match is strong (>= 0.50)
        // Check if classification matches at all (even weakly)
        if (matchesClassification) {
          // Classification matches (even if weak) → keep it (uncertain, be conservative)
          // Don't filter, let it pass through
        } else {
          // Classification doesn't match at all → only filter if database match is VERY strong (>= 0.70)
          // This ensures we only filter when we're very confident
          if (databaseConfidence >= 0.70) {
            // Database match is very strong AND classification doesn't match → filter it
            return quickMatchResult;
          }
          // Database match is moderate (0.50-0.70) and classification doesn't match → keep it (uncertain, be conservative)
          // Don't filter, let it pass through
        }
      } else {
        // Database match is weak (< 0.50) but classification matches → keep it (might be valid student work)
        // Don't filter, let it pass through
      }
    }
    
    // PRIORITY CHECK 2: Thorough question text matching (using database text - PRIMARY FILTER)
    const thoroughMatchResult = this.checkThoroughQuestionTextMatch(block, blockText, classificationQuestions);
    if (thoroughMatchResult.isQuestionText) {
      // PRIORITIZE DATABASE MATCH: If database match confidence is high (>= 0.50), require stronger classification match
      const databaseConfidence = thoroughMatchResult.confidence || 0.80; // Default to 0.80 if not provided
      const requiresStrongClassificationMatch = databaseConfidence >= 0.50;
      
      // Before filtering, check if it matches classification student work (whitelist)
      // Use stricter threshold if database match is strong
      const classificationThreshold = requiresStrongClassificationMatch ? 0.70 : 0.60;
      const matchesClassification = this.matchesClassificationStudentWorkConservative(block, classificationQuestions, classificationThreshold);
      
      if (!matchesClassification) {
        return thoroughMatchResult; // No classification match → filter as question text
      }
      
      // If it matches BOTH database question text AND classification, use order index to break tie
      if (matchesClassification && boundaries) {
        const blockOrder = (block as any).originalOrderIndex;
        if (blockOrder != null) {
          // CRITICAL: Normalize question numbers (e.g., "12(i)" → "12") to match boundary questionNumber
          const matchedQuestion = thoroughMatchResult.matchedQuestion;
          if (matchedQuestion) {
            const baseMatchedQuestion = getBaseQuestionNumber(matchedQuestion);
            // Try exact match first, then try base question number match
            let questionBoundary = boundaries.find(b => 
              b.questionNumber === matchedQuestion && b.pageIndex === block.pageIndex
            );
            if (!questionBoundary && baseMatchedQuestion) {
              questionBoundary = boundaries.find(b => 
                getBaseQuestionNumber(b.questionNumber) === baseMatchedQuestion && b.pageIndex === block.pageIndex
              );
            }
            if (questionBoundary?.maxOrderIndex != null) {
              // If block order <= maxOrderIndex, it appears with question text → filter it
              if (blockOrder <= questionBoundary.maxOrderIndex) {
                return thoroughMatchResult; // Filter as question text
              }
              // If block order > maxOrderIndex, it appears after question text
              // BUT: If database match is very strong (>= 0.70), still filter it (question text can continue later)
              // Only keep it if classification match is also very strong (>= 0.70)
              if (databaseConfidence >= 0.70) {
                // Database match is very strong → filter it even if order > maxOrderIndex
                return thoroughMatchResult;
              }
              // Database match is moderate (0.50-0.70) and order > maxOrderIndex → keep it as student work
            }
          }
        }
      }
      
      // CONSERVATIVE FALLBACK: If we're not sure, keep the block (don't filter student work)
      // Rule: Only filter when we're very confident it's question text
      if (requiresStrongClassificationMatch) {
        // Database match is strong (>= 0.50)
        // Check if classification matches at all (even weakly)
        if (matchesClassification) {
          // Classification matches (even if weak) → keep it (uncertain, be conservative)
          // Don't filter, let it pass through
        } else {
          // Classification doesn't match at all → only filter if database match is VERY strong (>= 0.70)
          // This ensures we only filter when we're very confident
          if (databaseConfidence >= 0.70) {
            // Database match is very strong AND classification doesn't match → filter it
            return thoroughMatchResult;
          }
          // Database match is moderate (0.50-0.70) and classification doesn't match → keep it (uncertain, be conservative)
          // Don't filter, let it pass through
        }
      } else {
        // Database match is weak (< 0.50) but classification matches → keep it (might be valid student work)
        // Don't filter, let it pass through
      }
    }
    
    // PRIORITY CHECK 2.5: Filter table data
    const tableResult = this.checkTableData(blockText);
    if (tableResult.isQuestionText) {
      return tableResult;
    }
    
    // Block doesn't match any question text → keep it
    return { isQuestionText: false };
  }
  
  /**
   * Conservative whitelist check: Only matches classification student work for specific cases
   * - Single characters/numbers (exact match only)
   * - Very specific patterns that are clearly student work
   * - Avoids substring matching that causes false positives
   * 
   * @param threshold Minimum similarity threshold (default: 0.60, stricter: 0.70)
   */
  private static matchesClassificationStudentWorkConservative(
    block: MathBlock & { pageIndex: number },
    classificationQuestions: QuestionForFiltering[],
    threshold: number = 0.60
  ): boolean {
    const blockText = block.mathpixLatex || block.googleVisionText || '';
    const trimmedBlockText = blockText.trim();
    
    // For single chars/short numbers (1-3 chars), check ALL pages (cross-page matching)
    // This is critical for Q12 where "H", "F", "J" are valid answers
    const isSingleCharOrShortNumber = trimmedBlockText.length <= 3 && /^[A-Za-z0-9]+$/.test(trimmedBlockText);
    
    if (isSingleCharOrShortNumber) {
      // For single chars/short numbers, use exact match only (no substring matching)
      return matchesClassificationStudentWorkAnyPage(block, classificationQuestions, true); // exact match only
    }
    
    // For longer blocks, check same page only with conservative matching
    // Use lower similarity threshold (>= 0.40) to catch OCR variations, but require longer blocks (>= 5 chars)
    // to avoid false positives with short blocks like "11" matching "$11y=46-90$"
    return classificationQuestions.some(q => {
      if (q.sourceImageIndex !== block.pageIndex) return false;
      
      if (q.studentWork) {
        const studentWorkLines = q.studentWork.split(/\n|\\newline|\\\\/).map(l => l.trim()).filter(l => l.length > 0);
        for (const line of studentWorkLines) {
          // For longer blocks (>= 5 chars), use lower similarity threshold to catch OCR variations
          // For shorter blocks, require higher similarity to avoid false positives
          const similarity = calculateOcrToDatabaseSimilarity(blockText, line);
          const minSimilarity = trimmedBlockText.length >= 5 ? 0.40 : 0.60;
          
          if (similarity >= minSimilarity) {
            return true;
          }
          
          // For exact match (after normalization), always allow it
          const normalizedBlock = normalizeTextForComparison(blockText);
          const normalizedStudentWork = normalizeTextForComparison(line);
          if (normalizedBlock === normalizedStudentWork) {
            return true;
          }
          
          // For longer blocks (>= 10 chars), also check substring matching (but more conservative)
          // This catches cases where OCR has artifacts but the core content matches
          if (trimmedBlockText.length >= 10 && normalizedBlock.length >= 10) {
            const normalizedBlockForSubstring = normalizedBlock.slice(0, Math.min(50, normalizedBlock.length));
            const normalizedStudentWorkForSubstring = normalizedStudentWork.slice(0, Math.min(50, normalizedStudentWork.length));
            if (normalizedStudentWorkForSubstring.includes(normalizedBlockForSubstring) ||
                normalizedBlockForSubstring.includes(normalizedStudentWorkForSubstring)) {
              return true;
            }
          }
        }
      }
      
      if (q.subQuestions) {
        return q.subQuestions.some(subQ => {
          if (subQ.studentWork) {
            const subQLines = subQ.studentWork.split(/\n|\\newline|\\\\/).map(l => l.trim()).filter(l => l.length > 0);
            for (const line of subQLines) {
              const similarity = calculateOcrToDatabaseSimilarity(blockText, line);
              const minSimilarity = trimmedBlockText.length >= 5 ? threshold : Math.max(threshold, 0.60);
              
              if (similarity >= minSimilarity) {
                return true;
              }
              
              const normalizedBlock = normalizeTextForComparison(blockText);
              const normalizedStudentWork = normalizeTextForComparison(line);
              if (normalizedBlock === normalizedStudentWork) {
                return true;
              }
              
              if (trimmedBlockText.length >= 10 && normalizedBlock.length >= 10) {
                const normalizedBlockForSubstring = normalizedBlock.slice(0, Math.min(50, normalizedBlock.length));
                const normalizedStudentWorkForSubstring = normalizedStudentWork.slice(0, Math.min(50, normalizedStudentWork.length));
                if (normalizedStudentWorkForSubstring.includes(normalizedBlockForSubstring) ||
                    normalizedBlockForSubstring.includes(normalizedStudentWorkForSubstring)) {
                  return true;
                }
              }
            }
          }
          return false;
        });
      }
      return false;
    });
  }
  
  /**
   * Check if block is page footer or metadata
   */
  private static isPageFooterOrMetadata(block: MathBlock & { pageIndex: number }): boolean {
    const blockText = (block.mathpixLatex || block.googleVisionText || '').trim().toLowerCase();
    
    // Common footer patterns
    const footerPatterns = [
      /^page\s+\d+/i,
      /^\d+\s*$/,
      /^turn\s+over/i,
      /^continued/i,
      /^total\s+for\s+question/i
    ];
    
    return footerPatterns.some(pattern => pattern.test(blockText));
  }
  
  /**
   * Check if block is noise (single chars/numbers that don't match student work)
   * CRITICAL: For single chars/numbers, check ALL pages to avoid filtering valid answers
   */
  private static checkNoise(
    block: MathBlock & { pageIndex: number },
    classificationQuestions: QuestionForFiltering[]
  ): FilterResult {
    const blockText = block.mathpixLatex || block.googleVisionText || '';
    const trimmedBlockText = blockText.trim();
    
    // Single character (except if it's a valid answer like "H", "F", "J" for Q12)
    if (trimmedBlockText.length === 1) {
      // Check ALL pages (not just same page) for classification student work
      if (!matchesClassificationStudentWorkAnyPage(block, classificationQuestions)) {
        return { isQuestionText: true, confidence: 0.90, matchedQuestion: 'noise', reason: 'single-character-noise' };
      }
    }
    
    // Very short blocks (2-3 chars) that are just numbers
    if (trimmedBlockText.length <= 3 && /^\d+$/.test(trimmedBlockText)) {
      // Check ALL pages for classification student work
      if (!matchesClassificationStudentWorkAnyPage(block, classificationQuestions)) {
        // Also check if it matches any question number (across all pages)
        const matchesAnyQuestionNumber = classificationQuestions.some(q => {
          const qNumStr = String(q.questionNumber || '').replace(/[^0-9]/g, '');
          return qNumStr === trimmedBlockText;
        });
        
        if (!matchesAnyQuestionNumber) {
          return { isQuestionText: true, confidence: 0.90, matchedQuestion: 'noise', reason: 'short-number-noise' };
        }
      }
    }
    
    // Random characters like "a ?", "a", "へ", "a ?" (with spaces/punctuation)
    // Check for blocks that are mostly non-alphanumeric or have weird characters
    if (trimmedBlockText.length <= 3) {
      // Count alphanumeric characters
      const alphanumericCount = (trimmedBlockText.match(/[A-Za-z0-9]/g) || []).length;
      // If less than half are alphanumeric, or if it's a single non-alphanumeric char, it's likely noise
      if (alphanumericCount === 0 || (trimmedBlockText.length > 1 && alphanumericCount < trimmedBlockText.length / 2)) {
        if (!matchesClassificationStudentWorkAnyPage(block, classificationQuestions)) {
          return { isQuestionText: true, confidence: 0.90, matchedQuestion: 'noise', reason: 'random-character-noise' };
        }
      }
    }
    
    // Footer patterns: blocks with pipe characters, dashes, and minimal alphanumeric content
    // Pattern: "m | - n - n -" or similar footer noise
    if (trimmedBlockText.length >= 5 && trimmedBlockText.length <= 20) {
      const pipeCount = (trimmedBlockText.match(/\|/g) || []).length;
      const dashCount = (trimmedBlockText.match(/-/g) || []).length;
      const alphanumericCount = (trimmedBlockText.match(/[A-Za-z0-9]/g) || []).length;
      // If block has pipes/dashes but very few alphanumeric chars, it's likely footer noise
      if ((pipeCount >= 1 || dashCount >= 2) && alphanumericCount <= 2) {
        const matchesClassification = matchesClassificationStudentWorkAnyPage(block, classificationQuestions);
        // DEBUG: Log footer detection for Q14
        if (block.pageIndex === 4) {
          console.log(`[Q14 DEBUG] Footer check: "${trimmedBlockText}" → pipeCount=${pipeCount}, dashCount=${dashCount}, alphanumericCount=${alphanumericCount}, matchesClassification=${matchesClassification}`);
        }
        if (!matchesClassification) {
          return { isQuestionText: true, confidence: 0.95, matchedQuestion: 'noise', reason: 'footer-noise' };
        }
      }
    }
    
    return { isQuestionText: false };
  }
  
  /**
   * Check if block is a mark allocation label like "(1)", "(2)", "(3)"
   */
  private static checkMarkAllocation(trimmedBlockText: string): FilterResult {
    // More flexible pattern: handles "(1)", "1)", "(1", "1", etc.
    const markAllocationPattern = /^\(?\s*\d+\s*\)?\s*$/;
    if (markAllocationPattern.test(trimmedBlockText)) {
      return { isQuestionText: true, confidence: 0.95, matchedQuestion: 'mark-allocation', reason: 'mark-allocation-label' };
    }
    return { isQuestionText: false };
  }
  
  /**
   * Check if block is a question number label (e.g., "10", "11", "12")
   * Check ALL pages, not just same page
   * CRITICAL: This must filter standalone question numbers to prevent them from being passed to AI
   */
  private static checkQuestionNumber(
    block: MathBlock & { pageIndex: number },
    trimmedBlockText: string,
    classificationQuestions: QuestionForFiltering[]
  ): FilterResult {
    const questionNumberPattern = /^(\d+)\s*$/;
    const questionNumberMatch = trimmedBlockText.match(questionNumberPattern);
    
    if (questionNumberMatch) {
      const qNum = questionNumberMatch[1];
      // Check ALL pages (not just same page) for question number match
      const matchesQuestionNumber = classificationQuestions.some(q => {
        if (!q.questionNumber) return false;
        const qNumStr = String(q.questionNumber).replace(/[^0-9]/g, '');
        return qNumStr === qNum;
      });
      
      if (matchesQuestionNumber) {
        // CRITICAL: Also check if this block matches classification student work
        // If it does, don't filter it (e.g., "11" might be part of "11y = 46")
        // But if it's just "11" by itself and matches a question number, filter it
        const matchesStudentWork = matchesClassificationStudentWorkAnyPage(block, classificationQuestions);
        if (!matchesStudentWork) {
          return { isQuestionText: true, confidence: 0.90, matchedQuestion: 'question-number', reason: 'question-number-label' };
        }
      }
    }
    
    return { isQuestionText: false };
  }
  
  /**
   * Check if block is a short LaTeX expression that appears in question text
   */
  private static checkShortLatexExpression(
    block: MathBlock & { pageIndex: number },
    blockText: string,
    classificationQuestions: QuestionForFiltering[]
  ): FilterResult {
    const isShortLatexExpression = /^\$[^$]+\$$/.test(blockText.trim()) && blockText.trim().length <= 20;
    
    if (isShortLatexExpression) {
      for (const question of classificationQuestions) {
        if (question.sourceImageIndex !== block.pageIndex) continue;
        
        const questionTextToUse = question.databaseText || question.text;
        if (questionTextToUse && questionTextToUse.includes(blockText.trim())) {
          return { isQuestionText: true, confidence: 0.85, matchedQuestion: question.questionNumber || undefined, reason: 'short-latex-in-question' };
        }
        
        if (question.subQuestions) {
          for (const subQ of question.subQuestions) {
            const subQTextToUse = subQ.databaseText || subQ.text;
            if (subQTextToUse && subQTextToUse.includes(blockText.trim())) {
              const matchedQuestion = subQ.part ? `${question.questionNumber}${subQ.part}` : question.questionNumber || undefined;
              return { isQuestionText: true, confidence: 0.85, matchedQuestion, reason: 'short-latex-in-subquestion' };
            }
          }
        }
      }
    }
    
    return { isQuestionText: false };
  }
  
  /**
   * Quick question text matching using OCR-optimized similarity
   */
  private static checkQuickQuestionTextMatch(
    block: MathBlock & { pageIndex: number },
    blockText: string,
    classificationQuestions: QuestionForFiltering[]
  ): FilterResult {
    const normalizedBlockText = normalizeTextForComparison(blockText);
    
    for (const question of classificationQuestions) {
      if (question.sourceImageIndex !== block.pageIndex) continue;
      
      // Check sub-question texts first (more specific)
      if (question.subQuestions) {
        for (const subQ of question.subQuestions) {
          const subQTextToUse = subQ.databaseText || subQ.text;
          if (subQTextToUse) {
            const similarity = calculateOcrToDatabaseSimilarity(blockText, subQTextToUse);
            const normalizedSubQText = normalizeTextForComparison(subQTextToUse);
            
            if (normalizedSubQText) {
              const blockWithoutLabel = normalizedBlockText.replace(/^\(?[a-zivx]+\)?\s*/i, '').trim();
              const isSubstring = normalizedSubQText.includes(normalizedBlockText) || 
                                 (normalizedBlockText.length > 10 && normalizedSubQText.includes(normalizedBlockText.slice(0, 30))) ||
                                 (blockWithoutLabel.length > 5 && normalizedSubQText.includes(blockWithoutLabel));
              
              // Lower threshold (0.30) for sub-question text matching
              if (similarity >= 0.30 || isSubstring) {
                const matchedQuestion = subQ.part ? `${question.questionNumber}${subQ.part}` : question.questionNumber || undefined;
                return { isQuestionText: true, confidence: 0.80, matchedQuestion, reason: 'quick-subquestion-match' };
              }
            }
          }
        }
      }
      
      // Check main question text
      const questionTextToUse = question.databaseText || question.text;
      if (questionTextToUse) {
        const similarity = calculateOcrToDatabaseSimilarity(blockText, questionTextToUse);
        const normalizedQuestionText = normalizeTextForComparison(questionTextToUse);
        
        if (normalizedQuestionText) {
          const blockStartsWithQuestion = normalizedBlockText.length > 5 && normalizedQuestionText.startsWith(normalizedBlockText.slice(0, Math.min(50, normalizedBlockText.length)));
          const questionStartsWithBlock = normalizedBlockText.length > 5 && normalizedBlockText.startsWith(normalizedQuestionText.slice(0, Math.min(50, normalizedQuestionText.length)));
          const isSubstring = normalizedQuestionText.includes(normalizedBlockText) || 
                             (normalizedBlockText.length > 10 && normalizedQuestionText.includes(normalizedBlockText.slice(0, 30))) ||
                             blockStartsWithQuestion || questionStartsWithBlock;
          
          // Lower threshold (0.30) for main question text matching
          if (similarity >= 0.30 || isSubstring) {
            return { isQuestionText: true, confidence: 0.80, matchedQuestion: question.questionNumber || undefined, reason: 'quick-question-match' };
          }
        }
      }
    }
    
    return { isQuestionText: false };
  }
  
  /**
   * Thorough question text matching (more comprehensive)
   */
  private static checkThoroughQuestionTextMatch(
    block: MathBlock & { pageIndex: number },
    blockText: string,
    classificationQuestions: QuestionForFiltering[]
  ): FilterResult {
    const normalizedBlockText = normalizeTextForComparison(blockText);
    
    for (const question of classificationQuestions) {
      if (question.sourceImageIndex !== block.pageIndex) continue;
      
      const questionTextToUse = question.databaseText || question.text;
      if (questionTextToUse) {
        const similarity = calculateOcrToDatabaseSimilarity(blockText, questionTextToUse);
        const normalizedQuestionText = normalizeTextForComparison(questionTextToUse);
        
        if (normalizedQuestionText) {
          const blockStartsWithQuestion = normalizedBlockText.length > 5 && normalizedQuestionText.startsWith(normalizedBlockText.slice(0, Math.min(50, normalizedBlockText.length)));
          const questionStartsWithBlock = normalizedBlockText.length > 5 && normalizedBlockText.startsWith(normalizedQuestionText.slice(0, Math.min(50, normalizedQuestionText.length)));
          const isSubstring = normalizedQuestionText.includes(normalizedBlockText) || 
                             (normalizedBlockText.length > 10 && normalizedQuestionText.includes(normalizedBlockText.slice(0, 30))) ||
                             blockStartsWithQuestion || questionStartsWithBlock;
          
          // Lower threshold (0.30-0.35) to catch OCR artifacts and format differences
          // More aggressive matching for question text filtering
          if (similarity >= 0.30 || isSubstring) {
            return { isQuestionText: true, confidence: similarity, matchedQuestion: question.questionNumber || undefined, reason: 'thorough-question-match' };
          }
        }
      }
      
      if (question.subQuestions) {
        for (const subQ of question.subQuestions) {
          const subQTextToUse = subQ.databaseText || subQ.text;
          if (!subQTextToUse) continue;
          
          const similarity = calculateOcrToDatabaseSimilarity(blockText, subQTextToUse);
          const normalizedSubQText = normalizeTextForComparison(subQTextToUse);
          const normalizedBlockTextForSubQ = normalizeTextForComparison(blockText);
          
          const blockStartsWithSubQ = normalizedBlockTextForSubQ.length > 5 && normalizedSubQText.startsWith(normalizedBlockTextForSubQ.slice(0, Math.min(50, normalizedBlockTextForSubQ.length)));
          const subQStartsWithBlock = normalizedBlockTextForSubQ.length > 5 && normalizedBlockTextForSubQ.startsWith(normalizedSubQText.slice(0, Math.min(50, normalizedSubQText.length)));
          const isSubstring = normalizedSubQText.includes(normalizedBlockTextForSubQ) || 
                             (normalizedBlockTextForSubQ.length > 10 && normalizedSubQText.includes(normalizedBlockTextForSubQ.slice(0, 30))) ||
                             blockStartsWithSubQ || subQStartsWithBlock;
          
          const blockWithoutLabel = normalizedBlockTextForSubQ.replace(/^\(?[a-zivx]+\)?\s*/i, '').trim();
          const blockWithoutLabelIsSubstring = blockWithoutLabel.length > 5 && normalizedSubQText.includes(blockWithoutLabel);
          
          // Lower threshold (0.30) for sub-question text matching
          if (similarity >= 0.30 || isSubstring || blockWithoutLabelIsSubstring) {
            const matchedQuestion = subQ.part ? `${question.questionNumber}${subQ.part}` : question.questionNumber || undefined;
            return { isQuestionText: true, confidence: similarity, matchedQuestion, reason: 'thorough-subquestion-match' };
          }
        }
      }
    }
    
    return { isQuestionText: false };
  }
  
  /**
   * Check if block is table data
   */
  private static checkTableData(blockText: string): FilterResult {
    if (blockText.includes('\\begin{tabular}') || blockText.includes('\\hline') || blockText.includes('tabular') || 
        blockText.includes('\\end{tabular}') || (blockText.includes('Time') && blockText.includes('Frequency'))) {
      return { isQuestionText: true, confidence: 0.90, matchedQuestion: 'table-data', reason: 'table-data' };
    }
    return { isQuestionText: false };
  }
  
  /**
   * Check if block matches question header pattern (e.g., "10 Solve the simultaneous equations")
   * Removed strict page matching requirement - check ALL pages
   */
  private static checkQuestionHeader(
    block: MathBlock & { pageIndex: number },
    blockText: string,
    classificationQuestions: QuestionForFiltering[]
  ): FilterResult {
    // More flexible pattern: number followed by space and any text (not just capital letter)
    const questionHeaderPattern = /^(\d+)\s+/;
    
    if (questionHeaderPattern.test(blockText)) {
      const qNumMatch = blockText.match(/^(\d+)/);
      if (qNumMatch) {
        const qNum = qNumMatch[1];
        // Check ALL pages (not just same page) for question number match
        const matchesQuestionNumber = classificationQuestions.some(q => {
          const qNumStr = String(q.questionNumber || '').replace(/[^0-9]/g, '');
          return qNumStr === qNum;
        });
        
        if (matchesQuestionNumber) {
          // Check if the rest of the text matches question text patterns
          const restOfText = blockText.substring(qNumMatch[0].length).trim();
          
          // If rest of text is empty or very short, it's likely just a question number label
          if (restOfText.length === 0 || restOfText.length <= 2) {
            return { isQuestionText: true, confidence: 0.95, matchedQuestion: 'question-header', reason: 'question-header-number-only' };
          }
          
          const commonQuestionPatterns = [
            /^Solve the/i,
            /^Here are/i,
            /^Expand and simplify/i,
            /^Triangle/i,
            /^The table gives/i,
            /^Write down/i,
            /^On the grid/i,
            /^Describe fully/i,
            /^Work out/i
          ];
          
          const matchesQuestionPattern = commonQuestionPatterns.some(pattern => pattern.test(restOfText));
          if (matchesQuestionPattern) {
            return { isQuestionText: true, confidence: 0.95, matchedQuestion: 'question-header', reason: 'question-header-pattern' };
          }
          
          // Also check if it matches question text from database/classification (more flexible)
          // This catches cases where the pattern doesn't match but it's clearly question text
          const matchesQuestionText = classificationQuestions.some(q => {
            const questionTextToUse = q.databaseText || q.text;
            if (!questionTextToUse) return false;
            
            // Check if rest of text is similar to question text (first 50 chars)
            // Lower threshold (0.30) to catch OCR artifacts
            const normalizedRest = normalizeTextForComparison(restOfText);
            const normalizedQuestion = normalizeTextForComparison(questionTextToUse);
            if (normalizedQuestion && normalizedRest) {
              const similarity = calculateOcrToDatabaseSimilarity(restOfText, questionTextToUse);
              const isSubstring = normalizedQuestion.includes(normalizedRest) || 
                                 (normalizedRest.length > 10 && normalizedQuestion.includes(normalizedRest.slice(0, 30)));
              return similarity >= 0.30 || isSubstring;
            }
            return false;
          });
          
          if (matchesQuestionText) {
            return { isQuestionText: true, confidence: 0.90, matchedQuestion: 'question-header', reason: 'question-header-text-match' };
          }
        }
      }
    }
    
    return { isQuestionText: false };
  }
  
  /**
   * Check if block matches common question text patterns
   * Use more precise matching instead of includes()
   */
  private static checkCommonQuestionPatterns(
    block: MathBlock & { pageIndex: number },
    blockText: string,
    classificationQuestions: QuestionForFiltering[]
  ): FilterResult {
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
        // More precise check: use similarity matching instead of includes()
        // Check if it matches classification student work using similarity
        // Use STRICT threshold (0.70) - question text patterns are very reliable indicators
        const matchesStudentWork = classificationQuestions.some(q => {
          if (q.sourceImageIndex !== block.pageIndex) return false;
          if (q.studentWork) {
            // Use similarity instead of includes() for more precise matching
            const similarity = calculateOcrToDatabaseSimilarity(blockText, q.studentWork);
            return similarity >= 0.70; // STRICT threshold for pattern matching
          }
          return false;
        });
        
        if (!matchesStudentWork) {
          return { isQuestionText: true, confidence: 0.85, matchedQuestion: 'question-pattern', reason: 'common-question-pattern' };
        }
      }
    }
    
    return { isQuestionText: false };
  }
}

