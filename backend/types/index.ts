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

// Google Cloud Vision types
export interface ProcessedVisionResult {
  text: string;
  boundingBoxes: BoundingBox[];
  confidence: number;
  dimensions: ImageDimensions;
  symbols: Array<{
    text: string;
    boundingBox: BoundingBox;
    confidence: number;
  }>;
  rawResponse?: any; // Raw Google Vision API response for math detection
}

// MyScript OCR types
export interface MyScriptResult {
  result: {
    parts: Array<{
      type: string;
      latex?: string;
      symbols?: Array<{
        label: string;
        boundingBox: {
          x: number;
          y: number;
          width: number;
          height: number;
        };
      }>;
    }>;
  };
}

export interface ProcessedMyScriptResult {
  text: string;
  boundingBoxes: BoundingBox[];
  confidence: number;
  dimensions: ImageDimensions;
}

// Image annotation types
export interface ImageAnnotation {
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
  annotations: ImageAnnotation[];
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

// Annotation and Marking Types
export interface Annotation {
  action: 'circle' | 'write' | 'tick' | 'cross' | 'underline' | 'comment';
  bbox: [number, number, number, number]; // [x, y, width, height]
  comment?: string; // Optional for marking actions
  text?: string; // For comment actions
}

export interface MarkingInstructions {
  annotations: Annotation[];
}

export interface ImageClassification {
  isQuestionOnly: boolean;
  reasoning: string;
  apiUsed: string;
  extractedQuestionText?: string;
}

export interface MarkingSchemeMatch {
  id: string;
  examDetails: {
    board: string;
    qualification: string;
    paperCode: string;
    tier: string;
    paper: string;
    date: string;
  };
  questionMarks?: any;
  totalQuestions: number;
  totalMarks: number;
  confidence?: number;
}

export interface ExamPaperMatch {
  board: string;
  qualification: string;
  paperCode: string;
  year: string;
  questionNumber?: string;
  confidence?: number;
  markingScheme?: MarkingSchemeMatch;
}

export interface QuestionDetectionResult {
  found: boolean;
  match?: ExamPaperMatch;
  message?: string;
}

// Chat message types
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  type?: 'chat' | 'marking_original' | 'marking_annotated' | 'follow_up';
  model?: ModelType;
  imageData?: string; // Keep for backward compatibility
  imageLink?: string; // Firebase Storage URL
  detectedQuestion?: { // NEW: Question detection info
    examDetails?: {
      board?: string;
      qualification?: string;
      paperCode?: string;
      tier?: string;
      paper?: string;
      date?: string;
    };
    questionNumber?: string;
    questionText?: string;
    confidence?: number;
  };
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  timestamp: Date;
  userId?: string;
  contextSummary?: string;
  lastSummaryUpdate?: Date;
  messageType?: 'Marking' | 'Question' | 'Chat';
}

// Subscription types
export interface UserSubscription {
  id: string;
  userId: string;
  email: string;
  planId: string;
  billingCycle: string;
  amount: number;
  currency: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: string;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSubscriptionData {
  userId: string;
  email: string;
  planId: string;
  billingCycle: string;
  amount: number;
  currency: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: string;
  currentPeriodStart: number;
  currentPeriodEnd: number;
}

export interface CreateChatSessionData {
  title: string;
  messages: ChatMessage[];
  userId?: string;
  messageType?: 'Marking' | 'Question' | 'Chat';
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
  isQuestionOnly?: boolean;
  result?: ProcessedImageResult;
  annotatedImage?: string | null;
  instructions?: MarkingInstructions;
  message?: string;
  apiUsed?: string;
  ocrMethod?: string;
  classification?: ImageClassification;
  questionDetection?: QuestionDetectionResult;
  sessionId?: string;
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
  public readonly code: string;
  
  constructor(message: string, code: string) {
    super(message);
    this.name = 'ImageProcessingError';
    this.code = code;
  }
}

export class OCRServiceError extends Error {
  public readonly code: string;
  
  constructor(message: string, code: string) {
    super(message);
    this.name = 'OCRServiceError';
    this.code = code;
  }
}

export class AIServiceError extends Error {
  public readonly code: string;
  
  constructor(message: string, code: string) {
    super(message);
    this.name = 'AIServiceError';
    this.code = code;
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
