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

import { MathBlock } from '../services/ocr/MathDetectionService';
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

export interface ClassificationMatch {
  classificationLine: string;
  similarity: number;
  questionNumber?: string;
  subQuestionPart?: string;
}

export interface FilterResult {
  isQuestionText: boolean;
  confidence?: number;
  matchedQuestion?: string;
  reason?: string;
  matchedClassificationLines?: ClassificationMatch[]; // Classification lines that matched this block (with similarity scores)
}

/**
 * Extract sub-question label from ORIGINAL text (before normalization)
 * This handles patterns like "(ii)", "ii)", "(ii", "ii", "(II)", etc.
 * Returns: { label: "ii", remainingText: "y=-x^3" }
 */
function extractSubQuestionLabel(originalText: string): { label: string | null; remainingText: string } {
  // Match patterns: (i), (ii), (iii), (a), (b), etc. with optional parentheses
  // Also handle: i), ii), (i, (ii, etc.
  const labelPattern = /^\(?([a-zivx]+)\)?\s*/i;
  const match = originalText.trim().match(labelPattern);
  
  if (match && match[1]) {
    const label = match[1].toLowerCase();
    const remainingText = originalText.substring(match[0].length).trim();
    return { label, remainingText };
  }
  
  return { label: null, remainingText: originalText };
}

/**
 * Word-level matching for article variations
 * Checks if key words appear in both texts, ignoring articles (a, an, the)
 * Example: "were in a shop" matches "were in the shop" because both contain "were", "in", "shop"
 */
function matchesWordsIgnoringArticles(text1: string, text2: string, minWords: number = 2): boolean {
  // Extract words (excluding articles)
  const getWords = (text: string): string[] => {
    return text
      .toLowerCase()
      .replace(/\b(a|an|the)\b/g, '') // Remove articles
      .split(/\s+/)
      .filter(word => word.length > 0);
  };
  
  const words1 = getWords(text1);
  const words2 = getWords(text2);
  
  // Count matching words
  const matchingWords = words1.filter(word => words2.includes(word));
  
  // Require at least minWords to match (default 2)
  return matchingWords.length >= minWords;
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
   * Priority order (GENERIC DESIGN - works for all exam papers):
   * 0: Page footers/metadata (ALWAYS filter - run first)
   * 0.05: Hardcoded footer patterns (ALWAYS filter - exact match, only for known footer patterns)
   * 0.1: Footer patterns (ALWAYS filter - run early, heuristic fallback)
   * 0.2: Noise detection (single chars/numbers that don't match student work)
   * 0.3: Mark allocation labels
   * 0.4: Question number labels
   * 0.5: Short LaTeX expressions in question text
   * 0.6: Question header patterns (using database text - GENERIC)
   * 0.7: Common question text patterns (using database text - GENERIC, fallback only)
   * 0.8: Table data (run before database matching)
   * 1: Quick question text matching (using database text - PRIMARY FILTER, GENERIC)
   * 2: Thorough question text matching (using database text - PRIMARY FILTER, GENERIC)
   * -1: Classification student work whitelist (PROTECT STUDENT WORK - run AFTER database matching, conservative threshold)
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
    
    // PRIORITY CHECK 0: Filter page footers/metadata (ALWAYS filter - run first)
    if (this.isPageFooterOrMetadata(block)) {
      return { isQuestionText: true, confidence: 1.0, matchedQuestion: 'metadata', reason: 'page-footer-metadata' };
    }
    
    // PRIORITY CHECK 0.05: Hardcoded footer pattern check (ALWAYS filter - run before heuristic check)
    // Check for known footer patterns first (exact match or regex) before using heuristics
    if (this.matchesHardcodedFooterPattern(trimmedBlockText, block)) {
      return { isQuestionText: true, confidence: 0.98, matchedQuestion: 'noise', reason: 'hardcoded-footer' };
    }
    
    // PRIORITY CHECK 0.1: Filter footer patterns (ALWAYS filter - run early, NO classification check)
    // Footer patterns are NEVER valid student work, so always filter them
    // This is a fallback heuristic check for footer patterns not caught by hardcoded patterns
    const footerResult = this.checkFooterPatterns(trimmedBlockText, block);
    if (footerResult.isQuestionText) {
      return footerResult;
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
    
    // PRIORITY CHECK 0.6: Pattern-based filtering for obvious question text (run BEFORE similarity matching)
    // This catches patterns like "Write down...", "Here are...", etc. that are clearly question text
    // CRITICAL: This must run BEFORE similarity matching to catch main question text that might not match sub-question text
    const obviousQuestionTextResult = this.checkObviousQuestionTextPatterns(blockText);
    if (obviousQuestionTextResult.isQuestionText) {
      return obviousQuestionTextResult;
    }
    
    // PRIORITY CHECK 0.7: Filter question header patterns (using database text)
    const headerResult = this.checkQuestionHeader(block, blockText, classificationQuestions);
    if (headerResult.isQuestionText) {
      // CRITICAL: Question headers should ALWAYS be filtered, even if they match classification
      // Question headers like "14 Expand and simplify..." are question text, not student work
      // The whitelist check is only to prevent filtering valid student work that happens to start with a number
      // But if it matches a question header pattern, it's definitely question text
      return headerResult;
    }
    
    // PRIORITY CHECK 0.8: Filter table data (run before database matching to catch table rows)
    // Table data like \hline blocks should be filtered even if they match classification (they're question text, not student work)
    const tableResult = this.checkTableData(blockText);
    if (tableResult.isQuestionText) {
      return tableResult;
    }
    
    // PRIORITY CHECK 1: Quick question text matching (using database text - PRIMARY FILTER, GENERIC)
    // Run database matching FIRST - this is generic and works for all exam papers
    // Database matching uses actual question text from the database, not hardcoded patterns
    const quickMatchResult = this.checkQuickQuestionTextMatch(block, blockText, classificationQuestions);
    if (quickMatchResult.isQuestionText) {
      // Block matches database question text → filter it
      return quickMatchResult;
    }
    
    // PRIORITY CHECK 2: Thorough question text matching (using database text - PRIMARY FILTER, GENERIC)
    // More comprehensive database matching for cases missed by quick match
    const thoroughMatchResult = this.checkThoroughQuestionTextMatch(block, blockText, classificationQuestions);
    if (thoroughMatchResult.isQuestionText) {
      // Block matches database question text → filter it
      return thoroughMatchResult;
    }
    
    // PRIORITY CHECK -1: Classification student work whitelist (PROTECT STUDENT WORK)
    // Run AFTER database matching - only protect blocks that database matching didn't catch
    // Use CONSERVATIVE threshold (0.60) - only keep blocks that strongly match classification student work
    // This prevents false positives where question text incorrectly matches classification
    const matchingLines = this.findMatchingClassificationLines(block, classificationQuestions, 0.60);
    if (matchingLines.length > 0) {
      // Block matches classification student work strongly → keep it (don't filter)
      // This protects valid student work that database matching might have missed
      return { 
        isQuestionText: false, 
        reason: 'classification-student-work-match',
        matchedClassificationLines: matchingLines
      };
    }
    
    // Block doesn't match any question text → keep it
    return { isQuestionText: false };
  }
  
  /**
   * Find all classification lines that match this block (with similarity scores)
   * Returns array of matches sorted by similarity (highest first)
   */
  private static findMatchingClassificationLines(
    block: MathBlock & { pageIndex: number },
    classificationQuestions: QuestionForFiltering[],
    threshold: number = 0.60
  ): ClassificationMatch[] {
    const blockText = block.mathpixLatex || block.googleVisionText || '';
    const trimmedBlockText = blockText.trim();
    const matches: ClassificationMatch[] = [];
    
    // For single chars/short numbers (1-3 chars), check ALL pages (cross-page matching)
    const isSingleCharOrShortNumber = trimmedBlockText.length <= 3 && /^[A-Za-z0-9]+$/.test(trimmedBlockText);
    
    const checkLine = (line: string, questionNumber?: string, subQuestionPart?: string): void => {
      const normalizedBlock = normalizeTextForComparison(blockText);
      const normalizedStudentWork = normalizeTextForComparison(line);
      const blockLength = normalizedBlock.length;
      const lineLength = normalizedStudentWork.length;
      
      // SANITY CHECK: If classification is much shorter than OCR block, require exact match or very high similarity
      // This prevents question text like "Write down the letter..." from matching single-letter classification "H"
      // Rule: If classification < 5 chars and OCR block > 20 chars, require exact match or similarity >= 0.90
      const isLengthMismatch = lineLength < 5 && blockLength > 20;
      if (isLengthMismatch) {
        // For severe length mismatch, only allow exact match
        if (normalizedBlock === normalizedStudentWork) {
          matches.push({ classificationLine: line, similarity: 1.0, questionNumber, subQuestionPart });
        }
        return; // Don't allow any other matching for severe length mismatch
      }
      
      // Calculate base similarity
      const baseSimilarity = calculateOcrToDatabaseSimilarity(blockText, line);
      
      // NORMALIZE SCORE: Adjust similarity based on text length ratio to make it comparable with database scores
      // If classification is much shorter than OCR block, the score might be inflated (e.g., "H" vs "Write down...")
      // If classification is much longer than OCR block, the score might be deflated (e.g., long equation vs short OCR)
      // Normalize by considering the length ratio
      let normalizedSimilarity = baseSimilarity;
      if (lineLength > 0 && blockLength > 0) {
        const lengthRatio = Math.min(blockLength, lineLength) / Math.max(blockLength, lineLength);
        // If lengths are very different (ratio < 0.3), adjust the score
        // For short classification (e.g., "H" = 1 char vs "Write..." = 30 chars, ratio = 0.03)
        // Penalize the score more aggressively
        if (lengthRatio < 0.3) {
          // Apply penalty: reduce score by (1 - ratio) * 0.5
          // For ratio 0.03: penalty = 0.97 * 0.5 = 0.485, so score is reduced significantly
          const penalty = (1 - lengthRatio) * 0.5;
          normalizedSimilarity = baseSimilarity * (1 - penalty);
        }
      }
      
      const minSimilarity = trimmedBlockText.length >= 5 ? threshold : Math.max(threshold, 0.60);
      
      // CRITICAL: For math expressions (containing operators like =, +, -, etc.), require higher similarity
      // Question text equations like "2 x-3 y & =18" should NOT match student work like "10x - 15y = 18 \times 5"
      // even if they share some terms. Require similarity >= 0.70 for math expressions to prevent false matches.
      // EXCEPTION: For question header checks (when threshold is 0.50), allow lower similarity (0.50) for math expressions
      // because OCR errors are common and we want to protect student work
      const isMathExpression = /[=+\-*/<>≤≥]/.test(blockText) || /[=+\-*/<>≤≥]/.test(line);
      // If threshold is already low (0.50), don't increase it for math expressions (OCR errors are common)
      // Only increase threshold for math expressions if the base threshold is already high (>= 0.60)
      const effectiveThreshold = isMathExpression && threshold >= 0.60 ? Math.max(minSimilarity, 0.70) : minSimilarity;
      
      // For short classification text (< 5 chars), require much higher similarity (>= 0.90) or exact match
      // This prevents question text from matching single-letter classification like "H", "F", "J"
      if (lineLength < 5 && blockLength >= 5) {
        // Short classification requires exact match or very high similarity
        if (normalizedBlock === normalizedStudentWork) {
          matches.push({ classificationLine: line, similarity: 1.0, questionNumber, subQuestionPart });
          return;
        }
        // For non-exact matches, require very high similarity (>= 0.90)
        if (normalizedSimilarity >= 0.90) {
          matches.push({ classificationLine: line, similarity: normalizedSimilarity, questionNumber, subQuestionPart });
        }
        return; // Don't allow substring matching or lower thresholds for short classification
      }
      
      if (normalizedSimilarity >= effectiveThreshold) {
        matches.push({ classificationLine: line, similarity: normalizedSimilarity, questionNumber, subQuestionPart });
        return;
      }
      
      // Check exact match after normalization
      if (normalizedBlock === normalizedStudentWork) {
        matches.push({ classificationLine: line, similarity: 1.0, questionNumber, subQuestionPart });
        return;
      }
      
      // Check substring matching for longer blocks (STRICT: only if similarity is already high)
      // This prevents question text from matching student work via substring overlap
      // Only allow substring matching if similarity is already >= 0.40 (indicating real similarity)
      // ONE-DIRECTIONAL: Only check if classification contains OCR block (OCR is fragment, classification is whole)
      // DISABLE substring matching for short classification (< 10 chars) to prevent false matches
      // EXCEPTION: For question header checks (threshold 0.50), be more lenient (similarity >= 0.30, overlap >= 10)
      const minSubstringSimilarity = threshold <= 0.50 ? 0.30 : 0.40;
      const minOverlapLength = threshold <= 0.50 ? 10 : 20;
      if (lineLength >= 10 && trimmedBlockText.length >= 10 && normalizedBlock.length >= 10 && normalizedSimilarity >= minSubstringSimilarity) {
        const normalizedBlockForSubstring = normalizedBlock.slice(0, Math.min(50, normalizedBlock.length));
        const normalizedStudentWorkForSubstring = normalizedStudentWork.slice(0, Math.min(50, normalizedStudentWork.length));
        // Require substantial overlap: at least minOverlapLength characters must match
        // Lower overlap for question header checks (10 chars) to handle OCR errors
        if (normalizedBlockForSubstring.length >= minOverlapLength && 
            normalizedStudentWorkForSubstring.length >= minOverlapLength &&
            normalizedStudentWorkForSubstring.includes(normalizedBlockForSubstring)) {
          // Only use substring match if similarity is already decent (>= minSubstringSimilarity)
          // This ensures we don't match question text to student work via weak substring overlap
          // ONE-DIRECTIONAL: Only check if classification contains OCR block
          matches.push({ classificationLine: line, similarity: normalizedSimilarity, questionNumber, subQuestionPart });
        }
      }
    };
    
    if (isSingleCharOrShortNumber) {
      // For single chars, check all pages with exact match
      for (const q of classificationQuestions) {
        if (q.studentWork) {
          const studentWorkLines = q.studentWork.split(/\n|\\newline|\\\\/).map(l => l.trim()).filter(l => l.length > 0);
          for (const line of studentWorkLines) {
            if (line.trim().length === 1 && trimmedBlockText.toLowerCase() === line.trim().toLowerCase()) {
              matches.push({ classificationLine: line, similarity: 1.0, questionNumber: q.questionNumber || undefined });
            }
          }
        }
        if (q.subQuestions) {
          for (const subQ of q.subQuestions) {
            if (subQ.studentWork) {
              const subQLines = subQ.studentWork.split(/\n|\\newline|\\\\/).map(l => l.trim()).filter(l => l.length > 0);
              for (const line of subQLines) {
                if (line.trim().length === 1 && trimmedBlockText.toLowerCase() === line.trim().toLowerCase()) {
                  matches.push({ classificationLine: line, similarity: 1.0, questionNumber: q.questionNumber || undefined, subQuestionPart: subQ.part });
                }
              }
            }
          }
        }
      }
    } else {
      // For longer blocks, check same page only
      for (const q of classificationQuestions) {
        if (q.sourceImageIndex !== block.pageIndex) continue;
        
        if (q.studentWork) {
          const studentWorkLines = q.studentWork.split(/\n|\\newline|\\\\/).map(l => l.trim()).filter(l => l.length > 0);
          for (const line of studentWorkLines) {
            checkLine(line, q.questionNumber || undefined);
          }
        }
        
        if (q.subQuestions) {
          for (const subQ of q.subQuestions) {
            if (subQ.studentWork) {
              const subQLines = subQ.studentWork.split(/\n|\\newline|\\\\/).map(l => l.trim()).filter(l => l.length > 0);
              for (const line of subQLines) {
                checkLine(line, q.questionNumber || undefined, subQ.part);
              }
            }
          }
        }
      }
    }
    
    // Sort by similarity (highest first)
    return matches.sort((a, b) => b.similarity - a.similarity);
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
    const matches = this.findMatchingClassificationLines(block, classificationQuestions, threshold);
    return matches.length > 0;
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
   * Check if block matches hardcoded footer patterns (exact match or regex)
   * PRIORITY 0.05: ALWAYS FILTER - Check known footer patterns first before heuristics
   * Examples: "m | - n - n -", "m \( \| \) - \( n \) - \( n \) -"
   */
  private static matchesHardcodedFooterPattern(
    trimmedBlockText: string,
    block: MathBlock & { pageIndex: number }
  ): boolean {
    // Exact matches for known footer patterns
    const exactPatterns = [
      'm \( \| \) - \( n \) - \( n \) -',  // LaTeX format (exact match)
      'm | - n - n -',                      // Plain text format (exact match)
      'm \| - n - n -',                     // LaTeX escaped pipe (exact match)
    ];
    
    // Check exact matches first (most reliable)
    if (exactPatterns.some(pattern => trimmedBlockText === pattern)) {
      return true;
    }
    
    // Regex patterns for footer variations
    // Pattern: letter | - letter - letter - (with optional LaTeX formatting and flexible spacing)
    // Examples: "m | - n - n -", "a | - b - b -", "x \( \| \) - \( y \) - \( y \) -"
    const footerRegexPatterns = [
      // LaTeX format: letter \( \| \) - \( letter \) - \( letter \) - (flexible spacing)
      /^[a-z]\s*\\\(\s*\\\|\s*\\\)\s*-\s*\\\(\s*[a-z]\s*\\\)\s*-\s*\\\(\s*[a-z]\s*\\\)\s*-$/i,
      // Plain text format: letter | - letter - letter - (flexible spacing)
      /^[a-z]\s*\|\s*-\s*[a-z]\s*-\s*[a-z]\s*-$/i,
      // LaTeX escaped pipe: letter \| - letter - letter - (flexible spacing)
      /^[a-z]\s*\\\|\s*-\s*[a-z]\s*-\s*[a-z]\s*-$/i,
      // More flexible: letter (optional spaces) | (optional spaces) - (optional spaces) letter (optional spaces) - (optional spaces) letter (optional spaces) -
      /^[a-z]\s*\|\s*-\s*[a-z]\s*-\s*[a-z]\s*-/i,
    ];
    
    // Check regex patterns
    for (const pattern of footerRegexPatterns) {
      if (pattern.test(trimmedBlockText)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Check for footer patterns with pipes, dashes, and minimal content
   * PRIORITY 0.1: ALWAYS FILTER - Footer patterns are NEVER valid student work
   * Examples: "m | - n - n -", "m \( \| \) - \( n \) - \( n \) -"
   * This is a fallback heuristic check for footer patterns not caught by hardcoded patterns
   */
  private static checkFooterPatterns(
    trimmedBlockText: string,
    block: MathBlock & { pageIndex: number }
  ): FilterResult {
    // Check for footer patterns: blocks with pipe characters, dashes, and minimal alphanumeric content
    // Pattern: "m | - n - n -" or "m \( \| \) - \( n \) - \( n \) -" (LaTeX format)
    // REMOVED length upper limit - footers can be longer in LaTeX format
    if (trimmedBlockText.length >= 5) {
      // Count pipe characters (both regular | and LaTeX \|)
      // Match both standalone | and LaTeX \( \| \) patterns
      const pipeCount = (trimmedBlockText.match(/\|/g) || []).length;
      // Match LaTeX escaped pipe: \| (but not \( \| \) as that's already counted above)
      const latexPipeCount = (trimmedBlockText.match(/\\\|/g) || []).length;
      const totalPipeCount = pipeCount + latexPipeCount;
      
      // Count dashes (both regular - and LaTeX \( - \))
      const dashCount = (trimmedBlockText.match(/-/g) || []).length;
      
      // Count alphanumeric characters (excluding LaTeX commands)
      // Remove LaTeX commands first to get actual content
      // Remove common LaTeX patterns: \(, \), \{, \}, \|, etc.
      let withoutLatex = trimmedBlockText
        .replace(/\\[a-z]+\{?[^}]*\}?/gi, '') // Remove LaTeX commands like \begin, \end, etc.
        .replace(/\\[()|]/g, '') // Remove escaped characters: \(, \), \|
        .replace(/[()]/g, ''); // Remove remaining parentheses
      const alphanumericCount = (withoutLatex.match(/[A-Za-z0-9]/g) || []).length;
      
      // If block has pipes/dashes but very few alphanumeric chars, it's likely footer noise
      // Pattern: "m \( \| \) - \( n \) - \( n \) -" has 3 alphanumeric chars (m, n, n)
      // REQUIRE pipes to be present (>= 1) - don't filter based on dashes alone to avoid filtering valid math expressions
      if (totalPipeCount >= 1 && alphanumericCount <= 3) {
        // ALWAYS filter footer patterns - they're never valid student work
        // NO classification check - footer patterns are always noise
        return { isQuestionText: true, confidence: 0.95, matchedQuestion: 'noise', reason: 'footer-noise' };
      }
    }
    
    return { isQuestionText: false };
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
    
    // Footer patterns are now checked in PRIORITY 0.1 (checkFooterPatterns)
    // This section is kept for backward compatibility but should not be reached
    
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
   * Pattern-based filtering for obvious question text patterns
   * This catches main question text that might not match sub-question text
   * Examples: "Write down the letter...", "Here are some graphs...", etc.
   */
  private static checkObviousQuestionTextPatterns(blockText: string): FilterResult {
    const trimmed = blockText.trim();
    
    // Patterns that are ALWAYS question text (not student work)
    const obviousQuestionPatterns = [
      /^Write down the letter/i,
      /^Here are some/i,
      /^On the grid, draw/i,
      /^Work out an estimate/i,
      /^Describe fully/i,
      /^Solve the/i,
      /^Expand and simplify/i,
      /^The table gives information/i,
      /^Triangle.*is translated/i,
      /^Triangle.*is rotated/i,
    ];
    
    for (const pattern of obviousQuestionPatterns) {
      if (pattern.test(trimmed)) {
        // These patterns are ALWAYS question text - filter them immediately
        return { isQuestionText: true, confidence: 0.95, matchedQuestion: 'question-pattern', reason: 'obvious-question-text-pattern' };
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
      
      // CRITICAL FIX: Check main question text FIRST for blocks that look like main question text
      // This fixes Q12 Block 2 "Write down the letter..." which is main question text, not sub-question text
      // Main question text check is done below (line 854), but we need to prioritize it for certain patterns
      const isMainQuestionTextPattern = /^(Write down|Here are|On the grid|Work out|Describe|Solve|Expand)/i.test(blockText.trim());
      
      // Check sub-question texts first (more specific) - but skip if block looks like main question text
      if (question.subQuestions && !isMainQuestionTextPattern) {
        for (const subQ of question.subQuestions) {
          // CRITICAL: For grouped sub-questions, subQ.databaseText is the main question text (not sub-question specific)
          // So we need to check BOTH databaseText AND subQ.text (classification text) separately
          // Check classification text first (subQ.text) - this contains the actual sub-question text
          const textsToCheck: Array<{ text: string; source: string }> = [];
          if (subQ.text) {
            textsToCheck.push({ text: subQ.text, source: 'classification' });
          }
          // Also check database text if it's different from classification text
          if (subQ.databaseText && subQ.databaseText !== subQ.text) {
            textsToCheck.push({ text: subQ.databaseText, source: 'database' });
          }
          
          for (const { text: subQTextToUse, source } of textsToCheck) {
            const similarity = calculateOcrToDatabaseSimilarity(blockText, subQTextToUse);
            const normalizedSubQText = normalizeTextForComparison(subQTextToUse);
            
            if (normalizedSubQText) {
              // CRITICAL FIX: Extract label from ORIGINAL text BEFORE normalization
              // This preserves structure that normalization destroys
              // Example: "(ii) y=-x^3" → label="ii", remaining="y=-x^3"
              const { label: extractedLabel, remainingText: blockTextWithoutLabel } = extractSubQuestionLabel(blockText);
              
              // Now normalize the remaining text (without label)
              const normalizedBlockWithoutLabel = normalizeTextForComparison(blockTextWithoutLabel);
              
              // Check if the remaining text (without label) matches the sub-question text
              const isSubstring1 = normalizedSubQText.includes(normalizedBlockText);
              const isSubstring2 = normalizedBlockText.length > 10 && normalizedSubQText.includes(normalizedBlockText.slice(0, 30));
              // Check if block without label matches sub-question text
              // This handles cases like "(ii) y=-x^3" where blockWithoutLabel = "yx3"
              const isBlockWithoutLabelMeaningful = normalizedBlockWithoutLabel.length >= 3 && !/^\d+$/.test(normalizedBlockWithoutLabel);
              const isSubstring3 = isBlockWithoutLabelMeaningful && normalizedSubQText.includes(normalizedBlockWithoutLabel);
              const isSubstring = isSubstring1 || isSubstring2 || isSubstring3;
              
              
              // SIMPLIFIED: Lower threshold (0.50) for sub-question text matching - be more aggressive
              // Require similarity >= 0.50 OR substring match (substring is strong signal)
              // This catches cases like "(ii) y=-x^3" matching "$y = -x^3$" even with lower similarity
              if (similarity >= 0.50 || isSubstring) {
                // Calculate question text score: prioritize substring match (0.75), otherwise use similarity
                // CRITICAL FIX: Check isSubstring FIRST, otherwise when similarity=0.50 and isSubstring=true, it uses 0.50 instead of 0.75
                const questionTextScore = isSubstring ? 0.75 : similarity;
                
                // CRITICAL: Before filtering, check if classification student work matches
                // This protects valid student work that might match question text due to similar wording
                // Example: Q11 "Rotated quo clockwise..." matches question text but is actually student work
                const classificationMatches = this.findMatchingClassificationLines(block, classificationQuestions, 0.60);
                if (classificationMatches.length > 0 && classificationMatches[0].similarity >= 0.60) {
                  // Classification matches student work → keep it (don't filter)
                  // Even if database matching is confident, classification is more reliable for student work
                  return { 
                    isQuestionText: false, 
                    reason: 'classification-student-work-match',
                    matchedClassificationLines: classificationMatches
                  };
                }
                
                // CRITICAL: If question text score is high enough (>= 0.70), trust it and filter
                // Lowered from 0.80 to 0.70 to be more aggressive in filtering question text
                if (questionTextScore >= 0.70) {
                  // High confidence it's question text (substring match or high similarity) → filter it
                  const matchedQuestion = subQ.part ? `${question.questionNumber}${subQ.part}` : question.questionNumber || undefined;
                  return { isQuestionText: true, confidence: questionTextScore, matchedQuestion, reason: 'quick-subquestion-match' };
                }
                
                // Question text score is moderate (0.50-0.70) - check classification to be safe
                // CRITICAL: Only filter if we're confident (questionTextScore >= 0.65) OR classification doesn't match at all
                // If questionTextScore is too low (< 0.65), don't filter - it might be student work
                // Note: classificationMatches already checked above for high scores (>= 0.70)
                // For moderate scores, check again if classification wasn't checked yet
                
                // SANITY CHECK: If database found question text and classification is very short (< 5 chars),
                // ALWAYS filter it. Question text like "Write down the letter..." can NEVER be student work like "H".
                if (classificationMatches.length > 0) {
                  const matchedClassification = classificationMatches[0];
                  const normalizedClassification = normalizeTextForComparison(matchedClassification.classificationLine);
                  if (normalizedClassification.length < 5 && normalizedBlockText.length > 20) {
                    // Database found question text, and classification is too short to be valid
                    // This prevents question text from being kept due to false classification matches
                    const matchedQuestion = subQ.part ? `${question.questionNumber}${subQ.part}` : question.questionNumber || undefined;
                    return { isQuestionText: true, confidence: questionTextScore, matchedQuestion, reason: 'quick-subquestion-match' };
                  }
                  
                  // Only override if classification STRONGLY matches (>= 0.70)
                  // This prevents weak classification matches from overriding moderate question text matches
                  if (matchedClassification.similarity >= 0.70) {
                    // Classification strongly matches student work → keep it (don't filter)
                    return { 
                      isQuestionText: false, 
                      reason: 'classification-student-work-match',
                      matchedClassificationLines: classificationMatches
                    };
                  }
                }
                
                // CRITICAL FIX: Only filter if questionTextScore >= 0.65 (moderate confidence)
                // If questionTextScore < 0.65, don't filter - similarity 0.50 is too low to be confident
                // This prevents false positives like "were in a shop." or fractions being filtered
                if (questionTextScore >= 0.65) {
                  // Moderate confidence it's question text → filter it
                  const matchedQuestion = subQ.part ? `${question.questionNumber}${subQ.part}` : question.questionNumber || undefined;
                  return { isQuestionText: true, confidence: questionTextScore, matchedQuestion, reason: 'quick-subquestion-match' };
                }
                
                // Low confidence (questionTextScore < 0.65) → don't filter, keep it (might be student work)
                // Don't return anything - let it pass through to other checks
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
          const isSubstring1 = normalizedQuestionText.includes(normalizedBlockText);
          const isSubstring2 = normalizedBlockText.length > 10 && normalizedQuestionText.includes(normalizedBlockText.slice(0, 30));
          // For article variations (e.g., "were in a shop" vs "were in the shop"), check if question contains block without articles
          // CRITICAL FIX: Handle both "a" and "the" variations - remove articles from both block and question
          // Also handle word boundary issues - "were in a shop" vs "were in the shop" should match
          // Strategy: Remove articles, then check if question contains block OR if block is a substring of question
          const blockWithoutArticles = normalizedBlockText.replace(/\b(a|an|the)\b/g, '').replace(/\s+/g, '');
          const questionWithoutArticles = normalizedQuestionText.replace(/\b(a|an|the)\b/g, '').replace(/\s+/g, '');
          // CRITICAL: Also check reverse - if block without articles is in question without articles
          // This handles "wereinashop" (from "were in a shop") matching "wereintheshop" (from "were in the shop")
          // But we need to be careful - "wereinashop" and "wereintheshop" are different - "a" vs "the"
          // So we need to check if the block (without "a") matches question (without "the")
          // Or vice versa - check if block matches question with either article removed
          const blockWithoutA = normalizedBlockText.replace(/\ba\b/g, '').replace(/\s+/g, '');
          const questionWithoutThe = normalizedQuestionText.replace(/\bthe\b/g, '').replace(/\s+/g, '');
          const blockWithoutThe = normalizedBlockText.replace(/\bthe\b/g, '').replace(/\s+/g, '');
          const questionWithoutA = normalizedQuestionText.replace(/\ba\b/g, '').replace(/\s+/g, '');
          // Check multiple combinations: block without "a" vs question without "the", and vice versa
          const isSubstring3a = blockWithoutArticles.length >= 5 && questionWithoutArticles.includes(blockWithoutArticles);
          const isSubstring3b = blockWithoutA.length >= 5 && questionWithoutThe.includes(blockWithoutA);
          const isSubstring3c = blockWithoutThe.length >= 5 && questionWithoutA.includes(blockWithoutThe);
          const isSubstring3 = isSubstring3a || isSubstring3b || isSubstring3c;
          const isSubstring = isSubstring1 || isSubstring2 || isSubstring3 || blockStartsWithQuestion || questionStartsWithBlock;
          
          
              // SIMPLIFIED: Lower threshold (0.50) for main question text matching - be more aggressive
              // Require similarity >= 0.50 OR substring match (substring is strong signal)
              if (similarity >= 0.50 || isSubstring) {
                // Calculate question text score: prioritize substring match (0.75), otherwise use similarity
                // CRITICAL FIX: Check isSubstring FIRST, otherwise when similarity=0.50 and isSubstring=true, it uses 0.50 instead of 0.75
                const questionTextScore = isSubstring ? 0.75 : similarity;
                
                // CRITICAL: Before filtering, check if classification student work matches
                // This protects valid student work that might match question text due to similar wording
                // Example: Q11 "Rotated quo clockwise..." matches question text but is actually student work
                const classificationMatches = this.findMatchingClassificationLines(block, classificationQuestions, 0.60);
                if (classificationMatches.length > 0 && classificationMatches[0].similarity >= 0.60) {
                  // Classification matches student work → keep it (don't filter)
                  // Even if database matching is confident, classification is more reliable for student work
                  return { 
                    isQuestionText: false, 
                    reason: 'classification-student-work-match',
                    matchedClassificationLines: classificationMatches
                  };
                }
                
                // CRITICAL: If question text score is high enough (>= 0.70), trust it and filter
                // Lowered from 0.80 to 0.70 to be more aggressive in filtering question text
                if (questionTextScore >= 0.70) {
                  // High confidence it's question text (substring match or high similarity) → filter it
                  return { isQuestionText: true, confidence: questionTextScore, matchedQuestion: question.questionNumber || undefined, reason: 'quick-question-match' };
                }
                
                // Question text score is moderate (0.50-0.70) - classification already checked above
                
                // SANITY CHECK: If database found question text and classification is very short (< 5 chars),
                // ALWAYS filter it. Question text like "Write down the letter..." can NEVER be student work like "H".
                if (classificationMatches.length > 0) {
                  const matchedClassification = classificationMatches[0];
                  const normalizedClassification = normalizeTextForComparison(matchedClassification.classificationLine);
                  if (normalizedClassification.length < 5 && normalizedBlockText.length > 20) {
                    // Database found question text, and classification is too short to be valid
                    // This prevents question text from being kept due to false classification matches
                    return { isQuestionText: true, confidence: questionTextScore, matchedQuestion: question.questionNumber || undefined, reason: 'quick-question-match' };
                  }
                  
                  // Only override if classification STRONGLY matches (>= 0.70)
                  // This prevents weak classification matches from overriding moderate question text matches
                  if (matchedClassification.similarity >= 0.70) {
                    // Classification strongly matches student work → keep it (don't filter)
                    return { 
                      isQuestionText: false, 
                      reason: 'classification-student-work-match',
                      matchedClassificationLines: classificationMatches
                    };
                  }
                }
                
                // CRITICAL FIX: Only filter if questionTextScore >= 0.65 (moderate confidence)
                // If questionTextScore < 0.65, don't filter - similarity 0.50 is too low to be confident
                if (questionTextScore >= 0.65) {
                  // Moderate confidence it's question text → filter it
                  return { isQuestionText: true, confidence: questionTextScore, matchedQuestion: question.questionNumber || undefined, reason: 'quick-question-match' };
                }
                
                // Low confidence (questionTextScore < 0.65) → don't filter, keep it (might be student work)
                // Don't return anything - let it pass through to other checks
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
          const isSubstring1 = normalizedQuestionText.includes(normalizedBlockText);
          const isSubstring2 = normalizedBlockText.length > 10 && normalizedQuestionText.includes(normalizedBlockText.slice(0, 30));
          // CRITICAL FIX: Use word-level matching for article variations
          // Instead of exact string matching (which fails for "wereinashop" vs "wereintheshop"),
          // check if key words appear in both texts, ignoring articles
          // Example: "were in a shop" matches "were in the shop" because both contain "were", "in", "shop"
          // This works on ORIGINAL text (before normalization) to preserve word boundaries
          const isSubstring3 = matchesWordsIgnoringArticles(blockText, questionTextToUse, 2);
          const isSubstring = isSubstring1 || isSubstring2 || isSubstring3 || blockStartsWithQuestion || questionStartsWithBlock;
          
          // SIMPLIFIED: Lower threshold (0.50) to catch OCR artifacts and format differences - be more aggressive
          // Require similarity >= 0.50 OR substring match (substring is strong signal)
          if (similarity >= 0.50 || isSubstring) {
            // Calculate question text score: prioritize substring match (0.75), otherwise use similarity
            // CRITICAL FIX: Check isSubstring FIRST, otherwise when similarity=0.50 and isSubstring=true, it uses 0.50 instead of 0.75
            const questionTextScore = isSubstring ? 0.75 : similarity;
            
            // CRITICAL: Before filtering, check if classification student work matches
            // This protects valid student work that might match question text due to similar wording
            // Example: Q11 "Rotated quo clockwise..." matches question text but is actually student work
            const classificationMatches = this.findMatchingClassificationLines(block, classificationQuestions, 0.60);
            if (classificationMatches.length > 0 && classificationMatches[0].similarity >= 0.60) {
              // Classification matches student work → keep it (don't filter)
              // Even if database matching is confident, classification is more reliable for student work
              return { 
                isQuestionText: false, 
                reason: 'classification-student-work-match',
                matchedClassificationLines: classificationMatches
              };
            }
            
            // CRITICAL: If question text score is high enough (>= 0.70), trust it and filter
            // Lowered from 0.80 to 0.70 to be more aggressive in filtering question text
            if (questionTextScore >= 0.70) {
              // High confidence it's question text (substring match or high similarity) → filter it
              return { isQuestionText: true, confidence: questionTextScore, matchedQuestion: question.questionNumber || undefined, reason: 'thorough-question-match' };
            }
            
            // Question text score is moderate (0.50-0.70) - classification already checked above
            
            // SANITY CHECK: If database found question text and classification is very short (< 5 chars),
            // ALWAYS filter it. Question text like "Write down the letter..." can NEVER be student work like "H".
            if (classificationMatches.length > 0) {
              const matchedClassification = classificationMatches[0];
              const normalizedClassification = normalizeTextForComparison(matchedClassification.classificationLine);
              const normalizedBlockTextForThorough = normalizeTextForComparison(blockText);
              if (normalizedClassification.length < 5 && normalizedBlockTextForThorough.length > 20) {
                // Database found question text, and classification is too short to be valid
                // This prevents question text from being kept due to false classification matches
                return { isQuestionText: true, confidence: questionTextScore, matchedQuestion: question.questionNumber || undefined, reason: 'thorough-question-match' };
              }
              
              // Only override if classification STRONGLY matches (>= 0.70)
              // This prevents weak classification matches from overriding moderate question text matches
              if (matchedClassification.similarity >= 0.70) {
                // Classification strongly matches student work → keep it (don't filter)
                return { 
                  isQuestionText: false, 
                  reason: 'classification-student-work-match',
                  matchedClassificationLines: classificationMatches
                };
              }
            }
            
            // CRITICAL FIX: Only filter if questionTextScore >= 0.65 (moderate confidence)
            // If questionTextScore < 0.65, don't filter - similarity 0.50 is too low to be confident
            if (questionTextScore >= 0.65) {
              // Moderate confidence it's question text → filter it
              return { isQuestionText: true, confidence: questionTextScore, matchedQuestion: question.questionNumber || undefined, reason: 'thorough-question-match' };
            }
            
            // Low confidence (questionTextScore < 0.65) → don't filter, keep it (might be student work)
            // Don't return anything - let it pass through to other checks
          }
        }
      }
      
      if (question.subQuestions) {
        for (const subQ of question.subQuestions) {
          // CRITICAL: For grouped sub-questions, subQ.databaseText is the main question text (not sub-question specific)
          // So we need to check BOTH databaseText AND subQ.text (classification text) separately
          // Check classification text first (subQ.text) - this contains the actual sub-question text
          const textsToCheck: Array<{ text: string; source: string }> = [];
          if (subQ.text) {
            textsToCheck.push({ text: subQ.text, source: 'classification' });
          }
          // Also check database text if it's different from classification text
          if (subQ.databaseText && subQ.databaseText !== subQ.text) {
            textsToCheck.push({ text: subQ.databaseText, source: 'database' });
          }
          
          for (const { text: subQTextToUse, source } of textsToCheck) {
            const similarity = calculateOcrToDatabaseSimilarity(blockText, subQTextToUse);
            const normalizedSubQText = normalizeTextForComparison(subQTextToUse);
            const normalizedBlockTextForSubQ = normalizeTextForComparison(blockText);
            
            const blockStartsWithSubQ = normalizedBlockTextForSubQ.length > 5 && normalizedSubQText.startsWith(normalizedBlockTextForSubQ.slice(0, Math.min(50, normalizedBlockTextForSubQ.length)));
            const subQStartsWithBlock = normalizedBlockTextForSubQ.length > 5 && normalizedBlockTextForSubQ.startsWith(normalizedSubQText.slice(0, Math.min(50, normalizedSubQText.length)));
            const isSubstring = normalizedSubQText.includes(normalizedBlockTextForSubQ) || 
                               (normalizedBlockTextForSubQ.length > 10 && normalizedSubQText.includes(normalizedBlockTextForSubQ.slice(0, 30))) ||
                               blockStartsWithSubQ || subQStartsWithBlock;
            
            // CRITICAL FIX: Extract label from ORIGINAL text BEFORE normalization
            // This preserves structure that normalization destroys
            // Example: "(ii) y=-x^3" → label="ii", remaining="y=-x^3"
            const { label: extractedLabel, remainingText: blockTextWithoutLabel } = extractSubQuestionLabel(blockText);
            
            // Now normalize the remaining text (without label)
            const normalizedBlockWithoutLabel = normalizeTextForComparison(blockTextWithoutLabel);
            
            // Check if block without label matches sub-question text
            // This handles cases like "(ii) y=-x^3" where blockWithoutLabel = "yx3"
            const isBlockWithoutLabelMeaningful = normalizedBlockWithoutLabel.length >= 3 && !/^\d+$/.test(normalizedBlockWithoutLabel);
            const blockWithoutLabelIsSubstring = isBlockWithoutLabelMeaningful && normalizedSubQText.includes(normalizedBlockWithoutLabel);
            
            // SIMPLIFIED: Lower threshold (0.50) for sub-question text matching - be more aggressive
            // Require similarity >= 0.50 OR substring match (substring is strong signal)
            if (similarity >= 0.50 || isSubstring || blockWithoutLabelIsSubstring) {
              // Calculate question text score: prioritize substring match (0.75), otherwise use similarity
              // CRITICAL FIX: Check substring matches FIRST, otherwise when similarity=0.50 and isSubstring=true, it uses 0.50 instead of 0.75
              const questionTextScore = (isSubstring || blockWithoutLabelIsSubstring) ? 0.75 : similarity;
              
              // CRITICAL: Before filtering, check if classification student work matches
              // This protects valid student work that might match question text due to similar wording
              const classificationMatches = this.findMatchingClassificationLines(block, classificationQuestions, 0.60);
              if (classificationMatches.length > 0 && classificationMatches[0].similarity >= 0.60) {
                // Classification matches student work → keep it (don't filter)
                // Even if database matching is confident, classification is more reliable for student work
                return { 
                  isQuestionText: false, 
                  reason: 'classification-student-work-match',
                  matchedClassificationLines: classificationMatches
                };
              }
              
              // CRITICAL: If question text score is high enough (>= 0.70), trust it and filter
              // Lowered from 0.80 to 0.70 to be more aggressive in filtering question text
              if (questionTextScore >= 0.70) {
                // High confidence it's question text (substring match or high similarity) → filter it
                const matchedQuestion = subQ.part ? `${question.questionNumber}${subQ.part}` : question.questionNumber || undefined;
                return { isQuestionText: true, confidence: questionTextScore, matchedQuestion, reason: 'thorough-subquestion-match' };
              }
              
              // Question text score is moderate (0.50-0.70) - classification already checked above
              
              // SANITY CHECK: If database found question text and classification is very short (< 5 chars),
              // ALWAYS filter it. Question text like "Write down the letter..." can NEVER be student work like "H".
              if (classificationMatches.length > 0) {
                const matchedClassification = classificationMatches[0];
                const normalizedClassification = normalizeTextForComparison(matchedClassification.classificationLine);
                if (normalizedClassification.length < 5 && normalizedBlockTextForSubQ.length > 20) {
                  // Database found question text, and classification is too short to be valid
                  // This prevents question text from being kept due to false classification matches
                  const matchedQuestion = subQ.part ? `${question.questionNumber}${subQ.part}` : question.questionNumber || undefined;
                  return { isQuestionText: true, confidence: questionTextScore, matchedQuestion, reason: 'thorough-subquestion-match' };
                }
                
                // Only override if classification STRONGLY matches (>= 0.70)
                // This prevents weak classification matches from overriding moderate question text matches
                if (matchedClassification.similarity >= 0.70) {
                  // Classification strongly matches student work → keep it (don't filter)
                  return { 
                    isQuestionText: false, 
                    reason: 'classification-student-work-match',
                    matchedClassificationLines: classificationMatches
                  };
                }
              }
              
              // CRITICAL FIX: Only filter if questionTextScore >= 0.65 (moderate confidence)
              // If questionTextScore < 0.65, don't filter - similarity 0.50 is too low to be confident
              if (questionTextScore >= 0.65) {
                // Moderate confidence it's question text → filter it
                const matchedQuestion = subQ.part ? `${question.questionNumber}${subQ.part}` : question.questionNumber || undefined;
                return { isQuestionText: true, confidence: questionTextScore, matchedQuestion, reason: 'thorough-subquestion-match' };
              }
              
              // Low confidence (questionTextScore < 0.65) → don't filter, keep it (might be student work)
              // Don't return anything - let it pass through to other checks
            }
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
    // Check for LaTeX table environments and table-related patterns
    // More aggressive: check for \hline even if it's not part of a full tabular environment
    // This catches table rows that OCR extracted separately
    if (blockText.includes('\\begin{tabular}') || 
        blockText.includes('\\hline') || 
        blockText.includes('tabular') || 
        blockText.includes('\\end{tabular}') ||
        (blockText.includes('Time') && blockText.includes('Frequency')) ||
        // Check for table row patterns: \hline followed by content and &
        /\\hline\s+[^&]*&/.test(blockText) ||
        // Check for table-like patterns with & separator
        (blockText.includes('&') && (blockText.includes('\\leqslant') || blockText.includes('\\leq') || blockText.includes('<')))) {
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
            // CRITICAL: Before filtering as question header, check if it matches classification student work
            // This prevents filtering student work that happens to match question patterns
            const classificationMatches = this.findMatchingClassificationLines(block, classificationQuestions, 0.60);
            if (classificationMatches.length > 0 && classificationMatches[0].similarity >= 0.60) {
              // Classification matches student work → keep it (don't filter)
              return { 
                isQuestionText: false, 
                reason: 'classification-student-work-match',
                matchedClassificationLines: classificationMatches
              };
            }
            
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
            // CRITICAL: Before filtering as question header, check if it matches classification student work
            // This prevents filtering student work equations like "10 x-15 y & =18 x \rho" (which is "$10x - 15y = 18 \times 5$")
            // that happen to start with a question number
            // Use LOWER threshold (0.50) for question header check because OCR errors can reduce similarity
            // Example: "10 x-15 y & =18 x \rho" vs "$10x - 15y = 18 \times 5$" - OCR errors ("x \rho" vs "× 5") reduce similarity
            const classificationMatches = this.findMatchingClassificationLines(block, classificationQuestions, 0.50);
            if (classificationMatches.length > 0 && classificationMatches[0].similarity >= 0.50) {
              // Classification matches student work → keep it (don't filter)
              // Even if it looks like a question header, classification is more reliable
              return { 
                isQuestionText: false, 
                reason: 'classification-student-work-match',
                matchedClassificationLines: classificationMatches
              };
            }
            
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
   * Handles sub-question prefixes like "(a)", "(b)", "(i)", etc.
   */
  private static checkCommonQuestionPatterns(
    block: MathBlock & { pageIndex: number },
    blockText: string,
    classificationQuestions: QuestionForFiltering[]
  ): FilterResult {
    // Strip sub-question prefixes like "(a)", "(b)", "(i)", "(ii)", etc. before pattern matching
    // Pattern: optional opening paren, letter or roman numeral, optional closing paren, optional space
    const textWithoutSubQuestionPrefix = blockText.replace(/^\(?[a-zivx]+\)?\s*/i, '').trim();
    
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
      /^Work out an estimate/i,
      /^Work out/i,
      /^between.*minutes/i  // "between 20 minutes and 40 minutes"
    ];
    
    // Check both original text and text without sub-question prefix
    const textsToCheck = [blockText, textWithoutSubQuestionPrefix];
    
    for (const textToCheck of textsToCheck) {
      for (const pattern of commonQuestionPatterns) {
        if (pattern.test(textToCheck)) {
          // Question text patterns are very reliable indicators - filter immediately
          // Only exception: if it's a very short block (< 10 chars) that exactly matches classification student work
          // This prevents filtering single letters like "H", "F", "J" that happen to match patterns
          const isVeryShort = blockText.trim().length < 10;
          if (isVeryShort) {
            // For very short blocks, check if it exactly matches classification student work
            const matchesStudentWorkExactly = classificationQuestions.some(q => {
              if (q.sourceImageIndex !== block.pageIndex) return false;
              if (q.studentWork && q.studentWork.trim() === blockText.trim()) return true;
              if (q.subQuestions) {
                for (const subQ of q.subQuestions) {
                  if (subQ.studentWork && subQ.studentWork.trim() === blockText.trim()) return true;
                }
              }
              return false;
            });
            if (matchesStudentWorkExactly) {
              continue; // Skip filtering if it's an exact match (might be valid student work)
            }
          }
          
          // Pattern matched and it's not a very short exact match → filter it
          return { isQuestionText: true, confidence: 0.85, matchedQuestion: 'question-pattern', reason: 'common-question-pattern' };
        }
      }
    }
    
    return { isQuestionText: false };
  }
}

