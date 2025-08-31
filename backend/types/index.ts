/**
 * Core type definitions for the Mark Homework System
 */

// Image processing types
export interface ImageDimensions {
  width: number;
  height: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  confidence?: number;
}

export interface ProcessedImageResult {
  ocrText: string;
  boundingBoxes: BoundingBox[];
  confidence: number;
  imageDimensions: ImageDimensions;
  isQuestion?: boolean;
}

// Mathpix OCR types
export interface MathpixResult {
  text: string;
  data: Array<{
    type: string;
    value: string;
    confidence: number;
    bbox: [number, number, number, number];
  }>;
  word_data?: Array<{
    text: string;
    confidence: number;
    cnt: number[][];
  }>;
  confidence: number;
  width: number;
  height: number;
}

export interface ProcessedMathpixResult {
  text: string;
  boundingBoxes: BoundingBox[];
  confidence: number;
  dimensions: ImageDimensions;
}

// Image annotation types
export interface Annotation {
  position: {
    x: number;
    y: number;
  };
  comment: string;
  hasComment: boolean;
  boundingBox?: BoundingBox;
}

export interface ImageAnnotationResult {
  originalImage: string;
  annotatedImage: string;
  annotations: Annotation[];
  svgOverlay: string;
}

// AI model types
export type ModelType = 'gemini-2.5-pro' | 'chatgpt-5' | 'chatgpt-4o';

export interface AIModelConfig {
  name: string;
  apiEndpoint: string;
  maxTokens: number;
  temperature: number;
  model?: string;
  maxCompletionTokens?: number;
}

export interface AIModelResponse {
  content: string;
  model: ModelType;
  confidence?: number;
  processingTime?: number;
}

// Chat message types
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  model?: ModelType;
  imageData?: string;
}

export interface ChatHistory {
  messages: ChatMessage[];
  sessionId: string;
  userId?: string;
}

// API request/response types
export interface MarkHomeworkRequest {
  imageData: string;
  model: ModelType;
  additionalInstructions?: string;
}

export interface MarkHomeworkResponse {
  success: boolean;
  result?: ProcessedImageResult;
  annotatedImage?: string;
  error?: string;
}

export interface ChatRequest {
  message: string;
  model: ModelType;
  imageData?: string;
  sessionId?: string;
  history?: ChatMessage[];
}

export interface ChatResponse {
  success: boolean;
  message?: ChatMessage;
  error?: string;
}

// Error types
export class ImageProcessingError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'ImageProcessingError';
  }
}

export class OCRServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'OCRServiceError';
  }
}

export class AIServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'AIServiceError';
  }
}

// Utility types
export type Result<T, E = Error> = 
  | { success: true; data: T }
  | { success: false; error: E };

export interface ProcessingOptions {
  enablePreprocessing?: boolean;
  maxImageSize?: number;
  compressionQuality?: number;
  enableAnnotations?: boolean;
}
