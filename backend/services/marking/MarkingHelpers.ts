/**
 * Helper functions for Marking
 * Contains utility functions for progress tracking, question detection, performance logging, and session management
 */

import { questionDetectionService } from './questionDetectionService.js';
import { createAutoProgressTracker } from '../../utils/autoProgressTracker.js';
import { getStepsForMode } from '../../utils/progressTracker.js';
import { getDebugMode } from '../../config/aiModels.js';
import { formatMarkingSchemeAsBullets } from '../../config/prompts.js';
import type { QuestionResult } from './MarkingExecutor.js';
import { getBaseQuestionNumber } from '../../utils/TextNormalizationUtils.js';

// Debug mode helper function
export async function simulateApiDelay(operation: string, debug: boolean = false): Promise<void> {
  if (debug) {
    const debugMode = getDebugMode();
    await new Promise(resolve => setTimeout(resolve, debugMode.fakeDelayMs));
  }
}

// Simple step logging helper
export function createStepLogger(totalSteps: number, startStep: number = 0) {
  let currentStep = startStep;

  return {
    logStep: (stepName: string, modelInfo: string) => {
      currentStep++;
      const startTime = Date.now();

      return () => {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const progress = `[${currentStep}/${totalSteps}]`;
        const paddedName = stepName.padEnd(25);
        const durationStr = `[${duration}s]`;
        const modelStr = `[${modelInfo}]`;
        const green = '\x1b[32m';
        const reset = '\x1b[0m';
        console.log(`${progress} ${green}${paddedName}${reset} ${durationStr} ${green}${modelStr}${reset}`);
      };
    }
  };
}

// Common function to convert full subject names to short forms
export function getShortSubjectName(qualification: string): string {
  const subjectMap: { [key: string]: string } = {
    'MATHEMATICS': 'MATHS',
    'PHYSICS': 'PHYSICS',
    'CHEMISTRY': 'CHEMISTRY',
    'BIOLOGY': 'BIOLOGY',
    'ENGLISH': 'ENGLISH',
    'ENGLISH LITERATURE': 'ENG LIT',
    'HISTORY': 'HISTORY',
    'GEOGRAPHY': 'GEOGRAPHY',
    'FRENCH': 'FRENCH',
    'SPANISH': 'SPANISH',
    'GERMAN': 'GERMAN',
    'COMPUTER SCIENCE': 'COMP SCI',
    'ECONOMICS': 'ECONOMICS',
    'PSYCHOLOGY': 'PSYCHOLOGY',
    'SOCIOLOGY': 'SOCIOLOGY',
    'BUSINESS STUDIES': 'BUSINESS',
    'ART': 'ART',
    'DESIGN AND TECHNOLOGY': 'D&T',
    'MUSIC': 'MUSIC',
    'PHYSICAL EDUCATION': 'PE',
    // Handle reverse mappings for short forms that might be in database
    'CHEM': 'CHEMISTRY',
    'PHYS': 'PHYSICS'
  };

  const upperQualification = qualification.toUpperCase();
  return subjectMap[upperQualification] || qualification;
}

// Common function to generate session titles for non-past-paper images
export function generateNonPastPaperTitle(extractedQuestionText: string | undefined, mode: 'Question' | 'Marking'): string {
  if (extractedQuestionText && extractedQuestionText.trim()) {
    const questionText = extractedQuestionText.trim();

    // Handle cases where extraction failed
    if (questionText.toLowerCase().includes('unable to extract') ||
      questionText.toLowerCase().includes('no text detected') ||
      questionText.toLowerCase().includes('extraction failed')) {
      return `${mode} - ${new Date().toLocaleDateString()}`;
    }

    // Use the truncated question text directly - much simpler and more reliable
    const truncatedText = questionText.length > 30
      ? questionText.substring(0, 30) + '...'
      : questionText;
    const result = `${mode} - ${truncatedText}`;
    return result;
  } else {
    // Fallback when no question text is extracted
    const result = `${mode} - ${new Date().toLocaleDateString()}`;
    return result;
  }
}

// Helper function to setup progress tracker for question mode
export function setupQuestionModeProgressTracker(onProgress?: (data: any) => void) {
  const progressTracker = createAutoProgressTracker(getStepsForMode('question'), (data) => {
    if (onProgress) onProgress(data);
  });

  // Register steps for auto-progress tracking
  progressTracker.registerStep('analyzing_image', {
    stepId: 'analyzing_image',
    stepName: 'Analyzing Image',
    stepDescription: 'Analyzing image structure and content...'
  });

  progressTracker.registerStep('classifying_image', {
    stepId: 'classifying_image',
    stepName: 'Classifying Image',
    stepDescription: 'Determining image type and mode...'
  });

  progressTracker.registerStep('processing_ocr', {
    stepId: 'processing_ocr',
    stepName: 'OCR Processing',
    stepDescription: 'Extracting text from image...'
  });

  progressTracker.registerStep('generating_response', {
    stepId: 'generating_response',
    stepName: 'Generating Response',
    stepDescription: 'Generating AI response...'
  });

  return progressTracker;
}

// Helper function to setup progress tracker for marking mode
export function setupMarkingModeProgressTracker(onProgress?: (data: any) => void) {
  const markingProgressTracker = createAutoProgressTracker(getStepsForMode('marking'), (data) => {
    if (onProgress) onProgress(data);
  });

  // Register marking mode steps
  markingProgressTracker.registerStep('analyzing_image', {
    stepId: 'analyzing_image',
    stepName: 'Analyzing Image',
    stepDescription: 'Analyzing image structure and content...'
  });

  markingProgressTracker.registerStep('classifying_image', {
    stepId: 'classifying_image',
    stepName: 'Classifying Image',
    stepDescription: 'Determining image type and mode...'
  });

  markingProgressTracker.registerStep('detecting_question', {
    stepId: 'detecting_question',
    stepName: 'Detecting Question',
    stepDescription: 'Identifying question structure...'
  });

  markingProgressTracker.registerStep('extracting_text', {
    stepId: 'extracting_text',
    stepName: 'Extracting Text',
    stepDescription: 'Extracting text and math expressions...'
  });

  markingProgressTracker.registerStep('generating_feedback', {
    stepId: 'generating_feedback',
    stepName: 'Generating Feedback',
    stepDescription: 'Creating marking instructions...'
  });

  markingProgressTracker.registerStep('creating_annotations', {
    stepId: 'creating_annotations',
    stepName: 'Creating Annotations',
    stepDescription: 'Generating visual annotations...'
  });

  markingProgressTracker.registerStep('generating_response', {
    stepId: 'generating_response',
    stepName: 'Generating Response',
    stepDescription: 'Generating final AI response...'
  });

  return markingProgressTracker;
}

// Helper function to perform question detection
export async function performQuestionDetection(extractedQuestionText: string | undefined) {
  const detectQuestion = async () => {
    return questionDetectionService.detectQuestion(extractedQuestionText || '');
  };
  const questionDetection = await detectQuestion();

  // Add marking scheme and question text to questionDetection
  if (questionDetection) {
    // Store only the questionMarks data in proper structure (matching test data)
    questionDetection.markingScheme = JSON.stringify(questionDetection.match?.markingScheme?.questionMarks || {});
    questionDetection.questionText = extractedQuestionText || '';
  }

  return questionDetection;
}

// Helper function to log performance summary
export function logPerformanceSummary(stepTimings: { [key: string]: { start: number; duration?: number; subSteps?: { [key: string]: number } } }, totalProcessingTime: number, actualModel: string, mode: string) {
  const totalTime = totalProcessingTime / 1000;

  // Display name mapping for cleaner output
  const displayNameMap: { [key: string]: string } = {
    'classification': 'classification',
    'image_classification': 'classification', // Legacy support
    'drawing_classification': 'drawing_classification',
    'ocr_processing': 'ocr_processing',
    'question_detection': 'question_detection',
    'segmentation': 'segmentation',
    'marking': 'marking',
    'ai_marking': 'marking',
    'output_generation': 'output_generation',
    'image_annotation': 'image_annotation',
    'preprocessing': 'preprocessing',
    'input_validation': 'input_validation',
    'database_persistence': 'database_persistence',
    'pdf_conversion': 'pdf_conversion'
  };

  console.log('\n=== PERFORMANCE SUMMARY ===');
  console.log(`Total Processing Time: ${totalTime.toFixed(1)}s`);
  console.log(`Model Used: ${actualModel}`);
  console.log(`Mode: ${mode}`);
  console.log('----------------------------');

  // Calculate step percentages
  const stepEntries = Object.entries(stepTimings).filter(([_, timing]) => timing.duration);
  if (stepEntries.length > 0) {
    stepEntries
      .sort((a, b) => (b[1].duration || 0) - (a[1].duration || 0))
      .forEach(([stepName, timing]) => {
        const duration = (timing.duration || 0) / 1000;
        const percentage = ((timing.duration || 0) / totalProcessingTime * 100).toFixed(0);
        // Use display name if available, otherwise use original step name
        const displayName = displayNameMap[stepName] || stepName;
        const paddedStepName = displayName.padEnd(25); // Fixed 25-character width
        console.log(`${paddedStepName} ${duration.toFixed(1)}s (${percentage}%)`);
      });
  }

  console.log('============================\n');
}

// Helper function to generate session title
export function generateSessionTitle(questionDetection: any, extractedQuestionText: string, mode: 'Question' | 'Marking'): string {
  return questionDetection?.found && questionDetection.match
    ? `${questionDetection.match.board} ${getShortSubjectName(questionDetection.match.qualification)} - ${questionDetection.match.paperCode} Q${questionDetection.match.questionNumber} (${questionDetection.match.examSeries})`
    : generateNonPastPaperTitle(extractedQuestionText, mode);
}

// Helper function to get suggested follow-ups
export async function getSuggestedFollowUps() {
  const { DEFAULT_SUGGESTED_FOLLOW_UP_SUGGESTIONS } = await import('../../config/suggestedFollowUpConfig.js');
  return DEFAULT_SUGGESTED_FOLLOW_UP_SUGGESTIONS;
}

// Helper function to setup progress tracker with common callback
export function setupProgressTrackerWithCallback(mode: 'question' | 'marking', onProgress?: (data: any) => void) {
  const setupFunction = mode === 'question' ? setupQuestionModeProgressTracker : setupMarkingModeProgressTracker;
  return setupFunction((data) => {
    if (onProgress) onProgress(data);
  });
}

// Helper function to log common steps (Image Analysis and Image Classification)
export function logCommonSteps(logStep: (stepName: string, modelInfo: string) => () => void, actualModel: string) {
  const logStep1Complete = logStep('Image Analysis', 'google-vision');
  logStep1Complete();

  const logStep2Complete = logStep('Image Classification', actualModel);
  logStep2Complete();
}

// Helper function to build response object for both question and marking modes
export function buildMarkingResponse({
  mode,
  imageData,
  classification,
  questionDetection,
  actualModel,
  totalProcessingTime,
  totalLLMTokens,
  totalMathpixCalls,
  finalProgressData,
  suggestedFollowUps,
  // Question mode specific
  aiResponse,
  // Marking mode specific
  processedImage,
  markingInstructions,
  annotationResult
}: {
  mode: 'Question' | 'Marking';
  imageData: string;
  classification: any;
  questionDetection: any;
  actualModel: string;
  totalProcessingTime: number;
  totalLLMTokens: number;
  totalMathpixCalls: number;
  finalProgressData: any;
  suggestedFollowUps: any;
  // Question mode specific
  aiResponse?: any;
  // Marking mode specific
  processedImage?: any;
  markingInstructions?: any;
  annotationResult?: any;
}): any {
  const isPastPaper = questionDetection?.found || false;
  const isQuestionMode = mode === 'Question';

  // Add marking scheme and question text to questionDetection
  if (questionDetection) {
    questionDetection.markingScheme = JSON.stringify(questionDetection.match?.markingScheme?.questionMarks || {});
    questionDetection.questionText = classification.extractedQuestionText || '';
  }

  // Build base response object
  const baseResponse = {
    success: true,
    category: isQuestionMode ? "questionOnly" : "questionAnswer",
    isPastPaper: isPastPaper,
    mode: mode,
    processingTime: totalProcessingTime,
    progressData: finalProgressData,
    sessionTitle: generateSessionTitle(
      questionDetection,
      isQuestionMode ? classification.extractedQuestionText || '' : processedImage?.ocrText || '',
      mode
    ),
    classification: classification,
    questionDetection: questionDetection,
    suggestedFollowUps: suggestedFollowUps,
    processingStats: {
      processingTimeMs: totalProcessingTime,
      imageSize: imageData.length,
      llmTokens: totalLLMTokens,
      modelUsed: actualModel,
      apiUsed: `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent`
    },
    apiUsed: `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent`
  };

  // Add mode-specific fields
  if (isQuestionMode) {
    return {
      ...baseResponse,
      extractedText: 'Question detected - ready for analysis',
      message: aiResponse?.response || '', // AI response for question mode
      aiResponse: aiResponse?.response || '', // AI response for question mode
      ocrCleanedText: '', // No OCR processing in question mode
      confidence: 0, // No OCR confidence in question mode
      processingStats: {
        ...baseResponse.processingStats,
        confidence: 0, // No OCR confidence in question mode
        mathpixCalls: 0, // No Mathpix calls in question mode
        annotations: 0
      }
    };
  } else {
    return {
      ...baseResponse,
      extractedText: processedImage?.ocrText || '',
      mathBlocks: processedImage?.boundingBoxes || [],
      markingInstructions: markingInstructions,
      annotatedImage: annotationResult?.annotatedImage || '',
      message: 'Marking completed - see suggested follow-ups below',
      ocrCleanedText: processedImage?.ocrText || '',
      confidence: processedImage?.confidence || 0,
      studentScore: markingInstructions?.studentScore,
      processingStats: {
        ...baseResponse.processingStats,
        confidence: processedImage?.confidence || 0,
        mathpixCalls: totalMathpixCalls,
        annotations: processedImage?.boundingBoxes?.length || 0
      }
    };
  }
}

/**
 * Extract questions from AI classification result
 * 
 * DESIGN: Support 1...N questions in classification response
 * - Classification AI extracts question text (no question numbers needed)
 * - Question Detection finds exam paper and marking schemes from database records
 * - Database records contain the actual question numbers (Q13, Q14, etc.)
 * - Classification returns array of questions with text only, NO numbers
 */
export function extractQuestionsFromClassification(
  classification: any,
  fileName?: string
): Array<{ text: string; questionNumber?: string | null }> {
  // Handle hierarchical questions array structure
  if (classification?.questions && Array.isArray(classification.questions)) {
    const extractedQuestions: Array<{ text: string; questionNumber?: string | null }> = [];

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
}

/**
 * Convert marking scheme to plain text format (same as sent to AI for marking instruction)
 * This ensures stored data matches what we send to AI
 */
export function convertMarkingSchemeToPlainText(
  markingScheme: any,
  questionNumber: string,
  subQuestionNumbers?: string[],
  subQuestionAnswers?: string[]
): string {
  if (!markingScheme) {
    return '';
  }

  try {
    // Extract marks array from various possible structures
    let marksArray: any[] = [];
    let questionLevelAnswer: string | undefined = undefined;

    // Handle different marking scheme structures
    if (markingScheme.questionMarks) {
      const questionMarks = markingScheme.questionMarks;
      if (Array.isArray(questionMarks.marks)) {
        marksArray = questionMarks.marks;
      } else if (Array.isArray(questionMarks)) {
        marksArray = questionMarks;
      }
      questionLevelAnswer = questionMarks.answer || markingScheme.answer;
    } else if (Array.isArray(markingScheme.marks)) {
      marksArray = markingScheme.marks;
      questionLevelAnswer = markingScheme.answer;
    } else if (Array.isArray(markingScheme)) {
      marksArray = markingScheme;
    }

    // If no marks found, return empty string
    if (marksArray.length === 0) {
      return '';
    }

    // Create JSON structure that formatMarkingSchemeAsBullets expects
    const schemeData: any = { marks: marksArray };
    if (questionLevelAnswer) {
      schemeData.questionLevelAnswer = questionLevelAnswer;
    }

    // Include sub-question marks mapping if available (for grouped sub-questions)
    if (markingScheme.questionMarks?.subQuestionMarks && typeof markingScheme.questionMarks.subQuestionMarks === 'object') {
      schemeData.subQuestionMarks = markingScheme.questionMarks.subQuestionMarks;
    }

    // Convert to JSON string, then to plain text bullets (same format as sent to AI)
    const schemeJson = JSON.stringify(schemeData, null, 2);
    return formatMarkingSchemeAsBullets(schemeJson, subQuestionNumbers, subQuestionAnswers);
  } catch (error) {
    console.error(`[MARKING SCHEME] Failed to convert marking scheme to plain text for Q${questionNumber}:`, error);
    return '';
  }
}

/**
 * Format grouped student work with sub-question labels
 */
export function formatGroupedStudentWork(
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

/**
 * Convert question numbers to sortable numeric values for page sorting
 * Examples: "3" → 3.0, "3a" → 3.01, "3b" → 3.02, "12i" → 12.01, "12ii" → 12.02
 */
export function getQuestionSortValue(questionNumber: string | null | undefined): number {
  if (!questionNumber) return Infinity;

  const baseNum = parseInt(String(questionNumber).replace(/\D/g, '')) || 0;
  if (baseNum === 0) return Infinity;

  // Extract sub-question part (e.g., "a", "b", "i", "ii")
  const subPart = String(questionNumber).replace(/^\d+/, '').toLowerCase();

  if (!subPart) {
    // Main question (e.g., "3") → 3.0
    return baseNum;
  }

  // Convert sub-question part to numeric offset
  let subOffset = 0;

  // Letter sub-questions: a=0.01, b=0.02, c=0.03, etc.
  if (subPart.match(/^[a-z]$/)) {
    subOffset = (subPart.charCodeAt(0) - 'a'.charCodeAt(0) + 1) * 0.01;
  }
  // Roman numerals: i=0.01, ii=0.02, iii=0.03, iv=0.04, v=0.05, etc.
  else if (subPart.match(/^[ivx]+$/i)) {
    const romanMap: Record<string, number> = {
      'i': 1, 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5,
      'vi': 6, 'vii': 7, 'viii': 8, 'ix': 9, 'x': 10
    };
    const romanValue = romanMap[subPart.toLowerCase()] || 0;
    subOffset = romanValue * 0.01;
  }
  // Numeric sub-questions: (1)=0.01, (2)=0.02, etc.
  else if (subPart.match(/^\(?\d+\)?$/)) {
    const numMatch = subPart.match(/\d+/);
    if (numMatch) {
      subOffset = parseInt(numMatch[0]) * 0.01;
    }
  }

  // Return base number + sub-question offset
  return baseNum + subOffset;
}

/**
 * Build mapping from classification result: page -> sub-question number
 * This tells us which sub-question (e.g., "3a", "3b") is on which page
 */
export function buildClassificationPageToSubQuestionMap(
  classificationResult: any
): Map<number, Map<string, string>> {
  const classificationPageToSubQuestion = new Map<number, Map<string, string>>(); // pageIndex -> baseQNum -> subQNum

  if (classificationResult?.questions) {
    for (const q of classificationResult.questions) {
      const baseQNum = String(q.questionNumber || '');
      if (!baseQNum) continue;

      const pageIndices = q.sourceImageIndices && Array.isArray(q.sourceImageIndices) && q.sourceImageIndices.length > 0
        ? q.sourceImageIndices
        : (q.sourceImageIndex !== undefined ? [q.sourceImageIndex] : []);

      if (q.subQuestions && Array.isArray(q.subQuestions) && q.subQuestions.length > 0) {
        // If sub-questions are on the same page, they're in the same question entry
        // If they're on different pages, they might be in separate entries
        // Map each sub-question to its page(s)
        q.subQuestions.forEach((subQ: any, subIndex: number) => {
          const part = subQ.part || '';
          if (!part) return;

          const subQNum = `${baseQNum}${part}`;

          // NEW LOGIC: Use explicit pageIndex if available (from markingRouter merging)
          if (subQ.pageIndex !== undefined) {
            const pageIndex = subQ.pageIndex;
            if (!classificationPageToSubQuestion.has(pageIndex)) {
              classificationPageToSubQuestion.set(pageIndex, new Map());
            }
            // Only set if not already set (first occurrence wins)
            if (!classificationPageToSubQuestion.get(pageIndex)!.has(baseQNum)) {
              classificationPageToSubQuestion.get(pageIndex)!.set(baseQNum, subQNum);
            }
            return; // Skip fallback loop
          }

          // For each page this question spans, map the sub-question
          // If multiple pages, assign sub-questions in order (first sub-question to first page, etc.)
          pageIndices.forEach((pageIndex, pageIdx) => {
            // If only one sub-question or first sub-question, use first page
            // Otherwise, try to match sub-question index to page index
            if (q.subQuestions.length === 1 || subIndex === pageIdx || (subIndex === 0 && pageIdx === 0)) {
              if (!classificationPageToSubQuestion.has(pageIndex)) {
                classificationPageToSubQuestion.set(pageIndex, new Map());
              }
              // Only set if not already set (first occurrence wins)
              if (!classificationPageToSubQuestion.get(pageIndex)!.has(baseQNum)) {
                classificationPageToSubQuestion.get(pageIndex)!.set(baseQNum, subQNum);
              }
            }
          });
        });
      }
    }
  }

  return classificationPageToSubQuestion;
}

/**
 * Build mapping from pageIndex to question numbers (for past paper sorting)
 */
export function buildPageToQuestionNumbersMap(
  allQuestionResults: Array<{ questionNumber: string | number | null | undefined; annotations?: Array<{ pageIndex?: number }> }>,
  markingSchemesMap: Map<string, any>,
  classificationPageToSubQuestion: Map<number, Map<string, string>>
): Map<number, number[]> {
  const pageToQuestionNumbers = new Map<number, number[]>();

  allQuestionResults.forEach((qr) => {
    const baseQNum = String(qr.questionNumber || '');

    // Check if this is a grouped sub-question (has sub-question numbers in markingSchemesMap)
    let subQuestionNumbers: string[] | undefined = undefined;
    for (const [key, scheme] of markingSchemesMap.entries()) {
      const keyQNum = key.split('_')[0];
      if (keyQNum === baseQNum && scheme.subQuestionNumbers && Array.isArray(scheme.subQuestionNumbers)) {
        subQuestionNumbers = scheme.subQuestionNumbers;
        break;
      }
    }

    if (subQuestionNumbers && subQuestionNumbers.length > 0) {
      // This is a grouped sub-question - map each page to its corresponding sub-question number
      // Get all pages that have annotations for this question
      const pageIndexCounts = new Map<number, number>();
      if (qr.annotations && qr.annotations.length > 0) {
        qr.annotations.forEach(anno => {
          if (anno.pageIndex !== undefined && anno.pageIndex >= 0) {
            pageIndexCounts.set(anno.pageIndex, (pageIndexCounts.get(anno.pageIndex) || 0) + 1);
          }
        });
      }

      // For each page with annotations, look up the actual sub-question number from classification
      pageIndexCounts.forEach((count, pageIndex) => {
        // Try to get the sub-question number from classification mapping
        const pageSubQuestionMap = classificationPageToSubQuestion.get(pageIndex);
        let subQNum: string | undefined = undefined;

        if (pageSubQuestionMap && pageSubQuestionMap.has(baseQNum)) {
          // Found exact mapping from classification
          subQNum = pageSubQuestionMap.get(baseQNum);
        } else {
          // Fallback: use order-based assignment (first page gets first sub-question, etc.)
          const sortedPages = Array.from(pageIndexCounts.keys()).sort((a, b) => a - b);
          const pageIndexInOrder = sortedPages.indexOf(pageIndex);
          if (pageIndexInOrder >= 0 && pageIndexInOrder < subQuestionNumbers.length) {
            subQNum = subQuestionNumbers[pageIndexInOrder];
          }
        }

        if (subQNum) {
          const sortValue = getQuestionSortValue(subQNum);
          if (sortValue !== Infinity && sortValue > 0) {
            if (!pageToQuestionNumbers.has(pageIndex)) {
              pageToQuestionNumbers.set(pageIndex, []);
            }
            pageToQuestionNumbers.get(pageIndex)!.push(sortValue);
          }
        }
      });
    } else {
      // Single question (not grouped sub-questions) - use base question number
      // Get pageIndex from annotations (most common pageIndex if question spans multiple pages)
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

      if (pageIndex !== undefined) {
        // Convert question number to sortable value (preserves sub-question order)
        const sortValue = getQuestionSortValue(baseQNum);
        if (sortValue !== Infinity && sortValue > 0) {
          if (!pageToQuestionNumbers.has(pageIndex)) {
            pageToQuestionNumbers.set(pageIndex, []);
          }
          pageToQuestionNumbers.get(pageIndex)!.push(sortValue);
        }
      }
    }
  });

  return pageToQuestionNumbers;
}

/**
 * Get page index from question result (from annotations or classification result)
 */
function getPageIndexFromQuestionResult(
  qr: QuestionResult,
  classificationResult: any
): number {
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
    const matchingQuestion = classificationResult.questions?.find((q: any) => {
      const qNum = String(q.questionNumber || '').replace(/[a-z]/i, '');
      const resultQNum = String(qr.questionNumber || '').split('_')[0].replace(/[a-z]/i, '');
      return qNum === resultQNum;
    });
    pageIndex = matchingQuestion?.sourceImageIndex ?? 0;
  }

  if (pageIndex === undefined) {
    pageIndex = 0; // Final fallback
  }

  return pageIndex;
}

/**
 * Calculate overall score from question results
 * Avoids double-counting sub-questions that share the same parent question
 */
export function calculateOverallScore(
  allQuestionResults: QuestionResult[]
): {
  overallScore: number;
  totalPossibleScore: number;
  overallScoreText: string;
} {
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

  return {
    overallScore,
    totalPossibleScore,
    overallScoreText
  };
}

/**
 * Calculate per-page scores from question results
 * Groups by page index and avoids double-counting sub-questions
 */
export function calculatePerPageScores(
  allQuestionResults: QuestionResult[],
  classificationResult: any
): { [pageIndex: number]: { awarded: number; total: number; scoreText: string } } {
  const pageScores: { [pageIndex: number]: { awarded: number; total: number; scoreText: string } } = {};

  // First pass: Calculate awarded marks per page
  allQuestionResults.forEach((qr) => {
    const pageIndex = getPageIndexFromQuestionResult(qr, classificationResult);

    if (!pageScores[pageIndex]) {
      pageScores[pageIndex] = { awarded: 0, total: 0, scoreText: '' };
    }

    pageScores[pageIndex].awarded += qr.score?.awardedMarks || 0;
    // Don't add totalMarks here - we'll calculate it after grouping by base question number
  });

  // Second pass: Calculate total marks per page by grouping by base question number (avoid double-counting sub-questions)
  const pageBaseQuestionToTotalMarks = new Map<number, Map<string, number>>(); // pageIndex -> baseQNum -> totalMarks
  allQuestionResults.forEach((qr) => {
    const pageIndex = getPageIndexFromQuestionResult(qr, classificationResult);

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

  return pageScores;
}
