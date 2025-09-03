/**
 * Question Detection Service
 * Matches extracted question text with exam papers in the database
 */

import { getFirestore } from '../config/firebase';

export interface ExamPaperMatch {
  board: string;
  qualification: string;
  paperCode: string;
  year: string;
  questionNumber?: string;
  confidence?: number;
}

export interface QuestionDetectionResult {
  found: boolean;
  match?: ExamPaperMatch;
  message?: string;
}

export class QuestionDetectionService {
  private static instance: QuestionDetectionService;
  private db: any;

  private constructor() {
    this.db = getFirestore();
  }

  public static getInstance(): QuestionDetectionService {
    if (!QuestionDetectionService.instance) {
      QuestionDetectionService.instance = new QuestionDetectionService();
    }
    return QuestionDetectionService.instance;
  }

  /**
   * Detect exam paper and question number from extracted question text
   */
  public async detectQuestion(
    extractedQuestionText: string
  ): Promise<QuestionDetectionResult> {
    try {
      console.log('🔍 Starting question detection for text:', extractedQuestionText?.substring(0, 100) + '...');

      if (!extractedQuestionText || extractedQuestionText.trim().length === 0) {
        return {
          found: false,
          message: 'No question text provided'
        };
      }

      // Get all exam papers from database
      const examPapers = await this.getAllExamPapers();
      console.log(`🔍 Found ${examPapers.length} exam papers in database`);

      if (examPapers.length === 0) {
        return {
          found: false,
          message: 'No exam papers found in database'
        };
      }

      // Try to match with each exam paper
      let bestMatch: ExamPaperMatch | null = null;
      let bestScore = 0;

      for (const examPaper of examPapers) {
        const match = await this.matchQuestionWithExamPaper(extractedQuestionText, examPaper);
        if (match && match.confidence && match.confidence > bestScore) {
          bestMatch = match;
          bestScore = match.confidence;
        }
      }

      if (bestMatch && bestScore > 0.3) { // Minimum confidence threshold
        console.log('✅ Found exam paper match:', bestMatch);
        return {
          found: true,
          match: bestMatch,
          message: `Matched with ${bestMatch.board} ${bestMatch.qualification} - ${bestMatch.paperCode} (${bestMatch.year})`
        };
      }

      console.log('❌ No suitable exam paper match found');
      return {
        found: false,
        message: 'No matching exam paper found'
      };

    } catch (error) {
      console.error('❌ Error in question detection:', error);
      return {
        found: false,
        message: `Detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Get all exam papers from the database
   */
  private async getAllExamPapers(): Promise<any[]> {
    try {
      if (!this.db) {
        console.log('⚠️ Firestore not available, using empty array');
        return [];
      }

      const snapshot = await this.db.collection('fullExamPapers').get();
      const examPapers: any[] = [];

      snapshot.forEach((doc: any) => {
        const data = doc.data();
        examPapers.push({
          id: doc.id,
          ...data
        });
      });

      return examPapers;
    } catch (error) {
      console.error('❌ Error fetching exam papers:', error);
      return [];
    }
  }

  /**
   * Match question text with a specific exam paper using fuzzy matching
   */
  private async matchQuestionWithExamPaper(
    questionText: string,
    examPaper: any
  ): Promise<ExamPaperMatch | null> {
    try {
      const questions = examPaper.questions || {};
      let bestQuestionMatch: string | null = null;
      let bestScore = 0;

      // Try to match with each question in the exam paper
      for (const [questionNumber, questionData] of Object.entries(questions)) {
        const questionContent = (questionData as any).text || (questionData as any).question || '';
        
        if (questionContent) {
          const similarity = this.calculateSimilarity(questionText, questionContent);
          
          if (similarity > bestScore) {
            bestScore = similarity;
            bestQuestionMatch = questionNumber;
          }
        }
      }

      // If we found a good match, return the exam paper info
      if (bestQuestionMatch && bestScore > 0.3) {
        return {
          board: examPaper.board || 'Unknown',
          qualification: examPaper.qualification || 'Unknown',
          paperCode: examPaper.paperCode || 'Unknown',
          year: examPaper.year || 'Unknown',
          questionNumber: bestQuestionMatch,
          confidence: bestScore
        };
      }

      return null;
    } catch (error) {
      console.error('❌ Error matching question with exam paper:', error);
      return null;
    }
  }

  /**
   * Calculate similarity between two strings using simple fuzzy matching
   * Returns a score between 0 and 1
   */
  private calculateSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;

    // Normalize strings
    const normalize = (str: string) => str.toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    const norm1 = normalize(str1);
    const norm2 = normalize(str2);

    if (norm1 === norm2) return 1.0;

    // Simple word-based similarity
    const words1 = norm1.split(' ');
    const words2 = norm2.split(' ');

    let commonWords = 0;
    const totalWords = Math.max(words1.length, words2.length);

    for (const word1 of words1) {
      for (const word2 of words2) {
        if (word1 === word2) {
          commonWords++;
          break;
        }
      }
    }

    const wordSimilarity = commonWords / totalWords;

    // Check for partial matches (substring matching)
    const partialMatch = norm1.includes(norm2) || norm2.includes(norm1);
    const partialScore = partialMatch ? 0.5 : 0;

    // Combine scores
    return Math.max(wordSimilarity, partialScore);
  }
}

// Export singleton instance
export const questionDetectionService = QuestionDetectionService.getInstance();
