/**
 * Question Detection Service
 * Matches extracted question text with exam papers in the database
 */

import { getFirestore } from '../../config/firebase.js';
import { normalizeTextForComparison } from '../../utils/TextNormalizationUtils.js';
import * as stringSimilarity from 'string-similarity';

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
  examSeries: string;
  tier?: string;  // Add tier field
  subject?: string;  // Subject from fullExamPapers.metadata.subject (source of truth)
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
    exam_series?: string; // Exam series (standardized field name)
    subject?: string; // Subject field (standardized)
  };
  questionMarks?: any;
  totalQuestions: number;
  totalMarks: number;
  confidence?: number;
  generalMarkingGuidance?: any; // General marking guidance from the scheme
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
      let bestTextMatch: { match: ExamPaperMatch; textSimilarity: number } | null = null;
      let bestFailedMatch: ExamPaperMatch | null = null; // Track best match even if below threshold

      for (const examPaper of examPapers) {
        const metadata = examPaper.metadata;
        const paperCode = metadata?.exam_code || 'unknown';
        const is1MA1_1H = paperCode === '1MA1/1H' || paperCode.includes('1MA1/1H');

        const match = await this.matchQuestionWithExamPaper(extractedQuestionText, examPaper, questionNumberHint);
        if (match && match.confidence) {
          // Track best match even if below threshold (for failure logging)
          if (match.confidence > bestScore) {
            bestFailedMatch = match;
            bestScore = match.confidence;
            // Only accept as bestMatch if above threshold (0.50 for main, 0.40 for sub)
            const threshold = match.subQuestionNumber ? 0.4 : 0.50;
            if (match.confidence >= threshold) {
              bestMatch = match;
              // Calculate text similarity for tie-breaking
              if (match.databaseQuestionText) {
                const textSimilarity = this.calculateSimilarity(extractedQuestionText, match.databaseQuestionText);
                bestTextMatch = { match, textSimilarity };
              }
            }
          }
          // If confidence is equal, break tie by checking actual text match quality
          else if (match.confidence === bestScore && match.databaseQuestionText) {
            const textSimilarity = this.calculateSimilarity(extractedQuestionText, match.databaseQuestionText);

            // Additional tie-breaking: check if database text starts with same words as classification
            // This helps when similarity scores are identical but one is clearly the correct question
            const classificationStart = normalizeTextForComparison(extractedQuestionText.substring(0, 60));
            const databaseStart = normalizeTextForComparison(match.databaseQuestionText.substring(0, 60));
            // Check if they start with the same normalized text (first 30 chars after normalization)
            const classificationPrefix = classificationStart.substring(0, Math.min(30, classificationStart.length));
            const databasePrefix = databaseStart.substring(0, Math.min(30, databaseStart.length));
            const startsMatch = classificationPrefix && databasePrefix &&
              (databasePrefix.startsWith(classificationPrefix.substring(0, 20)) ||
                classificationPrefix.startsWith(databasePrefix.substring(0, 20)));

            // Check if current best match also starts with same words
            let bestStartsMatch = false;
            if (bestTextMatch && bestTextMatch.match.databaseQuestionText) {
              const bestDatabaseStart = normalizeTextForComparison(bestTextMatch.match.databaseQuestionText.substring(0, 60));
              const bestDatabasePrefix = bestDatabaseStart.substring(0, Math.min(30, bestDatabaseStart.length));
              bestStartsMatch = bestDatabasePrefix && classificationPrefix &&
                (bestDatabasePrefix.startsWith(classificationPrefix.substring(0, 20)) ||
                  classificationPrefix.startsWith(bestDatabasePrefix.substring(0, 20)));
            }

            // Prefer match that starts with same words, or if both do, prefer higher text similarity
            const threshold = match.subQuestionNumber ? 0.4 : 0.50;
            if (match.confidence >= threshold && (!bestMatch ||
              !bestTextMatch ||
              (startsMatch && !bestStartsMatch) ||
              (startsMatch && bestStartsMatch && textSimilarity > bestTextMatch.textSimilarity) ||
              (!startsMatch && !bestStartsMatch && textSimilarity > bestTextMatch.textSimilarity))) {
              bestMatch = match;
              bestTextMatch = { match, textSimilarity };
            }
          }
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
          message: `Matched with ${bestMatch.board} ${getShortSubjectName(bestMatch.qualification)} - ${bestMatch.paperCode} (${bestMatch.examSeries})`
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


                // Only match if sub-question parts match (e.g., "a" matches "a", "i" matches "i")
                if (subQuestionPart !== hintSubPart) {
                  continue;
                }

                if (!subQuestionText) {
                  continue;
                }

                // Calculate similarity for sub-question text
                const subSimilarity = this.calculateSimilarity(questionText, subQuestionText);


                if (subSimilarity > bestScore) {
                  bestScore = subSimilarity;
                  bestQuestionMatch = questionNumber;
                  bestMatchedQuestion = question;
                  bestSubQuestionNumber = subQuestionPart;
                } else if (subQuestionPart === hintSubPart && subSimilarity >= 0.2) {
                  // Fallback: Sub-question part matches but text similarity is low
                  // Use lower confidence (0.5) but still accept the match
                  // This handles cases where classification text format differs but sub-question part is correct
                  if (bestScore < 0.5) {
                    bestScore = 0.5;
                    bestQuestionMatch = questionNumber;
                    bestMatchedQuestion = question;
                    bestSubQuestionNumber = subQuestionPart;
                    console.warn(`[QUESTION DETECTION] ⚠️ Using sub-question part fallback for Q${questionNumber}${subQuestionPart} (text similarity: ${subSimilarity.toFixed(3)}, bestScore was: ${bestScore.toFixed(3)})`);
                  }
                }
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


            // FIRST: Check if this is a direct flat key match (e.g., hint "12i" matches key "12i")
            // This handles cases where sub-questions are stored as flat keys (e.g., questions["12i"])
            if (isSubQuestionHint && questionNumber === questionNumberHint) {
              // Direct match - this is a flat key structure (e.g., questions["12i"])
              const similarity = this.calculateSimilarity(questionText, questionContent);
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


              if (subQuestions.length === 0) {
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


                // Only match if sub-question parts match (e.g., "a" matches "a", "i" matches "i")
                if (subQuestionPart !== hintSubPart || !subQuestionText) {
                  continue;
                }

                const subSimilarity = this.calculateSimilarity(questionText, subQuestionText);
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
      // For main questions, use higher threshold (0.50) to prevent false positive matches for non-past papers
      // The previous 0.35 threshold was too low and allowed non-past papers to match past papers incorrectly
      // 0.50 is still lenient enough for OCR/classification variations but strict enough to reject false positives
      const threshold = bestSubQuestionNumber ? 0.4 : 0.50;

      // Get paper code for debug logging
      const metadata = examPaper.metadata;
      const paperCode = metadata?.exam_code || 'unknown';


      // Return match even if below threshold (for logging purposes)
      // The caller will check threshold and reject if needed
      if (bestQuestionMatch) {
        // Use standardized fullExamPapers structure
        if (!metadata) {
          throw new Error('Exam paper missing required metadata structure');
        }

        const board = metadata.exam_board;
        // Use qualification field if available, fallback to subject for backward compatibility
        const qualification = metadata.qualification || metadata.subject;
        const examSeries = metadata.exam_series;
        const tier = metadata.tier;
        // Get subject from fullExamPapers.metadata.subject (source of truth)
        const subject = metadata.subject;

        // Validate required fields
        if (!board || !qualification || !paperCode || !examSeries) {
          throw new Error(`Exam paper missing required fields: board=${board}, qualification=${qualification}, paperCode=${paperCode}, exam_series=${examSeries}`);
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
              return false; // Skip - invalid structure
            }
            return String(sq.question_part).toLowerCase() === bestSubQuestionNumber.toLowerCase();
          });

          if (matchedSubQ && matchedSubQ.marks !== undefined) {
            questionMarks = matchedSubQ.marks; // Use sub-question's marks directly from fullExamPapers
          } else {
            // Fail fast - sub-question matched but marks not found
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

        const match: ExamPaperMatch = {
          board: board,
          qualification: qualification,
          paperCode: paperCode,
          examSeries: examSeries,
          tier: tier,
          subject: subject, // Subject from fullExamPapers.metadata.subject (source of truth)
          questionNumber: bestQuestionMatch,
          subQuestionNumber: bestSubQuestionNumber || undefined,
          marks: questionMarks, // Sub-question marks (if matched) or parent question marks (if main question)
          parentQuestionMarks: parentQuestionMarks, // Always store parent question marks for grouping
          confidence: bestScore,
          databaseQuestionText: databaseQuestionText // Store database question text for filtering
        };

        // Only return if above threshold, but we've already logged it above
        if (bestScore >= threshold) {
          return match;
        }

        // Return match even if below threshold (for logging in caller)
        return match;
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

      // DEBUG LOGGING: Check input values before any logic


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

      const examSeriesMatch = this.calculateSimilarity(examPaperMatch.examSeries, examDetails.exam_series || '');

      // Calculate overall match score (paper code already matched, so we can proceed)
      const overallScore = (boardMatch + qualificationMatch + 1.0 + examSeriesMatch) / 4;

      if (overallScore > 0.7) { // High confidence threshold for marking scheme matching
        // Get question marks for the specific question - FLAT STRUCTURE ONLY
        // Expected structure: questions["1"], questions["2a"], questions["2b"], etc.
        let questionMarks = null;

        if (!examPaperMatch.questionNumber) {
          return null; // Fail fast
        }

        // Check if markingScheme has questions property
        if (!markingScheme.questions) {
          return null; // Fail fast
        }

        const questions = markingScheme.questions;
        // Normalize question number: remove leading zeros, trim whitespace
        const questionNumber = String(examPaperMatch.questionNumber).trim().replace(/^0+/, '');

        // Build the flat key: "1" for main questions, "2a", "2b" for sub-questions
        let flatKey: string;
        if (examPaperMatch.subQuestionNumber) {
          flatKey = `${questionNumber}${examPaperMatch.subQuestionNumber.toLowerCase().trim()}`;
        } else {
          flatKey = questionNumber;
        }


        // FLAT STRUCTURE ONLY - no fallbacks, no nested structures
        // Check for main question and alternative method
        const mainQuestion = questions[flatKey];
        const altKey = `${flatKey}alt`;
        const altQuestion = questions[altKey];

        // If both main and alternative exist, combine them (AI will choose best match)
        if (mainQuestion && altQuestion) {
          questionMarks = {
            main: mainQuestion,
            alt: altQuestion,
            hasAlternatives: true
          };
        } else if (mainQuestion) {
          questionMarks = mainQuestion;
        } else if (altQuestion) {
          questionMarks = altQuestion;
        } else {
          // Fallback: If main question doesn't exist but sub-questions do (e.g., "3" doesn't exist but "3a", "3b" do)
          // This happens when classification extracts main question text but database only has sub-question schemes
          if (!examPaperMatch.subQuestionNumber) {
            // Check if any sub-questions exist for this question number
            const subQuestionKeys = Object.keys(questions).filter(key => {
              // Check if key starts with questionNumber followed by a letter (e.g., "3a", "3b" for question "3")
              const baseMatch = key.match(/^(\d+)([a-z]+)$/i);
              return baseMatch && baseMatch[1] === questionNumber;
            });



            if (subQuestionKeys.length > 0) {
              // Main question doesn't have a marking scheme, but sub-questions do (e.g. Q5 detected, but DB has 5a, 5b)
              // Synthesize a composite marking scheme by combining all sub-questions
              // This allows the AI to mark the entire question block against all sub-parts

              subQuestionKeys.sort(); // Ensure a, b, c order

              const compositeMarks: any[] = [];
              const compositeAnswers: string[] = [];
              const compositeGuidance: any[] = [];

              subQuestionKeys.forEach(key => {
                const subScheme = questions[key];
                const partLabel = key.replace(questionNumber, ''); // e.g. "a"

                // Add part label to answer
                compositeAnswers.push(`(${partLabel}) ${subScheme.answer}`);

                // Add part label to marks and combine
                if (subScheme.marks) {
                  subScheme.marks.forEach((m: any) => {
                    compositeMarks.push({
                      ...m,
                      // Prepend part label to mark definition if possible, or rely on AI context
                      mark: `[${partLabel}] ${m.mark}`
                    });
                  });
                }

                if (subScheme.guidance) {
                  compositeGuidance.push(...subScheme.guidance);
                }
              });

              questionMarks = {
                answer: compositeAnswers.join('\n'),
                marks: compositeMarks,
                guidance: compositeGuidance,
                isComposite: true // Flag for debugging
              };

              // Return the synthesized scheme instead of null
              return {
                id: markingScheme.id,
                examDetails: markingScheme.examDetails,
                questionMarks: questionMarks,
                totalQuestions: Object.keys(questions).length,
                totalMarks: 0, // Not critical for this specific flow
                confidence: 1.0, // Synthetic match
                generalMarkingGuidance: markingScheme.generalMarkingGuidance
              };
            }
          }

          // Fail fast - no matching structure found
          return null; // Fail fast - no fallbacks
        }


        return {
          id: markingScheme.id,
          examDetails: {
            board: examDetails.board,
            qualification: examDetails.qualification,
            paperCode: examDetails.paperCode,
            tier: examDetails.tier,
            paper: examDetails.paper,
            date: examDetails.exam_series || examDetails.date || '', // Use exam_series (standardized) or fallback to date
            exam_series: examDetails.exam_series,
            subject: examDetails.subject || '' // Include subject field (standardized)
          },
          questionMarks: questionMarks,
          totalQuestions: markingScheme.totalQuestions || 0,
          totalMarks: markingScheme.totalMarks || 0,
          confidence: overallScore,
          generalMarkingGuidance: markingScheme.generalMarkingGuidance // Extract general marking guidance
        };
      }

      return null;
    } catch (error) {
      console.error('❌ Error matching marking scheme:', error);
      return null;
    }
  }

  /**
   * Calculate similarity between two strings using string-similarity library and n-grams
   * Returns a score between 0 and 1
   * Optimized for math expressions (space-less text after normalization)
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

    // Use string-similarity library (Dice coefficient) - works well for general text
    const diceScore = stringSimilarity.compareTwoStrings(norm1, norm2);

    // N-gram similarity for space-less math expressions (works better than word-based matching)
    const ngramScore = this.calculateNgramSimilarity(norm1, norm2, 3);

    // Return the best score (n-grams are better for math, Dice is better for general text)
    return Math.max(diceScore, ngramScore);
  }

  /**
   * Calculate similarity using character n-grams (for space-less text like math expressions)
   * @param text1 First normalized text
   * @param text2 Second normalized text
   * @param n N-gram size (default: 3 for trigrams)
   * @returns Similarity score between 0 and 1
   */
  private calculateNgramSimilarity(text1: string, text2: string, n: number = 3): number {
    const ngrams1 = this.extractNgrams(text1, n);
    const ngrams2 = this.extractNgrams(text2, n);

    if (ngrams1.length === 0 && ngrams2.length === 0) return 1.0;
    if (ngrams1.length === 0 || ngrams2.length === 0) return 0.0;

    // Jaccard similarity: intersection / union
    const set1 = new Set(ngrams1);
    const set2 = new Set(ngrams2);

    const intersection = [...set1].filter(x => set2.has(x)).length;
    const union = new Set([...set1, ...set2]).size;

    return union === 0 ? 1.0 : intersection / union;
  }

  /**
   * Extract character n-grams from text
   * @param text Input text
   * @param n N-gram size
   * @returns Array of n-grams
   */
  private extractNgrams(text: string, n: number): string[] {
    const ngrams: string[] = [];
    for (let i = 0; i <= text.length - n; i++) {
      ngrams.push(text.substring(i, i + n));
    }
    return ngrams;
  }
}

// Export singleton instance
export const questionDetectionService = QuestionDetectionService.getInstance();
