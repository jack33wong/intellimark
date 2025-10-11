/**
 * Question Detection Service
 * Matches extracted question text with exam papers in the database
 */

import { getFirestore } from '../config/firebase.js';

// Common function to convert full subject names to short forms
function getShortSubjectName(qualification: string): string {
  const subjectMap: { [key: string]: string } = {
    'MATHEMATICS': 'MATHS',
    'PHYSICS': 'PHYSICS',
    'CHEMISTRY': 'CHEMISTRY',
    'BIOLOGY': 'BIOLOGY',
    'ENGLISH': 'ENGLISH',
    'ENGLISH LITERATURE': 'ENG LIT',
    'HISTORY': 'HISTORY',
    'GEOGRAPHY': 'GEOGRAPHY',
    'FRENCH': 'FRENCH',
    'SPANISH': 'SPANISH',
    'GERMAN': 'GERMAN',
    'COMPUTER SCIENCE': 'COMP SCI',
    'ECONOMICS': 'ECONOMICS',
    'PSYCHOLOGY': 'PSYCHOLOGY',
    'SOCIOLOGY': 'SOCIOLOGY',
    'BUSINESS STUDIES': 'BUSINESS',
    'ART': 'ART',
    'DESIGN AND TECHNOLOGY': 'D&T',
    'MUSIC': 'MUSIC',
    'PHYSICAL EDUCATION': 'PE',
    // Handle reverse mappings for short forms that might be in database
    'CHEM': 'CHEMISTRY',
    'PHYS': 'PHYSICS'
  };
  
  const upperQualification = qualification.toUpperCase();
  return subjectMap[upperQualification] || qualification;
}

export interface ExamPaperMatch {
  board: string;
  qualification: string;
  paperCode: string;
  year: string;
  tier?: string;  // Add tier field
  questionNumber?: string;
  subQuestionNumber?: string;  // Optional sub-question number if matched
  marks?: number;  // Total marks for this question
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
  markingScheme?: string;
  questionText?: string;
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
      if (!extractedQuestionText || extractedQuestionText.trim().length === 0) {
        return {
          found: false,
          message: 'No question text provided'
        };
      }

      // Get all exam papers from database
      const examPapers = await this.getAllExamPapers();
      
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

      if (bestMatch) {
        // Try to find corresponding marking scheme
        const markingScheme = await this.findCorrespondingMarkingScheme(bestMatch);
        if (markingScheme) {
          bestMatch.markingScheme = markingScheme;
        }
        
        return {
          found: true,
          match: bestMatch,
          message: `Matched with ${bestMatch.board} ${getShortSubjectName(bestMatch.qualification)} - ${bestMatch.paperCode} (${bestMatch.year})`
        };
      }

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
      let bestSubQuestionNumber = '';
      let bestMatchedQuestion: any = null;
      
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
              bestMatchedQuestion = question;
              bestSubQuestionNumber = ''; // Reset sub-question
              
              // Check for sub-questions
              const subQuestions = question.sub_questions || question.subQuestions || [];
              if (subQuestions.length > 0) {
                // Try to match with sub-questions
                for (const subQ of subQuestions) {
                  const subQuestionText = subQ.text || subQ.question || subQ.sub_question || '';
                  const subQuestionNumber = subQ.number || subQ.sub_question_number || subQ.id || '';
                  if (subQuestionText && subQuestionNumber) {
                    const subSimilarity = this.calculateSimilarity(questionText, subQuestionText);
                    if (subSimilarity > 0.6) { // Lower threshold for sub-questions
                      bestSubQuestionNumber = subQuestionNumber;
                      break;
                    }
                  }
                }
              }
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
              bestMatchedQuestion = questionData;
              bestSubQuestionNumber = ''; // Reset sub-question
              
              // Check for sub-questions in object structure
              const subQuestions = (questionData as any).sub_questions || (questionData as any).subQuestions || [];
              if (subQuestions.length > 0) {
                for (const subQ of subQuestions) {
                  const subQuestionText = subQ.text || subQ.question || subQ.sub_question || '';
                  const subQuestionNumber = subQ.number || subQ.sub_question_number || subQ.id || '';
                  if (subQuestionText && subQuestionNumber) {
                    const subSimilarity = this.calculateSimilarity(questionText, subQuestionText);
                    if (subSimilarity > 0.6) {
                      bestSubQuestionNumber = subQuestionNumber;
                      break;
                    }
                  }
                }
              }
            }
          }
        }
      }

      // If we found a good match, return the exam paper info
      if (bestQuestionMatch && bestScore > 0.5) {
        // Handle different data structures
        const metadata = examPaper.metadata || {};
        const exam = examPaper.exam || {};
        const board = metadata.exam_board || exam.board || examPaper.board || 'Unknown';
        const qualification = metadata.subject || examPaper.qualification || 'Unknown';
        const paperCode = metadata.exam_code || exam.code || examPaper.paperCode || 'Unknown';
        const year = metadata.year || examPaper.year || 'Unknown';
        const tier = exam.tier || metadata.tier || '';
        
        // Extract marks for the matched question
        if (!bestMatchedQuestion) {
          throw new Error(`Question ${bestQuestionMatch} not found in exam paper`);
        }
        const questionMarks = bestMatchedQuestion.marks;
        
        return {
          board: board,
          qualification: qualification,
          paperCode: paperCode,
          year: year,
          tier: tier,
          questionNumber: bestQuestionMatch,
          subQuestionNumber: bestSubQuestionNumber || undefined,
          marks: questionMarks,
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
      if (!this.db) {
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

      // Try to match marking scheme with exam paper
      for (const markingScheme of markingSchemes) {
        const match = this.matchMarkingSchemeWithExamPaper(examPaperMatch, markingScheme);
        if (match) {
          return match;
        }
      }

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

    // Enhanced normalization - remove diagram descriptions and extra details
    const normalize = (str: string) => str.toLowerCase()
      .replace(/\[.*?\]/g, '') // Remove [diagram description] blocks
      .replace(/diagram description.*?\./g, '') // Remove diagram descriptions
      .replace(/supplementary info.*?\./g, '') // Remove supplementary info
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    const norm1 = normalize(str1);
    const norm2 = normalize(str2);

    if (norm1 === norm2) return 1.0;

    // Extract key phrases that should match
    const keyPhrases1 = this.extractKeyPhrases(norm1);
    const keyPhrases2 = this.extractKeyPhrases(norm2);

    // Calculate key phrase similarity (higher weight)
    const keyPhraseScore = this.calculateKeyPhraseSimilarity(keyPhrases1, keyPhrases2);

    // Word-based similarity with fuzzy matching (Levenshtein)
    const words1 = norm1.split(' ');
    const words2 = norm2.split(' ');

    let matchedCount = 0;
    const usedWord2Indexes: Set<number> = new Set();
    const matchedWord2Indexes: Array<number | null> = [];
    const totalWords = Math.max(words1.length, words2.length);

    for (let i = 0; i < words1.length; i++) {
      const queryWord = words1[i];
      let foundExact = false;

      for (let j = 0; j < words2.length; j++) {
        if (usedWord2Indexes.has(j)) continue;
        if (queryWord === words2[j]) {
          usedWord2Indexes.add(j);
          matchedCount++;
          matchedWord2Indexes.push(j);
          foundExact = true;
          break;
        }
      }

      if (foundExact) continue;

      // Fuzzy match using Levenshtein distance
      for (let j = 0; j < words2.length; j++) {
        if (usedWord2Indexes.has(j)) continue;
        const candidateWord = words2[j];
        const maxLen = Math.max(queryWord.length, candidateWord.length);
        const threshold = Math.floor(maxLen / 5); // heuristic: word length / 5
        const distance = this.levenshteinDistance(queryWord, candidateWord);
        if (distance <= threshold) {
          usedWord2Indexes.add(j);
          matchedCount++;
          matchedWord2Indexes.push(j);
          break;
        }
      }

      // If no match found for this query word, record null to maintain order tracking
      if (matchedWord2Indexes.length < i + 1) {
        matchedWord2Indexes.push(null);
      }
    }

    const wordSimilarity = totalWords === 0 ? 0 : matchedCount / totalWords;

    // Order-based score: reward longest run of consecutive, in-order matches
    let longestRun = 0;
    let currentRun = 0;
    let prevJ: number | null = null;
    for (const j of matchedWord2Indexes) {
      if (j === null) {
        currentRun = 0;
        prevJ = null;
        continue;
      }
      if (prevJ !== null && j === prevJ + 1) {
        currentRun += 1;
      } else {
        currentRun = 1;
      }
      longestRun = Math.max(longestRun, currentRun);
      prevJ = j;
    }
    const orderScore = totalWords === 0 ? 0 : longestRun / totalWords;

    // Combine scores with weighted approach
    // Key phrases get 40% weight, word similarity gets 40%, order gets 20%
    const combinedScore = (keyPhraseScore * 0.4) + (wordSimilarity * 0.4) + (orderScore * 0.2);
    
    return Math.max(combinedScore, wordSimilarity, orderScore);
  }

  /**
   * Extract key phrases from question text that are important for matching
   */
  private extractKeyPhrases(text: string): string[] {
    const phrases: string[] = [];
    
    // Common question patterns
    const patterns = [
      /work out how much/g,
      /work out the/g,
      /find the/g,
      /calculate the/g,
      /show that/g,
      /prove that/g,
      /solve the/g,
      /write down/g,
      /draw a/g,
      /complete the/g
    ];
    
    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        phrases.push(...matches);
      }
    }
    
    // Extract numbers and units
    const numberPatterns = [
      /\d+\s*m²/g,
      /\d+\s*£/g,
      /\d+\s*pounds/g,
      /\d+\s*per\s+\w+/g,
      /\d+\s*bags/g,
      /\d+\s*seeds/g
    ];
    
    for (const pattern of numberPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        phrases.push(...matches);
      }
    }
    
    return phrases.map(p => p.toLowerCase().trim());
  }

  /**
   * Calculate similarity based on key phrases
   */
  private calculateKeyPhraseSimilarity(phrases1: string[], phrases2: string[]): number {
    if (phrases1.length === 0 && phrases2.length === 0) return 1.0;
    if (phrases1.length === 0 || phrases2.length === 0) return 0.0;
    
    let matchedPhrases = 0;
    const usedPhrases2: Set<number> = new Set();
    
    for (const phrase1 of phrases1) {
      for (let i = 0; i < phrases2.length; i++) {
        if (usedPhrases2.has(i)) continue;
        if (phrase1 === phrases2[i]) {
          matchedPhrases++;
          usedPhrases2.add(i);
          break;
        }
      }
    }
    
    return matchedPhrases / Math.max(phrases1.length, phrases2.length);
  }

  /**
   * Compute Levenshtein edit distance between two strings
   */
  private levenshteinDistance(a: string, b: string): number {
    const lenA = a.length;
    const lenB = b.length;
    if (lenA === 0) return lenB;
    if (lenB === 0) return lenA;

    const dp: number[] = new Array(lenB + 1);
    for (let j = 0; j <= lenB; j++) dp[j] = j;

    for (let i = 1; i <= lenA; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= lenB; j++) {
        const temp = dp[j];
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[j] = Math.min(
          dp[j] + 1,        // deletion
          dp[j - 1] + 1,    // insertion
          prev + cost       // substitution
        );
        prev = temp;
      }
    }
    return dp[lenB];
  }
}

// Export singleton instance
export const questionDetectionService = QuestionDetectionService.getInstance();
