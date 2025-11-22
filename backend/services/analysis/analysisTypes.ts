/**
 * Analysis Service Type Definitions
 */

export interface AnalysisRequest {
  sessionId?: string; // Single session (legacy support)
  sessionIds?: string[]; // Multiple sessions for subject grouping
  subject?: string; // Subject name (e.g., "Mathematics", "Physics")
  qualification?: string; // "GCSE", "A-Level"
  examBoard?: string; // "Pearson Edexcel", "AQA"
  paperCodeSet?: string[]; // ["1H", "2H", "3H"] - Filter by paper code set
  model: string;
  detectedQuestion?: any; // For unauthenticated users
}

export interface AnalysisResult {
  performance: {
    overallScore: string;      // "76/80"
    percentage: number;         // 95
    grade?: string;             // "9" or "A*"
    averageGrade?: string;      // Average grade (most common)
    summary: string;            // AI-generated paragraph
    gradeAnalysis?: string;     // Strategic grade improvement analysis
  };
  strengths: string[];          // AI-identified strengths
  weaknesses: string[];         // AI-identified weaknesses
}

export interface MarkingDataForAnalysis {
  questionResults: Array<{
    questionNumber: string;
    score: {
      awardedMarks: number;
      totalMarks: number;
    };
  }>;
  overallScore: {
    awarded: number;
    total: number;
    percentage: number;
  };
  examMetadata: {
    examBoard?: string;
    examCode?: string;
    examSeries?: string;
    subject?: string;
    tier?: string;
  };
  grade?: string; // Highest grade
  averageGrade?: string; // Average grade (most common)
  sessionCount?: number; // Number of sessions analyzed
  pageScores?: { [pageIndex: number]: { awarded: number; total: number } };
  gradeBoundaries?: {
    boundaries: { [grade: string]: number };
    boundaryType: 'Paper-Specific' | 'Overall-Total';
  };
}

