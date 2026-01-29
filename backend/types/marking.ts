import type { ModelType, ProcessedImageResult, MarkingInstructions, EnrichedAnnotation } from './index.js';

/**
 * Normalized Marking Scheme Structure
 */
export interface NormalizedMarkingScheme {
    marks: any[];
    totalMarks: number;
    questionNumber: string;
    questionLevelAnswer?: string;
    marksWithAnswers?: any[];
    subQuestionNumbers?: string[];
    subQuestionMarks?: { [key: string]: any[] };
    subQuestionMaxScores?: { [subQuestion: string]: number };
    subQuestionAnswersMap?: { [subLabel: string]: string };
    subQuestionTexts?: { [subQuestion: string]: string };
    hasAlternatives?: boolean;
    alternativeMethod?: any;
    parentQuestionMarks?: number;
    isGeneric?: boolean;
    guidance?: any[];
}

/**
 * Inputs for the Marking Orchestrator
 */
export interface MarkingInputs {
    imageData?: string;
    images?: string[];
    model: ModelType;
    processedImage: ProcessedImageResult;
    questionDetection?: any;
    questionMarks?: any;
    totalMarks?: number;
    questionNumber?: string;
    questionText?: string | null;
    generalMarkingGuidance?: any;
    allPagesOcrData?: any[];
    sourceImageIndices?: number[];
    markingScheme?: any;
    extractedOcrText?: string;
    subQuestionPageMap?: Record<string, number[]>;
    allowedPageUnion?: number[];
    tracker?: any;
    pageDimensions?: Map<number, { width: number; height: number }>;
}

/**
 * Result of the marking execution
 */
export interface MarkingExecutionResult extends MarkingInstructions {
    usage?: {
        llmTokens: number;
        llmInputTokens: number;
        llmOutputTokens: number;
    };
    cleanedOcrText?: string;
    markingScheme?: any;
    schemeTextForPrompt?: string;
    overallPerformanceSummary?: string;
}

/**
 * Intermediate Annotation format used during processing
 */
export interface CoreAnnotation {
    id?: string;
    line_id?: string;
    globalBlockId?: string;
    text: string;
    mark?: string;
    score?: number;
    reason?: string;
    pageIndex?: number;
    subQuestion?: string;
    [key: string]: any;
}

/**
 * Final result format for a single question
 */
export interface QuestionResult {
    questionNumber: number | string;
    score: any;
    marks?: number; // Added
    totalMarks?: number; // Added
    studentAnswer?: string; // Added (used in MarkingExecutor)
    annotations: EnrichedAnnotation[];
    feedback?: string;
    usageTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    confidence?: number;
    mathpixCalls?: number;
    markingScheme?: any;
    studentWork?: string;
    promptMarkingScheme?: string;
    classificationBlocks?: any[];
    questionText?: string;
    databaseQuestionText?: string;
    pageIndex?: number;
    sourceImageIndices?: number[];
    overallPerformanceSummary?: string;
    cleanedOcrText?: string;
    rawAnnotations?: any[];
    semanticZones?: any;
}
