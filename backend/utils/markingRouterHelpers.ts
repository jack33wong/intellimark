/**
 * Helper functions for marking router
 * Extracted from markingRouter.ts for better maintainability
 */


/**
 * Generate session title from detectedQuestion data
 * Common function used by both authenticated and unauthenticated users
 */
export function generateSessionTitle(detectedQuestion: any): string {
  if (detectedQuestion?.found) {
    const { examBoard, subject, examCode, examSeries, tier, questionNumber, marks } = detectedQuestion;
    return `${examBoard} ${subject} ${examCode} (${examSeries}) Q${questionNumber} ${marks} marks`;
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