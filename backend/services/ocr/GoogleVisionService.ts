/**
 * Google Vision Service
 * Handles Google Cloud Vision API operations, including standard text detection and robust recognition.
 */

import sharp from 'sharp';
import { ImageAnnotatorClient, protos } from '@google-cloud/vision';
import type { DetectedBlock } from './BlockClusteringService.js';
import type { ProcessedVisionResult } from '../../types/index.js';

// Type aliases for robust recognition
type IBlock = protos.google.cloud.vision.v1.IBlock;
type IVertex = protos.google.cloud.vision.v1.IVertex;

export class GoogleVisionService {
  // Configuration for robust recognition
  private static readonly RESIZE_FACTOR = 2;
  private static readonly LINE_GROUP_TOLERANCE_Y = 10; // pixels tolerance to group words into same line

  /**
   * NEW: Performs standard text detection using the specified feature type and context.
   * This is used for handwriting detection signal injection.
   */
  static async detectText(imageBuffer: Buffer, featureType: 'TEXT_DETECTION' | 'DOCUMENT_TEXT_DETECTION' = 'DOCUMENT_TEXT_DETECTION', imageContext: any = {}): Promise<any> {
    const client = new ImageAnnotatorClient();
    const request = {
      image: { content: imageBuffer },
      features: [{ type: featureType }],
      imageContext: imageContext,
    };

    try {
      const [result] = await client.annotateImage(request);
      return result;
    } catch (error) {
      console.error('❌ [GOOGLE VISION API] Error during detectText:', error);
      throw error;
    }
  }

  /**
   * NEW: Detects the physical orientation of the text in the image.
   * Uses a weighted voting system across all text blocks to prevent marginal vertical text from dominating.
   * Returns the clockwise rotation degrees (0, 90, 180, 270) required to make the image upright.
   */
  static async detectOrientation(imageBuffer: Buffer): Promise<number> {
    try {
      const result = await this.detectText(imageBuffer, 'DOCUMENT_TEXT_DETECTION');
      
      const page = result.fullTextAnnotation?.pages?.[0];
      if (!page || !page.blocks || page.blocks.length === 0) {
        console.warn('⚠️ [GOOGLE VISION] No text blocks found for orientation detection. Assuming 0 degrees.');
        return 0;
      }

      let upVotes = 0;    // Needs 0
      let downVotes = 0;  // Needs 180
      let rightVotes = 0; // Needs 270 (Image is rotated 90 CW)
      let leftVotes = 0;  // Needs 90 (Image is rotated 90 CCW)

      for (const block of page.blocks) {
        if (!block.boundingBox || !block.boundingBox.vertices || block.boundingBox.vertices.length < 2) continue;

        const v0 = block.boundingBox.vertices[0];
        const v1 = block.boundingBox.vertices[1];
        const v2 = block.boundingBox.vertices[2];

        const x0 = v0.x || 0;
        const y0 = v0.y || 0;
        const x1 = v1.x || 0;
        const y1 = v1.y || 0;
        const x2 = v2?.x || 0;
        const y2 = v2?.y || 0;

        const dx = x1 - x0;
        const dy = y1 - y0;

        // Calculate a rough block area weight to prioritize main body text over marginal text
        const width = Math.sqrt(dx * dx + dy * dy) || 1;
        const height = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)) || 1;
        const weight = width * height;

        if (Math.abs(dx) > Math.abs(dy)) {
            // Text is horizontal
            if (dx > 0) upVotes += weight;
            else downVotes += weight;
        } else {
            // Text is vertical
            if (dy > 0) rightVotes += weight; // 90° Clockwise -> needs 270
            else leftVotes += weight;         // 90° Counter-Clockwise -> needs 90
        }
      }

      // Determine the winner
      const maxVotes = Math.max(upVotes, downVotes, rightVotes, leftVotes);
      
      if (maxVotes === 0) return 0; // Fallback
      if (maxVotes === upVotes) return 0;
      if (maxVotes === rightVotes) return 270;
      if (maxVotes === leftVotes) return 90;
      if (maxVotes === downVotes) return 180;

      return 0;
    } catch (error) {
      console.error('❌ [GOOGLE VISION] Error during detectOrientation:', error);
      return 0; // Safe fallback
    }
  }

  /**
   * Helper method to preprocess images with Sharp operations
   */
  static async preprocessImage(
    imageBuffer: Buffer, 
    operations: ('grayscale' | 'normalize' | 'sharpen' | 'threshold')[]
  ): Promise<Buffer> {
    const metadata = await sharp(imageBuffer).metadata();
    let processor = sharp(imageBuffer)
      .resize((metadata.width || 0) * this.RESIZE_FACTOR);
    
    operations.forEach(op => {
      switch(op) {
        case 'grayscale': processor = processor.grayscale(); break;
        case 'normalize': processor = processor.normalize(); break;
        case 'sharpen': processor = processor.sharpen(); break;
        case 'threshold': processor = processor.threshold(); break;
      }
    });
    
    return processor.toBuffer();
  }

  /**
   * Helper method to handle Google Vision pass errors
   */
  static handleVisionPassError(passName: string, error: any): void {
    console.error(`❌ [GOOGLE VISION] ${passName} failed:`, error);
  }

  /**
   * Helper method to get image metadata
   */
  static async getImageMetadata(imageBuffer: Buffer): Promise<{ width: number; height: number }> {
    const metadata = await sharp(imageBuffer).metadata();
    return { width: metadata.width || 0, height: metadata.height || 0 };
  }

  /**
   * Helper function to calculate width and height from bounding box vertices.
   */
  static getBlockGeometry(block: IBlock, scale = 1) {
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
   * Process a FullTextAnnotation into DetectedBlock[] using line-aware parsing with fallback.
   */
  static processTextAnnotation(
    fullTextAnnotation: any,
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
          const lines = paragraphAny?.lines as any[] | undefined;
          if (lines && lines.length > 0) {
            lines.forEach(line => {
              const lineText = line.words?.map(w => w.symbols?.map(s => s.text).join('')).join(' ');
              if (line.boundingBox) {
                // Calculate average confidence from words if line confidence is not available
                let confidence = line.confidence;
                if (!confidence && line.words && line.words.length > 0) {
                  const wordConfidences = line.words.map(w => w.confidence).filter(c => c !== undefined && c !== null);
                  if (wordConfidences.length > 0) {
                    confidence = wordConfidences.reduce((sum, c) => sum + c, 0) / wordConfidences.length;
                  }
                }
                
                
                detectedBlocks.push({
                  source,
                  blockIndex: detectedBlocks.length + 1,
                  text: lineText,
                  confidence: confidence,
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
  static async performRobustRecognition(
    imageBuffer: Buffer,
    dbscanEpsPx: number,
    dbscanMinPts: number
  ): Promise<{ finalBlocks: DetectedBlock[]; preClusterBlocks: DetectedBlock[] }> {
    const client = new ImageAnnotatorClient();
    const allBlocks: DetectedBlock[] = [];

    // Pass A: Clean Scan for Completeness
    try {
      const [resultA] = await client.textDetection(imageBuffer);
      allBlocks.push(...this.processTextAnnotation(resultA.fullTextAnnotation, 'pass_A_clean_scan'));
    } catch (error) {
      this.handleVisionPassError('Pass A', error);
    }

    // Pass B: Enhanced Scan for Accuracy
    try {
      const preprocessedBufferB = await this.preprocessImage(imageBuffer, ['grayscale', 'normalize']);
      const [resultB] = await client.textDetection(preprocessedBufferB);
      allBlocks.push(...this.processTextAnnotation(resultB.fullTextAnnotation, 'pass_B_enhanced_scan', this.RESIZE_FACTOR));
    } catch (error) {
      this.handleVisionPassError('Pass B', error);
    }

    // Pass C: Aggressive Scan for Edge Cases
    try {
      const preprocessedBufferC = await this.preprocessImage(imageBuffer, ['sharpen', 'threshold']);
      const [resultC] = await client.textDetection(preprocessedBufferC);
      allBlocks.push(...this.processTextAnnotation(resultC.fullTextAnnotation, 'pass_C_aggressive_scan', this.RESIZE_FACTOR));
    } catch (error) {
      this.handleVisionPassError('Pass C', error);
    }

    // Import and use BlockClusteringService for clustering
    const { BlockClusteringService } = await import('./BlockClusteringService.js');
    return BlockClusteringService.performDBSCANClustering(allBlocks, dbscanEpsPx, dbscanMinPts);
  }
}
