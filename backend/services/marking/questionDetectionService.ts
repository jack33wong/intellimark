/**
 * Question Detection Service
 * Matches extracted question text with exam papers in the database
 */

import { getFirestore } from '../../config/firebase.js';
import { normalizeTextForComparison } from '../../utils/TextNormalizationUtils.js';

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
  marks?: number;  // Total marks for this question (sub-question marks if matched, parent question marks if main question)
  parentQuestionMarks?: number;  // Parent question marks (for sub-questions, this is the total marks for the parent question)
  confidence?: number;
  markingScheme?: MarkingSchemeMatch;
  databaseQuestionText?: string;  // Database question text for filtering OCR blocks
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
   * @param extractedQuestionText - The question text extracted by classification
   * @param questionNumberHint - Optional question number hint from classification (e.g., "1", "2", "21")
   */
  public async detectQuestion(
    extractedQuestionText: string,
    questionNumberHint?: string | null
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
        const metadata = examPaper.metadata;
        const paperCode = metadata?.exam_code || 'unknown';
        const is1MA1_1H = paperCode === '1MA1/1H' || paperCode.includes('1MA1/1H');
        
        const match = await this.matchQuestionWithExamPaper(extractedQuestionText, examPaper, questionNumberHint);
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
   * @param questionText - The extracted question text from classification
   * @param examPaper - The exam paper to match against
   * @param questionNumberHint - Optional question number hint from classification (e.g., "1", "2", "21")
   */
  private async matchQuestionWithExamPaper(
    questionText: string,
    examPaper: any,
    questionNumberHint?: string | null
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
          if (!questionNumber) continue; // Skip if no question number
          
          const questionContent = question.question_text || question.text || question.question || '';
          const subQuestions = question.sub_questions || question.subQuestions || [];
          
          // Unified path: Handle all cases (with or without main question text)
          // Database structure: questions always have question_number, may have question_text, may have sub_questions
          const metadata = examPaper.metadata;
          const paperCode = metadata?.exam_code || 'unknown';
          
          // Determine if hint is a sub-question (e.g., "2a", "2b", "12i", "12ii", "12iii") or main question (e.g., "2")
          const isSubQuestionHint = questionNumberHint && /[a-z]/i.test(questionNumberHint);
          // Extract base question number by extracting leading digits (more reliable than removing letters)
          // Examples: "12ii" -> "12", "12iii" -> "12", "2a" -> "2", "21" -> "21"
          const baseQuestionNumberMatch = String(questionNumber).match(/^\d+/);
          const baseQuestionNumber = baseQuestionNumberMatch ? baseQuestionNumberMatch[0] : '';
          const baseHintMatch = questionNumberHint ? String(questionNumberHint).match(/^\d+/) : null;
          const baseHint = baseHintMatch ? baseHintMatch[0] : '';
          
          // Validate base number extraction
          if (isSubQuestionHint && baseHint === '') {
            console.error(`[QUESTION DETECTION] ❌ Failed to extract base number from hint "${questionNumberHint}". This should not happen for sub-question hints.`);
          }
          
          // Match hierarchically: sub-question to sub-question, main to main
          // If hint is a sub-question (e.g., "2a"), only match against main questions with matching base number
          // Then check sub-questions of that main question
          // If hint is a main question (e.g., "2"), only match against main questions
          if (isSubQuestionHint) {
            // For sub-question hints, only consider if base question numbers match
            if (baseQuestionNumber !== baseHint) {
              continue; // Skip this question - different base number
            }
            // Q12 debugging: log that we passed base number check
            if (questionNumberHint?.startsWith('12')) {
              console.log(`[Q12 DEBUG] ✅ Base number match: Q${questionNumber} (base=${baseQuestionNumber})`);
            }
          } else if (questionNumberHint) {
            // For main question hints, only match exact question numbers
            if (questionNumber !== questionNumberHint) {
              continue; // Skip this question - different question number
            }
          }
          
          // If hint is a sub-question (e.g., "2a", "12i"), match against sub-questions only
          if (isSubQuestionHint) {
            const subQuestions = question.sub_questions || question.subQuestions || [];
            
            // Extract sub-question part from hint (e.g., "a" from "2a", "i" from "12i", "i" from "12(i)")
            // Normalize: remove parentheses and convert to lowercase for matching
            let hintSubPart = questionNumberHint.replace(/^\d+/, '').toLowerCase();
            // Remove parentheses if present (e.g., "(i)" -> "i", "(ii)" -> "ii")
            hintSubPart = hintSubPart.replace(/^\(|\)$/g, '');
            
            // Q12 debugging: log what we're looking for
            if (questionNumber === '12' || questionNumberHint?.startsWith('12')) {
              console.log(`[Q12 DEBUG] Looking for sub-question part: "${hintSubPart}" in Q${questionNumber} (${subQuestions.length} sub-questions)`);
            }
            
            if (subQuestions.length > 0) {
              // Match against the specific sub-question part
              for (const subQ of subQuestions) {
                const subQuestionText = subQ.text || subQ.question || subQ.question_text || subQ.sub_question || '';
                // Use ONLY question_part - fail fast if missing
                if (!subQ.question_part) {
                  console.error(`[QUESTION DETECTION] ❌ Sub-question missing question_part field. Expected structure: sub_questions[].question_part`);
                  continue; // Skip this sub-question - invalid structure
                }
                const subQuestionPart = String(subQ.question_part).toLowerCase();
                
                // Q12 debugging: log each sub-question we check
                if (questionNumber === '12' || questionNumberHint?.startsWith('12')) {
                  console.log(`[Q12 DEBUG] Checking sub-question part: "${subQuestionPart}" vs hint "${hintSubPart}"`);
                }
                
                // Only match if sub-question parts match (e.g., "a" matches "a", "i" matches "i")
                if (subQuestionPart !== hintSubPart) {
                  continue;
                }
                
                if (!subQuestionText) {
                  continue;
                }
                
                // Calculate similarity for sub-question text
                const subSimilarity = this.calculateSimilarity(questionText, subQuestionText);
                
                // Q12 debugging: log similarity score and actual texts
                if (questionNumber === '12' || questionNumberHint?.startsWith('12')) {
                  console.log(`[Q12 DEBUG] ✅ Matched sub-question part "${subQuestionPart}" with similarity: ${subSimilarity.toFixed(3)}`);
                  console.log(`[Q12 DEBUG]   Classification text: "${questionText.substring(0, 100)}"`);
                  console.log(`[Q12 DEBUG]   Database text: "${subQuestionText.substring(0, 100)}"`);
                  // Use shared normalization utility for debug logging (same as actual comparison)
                  const norm1 = normalizeTextForComparison(questionText);
                  const norm2 = normalizeTextForComparison(subQuestionText);
                  console.log(`[Q12 DEBUG]   Normalized classification: "${norm1}"`);
                  console.log(`[Q12 DEBUG]   Normalized database: "${norm2}"`);
                  console.log(`[Q12 DEBUG]   Normalized match: ${norm1 === norm2}`);
                }
                
                if (subSimilarity > bestScore) {
                  bestScore = subSimilarity;
                  bestQuestionMatch = questionNumber;
                  bestMatchedQuestion = question;
                  bestSubQuestionNumber = subQuestionPart;
                }
              }
            } else {
              // Q12 debugging: no sub-questions found
              if (questionNumber === '12' || questionNumberHint?.startsWith('12')) {
                console.log(`[Q12 DEBUG] ⚠️ Q${questionNumber} has no sub_questions array`);
              }
            }
          } else {
            // Hint is a main question (e.g., "2"), match against main question text only
            // Only match if main question text exists
            if (questionContent) {
              const similarity = this.calculateSimilarity(questionText, questionContent);
              
              if (similarity > bestScore) {
                bestScore = similarity;
                bestQuestionMatch = questionNumber;
                bestMatchedQuestion = question;
                bestSubQuestionNumber = ''; // Reset sub-question
              }
            }
          }
        }
      } else {
        // Handle object structure: questions = { "1": { text: "..." } }
        for (const [questionNumber, questionData] of Object.entries(questions)) {
          const questionContent = (questionData as any).text || (questionData as any).question || '';
          
          if (questionContent) {
            const isSubQuestionHint = questionNumberHint && /[a-z]/i.test(questionNumberHint);
            // Extract base question number by extracting leading digits (more reliable than removing letters)
            // Examples: "12ii" -> "12", "12iii" -> "12", "2a" -> "2", "21" -> "21"
            const baseQuestionNumberMatch = String(questionNumber).match(/^\d+/);
            const baseQuestionNumber = baseQuestionNumberMatch ? baseQuestionNumberMatch[0] : '';
            const baseHintMatch = questionNumberHint ? String(questionNumberHint).match(/^\d+/) : null;
            const baseHint = baseHintMatch ? baseHintMatch[0] : '';
            
            // Validate base number extraction
            if (isSubQuestionHint && baseHint === '') {
              console.error(`[QUESTION DETECTION] ❌ Failed to extract base number from hint "${questionNumberHint}" in object structure. This should not happen for sub-question hints.`);
            }
            
            // Q12 debugging: check if this is a flat key match (e.g., "12i" matches "12i")
            if (questionNumberHint?.startsWith('12') && questionNumber.startsWith('12')) {
              console.log(`[Q12 DEBUG] Object structure: checking key "${questionNumber}" vs hint "${questionNumberHint}"`);
            }
            
            // FIRST: Check if this is a direct flat key match (e.g., hint "12i" matches key "12i")
            // This handles cases where sub-questions are stored as flat keys (e.g., questions["12i"])
            if (isSubQuestionHint && questionNumber === questionNumberHint) {
              // Direct match - this is a flat key structure (e.g., questions["12i"])
              const similarity = this.calculateSimilarity(questionText, questionContent);
              if (questionNumberHint?.startsWith('12')) {
                console.log(`[Q12 DEBUG] ✅ Direct flat key match "${questionNumber}" with similarity: ${similarity.toFixed(3)}`);
              }
              if (similarity > bestScore) {
                bestScore = similarity;
                bestQuestionMatch = baseQuestionNumber; // Store base number (e.g., "12")
                bestMatchedQuestion = questionData;
                // Extract sub-question part from the flat key
                bestSubQuestionNumber = questionNumber.replace(/^\d+/, '').toLowerCase();
              }
              continue; // Skip nested sub-question check for flat keys
            }
            
            // SECOND: Match hierarchically: sub-question to sub-question, main to main
            if (isSubQuestionHint) {
              // For sub-question hints, only consider if base question numbers match
              if (baseQuestionNumber !== baseHint) {
                continue; // Skip this question - different base number
              }
            } else if (questionNumberHint) {
              // For main question hints, only match exact question numbers
              if (questionNumber !== questionNumberHint) {
                continue; // Skip this question - different question number
              }
            }
            
            // If hint is a sub-question, match against sub-questions only
            if (isSubQuestionHint) {
              const subQuestions = (questionData as any).sub_questions || (questionData as any).subQuestions || [];
              
              // Extract sub-question part from hint (e.g., "a" from "2a", "i" from "12i")
              const hintSubPart = questionNumberHint.replace(/^\d+/, '').toLowerCase();
              
              if (questionNumberHint?.startsWith('12')) {
                console.log(`[Q12 DEBUG] Object structure: looking for sub-question part "${hintSubPart}" in Q${questionNumber} (${subQuestions.length} sub-questions)`);
              }
              
              if (subQuestions.length === 0) {
                if (questionNumberHint?.startsWith('12')) {
                  console.log(`[Q12 DEBUG] ⚠️ Object structure: Q${questionNumber} has no sub_questions array`);
                }
                continue; // No sub-questions, skip
              }
              
              // Match against the specific sub-question part (hintSubPart already extracted above)
              for (const subQ of subQuestions) {
                const subQuestionText = subQ.text || subQ.question || subQ.sub_question || '';
                // Use ONLY question_part - fail fast if missing
                if (!subQ.question_part) {
                  console.error(`[QUESTION DETECTION] ❌ Sub-question missing question_part field. Expected structure: sub_questions[].question_part`);
                  continue; // Skip this sub-question - invalid structure
                }
                const subQuestionPart = String(subQ.question_part).toLowerCase();
                
                if (questionNumberHint?.startsWith('12')) {
                  console.log(`[Q12 DEBUG] Object structure: checking sub-question part "${subQuestionPart}" vs hint "${hintSubPart}"`);
                }
                
                // Only match if sub-question parts match (e.g., "a" matches "a", "i" matches "i")
                if (subQuestionPart !== hintSubPart || !subQuestionText) {
                  continue;
                }
                
                const subSimilarity = this.calculateSimilarity(questionText, subQuestionText);
                if (questionNumberHint?.startsWith('12')) {
                  console.log(`[Q12 DEBUG] ✅ Object structure: matched sub-question part "${subQuestionPart}" with similarity: ${subSimilarity.toFixed(3)}`);
                }
                if (subSimilarity > bestScore) {
                  bestScore = subSimilarity;
                  bestQuestionMatch = questionNumber;
                  bestMatchedQuestion = questionData;
                  bestSubQuestionNumber = subQuestionPart;
                }
              }
            } else {
              // Hint is a main question, match against main question text only
              const similarity = this.calculateSimilarity(questionText, questionContent);
              
              if (similarity > bestScore) {
                bestScore = similarity;
                bestQuestionMatch = questionNumber;
                bestMatchedQuestion = questionData;
                bestSubQuestionNumber = ''; // Reset sub-question
              }
            }
          }
        }
      }

      // If we found a good match, return the exam paper info
      // For sub-questions, use lower threshold (0.4) since they're shorter and more sensitive to small differences
      // For main questions, use higher threshold (0.5) for better accuracy
      const threshold = bestSubQuestionNumber ? 0.4 : 0.5;
      if (bestQuestionMatch && bestScore >= threshold) {
        // Q12 debugging: log successful match
        if (questionNumberHint?.startsWith('12')) {
          console.log(`[Q12 DEBUG] ✅ Match accepted: Q${bestQuestionMatch}${bestSubQuestionNumber || ''} (score=${bestScore.toFixed(3)}, threshold=${threshold})`);
        }
        // Use standardized fullExamPapers structure
        const metadata = examPaper.metadata;
        if (!metadata) {
          throw new Error('Exam paper missing required metadata structure');
        }
        
        const board = metadata.exam_board;
        const qualification = metadata.subject;
        const paperCode = metadata.exam_code;
        const year = metadata.year;
        const tier = metadata.tier;
        
        // Validate required fields
        if (!board || !qualification || !paperCode || !year) {
          throw new Error(`Exam paper missing required fields: board=${board}, qualification=${qualification}, paperCode=${paperCode}, year=${year}`);
        }
          
          // Extract marks for the matched question
        if (!bestMatchedQuestion) {
          throw new Error(`Question ${bestQuestionMatch} not found in exam paper`);
        }
        
        // Extract sub-questions info from matched question
        const matchedSubQuestions = bestMatchedQuestion?.sub_questions || bestMatchedQuestion?.subQuestions || [];
        const hasSubQuestions = Array.isArray(matchedSubQuestions) && matchedSubQuestions.length > 0;
        
        // If we matched a sub-question, get marks from sub_questions[].marks - fail fast if not found
        // Store parent question marks (bestMatchedQuestion.marks) for use when grouping sub-questions
        const parentQuestionMarks = bestMatchedQuestion.marks;
        let questionMarks = parentQuestionMarks;
        
        if (bestSubQuestionNumber && hasSubQuestions) {
          // Use ONLY question_part - fail fast if missing
          const matchedSubQ = matchedSubQuestions.find((sq: any) => {
            if (!sq.question_part) {
              console.error(`[QUESTION MARKS DEBUG] ❌ Sub-question missing question_part field. Expected structure: sub_questions[].question_part`);
              return false; // Skip - invalid structure
            }
            return String(sq.question_part).toLowerCase() === bestSubQuestionNumber.toLowerCase();
          });
          
          if (matchedSubQ && matchedSubQ.marks !== undefined) {
            questionMarks = matchedSubQ.marks; // Use sub-question's marks directly from fullExamPapers
          } else {
            // Fail fast - sub-question matched but marks not found
            console.error(`[QUESTION MARKS DEBUG] ❌ Sub-question Q${bestQuestionMatch}${bestSubQuestionNumber} matched but marks not found in sub_questions[].marks. Expected structure: sub_questions[].question_part and sub_questions[].marks`);
            throw new Error(`Sub-question Q${bestQuestionMatch}${bestSubQuestionNumber} matched but marks extraction failed - invalid database structure`);
          }
        }
        
        // Extract database question text for filtering
        let databaseQuestionText = '';
        if (bestSubQuestionNumber && hasSubQuestions) {
          // Get sub-question text from database
          const matchedSubQ = matchedSubQuestions.find((sq: any) => {
            if (!sq.question_part) return false;
            return String(sq.question_part).toLowerCase() === bestSubQuestionNumber.toLowerCase();
          });
          if (matchedSubQ) {
            databaseQuestionText = matchedSubQ.text || matchedSubQ.question || matchedSubQ.question_text || '';
          }
        } else {
          // Get main question text from database
          databaseQuestionText = bestMatchedQuestion.question_text || bestMatchedQuestion.text || bestMatchedQuestion.question || '';
        }
        
        return {
          board: board,
          qualification: qualification,
          paperCode: paperCode,
          year: year,
          tier: tier,
          questionNumber: bestQuestionMatch,
          subQuestionNumber: bestSubQuestionNumber || undefined,
          marks: questionMarks, // Sub-question marks (if matched) or parent question marks (if main question)
          parentQuestionMarks: parentQuestionMarks, // Always store parent question marks for grouping
          confidence: bestScore,
          databaseQuestionText: databaseQuestionText // Store database question text for filtering
        };
      }

      // Error logging: log why match was rejected or not found
      // Skip logging for 17a and 17b (working correctly, no need for verbose logs)
      const skipLogging = questionNumberHint?.startsWith('17a') || questionNumberHint?.startsWith('17b');
      
      if (bestQuestionMatch) {
        const threshold = bestSubQuestionNumber ? 0.4 : 0.5;
        if (questionNumberHint?.startsWith('12')) {
          console.log(`[Q12 DEBUG] ❌ Match rejected: Q${bestQuestionMatch}${bestSubQuestionNumber || ''} (score=${bestScore.toFixed(3)}, threshold=${threshold})`);
        } else if (!skipLogging) {
          console.log(`[QUESTION DETECTION] ❌ Match rejected for ${questionNumberHint}: Q${bestQuestionMatch}${bestSubQuestionNumber || ''} (score=${bestScore.toFixed(3)}, threshold=${threshold})`);
        }
      } else {
        // No match found - log error for all questions (except 17a/17b)
        if (!skipLogging) {
          console.error(`[QUESTION DETECTION] ❌ No match found for question hint "${questionNumberHint}" with text "${questionText.substring(0, 100)}${questionText.length > 100 ? '...' : ''}"`);
        }
        if (questionNumberHint?.startsWith('12')) {
          console.log(`[Q12 DEBUG] ❌ No match found for ${questionNumberHint}`);
        }
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
      // First, try to find exact matches (same paper code)
      let bestMatch: MarkingSchemeMatch | null = null;
      let bestScore = 0;
      
      for (const markingScheme of markingSchemes) {
        const match = this.matchMarkingSchemeWithExamPaper(examPaperMatch, markingScheme);
        if (match) {
          // Prioritize exact paper code matches
          const isExactPaperMatch = examPaperMatch.paperCode === match.examDetails.paperCode;
          const adjustedScore = isExactPaperMatch ? match.confidence + 0.1 : match.confidence;
          
          if (adjustedScore > bestScore) {
            bestMatch = match;
            bestScore = adjustedScore;
          }
        }
      }
      
      if (bestMatch) {
        return bestMatch;
      }
      
      console.error(`[MARKING SCHEME LOOKUP] ❌ No matching marking scheme found for ${examPaperMatch.paperCode}`);
      

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
      // Use standardized markingSchemes structure
      const examDetails = markingScheme.examDetails;
      if (!examDetails) {
        throw new Error('Marking scheme missing required examDetails structure');
      }
      
      // Match by board, qualification, paper code, and year
      const boardMatch = this.calculateSimilarity(examPaperMatch.board, examDetails.board || '');
      
      // Extract subject only from qualification (ignore GCSE, A-Level, etc.)
      const extractSubject = (qualification: string) => {
        return qualification.toLowerCase()
          .replace(/\b(gcse|a-level|alevel|as-level|a2-level|igcse|international|advanced|higher|foundation)\b/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      };
      
      const examSubject = extractSubject(examPaperMatch.qualification);
      const schemeSubject = extractSubject(examDetails.qualification || '');
      const qualificationMatch = this.calculateSimilarity(examSubject, schemeSubject);
      
      // Paper code must match EXACTLY - different papers have different questions
      // Examples: 1MA1/1H != 1MA1/2H (different papers), 1MA1/1H != 1MA1/1F (different tiers)
      // This is a hard requirement - reject immediately if paper codes don't match
      if (examPaperMatch.paperCode !== examDetails.paperCode) {
        return null; // Reject - paper codes must match exactly
      }
      
      const yearMatch = this.calculateSimilarity(examPaperMatch.year, examDetails.date || '');
      
      // Calculate overall match score (paper code already matched, so we can proceed)
      const overallScore = (boardMatch + qualificationMatch + 1.0 + yearMatch) / 4;
      
      if (overallScore > 0.7) { // High confidence threshold for marking scheme matching
        // Get question marks for the specific question - FLAT STRUCTURE ONLY
        // Expected structure: questions["1"], questions["2a"], questions["2b"], etc.
        let questionMarks = null;
        
        if (!examPaperMatch.questionNumber) {
          console.error(`[QUESTION MARKS DEBUG] ❌ examPaperMatch.questionNumber is missing`);
          return null; // Fail fast
        }
        
        // Check if markingScheme has questions property
        if (!markingScheme.questions) {
          console.error(`[QUESTION MARKS DEBUG] ❌ markingScheme.questions is missing for ${examDetails.paperCode}`);
          return null; // Fail fast
        }
        
        const questions = markingScheme.questions;
        const questionNumber = examPaperMatch.questionNumber;
        
        // Build the flat key: "1" for main questions, "2a", "2b" for sub-questions
        let flatKey: string;
        if (examPaperMatch.subQuestionNumber) {
          flatKey = `${questionNumber}${examPaperMatch.subQuestionNumber.toLowerCase()}`;
        } else {
          flatKey = questionNumber;
        }
        
        // FLAT STRUCTURE ONLY - no fallbacks, no nested structures
        if (questions[flatKey]) {
          questionMarks = questions[flatKey];
        } else {
          // Fail fast - no matching structure found
          console.error(`[QUESTION MARKS DEBUG] ❌ Not found: questions["${flatKey}"] in ${examDetails.paperCode}`);
          console.error(`[QUESTION MARKS DEBUG] Question number: "${questionNumber}", Sub-question: "${examPaperMatch.subQuestionNumber || 'none'}"`);
          console.error(`[QUESTION MARKS DEBUG] Available keys: ${Object.keys(questions).slice(0, 30).join(', ')}${Object.keys(questions).length > 30 ? '...' : ''}`);
          
          // For Q12 debugging: check if keys like "12i", "12ii", "12iii" exist
          if (questionNumber === '12' || questionNumber?.startsWith('12')) {
            const q12Keys = Object.keys(questions).filter(k => k.startsWith('12'));
            console.error(`[Q12 DEBUG] Keys starting with "12": ${q12Keys.join(', ')}`);
            console.error(`[Q12 DEBUG] Looking for: "${flatKey}"`);
            console.error(`[Q12 DEBUG] Sub-question number from match: "${examPaperMatch.subQuestionNumber || 'none'}"`);
          }
          
          return null; // Fail fast - no fallbacks
        }
        
        // Debug logging for Q12
        if (questionNumber === '12' || questionNumber?.startsWith('12')) {
          console.log(`[Q12 DEBUG] ✅ Found marking scheme for Q${flatKey}`);
          console.log(`[Q12 DEBUG] Question marks structure: ${JSON.stringify(Object.keys(questionMarks || {})).substring(0, 200)}`);
        }
        
        return {
          id: markingScheme.id,
          examDetails: {
            board: examDetails.board,
            qualification: examDetails.qualification,
            paperCode: examDetails.paperCode,
            tier: examDetails.tier,
            paper: examDetails.paper,
            date: examDetails.date
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

    // Use shared normalization utility to ensure consistency across all inputs
    // (classification, OCR, and database text)
    const norm1 = normalizeTextForComparison(str1);
    const norm2 = normalizeTextForComparison(str2);

    if (norm1 === norm2) return 1.0;
    
    // For short math expressions, check if one is a substring of the other
    // This handles cases where classification extracts just the equation but database has descriptive text
    // Example: classification "y x 2 4" vs database "find the graph of y x 2 4"
    if (norm1.length < 50 || norm2.length < 50) {
      if (norm1.includes(norm2) || norm2.includes(norm1)) {
        // Calculate substring similarity: length of shorter / length of longer
        const shorter = norm1.length < norm2.length ? norm1 : norm2;
        const longer = norm1.length >= norm2.length ? norm1 : norm2;
        const substringScore = shorter.length / longer.length;
        // Boost score for substring matches (minimum 0.7 for good substring matches)
        return Math.max(0.7, substringScore);
      }
    }

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
