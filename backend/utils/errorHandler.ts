/**
 * Unified error handling utilities for AI services
 */

export interface ErrorInfo {
  isRateLimit: boolean;
  isAuthError: boolean;
  isContentFilter: boolean;
  isNetworkError: boolean;
  retryable: boolean;
  retryAfter?: number;
}

export class ErrorHandler {
  /**
   * Analyze error and return structured error information
   */
  static analyzeError(error: Error): ErrorInfo {
    const message = error.message.toLowerCase();
    
    const isRateLimit = message.includes('429') || 
                       message.includes('rate limit') || 
                       message.includes('quota exceeded') ||
                       message.includes('too many requests');
    
    const isAuthError = message.includes('401') || 
                       message.includes('403') || 
                       message.includes('unauthorized') ||
                       message.includes('forbidden');
    
    const isContentFilter = message.includes('safety') || 
                           message.includes('content filter') ||
                           message.includes('blocked');
    
    const isNetworkError = message.includes('network') || 
                          message.includes('timeout') || 
                          message.includes('connection') ||
                          message.includes('econnreset');
    
    const retryable = isRateLimit || isNetworkError;
    
    // Extract retry-after from error message if available
    let retryAfter: number | undefined;
    const retryMatch = message.match(/retry.?after[:\s]+(\d+)/i);
    if (retryMatch) {
      retryAfter = parseInt(retryMatch[1]);
    }
    
    return {
      isRateLimit,
      isAuthError,
      isContentFilter,
      isNetworkError,
      retryable,
      retryAfter
    };
  }
  
  /**
   * Get appropriate log message for error type
   */
  static getLogMessage(error: Error, context: string): string {
    const errorInfo = this.analyzeError(error);
    
    if (errorInfo.isRateLimit) {
      return `🔄 [429 DETECTED] Rate limit detected in ${context}, implementing exponential backoff...`;
    } else if (errorInfo.isAuthError) {
      return `❌ [AUTH ERROR] Authentication failed in ${context}`;
    } else if (errorInfo.isContentFilter) {
      return `⚠️ [CONTENT FILTER] Content blocked in ${context}`;
    } else if (errorInfo.isNetworkError) {
      return `🌐 [NETWORK ERROR] Network issue in ${context}`;
    } else {
      return `❌ [ERROR] ${context} failed with unknown error`;
    }
  }
  
  /**
   * Standardized exponential backoff with jitter
   */
  static async exponentialBackoff(maxRetries: number = 3): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const baseDelay = Math.min(2000, 250 * Math.pow(2, attempt - 1));
      const jitter = Math.floor(Math.random() * 200);
      const delay = baseDelay + jitter;
      
      console.log(`⏳ [BACKOFF] Attempt ${attempt}/${maxRetries}, waiting ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  /**
   * Check if error should trigger fallback
   */
  static shouldFallback(error: Error): boolean {
    const errorInfo = this.analyzeError(error);
    return errorInfo.retryable;
  }
}
