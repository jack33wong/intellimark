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
      
      // Extract base question number (e.g., "8" from "8", "8a" from "8a")
      const baseQNum = qNum.replace(/[a-z]/i, '');
      
      // Match main question number
      if (mainQNum === baseQNum || mainQNum === qNum) {
        return true;
      }
      return false;
    });
    
    if (!classificationQ) continue;
    
    // Try to match against main question student work
    let studentWorkToMatch: string | null = null;
    if (classificationQ.studentWork) {
      studentWorkToMatch = classificationQ.studentWork;
    }
    
    // If no main student work, try sub-question student work
    if (!studentWorkToMatch && classificationQ.subQuestions && Array.isArray(classificationQ.subQuestions)) {
      // Extract question number part (e.g., "8" from "8", "8a" from "8a")
      const qNum = qInfo.questionNumber;
      const subQPart = qNum.match(/^(\d+)([a-z])?$/i);
      if (subQPart && subQPart[2]) {
        // Has sub-question part
        const subQ = classificationQ.subQuestions.find((sq: any) => sq.part?.toLowerCase() === subQPart[2].toLowerCase());
        if (subQ?.studentWork) {
          studentWorkToMatch = subQ.studentWork;
        }
      }
    }
    
    if (!studentWorkToMatch) continue;
    
    // Split multi-line student work into individual lines for better matching
    // Classification may return student work as a single string with newlines (e.g., "line1\nline2\nline3")
    // OCR extracts these as separate blocks, so we need to match each block against individual lines
    const studentWorkLines = studentWorkToMatch.split(/\n/).map(line => line.trim()).filter(line => line.length > 0);
    
    // Calculate similarity against each line and take the best match
    const normalizedBlock = normalizeTextForComparison(blockText);
    if (!normalizedBlock) continue;
    
    let bestLineSimilarity = 0;
    let bestLineMatch = false;
    
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
        bestLineMatch = finalSimilarity >= 0.60; // Match threshold
      }
    }
    
    // Also check against the full string (for cases where OCR combined multiple lines)
    const normalizedStudentWork = normalizeTextForComparison(studentWorkToMatch);
    if (normalizedStudentWork) {
      const fullStringSimilarity = stringSimilarity.compareTwoStrings(normalizedBlock, normalizedStudentWork);
      const blockContainsFullWork = normalizedBlock.includes(normalizedStudentWork) || 
                                     normalizedStudentWork.includes(normalizedBlock) ||
                                     (normalizedBlock.length > 10 && normalizedStudentWork.length > 10 &&
                                      (normalizedBlock.includes(normalizedStudentWork.substring(0, Math.min(30, normalizedStudentWork.length))) ||
                                       normalizedStudentWork.includes(normalizedBlock.substring(0, Math.min(30, normalizedBlock.length)))));
      const fullStringFinalSimilarity = blockContainsFullWork ? Math.max(fullStringSimilarity, 0.70) : fullStringSimilarity;
      
      if (fullStringFinalSimilarity > bestLineSimilarity) {
        bestLineSimilarity = fullStringFinalSimilarity;
        bestLineMatch = fullStringFinalSimilarity >= 0.60;
      }
    }
    
    if (bestLineMatch && bestLineSimilarity > bestSimilarity) {
      bestSimilarity = bestLineSimilarity;
      bestMatch = { questionNumber: qInfo.questionNumber, schemeKey: qInfo.schemeKey, similarity: bestLineSimilarity };
    }
  }
  
  // Only return if similarity is above threshold
  const threshold = 0.60; // Lower threshold for block-to-question matching
  return bestSimilarity >= threshold ? bestMatch : null;
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
  
  // PRIORITY CHECK: If block matches classification student work, don't filter it
  // This prevents filtering actual student work that classification identified
  for (const question of classificationQuestions) {
    if (question.sourceImageIndex !== block.pageIndex) continue;
    
  // Check main question student work
  if (question.studentWork) {
    if (matchesClassificationStudentWork(block, question.studentWork)) {
      // Don't log - too verbose for normal operation
      return false; // Don't filter - it's confirmed student work from classification
    }
  }
  
  // Check sub-question student work
  if (question.subQuestions && Array.isArray(question.subQuestions)) {
    for (const subQ of question.subQuestions) {
      if (subQ.studentWork) {
        if (matchesClassificationStudentWork(block, subQ.studentWork)) {
          // Don't log - too verbose for normal operation
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
        if (similarity >= similarityThreshold) {
          bestMatch = true;
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
            
            if (isMatch) {
              bestMatch = true;
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
      return false; // Don't filter - it's student work
    } else if (isSubstringOfAnyQuestion) {
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
  classificationQuestions: Array<{ questionNumber?: string | null; sourceImageIndex?: number; text?: string | null }>,
  detectedSchemesMap: Map<string, any>
): Map<string, string> {
  const questionToSchemeMap = new Map<string, string>();
  const allSchemeKeys = Array.from(detectedSchemesMap.keys());
  
  for (const question of classificationQuestions) {
    if (!question.questionNumber) continue;
    
    const aiDetectedQNum = String(question.questionNumber);
    
    // Check if this is a numeric question number (past paper) or text key (non-past paper)
    const isNumericKey = /^\d+[a-z]?$/i.test(aiDetectedQNum);
    
    if (isNumericKey) {
      // Past paper: match by question number
      const baseQNum = getBaseQuestionNumber(aiDetectedQNum);
      
      // Find matching scheme key
      const matchingSchemeKey = allSchemeKeys.find(schemeKey => {
        const schemeQNum = schemeKey.split('_')[0];
        const baseSchemeQNum = getBaseQuestionNumber(schemeQNum);
        return baseSchemeQNum === baseQNum;
      });
      
      if (matchingSchemeKey) {
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
  
  allPagesOcrData.forEach((pageResult) => {
    const mathBlocks = pageResult.ocrData?.mathBlocks || [];
    
    
    mathBlocks.forEach((block) => {
      allMathBlocks.push({
        ...block,
        pageIndex: pageResult.pageIndex,
        globalBlockId: `block_${blockCounter++}`
      });
    });
  });
  
  
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
    let mainQuestionNumber = q.questionNumber;
    const pageIndex = (q as any).sourceImageIndex ?? 0;
    
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
  // Fix: Handle multiple questions per page and multi-page sub-questions
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
    
    // For each unique scheme key, assign blocks
    // If multiple questions share the same scheme key (grouped sub-questions), assign all blocks to that scheme
    for (const [schemeKey, schemeQuestions] of questionsByScheme.entries()) {
    
    // Step 1: First pass - filter out question text blocks using text matching
    const questionTextBlocks: Array<MathBlock & { pageIndex: number }> = [];
    
    // If multiple different schemes, match blocks to questions first
    let blocksToAssign: Array<MathBlock & { pageIndex: number }> = [];
    if (hasMultipleDifferentSchemes) {
      // Match each block to the best question
      for (const block of blocksOnPage) {
        const blockId = (block as any).globalBlockId || `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
        if (assignedBlocksInPage.has(blockId)) continue; // Already assigned to another question
        
        // Skip question text blocks
        if (isQuestionTextBlock(block, originalQuestionsForFiltering)) {
          questionTextBlocks.push(block);
          continue;
        }
        
        // Try to match this block to a question
        const match = matchBlockToQuestion(block, questionsOnPage, classificationResult);
        if (match && match.schemeKey === schemeKey) {
          // This block belongs to this question
          blocksToAssign.push(block);
          assignedBlocksInPage.add(blockId);
          const blockText = (block.mathpixLatex || block.googleVisionText || '').substring(0, 40);
          console.log(`[SEGMENTATION] Matched block "${blockText}..." to Q${match.questionNumber} (similarity: ${match.similarity.toFixed(3)})`);
        }
      }
    } else {
      // Single scheme or grouped sub-questions - use all blocks (after filtering question text)
      blocksToAssign = blocksOnPage.filter(block => {
        if (isQuestionTextBlock(block, originalQuestionsForFiltering)) {
          questionTextBlocks.push(block);
          return false;
        }
        return true;
      });
    }
    
    const initiallyFilteredBlocks = blocksToAssign;
    
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
              return false; // Filter it out
            }
          }
        }
      }
      return true; // Keep the block
    });
    
    
      if (filteredBlocks.length > 0) {
        if (!blocksByQuestion.has(schemeKey)) {
          blocksByQuestion.set(schemeKey, []);
        }
        blocksByQuestion.get(schemeKey)!.push(...filteredBlocks);
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
    const schemeKey = questionToSchemeMap.get(q.questionNumber);
    if (!schemeKey) continue;
    
    // Check if this question's page has unassigned blocks
    const pageBlocks = blocksByPage.get(q.sourceImageIndex) || [];
    if (pageBlocks.length === 0) continue;
    
    // Check if blocks from this page are already assigned to this scheme
    const existingBlocks = blocksByQuestion.get(schemeKey) || [];
    const existingPages = new Set(existingBlocks.map(b => b.pageIndex));
    if (existingPages.has(q.sourceImageIndex)) continue; // Already has blocks from this page
    
    // Filter out already-assigned blocks (to other schemes) and question text
    const unassignedBlocks = pageBlocks.filter(block => {
      const blockId = (block as any).globalBlockId || `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
      if (assignedBlockIds.has(blockId)) return false; // Already assigned to another question
      if (isQuestionTextBlock(block, originalQuestionsForFiltering)) return false;
      return true;
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
  
  // 8. Create marking tasks
  const tasks: MarkingTask[] = [];
  for (const [schemeKey, blocks] of blocksByQuestion.entries()) {
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
    
    // Attach marking scheme directly from detectedSchemesMap
    const markingScheme = detectedSchemesMap.get(schemeKey);
    if (!markingScheme) {
      console.warn(`[SEGMENTATION] ⚠️ No marking scheme found for ${schemeKey}, task will be skipped later`);
    }
    
    tasks.push({
      questionNumber: schemeKey,
      mathBlocks: blocks,
      markingScheme: markingScheme || null, // Attach scheme directly during segmentation
      sourcePages
    });
    
    console.log(`[SEGMENTATION] Created task for ${schemeKey}: ${blocks.length} blocks from pages [${sourcePages.join(', ')}]`);
  }
  
  console.log(`[SEGMENTATION] ✅ Created ${tasks.length} marking task(s)`);
  return tasks;
}

