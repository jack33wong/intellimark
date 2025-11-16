/**
 * Helper functions for MarkingPipeline
 * Contains utility functions for progress tracking, question detection, performance logging, and session management
 */

import { questionDetectionService } from './questionDetectionService.js';
import { createAutoProgressTracker } from '../../utils/autoProgressTracker.js';
import { getStepsForMode } from '../../utils/progressTracker.js';
import { getDebugMode } from '../../config/aiModels.js';

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
        console.log(`${progress} ${paddedName} ${durationStr} ${modelStr}`);
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
