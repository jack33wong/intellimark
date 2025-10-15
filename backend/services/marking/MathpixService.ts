/**
 * Mathpix Service
 * Handles Mathpix API operations for mathematical expression recognition
 */

import { getDebugMode } from '../../config/aiModels.js';

export class MathpixService {
  private static readonly API_URL = 'https://api.mathpix.com/v3/text';
  private static readonly DEFAULT_OPTIONS: any = {
    formats: ['latex_styled'],
    include_latex: true,
    include_mathml: false,
    include_asciimath: false
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

  static async processImage(imageBuffer: Buffer, options: any = {}, debug: boolean = false): Promise<any> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    
    if (debug) {
      const debugMode = getDebugMode();
      await new Promise(resolve => setTimeout(resolve, debugMode.fakeDelayMs));
      return {
        latex_styled: 'Debug mode: Mock LaTeX expression',
        confidence: 0.95
      };
    }
    
    if (!this.isAvailable()) {
      return {
        error: 'Mathpix service not available'
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
      const axios = await import('axios');
      const response = await axios.default.post(this.API_URL, body, { headers });
      return response.data;
    } catch (error: any) {
      console.error(`❌ [MATHPIX API ERROR] ${error.response?.data || error.message}`);
      return {
        error: error.response?.data?.error || error.message || 'Unknown Mathpix API error'
      };
    }
  }
}
