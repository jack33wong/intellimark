/**
 * Hybrid OCR Service
 * Combines Google Cloud Vision API with Mathpix for optimal OCR results
 */

import sharp from 'sharp';
import { GoogleVisionService } from './googleVisionService';
import { MathDetectionService, MathBlock } from './mathDetectionService';
import { MathpixService } from './mathpixService';
import type { ProcessedVisionResult } from '../types/index';

export interface HybridOCRResult {
  text: string;
  boundingBoxes: any[];
  confidence: number;
  dimensions: { width: number; height: number };
  symbols: Array<{
    text: string;
    boundingBox: any;
    confidence: number;
  }>;
  mathBlocks: MathBlock[];
  processingTime: number;
  rawResponse?: any;
}

export interface HybridOCROptions {
  enablePreprocessing?: boolean;
  mathThreshold?: number;
  minMathBlockSize?: number;
  maxMathBlockSize?: number;
}

export class HybridOCRService {
  private static readonly DEFAULT_OPTIONS: Required<HybridOCROptions> = {
    enablePreprocessing: true,
    mathThreshold: 0.35,
    minMathBlockSize: 20,
    maxMathBlockSize: 2000
  };

  /**
   * Process image with hybrid OCR approach
   * @param imageData - Base64 encoded image data
   * @param options - Processing options
   */
  static async processImage(
    imageData: string,
    options: HybridOCROptions = {}
  ): Promise<HybridOCRResult> {
    const startTime = Date.now();
    const opts = { ...this.DEFAULT_OPTIONS, ...options };


    // Step 1: Process with Google Vision API
    console.log('📡 Processing with Google Cloud Vision...');
    let visionResult: ProcessedVisionResult | null = null;
    let mathBlocks: MathBlock[] = [];
    
    try {
      visionResult = await GoogleVisionService.processImage(imageData, opts.enablePreprocessing);
      // Step 2: Detect math blocks
      mathBlocks = MathDetectionService.detectMathBlocks(visionResult);
    } catch (error) {
      console.log('⚠️ Google Vision failed, trying Mathpix only approach...');
      console.log('   Error:', error instanceof Error ? error.message : 'Unknown error');
      
      // Create a minimal result structure for Mathpix-only processing
      visionResult = {
        text: '',
        boundingBoxes: [],
        confidence: 0,
        dimensions: { width: 0, height: 0 },
        symbols: []
      } as any;
      
      // Try to detect math blocks using the original image with Mathpix
      if (MathpixService.isAvailable()) {
        console.log('🔢 Attempting Mathpix-only processing...');
        try {
          const mathpixResult = await MathpixService.processImage(imageData);
          if (mathpixResult.text) {
            visionResult.text = mathpixResult.text;
            visionResult.confidence = mathpixResult.confidence || 0.5;
            
            // Create a single math block for the entire image
            mathBlocks = [{
              googleVisionText: mathpixResult.text,
              mathpixLatex: mathpixResult.latex_styled,
              confidence: mathpixResult.confidence || 0.5,
              mathLikenessScore: 1.0,
              coordinates: { x: 0, y: 0, width: 100, height: 100 }
            } as MathBlock];
            
            console.log('✅ Mathpix-only processing successful!');
            console.log(`   Text: "${mathpixResult.text}"`);
            console.log(`   LaTeX: "${mathpixResult.latex_styled || 'N/A'}"`);
          }
        } catch (mathpixError) {
          console.log('❌ Mathpix also failed:', mathpixError instanceof Error ? mathpixError.message : 'Unknown error');
        }
      }
    }

    // Step 3: Process math blocks with Mathpix if available
    let processedMathBlocks: MathBlock[] = mathBlocks;
    
    if (mathBlocks.length > 0 && MathpixService.isAvailable()) {
      console.log(`🔢 Processing ${mathBlocks.length} math blocks with Mathpix...`);
      
      try {
        // Convert base64 to buffer for cropping
        const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');
        
        // Dedupe by bbox signature and prioritize suspicious or high-score blocks
        const seen = new Set<string>();
        const queue = [...mathBlocks].sort((a, b) => (b.suspicious === true ? 1 : 0) - (a.suspicious === true ? 1 : 0) || b.mathLikenessScore - a.mathLikenessScore);

        for (let i = 0; i < queue.length; i++) {
          const mathBlock = queue[i];
          const cropOptions = MathDetectionService.getCropOptions(mathBlock.coordinates);
          const sig = `${cropOptions.left}-${cropOptions.top}-${cropOptions.width}-${cropOptions.height}`;
          if (seen.has(sig)) continue;
          seen.add(sig);
          
          try {
            // Crop the image to the math block
            const croppedBuffer = await sharp(imageBuffer)
              .extract(cropOptions)
              .png()
              .toBuffer();
            
            // Process with Mathpix
            const mathpixResult = await MathpixService.processImage(croppedBuffer);
            
            if (mathpixResult.latex_styled && !mathpixResult.error) {
              mathBlock.mathpixLatex = mathpixResult.latex_styled;
              mathBlock.confidence = mathpixResult.confidence;
              console.log(`✅ Math block ${i + 1} processed: ${mathpixResult.latex_styled.substring(0, 50)}...`);
            } else {
              console.warn(`⚠️ Math block ${i + 1} failed: ${mathpixResult.error || 'Unknown error'}`);
            }
            
            // Small delay to avoid rate limiting
            if (i < queue.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 200));
            }
            
          } catch (cropError) {
            console.error(`❌ Failed to crop math block ${i + 1}:`, cropError);
          }
        }
        
        processedMathBlocks = queue;
        
      } catch (error) {
        console.error('❌ Mathpix processing failed:', error);
        console.log('📝 Continuing with Google Vision results only...');
      }
    } else if (mathBlocks.length > 0) {
      console.log('⚠️ Math blocks detected but Mathpix not available, using Google Vision results');
    }

    // Step 4: Combine results
    const processingTime = Date.now() - startTime;
    
    console.log(`✅ Hybrid OCR completed in ${processingTime}ms`);
    console.log(`📊 Results: ${visionResult?.text.length || 0} chars, ${visionResult?.symbols.length || 0} symbols, ${processedMathBlocks.length} math blocks`);

    return {
      text: visionResult?.text || '',
      boundingBoxes: visionResult?.boundingBoxes || [],
      confidence: visionResult?.confidence || 0,
      dimensions: visionResult?.dimensions || { width: 0, height: 0 },
      symbols: visionResult?.symbols || [],
      mathBlocks: processedMathBlocks,
      processingTime,
      rawResponse: (visionResult as any)?.rawResponse
    };
  }

  /**
   * Get service status
   */
  static getServiceStatus(): {
    googleVision: any;
    mathpix: any;
    hybrid: boolean;
  } {
    const googleVisionStatus = GoogleVisionService.getServiceStatus();
    const mathpixStatus = MathpixService.getServiceStatus();
    
    return {
      googleVision: googleVisionStatus,
      mathpix: mathpixStatus,
      hybrid: googleVisionStatus.available && mathpixStatus.available
    };
  }

  /**
   * Check if hybrid OCR is available
   */
  static isAvailable(): boolean {
    return GoogleVisionService.isAvailable() && MathpixService.isAvailable();
  }
}


