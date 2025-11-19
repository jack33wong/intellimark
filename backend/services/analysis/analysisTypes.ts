/**
 * Analysis Service Type Definitions
 */

export interface AnalysisRequest {
  sessionId?: string; // Single session (legacy support)
  sessionIds?: string[]; // Multiple sessions for subject grouping
  subject?: string; // Subject name (e.g., "Mathematics", "Physics")
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
  topicAnalysis: Array<{
    topic: string;
    performance: 'strong' | 'weak' | 'average';
    score: string;
    recommendation: string;
  }>;
  recommendations: {
    immediate: string[];        // Immediate action items
    studyFocus: string[];       // Areas to focus on
    practiceAreas: string[];    // Specific practice needed
  };
  nextSteps: string[];          // Actionable next steps
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

