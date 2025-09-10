/**
 * Hybrid OCR Service
 * Combines Google Cloud Vision API with Mathpix for optimal OCR results
 * Uses robust three-pass recognition strategy for maximum accuracy
 */

import sharp from 'sharp';
import { ImageAnnotatorClient, protos } from '@google-cloud/vision';
import { MathDetectionService, MathBlock } from './mathDetectionService';
import { MathpixService } from './mathpixService';
import type { ProcessedVisionResult } from '../types/index';

// Type aliases for robust recognition
type IBlock = protos.google.cloud.vision.v1.IBlock;
type IVertex = protos.google.cloud.vision.v1.IVertex;

interface DetectedBlock {
  source: string;
  blockIndex: number;
  text?: string | null;
  confidence?: number | null;
  geometry: {
    width: number;
    height: number;
    boundingBox: IVertex[];
    minX: number;
    minY: number;
  };
}

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

  // Configuration for robust recognition
  private static readonly RESIZE_FACTOR = 2;
  private static readonly IOU_THRESHOLD = 0.7;
  private static readonly LINE_GROUP_TOLERANCE_Y = 10; // pixels tolerance to group words into same line

  /**
   * Helper function to calculate width and height from bounding box vertices.
   */
  private static getBlockGeometry(block: IBlock, scale = 1) {
    const vertices = block.boundingBox?.vertices;
    if (!vertices || vertices.length < 4) {
      console.warn('⚠️ Block has invalid vertices:', vertices);
      return { width: 0, height: 0, boundingBox: [], minX: 0, minY: 0 };
    }
    
    const xCoords = vertices.map(v => (v.x || 0) / scale);
    const yCoords = vertices.map(v => (v.y || 0) / scale);
    const minX = Math.min(...xCoords);
    const maxX = Math.max(...xCoords);
    const minY = Math.min(...yCoords);
    const maxY = Math.max(...yCoords);

    const result = { 
      width: Math.round(maxX - minX), 
      height: Math.round(maxY - minY), 
      boundingBox: vertices.map(v => ({ x: Math.round((v.x || 0) / scale), y: Math.round((v.y || 0) / scale) })),
      minX: Math.round(minX), 
      minY: Math.round(minY) 
    };

    // Debug logging for NaN values
    if (isNaN(result.minX) || isNaN(result.minY) || isNaN(result.width) || isNaN(result.height)) {
      console.warn('⚠️ NaN coordinates detected:', {
        vertices,
        xCoords,
        yCoords,
        minX, maxX, minY, maxY,
        result
      });
    }

    return result;
  }

  /**
   * Calculates the Intersection over Union (IoU) of two bounding boxes.
   */
  private static calculateIoU(boxA: {minX: number, minY: number, width: number, height: number}, boxB: {minX: number, minY: number, width: number, height: number}): number {
    const xA = Math.max(boxA.minX, boxB.minX);
    const yA = Math.max(boxA.minY, boxB.minY);
    const xB = Math.min(boxA.minX + boxA.width, boxB.minX + boxB.width);
    const yB = Math.min(boxA.minY + boxA.height, boxB.minY + boxB.height);

    const intersectionArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    const boxAArea = boxA.width * boxA.height;
    const boxBArea = boxB.width * boxB.height;
    
    const iou = intersectionArea / (boxAArea + boxBArea - intersectionArea);
    return isNaN(iou) ? 0 : iou;
  }

  /**
   * Process a FullTextAnnotation into DetectedBlock[] using line-aware parsing with fallback.
   */
  private static processTextAnnotation(
    fullTextAnnotation: protos.google.cloud.vision.v1.IFullTextAnnotation | null | undefined,
    source: string,
    scale: number = 1
  ): DetectedBlock[] {
    const detectedBlocks: DetectedBlock[] = [];
    if (!fullTextAnnotation || !fullTextAnnotation.pages) return detectedBlocks;

    fullTextAnnotation.pages.forEach(page => {
      page.blocks?.forEach((block, blockIndex) => {
        block.paragraphs?.forEach((paragraph, paragraphIndex) => {
          // Prefer Vision API detected lines if available
          const paragraphAny: any = paragraph as any;
          const lines = paragraphAny?.lines as protos.google.cloud.vision.v1.ILine[] | undefined;
          if (lines && lines.length > 0) {
            lines.forEach(line => {
              const lineText = line.words?.map(w => w.symbols?.map(s => s.text).join('')).join(' ');
              if (line.boundingBox) {
                detectedBlocks.push({
                  source,
                  blockIndex: detectedBlocks.length + 1,
                  text: lineText,
                  confidence: line.confidence,
                  geometry: this.getBlockGeometry(line as unknown as protos.google.cloud.vision.v1.IBlock, scale)
                });
              }
            });
          } else {
            // Fallback: group words into lines by Y proximity
            const allWords: protos.google.cloud.vision.v1.IWord[] = paragraph.words || [];
            const wordsWithPos = allWords.map(w => ({
              word: w,
              minY: w.boundingBox?.vertices?.[0]?.y || 0,
              minX: w.boundingBox?.vertices?.[0]?.x || 0
            }));

            wordsWithPos.sort((a, b) => {
              if (Math.abs(a.minY - b.minY) <= this.LINE_GROUP_TOLERANCE_Y) return a.minX - b.minX;
              return a.minY - b.minY;
            });

            let currentLine: typeof wordsWithPos = [];
            const flushLine = () => {
              if (currentLine.length === 0) return;
              const minX = Math.min(...currentLine.map(x => x.word.boundingBox?.vertices?.[0]?.x || 0));
              const minY = Math.min(...currentLine.map(x => x.word.boundingBox?.vertices?.[0]?.y || 0));
              const maxX = Math.max(...currentLine.map(x => x.word.boundingBox?.vertices?.[2]?.x || 0));
              const maxY = Math.max(...currentLine.map(x => x.word.boundingBox?.vertices?.[2]?.y || 0));
              const lineText = currentLine.map(x => x.word.symbols?.map(s => s.text).join('')).join(' ');
              detectedBlocks.push({
                source,
                blockIndex: detectedBlocks.length + 1,
                text: lineText,
                confidence: currentLine.reduce((sum, x) => sum + (x.word.confidence || 0), 0) / currentLine.length,
                geometry: this.getBlockGeometry({
                  boundingBox: { vertices: [
                    { x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }
                  ] as unknown as IVertex[] }
                } as unknown as protos.google.cloud.vision.v1.IBlock, scale)
              });
              currentLine = [];
            };

            for (let i = 0; i < wordsWithPos.length; i++) {
              const entry = wordsWithPos[i];
              if (currentLine.length === 0) {
                currentLine.push(entry);
              } else {
                const lastY = currentLine[currentLine.length - 1].minY;
                if (Math.abs(entry.minY - lastY) <= this.LINE_GROUP_TOLERANCE_Y) {
                  currentLine.push(entry);
                } else {
                  flushLine();
                  currentLine.push(entry);
                }
              }
            }
            flushLine();
          }
        });
      });
    });

    return detectedBlocks;
  }

  /**
   * Perform robust three-pass Google Vision recognition
   */
  private static async performRobustRecognition(imageBuffer: Buffer): Promise<DetectedBlock[]> {
    const client = new ImageAnnotatorClient();
    const allBlocks: DetectedBlock[] = [];

    // Pass A: Clean Scan for Completeness
    console.log('🔍 Pass A: Clean scan...');
    try {
      const [resultA] = await client.textDetection(imageBuffer);
      allBlocks.push(...this.processTextAnnotation(resultA.fullTextAnnotation, 'pass_A_clean_scan'));
    } catch (error) {
      console.log('⚠️ Pass A failed:', error instanceof Error ? error.message : 'Unknown error');
    }

    // Pass B: Enhanced Scan for Accuracy
    console.log('🔍 Pass B: Enhanced scan...');
    try {
      const originalMetadata = await sharp(imageBuffer).metadata();
      const preprocessedBufferB = await sharp(imageBuffer)
        .resize((originalMetadata.width || 0) * this.RESIZE_FACTOR)
        .grayscale()
        .normalize()
        .toBuffer();
      const [resultB] = await client.textDetection(preprocessedBufferB);
      allBlocks.push(...this.processTextAnnotation(resultB.fullTextAnnotation, 'pass_B_enhanced_scan', this.RESIZE_FACTOR));
    } catch (error) {
      console.log('⚠️ Pass B failed:', error instanceof Error ? error.message : 'Unknown error');
    }

    // Pass C: Aggressive Scan for Edge Cases
    console.log('🔍 Pass C: Aggressive scan...');
    try {
      const originalMetadata = await sharp(imageBuffer).metadata();
      const preprocessedBufferC = await sharp(imageBuffer)
        .resize((originalMetadata.width || 0) * this.RESIZE_FACTOR)
        .sharpen()
        .threshold()
        .toBuffer();
      const [resultC] = await client.textDetection(preprocessedBufferC);
      allBlocks.push(...this.processTextAnnotation(resultC.fullTextAnnotation, 'pass_C_aggressive_scan', this.RESIZE_FACTOR));
    } catch (error) {
      console.log('⚠️ Pass C failed:', error instanceof Error ? error.message : 'Unknown error');
    }

    // Merge results using "Most Complete" strategy
    console.log('🔄 Merging results...');
    const finalBlocks: DetectedBlock[] = [];
    const processedIndices = new Set<number>();

    for (let i = 0; i < allBlocks.length; i++) {
      if (processedIndices.has(i)) continue;

      const cluster = [allBlocks[i]];
      processedIndices.add(i);

      for (let j = i + 1; j < allBlocks.length; j++) {
        if (processedIndices.has(j)) continue;
        
        // Check IoU overlap
        const iou = this.calculateIoU(allBlocks[i].geometry, allBlocks[j].geometry);
        
        // Only merge if high overlap AND they're on the same line (similar y-coordinates)
        const yDifference = Math.abs(allBlocks[i].geometry.minY - allBlocks[j].geometry.minY);
        const avgHeight = (allBlocks[i].geometry.height + allBlocks[j].geometry.height) / 2;
        const isSameLine = yDifference < avgHeight * 0.5; // Within 50% of average height
        
        if (iou > this.IOU_THRESHOLD && isSameLine) {
          console.log(`🔄 Merging blocks: "${allBlocks[i].text}" + "${allBlocks[j].text}" (IoU: ${iou.toFixed(3)}, yDiff: ${yDifference.toFixed(1)})`);
          cluster.push(allBlocks[j]);
          processedIndices.add(j);
        } else if (iou > this.IOU_THRESHOLD && !isSameLine) {
          console.log(`⚠️ Skipping merge: "${allBlocks[i].text}" + "${allBlocks[j].text}" (IoU: ${iou.toFixed(3)}, yDiff: ${yDifference.toFixed(1)} - different lines)`);
        }
      }
      
      let bestBlock = cluster[0];
      for (let k = 1; k < cluster.length; k++) {
        const currentBestText = bestBlock.text || '';
        const candidateText = cluster[k].text || '';
        if (candidateText.length > currentBestText.length) {
          bestBlock = cluster[k];
        }
      }
      
      finalBlocks.push(bestBlock);
    }
    
    finalBlocks.forEach((block, index) => block.blockIndex = index + 1);
    console.log(`✅ Robust recognition complete: ${finalBlocks.length} unique blocks found`);
    
    return finalBlocks;
  }

  /**
   * Process image with hybrid OCR approach using robust three-pass recognition
   * @param imageData - Base64 encoded image data
   * @param options - Processing options
   */
  static async processImage(
    imageData: string,
    options: HybridOCROptions = {}
  ): Promise<HybridOCRResult> {
    const startTime = Date.now();
    const opts = { ...this.DEFAULT_OPTIONS, ...options };

    // Convert base64 to buffer
    const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Step 1: Perform robust three-pass Google Vision recognition
    console.log('📡 Running robust three-pass Google Vision recognition...');
    let detectedBlocks: DetectedBlock[] = [];
    let mathBlocks: MathBlock[] = [];
    
    try {
      detectedBlocks = await this.performRobustRecognition(imageBuffer);
      
      // Convert detected blocks to our standard format
      const visionResult: ProcessedVisionResult = {
        text: detectedBlocks.map(block => block.text || '').join('\n'),
        boundingBoxes: detectedBlocks.map(block => ({
          text: block.text || '',
          x: block.geometry.minX,
          y: block.geometry.minY,
          width: block.geometry.width,
          height: block.geometry.height,
          confidence: block.confidence || 0
        })),
        confidence: detectedBlocks.reduce((sum, block) => sum + (block.confidence || 0), 0) / detectedBlocks.length || 0,
        dimensions: { width: 0, height: 0 }, // Will be updated from image metadata
        symbols: detectedBlocks.map(block => ({
          text: block.text || '',
          boundingBox: [
            block.geometry.minX,
            block.geometry.minY,
            block.geometry.width,
            block.geometry.height
          ],
          confidence: block.confidence || 0
        }))
      };

      // Debug logging for hybrid OCR results
      console.log('🔍 DEBUG: Hybrid OCR detected blocks count:', detectedBlocks.length);
      console.log('🔍 DEBUG: Hybrid OCR visionResult.boundingBoxes count:', visionResult.boundingBoxes.length);
      if (visionResult.boundingBoxes.length > 0) {
        console.log('🔍 DEBUG: First bounding box from hybrid OCR:', visionResult.boundingBoxes[0]);
      }
      
      // Debug: Print raw JSON from Google Vision before Mathpix processing
      // console.log('🔍 DEBUG: Raw Google Vision JSON before Mathpix processing:');
      // console.log(JSON.stringify({
      //   detectedBlocks: detectedBlocks.map(block => ({
      //     source: block.source,
      //     text: block.text,
      //     confidence: block.confidence,
      //     geometry: block.geometry
      //   })),
      //   visionResult: {
      //     text: visionResult.text,
      //     boundingBoxes: visionResult.boundingBoxes,
      //     confidence: visionResult.confidence,
      //     dimensions: visionResult.dimensions
      //   }
      // }, null, 2));

      // Get image dimensions
      const metadata = await sharp(imageBuffer).metadata();
      visionResult.dimensions = { width: metadata.width || 0, height: metadata.height || 0 };

      // Step 2: Detect math blocks from robust recognition results
      console.log('🔍 Detecting math blocks from robust recognition...');
      mathBlocks = MathDetectionService.detectMathBlocks(visionResult);
      
    } catch (error) {
      console.log('⚠️ Robust recognition failed, trying Mathpix only approach...');
      console.log('   Error:', error instanceof Error ? error.message : 'Unknown error');
      
      // Fallback to Mathpix-only processing
      if (MathpixService.isAvailable()) {
        console.log('🔢 Attempting Mathpix-only processing...');
        try {
          const mathpixResult = await MathpixService.processImage(imageData);
          if (mathpixResult.text) {
            const metadata = await sharp(imageBuffer).metadata();
            
            // Create a minimal result structure for Mathpix-only processing
            const visionResult: ProcessedVisionResult = {
              text: mathpixResult.text,
              boundingBoxes: [],
              confidence: mathpixResult.confidence || 0.5,
              dimensions: { width: metadata.width || 0, height: metadata.height || 0 },
              symbols: []
            };
            
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
        // Dedupe by bbox signature and prioritize suspicious or high-score blocks
        const seen = new Set<string>();
        const queue = [...mathBlocks].sort((a, b) => (b.suspicious === true ? 1 : 0) - (a.suspicious === true ? 1 : 0) || b.mathLikenessScore - a.mathLikenessScore);

        for (let i = 0; i < queue.length; i++) {
          const mathBlock = queue[i];
          
          // Validate coordinates before cropping
          const coords = mathBlock.coordinates;
          if (!coords || 
              typeof coords.x !== 'number' || isNaN(coords.x) ||
              typeof coords.y !== 'number' || isNaN(coords.y) ||
              typeof coords.width !== 'number' || isNaN(coords.width) ||
              typeof coords.height !== 'number' || isNaN(coords.height) ||
              coords.width <= 0 || coords.height <= 0) {
            console.warn(`⚠️ Skipping math block ${i + 1}: Invalid coordinates`, coords);
            continue;
          }
          
          const cropOptions = MathDetectionService.getCropOptions(coords);
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
        console.log('📝 Continuing with robust recognition results only...');
      }
    } else if (mathBlocks.length > 0) {
      console.log('⚠️ Math blocks detected but Mathpix not available, using robust recognition results');
    }

    // Step 4: Combine results
    const processingTime = Date.now() - startTime;
    
    console.log(`✅ Robust hybrid OCR completed in ${processingTime}ms`);
    console.log(`📊 Results: ${detectedBlocks.length} blocks, ${processedMathBlocks.length} math blocks`);

    // Create final result from detected blocks
    const finalText = detectedBlocks.map(block => block.text || '').join('\n');
    const finalBoundingBoxes = detectedBlocks.map(block => ({
      text: block.text || '',
      x: block.geometry.minX,
      y: block.geometry.minY,
      width: block.geometry.width,
      height: block.geometry.height,
      confidence: block.confidence || 0
    }));

    // Debug final result
    // console.log('🔍 DEBUG: Final hybrid OCR result - boundingBoxes count:', finalBoundingBoxes.length);
    // if (finalBoundingBoxes.length > 0) {
    //   console.log('🔍 DEBUG: First final bounding box:', finalBoundingBoxes);
    // }
    const finalConfidence = detectedBlocks.reduce((sum, block) => sum + (block.confidence || 0), 0) / detectedBlocks.length || 0;
    const finalSymbols = detectedBlocks.map(block => ({
      text: block.text || '',
      boundingBox: [
        block.geometry.minX,
        block.geometry.minY,
        block.geometry.width,
        block.geometry.height
      ],
      confidence: block.confidence || 0
    }));

    // Get image dimensions
    const metadata = await sharp(imageBuffer).metadata();

    return {
      text: finalText,
      boundingBoxes: finalBoundingBoxes,
      confidence: finalConfidence,
      dimensions: { width: metadata.width || 0, height: metadata.height || 0 },
      symbols: finalSymbols,
      mathBlocks: processedMathBlocks,
      processingTime,
      rawResponse: { detectedBlocks }
    };
  }

  /**
   * Get service status
   */
  static getServiceStatus(): {
    googleVision: any;
    mathpix: any;
    hybrid: boolean;
    robustRecognition: boolean;
  } {
    const mathpixStatus = MathpixService.getServiceStatus();
    
    // Check if Google Vision credentials are available
    const googleVisionAvailable = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
    
    return {
      googleVision: { available: googleVisionAvailable },
      mathpix: mathpixStatus,
      hybrid: googleVisionAvailable && mathpixStatus.available,
      robustRecognition: googleVisionAvailable
    };
  }

  /**
   * Check if hybrid OCR is available
   */
  static isAvailable(): boolean {
    return !!process.env.GOOGLE_APPLICATION_CREDENTIALS && MathpixService.isAvailable();
  }
}


