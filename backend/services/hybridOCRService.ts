/**
 * Hybrid OCR Service
 * Combines Google Cloud Vision API with Mathpix for optimal OCR results
 * Uses robust three-pass recognition strategy for maximum accuracy
 */

import sharp from 'sharp';
import { ImageAnnotatorClient, protos } from '@google-cloud/vision';
// Inline MathDetectionService and MathpixService functionality
import { getDebugMode } from '../config/aiModels.js';
import type { ProcessedVisionResult } from '../types/index.js';

// Type aliases for robust recognition
type IBlock = protos.google.cloud.vision.v1.IBlock;
type IVertex = protos.google.cloud.vision.v1.IVertex;

// Inline MathBlock interface from MathDetectionService
export interface MathBlock {
  googleVisionText: string;
  mathpixLatex?: string;
  confidence: number;              // Google Vision confidence (NEVER modified)
  mathpixConfidence?: number;      // NEW: Mathpix confidence (only set after Mathpix)
  mathLikenessScore: number;
  coordinates: { x: number; y: number; width: number; height: number };
  suspicious?: boolean;
}

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
  usage?: { mathpixCalls: number };
}

// Inline MathDetectionService functionality
function scoreMathLikeness(text: string): number {
  const t = text || "";
  if (!t.trim()) return 0;

  // Check if it's clearly an English word/phrase (exclude these)
  const englishWordPattern = /^[a-zA-Z\s]+$/;
  if (englishWordPattern.test(t.trim()) && t.length > 3) {
    const commonEnglishWords = [
      'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'question', 'answer', 'find', 'calculate', 'solve', 'show', 'prove', 'given'
    ];
    
    const words = t.toLowerCase().split(/\s+/);
    const isCommonEnglish = words.every(word => commonEnglishWords.includes(word));
    if (isCommonEnglish) {
      return 0; // Exclude common English words
    }
  }

  // Mathematical features
  const features = [
    /[=≠≈≤≥]/g,                    // Equality/inequality symbols
    /[+\-×÷*/]/g,                  // Basic operators
    /\b\d+\b/g,                    // Numbers
    /[()\[\]{}]/g,                 // Brackets
    /\|.*\|/g,                     // Absolute value
    /√|∑|∫|π|θ|λ|α|β|γ|δ|ε|ζ|η|θ|ι|κ|λ|μ|ν|ξ|ο|π|ρ|σ|τ|υ|φ|χ|ψ|ω/g, // Greek letters
    /\b\w\^\d/g,                   // Exponents
    /\b\w_\d/g,                    // Subscripts
    /\b(sin|cos|tan|log|ln|exp|sqrt|abs|max|min|lim|sum|prod|int)\b/g, // Functions
    /\b(infinity|∞|inf)\b/g,       // Infinity
    /\b(pi|e|phi|gamma|alpha|beta|theta|lambda|mu|sigma|omega)\b/g, // Constants
    /\b(and|or|not|implies|iff|forall|exists)\b/g, // Logic
    /\b(if|then|else|when|where|given|let|assume|suppose|prove|show|find|solve|calculate)\b/g // Math words
  ];

  let score = 0;
  for (const feature of features) {
    const matches = t.match(feature);
    if (matches) {
      score += matches.length * 0.1;
    }
  }

  return Math.min(1, score);
}

function detectMathBlocks(vision: ProcessedVisionResult | null, threshold = 0.35): MathBlock[] {
  if (!vision) return [];

  const candidateBoxes = vision.boundingBoxes || [];
  const blocks: MathBlock[] = [];
  
  for (const b of candidateBoxes) {
    const score = scoreMathLikeness(b.text || "");
    if (score >= threshold) {
      const pipes = (b.text.match(/\|/g) || []).length;
      const suspicious = pipes === 1 || ((b.text.match(/[+\-×÷*/=]/g) || []).length > 2 && !(b.text.match(/\d/g) || []).length);

      const finalConfidence = b.confidence || vision.confidence || score;

      blocks.push({
        googleVisionText: b.text,
        confidence: finalConfidence,
        mathLikenessScore: score,
        coordinates: { x: b.x, y: b.y, width: b.width, height: b.height },
        suspicious
      });
    }
  }
  return blocks;
}

function getCropOptions(coords: { x: number; y: number; width: number; height: number }) {
  return {
    left: Math.max(0, Math.floor(coords.x)),
    top: Math.max(0, Math.floor(coords.y)),
    width: Math.max(1, Math.floor(coords.width)),
    height: Math.max(1, Math.floor(coords.height))
  };
}

// Inline MathpixService functionality
class InlineMathpixService {
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

export interface HybridOCROptions {
  enablePreprocessing?: boolean;
  mathThreshold?: number;
  minMathBlockSize?: number;
  maxMathBlockSize?: number;
  dbscanEpsPx?: number;
  dbscanMinPts?: number;
}

export class HybridOCRService {
  private static readonly DEFAULT_OPTIONS: Required<HybridOCROptions> = {
    enablePreprocessing: true,
    mathThreshold: 0.35,
    minMathBlockSize: 20,
    maxMathBlockSize: 2000,
    dbscanEpsPx: 40,
    dbscanMinPts: 2
  };

  // Configuration for robust recognition
  private static readonly RESIZE_FACTOR = 2;
  private static readonly IOU_THRESHOLD = 0.7;
  private static readonly LINE_GROUP_TOLERANCE_Y = 10; // pixels tolerance to group words into same line

  /**
   * Merge overlapping blocks into unified clusters. Uses simple rectangle intersection.
   * Repeats until no merges occur or a safety iteration cap is reached.
   */
  private static mergeOverlappingBlocks(blocks: DetectedBlock[]): DetectedBlock[] {
    const intersects = (a: DetectedBlock, b: DetectedBlock): boolean => {
      const ax1 = a.geometry.minX;
      const ay1 = a.geometry.minY;
      const ax2 = a.geometry.minX + a.geometry.width;
      const ay2 = a.geometry.minY + a.geometry.height;
      const bx1 = b.geometry.minX;
      const by1 = b.geometry.minY;
      const bx2 = b.geometry.minX + b.geometry.width;
      const by2 = b.geometry.minY + b.geometry.height;
      return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
    };

    const mergeTwo = (a: DetectedBlock, b: DetectedBlock): DetectedBlock => {
      const minX = Math.min(a.geometry.minX, b.geometry.minX);
      const minY = Math.min(a.geometry.minY, b.geometry.minY);
      const maxX = Math.max(a.geometry.minX + a.geometry.width, b.geometry.minX + b.geometry.width);
      const maxY = Math.max(a.geometry.minY + a.geometry.height, b.geometry.minY + b.geometry.height);
      const mergedWidth = Math.round(maxX - minX);
      const mergedHeight = Math.round(maxY - minY);
      const text = [a.text || '', b.text || ''].filter(Boolean).join(' ').trim();
      const confidence = (((a.confidence || 0) + (b.confidence || 0)) / (2)) || 0;
      return {
        source: `${a.source}|${b.source}|merged`,
        blockIndex: Math.min(a.blockIndex, b.blockIndex),
        text,
        confidence,
        geometry: {
          width: mergedWidth,
          height: mergedHeight,
          boundingBox: [
            { x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }
          ],
          minX,
          minY
        }
      } as DetectedBlock;
    };

    // Work on a copy
    let current = [...blocks];
    let changed = true;
    let iterations = 0;
    const MAX_ITERATIONS = 20;
    while (changed && iterations < MAX_ITERATIONS) {
      changed = false;
      iterations++;
      const result: DetectedBlock[] = [];
      const used = new Set<number>();
      for (let i = 0; i < current.length; i++) {
        if (used.has(i)) continue;
        let mergedBlock = current[i];
        for (let j = i + 1; j < current.length; j++) {
          if (used.has(j)) continue;
          if (intersects(mergedBlock, current[j])) {
            mergedBlock = mergeTwo(mergedBlock, current[j]);
            used.add(j);
            changed = true;
          }
        }
        used.add(i);
        result.push(mergedBlock);
      }
      current = result;
    }
    // Reindex blockIndex for stability
    current.forEach((b, idx) => (b.blockIndex = idx + 1));
    return current;
  }

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
  private static async performRobustRecognition(
    imageBuffer: Buffer,
    opts: Required<HybridOCROptions>
  ): Promise<{ finalBlocks: DetectedBlock[]; preClusterBlocks: DetectedBlock[] }> {
    const client = new ImageAnnotatorClient();
    const allBlocks: DetectedBlock[] = [];

    // Pass A: Clean Scan for Completeness
    try {
      const [resultA] = await client.textDetection(imageBuffer);
      allBlocks.push(...this.processTextAnnotation(resultA.fullTextAnnotation, 'pass_A_clean_scan'));
    } catch (error) {
      console.error('❌ [GOOGLE VISION] Pass A failed:', error);
    }

    // Pass B: Enhanced Scan for Accuracy
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
      console.error('❌ [GOOGLE VISION] Pass B failed:', error);
    }

    // Pass C: Aggressive Scan for Edge Cases
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
      console.error('❌ [GOOGLE VISION] Pass C failed:', error);
    }

    // Keep a copy of raw detected blocks prior to clustering for visualization/debugging
    const preClusterBlocks: DetectedBlock[] = allBlocks.slice();

    // Cluster results using DBSCAN (center-point clustering)
    const { DBSCAN } = await import('density-clustering') as unknown as { DBSCAN: new () => any };
    const algo: any = new (DBSCAN as any)();

    const points: Array<[number, number]> = allBlocks.map(b => [
      b.geometry.minX + b.geometry.width / 2,
      b.geometry.minY + b.geometry.height / 2
    ]);

    const clusters: number[][] = algo.run(points, opts.dbscanEpsPx, opts.dbscanMinPts);
    const noise: number[] = algo.noise || [];

    const finalBlocks: DetectedBlock[] = [];

    // Convert clusters to merged blocks
    clusters.forEach((idxs, clusterIdx) => {
      if (!Array.isArray(idxs) || idxs.length === 0) return;
      const members = idxs.map(i => allBlocks[i]);

      const minX = Math.min(...members.map(m => m.geometry.minX));
      const minY = Math.min(...members.map(m => m.geometry.minY));
      const maxX = Math.max(...members.map(m => m.geometry.minX + m.geometry.width));
      const maxY = Math.max(...members.map(m => m.geometry.minY + m.geometry.height));

      const mergedWidth = Math.round(maxX - minX);
      const mergedHeight = Math.round(maxY - minY);

      const text = members
        .slice()
        .sort((a, b) => (a.geometry.minY - b.geometry.minY) || (a.geometry.minX - b.geometry.minX))
        .map(m => (m.text || '').trim())
        .filter(Boolean)
        .join(' ');

      const avgConfidence = members.reduce((sum, m) => sum + (m.confidence || 0), 0) / members.length;

      finalBlocks.push({
        source: 'dbscan_cluster',
        blockIndex: clusterIdx + 1,
        text,
        confidence: avgConfidence,
        geometry: {
          width: mergedWidth,
          height: mergedHeight,
          boundingBox: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }],
          minX,
          minY
        }
      });
    });

    // Include noise points as individual blocks (optional but useful)
    noise.forEach((i, nIdx) => {
      const b = allBlocks[i];
      finalBlocks.push({
        ...b,
        source: `${b.source}|noise`
      });
    });

    finalBlocks.forEach((block, index) => block.blockIndex = index + 1);

    // Post-process: merge overlapping cluster boxes for cleaner regions
    const mergedClusters = this.mergeOverlappingBlocks(finalBlocks);

    return { finalBlocks: mergedClusters, preClusterBlocks };
  }

  /**
   * Process image with hybrid OCR approach using robust three-pass recognition
   * @param imageData - Base64 encoded image data
   * @param options - Processing options
   */
  static async processImage(
    imageData: string,
    options: HybridOCROptions = {},
    debug: boolean = false
  ): Promise<HybridOCRResult> {
    const startTime = Date.now();
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    
    // Sub-step timing removed for cleaner logs

    // Debug mode logging

    // Check debug mode - return mock response if enabled
    if (debug) {
      // Simulate processing delay
      const debugMode = getDebugMode();
      await new Promise(resolve => setTimeout(resolve, debugMode.fakeDelayMs));
      
      return {
        text: 'Debug mode: Mock OCR text recognition',
        boundingBoxes: [],
        confidence: 0.95,
        dimensions: { width: 800, height: 600 },
        symbols: [],
        mathBlocks: [],
        processingTime: Date.now() - startTime,
        rawResponse: null
      };
    }

    // Convert base64 to buffer
    const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Step 1: Perform robust three-pass Google Vision recognition
    let detectedBlocks: DetectedBlock[] = [];
    let mathBlocks: MathBlock[] = [];
    let preClusterBlocks: DetectedBlock[] = [];
    
    try {
      const robust = await this.performRobustRecognition(imageBuffer, opts);
      detectedBlocks = robust.finalBlocks;
      preClusterBlocks = robust.preClusterBlocks;
      

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
          boundingBox: {
            x: block.geometry.minX,
            y: block.geometry.minY,
            width: block.geometry.width,
            height: block.geometry.height,
            text: block.text || ''
          },
          confidence: block.confidence || 0
        }))
      };

      // Debug logging for hybrid OCR results
      if (visionResult.boundingBoxes.length > 0) {
      }
      
      // Debug: Print raw JSON from Google Vision before Mathpix processing
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
      mathBlocks = detectMathBlocks(visionResult);
      
    } catch (error) {
      console.error(`❌ [OCR PROCESSING ERROR] Google Vision failed:`, error instanceof Error ? error.message : 'Unknown error');
      console.error(`❌ [ERROR DETAILS]`, error);
      
      // Fallback to Mathpix-only processing
      if (InlineMathpixService.isAvailable()) {
        try {
          const imageBuffer = Buffer.from(imageData.split(',')[1], 'base64');
          const mathpixResult = await InlineMathpixService.processImage(imageBuffer, {}, debug);
          console.log('✅ [OCR PROCESSING] Mathpix fallback completed');
          if (mathpixResult.latex_styled) {
            const metadata = await sharp(imageBuffer).metadata();
            
            // Create a minimal result structure for Mathpix-only processing
            const visionResult: ProcessedVisionResult = {
              text: mathpixResult.latex_styled || '',
              boundingBoxes: [],
              confidence: mathpixResult.confidence || 0.5,
              dimensions: { width: metadata.width || 0, height: metadata.height || 0 },
              symbols: []
            };
            
            // Create a single math block for the entire image
            mathBlocks = [{
              googleVisionText: mathpixResult.latex_styled || '',
              mathpixLatex: mathpixResult.latex_styled,
              confidence: mathpixResult.confidence || 0.5,
              mathLikenessScore: 1.0,
              coordinates: { x: 0, y: 0, width: 100, height: 100 }
            } as MathBlock];
            
          }
        } catch (mathpixError) {
          console.error('❌ [OCR PROCESSING ERROR] Mathpix fallback also failed:', mathpixError instanceof Error ? mathpixError.message : 'Unknown error');
          console.error('❌ [ERROR DETAILS]', mathpixError);
          throw new Error(`OCR processing failed completely: Google Vision failed and Mathpix fallback also failed. ${mathpixError instanceof Error ? mathpixError.message : 'Unknown error'}`);
        }
      }
    }

    // Step 3: Process math blocks with Mathpix if available
    let mathpixCalls = 0;
    if (mathBlocks.length > 0 && InlineMathpixService.isAvailable()) {
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
          
          const cropOptions = getCropOptions(coords);
          const sig = `${cropOptions.left}-${cropOptions.top}-${cropOptions.width}-${cropOptions.height}`;
          if (seen.has(sig)) continue;
          seen.add(sig);
          
          try {
            // Phase 1: Smart Math Block Triage
            // Skip Mathpix if Google Vision confidence >= 90%
            const shouldSkipMathpix = mathBlock.confidence >= 0.9;
            
            if (shouldSkipMathpix) {
              mathBlock.mathpixLatex = mathBlock.googleVisionText;
            } else {
              // Crop the image to the math block
              const croppedBuffer = await sharp(imageBuffer)
                .extract(cropOptions)
                .png()
                .toBuffer();
              
              // Process with Mathpix
              const mathpixResult = await InlineMathpixService.processImage(croppedBuffer, {}, debug);
              mathpixCalls += 1;
              
              if (mathpixResult.latex_styled && !mathpixResult.error) {
                mathBlock.mathpixLatex = mathpixResult.latex_styled;
                mathBlock.mathpixConfidence = mathpixResult.confidence;  // NEW: Set mathpix confidence
                // DON'T overwrite mathBlock.confidence (keep original Google Vision confidence)
              } else {
                // Fallback to Google Vision text if Mathpix fails
                console.warn(`⚠️ Mathpix failed for block ${i + 1}, using Google Vision text`);
                mathBlock.mathpixLatex = mathBlock.googleVisionText;
                // No mathpixConfidence set (Mathpix failed)
              }
            }
            
            // Small delay to avoid rate limiting
            if (i < queue.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 200));
            }
            
          } catch (cropError) {
            console.error(`❌ Failed to crop math block ${i + 1}:`, cropError);
          }
        }
        
        // Update mathBlocks with the modified queue
        mathBlocks.splice(0, mathBlocks.length, ...queue);
        
      } catch (error) {
        console.error('❌ Mathpix processing failed:', error);
      }
    } else if (mathBlocks.length > 0) {
      // No Mathpix available, use Google Vision results directly
    }

    // Step 4: Combine results
    const processingTime = Date.now() - startTime;
    

    // Create final result from math blocks
    const finalText = mathBlocks.map(block => block.googleVisionText || block.mathpixLatex || '').join('\n');
    const finalBoundingBoxes = mathBlocks.map(block => ({
      text: block.googleVisionText || block.mathpixLatex || '',
      x: block.coordinates.x,
      y: block.coordinates.y,
      width: block.coordinates.width,
      height: block.coordinates.height,
      confidence: block.mathpixConfidence || block.confidence  // Use Mathpix confidence if available, fail fast if missing
    }));

    const finalConfidence = mathBlocks.reduce((sum, block) => sum + (block.mathpixConfidence || block.confidence), 0) / mathBlocks.length;
    const finalSymbols = mathBlocks.map(block => ({
      text: block.googleVisionText || block.mathpixLatex || '',
      boundingBox: [
        block.coordinates.x,
        block.coordinates.y,
        block.coordinates.width,
        block.coordinates.height
      ],
      confidence: block.mathpixConfidence || block.confidence
    }));

    // Get image dimensions
    const metadata = await sharp(imageBuffer).metadata();
    
    return {
      text: finalText,
      boundingBoxes: finalBoundingBoxes,
      confidence: finalConfidence,
      dimensions: { width: metadata.width || 0, height: metadata.height || 0 },
      symbols: finalSymbols,
      mathBlocks: mathBlocks,
      processingTime,
      rawResponse: {
        detectedBlocks,
        // Expose pre-cluster blocks for visualization
        preClusterBlocks
      },
      usage: { mathpixCalls }
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
    const mathpixStatus = InlineMathpixService.getServiceStatus();
    
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
    return !!process.env.GOOGLE_APPLICATION_CREDENTIALS && InlineMathpixService.isAvailable();
  }
}


