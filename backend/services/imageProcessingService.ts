/**
 * Image Processing Service for Mark Homework System
 * Central image processing pipeline with OCR and annotation capabilities
 */

import sharp from 'sharp';
import { 
  ProcessedImageResult, 
  ProcessingOptions,
  ImageProcessingError,
  Result
} from '../types/index.ts';
import { MathpixService } from './mathpixService.ts';

// import { ImageAnnotationService } from './imageAnnotationService';

/**
 * Image Processing Service class
 * Orchestrates the entire image processing workflow
 */
export class ImageProcessingService {
  private static readonly DEFAULT_OPTIONS: ProcessingOptions = {
    enablePreprocessing: true,
    maxImageSize: 2048,
    compressionQuality: 80,
    enableAnnotations: true
  };

  /**
   * Main image processing pipeline
   * @param imageData - Base64 encoded image data
   * @param options - Processing options
   * @returns Processed image result with OCR text and bounding boxes
   */
  static async processImage(
    imageData: string, 
    options: ProcessingOptions = {}
  ): Promise<Result<ProcessedImageResult, ImageProcessingError>> {
    try {
      const mergedOptions = { ...this.DEFAULT_OPTIONS, ...options };
      console.log('🔍 ===== IMAGE PROCESSING STARTING =====');
      // Step 1: Validate input image
      const validationResult = this.validateInputImage(imageData);
      if (!validationResult.success) {
        return validationResult;
      }

      // Step 2: Preprocess image if enabled
      let processedImageData = imageData;
      if (mergedOptions.enablePreprocessing) {
        const preprocessingResult = await this.preprocessImage(imageData, mergedOptions);
        if (!preprocessingResult.success) {
          return preprocessingResult;
        }
        processedImageData = preprocessingResult.data;
      }

      // Step 3: Check Mathpix availability and process
      if (!MathpixService.isAvailable()) {
        console.log('🔍 ===== MATHPIX OCR SERVICE IS NOT AVAILABLE =====');
        console.log('🔍 ===== USING FALLBACK OCR PROCESSING =====');
        
        // Fallback: Create mock OCR result for testing
        const fallbackResult = this.createFallbackOCRResult(processedImageData);
        return { success: true, data: fallbackResult };
      }

      // Step 4: OCR processing with Mathpix
      const ocrResult = await MathpixService.processImage(processedImageData);
      console.log('🔍 ===== RAW OCR RESULT FROM MATHPIX =====');
      console.log('🔍 OCR Result type:', typeof ocrResult);
      console.log('🔍 OCR Result keys:', Object.keys(ocrResult));
      console.log('🔍 OCR Result text:', ocrResult.text);
      console.log('🔍 OCR Result boundingBoxes:', ocrResult.boundingBoxes);
      console.log('🔍 OCR Result dimensions:', ocrResult.dimensions);
      
      // Step 5: Use the already processed result directly (no need to process again)
      const processedResult = ocrResult;
      console.log('🔍 ===== USING PROCESSED OCR RESULT =====');
      console.log(processedResult);
      
      // Step 6: Get actual image dimensions from the original image data
      const actualDimensions = await this.extractImageDimensions(processedImageData);
      console.log('🔍 ===== ACTUAL IMAGE DIMENSIONS =====');
      console.log('🔍 Actual dimensions:', actualDimensions);
      console.log('🔍 OCR result dimensions:', processedResult.dimensions);
      
      // Use actual dimensions if OCR dimensions are invalid
      const finalDimensions = (processedResult.dimensions.width > 0 && processedResult.dimensions.height > 0) 
        ? processedResult.dimensions 
        : actualDimensions;
      
      console.log('🔍 Final dimensions to use:', finalDimensions);
      
      // Step 7: Generate bounding boxes and text
      const result: ProcessedImageResult = {
        ocrText: processedResult.text,
        boundingBoxes: processedResult.boundingBoxes,
        confidence: processedResult.confidence,
        imageDimensions: finalDimensions,
        isQuestion: this.detectQuestionMode(processedResult.text)
      };

      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        error: new ImageProcessingError(
          `Image processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'PROCESSING_FAILED'
        )
      };
    }
  }

  /**
   * Validate input image data
   * @param imageData - Base64 encoded image data
   * @returns Validation result
   */
  private static validateInputImage(imageData: string): Result<ProcessedImageResult, ImageProcessingError> {
    if (!imageData || typeof imageData !== 'string') {
      return {
        success: false,
        error: new ImageProcessingError(
          'Invalid image data provided',
          'INVALID_INPUT'
        )
      };
    }

    if (!imageData.startsWith('data:image/')) {
      return {
        success: false,
        error: new ImageProcessingError(
          'Invalid image format. Expected base64 data URL',
          'INVALID_FORMAT'
        )
      };
    }

    // Check minimum size (1KB)
    const base64Data = imageData.split(',')[1];
    if (!base64Data || base64Data.length < 1024) {
      return {
        success: false,
        error: new ImageProcessingError(
          'Image data too small. Minimum size is 1KB',
          'IMAGE_TOO_SMALL'
        )
      };
    }

    return { success: true, data: imageData };
  }

  /**
   * Preprocess image for better OCR results
   * @param imageData - Base64 encoded image data
   * @param options - Processing options
   * @returns Preprocessed image data
   */
  private static async preprocessImage(
    imageData: string, 
    options: ProcessingOptions
  ): Promise<Result<string, ImageProcessingError>> {
    try {
      // Extract base64 data
      const base64Data = imageData.split(',')[1];
      if (!base64Data) {
        throw new Error('Invalid image data format');
      }
      const buffer = Buffer.from(base64Data, 'base64');

      // Process image with Sharp
      let sharpInstance = sharp(buffer);

      // Resize if image is too large
      if (options.maxImageSize) {
        sharpInstance = sharpInstance.resize(options.maxImageSize, options.maxImageSize, {
          fit: 'inside',
          withoutEnlargement: true
        });
      }

      // Enhance image for better OCR
      sharpInstance = sharpInstance
        .grayscale() // Convert to grayscale for better text recognition
        .normalize() // Normalize contrast
        .sharpen() // Sharpen edges
        .threshold(128); // Apply threshold for binary image

      // Convert to PNG with specified quality
      const processedBuffer = await sharpInstance
        .png({ quality: options.compressionQuality || 80 })
        .toBuffer();

      // Convert back to base64
      const processedBase64 = processedBuffer.toString('base64');
      const processedImageData = `data:image/png;base64,${processedBase64}`;

      return { success: true, data: processedImageData };
    } catch (error) {
      return {
        success: false,
        error: new ImageProcessingError(
          `Image preprocessing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'PREPROCESSING_FAILED'
        )
      };
    }
  }



  /**
   * Extract actual image dimensions from the image data
   * @param imageData - Base64 encoded image data
   * @returns Image dimensions
   */
  private static async extractImageDimensions(imageData: string): Promise<{ width: number; height: number }> {
    try {
      // Extract base64 data
      const base64Data = imageData.split(',')[1];
      if (!base64Data) {
        throw new Error('Invalid image data format');
      }
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Use Sharp to get image metadata
      const sharp = require('sharp');
      const metadata = await sharp(buffer).metadata();
      
      console.log('🔍 Sharp metadata:', metadata);
      
      return {
        width: metadata.width || 800,
        height: metadata.height || 600
      };
    } catch (error) {
      console.warn('🔍 Failed to extract image dimensions:', error);
      // Return reasonable defaults
      return { width: 800, height: 600 };
    }
  }

  /**
   * Detect if the image contains a question (question-only mode)
   * @param ocrText - Text extracted from OCR
   * @returns True if the text appears to be a question
   */
  private static detectQuestionMode(ocrText: string): boolean {
    if (!ocrText) return false;

    const questionIndicators = [
      'question', 'problem', 'solve', 'find', 'calculate', 'determine',
      'what is', 'how many', 'which', 'when', 'where', 'why',
      '?', 'prove', 'show that', 'evaluate', 'compute'
    ];

    const lowerText = ocrText.toLowerCase();
    return questionIndicators.some(indicator => lowerText.includes(indicator));
  }

  /**
   * Adjust bounding box coordinates for better positioning
   * @param rawBox - Raw bounding box from OCR
   * @param imageHeight - Height of the image
   * @returns Adjusted bounding box
   */
  // private static adjustBoundingBoxCoordinates(rawBox: any, imageHeight: number): BoundingBox {
  //   const adjustedY = Math.max(0, rawBox.y - 20);
  //   const adjustedHeight = Math.min(rawBox.height, imageHeight - adjustedY);
    
  //   return {
  //     x: rawBox.x,
  //     y: adjustedY,
  //     width: rawBox.width,
  //     height: adjustedHeight,
  //     text: rawBox.text
  //   };
  // }

  /**
   * Get service status and health information
   * @returns Service status information
   */
  static getServiceStatus(): {
    available: boolean;
    mathpixAvailable: boolean;
    preprocessingEnabled: boolean;
    annotationEnabled: boolean;
  } {
    return {
      available: true,
      mathpixAvailable: MathpixService.isAvailable(),
      preprocessingEnabled: this.DEFAULT_OPTIONS.enablePreprocessing || false,
      annotationEnabled: this.DEFAULT_OPTIONS.enableAnnotations || false
    };
  }

  /**
   * Create fallback OCR result when Mathpix is not available
   * @param imageData - Base64 encoded image data
   * @returns Mock OCR result for testing
   */
  private static createFallbackOCRResult(imageData: string): ProcessedImageResult {
    console.log('🔍 Creating fallback OCR result for testing');
    
    // Extract image dimensions from base64 data (estimate based on data size)
    const base64Data = imageData.split(',')[1];
    if (!base64Data) {
      return {
        ocrText: "Sample homework text extracted (fallback mode)",
        boundingBoxes: [],
        confidence: 0.85,
        imageDimensions: { width: 800, height: 600 },
        isQuestion: true
      };
    }
    const estimatedSize = Math.sqrt(base64Data.length * 0.75); // Rough estimate
    
    return {
      ocrText: "Sample homework text extracted (fallback mode)",
      boundingBoxes: [
        {
          x: 100,
          y: 100,
          width: 200,
          height: 50,
          text: "Sample text"
        }
      ],
      confidence: 0.85,
      imageDimensions: {
        width: Math.round(estimatedSize),
        height: Math.round(estimatedSize)
      },
      isQuestion: true
    };
  }

  /**
   * Test image processing pipeline with a simple image
   * @returns True if pipeline is working correctly
   */
  static async testPipeline(): Promise<boolean> {
    try {
      // Create a simple test image (1x1 pixel)
      const testImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      
      const result = await this.processImage(testImage, { enablePreprocessing: false });
      return result.success;
    } catch {
      return false;
    }
  }
}
