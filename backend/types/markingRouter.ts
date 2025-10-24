/**
 * Type definitions for marking router
 * Extracted from markingRouter.ts for better maintainability
 */

// Types for multi-page processing
export interface StandardizedPage {
  pageIndex: number;
  imageData: string;
  originalFileName?: string;
  width?: number;
  height?: number;
}

export interface PageOcrResult {
  pageIndex: number;
  ocrData: any;
  classificationText?: string;
}

// Types for segmentation
export interface MathBlock {
  googleVisionText: string;
  mathpixLatex?: string;
  confidence: number;
  mathpixConfidence?: number;
  mathLikenessScore: number;
  coordinates: { x: number; y: number; width: number; height: number };
  suspicious?: boolean;
  pageIndex?: number;
  globalBlockId?: string;
}

export interface MarkingTask {
  questionNumber: number | string;
  mathBlocks: MathBlock[];
  markingScheme: any | null; // Allow null for preliminary tasks
  sourcePages: number[];
}
