/**
 * Helper functions for marking router
 * Extracted from markingRouter.ts for better maintainability
 */

/**
 * Create detectedQuestion data from markingSchemesMap and question results
 * Common function used by both authenticated and unauthenticated users
 */
export function createDetectedQuestionData(
  allQuestionResults: any[],
  markingSchemesMap: Map<string, any>,
  globalQuestionText: string,
  options?: {
    useQuestionDetection?: boolean; // For authenticated users who have questionDetection data
    questionNumberDisplay?: string; // For multi-question display
    totalMarks?: number; // For authenticated users
  }
): any {
  if (allQuestionResults.length === 0) {
    return {
      found: false,
      questionText: globalQuestionText || '',
      questionNumber: '',
      subQuestionNumber: '',
      examBoard: '',
      examCode: '',
      paperTitle: '',
      subject: '',
      tier: '',
      year: '',
      marks: 0,
      markingScheme: ''
    };
  }

  const firstQuestionResult = allQuestionResults[0];
  const firstQuestionDetection = markingSchemesMap.get(String(firstQuestionResult.questionNumber));
  
  if (firstQuestionDetection) {
    // For authenticated users, use questionDetection data if available
    const actualQuestionData = options?.useQuestionDetection ? firstQuestionDetection?.questionDetection : null;
    
    // Handle different data structures: both user types have questionDetection.match, but authenticated users pass it through actualQuestionData
    const matchData = actualQuestionData?.match || firstQuestionDetection.questionDetection?.match;
    
    return {
      found: true,
      questionText: globalQuestionText || '',
      questionNumber: options?.questionNumberDisplay || firstQuestionResult.questionNumber,
      subQuestionNumber: matchData?.subQuestionNumber || '',
      examBoard: matchData?.board || matchData?.examBoard || '',
      examCode: matchData?.paperCode || matchData?.examCode || '',
      paperTitle: matchData?.qualification || matchData?.paperTitle || '',
      subject: matchData?.qualification || matchData?.subject || '',
      tier: matchData?.tier || '',
      year: matchData?.year || '',
      marks: options?.totalMarks || firstQuestionResult.score?.totalMarks || 0,
      markingScheme: firstQuestionDetection.questionMarks ? JSON.stringify(firstQuestionDetection.questionMarks) : ''
    };
  } else {
    return {
      found: false,
      questionText: globalQuestionText || '',
      questionNumber: options?.questionNumberDisplay || firstQuestionResult.questionNumber,
      subQuestionNumber: '',
      examBoard: '',
      examCode: '',
      paperTitle: '',
      subject: '',
      tier: '',
      year: '',
      marks: options?.totalMarks || firstQuestionResult.score?.totalMarks || 0,
      markingScheme: ''
    };
  }
}

/**
 * Generate session title from detectedQuestion data
 * Common function used by both authenticated and unauthenticated users
 */
export function generateSessionTitle(detectedQuestion: any): string {
  if (detectedQuestion?.found) {
    const { examBoard, subject, examCode, year, tier, questionNumber, marks } = detectedQuestion;
    return `${examBoard} ${subject} ${examCode} (${year}) Q${questionNumber} ${marks} marks`;
  }
  return 'Processing...';
}

/**
 * Helper function for SSE progress updates
 * Eliminates repeated sendSseUpdate calls
 */
export function sendProgressUpdate(
  res: any,
  step: number,
  message: string,
  allSteps: string[],
  isError: boolean = false
): void {
  const { sendSseUpdate, createProgressData } = require('../utils/sseUtils.js');
  sendSseUpdate(res, createProgressData(step, message, allSteps, isError));
}

/**
 * Helper function for performance logging
 * Eliminates repeated logStep pattern
 */
export function withPerformanceLogging<T>(
  stepName: string,
  modelInfo: string,
  operation: () => Promise<T>
): Promise<T> {
  const stepKey = stepName.toLowerCase().replace(/\s+/g, '_');
  const startTime = Date.now();
  
  console.log(`🔄 [${stepName}] Starting...`);
  
  return operation().then(result => {
    const duration = Date.now() - startTime;
    console.log(`✅ [${stepName}] Completed in ${duration}ms (${modelInfo})`);
    return result;
  }).catch(error => {
    const duration = Date.now() - startTime;
    console.log(`❌ [${stepName}] Failed after ${duration}ms (${modelInfo}): ${error.message}`);
    throw error;
  });
}

/**
 * Helper function for error handling with user-friendly messages
 * Eliminates repeated try-catch patterns
 */
export function withErrorHandling<T>(
  operation: () => Promise<T>,
  errorContext: string,
  userFriendlyMessage?: string
): Promise<T> {
  return operation().catch(error => {
    console.error(`❌ [${errorContext}] Error:`, error);
    
    // Create user-friendly error message
    const friendlyMessage = userFriendlyMessage || 
      `An error occurred during ${errorContext.toLowerCase()}. Please try again.`;
    
    const enhancedError = new Error(friendlyMessage);
    (enhancedError as any).originalError = error;
    (enhancedError as any).context = errorContext;
    
    throw enhancedError;
  });
}