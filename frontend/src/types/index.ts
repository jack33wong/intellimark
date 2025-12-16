/**
 * Type definitions barrel export
 * 
 * This file now only exports auto-generated types from the API spec.
 * All types are generated from backend/types/index.ts via OpenAPI.
 */

// Import and re-export auto-generated types from API spec
import type { components } from './api';
export type { components };

export type DetectedQuestion = components['schemas']['DetectedQuestion'];
export type UnifiedMessage = components['schemas']['UnifiedMessage'];
export type UnifiedSession = components['schemas']['UnifiedSession'];
export type MarkHomeworkRequest = components['schemas']['MarkHomeworkRequest'];
export type MarkHomeworkResponse = components['schemas']['MarkHomeworkResponse'];
export type ChatRequest = components['schemas']['ChatRequest'];
export type ChatResponse = components['schemas']['ChatResponse'];

// Re-export payment types (these are frontend-specific)
export * from './payment';

/**
 * MANUAL OVERRIDES (Temporary until next API generation)
 */
export interface Mark {
    code: string;              // "M0", "M1", "A0", "C1", "P1"
    icon: string;              // "tick", "cross"
    reasoning: string;         // Feedback text
    stepId?: string;
    unifiedStepId?: string;
}

export interface QuestionPart {
    part: string;              // "", "a", "b", "ai", "aii" (empty = main question)
    work: string;              // Student's work for this part
    marks: Mark[];             // All marks for this part
}

export interface MarkingContextQuestionResult {
    number: string;            // "1", "8", "21"
    text: string;              // Question text
    scheme: string;            // Marking scheme
    totalMarks: number;
    earnedMarks: number;
    hasScheme: boolean;
    pageIndex?: number;
    parts: QuestionPart[];     // Clean nested structure
}


export interface MarkingContext {
    sessionType: 'Marking' | 'Question' | 'Mixed';
    totalQuestionsMarked: number;
    overallScore: {
        awarded: number;
        total: number;
        percentage: number;
        scoreText: string;
    };
    examInfo?: {
        examBoard: string;
        subject: string;
        examCode: string;
        examSeries: string;
        tier: string;
        totalMarks: number;
    };
    questionResults: MarkingContextQuestionResult[];
}