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
export interface MarkingContextQuestionResult {
    questionNumber: string;
    questionText: string;
    totalMarks: number;
    awardedMarks: number;
    scoreText: string;
    hasMarkingScheme: boolean;
    pageIndex?: number; // Added to support Smart Navigation
    annotationCount: number;
    annotations: Array<{
        text: string;
        action: string;
        reasoning?: string;
        studentText?: string;
        sourceType?: string;
        step_id?: string;
        unified_step_id?: string;
    }>;
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