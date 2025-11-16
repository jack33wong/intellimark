/**
 * Unified Marking Router
 * Handles single images, multiple images, and PDFs through a single endpoint
 */

import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { optionalAuth } from '../middleware/auth.js';
import type { ModelType } from '../types/index.js';
// import { runOriginalSingleImagePipeline } from './originalPipeline.js'; // Removed - using unified pipeline only
import PdfProcessingService from '../services/pdf/PdfProcessingService.js';
import sharp from 'sharp';
import { ImageUtils } from '../utils/ImageUtils.js';
import { sendSseUpdate, closeSseConnection, createProgressData } from '../utils/sseUtils.js';
import { createAIMessage, createUserMessage, handleAIMessageIdForEndpoint, calculateMessageProcessingStats, calculateSessionStats } from '../utils/messageUtils.js';
import { logPerformanceSummary, logCommonSteps, getSuggestedFollowUps } from '../services/marking/MarkingHelpers.js';
import { 
  generateSessionTitle, 
  sendProgressUpdate, 
  withPerformanceLogging, 
  withErrorHandling 
} from '../utils/markingRouterHelpers.js';
import { SessionManagementService } from '../services/sessionManagementService.js';
import type { MarkingSessionContext, QuestionSessionContext } from '../types/sessionManagement.js';
import * as stringSimilarity from 'string-similarity';
// Segmentation bypassed - using enhanced marking instruction with raw OCR and classification
// import { segmentOcrResultsByQuestion } from '../services/marking/SegmentationService.js';
// import { segmentOcrResultsByQuestion } from '../services/marking/AISegmentationService.js';
import { getBaseQuestionNumber, normalizeSubQuestionPart } from '../utils/TextNormalizationUtils.js';

// Helper functions for real model and API names
function getRealModelName(modelType: string): string {
  if (modelType === 'auto') {
    return 'gemini-2.5-flash'; // Default model for auto
  }
  return modelType; // Return the actual model name
}

function getRealApiName(modelName: string): string {
  if (modelName.includes('gemini')) {
    return 'Google Gemini API';
  }
  // Add other API mappings as needed
  return 'Unknown API';
}
import type { StandardizedPage, PageOcrResult, MathBlock } from '../types/markingRouter.js';
import type { MarkingTask } from '../services/marking/MarkingExecutor.js';
import { OCRService } from '../services/ocr/OCRService.js';
import { ClassificationService } from '../services/marking/ClassificationService.js';
import { MarkingInstructionService } from '../services/marking/MarkingInstructionService.js';
import { SVGOverlayService } from '../services/marking/svgOverlayService.js';
import { executeMarkingForQuestion, QuestionResult, EnrichedAnnotation } from '../services/marking/MarkingExecutor.js';
import { questionDetectionService } from '../services/marking/questionDetectionService.js';
import { ImageStorageService } from '../services/imageStorageService.js';
// import { getMarkingScheme } from '../services/marking/questionDetectionService.js';

// Placeholder function removed - schemes are now fetched in Question Detection stage

// Types are now imported from '../types/markingRouter.js'


// --- Helper Functions for Multi-Question Detection ---

/**
 * Extract questions from AI classification result
 * 
 * DESIGN: Support 1...N questions in classification response
 * - Classification AI extracts question text (no question numbers needed)
 * - Question Detection finds exam paper and marking schemes from database records
 * - Database records contain the actual question numbers (Q13, Q14, etc.)
 * - Classification returns array of questions with text only, NO numbers
 */
const extractQuestionsFromClassification = (
  classification: any, 
  fileName?: string
): Array<{text: string; questionNumber?: string | null}> => {
  // Handle hierarchical questions array structure
  if (classification?.questions && Array.isArray(classification.questions)) {
    const extractedQuestions: Array<{text: string; questionNumber?: string | null}> = [];
    
    for (const q of classification.questions) {
      const mainQuestionNumber = q.questionNumber !== undefined ? (q.questionNumber || null) : undefined;
      
      // If question has sub-questions, extract each sub-question separately
      if (q.subQuestions && Array.isArray(q.subQuestions) && q.subQuestions.length > 0) {
        for (const subQ of q.subQuestions) {
          const combinedQuestionNumber = mainQuestionNumber 
            ? `${mainQuestionNumber}${subQ.part || ''}` 
            : null;
          extractedQuestions.push({
            questionNumber: combinedQuestionNumber,
            text: subQ.text || ''
          });
        }
      } else {
        // Main question without sub-questions (or main text exists)
        if (q.text) {
          extractedQuestions.push({
            questionNumber: mainQuestionNumber,
            text: q.text
          });
        }
        // If main text is null but no sub-questions, skip (empty question)
      }
    }
    
    return extractedQuestions;
  }
  
  // Fallback: Handle old extractedQuestionText structure
  if (classification?.extractedQuestionText) {
    return [{
      text: classification.extractedQuestionText
      // No questionNumber in legacy format
    }];
  }
  
  return [];
};

/**
 * Extract question number from filename (e.g., "q19.png" -> "19")
 */
const extractQuestionNumberFromFilename = (fileName?: string): string[] | null => {
  if (!fileName) return null;
  
  // Extract question numbers from filename patterns like "q13-14", "q21", etc.
  const matches = fileName.toLowerCase().match(/q(\d+[a-z]?)/g);
  return matches ? matches.map(m => m.replace('q', '')) : null;
};


/**
 * Create marking tasks directly from classification results (bypasses segmentation)
 * This function creates tasks with raw OCR blocks and classification student work
 * for the enhanced marking instruction approach.
 */
// Helper function to format grouped student work with sub-question labels
function formatGroupedStudentWork(
  mainStudentWork: string | null,
  subQuestions: Array<{ part: string; studentWork: string; text?: string }>
): string {
  const parts: string[] = [];
  
  // Add main question student work if exists
  if (mainStudentWork && mainStudentWork !== 'null' && mainStudentWork.trim() !== '') {
    parts.push(`[MAIN QUESTION STUDENT WORK]\n${mainStudentWork.trim()}`);
  }
  
  // Add each sub-question with clear label
  subQuestions.forEach((subQ) => {
    if (subQ.studentWork && subQ.studentWork !== 'null' && subQ.studentWork.trim() !== '') {
      const subQLabel = `[SUB-QUESTION ${subQ.part.toUpperCase()} STUDENT WORK]`;
      parts.push(`${subQLabel}\n${subQ.studentWork.trim()}`);
    }
  });
  
  return parts.join('\n\n');
}

const createMarkingTasksFromClassification = (
  classificationResult: any,
  allPagesOcrData: PageOcrResult[],
  markingSchemesMap: Map<string, any>,
  pageDimensionsMap: Map<number, { width: number; height: number }>
): MarkingTask[] => {
  const tasks: MarkingTask[] = [];
  
  if (!classificationResult?.questions || !Array.isArray(classificationResult.questions)) {
    return tasks;
  }
  
  // Helper to get base question number (e.g., "17a" -> "17")
  const getBaseQuestionNumber = (qNum: string | null | undefined): string => {
    if (!qNum) return '';
    const match = String(qNum).match(/^(\d+)/);
    return match ? match[1] : String(qNum);
  };
  
  // Group questions by base question number
  const questionGroups = new Map<string, {
    mainQuestion: any;
    subQuestions: Array<{ part: string; studentWork: string; text?: string }>;
    markingScheme: any;
    baseQNum: string;
    sourceImageIndices: number[]; // Array of page indices (for multi-page questions)
  }>();
  
  // First pass: Collect all questions and sub-questions, group by base question number
  for (const q of classificationResult.questions) {
    const mainQuestionNumber = q.questionNumber || null;
    const baseQNum = getBaseQuestionNumber(mainQuestionNumber);
    
    // Use sourceImageIndices if available (from merged questions), otherwise use sourceImageIndex as array
    const sourceImageIndices = q.sourceImageIndices && Array.isArray(q.sourceImageIndices) && q.sourceImageIndices.length > 0
      ? q.sourceImageIndices
      : [q.sourceImageIndex ?? 0];
    
    if (!baseQNum) continue;
    
    // Find marking scheme (same for all sub-questions in a group)
    let markingScheme: any = null;
    for (const [key, scheme] of markingSchemesMap.entries()) {
      if (key.startsWith(`${baseQNum}_`)) {
        const keyQNum = key.split('_')[0];
        if (keyQNum === baseQNum) {
          markingScheme = scheme;
          break;
        }
      }
    }
    
    if (!markingScheme) continue;
    
    // Initialize group if not exists
    if (!questionGroups.has(baseQNum)) {
      questionGroups.set(baseQNum, {
        mainQuestion: q,
        subQuestions: [],
        markingScheme: markingScheme,
        baseQNum: baseQNum,
        sourceImageIndices: sourceImageIndices
      });
    } else {
      // If group exists, merge page indices (in case sub-questions are on different pages)
      const existingGroup = questionGroups.get(baseQNum)!;
      const mergedIndices = [...new Set([...existingGroup.sourceImageIndices, ...sourceImageIndices])].sort((a, b) => a - b);
      existingGroup.sourceImageIndices = mergedIndices;
    }
    
    const group = questionGroups.get(baseQNum)!;
    
    // Collect sub-questions
    if (q.subQuestions && Array.isArray(q.subQuestions)) {
      for (const subQ of q.subQuestions) {
        if (subQ.studentWork && subQ.studentWork !== 'null' && subQ.studentWork.trim() !== '') {
          group.subQuestions.push({
            part: subQ.part || '',
            studentWork: subQ.studentWork,
            text: subQ.text
          });
        }
      }
    }
  }
  
  // Second pass: Create one task per main question (with all sub-questions grouped)
  for (const [baseQNum, group] of questionGroups.entries()) {
    // Skip if no student work at all (neither main nor sub-questions)
    const hasMainWork = group.mainQuestion.studentWork && 
                        group.mainQuestion.studentWork !== 'null' && 
                        group.mainQuestion.studentWork.trim() !== '';
    const hasSubWork = group.subQuestions.length > 0;
    
    if (!hasMainWork && !hasSubWork) continue;
    
    // Get all OCR blocks from ALL pages this question spans (for multi-page questions like Q3a/Q3b)
    const allMathBlocks: MathBlock[] = [];
    group.sourceImageIndices.forEach((pageIndex) => {
      const pageOcrData = allPagesOcrData[pageIndex];
      if (pageOcrData?.ocrData?.mathBlocks) {
        pageOcrData.ocrData.mathBlocks.forEach((block: MathBlock, idx: number) => {
          // Ensure pageIndex is set on the block
          if (!(block as any).pageIndex) {
            (block as any).pageIndex = pageIndex;
          }
          // Assign global block ID if not present
          if (!(block as any).globalBlockId) {
            (block as any).globalBlockId = `block_${pageIndex}_${idx}`;
          }
          allMathBlocks.push(block);
        });
      }
    });
    
    // Format combined student work with sub-question labels
    const combinedStudentWork = formatGroupedStudentWork(
      hasMainWork ? group.mainQuestion.studentWork : null,
      group.subQuestions
    );
    
    // Extract sub-question numbers for metadata
    const subQuestionNumbers = group.subQuestions.map(sq => `${baseQNum}${sq.part}`);
    
    // Create task with grouped sub-questions
    tasks.push({
      questionNumber: baseQNum, // Use base question number (e.g., "22")
      mathBlocks: allMathBlocks,
      markingScheme: group.markingScheme,
      sourcePages: group.sourceImageIndices,
      classificationStudentWork: combinedStudentWork,
      pageDimensions: pageDimensionsMap,
      subQuestionMetadata: {
        hasSubQuestions: group.subQuestions.length > 0,
        subQuestions: group.subQuestions.map(sq => ({
          part: sq.part,
          text: sq.text
        })),
        subQuestionNumbers: subQuestionNumbers.length > 0 ? subQuestionNumbers : undefined
      }
    });
  }
  
  return tasks;
};

// ========================= START: REPLACED SEGMENTATION LOGIC =========================

/**
 * HELPER 0: Find question text boundaries using actual question text from classification
 * This finds where the question text ends and student work begins.
 */
const findQuestionTextBoundaries = (
  rawLines: Array<any & { pageIndex: number; globalIndex: number }>,
  classificationQuestions: Array<{ textPreview: string; sourceImageIndex: number }>
): Array<{ questionText: string; pageIndex: number; y: number; endIndex: number }> => {
    
    const boundaries: Array<{ questionText: string; pageIndex: number; y: number; endIndex: number }> = [];
    
    // For each classified question, find where its text ends in the OCR
    classificationQuestions.forEach(classifiedQ => {
        const pageIndex = classifiedQ.sourceImageIndex;
        const questionText = classifiedQ.textPreview;
        
        if (!questionText || pageIndex === undefined || pageIndex === null) return;
        
        // Get OCR lines for this page
        const pageLines = rawLines.filter(line => line.pageIndex === pageIndex);
        
        // Find the line that contains the end of the question text
        let questionEndLineIndex = -1;
        for (let i = 0; i < pageLines.length; i++) {
            const lineText = (pageLines[i].text?.trim() || '')
                .replace(/\\\(|\\\)|\\\[|\\\]/g, '') // Remove LaTeX delimiters
                .trim();
            
            if (!lineText) continue;
            
            // Check if this line contains the end of the question text
            // Use the last 30 characters of question text for matching
            const questionEndSnippet = questionText.substring(Math.max(0, questionText.length - 30));
            if (lineText.toLowerCase().includes(questionEndSnippet.toLowerCase())) {
                questionEndLineIndex = i;
                break;
            }
        }
        
        // If we found the question end, get its coordinates
        if (questionEndLineIndex >= 0) {
            const endLine = pageLines[questionEndLineIndex];
            const coords = OCRService.extractBoundingBox(endLine);
            if (coords) {
                console.log(`[DEBUG - SEGMENTATION] Found Question Text End: "${questionText.substring(0, 50)}..." on Page ${pageIndex}, Y: ${coords.y}`);
                boundaries.push({
                    questionText: questionText,
                    pageIndex: pageIndex,
                    y: coords.y,
                    endIndex: questionEndLineIndex
                });
            }
        } else {
            console.log(`[DEBUG - SEGMENTATION] Could not find question text end for Page ${pageIndex}: "${questionText.substring(0, 50)}..."`);
        }
    });
    
    return boundaries.sort((a, b) => { // Sort by page and vertical position
        if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
        return a.y - b.y;
    });
};

/**
 * HELPER 1: Find "Question Start" indicators (e.g., "Q13", "14.")
 * This is now a FALLBACK sub-routine for splitting blocks *on a single page*.
 */
const findQuestionIndicators = (
  rawLines: Array<any & { pageIndex: number; globalIndex: number }>
): Array<{ questionNumber: string; pageIndex: number; y: number }> => {
    
    const indicators: Array<{ questionNumber: string; pageIndex: number; y: number }> = [];
    // Regex: Optional "Question" or "Q", then digits, optional letter, optional dot/paren, followed by space.
    const questionRegex = /^(?:(question|q)\s*)?(\d+[a-z]?)[.)]?\s+/i;

    rawLines.forEach(line => {
        // Clean text of LaTeX delimiters that block the regex
        const text = (line.text?.trim() || '')
            .replace(/\\\(|\\\)|\\\[|\\\]/g, '') // Remove \(, \), \[, \]
            .trim(); // Trim again
        
        const match = text.match(questionRegex);
        
        if (match && text.length < 150) { // Avoid matching long paragraphs
            const questionNumber = match[2]; // Get the number (e.g., "13", "14")
            const coords = OCRService.extractBoundingBox(line); // Assumes OCRService.extractBoundingBox is static
            
            if (coords) {
                indicators.push({
                    questionNumber: questionNumber,
                    pageIndex: line.pageIndex,
                    y: coords.y
                });
            }
        }
    });
    return indicators.sort((a, b) => { // Sort indicators by page and vertical position
        if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
        return a.y - b.y;
    });
};

/**
 * HELPER 2A: Assigns a math block to the correct question using question text boundaries.
 */
const assignBlockToQuestionByTextBoundary = (
    block: MathBlock & { pageIndex: number },
    boundaries: Array<{ questionText: string; pageIndex: number; y: number; endIndex: number }>,
    questionNumber: string
): boolean => {
    // Find boundaries on the same page
    const pageBoundaries = boundaries.filter(boundary => boundary.pageIndex === block.pageIndex);
    
    // If block is below any question text boundary, it belongs to this question
    for (const boundary of pageBoundaries) {
        if ((block.coordinates?.y ?? 0) >= boundary.y) {
            console.log(`[DEBUG - SEGMENTATION] Block assigned to Q${questionNumber} (below question text end at Y: ${boundary.y})`);
            return true;
        }
    }
    
    return false;
};

/**
 * HELPER 2B: Assigns a math block to the correct question *on the same page* (FALLBACK).
 */
const assignBlockToQuestion = (
    block: MathBlock & { pageIndex: number },
    indicators: Array<{ questionNumber: string; pageIndex: number; y: number }>
): string | null => {
    let assignedQuestion: string | null = null;
    // Find the last indicator *on the same page* that appeared *before* this block
    const pageIndicators = indicators.filter(ind => ind.pageIndex === block.pageIndex);
    
    for (const indicator of pageIndicators) {
        if ((block.coordinates?.y ?? 0) >= indicator.y) {
            assignedQuestion = indicator.questionNumber;
        } else {
            break; // Block is before this indicator
        }
    }
    return assignedQuestion;
};

/**
 * HELPER 2C: Check if a block matches question text using fuzzy matching
 * Used to filter out question text blocks before passing to AI marking
 */
const isQuestionTextBlock = (
    block: MathBlock & { pageIndex: number },
    classificationQuestions: Array<{ 
        text?: string | null; 
        textPreview?: string; 
        subQuestions?: Array<{ text: string }>;
        sourceImageIndex: number;
    }>,
    similarityThreshold: number = 0.70
): boolean => {
    const blockText = block.mathpixLatex || block.googleVisionText || '';
    if (!blockText.trim()) return false;
    
    // Normalize text for comparison (same as findQuestionStartTextBoundaries)
    const normalizeText = (text: string): string => {
        return text
            .replace(/\\\(|\\\)|\\\[|\\\]/g, '') // Remove LaTeX delimiters
            .replace(/[()]/g, ' ') // Normalize parentheses to spaces
            .replace(/\s+/g, ' ') // Normalize whitespace
            .toLowerCase()
            .trim();
    };
    
    const normalizedBlockText = normalizeText(blockText);
    
    // Check against all questions on the same page
    const pageQuestions = classificationQuestions.filter(q => q.sourceImageIndex === block.pageIndex);
    
    for (const question of pageQuestions) {
        // Check main question text
        if (question.text) {
            const normalizedQuestionText = normalizeText(question.text);
            const similarity = stringSimilarity.compareTwoStrings(normalizedBlockText, normalizedQuestionText);
            if (similarity >= similarityThreshold) {
                console.log(`[QUESTION TEXT FILTER] Block "${blockText.substring(0, 50)}..." matches question text (similarity: ${similarity.toFixed(3)})`);
                return true;
            }
        }
        
        // Check textPreview (may be more accurate)
        if (question.textPreview) {
            const normalizedPreview = normalizeText(question.textPreview);
            const similarity = stringSimilarity.compareTwoStrings(normalizedBlockText, normalizedPreview);
            if (similarity >= similarityThreshold) {
                console.log(`[QUESTION TEXT FILTER] Block "${blockText.substring(0, 50)}..." matches question textPreview (similarity: ${similarity.toFixed(3)})`);
                return true;
            }
        }
        
        // Check sub-questions
        if (question.subQuestions && Array.isArray(question.subQuestions)) {
            for (const subQ of question.subQuestions) {
                if (subQ.text) {
                    const normalizedSubQText = normalizeText(subQ.text);
                    const similarity = stringSimilarity.compareTwoStrings(normalizedBlockText, normalizedSubQText);
                    if (similarity >= similarityThreshold) {
                        console.log(`[QUESTION TEXT FILTER] Block "${blockText.substring(0, 50)}..." matches sub-question text (similarity: ${similarity.toFixed(3)})`);
                        return true;
                    }
                }
            }
        }
    }
    
    return false;
};

/**
 * HELPER 3A: Find question start text boundaries using fuzzy matching
 * This is used as a fallback when question numbers are not found in text.
 */
const findQuestionStartTextBoundaries = (
  rawLines: Array<any & { pageIndex: number; globalIndex: number }>,
  classificationQuestions: Array<{ textPreview: string; sourceImageIndex: number }>
): Array<{ questionText: string; pageIndex: number; y: number; startIndex: number }> => {
    
    const boundaries: Array<{ questionText: string; pageIndex: number; y: number; startIndex: number }> = [];
    
    // For each classified question, find where its text starts in the OCR using fuzzy matching
    classificationQuestions.forEach(classifiedQ => {
        const pageIndex = classifiedQ.sourceImageIndex;
        const questionText = classifiedQ.textPreview; // Source: classification result textPreview field
        
        if (!questionText || pageIndex === undefined || pageIndex === null) return;
        
        // Get OCR lines for this page
        const pageLines = rawLines.filter(line => line.pageIndex === pageIndex);
        
        // Split question text into lines for fuzzy matching (EXACT implementation step)
        const questionLines = questionText.split('\n').map(l => l.trim()).filter(Boolean);
        if (questionLines.length === 0) return;
        
        // Dynamic threshold: lower for short questions (sub-questions like "b)")
        const baseThreshold = 0.75;
        const dynamicThreshold = questionText.length < 50 ? 0.60 : baseThreshold;
        let bestMatchIndex = -1;
        let bestMatchScore = 0;
        let bestOcrText = '';
        let bestSourceText = '';
        
        // Improved text normalization for better matching
        const normalizeText = (text: string): string => {
            return text
                .replace(/\\\(|\\\)|\\\[|\\\]/g, '') // Remove LaTeX delimiters
                .replace(/[()]/g, ' ') // Normalize parentheses to spaces
                .replace(/\s+/g, ' ') // Normalize whitespace
                .toLowerCase()
                .trim();
        };
        
        const normalizedQuestionLines = questionLines.map(normalizeText);
        
        // Find the best matching line using improved fuzzy matching
        for (let i = 0; i < pageLines.length; i++) {
            const lineText = normalizeText(pageLines[i].text?.trim() || '');
            
            if (!lineText) continue;
            
            // Try single-line matching first
            let bestMatch = stringSimilarity.findBestMatch(lineText, normalizedQuestionLines);
            
            // If single line fails, try multi-line matching (combine with next 1-2 lines)
            if (bestMatch.bestMatch.rating < dynamicThreshold && i + 2 < pageLines.length) {
                const multiLineText = normalizeText(
                    pageLines.slice(i, Math.min(i + 3, pageLines.length))
                        .map(l => l.text?.trim() || '')
                        .join(' ')
                );
                const multiMatch = stringSimilarity.findBestMatch(multiLineText, normalizedQuestionLines);
                if (multiMatch.bestMatch.rating > bestMatch.bestMatch.rating) {
                    bestMatch = multiMatch;
                }
            }
            
            if (bestMatch.bestMatch.rating > bestMatchScore) {
                // Track best match (whether above threshold or not)
                bestMatchScore = bestMatch.bestMatch.rating;
                const ocrText = pageLines[i].text?.trim() || '';
                const matchedClassLineIndex = normalizedQuestionLines.findIndex(l => l === bestMatch.bestMatch.target);
                const matchedClassLineOriginal = questionLines[matchedClassLineIndex >= 0 ? matchedClassLineIndex : 0] || '';
                
                if (bestMatch.bestMatch.rating >= dynamicThreshold) {
                    bestMatchIndex = i;
                    bestOcrText = ocrText;
                    bestSourceText = matchedClassLineOriginal;
                } else {
                    // Track best even if below threshold (for failed match logging)
                    if (!bestOcrText) {
                        bestOcrText = ocrText;
                        bestSourceText = matchedClassLineOriginal;
                    }
                }
            }
        }
        
        // Log the best match (only highest score, simplified format)
        if (bestMatchScore > 0) {
            const greenCode = '\x1b[32m'; // Green for source text
            const yellowCode = '\x1b[33m'; // Yellow for OCR text
            const resetCode = '\x1b[0m';
            
        if (bestMatchIndex >= 0) {
                // Successful match
                const sourcePreview = bestSourceText.substring(0, 100);
                const ocrPreview = bestOcrText.substring(0, 100);
                console.log(`[FUZZY MATCH] Page ${pageIndex}: ${greenCode}${sourcePreview}${sourcePreview.length < bestSourceText.length ? '...' : ''}${resetCode} vs ${yellowCode}${ocrPreview}${ocrPreview.length < bestOcrText.length ? '...' : ''}${resetCode} (score: ${bestMatchScore.toFixed(3)})`);
                
                // Get coordinates for successful match
            const startLine = pageLines[bestMatchIndex];
            const coords = OCRService.extractBoundingBox(startLine);
            if (coords) {
                boundaries.push({
                    questionText: questionText,
                    pageIndex: pageIndex,
                    y: coords.y,
                    startIndex: bestMatchIndex
                });
            }
        } else {
                // Failed match (below threshold)
                const sourcePreview = bestSourceText.substring(0, 100);
                const ocrPreview = bestOcrText.substring(0, 100);
                console.log(`[FUZZY MATCH] Page ${pageIndex} (FAILED): ${greenCode}${sourcePreview}${sourcePreview.length < bestSourceText.length ? '...' : ''}${resetCode} vs ${yellowCode}${ocrPreview}${ocrPreview.length < bestOcrText.length ? '...' : ''}${resetCode} (score: ${bestMatchScore.toFixed(3)}, threshold: ${dynamicThreshold})`);
            }
        }
    });
    
    return boundaries.sort((a, b) => { // Sort by page and vertical position
        if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
        return a.y - b.y;
    });
};

/**
 * HELPER 3B (FALLBACK ONLY): Find Boundary using Fuzzy Match
 * This is ONLY used if the AI Classification stage fails completely.
 */
const findBoundaryByFuzzyMatch = (
  ocrLines: Array<any>,
  questionText: string | undefined
): number => {
  console.log('🔧 [SEGMENTATION - FALLBACK BOUNDARY] Attempting fuzzy match boundary detection.');
  if (!questionText || questionText.trim().length === 0) return 0;
  const questionLines = questionText.split('\n').map(l => l.trim()).filter(Boolean);
  if (questionLines.length === 0) return 0;

  const SIMILARITY_THRESHOLD = 0.80;
  let lastMatchIndex = -1;

  for (let i = 0; i < ocrLines.length; i++) {
    const ocrLineText = (ocrLines[i]?.latex_styled || ocrLines[i]?.text || '').trim();
    if (!ocrLineText) continue;
    const bestMatch = stringSimilarity.findBestMatch(ocrLineText, questionLines);
    if (bestMatch.bestMatch.rating >= SIMILARITY_THRESHOLD) {
      lastMatchIndex = i;
    }
  }

  if (lastMatchIndex !== -1) {
    const boundaryIndex = lastMatchIndex + 1;
    console.log(`  -> [FALLBACK] Boundary set at global index ${boundaryIndex}.`);
    return boundaryIndex;
  } else {
    // Keyword Fallback (if fuzzy fails)
    const instructionKeywords = ['work out', 'calculate', 'explain', 'show that', 'find the', 'write down'];
    let lastInstructionIndex = -1;
    for (let i = ocrLines.length - 1; i >= 0; i--) {
      const text = (ocrLines[i]?.latex_styled || ocrLines[i]?.text || '').toLowerCase();
      if (text.split(/\s+/).length > 2 && !text.includes('=') && instructionKeywords.some(kw => text.includes(kw))) {
        lastInstructionIndex = i;
        break;
      }
    }
    if (lastInstructionIndex !== -1) {
      const boundaryIndex = lastInstructionIndex + 1;
      console.log(`  -> [FALLBACK] Keyword boundary set at global index ${boundaryIndex}.`);
      return boundaryIndex;
    }
  }
  
  console.warn('  -> [FALLBACK] No boundary found. Treating all as student work.');
  return 0;
};

// ========================== SEGMENTATION LOGIC MOVED TO SegmentationService ==========================

// --- Configure Multer ---
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit per file
    files: 50 // Maximum 50 files
  }
});



const router = express.Router();

// Helper function to convert multi-image stages to original progress format
// Define the steps for multi-image processing (matching original single image format)
const MULTI_IMAGE_STEPS = [
  'Input Validation',
  'Standardization', 
  'Preprocessing',
  'OCR & Classification',
  'Question Detection',
  'Segmentation',
  'Marking',
  'Output Generation'
];

// Helper function to persist session data to database (reused by both marking and question modes)
// Session management is now handled by SessionManagementService


// Helper functions are now imported from '../utils/markingRouterHelpers.js'

/**
 * POST /api/marking/process
 * 
 * Unified endpoint for processing single images, multiple images, and PDFs
 * Routes to appropriate pipeline based on input type detection
 */
router.post('/process', optionalAuth, upload.array('files'), async (req: Request, res: Response, next: NextFunction) => {
  // --- Basic Setup ---
  const submissionId = uuidv4(); // Generate a unique ID for this submission
  const startTime = Date.now();
  
  // Performance tracking variables (reuse original design)
  const stepTimings: { [key: string]: { start: number; duration?: number; subSteps?: { [key: string]: number } } } = {};
  let totalLLMTokens = 0;
  let totalMathpixCalls = 0;
  let actualModel = 'auto'; // Will be updated when model is determined
  
  // Performance tracking function (reuse original design)
  const logStep = (stepName: string, modelInfo: string) => {
    const stepKey = stepName.toLowerCase().replace(/\s+/g, '_');
    stepTimings[stepKey] = { start: Date.now() };
    
    return () => {
      if (stepTimings[stepKey]) {
        stepTimings[stepKey].duration = Date.now() - stepTimings[stepKey].start;
        console.log(`✅ [${stepName}] Completed in ${stepTimings[stepKey].duration}ms (${modelInfo})`);
      }
    };
  };
  
  console.log(`\n🔄 ========== UNIFIED PIPELINE START ==========`);
  console.log(`🔄 ============================================\n`);

  // --- SSE Setup ---
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });
  
  // Send initial message in the same format as original single image pipeline
  sendSseUpdate(res, createProgressData(0, 'Processing started', MULTI_IMAGE_STEPS));

  try {
    const files = req.files as Express.Multer.File[];
    // Determine authentication status early
    const userId = (req as any)?.user?.uid || null;
    const isAuthenticated = !!userId;

    // --- Input Validation ---
    if (!files || files.length === 0) {
      console.error(`[SUBMISSION ${submissionId}] No files uploaded.`);
      throw new Error('No files were uploaded.');
    }
    
    sendSseUpdate(res, createProgressData(0, `Received ${files.length} file(s). Validating...`, MULTI_IMAGE_STEPS));
    const logInputValidationComplete = logStep('Input Validation', 'validation');

    // --- Input Type Detection (Support Multiple PDFs) ---
    const firstMime = files[0]?.mimetype || 'unknown';
    const isPdf = files.length === 1 && firstMime === 'application/pdf';
    const isMultiplePdfs = files.length > 1 && files.every(f => f.mimetype === 'application/pdf');
    const isSingleImage = files.length === 1 && !isPdf && firstMime.startsWith('image/');
    const isMultipleImages = files.length > 1 && files.every(f => {
      const ok = f.mimetype?.startsWith('image/');
      if (!ok) console.warn(`[MIME CHECK] Non-image file detected in multi-upload: ${f.mimetype}`);
      return ok;
    });

    if (!isSingleImage && !isMultipleImages && !isPdf && !isMultiplePdfs) {
      // Handle invalid combinations (e.g., mixed types)
      console.error(`[SUBMISSION ${submissionId}] Invalid file combination received.`);
      throw new Error('Invalid file submission: Please upload PDFs, images, or a combination of the same type.');
    }
    
    const inputType = isPdf ? 'PDF' : isMultiplePdfs ? 'Multiple PDFs' : isMultipleImages ? 'Multiple Images' : 'Single Image';
    sendSseUpdate(res, createProgressData(0, `Input validated (${inputType}).`, MULTI_IMAGE_STEPS));
    logInputValidationComplete();

    // --- Declare variables at proper scope ---
    let standardizedPages: StandardizedPage[] = [];
    let allPagesOcrData: PageOcrResult[] = [];
    let markingTasks: MarkingTask[] = [];

    // --- Conditional Routing (PDF first) ---
    if (isPdf || isMultiplePdfs) {
      // --- Multi-File / PDF Path (This code only runs if NOT isSingleImage) ---
      sendSseUpdate(res, createProgressData(1, `Preparing ${inputType} processing...`, MULTI_IMAGE_STEPS));

      // Stage 1: Standardization
      if (isPdf) {
        // Single PDF processing
        sendSseUpdate(res, createProgressData(1, 'Converting PDF...', MULTI_IMAGE_STEPS));
        const pdfBuffer = files[0].buffer;
        const originalFileName = files[0].originalname || 'document.pdf';
        stepTimings['pdf_conversion'] = { start: Date.now() };
        standardizedPages = await PdfProcessingService.convertPdfToImages(pdfBuffer);
        // TEMP: Limit to first 10 pages to stabilize processing
        const MAX_PAGES_LIMIT = 10;
        if (standardizedPages.length > MAX_PAGES_LIMIT) {
          standardizedPages = standardizedPages.slice(0, MAX_PAGES_LIMIT);
        }
        // Set originalFileName for all pages (like we do for multiple PDFs)
        standardizedPages.forEach((page) => {
          page.originalFileName = originalFileName;
        });
        if (stepTimings['pdf_conversion']) {
          stepTimings['pdf_conversion'].duration = Date.now() - stepTimings['pdf_conversion'].start;
        }
        if (standardizedPages.length === 0) throw new Error('PDF conversion yielded no pages.');
        sendSseUpdate(res, createProgressData(1, `Converted PDF to ${standardizedPages.length} pages.`, MULTI_IMAGE_STEPS));
      } else if (isMultiplePdfs) {
        // Multiple PDFs processing - PARALLEL CONVERSION
        sendSseUpdate(res, createProgressData(1, `Converting ${files.length} PDFs in parallel...`, MULTI_IMAGE_STEPS));
        stepTimings['pdf_conversion'] = { start: Date.now() };
        
        // Convert all PDFs in parallel
        const pdfConversionPromises = files.map(async (file, index) => {
          try {
            const pdfPages = await PdfProcessingService.convertPdfToImages(file.buffer);
          if (pdfPages.length === 0) {
            console.warn(`PDF ${index + 1} (${file.originalname}) yielded no pages.`);
            return { index, pdfPages: [] };
          }
            
            // TEMP: Limit to first 10 pages per PDF
            const MAX_PAGES_LIMIT = 10;
            const limitedPages = pdfPages.slice(0, MAX_PAGES_LIMIT);
            
            // Store original index for sequential page numbering
            limitedPages.forEach((page, pageIndex) => {
              page.originalFileName = file.originalname || `pdf-${index + 1}.pdf`;
              (page as any)._sourceIndex = index; // Track source PDF for ordering
            });
            
            return { index, pdfPages: limitedPages };
          } catch (error) {
            console.error(`❌ Failed to convert PDF ${index + 1} (${file.originalname}):`, error);
            return { index, pdfPages: [] };
          }
        });
        
        const results = await Promise.all(pdfConversionPromises);
        
        // Combine results and maintain sequential page indices
        const allPdfPages: StandardizedPage[] = [];
        results.forEach((result: any) => {
          if (result && result.pdfPages && result.pdfPages.length > 0) {
            result.pdfPages.forEach((page: any) => {
              page.pageIndex = allPdfPages.length;
              allPdfPages.push(page);
            });
          }
        });
        
        if (stepTimings['pdf_conversion']) {
          stepTimings['pdf_conversion'].duration = Date.now() - stepTimings['pdf_conversion'].start;
        }
        
        standardizedPages = allPdfPages;
        if (standardizedPages.length === 0) throw new Error('All PDF conversions yielded no pages.');
        sendSseUpdate(res, createProgressData(1, `Converted ${files.length} PDFs to ${standardizedPages.length} total pages.`, MULTI_IMAGE_STEPS));
      }

      // Dimension extraction after conversion (reliable via sharp on buffers)
      sendSseUpdate(res, createProgressData(1, `Extracting dimensions for ${standardizedPages.length} converted page(s)...`, MULTI_IMAGE_STEPS));
      try {
        await Promise.all(standardizedPages.map(async (page, i) => {
          const base64Data = page.imageData.split(',')[1];
          if (!base64Data) {
            console.warn(`[DIMENSIONS - PDF Path] Invalid base64 data for page ${i}, skipping.`);
            page.width = 0; page.height = 0; return;
          }
          const imageBuffer = Buffer.from(base64Data, 'base64');
          const metadata = await sharp(imageBuffer).metadata();
          if (!metadata.width || !metadata.height) {
            console.warn(`[DIMENSIONS - PDF Path] Sharp failed to get valid dimensions for page ${i}.`);
          }
          page.width = metadata.width || 0;
          page.height = metadata.height || 0;
        }));
        sendSseUpdate(res, createProgressData(1, 'Dimension extraction complete.', MULTI_IMAGE_STEPS));
      } catch (dimensionError) {
        console.error('❌ Error during PDF dimension extraction:', dimensionError);
        throw new Error(`Failed during PDF dimension extraction: ${dimensionError instanceof Error ? dimensionError.message : 'Unknown error'}`);
      }

      // Handle PDF upload and context setup
      if (isPdf && !isMultiplePdfs) {
        // Single PDF (single-page or multi-page) - set pdfContext
        const pageCount = standardizedPages.length;
        sendSseUpdate(res, createProgressData(2, pageCount === 1 ? 'Processing as single converted page...' : 'Processing multi-page PDF...', MULTI_IMAGE_STEPS));
        
        // Upload original PDF to storage for authenticated users
        let originalPdfLink = null;
        let originalPdfDataUrl = null;
        
        if (isAuthenticated) {
          const originalFileName = files[0].originalname || 'document.pdf';
          try {
            const { ImageStorageService } = await import('../services/imageStorageService.js');
            const sessionId = req.body.sessionId || submissionId;
            originalPdfLink = await ImageStorageService.uploadPdf(
              `data:application/pdf;base64,${files[0].buffer.toString('base64')}`,
              userId || 'anonymous',
              sessionId,
              originalFileName
            );
          } catch (error) {
            const pdfSizeMB = (files[0].size / (1024 * 1024)).toFixed(2);
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`❌ [PDF UPLOAD] Failed to upload original PDF (${originalFileName}):`);
            console.error(`  - PDF size: ${pdfSizeMB}MB`);
            console.error(`  - Error: ${errorMessage}`);
            if (error instanceof Error && error.stack) {
              console.error(`  - Stack: ${error.stack}`);
            }
            throw new Error(`Failed to upload original PDF (${originalFileName}): ${errorMessage}`);
          }
        }
        
        // Calculate file size for single PDF
        const fileSizeBytes = files[0].buffer.length;
        const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);
        
        // Store PDF context for later use in the unified pipeline
        (req as any).pdfContext = {
          originalFileType: 'pdf' as const,
          originalPdfLink,
          originalPdfDataUrl,
          originalFileName: files[0].originalname || 'document.pdf',
          fileSize: fileSizeBytes,
          fileSizeMB: fileSizeMB + ' MB'
        };
      } else if (isMultiplePdfs) {
        // Multiple PDFs - store all PDFs for later use
        sendSseUpdate(res, createProgressData(2, 'Processing multiple PDFs...', MULTI_IMAGE_STEPS));
        
        const pdfContexts: any[] = [];
        
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          let originalPdfLink = null;
          let originalPdfDataUrl = null;
          
          // Always create base64 URL for immediate display
          originalPdfDataUrl = `data:application/pdf;base64,${file.buffer.toString('base64')}`;
          
          if (isAuthenticated) {
            const originalFileName = file.originalname || `document-${i + 1}.pdf`;
            try {
              const { ImageStorageService } = await import('../services/imageStorageService.js');
              const sessionId = req.body.sessionId || submissionId;
              originalPdfLink = await ImageStorageService.uploadPdf(
                `data:application/pdf;base64,${file.buffer.toString('base64')}`,
                userId || 'anonymous',
                sessionId,
                originalFileName
              );
            } catch (error) {
              const pdfSizeMB = (file.size / (1024 * 1024)).toFixed(2);
              const errorMessage = error instanceof Error ? error.message : String(error);
              console.error(`❌ [PDF UPLOAD] Failed to upload PDF ${i + 1} (${originalFileName}):`);
              console.error(`  - PDF size: ${pdfSizeMB}MB`);
              console.error(`  - Error: ${errorMessage}`);
              if (error instanceof Error && error.stack) {
                console.error(`  - Stack: ${error.stack}`);
              }
              throw new Error(`Failed to upload PDF ${i + 1} (${originalFileName}): ${errorMessage}`);
            }
          }
          
          // Calculate file size
          const fileSizeBytes = file.buffer.length;
          const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);
          
          const pdfContextItem = {
            originalFileType: 'pdf' as const,
            originalPdfLink,
            originalPdfDataUrl,
            originalFileName: file.originalname || `document-${i + 1}.pdf`,
            fileSize: fileSizeBytes, // Store as bytes (number) to match simplified structure
            fileSizeMB: fileSizeMB + ' MB', // Keep for display if needed
            fileIndex: i
          };
          
          
          
          pdfContexts.push(pdfContextItem);
        }
        
        // Store multiple PDF contexts for later use in the unified pipeline
        (req as any).pdfContext = {
          isMultiplePdfs: true,
          pdfContexts
        };
      }

      // Multi-page PDF or Multiple PDFs – Continue to common processing logic
      
      // One-line dimension logs per page
      standardizedPages.forEach((p: any) => {
        const ratio = p.height ? (p.width / p.height).toFixed(3) : '0.000';
      });

      // Fallback warning if any page still lacks dimensions
      standardizedPages.forEach((p: any, i: number) => {
        if (!p.width || !p.height) {
          console.warn(`[DIMENSIONS] Dimensions for page ${i} not set during standardization. Extraction needed (TODO).`);
          p.width = p.width || 0;
          p.height = p.height || 0;
        }
      });

    } else if (isSingleImage) {
      // ========================= START OF FIX =========================
      // --- Route Single Image to Unified Pipeline for Multi-Question Support ---
      sendSseUpdate(res, createProgressData(2, 'Processing as single image with multi-question detection...', MULTI_IMAGE_STEPS));

      // Convert single image to standardized format for unified pipeline
      const singleFileData = `data:${files[0].mimetype};base64,${files[0].buffer.toString('base64')}`;
      
      // Standardize the single image as if it were a multi-image input
      standardizedPages = [{
        pageIndex: 0,
        imageData: singleFileData,
        originalFileName: files[0].originalname || 'single-image.png'
      }];
      
      // Extract dimensions for the single image
      sendSseUpdate(res, createProgressData(2, 'Extracting image dimensions...', MULTI_IMAGE_STEPS));
      try {
        const base64Data = singleFileData.split(',')[1];
        if (base64Data) {
          const imageBuffer = Buffer.from(base64Data, 'base64');
          const metadata = await sharp(imageBuffer).metadata();
          if (metadata.width && metadata.height) {
            standardizedPages[0].width = metadata.width;
            standardizedPages[0].height = metadata.height;
          }
        }
      } catch (error) {
        console.warn(`[DIMENSIONS - Single Image] Failed to extract dimensions:`, error);
      }
      
      // Continue to unified pipeline processing (don't return here)
      // ========================== END OF FIX ==========================

    } else if (isMultipleImages) {
      // --- Multi-File / PDF Path (This code only runs if NOT isSingleImage) ---
      sendSseUpdate(res, createProgressData(1, `Preparing ${inputType} processing...`, MULTI_IMAGE_STEPS));

      // 1. Collect Images & Extract Dimensions in Parallel
      sendSseUpdate(res, createProgressData(1, `Extracting dimensions for ${files.length} images...`, MULTI_IMAGE_STEPS));
      standardizedPages = await Promise.all(files.map(async (file, index): Promise<StandardizedPage | null> => {
        if (!file.mimetype.startsWith('image/')) return null;
        try {
          const metadata = await sharp(file.buffer).metadata();
          if (!metadata.width || !metadata.height) return null;
          return {
            pageIndex: index,
            imageData: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
            originalFileName: file.originalname,
            width: metadata.width,
            height: metadata.height
          };
        } catch (imgDimError) { 
          console.warn(`[DIMENSIONS - MultiImg Path] Failed to extract dimensions for image ${index}:`, imgDimError);
          return null; 
        }
      }));
      standardizedPages = standardizedPages.filter((page): page is StandardizedPage => page !== null);
      sendSseUpdate(res, createProgressData(1, `Collected ${standardizedPages.length} image(s).`, MULTI_IMAGE_STEPS));

    } else {
      // This case should technically be caught by initial validation, but belt-and-suspenders.
      throw new Error("Unhandled submission type.");
    }

    // --- Guard against empty standardization ---
    if (standardizedPages.length === 0) {
      throw new Error('Standardization failed: No processable pages/images found.');
    }

    // --- Preprocessing (Common for Multi-Page PDF & Multi-Image) ---
    sendSseUpdate(res, createProgressData(2, `Preprocessing ${standardizedPages.length} image(s)...`, MULTI_IMAGE_STEPS));
    const logPreprocessingComplete = logStep('Preprocessing', 'image-processing');
    const preprocessedImageDatas = await Promise.all(
      standardizedPages.map(page => ImageUtils.preProcess(page.imageData))
    );
    standardizedPages.forEach((page, i) => page.imageData = preprocessedImageDatas[i]);
    sendSseUpdate(res, createProgressData(2, 'Image preprocessing complete.', MULTI_IMAGE_STEPS));
    logPreprocessingComplete();

    // ========================= START: IMPLEMENT STAGE 2 =========================
    // --- Stage 2: Parallel OCR/Classify (Common for Multi-Page PDF & Multi-Image) ---
    sendSseUpdate(res, createProgressData(3, `Running OCR & Classification on ${standardizedPages.length} pages...`, MULTI_IMAGE_STEPS));

    // --- Perform Classification on ALL Images (Question & Student Work) ---
    const logClassificationComplete = logStep('Classification', actualModel);
    
    
    // Classify ALL images at once for better cross-page context (solves continuation page question number detection)
    const allClassificationResults = await ClassificationService.classifyMultipleImages(
      standardizedPages.map((page, index) => ({
        imageData: page.imageData,
        fileName: page.originalFileName,
        pageIndex: index
      })),
      'auto',
      false
    );
    
    // Combine questions from all images
    // Merge questions with same questionNumber across pages (for multi-page questions like Q21)
    const questionsByNumber = new Map<string, Array<{ question: any; pageIndex: number }>>();
    const questionsWithoutNumber: Array<{ question: any; pageIndex: number }> = [];
    
    allClassificationResults.forEach(({ pageIndex, result }) => {
      if (result.questions && Array.isArray(result.questions)) {
        result.questions.forEach((question: any) => {
          const qNum = question.questionNumber;
          
          
          // Only merge if questionNumber exists and is not null/undefined
          if (qNum && qNum !== 'null' && qNum !== 'undefined') {
            const qNumStr = String(qNum);
            if (!questionsByNumber.has(qNumStr)) {
              questionsByNumber.set(qNumStr, []);
            }
            questionsByNumber.get(qNumStr)!.push({
              question,
              pageIndex
            });
          } else {
            // No question number - can't merge, keep as separate entry
            questionsWithoutNumber.push({
              question,
              pageIndex
            });
          }
        });
      }
    });
    
    
    // Fix orphaned questions (assign question numbers using AI)
    if (questionsWithoutNumber.length > 0) {
      console.log(`[FIX ORPHANED] Found ${questionsWithoutNumber.length} orphaned question(s), attempting to fix...`);
      
      // Prepare classified questions for context
      const classifiedQuestionsForContext: Array<{
        questionNumber: string;
        pageIndices: number[];
        text: string | null;
        subQuestions?: Array<{
          part: string;
          pageIndex: number;
          text?: string;
        }>;
      }> = [];
      
      questionsByNumber.forEach((questionInstances, questionNumber) => {
        const pageIndices = questionInstances.map(({ pageIndex }) => pageIndex);
        const firstQuestion = questionInstances[0].question;
        
        // Extract sub-questions with page indices
        const subQuestions = firstQuestion.subQuestions?.map((sq: any) => {
          // Find which page this sub-question came from
          const subQPageIndex = questionInstances.find(({ question }) => 
            question.subQuestions?.some((qsq: any) => qsq.part === sq.part)
          )?.pageIndex ?? pageIndices[0];
          
          return {
            part: sq.part,
            pageIndex: subQPageIndex,
            text: sq.text?.substring(0, 100) // First 100 chars for context
          };
        });
        
        classifiedQuestionsForContext.push({
          questionNumber,
          pageIndices,
          text: firstQuestion.text,
          subQuestions
        });
      });
      
      // Prepare orphaned questions
      const orphanedQuestionsForFix: Array<{
        pageIndex: number;
        text: string | null;
        subQuestions?: Array<{
          part: string;
          text: string;
        }>;
      }> = questionsWithoutNumber.map(({ question, pageIndex }) => ({
        pageIndex,
        text: question.text,
        subQuestions: question.subQuestions?.map((sq: any) => ({
          part: sq.part,
          text: sq.text || ''
        }))
      }));
      
      // Call AI to fix orphaned questions
      const assignments = await ClassificationService.fixOrphanedQuestionNumbers(
        classifiedQuestionsForContext,
        orphanedQuestionsForFix,
        standardizedPages.length,
        'auto'
      );
      
      // Apply assignments: move fixed questions from questionsWithoutNumber to questionsByNumber
      const fixedQuestions: Array<{ question: any; pageIndex: number; questionNumber: string }> = [];
      const remainingOrphans: Array<{ question: any; pageIndex: number }> = [];
      
      questionsWithoutNumber.forEach(({ question, pageIndex }, index) => {
        const assignedQNum = assignments.get(index);
        if (assignedQNum) {
          // Question was fixed - move to questionsByNumber
          fixedQuestions.push({ question, pageIndex, questionNumber: assignedQNum });
          question.questionNumber = assignedQNum; // Update the question object
        } else {
          // Question couldn't be fixed - keep as orphan
          remainingOrphans.push({ question, pageIndex });
        }
      });
      
      // Add fixed questions to questionsByNumber
      fixedQuestions.forEach(({ question, pageIndex, questionNumber }) => {
        if (!questionsByNumber.has(questionNumber)) {
          questionsByNumber.set(questionNumber, []);
        }
        questionsByNumber.get(questionNumber)!.push({ question, pageIndex });
      });
      
      // Update questionsWithoutNumber to only include unfixed orphans
      questionsWithoutNumber.length = 0;
      questionsWithoutNumber.push(...remainingOrphans);
      
      if (fixedQuestions.length > 0) {
        console.log(`[FIX ORPHANED] Successfully fixed ${fixedQuestions.length} orphaned question(s)`);
      }
      if (remainingOrphans.length > 0) {
        console.log(`[FIX ORPHANED] ${remainingOrphans.length} orphaned question(s) could not be fixed`);
      }
    }
    
    // Merge questions with same questionNumber
    const allQuestions: any[] = [];
    
    // Process merged questions
    questionsByNumber.forEach((questionInstances, questionNumber) => {
      
      if (questionInstances.length === 1) {
        // Single page - no merge needed
        const { question, pageIndex } = questionInstances[0];
        allQuestions.push({
          ...question,
          sourceImage: standardizedPages[pageIndex].originalFileName,
          sourceImageIndex: pageIndex
        });
      } else {
        // Multiple pages with same questionNumber - merge them
        // Find page with question text (not null/empty)
        const pageWithText = questionInstances.find(({ question }) => 
          question.text && question.text !== 'null' && question.text.trim().length > 0
        ) || questionInstances[0];
        
        // Combine student work from all pages
        const combinedStudentWork = questionInstances
          .map(({ question }) => question.studentWork)
          .filter(sw => sw && sw !== 'null' && sw.trim().length > 0)
          .join('\n');
        
        // Merge sub-questions if present (group by part, combine student work)
        // Also track which pages each sub-question came from
        const mergedSubQuestions = new Map<string, any>();
        const subQuestionPageIndices = new Set<number>(); // Track pages that have sub-questions
        
        questionInstances.forEach(({ question, pageIndex }) => {
          if (question.subQuestions && Array.isArray(question.subQuestions)) {
            question.subQuestions.forEach((subQ: any) => {
              const part = subQ.part || '';
              // Track that this page has sub-questions
              subQuestionPageIndices.add(pageIndex);
              
              if (!mergedSubQuestions.has(part)) {
                mergedSubQuestions.set(part, {
                  part: subQ.part,
                  text: subQ.text && subQ.text !== 'null' ? subQ.text : null,
                  studentWork: null,
                  confidence: subQ.confidence || 0.9
                });
              }
              // Combine student work for same sub-question part
              if (subQ.studentWork && subQ.studentWork !== 'null' && subQ.studentWork.trim().length > 0) {
                const existing = mergedSubQuestions.get(part)!;
                if (existing.studentWork) {
                  existing.studentWork += '\n' + subQ.studentWork;
                } else {
                  existing.studentWork = subQ.studentWork;
                }
              }
              // Use text from sub-question that has it
              if (subQ.text && subQ.text !== 'null' && !mergedSubQuestions.get(part)!.text) {
                mergedSubQuestions.get(part)!.text = subQ.text;
              }
            });
          }
        });
        
        // Collect all page indices for this merged question
        // Include both question instance pages AND pages that have sub-questions
        const questionInstancePageIndices = questionInstances.map(({ pageIndex }) => pageIndex);
        const allPageIndices = [...new Set([...questionInstancePageIndices, ...Array.from(subQuestionPageIndices)])].sort((a, b) => a - b);
        
        
        const merged = {
          ...pageWithText.question,
          questionNumber: questionNumber,
          // Use text from page that has it (not null/empty)
          text: pageWithText.question.text && pageWithText.question.text !== 'null' 
            ? pageWithText.question.text 
            : questionInstances[0].question.text,
          // Combine student work from all pages
          studentWork: combinedStudentWork || pageWithText.question.studentWork || null,
          // Use sourceImageIndex from page with text, or first page (for backward compatibility)
          sourceImage: standardizedPages[pageWithText.pageIndex].originalFileName,
          sourceImageIndex: pageWithText.pageIndex,
          // Store all page indices this question spans (for multi-page questions)
          sourceImageIndices: allPageIndices,
          // Merge sub-questions if present
          subQuestions: mergedSubQuestions.size > 0 
            ? Array.from(mergedSubQuestions.values())
            : pageWithText.question.subQuestions || [],
          // Use highest confidence
          confidence: Math.max(...questionInstances.map(({ question }) => question.confidence || 0.9))
        };
        
        
        allQuestions.push(merged);
      }
    });
    
    // Add questions without question number (can't be merged)
    questionsWithoutNumber.forEach(({ question, pageIndex }) => {
      allQuestions.push({
        ...question,
        sourceImage: standardizedPages[pageIndex].originalFileName,
        sourceImageIndex: pageIndex
      });
    });
    
    // Create combined classification result with enhanced mixed content detection
    const hasAnyStudentWork = allClassificationResults.some(result => result.result?.category === "questionAnswer");
    const hasMixedContent = allClassificationResults.some(result => result.result?.category !== allClassificationResults[0]?.result?.category);
    
    // Determine combined category
    const allCategories = allClassificationResults.map(r => r.result?.category).filter(Boolean);
    const combinedCategory: "questionOnly" | "questionAnswer" | "metadata" = 
      allCategories.every(cat => cat === "questionOnly") ? "questionOnly" :
      allCategories.every(cat => cat === "metadata") ? "metadata" :
      "questionAnswer";
    
    const classificationResult = {
      category: combinedCategory,
      reasoning: allClassificationResults[0]?.result?.reasoning || 'Multi-image classification',
      questions: allQuestions,
      extractedQuestionText: allQuestions.length > 0 ? allQuestions[0].text : allClassificationResults[0]?.result?.extractedQuestionText,
      apiUsed: allClassificationResults[0]?.result?.apiUsed || 'Unknown',
      usageTokens: allClassificationResults.reduce((sum, { result }) => sum + (result.usageTokens || 0), 0),
      hasMixedContent: hasMixedContent,
      hasAnyStudentWork: hasAnyStudentWork
    };
    
    // For question mode, use the questions array; for marking mode, use extractedQuestionText
    const globalQuestionText = classificationResult?.questions && classificationResult.questions.length > 0 
      ? classificationResult.questions[0].text 
      : classificationResult?.extractedQuestionText;
    
    
    logClassificationComplete();

    // ========================= MARK METADATA PAGES =========================
    // Mark front pages (metadata pages) that should skip OCR, question detection, and marking
    // but still appear in final output
    allClassificationResults.forEach(({ pageIndex, result }, index) => {
      // Metadata page: explicitly marked as metadata by AI classification
      const isMetadataPage = result.category === "metadata";
      
      if (isMetadataPage) {
        // Mark the page as metadata page
        (standardizedPages[index] as any).isMetadataPage = true;
        console.log(`📄 [METADATA] Page ${index + 1} (${standardizedPages[index].originalFileName}) marked as metadata page - will skip OCR/processing`);
      }
    });

    // ========================= ENHANCED MODE DETECTION =========================
    // Smart mode detection based on content analysis
    const isQuestionMode = classificationResult?.category === "questionOnly";
    const isMixedContent = classificationResult?.hasMixedContent === true;
    
    console.log(`🔍 [MODE DETECTION] Analysis:`);
    console.log(`  - All question-only: ${isQuestionMode}`);
    console.log(`  - Has mixed content: ${isMixedContent}`);
    console.log(`  - Has any student work: ${classificationResult?.hasAnyStudentWork}`);
    console.log(`  - Selected mode: ${isQuestionMode ? 'Question Mode' : 'Marking Mode'}`);
    
    if (isQuestionMode) {
      // ========================= ENHANCED QUESTION MODE =========================
      // Question mode: Handle multiple question-only images with detailed responses
      
      console.log(`📚 [QUESTION MODE] Processing ${standardizedPages.length} question-only image(s)`);
      
      // Step 1: Enhanced Question Detection for Multiple Questions
      sendSseUpdate(res, createProgressData(4, 'Detecting question types...', MULTI_IMAGE_STEPS));
      const logQuestionDetectionComplete = logStep('Question Detection', 'question-detection');
      
      // Extract individual questions from classification result
      const individualQuestions = extractQuestionsFromClassification(classificationResult, standardizedPages[0]?.originalFileName);
      
      // Detect each question individually to get proper exam data and marking schemes
      const allQuestionDetections = await Promise.all(
        individualQuestions.map(async (question, index) => {
          const detection = await questionDetectionService.detectQuestion(question.text, question.questionNumber);
          return {
            questionIndex: index,
            questionText: question.text,
            detection: detection,
            sourceImageIndex: classificationResult.questions[index]?.sourceImageIndex ?? index
          };
        })
      );
      
      // Group questions by exam paper (board + code + year + tier)
      const examPaperGroups = new Map<string, any>();
      
      allQuestionDetections.forEach(qd => {
        const examBoard = qd.detection.match?.board || '';
        const examCode = qd.detection.match?.paperCode || '';
        const year = qd.detection.match?.year || '';
        const tier = qd.detection.match?.tier || '';
        
        // Create unique key for exam paper grouping
        const examPaperKey = `${examBoard}_${examCode}_${year}_${tier}`;
        
        if (!examPaperGroups.has(examPaperKey)) {
          examPaperGroups.set(examPaperKey, {
            examBoard,
            examCode,
            year,
            tier,
            subject: qd.detection.match?.qualification || '',
            paperTitle: qd.detection.match ? `${qd.detection.match.board} ${qd.detection.match.qualification} ${qd.detection.match.paperCode} (${qd.detection.match.year})` : '',
            questions: [],
            totalMarks: 0
          });
        }
        
        const examPaper = examPaperGroups.get(examPaperKey);
        examPaper.questions.push({
          questionNumber: qd.detection.match?.questionNumber || '',
          questionText: qd.questionText,
          marks: qd.detection.match?.marks || 0,
          markingScheme: qd.detection.markingScheme || '',
          questionIndex: qd.questionIndex,
          sourceImageIndex: qd.sourceImageIndex
        });
        examPaper.totalMarks += qd.detection.match?.marks || 0;
      });
      
      // Convert to array and determine if multiple exam papers
      const examPapers = Array.from(examPaperGroups.values());
      const multipleExamPapers = examPapers.length > 1;
      
      // Create enhanced question detection result
      const questionDetection = {
        found: allQuestionDetections.some(qd => qd.detection.found),
        multipleExamPapers,
        examPapers,
        totalMarks: allQuestionDetections.reduce((sum, qd) => sum + (qd.detection.match?.marks || 0), 0),
        // Legacy fields for backward compatibility
        multipleQuestions: allQuestionDetections.length > 1,
        questions: allQuestionDetections.map(qd => ({
          questionNumber: qd.detection.match?.questionNumber || '',
          questionText: qd.questionText,
          marks: qd.detection.match?.marks || 0,
          markingScheme: qd.detection.markingScheme || '',
          questionIndex: qd.questionIndex,
          sourceImageIndex: qd.sourceImageIndex,
          examBoard: qd.detection.match?.board || '',
          examCode: qd.detection.match?.paperCode || '',
          paperTitle: qd.detection.match ? `${qd.detection.match.board} ${qd.detection.match.qualification} ${qd.detection.match.paperCode} (${qd.detection.match.year})` : '',
          subject: qd.detection.match?.qualification || '',
          tier: qd.detection.match?.tier || '',
          year: qd.detection.match?.year || ''
        }))
      };
      
      logQuestionDetectionComplete();
      
      // Step 2: Enhanced AI Response Generation for Multiple Questions
      sendSseUpdate(res, createProgressData(6, 'Generating responses...', MULTI_IMAGE_STEPS));
      const logAiResponseComplete = logStep('AI Response Generation', actualModel);
      const { MarkingServiceLocator } = await import('../services/marking/MarkingServiceLocator.js');
      
      // Generate AI responses for each question individually
      const aiResponses = await Promise.all(
        allQuestionDetections.map(async (qd, index) => {
          const imageData = standardizedPages[qd.sourceImageIndex]?.imageData || standardizedPages[0].imageData;
          const response = await MarkingServiceLocator.generateChatResponse(
            imageData,
            qd.questionText,
            actualModel as ModelType,
            "questionOnly", // category
            false // debug
          );
          return {
            questionIndex: index,
            questionNumber: qd.detection.match?.questionNumber || `Q${index + 1}`,
            response: response.response,
            apiUsed: response.apiUsed,
            usageTokens: response.usageTokens
          };
        })
      );
      
      // Debug logging for multi-question responses
      console.log(`🔍 [QUESTION MODE] Generated ${aiResponses.length} individual AI responses:`);
      aiResponses.forEach((ar, index) => {
        console.log(`  ${index + 1}. ${ar.questionNumber}: ${ar.response.substring(0, 100)}...`);
      });
      
      // Combine all responses into a single comprehensive response with clear separation
      const combinedResponse = aiResponses.map(ar => 
        `## ${ar.questionNumber}\n\n${ar.response}`
      ).join('\n\n' + '='.repeat(50) + '\n\n');
      
      const aiResponse = {
        response: combinedResponse,
        apiUsed: aiResponses[0]?.apiUsed || 'Unknown',
        usageTokens: aiResponses.reduce((sum, ar) => sum + (ar.usageTokens || 0), 0)
      };
      
      logAiResponseComplete();
      
      // Generate suggested follow-ups (same as marking mode)
      const suggestedFollowUps = await getSuggestedFollowUps();
      
      // Complete progress
      sendSseUpdate(res, createProgressData(7, 'Question analysis complete!', MULTI_IMAGE_STEPS));
      
      // Create AI message for question mode with real processing stats
      const realProcessingStats = calculateMessageProcessingStats(
        aiResponse,
        actualModel,
        Date.now() - startTime,
        [], // No annotations in question mode - no annotation means question mode
        standardizedPages[0].imageData.length,
        [] // No question results in question mode
      );

      // Transform question detection result to match frontend DetectedQuestion structure
      const transformedDetectedQuestion = questionDetection ? {
        found: questionDetection.found,
        multipleExamPapers: questionDetection.multipleExamPapers,
        multipleQuestions: questionDetection.multipleQuestions,
        totalMarks: questionDetection.totalMarks,
        examPapers: questionDetection.examPapers
      } : undefined;

      const aiMessage = createAIMessage({
        content: aiResponse.response,
        imageDataArray: undefined, // No annotation means question mode - no image data returned to frontend
        progressData: {
          currentStepDescription: 'Question analysis complete',
          allSteps: MULTI_IMAGE_STEPS,
          currentStepIndex: 7,
          isComplete: true
        },
        suggestedFollowUps: suggestedFollowUps,
        processingStats: realProcessingStats,
        detectedQuestion: transformedDetectedQuestion // FIXED: Include transformed detected question for exam paper tab display
      });
      
      // FIXED: Don't add image data to AI message for question mode
      // (aiMessage as any).imageData = standardizedPages[0].imageData;
      // (aiMessage as any).imageLink = null; // No image link for question mode
      
      // ========================= DATABASE PERSISTENCE FOR QUESTION MODE =========================
      let persistenceResult: any = null;
      let userMessage: any = null;
      try {
        // Upload original files for authenticated users
        const uploadResult = await SessionManagementService.uploadOriginalFiles(
          files,
          userId || 'anonymous',
          submissionId,
          !!userId
        );

        // Create structured data
        const { structuredImageDataArray } = SessionManagementService.createStructuredData(
          files,
          false, // isPdf
          false, // isMultiplePdfs
          undefined // pdfContext
        );

        // Create user message for question mode
        userMessage = SessionManagementService.createUserMessageForDatabase(
          {
            content: `I have uploaded 1 file(s) for analysis.`,
            files,
            isPdf: false,
            isMultiplePdfs: false,
            sessionId: req.body.sessionId || submissionId,
            model: req.body.model || 'auto'
          },
          structuredImageDataArray,
          undefined, // structuredPdfContexts
          uploadResult.originalImageLinks
        );
        
        // Override timestamp for database consistency (same as marking mode)
        const userTimestamp = new Date(Date.now() - 1000).toISOString(); // User message 1 second earlier
        const aiTimestamp = new Date().toISOString(); // AI message current time
        (userMessage as any).timestamp = userTimestamp;
        (aiMessage as any).timestamp = aiTimestamp;
        
        // Persist question session
        const questionContext: QuestionSessionContext = {
          req,
          submissionId,
          startTime,
          userMessage,
          aiMessage,
          questionDetection,
          globalQuestionText: globalQuestionText || '',
          mode: 'Question'
        };
        persistenceResult = await SessionManagementService.persistQuestionSession(questionContext);
        
        // Update the AI message with session data
        (aiMessage as any).sessionId = persistenceResult.sessionId;
        
      } catch (dbError) {
        console.error('❌ [QUESTION MODE] Database persistence failed:', dbError);
        // Continue with response even if database fails
      }
      
      // Create unifiedSession for unauthenticated users (same as marking mode)
      const isAuthenticated = !!(req as any)?.user?.uid;
      let unifiedSession = persistenceResult?.unifiedSession;
      
      if (!isAuthenticated && !unifiedSession) {
        // For unauthenticated users, create a temporary session structure
        unifiedSession = SessionManagementService.createUnauthenticatedSession(
          submissionId,
          userMessage,
          aiMessage,
          [], // No question results in question mode
          startTime,
          actualModel,
          files,
          'Question'
        );
      }
      
      // Send final result
      const finalResult = {
        success: true,
        message: aiMessage,
        sessionId: submissionId,
        mode: 'Question',
        unifiedSession: unifiedSession // Include unified session data for both user types
      };
      
      // Send final result with completion flag
      const finalProgressData = createProgressData(7, 'Complete!', MULTI_IMAGE_STEPS);
      finalProgressData.isComplete = true;
      sendSseUpdate(res, finalProgressData);
      
      // Send completion event in the format expected by frontend
      const completionEvent = {
        type: 'complete',
        result: finalResult
      };
      res.write(`data: ${JSON.stringify(completionEvent)}\n\n`);
      res.end();
      return;
    }

    // ========================= ENHANCED MARKING MODE =========================
    // Marking mode: Handle mixed content with both marking and question analysis
    
    if (isMixedContent) {
      console.log(`🔄 [MIXED CONTENT] Processing ${standardizedPages.length} images with mixed content`);
      console.log(`  - Student work images: ${standardizedPages.filter((_, i) => allClassificationResults[i]?.result?.category === "questionAnswer").length}`);
      console.log(`  - Question-only images: ${standardizedPages.filter((_, i) => allClassificationResults[i]?.result?.category === "questionOnly").length}`);
    }

    // --- Run OCR on each page in parallel (Marking Mode) ---
    const logOcrComplete = logStep('OCR Processing', 'mathpix');
    
    
    const pageProcessingPromises = standardizedPages.map(async (page, index): Promise<PageOcrResult> => {
      // Skip OCR for metadata pages (front pages with no questions/answers)
      if ((page as any).isMetadataPage) {
        console.log(`⏭️ [METADATA] Skipping OCR for metadata page: ${page.originalFileName}`);
        return {
          pageIndex: page.pageIndex,
          ocrData: {
            text: '',
            mathBlocks: [],
            rawResponse: { rawLineData: [] }
          },
          classificationText: globalQuestionText
        };
      }
      
      // Skip OCR for question-only images in mixed content scenarios
      // Check if this specific page was classified as question-only
      const pageClassification = allClassificationResults[index]?.result;
      const isQuestionOnly = pageClassification?.category === "questionOnly";
      
      if (isMixedContent && isQuestionOnly) {
        console.log(`⏭️ [MIXED CONTENT] Skipping OCR for question-only image: ${page.originalFileName}`);
        return {
          pageIndex: page.pageIndex,
          ocrData: {
            text: '',
            mathBlocks: [],
            rawResponse: { rawLineData: [] }
          },
          classificationText: globalQuestionText
        };
      }
      
      const ocrResult = await OCRService.processImage(
        page.imageData, {}, false, 'auto',
        { extractedQuestionText: globalQuestionText }
      );
      return {
        pageIndex: page.pageIndex,
        ocrData: ocrResult,
        classificationText: globalQuestionText // Pass down for segmentation
      };
    });

    allPagesOcrData = await Promise.all(pageProcessingPromises);
    logOcrComplete();
    sendSseUpdate(res, createProgressData(3, 'OCR & Classification complete.', MULTI_IMAGE_STEPS));
    // ========================== END: IMPLEMENT STAGE 2 ==========================

    // ========================= START: ADD QUESTION DETECTION STAGE =========================
    sendSseUpdate(res, createProgressData(4, 'Detecting questions and fetching schemes...', MULTI_IMAGE_STEPS));

    // Consolidate necessary data for Question Detection (e.g., all OCR text)
    const allOcrTextForDetection = allPagesOcrData.map(p => p.ocrData.text).join('\n\n--- Page Break ---\n\n');
    // Or pass structured blocks if needed by the service

    // Extract questions from AI classification result
    const individualQuestions = extractQuestionsFromClassification(classificationResult, standardizedPages[0]?.originalFileName);
    
    // Create a Map from the detection results
    const markingSchemesMap: Map<string, any> = new Map();
    
    // Helper function to check if a question number is a sub-question
    // Uses normalization to handle various formats: "2a", "2(i)", "12(ii)", etc.
    const isSubQuestion = (questionNumber: string | null | undefined): boolean => {
        if (!questionNumber) return false;
        const qNumStr = String(questionNumber);
        // Extract sub-question part: digits followed by optional sub-question part
        // Examples: "12(i)", "12i", "12(ii)", "12ii", "8a", "8(a)"
        const subQPartMatch = qNumStr.match(/^(\d+)(\(?[a-zivx]+\)?)?$/i);
        if (subQPartMatch && subQPartMatch[2]) {
            // Has sub-question part (normalized check ensures consistent detection)
            const normalizedPart = normalizeSubQuestionPart(subQPartMatch[2]);
            return normalizedPart.length > 0; // If normalization produces a non-empty string, it's a sub-question
        }
        return false;
    };
    
    // First pass: Collect all detection results
    const detectionResults: Array<{
        question: { text: string; questionNumber?: string | null };
        detectionResult: any;
    }> = [];
    
    // Call question detection for each individual question
    const logQuestionDetectionComplete = logStep('Question Detection', 'question-detection');
    for (const question of individualQuestions) {
        const detectionResult = await questionDetectionService.detectQuestion(question.text, question.questionNumber);
        
        if (detectionResult.found && detectionResult.match?.markingScheme) {
            detectionResults.push({ question, detectionResult });
        }
    }
    
    // Second pass: Group sub-questions by base question number and merge
    const groupedResults = new Map<string, Array<{
        question: { text: string; questionNumber?: string | null };
        detectionResult: any;
        actualQuestionNumber: string; // Database question number (e.g., "2")
        originalQuestionNumber: string | null | undefined; // Original classification question number (e.g., "2a", "2b")
        examBoard: string;
        paperCode: string;
    }>>();
    
    // Group detection results by base question number and exam paper
    for (const { question, detectionResult } of detectionResults) {
        const actualQuestionNumber = detectionResult.match.questionNumber; // Database question number (e.g., "2")
        const originalQuestionNumber = question.questionNumber; // Original classification question number (e.g., "2a", "2b")
            const examBoard = detectionResult.match.board || 'Unknown';
            const paperCode = detectionResult.match.paperCode || 'Unknown';
        
        // Create group key: base question number + exam board + paper code
        // Use original question number if available, otherwise use database question number
        const questionNumberForGrouping = originalQuestionNumber || actualQuestionNumber;
        const baseQuestionNumber = getBaseQuestionNumber(questionNumberForGrouping);
        const groupKey = `${baseQuestionNumber}_${examBoard}_${paperCode}`;
        
        if (!groupedResults.has(groupKey)) {
            groupedResults.set(groupKey, []);
        }
        
        groupedResults.get(groupKey)!.push({
            question,
            detectionResult,
            actualQuestionNumber, // Database question number (e.g., "2")
            originalQuestionNumber, // Original classification question number (e.g., "2a", "2b")
            examBoard,
            paperCode
        });
    }
    
    // Third pass: Merge grouped sub-questions or store single questions
    for (const [groupKey, group] of groupedResults.entries()) {
        const baseQuestionNumber = groupKey.split('_')[0];
        const examBoard = group[0].examBoard;
        const paperCode = group[0].paperCode;
        
        // Check if this group contains sub-questions
        // Use originalQuestionNumber (from classification) to detect sub-questions, not actualQuestionNumber (from database)
        const hasSubQuestions = group.some(item => isSubQuestion(item.originalQuestionNumber));
        
        if (hasSubQuestions && group.length > 1) {
            // Group sub-questions: merge marking schemes, combine texts, use parent question marks
            // Get parent question marks from the first item (all items have same parent question)
            // The parent question marks is stored in parentQuestionMarks field (added to detection result)
            const firstItem = group[0];
            const parentQuestionMarks = firstItem.detectionResult.match?.parentQuestionMarks;
            
            if (!parentQuestionMarks) {
                throw new Error(`Parent question marks not found for grouped sub-questions Q${baseQuestionNumber}. Expected structure: match.parentQuestionMarks`);
            }
            
            // Merge marking schemes
            const mergedMarks: any[] = [];
            const combinedQuestionTexts: string[] = [];
            const combinedDatabaseQuestionTexts: string[] = []; // Store database question texts
            const questionNumbers: string[] = [];
            const subQuestionAnswers: string[] = []; // Store answers for each sub-question (e.g., ["H", "F", "J"])
            // CRITICAL: Preserve sub-question-to-marks mapping to prevent mix-up (e.g., Q3a marks assigned to Q3b)
            const subQuestionMarksMap = new Map<string, any[]>(); // Map sub-question number to its marks array
            
            for (const item of group) {
                const displayQNum = item.originalQuestionNumber || item.actualQuestionNumber;
                
                // Extract answer for this sub-question (for letter-based answers like "H", "F", "J")
                // Check multiple possible locations where the answer might be stored
                const subQAnswer = item.detectionResult.match?.answer || 
                                  item.detectionResult.match?.markingScheme?.answer ||
                                  item.detectionResult.match?.markingScheme?.questionMarks?.answer ||
                                  undefined;
                if (subQAnswer && typeof subQAnswer === 'string' && subQAnswer.toLowerCase() !== 'cao') {
                    subQuestionAnswers.push(subQAnswer);
                } else {
                    // If no answer found, push empty string to maintain array alignment with marks
                    subQuestionAnswers.push('');
                }
                
                // More defensive extraction
                let marksArray: any[] = [];
                const markingScheme = item.detectionResult.match?.markingScheme;
                let questionMarks: any = null;
                
                if (markingScheme) {
                    questionMarks = markingScheme.questionMarks;
                    
                    if (questionMarks) {
                        // Try multiple extraction paths
                        if (Array.isArray(questionMarks.marks)) {
                            marksArray = questionMarks.marks;
                        } else if (Array.isArray(questionMarks)) {
                            marksArray = questionMarks;
                        } else if (questionMarks.marks && Array.isArray(questionMarks.marks)) {
                            marksArray = questionMarks.marks;
                        } else if (typeof questionMarks === 'object' && 'marks' in questionMarks) {
                            // Handle case where marks is a property but might be nested
                            const marksValue = questionMarks.marks;
                            if (Array.isArray(marksValue)) {
                                marksArray = marksValue;
                            } else if (marksValue && typeof marksValue === 'object' && Array.isArray(marksValue.marks)) {
                                marksArray = marksValue.marks;
                            }
                        }
                    }
                }
                if (marksArray.length === 0) {
                    console.warn(`[MERGE WARNING] No marks extracted for sub-question ${displayQNum} in group Q${baseQuestionNumber}`);
                }
                
                // CRITICAL: Preserve sub-question-to-marks mapping (don't flatten yet)
                subQuestionMarksMap.set(displayQNum, marksArray);
                // Still maintain mergedMarks for backward compatibility
                mergedMarks.push(...marksArray);
                combinedQuestionTexts.push(item.question.text); // Classification text (for backward compatibility)
                // Store database question text for filtering
                const dbQuestionText = item.detectionResult.match?.databaseQuestionText || '';
                if (dbQuestionText) {
                    combinedDatabaseQuestionTexts.push(dbQuestionText);
                }
                questionNumbers.push(displayQNum); // Use original question number for display
            }
            
            // Create merged marking scheme with sub-question marks mapping
            const mergedQuestionMarks = {
                marks: mergedMarks, // Keep for backward compatibility
                subQuestionMarks: Object.fromEntries(subQuestionMarksMap) // Preserve per-sub-question marks mapping
            };
            
            // Store questionDetection from first item for exam paper info (board, code, year, tier)
            // This is needed for exam tab display in the frontend
            // Note: We use the first item's detection result which has the correct exam paper match info
            const questionDetection = firstItem.detectionResult;
            
            const schemeWithTotalMarks = {
                questionMarks: mergedQuestionMarks,
                totalMarks: parentQuestionMarks, // Use parent question marks from database, not sum of sub-question marks
                questionNumber: baseQuestionNumber, // Use base question number for grouped sub-questions
                questionDetection: questionDetection, // Store detection result for exam paper info (needed for exam tab storage)
                questionText: combinedQuestionTexts.join('\n\n'), // Classification text (for backward compatibility)
                databaseQuestionText: combinedDatabaseQuestionTexts.join('\n\n'), // Database question text for filtering
                subQuestionNumbers: questionNumbers, // Store sub-question numbers for reference
                subQuestionAnswers: subQuestionAnswers.filter(a => a !== '').length > 0 ? subQuestionAnswers : undefined // Store answers for each sub-question (e.g., ["H", "F", "J"])
            };
            
            // Use base question number in unique key (e.g., "2_Pearson Edexcel_1MA1/1H" instead of "2a_...")
            const uniqueKey = `${baseQuestionNumber}_${examBoard}_${paperCode}`;
            markingSchemesMap.set(uniqueKey, schemeWithTotalMarks);
            
        } else {
            // Single question (not grouped): store as-is
            const item = group[0];
            const actualQuestionNumber = item.actualQuestionNumber;
            const uniqueKey = `${actualQuestionNumber}_${examBoard}_${paperCode}`;
            
            
            // Extract the specific question's marks from the marking scheme
            let questionSpecificMarks = null;
            
            if (item.detectionResult.match.markingScheme.questionMarks) {
                questionSpecificMarks = item.detectionResult.match.markingScheme.questionMarks;
            } else {
                questionSpecificMarks = item.detectionResult.match.markingScheme;
            }
            
            const schemeWithTotalMarks = {
                questionMarks: questionSpecificMarks,
                totalMarks: item.detectionResult.match.marks,
                questionNumber: actualQuestionNumber,
                questionDetection: item.detectionResult, // Store the full question detection result
                questionText: item.question.text, // Classification text (for backward compatibility)
                databaseQuestionText: item.detectionResult.match?.databaseQuestionText || '' // Database question text for filtering
            };
            
            markingSchemesMap.set(uniqueKey, schemeWithTotalMarks);
        }
    }
    
    logQuestionDetectionComplete();
    
    sendSseUpdate(res, createProgressData(4, `Detected ${markingSchemesMap.size} question scheme(s).`, MULTI_IMAGE_STEPS));
    // ========================== END: ADD QUESTION DETECTION STAGE ==========================

    // ========================= DRAWING CLASSIFICATION (POST-PROCESSING WITH MARKING SCHEME HINTS) =========================
    // For pages with [DRAWING] entries, run specialized high-accuracy drawing classification
    // NOW RUNS AFTER QUESTION DETECTION so we can pass marking scheme hints to maximize marks
    const logDrawingClassificationComplete = logStep('Drawing Classification', actualModel);
    const { DrawingEnhancementService } = await import('../services/marking/DrawingEnhancementService.js');
    
    await DrawingEnhancementService.enhanceDrawingsInClassification(
      allClassificationResults,
      standardizedPages,
      actualModel as ModelType,
      classificationResult,
      markingSchemesMap // Pass marking schemes for hints
    );
    logDrawingClassificationComplete();

    // ========================= START: IMPLEMENT STAGE 3 =========================
    // --- Stage 3: Create Marking Tasks Directly from Classification (Bypass Segmentation) ---
    sendSseUpdate(res, createProgressData(5, 'Preparing marking tasks...', MULTI_IMAGE_STEPS));
    const logSegmentationComplete = logStep('Segmentation', 'segmentation');

    // Create page dimensions map from standardizedPages for accurate drawing position calculation
    const pageDimensionsMap = new Map<number, { width: number; height: number }>();
    standardizedPages.forEach((page, index) => {
      if (page.width && page.height) {
        pageDimensionsMap.set(index, { width: page.width, height: page.height });
      }
    });

    // Create marking tasks directly from classification results (bypass segmentation)
    markingTasks = createMarkingTasksFromClassification(
      classificationResult,
      allPagesOcrData,
      markingSchemesMap,
      pageDimensionsMap
    );

    // Handle case where no student work is found
    if (markingTasks.length === 0) {
      sendSseUpdate(res, createProgressData(5, 'No student work found to mark.', MULTI_IMAGE_STEPS));
      const finalOutput = { 
        submissionId, 
        annotatedOutput: standardizedPages.map(p => p.imageData), // Return originals if no work
        outputFormat: isPdf ? 'pdf' : 'images' 
      };
      sendSseUpdate(res, { type: 'complete', result: finalOutput }, true);
      res.end();
      return; // Exit early
    }
    sendSseUpdate(res, createProgressData(5, `Prepared ${markingTasks.length} marking task(s).`, MULTI_IMAGE_STEPS));
    logSegmentationComplete();
    // ========================== END: IMPLEMENT STAGE 3 ==========================

    // ========================= START: VALIDATE SCHEMES =========================
    // --- Stage 3.5: Validate that schemes were attached during segmentation ---
    // Schemes are now attached during segmentation, so we just need to validate and filter
    const tasksWithSchemes: MarkingTask[] = markingTasks.filter(task => {
        if (!task.markingScheme) {
            console.warn(`[SEGMENTATION] ⚠️ Task for Q${task.questionNumber} has no marking scheme, skipping`);
            return false;
        }
        return true;
    });

    if (tasksWithSchemes.length === 0 && markingTasks.length > 0) {
         throw new Error("Failed to assign marking schemes to any detected question work.");
    }
    // ========================== END: VALIDATE SCHEMES ==========================

    // ========================= START: IMPLEMENT STAGE 4 =========================
    // --- Stage 4: Marking (Single or Parallel) ---
    sendSseUpdate(res, createProgressData(6, `Marking ${tasksWithSchemes.length} question(s)...`, MULTI_IMAGE_STEPS));
    const logMarkingComplete = logStep('Marking', 'ai-marking');

    // Call the refactored function for each task (works for 1 or many)
    const allQuestionResults: QuestionResult[] = await withPerformanceLogging(
      'AI Marking',
      actualModel,
      async () => {
        const markingPromises = tasksWithSchemes.map(task => // <-- Use tasksWithSchemes
          executeMarkingForQuestion(task, res, submissionId) // Pass res and submissionId
        );
        return Promise.all(markingPromises);
      }
    );
    sendSseUpdate(res, createProgressData(6, 'All questions marked.', MULTI_IMAGE_STEPS));
    logMarkingComplete();
    // ========================== END: IMPLEMENT STAGE 4 ==========================

    // ========================= START: IMPLEMENT STAGE 5 =========================
    // --- Stage 5: Aggregation & Output ---
    sendSseUpdate(res, createProgressData(7, 'Aggregating results and generating annotated images...', MULTI_IMAGE_STEPS));
    const logOutputGenerationComplete = logStep('Output Generation', 'output-generation');
    
    const logAnnotationComplete = logStep('Image Annotation', 'svg-overlay');

    // --- Annotation Grouping ---
    const annotationsByPage: { [pageIndex: number]: EnrichedAnnotation[] } = {};


    allQuestionResults.forEach((qr, questionIndex) => {
        const currentAnnotations = qr.annotations || []; // Ensure array exists

        currentAnnotations.forEach((anno, annoIndex) => {

            if (anno.pageIndex !== undefined && anno.pageIndex >= 0) {
                if (!annotationsByPage[anno.pageIndex]) {
                    annotationsByPage[anno.pageIndex] = [];
                }
                annotationsByPage[anno.pageIndex].push(anno);
            } else {
                console.warn(`[ANNOTATION] Skipping annotation missing valid pageIndex:`, anno);
            }
        });
    });


    // --- Calculate Overall Score and Per-Page Scores ---
    const overallScore = allQuestionResults.reduce((sum, qr) => sum + (qr.score?.awardedMarks || 0), 0);
    
    // For total marks: avoid double-counting sub-questions that share the same parent question
    // Group by base question number and only count total marks once per base question
    const baseQuestionToTotalMarks = new Map<string, number>();
    allQuestionResults.forEach((qr) => {
      const baseQNum = getBaseQuestionNumber(String(qr.questionNumber || ''));
      const totalMarks = qr.score?.totalMarks || 0;
      // Only set if not already set (first occurrence wins)
      // This ensures sub-questions (Q17a, Q17b) share the same total marks as their parent (Q17)
      if (!baseQuestionToTotalMarks.has(baseQNum)) {
        baseQuestionToTotalMarks.set(baseQNum, totalMarks);
      }
    });
    const totalPossibleScore = Array.from(baseQuestionToTotalMarks.values()).reduce((sum, marks) => sum + marks, 0);
    const overallScoreText = `${overallScore}/${totalPossibleScore}`;
    
    // Calculate per-page scores
    const pageScores: { [pageIndex: number]: { awarded: number; total: number; scoreText: string } } = {};
    allQuestionResults.forEach((qr) => {
      // Get pageIndex from annotations (they have pageIndex) or from the first annotation's pageIndex
      // If no annotations, use the first page that has blocks for this question
      let pageIndex: number | undefined;
      
      if (qr.annotations && qr.annotations.length > 0) {
        // Get the most common pageIndex from annotations (in case question spans multiple pages)
        const pageIndexCounts = new Map<number, number>();
        qr.annotations.forEach(anno => {
          if (anno.pageIndex !== undefined && anno.pageIndex >= 0) {
            pageIndexCounts.set(anno.pageIndex, (pageIndexCounts.get(anno.pageIndex) || 0) + 1);
          }
        });
        // Use the page with the most annotations
        if (pageIndexCounts.size > 0) {
          pageIndex = Array.from(pageIndexCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];
        }
      }
      
      // Fallback: try to match by question number from classificationResult
      if (pageIndex === undefined) {
        const matchingQuestion = classificationResult.questions.find((q: any) => {
          const qNum = String(q.questionNumber || '').replace(/[a-z]/i, '');
          const resultQNum = String(qr.questionNumber || '').split('_')[0].replace(/[a-z]/i, '');
          return qNum === resultQNum;
        });
        pageIndex = matchingQuestion?.sourceImageIndex ?? 0;
      }
      
      if (pageIndex === undefined) {
        pageIndex = 0; // Final fallback
      }
      
      if (!pageScores[pageIndex]) {
        pageScores[pageIndex] = { awarded: 0, total: 0, scoreText: '' };
      }
      
      pageScores[pageIndex].awarded += qr.score?.awardedMarks || 0;
      // Don't add totalMarks here - we'll calculate it after grouping by base question number
    });
    
    // Calculate total marks per page by grouping by base question number (avoid double-counting sub-questions)
    const pageBaseQuestionToTotalMarks = new Map<number, Map<string, number>>(); // pageIndex -> baseQNum -> totalMarks
    allQuestionResults.forEach((qr) => {
      let pageIndex: number | undefined;
      
      if (qr.annotations && qr.annotations.length > 0) {
        const pageIndexCounts = new Map<number, number>();
        qr.annotations.forEach(anno => {
          if (anno.pageIndex !== undefined && anno.pageIndex >= 0) {
            pageIndexCounts.set(anno.pageIndex, (pageIndexCounts.get(anno.pageIndex) || 0) + 1);
          }
        });
        if (pageIndexCounts.size > 0) {
          pageIndex = Array.from(pageIndexCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];
        }
      }
      
      if (pageIndex === undefined) {
        const matchingQuestion = classificationResult.questions.find((q: any) => {
          const qNum = String(q.questionNumber || '').replace(/[a-z]/i, '');
          const resultQNum = String(qr.questionNumber || '').split('_')[0].replace(/[a-z]/i, '');
          return qNum === resultQNum;
        });
        pageIndex = matchingQuestion?.sourceImageIndex ?? 0;
      }
      
      if (pageIndex === undefined) {
        pageIndex = 0;
      }
      
      if (!pageBaseQuestionToTotalMarks.has(pageIndex)) {
        pageBaseQuestionToTotalMarks.set(pageIndex, new Map<string, number>());
      }
      
      const baseQNum = getBaseQuestionNumber(String(qr.questionNumber || ''));
      const pageBaseQMap = pageBaseQuestionToTotalMarks.get(pageIndex)!;
      if (!pageBaseQMap.has(baseQNum)) {
        pageBaseQMap.set(baseQNum, qr.score?.totalMarks || 0);
      }
    });
    
    // Set total marks per page from grouped data
    pageBaseQuestionToTotalMarks.forEach((baseQMap, pageIndex) => {
      const pageTotal = Array.from(baseQMap.values()).reduce((sum, marks) => sum + marks, 0);
      if (pageScores[pageIndex]) {
        pageScores[pageIndex].total = pageTotal;
      }
    });
    
    // Generate score text for each page
    Object.keys(pageScores).forEach(pageIndex => {
      const pageScore = pageScores[parseInt(pageIndex)];
      pageScore.scoreText = `${pageScore.awarded}/${pageScore.total}`;
    });

    // --- Parallel Annotation Drawing using SVGOverlayService ---
    sendSseUpdate(res, createProgressData(7, `Drawing annotations on ${standardizedPages.length} pages...`, MULTI_IMAGE_STEPS));
    const annotationPromises = standardizedPages.map(async (page) => {
        const pageIndex = page.pageIndex;
        const annotationsForThisPage = annotationsByPage[pageIndex] || [];
        const imageDimensions = { width: page.width, height: page.height };
        // Draw per-page score on each page
        const pageScore = pageScores[pageIndex];
        const scoreToDraw = pageScore ? { 
          scoreText: pageScore.scoreText 
        } : undefined;

        // Log exactly what's being sent to the drawing service

        // Only call service if there's something to draw
        if (annotationsForThisPage.length > 0 || scoreToDraw) {
            try {
                return await SVGOverlayService.burnSVGOverlayServerSide(
                    page.imageData,
                    annotationsForThisPage,
                    imageDimensions,
                    scoreToDraw
                );
            } catch (drawError) {
                console.error(`❌ [ANNOTATION] Failed to draw annotations on page ${pageIndex}:`, drawError);
                return page.imageData; // Fallback
            }
        }
        return page.imageData; // Return original if nothing to draw
    });
    const annotatedImagesBase64: string[] = await Promise.all(annotationPromises);
    sendSseUpdate(res, createProgressData(7, 'Annotation drawing complete.', MULTI_IMAGE_STEPS));

        // --- Upload Annotated Images to Storage (for authenticated users) ---
        let annotatedImageLinks: string[] = [];
        
        if (isAuthenticated) {
            // Upload annotated images to storage for authenticated users
            const uploadPromises = annotatedImagesBase64.map(async (imageData, index) => {
                    // FIXED: Pass original filename for proper annotated filename generation
                    const originalFileName = files[index]?.originalname || `image-${index + 1}.png`;
                try {
                    const imageLink = await ImageStorageService.uploadImage(
                        imageData,
                        userId,
                        `multi-${submissionId}`,
                        'annotated',
                        originalFileName
                    );
                    return imageLink;
                } catch (uploadError) {
                    const imageSizeMB = (imageData.length / (1024 * 1024)).toFixed(2);
                    const errorMessage = uploadError instanceof Error ? uploadError.message : String(uploadError);
                    console.error(`❌ [ANNOTATION] Failed to upload annotated image ${index} (${originalFileName}):`);
                    console.error(`  - Image size: ${imageSizeMB}MB`);
                    console.error(`  - Error: ${errorMessage}`);
                    if (uploadError instanceof Error && uploadError.stack) {
                        console.error(`  - Stack: ${uploadError.stack}`);
                    }
                    throw new Error(`Failed to upload annotated image ${index} (${originalFileName}): ${errorMessage}`);
                }
            });
            annotatedImageLinks = await Promise.all(uploadPromises);
        }

        // --- Construct Final Output (Always Images) ---
        const outputFormat: 'images' = 'images'; // Explicitly set to images
        const finalAnnotatedOutput: string[] = isAuthenticated ? annotatedImageLinks : annotatedImagesBase64;
        logAnnotationComplete();

        // Add PDF context if available
        const pdfContext = (req as any)?.pdfContext;
        
        // finalOutput will be constructed after database persistence

    // ========================= START: DATABASE PERSISTENCE =========================
    // --- Database Persistence (Using SessionManagementService) ---
    let dbUserMessage: any = null; // Declare outside try-catch for scope
    let dbAiMessage: any = null; // Declare outside try-catch for scope
    let persistenceResult: any = null; // Declare outside try-catch for scope
    let unifiedSession: any = null; // Declare outside try-catch for scope
    try {
      // Extract request data
      const userId = (req as any)?.user?.uid || 'anonymous';
      const isAuthenticated = !!(req as any)?.user?.uid;
      const sessionId = req.body.sessionId || `temp-${Date.now()}`;
      const currentSessionId = sessionId.startsWith('temp-') ? `session-${Date.now()}` : sessionId;
      const customText = req.body.customText;
      const model = req.body.model || 'auto';
      
      // Resolve actual model if 'auto' is specified
      if (model === 'auto') {
        const { getDefaultModel } = await import('../config/aiModels.js');
        actualModel = getDefaultModel();
      } else {
        actualModel = model;
      }
      
      // Generate timestamps for database consistency
      const userTimestamp = new Date(Date.now() - 1000).toISOString(); // User message 1 second earlier
      const aiTimestamp = new Date().toISOString(); // AI message current time
      
      // Upload original files for authenticated users
      const uploadResult = await SessionManagementService.uploadOriginalFiles(
        files,
        userId,
        submissionId,
        isAuthenticated
      );
      
      // Create structured data (only for authenticated users - unauthenticated users don't need database persistence)
      let structuredImageDataArray: any[] | undefined = undefined;
      let structuredPdfContexts: any[] | undefined = undefined;
      
      if (isAuthenticated) {
        const structuredData = SessionManagementService.createStructuredData(
          files,
          isPdf,
          isMultiplePdfs,
          pdfContext,
          isAuthenticated // Pass authentication status for diagnostic logging
        );
        structuredImageDataArray = structuredData.structuredImageDataArray;
        structuredPdfContexts = structuredData.structuredPdfContexts;
        
        // Update pdfContext with structured data for frontend
        if (pdfContext && structuredPdfContexts) {
          pdfContext.pdfContexts = structuredPdfContexts;
        }
      }

      // Create user message for database
      const messageContent = customText || (isPdf ? 'I have uploaded a PDF for analysis.' : `I have uploaded ${files.length} file(s) for analysis.`);
      
      dbUserMessage = SessionManagementService.createUserMessageForDatabase(
        {
          content: messageContent,
          files,
          isPdf,
          isMultiplePdfs,
          customText,
          sessionId: currentSessionId,
          model,
          pdfContext
        },
        structuredImageDataArray,
        structuredPdfContexts,
        uploadResult.originalImageLinks
      );
      
      // Override timestamp for database consistency
      (dbUserMessage as any).timestamp = userTimestamp;
      
      // ========================= MIXED CONTENT: QUESTION ANALYSIS =========================
      let questionOnlyResponses: string[] = [];
      
      if (isMixedContent) {
        console.log(`🔍 [MIXED CONTENT] Generating AI responses for question-only images...`);
        
        // Find question-only images and generate AI responses for them
        const questionOnlyImages = standardizedPages.filter((page, index) => 
          allClassificationResults[index]?.result?.category === "questionOnly"
        );
        
        if (questionOnlyImages.length > 0) {
          const { MarkingServiceLocator } = await import('../services/marking/MarkingServiceLocator.js');
          
          questionOnlyResponses = await Promise.all(
            questionOnlyImages.map(async (page, index) => {
              const originalIndex = standardizedPages.indexOf(page);
              const questionText = allClassificationResults[originalIndex]?.result?.extractedQuestionText || 
                                 classificationResult.questions[originalIndex]?.text || '';
              
              const response = await MarkingServiceLocator.generateChatResponse(
                page.imageData,
                questionText,
                actualModel as ModelType,
                "questionOnly", // category
                false // debug
              );
              
              return `## Question Analysis (${page.originalFileName})\n\n${response.response}`;
            })
          );
          
          console.log(`✅ [MIXED CONTENT] Generated ${questionOnlyResponses.length} question-only responses`);
        }
      }

      // Create AI message for database
      const resolvedAIMessageId = handleAIMessageIdForEndpoint(req.body, null, 'marking');
      
      dbAiMessage = SessionManagementService.createAIMessageForDatabase({
        allQuestionResults,
        finalAnnotatedOutput,
        files,
        actualModel,
        startTime,
        markingSchemesMap,
        globalQuestionText,
        resolvedAIMessageId,
        questionOnlyResponses: isMixedContent ? questionOnlyResponses : undefined
      });
      
      // Add suggested follow-ups
      (dbAiMessage as any).suggestedFollowUps = await getSuggestedFollowUps();
      
      // Override timestamp for database consistency
      (dbAiMessage as any).timestamp = aiTimestamp;
      
      // Debug logging for markingSchemesMap
      for (const [key, value] of markingSchemesMap.entries()) {
      }
      
      // Persist marking session
      const markingContext: MarkingSessionContext = {
        req,
        submissionId,
        startTime,
        userMessage: dbUserMessage,
        aiMessage: dbAiMessage,
        questionDetection: null,
        globalQuestionText: globalQuestionText || '',
        mode: 'Marking',
        allQuestionResults,
        markingSchemesMap,
        files,
        model: actualModel,
        usageTokens: 0
      };
      stepTimings['database_persistence'] = { start: Date.now() };
      persistenceResult = await SessionManagementService.persistMarkingSession(markingContext);
      if (stepTimings['database_persistence']) {
        stepTimings['database_persistence'].duration = Date.now() - stepTimings['database_persistence'].start;
      }
      
      // For authenticated users, use the unifiedSession from persistence
      if (isAuthenticated) {
        unifiedSession = persistenceResult.unifiedSession;
      }
      
    } catch (error) {
      console.error(`❌ [SUBMISSION ${submissionId}] Failed to persist to database:`, error);
      if (error instanceof Error) {
        console.error(`❌ [SUBMISSION ${submissionId}] Error name: ${error.name}`);
        console.error(`❌ [SUBMISSION ${submissionId}] Error message: ${error.message}`);
        console.error(`❌ [SUBMISSION ${submissionId}] Error stack:`, error.stack);
      }
      // Re-throw the real error instead of hiding it
      throw error;
    }
    
    // For unauthenticated users, create unifiedSession even if database persistence failed
    if (!isAuthenticated && !unifiedSession) {
      // Validate required data before creating session
      if (!dbUserMessage || !dbAiMessage) {
        throw new Error(`Cannot create unauthenticated session: missing required data. dbUserMessage: ${!!dbUserMessage}, dbAiMessage: ${!!dbAiMessage}`);
      }
      unifiedSession = SessionManagementService.createUnauthenticatedSession(
        submissionId,
        dbUserMessage,
        dbAiMessage,
        allQuestionResults,
        startTime,
        actualModel,
        files,
        'Marking'
      );
      
      // Debug logging for unauthenticated users
      console.log('  - id:', unifiedSession.id);
      console.log('  - title:', unifiedSession.title);
      console.log('  - messages count:', unifiedSession.messages?.length);
      console.log('  - userId:', unifiedSession.userId);
      console.log('  - markingSchemesMap sample:', Array.from(markingSchemesMap.entries())[0]);
    }
    
    // ========================== END: DATABASE PERSISTENCE ==========================


      // Construct unified finalOutput that works for both authenticated and unauthenticated users
      const finalOutput = {
        success: true, // Add success flag for frontend compatibility
        submissionId: submissionId,
        // Calculate message-specific processing stats (not session-level totals)
        processingStats: {
          apiUsed: getRealApiName(getRealModelName(actualModel)),
          modelUsed: getRealModelName(actualModel),
          totalMarks: totalPossibleScore, // Use the grouped total marks calculation
          awardedMarks: allQuestionResults.reduce((sum, q) => sum + (q.score?.awardedMarks || 0), 0),
          questionCount: allQuestionResults.length
        },
        annotatedOutput: finalAnnotatedOutput,
        outputFormat: outputFormat,
        originalInputType: isPdf ? 'pdf' : 'images',
        // Always include unifiedSession for consistent frontend handling
        unifiedSession: unifiedSession,
        // Add PDF context for frontend display
        ...(pdfContext && {
            originalFileType: pdfContext.originalFileType,
            originalPdfLink: pdfContext.originalPdfLink,
            originalPdfDataUrl: pdfContext.originalPdfDataUrl,
            originalFileName: pdfContext.originalFileName,
            // Include pdfContexts for multiple PDFs
            ...(pdfContext.pdfContexts && {
              pdfContexts: pdfContext.pdfContexts
            })
        })
      };
      
      
      // --- Send FINAL Complete Event ---
      sendSseUpdate(res, { type: 'complete', result: finalOutput }, true); // 'true' marks as final
      logOutputGenerationComplete();
      
      // --- Performance Summary (reuse original design) ---
      const totalProcessingTime = Date.now() - startTime;
      logPerformanceSummary(stepTimings, totalProcessingTime, actualModel, 'unified');
      
      console.log(`\n🏁 ========== UNIFIED PIPELINE END ==========`);
      console.log(`🏁 ==========================================\n`);
    // ========================== END: IMPLEMENT STAGE 5 ==========================

  } catch (error) {
    console.error(`❌ [SUBMISSION ${submissionId}] Processing failed:`, error);
    console.log(`\n💥 ========== UNIFIED PIPELINE FAILED ==========`);
    console.log(`💥 =============================================\n`);
    
    // Provide user-friendly error messages based on error type
    let userFriendlyMessage = 'An unexpected error occurred. Please try again.';
    
    if (error instanceof Error) {
      // Handle multer file size errors
      if (error.message.includes('File too large') || error.message.includes('LIMIT_FILE_SIZE')) {
        userFriendlyMessage = 'File too large. Maximum file size is 50MB per file. Please compress your images or use smaller files.';
      } else if (error.message.includes('too large') || error.message.includes('max:')) {
        // Handle ImageStorageService file size errors (includes file size in message)
        userFriendlyMessage = error.message.includes('max:') 
          ? error.message // Use the detailed message that includes size info
          : 'File too large. Maximum file size is 50MB per file. Please compress your images or use smaller files.';
      } else if (error.message.includes('quota exceeded') || error.message.includes('429')) {
        userFriendlyMessage = 'API quota exceeded. Please try again later or contact support if this persists.';
      } else if (error.message.includes('timeout')) {
        userFriendlyMessage = 'Request timed out. The image might be too complex or the service is busy. Please try again.';
      } else if (error.message.includes('authentication') || error.message.includes('401') || error.message.includes('403')) {
        userFriendlyMessage = 'Authentication error. Please refresh the page and try again.';
      } else if (error.message.includes('network') || error.message.includes('connection')) {
        userFriendlyMessage = 'Network error. Please check your connection and try again.';
      } else if (error.message.includes('Invalid file submission')) {
        userFriendlyMessage = error.message; // Use the specific validation error message
      }
    }
    
    // Ensure SSE message indicates error before closing
    sendSseUpdate(res, createProgressData(0, `Error: ${userFriendlyMessage}`, MULTI_IMAGE_STEPS, true));
    
    // Ensure the connection is always closed on error
    if (!res.writableEnded) {
      res.end();
    }
  } finally {
    // --- Ensure Connection Closure (Only if not already closed) ---
    if (!res.writableEnded) {
      closeSseConnection(res);
    } else {
    }
  }
});

/**
 * GET /marking/download-image
 * Download image by proxying the request to avoid CORS issues
 * (Preserved from original markingApi.ts)
 */
router.get('/download-image', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { url, filename } = req.query;
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ 
        success: false, 
        error: 'Image URL is required' 
      });
    }

    // Fetch the image from the external URL
    const response = await fetch(url);
    
    if (!response.ok) {
      return res.status(404).json({ 
        success: false, 
        error: 'Image not found' 
      });
    }

    // Get the image data
    const imageBuffer = await response.arrayBuffer();
    
    // Determine content type from URL or response headers
    let contentType = response.headers.get('content-type');
    const filenameStr = Array.isArray(filename) ? filename[0] : filename;
    
    if (!contentType) {
      // Fallback: determine content type from URL or filename
      const urlLower = typeof url === 'string' ? url.toLowerCase() : '';
      const filenameLower = (typeof filenameStr === 'string' ? filenameStr : '').toLowerCase();
      
      if (urlLower.includes('.png') || filenameLower.includes('.png')) {
        contentType = 'image/png';
      } else if (urlLower.includes('.webp') || filenameLower.includes('.webp')) {
        contentType = 'image/webp';
      } else if (urlLower.includes('.gif') || filenameLower.includes('.gif')) {
        contentType = 'image/gif';
      } else if (urlLower.includes('.jpg') || urlLower.includes('.jpeg') || 
                 filenameLower.includes('.jpg') || filenameLower.includes('.jpeg')) {
        contentType = 'image/jpeg';
      } else {
        contentType = 'image/jpeg'; // Default fallback
      }
    }
    
    // Set headers for download
    const downloadFilename = filenameStr && typeof filenameStr === 'string' ? filenameStr : 'image';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.setHeader('Content-Length', imageBuffer.byteLength);
    
    // Send the image data
    res.send(Buffer.from(imageBuffer));
    
  } catch (error) {
    console.error('Error downloading image:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to download image' 
    });
  }
});

export default router;

