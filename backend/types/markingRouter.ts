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
  ocrSource?: string; // 'primary' (Mathpix) or 'fallback' (Google Vision)
  hasLineData?: boolean; // true if Mathpix provided line-level coords, false if estimated
}

export interface MarkingTask {
  questionNumber: number | string;
  mathBlocks: MathBlock[];
  markingScheme: any | null; // Allow null for preliminary tasks
  sourcePages: number[];
  classificationStudentWork?: string | null; // Student work extracted by classification (may include [DRAWING])
  pageDimensions?: Map<number, { width: number; height: number }>; // Map of pageIndex -> dimensions for accurate bbox estimation
  blockToClassificationMap?: Map<string, { classificationLine: string; similarity: number; questionNumber?: string; subQuestionPart?: string }>; // OCR block → classification line mapping (resolved, one-to-one)
}
