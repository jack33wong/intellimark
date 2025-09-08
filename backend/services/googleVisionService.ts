import { ImageAnnotatorClient } from '@google-cloud/vision';
import type { protos } from '@google-cloud/vision';
import type { ProcessedVisionResult, BoundingBox, ImageDimensions } from '../types/index';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Service for Google Cloud Vision API operations
 */
export class GoogleVisionService {
  private client: ImageAnnotatorClient;
  private static staticClient: ImageAnnotatorClient | null = null;

  constructor() {
    this.client = new ImageAnnotatorClient();
  }

  private static ensureClient() {
    if (!this.staticClient) {
      // Rely on Application Default Credentials (env var GOOGLE_APPLICATION_CREDENTIALS or gcloud)
      try {
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
          console.log('🔐 Using GOOGLE_APPLICATION_CREDENTIALS at:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
        } else {
          console.log('🔐 Using Application Default Credentials (no explicit GOOGLE_APPLICATION_CREDENTIALS set)');
        }
      } catch (_e) {
        // ignore
      }
      this.staticClient = new ImageAnnotatorClient();
    }
    return this.staticClient;
  }

  /**
   * Static entry used by HybridOCRService
   */
  static async processImage(imageData: string, _enablePreprocessing: boolean = true): Promise<ProcessedVisionResult> {
    const client = this.ensureClient();

    const image = (() => {
      if (imageData.startsWith('data:')) {
        const b64 = imageData.split(',')[1] ?? '';
        return { content: Buffer.from(b64, 'base64') } as any;
      }
      if (imageData.startsWith('http')) {
        return { source: { imageUri: imageData } } as any;
      }
      // assume base64 without prefix
      return { content: Buffer.from(imageData, 'base64') } as any;
    })();

    const request = {
      image,
      features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
    } as any;

    const [response] = await client.annotateImage(request);
    return this.parseResponse(response as any);
  }

  private static parseResponse(response: protos.google.cloud.vision.v1.IAnnotateImageResponse): ProcessedVisionResult {
    const annotation = response.fullTextAnnotation || ({} as any);
    const text = annotation?.text ?? '';

    const dimensions: ImageDimensions = {
      width: annotation?.pages?.[0]?.width || 0,
      height: annotation?.pages?.[0]?.height || 0
    };

    const boxes: BoundingBox[] = [];
    const symbols: Array<{ text: string; boundingBox: BoundingBox; confidence: number } > = [];

    const pages: Array<any> = Array.isArray(annotation?.pages) ? (annotation.pages as any[]) : [];
    for (const page of pages) {
      const blocks: Array<any> = Array.isArray(page?.blocks) ? (page.blocks as any[]) : [];
      for (const block of blocks) {
        const paragraphs: Array<any> = Array.isArray(block?.paragraphs) ? (block.paragraphs as any[]) : [];
        for (const para of paragraphs) {
          const words: Array<any> = Array.isArray(para?.words) ? (para.words as any[]) : [];
          for (const word of words) {
            const wordText = Array.isArray(word?.symbols) ? (word.symbols as any[]).map((s: any) => s?.text || '').join('') : '';
            const bb = ((word?.boundingBox?.vertices as any[]) || []) as Array<{ x?: number | null; y?: number | null }>;
            if (bb && bb.length >= 2) {
              const { x, y, width, height } = this.verticesToBBox(bb as any);
              boxes.push({ x, y, width, height, text: wordText, confidence: (word?.confidence as number) || 0 });
            }
            const syms: Array<any> = Array.isArray(word?.symbols) ? (word.symbols as any[]) : [];
            for (const sym of syms) {
              const vs = ((sym?.boundingBox?.vertices as any[]) || []) as Array<{ x?: number | null; y?: number | null }>;
              if (vs && vs.length >= 2) {
                const { x, y, width, height } = this.verticesToBBox(vs as any);
                const conf = (sym?.confidence as number) || 0;
                const txt = sym?.text || '';
                symbols.push({
                  text: txt,
                  boundingBox: { x, y, width, height, text: txt, confidence: conf },
                  confidence: conf
                });
              }
            }
          }
        }
      }
    }

    let totalConfidence = 0;
    for (const s of symbols) {
      totalConfidence += s.confidence || 0;
    }
    const avgConf = symbols.length ? totalConfidence / symbols.length : 0;

    return {
      text,
      boundingBoxes: boxes,
      confidence: avgConf,
      dimensions,
      symbols,
      rawResponse: response as any
    } as any;
  }

  private static verticesToBBox(vertices: Array<{ x?: number | null; y?: number | null }>) {
    const xs = vertices.map(v => (v?.x ?? 0));
    const ys = vertices.map(v => (v?.y ?? 0));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  /**
   * Recognizes handwritten text in a local image file using Google Vision API
   * @param filePath - The path to the local image file
   * @returns Promise containing the detected text or null if no text found
   */
  async recognizeHandwriting(filePath: string): Promise<string | null> {
    try {
      console.log(`Analyzing file: ${filePath}`);

      // Use documentTextDetection for dense text or handwriting
      const [result] = await this.client.documentTextDetection(filePath);
      
      // Log the original Google Vision API response
      console.log('\n🔍 ORIGINAL GOOGLE VISION API RESPONSE (Handwriting):');
      console.log('==================================================');
      console.log(JSON.stringify(result, null, 2));
      console.log('==================================================\n');
      
      const fullTextAnnotation = result.fullTextAnnotation;

      if (fullTextAnnotation && fullTextAnnotation.text) {
        console.log('✅ Recognition successful!');
        console.log('--- Full Detected Text ---');
        const detectedText = fullTextAnnotation.text.trim();
        console.log(detectedText);
        console.log('--------------------------');
        return detectedText;
      } else {
        console.log('⚠️ No text detected in the image.');
        return null;
      }
    } catch (error) {
      console.error('❌ ERROR:', error);
      throw new Error(`Failed to recognize handwriting: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Recognizes text in a local image file using Google Vision API
   * @param filePath - The path to the local image file
   * @returns Promise containing the detected text or null if no text found
   */
  async recognizeText(filePath: string): Promise<string | null> {
    try {
      console.log(`Analyzing file for text: ${filePath}`);

      // Use textDetection for general text recognition
      const [result] = await this.client.textDetection(filePath);
      
      // Log the original Google Vision API response
      console.log('\n🔍 ORIGINAL GOOGLE VISION API RESPONSE (Text Detection):');
      console.log('====================================================');
      console.log(JSON.stringify(result, null, 2));
      console.log('====================================================\n');
      
      const detections = result.textAnnotations;

      if (detections && detections.length > 0) {
        console.log('✅ Text recognition successful!');
        console.log('--- Detected Text ---');
        const first: any = detections[0] as any;
        const detectedText = (first?.description ?? '').trim();
        console.log(detectedText);
        console.log('---------------------');
        return detectedText;
      } else {
        console.log('⚠️ No text detected in the image.');
        return null;
      }
    } catch (error) {
      console.error('❌ ERROR:', error);
      throw new Error(`Failed to recognize text: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Gets detailed text annotations with bounding boxes and coordinates
   * @param filePath - The path to the local image file
   * @returns Promise containing detailed text annotations with coordinates
   */
  async getDetailedTextAnnotations(filePath: string): Promise<any> {
    try {
      console.log(`Getting detailed annotations for: ${filePath}`);

      const [result] = await this.client.documentTextDetection(filePath);
      
      // Log the original Google Vision API response
      console.log('\n🔍 ORIGINAL GOOGLE VISION API RESPONSE:');
      console.log('=====================================');
      console.log(JSON.stringify(result, null, 2));
      console.log('=====================================\n');
      
      const fullTextAnnotation = result.fullTextAnnotation;

      if (fullTextAnnotation) {
        console.log('✅ Detailed annotations retrieved successfully!');
        
        const detailedResult = {
          fullText: fullTextAnnotation.text?.trim() || '',
          pages: fullTextAnnotation.pages || [],
          blocks: [],
          paragraphs: [],
          words: [],
          symbols: []
        };

        return detailedResult;
      } else {
        console.log('⚠️ No detailed annotations found.');
        return null;
      }
    } catch (error) {
      console.error('❌ ERROR:', error);
      throw new Error(`Failed to get detailed annotations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
