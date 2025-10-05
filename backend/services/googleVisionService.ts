import { ImageAnnotatorClient } from '@google-cloud/vision';
import type { protos } from '@google-cloud/vision';
import { getDebugMode } from '../config/aiModels.js';
import type { ProcessedVisionResult, BoundingBox, ImageDimensions } from '../types/index.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Service for Google Cloud Vision API operations
 */
export class GoogleVisionService {
  private client: ImageAnnotatorClient;
  private static staticClient: ImageAnnotatorClient | null = null;

  constructor() {
    // Try automatic credential discovery first
    try {
      this.client = new ImageAnnotatorClient();
    } catch (error) {
      // Fall back to explicit file if automatic discovery fails
      const serviceAccountPath = join(process.cwd(), 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
      this.client = new ImageAnnotatorClient({
        keyFilename: serviceAccountPath
      });
    }
  }

  private static ensureClient() {
    if (!this.staticClient) {
      try {
        // Try automatic credential discovery first
        this.staticClient = new ImageAnnotatorClient();
      } catch (error) {
        // Fall back to explicit file if automatic discovery fails
        const serviceAccountPath = join(process.cwd(), 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
        this.staticClient = new ImageAnnotatorClient({
          keyFilename: serviceAccountPath
        });
      }
    }
    return this.staticClient;
  }

  /**
   * Static entry used by HybridOCRService
   */
  static async processImage(imageData: string, _enablePreprocessing: boolean = true, debug: boolean = false): Promise<ProcessedVisionResult> {
    // Debug mode logging
    console.log(`🔄 [GOOGLE VISION] Starting Google Vision API - Debug Mode: ${debug ? 'ON' : 'OFF'}`);
    
    // Check debug mode - return mock response if enabled
    if (debug) {
      // Simulate processing delay
      const debugMode = getDebugMode();
      await new Promise(resolve => setTimeout(resolve, debugMode.fakeDelayMs));
      
      return {
        text: 'Debug mode: Mock Google Vision text recognition',
        boundingBoxes: [],
        confidence: 0.95,
        dimensions: { width: 800, height: 600 },
        symbols: []
      };
    }

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

    try {
      const [response] = await client.annotateImage(request);
      const result = this.parseResponse(response as any);
      return result;
    } catch (error) {
      console.error(`❌ [GOOGLE VISION ERROR] API request failed`);
      console.error(`❌ [API ENDPOINT] Google Vision API v1`);
      console.error(`❌ [ERROR DETAILS] ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error(`❌ [ERROR STACK]`, error);
      throw error;
    }
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

      // Use documentTextDetection for dense text or handwriting
      const [result] = await this.client.documentTextDetection(filePath);
      
      
      const fullTextAnnotation = result.fullTextAnnotation;

      if (fullTextAnnotation && fullTextAnnotation.text) {
        const detectedText = fullTextAnnotation.text.trim();
        return detectedText;
      } else {
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

      // Use textDetection for general text recognition
      const [result] = await this.client.textDetection(filePath);
      
      
      const detections = result.textAnnotations;

      if (detections && detections.length > 0) {
        const first: any = detections[0] as any;
        const detectedText = (first?.description ?? '').trim();
        return detectedText;
      } else {
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

      const [result] = await this.client.documentTextDetection(filePath);
      
      
      const fullTextAnnotation = result.fullTextAnnotation;

      if (fullTextAnnotation) {
        
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
        return null;
      }
    } catch (error) {
      console.error('❌ ERROR:', error);
      throw new Error(`Failed to get detailed annotations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
