/**
 * Mathpix Service
 * Handles Mathpix API integration for mathematical expression recognition
 */

import axios from 'axios';
import { getDebugMode } from '../config/aiModels.js';

export interface MathpixResult {
  latex_styled?: string;
  confidence?: number;
  error?: string;
}

export interface MathpixOptions {
  formats?: string[];
  include_latex?: boolean;
  include_mathml?: boolean;
  include_asciimath?: boolean;
}

export class MathpixService {
  // Log consolidation counters
  private static startCallCount = 0;
  private static completedCallCount = 0;
  private static lastLogTime = Date.now();
  private static readonly LOG_INTERVAL_MS = 5000; // Log every 5 seconds
  private static readonly LOG_CALL_INTERVAL = 10; // Or every 10 calls

  private static logConsolidatedStats(forceLog = false) {
    // Stats logging removed for cleaner output
    // The main step completion is handled by MarkHomeworkWithAnswer.ts
  }

  /**
   * Force log final consolidated stats (useful for end of processing)
   */
  static logFinalStats() {
    this.logConsolidatedStats(true);
  }

  private static async postWithBackoff(body: any, headers: any, attempt = 1): Promise<any> {
    try {
      const response = await axios.post(this.API_URL, body, { headers });
      return response.data;
    } catch (error: any) {
      const status = error?.response?.status;
      if ((status === 429 || (status >= 500 && status < 600)) && attempt <= 3) {
        const backoffMs = Math.min(2000, 250 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 200);
        await new Promise(r => setTimeout(r, backoffMs));
        return this.postWithBackoff(body, headers, attempt + 1);
      }
      throw error;
    }
  }
  private static readonly API_URL = 'https://api.mathpix.com/v3/text';
  private static readonly DEFAULT_OPTIONS: MathpixOptions = {
    formats: ['latex_styled'],
    include_latex: true,
    include_mathml: false,
    include_asciimath: false
  };

  /**
   * Check if Mathpix service is available
   * @returns True if credentials are configured
   */
  static isAvailable(): boolean {
    const appId = process.env.MATHPIX_APP_ID;
    const appKey = process.env.MATHPIX_API_KEY;
    return !!(appId && appKey);
  }

  /**
   * Get service status
   * @returns Service status information
   */
  static getServiceStatus(): {
    available: boolean;
    configured: boolean;
    error?: string;
  } {
    const appId = process.env.MATHPIX_APP_ID;
    const appKey = process.env.MATHPIX_API_KEY;
    
    if (!appId || !appKey) {
      return {
        available: false,
        configured: false,
        error: 'Mathpix credentials not configured. Please set MATHPIX_APP_ID and MATHPIX_API_KEY environment variables.'
      };
    }

    return {
      available: true,
      configured: true
    };
  }

  /**
   * Process image buffer with Mathpix API
   * @param imageBuffer - Image buffer to process
   * @param options - Mathpix processing options
   * @returns Mathpix recognition result
   */
  static async processImage(
    imageBuffer: Buffer, 
    options: MathpixOptions = {},
    debug: boolean = false
  ): Promise<MathpixResult> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    
    // Increment start counter and log consolidated stats
    this.startCallCount++;
    this.logConsolidatedStats();
    
    // Check debug mode - return mock response if enabled
    if (debug) {
      // In debug mode, still count as completed
      this.completedCallCount++;
      this.logConsolidatedStats();
      
      // Simulate processing delay
      const debugMode = getDebugMode();
      await new Promise(resolve => setTimeout(resolve, debugMode.fakeDelayMs));
      
      return {
        latex_styled: 'Debug mode: Mock LaTeX expression',
        confidence: 0.95
      };
    }
    
    if (!this.isAvailable()) {
      return {
        error: 'Mathpix service not available. Please configure credentials.'
      };
    }

    const appId = process.env.MATHPIX_APP_ID!;
    const appKey = process.env.MATHPIX_API_KEY!;
    
    const imageBase64 = imageBuffer.toString('base64');
    const headers = {
      'app_id': appId,
      'app_key': appKey,
      'Content-Type': 'application/json'
    };

    const body = {
      src: `data:image/png;base64,${imageBase64}`,
      formats: opts.formats,
      include_latex: opts.include_latex,
      include_mathml: opts.include_mathml,
      include_asciimath: opts.include_asciimath
    };

    try {
      const data = await this.postWithBackoff(body, headers);
      // Increment completed counter and log consolidated stats
      this.completedCallCount++;
      this.logConsolidatedStats();
      return data;
    } catch (error: any) {
      // Still count as completed (even if failed) for accurate statistics
      this.completedCallCount++;
      this.logConsolidatedStats();
      
      console.error(`❌ [MATHPIX API ERROR] Request failed`);
      console.error(`❌ [API ENDPOINT] https://api.mathpix.com/v3/text`);
      console.error(`❌ [ERROR DETAILS] ${error.response?.data || error.message}`);
      console.error(`❌ [HTTP STATUS] ${error.response?.status || 'Unknown'}`);
      
      return {
        error: error.response?.data?.error || error.message || 'Unknown Mathpix API error'
      };
    }
  }

  /**
   * Process multiple math blocks
   * @param mathBlocks - Array of math blocks with image buffers
   * @param options - Mathpix processing options
   * @returns Array of processed results
   */
  static async processMathBlocks(
    mathBlocks: Array<{ imageBuffer: Buffer; block: any }>,
    options: MathpixOptions = {}
  ): Promise<Array<{ block: any; result: MathpixResult }>> {
    const results = [];
    
    for (let i = 0; i < mathBlocks.length; i++) {
      const { imageBuffer, block } = mathBlocks[i];
      
      
      const result = await this.processImage(imageBuffer, options);
      results.push({ block, result });
      
      // Add small delay to avoid rate limiting
      if (i < mathBlocks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return results;
  }
}