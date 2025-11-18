/**
 * Analysis Service Type Definitions
 */

export interface AnalysisRequest {
  sessionId: string;
  model: string;
  detectedQuestion?: any; // For unauthenticated users
}

export interface AnalysisResult {
  performance: {
    overallScore: string;      // "76/80"
    percentage: number;         // 95
    grade?: string;             // "9" or "A*"
    summary: string;            // AI-generated paragraph
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
      scoreText: string;
    };
    annotations: Array<{
      action: string;
      markCode?: string;
      text?: string;
    }>;
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
    paperTitle?: string;
  };
  grade?: string;
  pageScores?: { [pageIndex: number]: { awarded: number; total: number } };
}

