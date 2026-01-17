/**
 * Helper functions for Marking
 * Contains utility functions for progress tracking, question detection, performance logging, and session management
 */

import { questionDetectionService } from './questionDetectionService.js';
import { createAutoProgressTracker } from '../../utils/autoProgressTracker.js';
import { getStepsForMode } from '../../utils/progressTracker.js';
import { formatMarkingSchemeAsBullets } from '../../config/prompts.js';
import type { QuestionResult } from './MarkingExecutor.js';
import { getBaseQuestionNumber } from '../../utils/TextNormalizationUtils.js';

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
  console.log('[TITLE DEBUG] generateNonPastPaperTitle called. Input text length:', extractedQuestionText?.length, 'Mode:', mode);
  console.log('[TITLE DEBUG] Raw input text:', extractedQuestionText ? extractedQuestionText.substring(0, 100) + '...' : 'undefined');

  if (extractedQuestionText && extractedQuestionText.trim()) {
    let questionText = extractedQuestionText.trim();

    // CLEANUP: Remove AI-generated markers and markdown (e.g. :::your-work, **Question 6**)
    questionText = questionText.replace(/:::[^\s\n]+/g, '');
    questionText = questionText.replace(/\*\*/g, '').replace(/###/g, '').trim();

    // Handle cases where extraction failed after cleaning
    if (!questionText ||
      questionText.toLowerCase().includes('unable to extract') ||
      questionText.toLowerCase().includes('no text detected') ||
      questionText.toLowerCase().includes('extraction failed')) {
      return `${mode} - ${new Date().toLocaleDateString()}`;
    }

    // Use the truncated question text directly
    // Ensure newlines are replaced with spaces for clean title
    const cleanText = questionText.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    const truncatedText = cleanText.length > 30
      ? cleanText.substring(0, 30) + '...'
      : cleanText;
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
    'pdf_conversion': 'pdf_conversion',
    'performance_summary': 'performance_summary'
  };

  console.log('\n=== PERFORMANCE SUMMARY ===');
  console.log(`Total Processing Time: ${totalTime.toFixed(1)}s`);
  console.log(`Model Used: ${actualModel}`);
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
        const paddedStepName = displayName.padEnd(35); // Fixed 35-character width
        console.log(`${paddedStepName} ${duration.toFixed(1)}s (${percentage}%)`);
      });
  }

  console.log('============================\n');
}

// Helper function to log annotation summary table
export function logAnnotationSummary(allQuestionResults: QuestionResult[], markingTasks: any[]) {
  // ========================== ANNOTATION SUMMARY ==========================
  console.log('\n📊 [ANNOTATION SUMMARY]');
  console.log('----------------------------------------------------------------------');
  console.log('| Q#       | Score | Marks Awarded           | Match Status              |');
  console.log('|----------|-------|-------------------------|---------------------------|');

  const sortedResults = allQuestionResults;

  // Helper to calc stats for a list of annotations
  const calcStats = (list: any[]) => {
    let m = 0, v = 0, u = 0, s = 0;
    list.forEach((a: any) => {
      // Logic mirrored from MarkingExecutor match statuses
      if (a.ocr_match_status === 'VISUAL') v++;
      else if (a.ocr_match_status === 'UNMATCHED') u++;
      else if (a.hasLineData === false && a.bbox && a.bbox.length === 4) s++;
      else if (a.bbox && a.bbox.length === 4 && a.bbox[0] > 1) m++;
      else m++; // Default to match if it has reliable bbox
    });
    return { m, v, u, s };
  };

  sortedResults.forEach(result => {
    // 1. Prepare Main Row Data
    const qNum = String(result.questionNumber).padEnd(8);
    const coloredQNum = `\x1b[32m${qNum}\x1b[0m`;

    let scoreStr = '-';
    // const s = result.score;
    const scoreObj = (result as any).studentScore || result.score;
    if (scoreObj) {
      if (typeof scoreObj.awardedMarks === 'number' && typeof scoreObj.totalMarks === 'number') {
        scoreStr = `${scoreObj.awardedMarks}/${scoreObj.totalMarks}`;
      } else if (scoreObj.scoreText) {
        scoreStr = scoreObj.scoreText;
      }
    }
    const paddedScore = scoreStr.padEnd(5);

    // Get main annotations
    const questionAnns = result.annotations || [];
    const mainMarks = questionAnns.map(a => a.text).filter(t => t).join(', ');

    // Calculate Main Status
    const stats = calcStats(questionAnns);
    const statusStr = `M:${stats.m} V:${stats.v} U:${stats.u} S:${stats.s}`;

    console.log(`| ${coloredQNum} | ${paddedScore} | ${mainMarks.padEnd(23)} | ${statusStr.padEnd(25)} |`);

    // 2. Prepare Sub-Question Rows
    // Group annotations by sub-question label
    const subs = new Map<string, string[]>();
    const subAnnsMap = new Map<string, any[]>();

    questionAnns.forEach(a => {
      if (a.subQuestion) {
        let label = a.subQuestion.replace(String(result.questionNumber), '').trim();
        if (!label) label = 'Main';
        if (!subs.has(label)) {
          subs.set(label, []);
          subAnnsMap.set(label, []);
        }
        subs.get(label)!.push(a.text);
        subAnnsMap.get(label)!.push(a);
      }
    });

    if (subs.size > 0) {
      const sortedKeys = Array.from(subs.keys()).sort();
      sortedKeys.forEach(key => {
        if (key === 'Main') return;

        // Indented Label: "  a"
        // Q# Col Width is 10 (8 char + padding). 
        // We want "|   a      |" to align.
        const indentLabel = `  ${key}`.padEnd(8);
        const coloredLabel = `\x1b[90m${indentLabel}\x1b[0m`; // Gray for sub-questions

        const subMarks = subs.get(key)!.join(', ');

        // Calculate Sub-Score
        let subAwarded = 0;
        let subTotal = 0;

        // Calc awarded
        subs.get(key)!.forEach(text => {
          const normalized = (text || '').trim();
          const firstPart = normalized.split(/[^a-zA-Z0-9]/)[0];
          // Only count if it's a valid mark code prefix (M, A, B, P, C) and not 0-value
          if (/^[MABPC][0-9]?/.test(firstPart) && !firstPart.endsWith('0')) {
            const match = firstPart.match(/(\d+)$/);
            subAwarded += match ? parseInt(match[1], 10) : 1;
          }
        });

        // Calc total from scheme
        const scheme = (result as any).markingScheme || (markingTasks.find(t => String(t.questionNumber) === String(result.questionNumber))?.markingScheme);
        if (scheme) {
          let allMarks: any[] = [];
          if (Array.isArray(scheme)) allMarks = scheme;
          else if (scheme.marks) allMarks = scheme.marks;
          else if (scheme.questionMarks?.marks) allMarks = scheme.questionMarks.marks;

          const subSchemeMarks = allMarks.filter((m: any) => m.subQuestion === key);
          subTotal = subSchemeMarks.reduce((acc: number, m: any) => acc + (m.mark ? parseInt(m.mark.match(/(\d+)$/)?.[1] || '1') : 1), 0);
        }
        const subScoreStr = subTotal > 0 ? `${subAwarded}/${subTotal}` : `${subAwarded}`;

        // Calculate Sub Status
        const subStats = calcStats(subAnnsMap.get(key) || []);
        const subStatusStr = `M:${subStats.m} V:${subStats.v} U:${subStats.u} S:${subStats.s}`;

        console.log(`| ${coloredLabel} | ${subScoreStr.padEnd(5)} | ${subMarks.padEnd(23)} | ${subStatusStr.padEnd(25)} |`);
      });
    }
    console.log('|----------|-------|-------------------------|---------------------------|');
  });
}

// Helper function to generate session title
export function generateSessionTitle(questionDetection: any, extractedQuestionText: string, mode: 'Question' | 'Marking'): string {
  if (questionDetection?.found && questionDetection.match) {
    let { board, paperCode, examSeries, questionNumber } = questionDetection.match;
    if (board === 'Pearson Edexcel') board = 'Edexcel';
    return `${examSeries} ${paperCode} ${board} Q${questionNumber}`;
  }
  return generateNonPastPaperTitle(extractedQuestionText, mode);
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
): Array<{ text: string; questionNumber?: string | null; sourceImageIndex?: number; parentText?: string }> {
  // Handle hierarchical questions array structure
  if (classification?.questions && Array.isArray(classification.questions)) {
    const extractedQuestions: Array<{ text: string; questionNumber?: string | null; sourceImageIndex?: number; parentText?: string }> = [];

    for (const q of classification.questions) {
      const mainQuestionNumber = q.questionNumber !== undefined ? (q.questionNumber || null) : undefined;
      const sourceImageIndex = q.sourceImageIndex;

      if (q.text && q.subQuestions?.length > 0) {

      }

      // DEBUG: Log specific question structure for analysis


      // If question has sub-questions, extract each sub-question separately
      if (q.subQuestions && Array.isArray(q.subQuestions) && q.subQuestions.length > 0) {
        // Debug logging for Q2
        // Debug logging for Q2 - REMOVED

        for (const subQ of q.subQuestions) {
          const combinedQuestionNumber = mainQuestionNumber
            ? `${mainQuestionNumber}${subQ.part || ''}`
            : null;

          // CRITICAL FIX: Extract sub-question even if text is missing, as long as it has student work
          // This handles cases where classification detected student work but no question text
          // (common for sub-questions like 2ai, 2aii where the question is in the parent)
          const hasStudentWork = subQ.studentWork || (subQ.studentWorkLines && subQ.studentWorkLines.length > 0);

          if (subQ.text || hasStudentWork) {
            extractedQuestions.push({
              questionNumber: combinedQuestionNumber,
              text: subQ.text || '', // Use empty string if no text (detection will use question number only)
              sourceImageIndex,
              parentText: q.text // Preserving the lead-in text (e.g. "Sophie drives...")
            });
          }
        }
      } else {
        // Main question without sub-questions (or main text exists)
        if (q.text) {
          extractedQuestions.push({
            questionNumber: mainQuestionNumber,
            text: q.text,
            sourceImageIndex
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
  subQuestions: Array<{ part: string; studentWork: string; text?: string }>,
  customLineIds?: string[] // NEW: Optional pre-defined IDs
): string {
  const parts: string[] = [];
  let globalLineIndex = 1;

  // Add main question student work if exists
  if (mainStudentWork && mainStudentWork !== 'null' && mainStudentWork.trim() !== '') {
    const lines = mainStudentWork.trim().split('\n');
    const numberedLines = lines.map((line) => {
      const lineId = customLineIds ? customLineIds[globalLineIndex - 1] : `line_${globalLineIndex}`;
      globalLineIndex++;
      const label = lineId.includes('line_') ? lineId.replace('line_', 'Line ') : lineId;
      return `[${label}] ${line} (ID: ${lineId})`;
    }).join('\n');
    parts.push(`[MAIN QUESTION STUDENT WORK]\n${numberedLines}`);
  }

  // Add each sub-question with clear label
  subQuestions.forEach((subQ) => {
    if (subQ.studentWork && subQ.studentWork !== 'null' && subQ.studentWork.trim() !== '') {
      const subQLabel = `[SUB-QUESTION ${subQ.part.toUpperCase()} STUDENT WORK]`;
      const lines = subQ.studentWork.trim().split('\n');
      const numberedLines = lines.map((line) => {
        const lineId = (customLineIds && customLineIds[globalLineIndex - 1]) ? customLineIds[globalLineIndex - 1] : `line_${globalLineIndex}`;
        globalLineIndex++;
        const label = lineId.includes('line_') ? lineId.replace('line_', 'Line ') : lineId;
        return `[${label}] ${line} (ID: ${lineId})`;
      }).join('\n');
      parts.push(`${subQLabel}\n${numberedLines}`);
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
): Map<number, string[]> {
  const classificationPageToSubQuestion = new Map<number, string[]>(); // pageIndex -> list of subQNums

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
          // if (!part) return; // Allow empty part for some cases? No, usually subQ has part.

          const subQNum = `${baseQNum}${part}`;

          // NEW LOGIC: Use explicit pageIndex if available (from markingRouter merging)
          if (subQ.pageIndex !== undefined) {
            const pageIndex = subQ.pageIndex;
            if (!classificationPageToSubQuestion.has(pageIndex)) {
              classificationPageToSubQuestion.set(pageIndex, []);
            }
            // Only add if not already present
            if (!classificationPageToSubQuestion.get(pageIndex)!.includes(subQNum)) {
              classificationPageToSubQuestion.get(pageIndex)!.push(subQNum);
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
                classificationPageToSubQuestion.set(pageIndex, []);
              }
              if (!classificationPageToSubQuestion.get(pageIndex)!.includes(subQNum)) {
                classificationPageToSubQuestion.get(pageIndex)!.push(subQNum);
              }
            }
          });
        });
      } else {
        // Main question without sub-questions
        pageIndices.forEach((pageIndex) => {
          if (!classificationPageToSubQuestion.has(pageIndex)) {
            classificationPageToSubQuestion.set(pageIndex, []);
          }
          if (!classificationPageToSubQuestion.get(pageIndex)!.includes(baseQNum)) {
            classificationPageToSubQuestion.get(pageIndex)!.push(baseQNum);
          }
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
  classificationPageToSubQuestion: Map<number, string[]>,
  classificationResult?: any
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

    // DEBUG: Log processing for each question
    // console.log(`[SORT DEBUG] Processing Q${baseQNum}. Grouped: ${!!subQuestionNumbers}, Annotations: ${qr.annotations?.length || 0}`);

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
        const pageSubQuestions = classificationPageToSubQuestion.get(pageIndex);
        let subQNum: string | undefined = undefined;

        if (pageSubQuestions && pageSubQuestions.length > 0) {
          // Find a sub-question that matches the base question number
          subQNum = pageSubQuestions.find(sq => sq.startsWith(baseQNum));
        }

        if (!subQNum) {
          // Fallback: use order-based assignment (first page gets first sub-question, etc.)
          const sortedPages = Array.from(pageIndexCounts.keys()).sort((a, b) => a - b);
          const pageIndexInOrder = sortedPages.indexOf(pageIndex);
          if (pageIndexInOrder >= 0 && pageIndexInOrder < subQuestionNumbers.length) {
            subQNum = subQuestionNumbers[pageIndexInOrder];
          }
        }

        if (subQNum) {
          const sortValue = getQuestionSortValue(subQNum);
          // console.log(`[SORT DEBUG]   -> Page ${pageIndex} mapped to ${subQNum} (Sort: ${sortValue})`);
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
      // Get all unique pages that have annotations for this question
      const uniquePages = new Set<number>();
      if (qr.annotations && qr.annotations.length > 0) {
        qr.annotations.forEach(anno => {
          if (anno.pageIndex !== undefined && anno.pageIndex >= 0) {
            uniquePages.add(anno.pageIndex);
          }
        });
      }

      if (uniquePages.size > 0) {
        // Convert question number to sortable value (preserves sub-question order)
        const sortValue = getQuestionSortValue(baseQNum);

        uniquePages.forEach(pageIndex => {
          if (sortValue !== Infinity && sortValue > 0) {
            if (!pageToQuestionNumbers.has(pageIndex)) {
              pageToQuestionNumbers.set(pageIndex, []);
            }
            // Add sort value to EVERY page this question appears on
            if (!pageToQuestionNumbers.get(pageIndex)!.includes(sortValue)) {
              pageToQuestionNumbers.get(pageIndex)!.push(sortValue);
            }
          }
        });
      } else {
        // Fallback: try to match by question number from classificationResult if no annotations
        const pageIndex = getPageIndexFromQuestionResult(qr as any, classificationResult);
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

  // console.log('[SORT DEBUG] Final Page Map:', Object.fromEntries(Array.from(pageToQuestionNumbers.entries()).map(([k, v]) => [k, v])));

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

  // For total marks: Use parent marks from database (marking scheme) - single source of truth
  // Group by base question number and only count parent marks once per base question
  const baseQuestionToTotalMarks = new Map<string, number>();

  allQuestionResults.forEach((qr, index) => {
    const baseQNum = getBaseQuestionNumber(String(qr.questionNumber || ''));



    // Only set if not already set (first occurrence wins)
    if (!baseQuestionToTotalMarks.has(baseQNum)) {
      // Use detected total marks from marking scheme instead of parent marks
      // EXCEPTION: In Generic Mode with the 20/40 mark fallback, trust the AI's discovered total (qr.score) if available!
      const isGeneric = qr.markingScheme?.isGeneric;
      const schemeTotal = qr.markingScheme?.totalMarks || qr.markingScheme?.parentQuestionMarks || 0;
      const resultTotal = qr.score?.totalMarks || 0;

      // Identify if the System Scheme is just a placeholder (20, 40, etc.)
      const isDefaultScheme = [20, 40, 100].includes(schemeTotal);

      // If Generic and Default, prioritize the Result (AI) Total.
      // Otherwise fallback to Scheme Total.
      const qTotalMarks = (isGeneric && isDefaultScheme && resultTotal > 0)
        ? resultTotal
        : (schemeTotal || resultTotal || 0);

      console.log(`[TOTAL TRAP] Q${baseQNum}: Scheme=${schemeTotal}, AI=${resultTotal}, IsDefault=${isDefaultScheme} -> FINAL=${qTotalMarks}`);

      baseQuestionToTotalMarks.set(baseQNum, qTotalMarks);
    }
  });

  const totalPossibleScore = Array.from(baseQuestionToTotalMarks.values()).reduce((sum, marks) => sum + marks, 0);
  console.log(`[TOTAL TRAP] Grand Total Possible Score: ${totalPossibleScore}`);
  const overallScoreText = `${overallScore}/${totalPossibleScore}`;

  return {
    overallScore,
    totalPossibleScore,
    overallScoreText
  };
}

export interface BaseQuestionScore {
  questionNumber: string;
  awarded: number;
  total: number;
  scoreText: string;
}

/**
 * Calculate scores for each base question and identify their first occurrence page.
 * Avoids the "Per-Page" aggregation that confuses users when questions span pages.
 */
export function calculateQuestionFirstPageScores(
  allQuestionResults: QuestionResult[],
  classificationResult: any
): Map<number, BaseQuestionScore[]> {
  const pageToScores = new Map<number, BaseQuestionScore[]>();
  const baseQData = new Map<string, { awarded: number; total: number; minPage: number }>();

  // 1. Group Question Data
  allQuestionResults.forEach(qr => {
    const baseQNum = getBaseQuestionNumber(String(qr.questionNumber || ''));

    // Determine earliest page index for THIS specific result
    let minPageForThisPart = Infinity;
    if (qr.annotations && qr.annotations.length > 0) {
      qr.annotations.forEach(anno => {
        if (anno.pageIndex !== undefined && anno.pageIndex >= 0) {
          minPageForThisPart = Math.min(minPageForThisPart, anno.pageIndex);
        }
      });
    }

    // Fallback if no annotations or valid pageIndex in them
    if (minPageForThisPart === Infinity) {
      minPageForThisPart = getPageIndexFromQuestionResult(qr, classificationResult);
    }

    if (!baseQData.has(baseQNum)) {
      // 🟢 [STAMP FIX] Apply "Total Trap" logic here too!
      const isGeneric = qr.markingScheme?.isGeneric;
      const schemeTotal = qr.markingScheme?.totalMarks || qr.markingScheme?.parentQuestionMarks || 0;
      const resultTotal = qr.score?.totalMarks || 0;

      // Identify if the System Scheme is just a placeholder (20, 40, etc.)
      const isDefaultScheme = [20, 40, 100].includes(schemeTotal);

      // If Generic and Default, prioritize the Result (AI) Total.
      const qTotalMarks = (isGeneric && isDefaultScheme && resultTotal > 0)
        ? resultTotal
        : (schemeTotal || resultTotal || 0);

      // console.log(`[STAMP TRAP] Q${baseQNum}: Scheme=${schemeTotal}, AI=${resultTotal} -> FINAL=${qTotalMarks}`);

      baseQData.set(baseQNum, { awarded: 0, total: qTotalMarks, minPage: minPageForThisPart });
    }

    const data = baseQData.get(baseQNum)!;
    data.awarded += qr.score?.awardedMarks || 0;
    data.minPage = Math.min(data.minPage, minPageForThisPart);
  });

  // 2. Aggregate per Page
  const pageAggregates = new Map<number, { awarded: number; total: number }>();

  baseQData.forEach((data, baseQNum) => {
    const pageIndex = data.minPage === Infinity ? 0 : data.minPage;

    if (!pageAggregates.has(pageIndex)) {
      pageAggregates.set(pageIndex, { awarded: 0, total: 0 });
    }
    const pageStats = pageAggregates.get(pageIndex)!;
    pageStats.awarded += data.awarded;
    pageStats.total += data.total;
  });

  // 3. Convert to Output Format (Single Circle per Page)
  pageAggregates.forEach((stats, pageIndex) => {
    pageToScores.set(pageIndex, [{
      questionNumber: "Page Total", // Generic label since it's aggregated
      awarded: stats.awarded,
      total: stats.total,
      scoreText: `${stats.awarded}/${stats.total}`
    }]);
  });

  return pageToScores;
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
      // 🟢 [STAMP FIX 2] Apply "Total Trap" logic here too!
      const isGeneric = qr.markingScheme?.isGeneric;
      const schemeTotal = qr.markingScheme?.totalMarks || qr.markingScheme?.parentQuestionMarks || 0;
      const resultTotal = qr.score?.totalMarks || 0;
      const isDefaultScheme = [20, 40, 100].includes(schemeTotal);

      const qTotalMarks = (isGeneric && isDefaultScheme && resultTotal > 0)
        ? resultTotal
        : (schemeTotal || resultTotal || 0);

      pageBaseQMap.set(baseQNum, qTotalMarks);
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

/**
 * Split classification result into two clean buckets:
 * - Marking: Only questions that appear on questionAnswer pages
 * - Question-Only: Only questions that appear on questionOnly pages
 * 
 * This prevents cross-contamination where a question appears on both page types.
 */
export function splitClassificationByCategory(
  classificationResult: any,
  allClassificationResults: any[]
): {
  markingClassificationResult: any;
  questionOnlyClassificationResult: any;
} {
  if (!classificationResult?.questions || !Array.isArray(classificationResult.questions)) {
    return {
      markingClassificationResult: { ...classificationResult, questions: [] },
      questionOnlyClassificationResult: { ...classificationResult, questions: [] }
    };
  }

  const markingQuestions: any[] = [];
  const questionOnlyQuestions: any[] = [];



  classificationResult.questions.forEach((q: any) => {
    const questionPages = q.sourceImageIndices || [q.sourceImageIndex];
    const qNum = q.questionNumber || '?';



    // Split pages by category
    const questionAnswerPages: number[] = [];
    const questionOnlyPages: number[] = [];

    questionPages.forEach((pageIdx: number) => {
      const pageResult = allClassificationResults.find(r => r.pageIndex === pageIdx);
      const category = pageResult?.result?.category || pageResult?.mapperCategory;

      if (category === 'questionAnswer') {
        questionAnswerPages.push(pageIdx);
      } else if (category === 'questionOnly') {
        questionOnlyPages.push(pageIdx);
      }
    });

    // Helper function to filter studentWorkLines by page
    const filterLinesByPages = (lines: any[], pageIndices: number[]): any[] => {
      if (!lines || lines.length === 0) return [];
      return lines.filter((line: any) => {
        if (line.position && line.position.pageIndex !== undefined) {
          return pageIndices.includes(line.position.pageIndex);
        }
        // If no pageIndex, keep it (fallback for legacy data)
        return true;
      });
    };

    // Helper function to filter sub-questions by page
    const filterSubQuestionsByPages = (subQs: any[], pageIndices: number[]): any[] => {
      if (!subQs || subQs.length === 0) return [];
      return subQs.map((subQ: any) => {
        // Filter the sub-question's studentWorkLines
        const filteredLines = filterLinesByPages(subQ.studentWorkLines || [], pageIndices);
        return {
          ...subQ,
          studentWorkLines: filteredLines
        };
      }).filter((subQ: any) =>
        // Only keep sub-questions that have lines after filtering
        subQ.studentWorkLines && subQ.studentWorkLines.length > 0
      );
    };

    // Add to marking bucket if appears on questionAnswer pages
    if (questionAnswerPages.length > 0) {
      const filteredStudentWorkLines = filterLinesByPages(q.studentWorkLines || [], questionAnswerPages);
      const filteredSubQuestions = filterSubQuestionsByPages(q.subQuestions || [], questionAnswerPages);



      markingQuestions.push({
        ...q,
        sourceImageIndices: questionAnswerPages,
        sourceImageIndex: questionAnswerPages[0],
        studentWorkLines: filteredStudentWorkLines,
        subQuestions: filteredSubQuestions
      });
    }

    // Add to question-only bucket if appears on questionOnly pages
    if (questionOnlyPages.length > 0) {
      const filteredStudentWorkLines = filterLinesByPages(q.studentWorkLines || [], questionOnlyPages);
      const filteredSubQuestions = filterSubQuestionsByPages(q.subQuestions || [], questionOnlyPages);

      // CRITICAL FIX: Extract page-specific question text from allClassificationResults
      // When a question appears on multiple pages (e.g., Q1 on both questionAnswer and questionOnly pages),
      // we need to use the CORRECT question text from the questionOnly page, not the merged text
      const pageIdx = questionOnlyPages[0]; // Use first questionOnly page
      const pageResult = allClassificationResults.find(r => r.pageIndex === pageIdx);
      let pageSpecificText = q.text; // Fallback to merged text

      if (pageResult?.result?.questions) {
        // Find the question in this page's classification result
        const pageQuestion = pageResult.result.questions.find((pq: any) =>
          String(pq.questionNumber || '') === String(q.questionNumber || '')
        );
        if (pageQuestion?.text) {
          pageSpecificText = pageQuestion.text;
          if (pageQuestion?.text) {
            pageSpecificText = pageQuestion.text;
          }
        }
      }



      questionOnlyQuestions.push({
        ...q,
        text: pageSpecificText, // Use page-specific text instead of merged text
        sourceImageIndices: questionOnlyPages,
        sourceImageIndex: questionOnlyPages[0],
        studentWorkLines: filteredStudentWorkLines,
        subQuestions: filteredSubQuestions
      });
    }
  });



  return {
    markingClassificationResult: {
      ...classificationResult,
      questions: markingQuestions,
      category: 'questionAnswer'
    },
    questionOnlyClassificationResult: {
      ...classificationResult,
      questions: questionOnlyQuestions,
      category: 'questionOnly'
    }
  };
}

/**
 * Merge questions with same questionNumber across pages (for multi-page questions)
 * Extracted from MarkingPipelineService to support bucket-based processing
 */
export function mergeQuestionsFromPages(
  allClassificationResults: Array<{ pageIndex: number; result: any }>,
  standardizedPages: any[]
): any[] {
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


  // Merge questions with same questionNumber
  const allQuestions: any[] = [];

  // Process merged questions
  questionsByNumber.forEach((questionInstances, questionNumber) => {

    if (questionInstances.length === 1) {
      // Single page - no merge needed
      const { question, pageIndex } = questionInstances[0];
      // Ensure sourceImage is found
      const sourceImage = standardizedPages[pageIndex]?.originalFileName || 'unknown';
      allQuestions.push({
        ...question,
        sourceImage: sourceImage,
        sourceImageIndex: pageIndex,
        // Ensure sourceImageIndices is set even for single page
        sourceImageIndices: [pageIndex]
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
                confidence: subQ.confidence || 0.9,
                pageIndex: pageIndex, // Track which page this sub-question came from
                studentWorkLines: subQ.studentWorkLines || [], // Preserve lines
                hasStudentDrawing: subQ.hasStudentDrawing // Preserve drawing flag
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
              // Merge lines if present
              if (subQ.studentWorkLines && Array.isArray(subQ.studentWorkLines)) {
                existing.studentWorkLines = [...(existing.studentWorkLines || []), ...subQ.studentWorkLines];
              }
              // Merge drawing flag
              if (subQ.hasStudentDrawing) {
                existing.hasStudentDrawing = true;
                // Ensure [DRAWING] token exists in text if flag is true
                if (existing.studentWork) {
                  if (!existing.studentWork.includes('[DRAWING]')) {
                    existing.studentWork += '\n[DRAWING]';
                  }
                } else {
                  existing.studentWork = '[DRAWING]';
                }
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
        sourceImage: standardizedPages[pageWithText.pageIndex]?.originalFileName || 'unknown',
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
      sourceImage: standardizedPages[pageIndex]?.originalFileName || 'unknown',
      sourceImageIndex: pageIndex,
      // Ensure sourceImageIndices is set even if not merged
      sourceImageIndices: [pageIndex]
    });
  });

  // Sort questions by question number (natural sort for numbers like 1, 2, 3, 10, 11)
  allQuestions.sort((a, b) => {
    const numA = parseInt(a.questionNumber) || 0;
    const numB = parseInt(b.questionNumber) || 0;
    return numA - numB;
  });

  return allQuestions;
}


/**
 * Log a clean audit report for question detection
 * Provides mapping from AI Mapper Input -> Detection Result
 */
export function logDetectionAudit(detectionResults: any[]): void {
  if (!detectionResults || detectionResults.length === 0) return;

  // 0. Build Search Context Summary
  const firstRes = detectionResults[0]?.detectionResult;
  const poolSize = firstRes?.hintMetadata?.poolSize || 0;
  const hintUsed = firstRes?.hintMetadata?.hintUsed || 'Global Search';
  const papersMatched = firstRes?.hintMetadata?.matchedPapersCount || 0;

  console.log('\n🔍 [DETECTION CONTEXT]');
  console.log(`   Strategy: ${hintUsed}`);
  console.log(`   Pool Size: ${papersMatched} papers, ${poolSize} total question candidates`);
  console.log('------------------------------------------------------------------------------------------------------------------------------------');

  console.log('\n📋 [DETECTION AUDIT REPORT]');
  console.log('------------------------------------------------------------------------------------------------------------------------------------');
  console.log('| Q#   | Input Text (Fragment)                       | Match Result / Paper Title                         | Score | Status        |');
  console.log('------------------------------------------------------------------------------------------------------------------------------------');

  detectionResults.forEach(item => {
    const question = item.question;
    const result = item.detectionResult;
    const match = result.match;

    // 1. Q#
    const qNum = String(question.questionNumber || '?').padEnd(4);

    // 2. Input Text Fragment (WIDER: 45 chars)
    let inputText = (question.text || '').replace(/\n/g, ' ').trim();
    if (inputText.length > 45) {
      inputText = inputText.substring(0, 42) + '...';
    }
    const paddedInput = inputText.padEnd(45);

    // 3. Match Result / Paper Title (WIDER: 50 chars)
    let matchTitle = 'N/A';
    let scoreStr = '0.000';
    let status = '\x1b[31m❌ FAILED\x1b[0m';

    if (result.found && match) {
      // Construct Paper Title robustly (Fixing "undefined" issue)
      const b = match.board === 'Pearson Edexcel' ? 'Edexcel' : (match.board && match.board !== 'undefined' ? match.board : '');
      const q = match.qualification && match.qualification !== 'undefined' ? match.qualification : '';
      const c = match.paperCode && match.paperCode !== 'undefined' ? match.paperCode : '';
      const s = match.examSeries && match.examSeries !== 'undefined' ? match.examSeries : '';

      const parts = [b, q, c, s].filter(Boolean);
      matchTitle = parts.length > 0 ? `${parts.join(' ')} Q${match.questionNumber || ''}` : `Q${match.questionNumber || ''}`;

      if (matchTitle.length > 50) {
        matchTitle = matchTitle.substring(0, 47) + '...';
      }

      scoreStr = (match.confidence || 0).toFixed(3);

      // Determine Status (Simplified & More Accurate)
      if (match.isRescued) {
        status = '\x1b[33m⚠️  RESCUED\x1b[0m';
      } else if (match.confidence >= 0.8) {
        status = '\x1b[32m✅ SUCCESS\x1b[0m';
      } else if (match.confidence >= 0.7) {
        status = '\x1b[32m✅ MATCH\x1b[0m';
      } else {
        status = '\x1b[33m⚠️  WEAK MATCH\x1b[0m';
      }
    } else {
      // Failure Reason
      let failureReason = (question.text || '').trim().length === 0 ? 'No Text' : 'Low Similarity';

      // Check top audit trail entry for semantic failure if available
      if (result.hintMetadata?.auditTrail?.[0]?.reason === 'Semantic Fail') {
        failureReason = 'Semantic Fail';
      }

      status = `\x1b[31m❌ FAILED (${failureReason})\x1b[0m`;
    }

    console.log(`| ${qNum} | ${paddedInput} | ${matchTitle.padEnd(50)} | ${scoreStr} | ${status.padEnd(23)} |`);

    // --- ADD AUDIT TRAIL LOGGING (if weak or failed) ---
    const isWeakOrFailed = !result.found || (match && match.confidence < 0.8);
    if (isWeakOrFailed && result.hintMetadata?.auditTrail?.length > 0) {
      console.log('   └─ Runners Up (Audit Trail):');
      result.hintMetadata.auditTrail.slice(0, 3).forEach((candidate: any) => {
        const checkMark = candidate.score >= 0.7 ? '\x1b[32m○\x1b[0m' : '○';
        console.log(`      ${checkMark} [${candidate.score.toFixed(3)}] ${candidate.candidateId.padEnd(30)} | ${candidate.scoreBreakdown}`);
      });
    }
  });

  console.log('------------------------------------------------------------------------------------------------------------------------------------\n');
}
