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
  markingScheme?: MarkingSchemeMatch;
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
      console.log('🔍 ===== QUESTION DETECTION SERVICE =====');
      console.log('🔍 Input text length:', extractedQuestionText?.length || 0);
      console.log('🔍 Input text preview:', extractedQuestionText?.substring(0, 200) + (extractedQuestionText?.length > 200 ? '...' : ''));
      console.log('🔍 Full input text:', extractedQuestionText);

      if (!extractedQuestionText || extractedQuestionText.trim().length === 0) {
        return {
          found: false,
          message: 'No question text provided'
        };
      }

      // Get all exam papers from database
      const examPapers = await this.getAllExamPapers();
      console.log(`🔍 Found ${examPapers.length} exam papers in database`);
      
      if (examPapers.length > 0) {
        console.log('🔍 Sample exam paper structure:', {
          id: examPapers[0].id,
          hasMetadata: !!examPapers[0].metadata,
          hasQuestions: !!examPapers[0].questions,
          questionsType: Array.isArray(examPapers[0].questions) ? 'array' : 'object',
          questionsCount: Array.isArray(examPapers[0].questions) ? examPapers[0].questions.length : Object.keys(examPapers[0].questions || {}).length
        });
      }

      if (examPapers.length === 0) {
        return {
          found: false,
          message: 'No exam papers found in database'
        };
      }

      // Try to match with each exam paper
      let bestMatch: ExamPaperMatch | null = null;
      let bestScore = 0;

      console.log('🔍 Starting question matching process...');
      for (const examPaper of examPapers) {
        const match = await this.matchQuestionWithExamPaper(extractedQuestionText, examPaper);
        if (match && match.confidence && match.confidence > bestScore) {
          console.log(`🔍 New best match found: ${match.board} ${match.qualification} - ${match.paperCode} (${match.year}) Question ${match.questionNumber} - Confidence: ${match.confidence}`);
          bestMatch = match;
          bestScore = match.confidence;
        }
      }

      if (bestMatch && bestScore > 0.1) { // Lower confidence threshold for testing
        console.log('✅ Found exam paper match:', bestMatch);
        
        // Try to find corresponding marking scheme
        const markingScheme = await this.findCorrespondingMarkingScheme(bestMatch);
        if (markingScheme) {
          bestMatch.markingScheme = markingScheme;
          console.log('✅ Found corresponding marking scheme:', markingScheme.id);
        } else {
          console.log('⚠️ No corresponding marking scheme found');
        }
        
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
      // Handle both array and object structures
      if (Array.isArray(questions)) {
        // Handle array structure: questions = [{ question_number: "1", question_text: "...", sub_questions: [...] }]
        for (const question of questions) {
          const questionNumber = question.question_number || question.number;
          const questionContent = question.question_text || question.text || question.question || '';
          
          if (questionContent && questionNumber) {
            const similarity = this.calculateSimilarity(questionText, questionContent);
            
            if (similarity > bestScore) {
              bestScore = similarity;
              bestQuestionMatch = questionNumber;
            }
          }
        }
      } else {
        // Handle object structure: questions = { "1": { text: "..." } }
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
      }

      // If we found a good match, return the exam paper info
      if (bestQuestionMatch && bestScore > 0.3) {
        // Handle different data structures
        const metadata = examPaper.metadata || {};
        const board = metadata.exam_board || examPaper.board || 'Unknown';
        const qualification = metadata.subject || examPaper.qualification || 'Unknown';
        const paperCode = metadata.exam_code || examPaper.paperCode || 'Unknown';
        const year = metadata.year || examPaper.year || 'Unknown';
        
        return {
          board: board,
          qualification: qualification,
          paperCode: paperCode,
          year: year,
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
   * Find corresponding marking scheme for an exam paper match
   */
  private async findCorrespondingMarkingScheme(examPaperMatch: ExamPaperMatch): Promise<MarkingSchemeMatch | null> {
    try {
      console.log('🔍 Searching for marking scheme for:', examPaperMatch);
      
      if (!this.db) {
        console.log('⚠️ Firestore not available for marking scheme search');
        return null;
      }

      const snapshot = await this.db.collection('markingSchemes').get();
      const markingSchemes: any[] = [];

      snapshot.forEach((doc: any) => {
        const data = doc.data();
        markingSchemes.push({
          id: doc.id,
          ...data
        });
      });

      console.log(`🔍 Found ${markingSchemes.length} marking schemes in database`);

      // Try to match marking scheme with exam paper
      for (const markingScheme of markingSchemes) {
        const match = this.matchMarkingSchemeWithExamPaper(examPaperMatch, markingScheme);
        if (match) {
          console.log('✅ Found matching marking scheme:', markingScheme.id);
          return match;
        }
      }

      console.log('❌ No matching marking scheme found');
      return null;
    } catch (error) {
      console.error('❌ Error finding marking scheme:', error);
      return null;
    }
  }

  /**
   * Match marking scheme with exam paper
   */
  private matchMarkingSchemeWithExamPaper(examPaperMatch: ExamPaperMatch, markingScheme: any): MarkingSchemeMatch | null {
    try {
      const examDetails = markingScheme.examDetails || markingScheme.markingSchemeData?.examDetails || {};
      
      // Match by board, qualification, paper code, and year
      const boardMatch = this.calculateSimilarity(examPaperMatch.board, examDetails.board || '');
      const qualificationMatch = this.calculateSimilarity(examPaperMatch.qualification, examDetails.qualification || '');
      const paperCodeMatch = this.calculateSimilarity(examPaperMatch.paperCode, examDetails.paperCode || '');
      const yearMatch = this.calculateSimilarity(examPaperMatch.year, examDetails.date || examDetails.year || '');
      
      // Calculate overall match score
      const overallScore = (boardMatch + qualificationMatch + paperCodeMatch + yearMatch) / 4;
      
      console.log(`🔍 Marking scheme match scores for ${markingScheme.id}:`, {
        board: boardMatch,
        qualification: qualificationMatch,
        paperCode: paperCodeMatch,
        year: yearMatch,
        overall: overallScore
      });
      
      if (overallScore > 0.7) { // High confidence threshold for marking scheme matching
        // Get question marks for the specific question if available
        let questionMarks = null;
        if (examPaperMatch.questionNumber && markingScheme.markingSchemeData?.questions) {
          const questions = markingScheme.markingSchemeData.questions;
          questionMarks = questions[examPaperMatch.questionNumber] || null;
        }
        
        return {
          id: markingScheme.id,
          examDetails: {
            board: examDetails.board || 'Unknown',
            qualification: examDetails.qualification || 'Unknown',
            paperCode: examDetails.paperCode || 'Unknown',
            tier: examDetails.tier || 'Unknown',
            paper: examDetails.paper || 'Unknown',
            date: examDetails.date || 'Unknown'
          },
          questionMarks: questionMarks,
          totalQuestions: markingScheme.totalQuestions || 0,
          totalMarks: markingScheme.totalMarks || 0,
          confidence: overallScore
        };
      }
      
      return null;
    } catch (error) {
      console.error('❌ Error matching marking scheme:', error);
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
