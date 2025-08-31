/**
 * Mathpix OCR Service for Mark Homework System
 * Handles OCR processing of mathematical text and LaTeX detection
 */

import { 
  MathpixResult, 
  ProcessedMathpixResult, 
  BoundingBox, 
  ImageDimensions,
  OCRServiceError 
} from '../types';

const API_URL = 'https://api.mathpix.com/v3/text';
const APP_ID = process.env['MATHPIX_APP_ID'] || 'tutor_app';

/**
 * Mathpix OCR Service class
 */
export class MathpixService {
  private static apiKey: string | undefined;

  /**
   * Initialize the Mathpix service with API key
   * @param apiKey - Mathpix API key from environment variables
   */
  static initialize(apiKey?: string): void {
    this.apiKey = apiKey || process.env['MATHPIX_API_KEY'];
  }

  /**
   * Check if Mathpix service is available
   * @returns True if API key is configured
   */
  static isAvailable(): boolean {
    // Lazy initialization - try to get API key if not already set
    if (!this.apiKey) {
      this.apiKey = process.env['MATHPIX_API_KEY'];
    }
    return !!this.apiKey;
  }

  /**
   * Process image with Mathpix OCR
   * @param imageData - Base64 encoded image data
   * @returns Processed OCR result with bounding boxes
   * @throws OCRServiceError if processing fails
   */
  static async processImage(imageData: string): Promise<ProcessedMathpixResult> {
    try {
      if (!this.isAvailable()) {
        throw new OCRServiceError(
          'Mathpix API key not configured',
          'MISSING_API_KEY'
        );
      }
      console.log('🔍 ===== MATHPIX OCR STARTING =====');
      const rawResult = await this.callMathpixAPI(imageData);
      return this.processMathpixResults(rawResult);
    } catch (error) {
      if (error instanceof OCRServiceError) {
        throw error;
      }
      throw new OCRServiceError(
        `OCR processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'PROCESSING_FAILED'
      );
    }
  }

  /**
   * Call Mathpix API with image data
   * @param imageData - Base64 encoded image data
   * @returns Raw Mathpix API response
   * @throws Error if API call fails
   */
  private static async callMathpixAPI(imageData: string): Promise<MathpixResult> {
    console.log('🔍 ===== MATHPIX OCR STARTING =====');
    console.log('🔍 Image data length:', imageData.length);
    console.log('🔍 Image format:', imageData.substring(0, 30) + '...');

    const requestBody = {
        src: imageData, // Send the original data URL directly
        formats: ["text", "data"],  // Request both text and data for bounding boxes
        "include_word_data": true
      };

    console.log('🔍 Sending request to Mathpix API...');

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'app_id': APP_ID,
        'app_key': this.apiKey!
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
      throw new Error(`Mathpix API error: ${response.status} ${response.statusText} - ${errorData.error || 'Unknown error'}`);
    }

    const result = await response.json() as MathpixResult;
    
    console.log('🔍 DEBUG: result.text exists:', !!result.text);
    console.log('🔍 DEBUG: result.text length:', result.text ? result.text.length : 'undefined');
    console.log('🔍 DEBUG: result.text preview:', result.text ? result.text.substring(0, 100) + '...' : 'undefined');

    return result;
  }

  /**
   * Process raw Mathpix results into structured format
   * @param rawResult - Raw API response from Mathpix
   * @returns Processed result with bounding boxes and confidence
   */
  private static processMathpixResults(rawResult: MathpixResult): ProcessedMathpixResult {
    try {
      const text = rawResult.text || '';
      console.log('🔍 DEBUG: extracted text length:', text.length);
      console.log('🔍 DEBUG: extracted text preview:', text.substring(0, 100) + '...');

      const boundingBoxes = this.extractBoundingBoxes(rawResult);
      const confidence = this.calculateOverallConfidence(rawResult);
      const dimensions = this.extractImageDimensions(rawResult);

      console.log('🔍 ===== MATHPIX OCR COMPLETED =====');
      console.log(`🔍 Text length: ${text.length} characters`);
      console.log(`🔍 Text preview: "${text.substring(0, 100)}..."`);
      console.log(`🔍 Confidence: ${(confidence * 100).toFixed(2)}%`);
      console.log(`🔍 Bounding boxes: ${boundingBoxes.length}`);

      return {
        text,
        boundingBoxes,
        confidence,
        dimensions
      };
    } catch (error) {
      throw new OCRServiceError(
        `Failed to process Mathpix results: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'RESULT_PROCESSING_FAILED'
      );
    }
  }

  /**
   * Extract bounding boxes from Mathpix data with improved LaTeX filtering
   * @param rawResult - Raw Mathpix API response
   * @returns Array of bounding boxes with text
   */
  private static extractBoundingBoxes(rawResult: MathpixResult): BoundingBox[] {
    const boundingBoxes: BoundingBox[] = [];

    try {
      // Extract from the new Mathpix format: word_data array with cnt coordinates
      if (rawResult.word_data && Array.isArray(rawResult.word_data)) {
        rawResult.word_data.forEach((item: any) => {
          if (item.cnt && Array.isArray(item.cnt) && item.cnt.length > 0) {
            // Filter to only include LaTeX lines
            const text = item.text || '';
            if (!this.isLatexLine(text)) {
              return; // Skip non-LaTeX lines
            }
            
            // Mathpix format: cnt = [[x,y]] - contour points for the word
            const points = item.cnt as number[][];
            const rawX = Math.min(...points.map((p: number[]) => p[0] || 0));
            const rawY = Math.min(...points.map((p: number[]) => p[1] || 0));
            const rawWidth = Math.max(...points.map((p: number[]) => p[0] || 0)) - rawX;
            const rawHeight = Math.max(...points.map((p: number[]) => p[1] || 0)) - rawY;
            
            // Use coordinates directly from Mathpix API (already in correct scale)
            const x = Math.round(rawX);
            const y = Math.round(rawY) - 20;
            const width = Math.round(rawWidth);
            const height = Math.round(rawHeight) - 20;
            
            console.log('🔍 Bounding box coordinates:', {
              raw: { x: rawX, y: rawY, width: rawWidth, height: rawHeight },
              final: { x, y, width, height },
              text: item.text.substring(0, 30) + '...'
            });
            
            boundingBoxes.push({
              x: Math.max(0, x),
              y: Math.max(0, y),
              width: Math.max(1, width),
              height: Math.max(1, height),
              text: item.text || 'Unidentified text/diagram/graph/etc.',
              confidence: item.confidence || 0.8
            });
          }
        });
      }

      // Fallback: Extract from legacy data format if word_data not available
      if (boundingBoxes.length === 0 && rawResult.data && Array.isArray(rawResult.data)) {
        rawResult.data.forEach(item => {
          if (item.bbox && Array.isArray(item.bbox) && item.bbox.length === 4) {
            const [x, y, width, height] = item.bbox;
            
            boundingBoxes.push({
              x: Math.max(0, x),
              y: Math.max(0, y),
              width: Math.max(1, width),
              height: Math.max(1, height),
              text: item.value || '',
              confidence: item.confidence || 0
            });
          }
        });
      }

      // If no bounding boxes found, create fallback ones based on text content
      if (boundingBoxes.length === 0 && rawResult.text) {
        const lines = rawResult.text.split('\n').filter((line: string) => line.trim().length > 0);
        lines.forEach((line: string, index: number) => {
          boundingBoxes.push({
            x: 50,
            y: 50 + (index * 30),
            width: Math.max(line.length * 10, 100),
            height: 25,
            text: line,
            confidence: 0.7
          });
        });
      }

    } catch (error) {
      console.warn('🔍 Failed to extract bounding boxes from Mathpix response:', error);
    }

    return boundingBoxes;
  }

  /**
   * Check if a text line contains LaTeX content
   * @param text The text to check
   * @returns true if the text contains LaTeX syntax
   */
  private static isLatexLine(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    
    // Common LaTeX patterns
    const latexPatterns = [
      /\\[a-zA-Z]+/,           // LaTeX commands like \frac, \sqrt, etc.
      /\\[{}[\]]/,             // LaTeX braces and brackets
      /\\left|\\right/,        // Left/right delimiters
      /\\[a-zA-Z]+\{[^}]*\}/, // LaTeX commands with arguments
      /\$[^$]+\$/,            // Inline math mode
      /\\\([^)]*\\\)/,        // Display math mode
      /\\[a-zA-Z]+\([^)]*\)/, // LaTeX functions with parentheses
      /[a-zA-Z]+\^[a-zA-Z0-9]/, // Superscript notation
      /[a-zA-Z]+_[a-zA-Z0-9]/,  // Subscript notation
      /\\frac\{[^}]*\}\{[^}]*\}/, // Fractions
      /\\sqrt\{[^}]*\}/,      // Square roots
      /\\sum|\\int|\\prod/,   // Mathematical operators
      /\\alpha|\\beta|\\gamma|\\delta|\\theta|\\pi|\\sigma/, // Greek letters
      /\\mathrm\{[^}]*\}/,    // Mathrm commands
      /\\approx|\\approxeq|\\simeq/, // Approximation symbols
      /\\Rightarrow|\\Leftarrow|\\Leftrightarrow/, // Arrows
      /\\cdot|\\times|\\div/, // Mathematical operators
      /\\sin|\\cos|\\tan/,    // Trigonometric functions
      /\\log|\\ln/,           // Logarithmic functions
      /\\exp/,                // Exponential function
    ];
    
    // Check if any LaTeX pattern matches
    return latexPatterns.some(pattern => pattern.test(text));
  }

  /**
   * Calculate overall confidence score from OCR results
   * @param rawResult - Raw Mathpix API response
   * @returns Average confidence score (0-1)
   */
  private static calculateOverallConfidence(rawResult: MathpixResult): number {
    try {
      // If we have confidence scores from individual elements, calculate average
      if (rawResult.data && Array.isArray(rawResult.data)) {
        const confidences = rawResult.data
          .filter((item: any) => item.confidence !== undefined)
          .map((item: any) => item.confidence);
        
        if (confidences.length > 0) {
          const avgConfidence = confidences.reduce((sum: number, conf: number) => sum + conf, 0) / confidences.length;
          return Math.min(avgConfidence, 1.0); // Ensure it's between 0 and 1
        }
      }

      // Fallback confidence based on response quality
      if (rawResult.text && rawResult.text.length > 0) {
        return 0.8; // Good confidence if we got text
      } else if (rawResult.data && rawResult.data.length > 0) {
        return 0.6; // Medium confidence if we got data but no text
      } else {
        return 0.3; // Low confidence if response is minimal
      }
    } catch (error) {
      return 0.5; // Default confidence on error
    }
  }

  /**
   * Extract image dimensions from OCR results
   * @param rawResult - Raw Mathpix API response
   * @returns Image dimensions object
   */
  private static extractImageDimensions(rawResult: MathpixResult): ImageDimensions {
    console.log('🔍 DEBUG: Raw result keys:', Object.keys(rawResult));
    console.log('🔍 DEBUG: Raw result width:', rawResult.width);
    console.log('🔍 DEBUG: Raw result height:', rawResult.height);
    
    // Try to get dimensions from the result
    let width = rawResult.width || 0;
    let height = rawResult.height || 0;
    
    // If dimensions are not available, try to estimate from bounding boxes
    if ((!width || !height) && rawResult.word_data && Array.isArray(rawResult.word_data)) {
      let maxX = 0;
      let maxY = 0;
      
      rawResult.word_data.forEach((item: any) => {
        if (item.cnt && Array.isArray(item.cnt)) {
          item.cnt.forEach((point: number[]) => {
            if (point[0] !== undefined && point[0] > maxX) maxX = point[0];
            if (point[1] !== undefined && point[1] > maxY) maxY = point[1];
          });
        }
      });
      
      if (maxX > 0 && maxY > 0) {
        width = maxX + 50; // Add some padding
        height = maxY + 50; // Add some padding
        console.log('🔍 DEBUG: Estimated dimensions from bounding boxes:', { width, height });
      }
    }
    
    // Fallback to reasonable defaults if still no dimensions
    if (!width || !height) {
      width = 800;  // Default width
      height = 600; // Default height
      console.log('🔍 DEBUG: Using fallback dimensions:', { width, height });
    }
    
    console.log('🔍 DEBUG: Final dimensions:', { width, height });
    
    return { width, height };
  }

  /**
   * Validate image data before sending to API
   * @param imageData - Base64 encoded image data
   * @returns True if image data is valid
   */
  static validateImageData(imageData: string): boolean {
    if (!imageData || typeof imageData !== 'string') {
      return false;
    }

    // Check if it's a valid base64 string
    if (!imageData.startsWith('data:image/')) {
      return false;
    }

    // Check minimum size (1KB)
    const base64Data = imageData.split(',')[1];
    if (!base64Data || base64Data.length < 1024) {
      return false;
    }

    return true;
  }

  /**
   * Get service status and configuration
   * @returns Service status information
   */
  static getServiceStatus(): {
    available: boolean;
    configured: boolean;
    apiKeyPresent: boolean;
  } {
    return {
      available: this.isAvailable(),
      configured: !!this.apiKey,
      apiKeyPresent: !!process.env['MATHPIX_API_KEY']
    };
  }

  /**
   * Test API connectivity
   * @returns True if API is reachable
   */
  static async testConnectivity(): Promise<boolean> {
    try {
      if (!this.isAvailable()) {
        return false;
      }

      // Simple connectivity test with minimal data
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'app_id': APP_ID,
          'app_key': this.apiKey!
        },
        body: JSON.stringify({
          src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
          formats: ['text']
        })
      });

      return response.status === 200 || response.status === 400; // 400 means API is reachable but request is invalid
    } catch {
      return false;
    }
  }

  /**
   * Test Mathpix API connectivity with improved error handling
   */
  static async testConnection(): Promise<{ available: boolean; error?: string }> {
    try {
      if (!this.isAvailable()) {
        return { available: false, error: 'Mathpix API key not configured' };
      }

      // Create a simple test image (1x1 white pixel)
      const testImage = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG header
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // Color type, compression, etc.
        0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
        0x54, 0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0x00, // Compressed data
        0xFF, 0xFF, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, // White pixel
        0xE2, 0x21, 0xBC, 0x33, 0x00, 0x00, 0x00, 0x00, // IEND chunk
        0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
      ]);

      const testImageData = `data:image/png;base64,${testImage.toString('base64')}`;
      
      // Try to perform OCR on the test image
      await this.processImage(testImageData);
      
      return { available: true };

    } catch (error) {
      return { 
        available: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
}
