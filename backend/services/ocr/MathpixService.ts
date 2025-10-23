/**
 * Mathpix Service
 * Handles Mathpix API operations for mathematical expression recognition using v3/text endpoint.
 */

import { getDebugMode } from '../../config/aiModels.js';

export class MathpixService {
  // Revert to the v3/text endpoint
  private static readonly API_URL = 'https://api.mathpix.com/v3/text';
  
  // Define default options structure for v3/text.
  // We use top-level flags as shown in the primary documentation examples.
  private static readonly DEFAULT_OPTIONS: any = {
    formats: ['latex_styled', 'text'],
    include_line_data: false, 
    is_handwritten: false,
    disable_array_detection: false,
    data_options: {
        include_latex: true,
        include_mathml: false,
        include_asciimath: false
    }
  };

  static isAvailable(): boolean {
    return !!(process.env.MATHPIX_APP_ID && process.env.MATHPIX_API_KEY);
  }

  static getServiceStatus() {
    const appId = process.env.MATHPIX_APP_ID;
    const appKey = process.env.MATHPIX_API_KEY;
    
    if (!appId || !appKey) {
      return {
        available: false,
        configured: false,
        error: 'Mathpix credentials not configured'
      };
    }

    return {
      available: true,
      configured: true
    };
  }

  /**
   * Process image using the v3/text endpoint (JSON payload).
   */
  static async processImage(imageBuffer: Buffer, options: any = {}, debug: boolean = false): Promise<any> {
    // Robustly merge options for v3/text.
    const opts = { 
        // Merge top-level defaults
        ...this.DEFAULT_OPTIONS, 
        // Merge top-level overrides from caller (e.g., options.is_handwritten = true)
        ...options,
        // Merge data_options specifically
        data_options: {
            ...this.DEFAULT_OPTIONS.data_options,
            ...(options.data_options || {})
        }
    };
    
    if (debug) {
      const debugMode = getDebugMode();
      await new Promise(resolve => setTimeout(resolve, debugMode.fakeDelayMs));
      return {
        latex_styled: 'Debug mode: Mock LaTeX expression',
        confidence: 0.95,
        line_data: [] // Mock line data
      };
    }
    
    if (!this.isAvailable()) {
      return { error: 'Mathpix service not available' };
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
      // Assuming JPEG format standardized by ImageUtils
      src: `data:image/jpeg;base64,${imageBase64}`,
      ...opts
    };

    try {
      // DIAGNOSTIC LOGGING
      
      const axios = await import('axios');
      // The v3/text POST processes synchronously and returns the full result.
      const response = await axios.default.post(this.API_URL, body, { headers });
      return response.data;

    } catch (error: any) {
      console.error(`❌ [MATHPIX API ERROR] Status: ${error.response?.status}`);
      const errorDetails = error.response?.data || error.message;
      console.error(`❌ [MATHPIX API ERROR Details]`, errorDetails);
      
      const errorMessage = typeof errorDetails === 'object' ? (errorDetails.error || error.message) : errorDetails;
      return {
        error: errorMessage || 'Unknown Mathpix API error'
      };
    }
  }
}