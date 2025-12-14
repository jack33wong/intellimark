/**
 * Analysis Service - Generates performance analysis reports from marking results
 */

import { ModelProvider } from '../../utils/ModelProvider.js';
import { FirestoreService } from '../firestoreService.js';
import { getPrompt } from '../../config/prompts.js';
import type { ModelType } from '../../types/index.js';
import type { AnalysisRequest, AnalysisResult, MarkingDataForAnalysis } from './analysisTypes.js';
import type { UnifiedSession, UnifiedMessage } from '../../types/index.js';
import { extractSubjectFromDetectedQuestion } from '../subjectMarkingResultService.js';

export class AnalysisService {
  /**
   * Generate analysis report for a session or multiple sessions grouped by subject
   * Cost-saving: Pass lastAnalysisReport if exists to avoid regenerating from scratch
   */
  static async generateAnalysis(
    request: AnalysisRequest,
    lastAnalysisReport?: AnalysisResult,
    userId?: string
  ): Promise<AnalysisResult> {
    try {
      // 1. Get marking data from subjectMarkingResults (preferred) or session(s) (fallback)
      let markingData: MarkingDataForAnalysis | null = null;

      // Try to get from subjectMarkingResults first (if subject and userId provided)
      if (request.subject && userId) {
        markingData = await this.getMarkingDataFromSubjectMarkingResult(
          userId,
          request.subject,
          request.qualification,
          request.examBoard,
          request.paperCodeSet
        );
      }

      // Fallback to session-based approach if subjectMarkingResults not available
      if (!markingData) {
        if (request.sessionIds && request.sessionIds.length > 0) {
          // Multiple sessions - aggregate by subject
          markingData = await this.getMarkingDataFromMultipleSessions(request.sessionIds, request.subject);
        } else if (request.sessionId) {
          // Single session (legacy support)
          markingData = await this.getMarkingDataFromSession(request.sessionId);
        } else {
          throw new Error('Either sessionId or sessionIds must be provided');
        }
      }

      if (!markingData || markingData.questionResults.length === 0) {
        throw new Error('No marking results found in session(s)');
      }

      // 2. Fetch grade boundaries for the subject
      // Try to fetch grade boundaries - attempt with available metadata
      // First check if boundaries are already stored in markingData (from subjectMarkingResult)
      if (!markingData.gradeBoundaries && markingData.examMetadata.examBoard &&
        markingData.examMetadata.examSeries &&
        markingData.examMetadata.subject &&
        markingData.examMetadata.examCode) {
        // Fallback: look up from gradeBoundaries collection
        const gradeBoundaries = await this.fetchGradeBoundaries(
          markingData.examMetadata.examBoard,
          markingData.examMetadata.examSeries,
          markingData.examMetadata.subject,
          markingData.examMetadata.examCode,
          markingData.examMetadata.tier || ''
        );

        if (gradeBoundaries) {
          markingData.gradeBoundaries = gradeBoundaries;
          console.log(`✅ [ANALYSIS] Grade boundaries found for ${markingData.examMetadata.examBoard} ${markingData.examMetadata.examCode}`);
        } else {
          console.warn(`⚠️ [ANALYSIS] Grade boundaries not found for ${markingData.examMetadata.examBoard} ${markingData.examMetadata.examCode} ${markingData.examMetadata.examSeries}`);
        }
      } else if (markingData.gradeBoundaries) {
        console.log(`✅ [ANALYSIS] Grade boundaries found in stored data for ${markingData.examMetadata.examBoard} ${markingData.examMetadata.examCode}`);
      } else {
        console.warn(`⚠️ [ANALYSIS] Missing exam metadata for grade boundaries:`, {
          examBoard: markingData.examMetadata.examBoard,
          examCode: markingData.examMetadata.examCode,
          examSeries: markingData.examMetadata.examSeries,
          subject: markingData.examMetadata.subject
        });
      }

      // 3. Format data for AI (include last report if available for context)
      const formattedData = this.formatDataForAI(markingData, lastAnalysisReport);

      // 4. Call AI with analysis prompt
      const systemPrompt = getPrompt('analysis.system');
      const userPrompt = getPrompt('analysis.user', formattedData, lastAnalysisReport || undefined);

      // Track usage locally for this analysis request
      const { UsageTracker } = await import('../../utils/UsageTracker.js');
      const analysisTracker = new UsageTracker();

      const aiResponse = await ModelProvider.callText(
        systemPrompt,
        userPrompt,
        request.model as ModelType,
        false,
        analysisTracker // Pass tracker to record tokens
      );

      // 5. Parse AI response
      const analysisResult = this.parseAnalysisResponse(aiResponse.content);

      // 6. Add highest grade and average grade to performance
      if (markingData.grade) {
        analysisResult.performance.grade = markingData.grade;
      }
      if (markingData.averageGrade) {
        analysisResult.performance.averageGrade = markingData.averageGrade;
      }

      // 7. Persist usage record if userId is provided
      if (userId) {
        const cost = analysisTracker.calculateCost(request.model as string);
        const analysisSessionId = `analysis-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        await FirestoreService.createUsageRecord(
          analysisSessionId,
          userId,
          new Date().toISOString(),
          {
            totalProcessingTimeMs: 0, // Not tracked precisely
            totalCost: cost.total,
            costBreakdown: {
              llmCost: cost.total,
              mathpixCost: 0
            }
          },
          'analysis' // mode
        );
      }

      return analysisResult;

    } catch (error) {
      console.error('❌ [ANALYSIS SERVICE] Error generating analysis:', error);
      throw error;
    }
  }

  /**
   * Extract and aggregate marking data from multiple sessions (grouped by subject)
   * Calculates averages and highest grade across all sessions
   */
  private static async getMarkingDataFromMultipleSessions(
    sessionIds: string[],
    subject?: string
  ): Promise<MarkingDataForAnalysis | null> {
    try {
      const allQuestionResults: MarkingDataForAnalysis['questionResults'] = [];
      const sessionScores: Array<{ awarded: number; total: number; percentage: number; grade?: string }> = [];
      const examMetadataSet = new Set<string>();
      const grades: string[] = [];

      // Process all sessions
      for (const sessionId of sessionIds) {
        const session = await FirestoreService.getUnifiedSession(sessionId);

        if (!session || !session.messages) {
          continue;
        }

        // Find ALL marking messages (not just the last one)
        const markingMessages = session.messages.filter((msg: UnifiedMessage) =>
          msg.role === 'assistant' &&
          msg.studentScore &&
          (msg.type === 'marking_annotated' || (msg as any).imageDataArray || (msg as any).imageData)
        );

        if (markingMessages.length === 0) {
          continue;
        }

        // Process each marking message
        markingMessages.forEach((mainMarkingMessage) => {
          // Track scores for averaging
          if (mainMarkingMessage.studentScore) {
            const awarded = mainMarkingMessage.studentScore.awardedMarks || 0;
            const total = mainMarkingMessage.studentScore.totalMarks || 0;
            const percentage = total > 0 ? Math.round((awarded / total) * 100) : 0;

            sessionScores.push({
              awarded,
              total,
              percentage,
              grade: mainMarkingMessage.grade || undefined
            });

            // Collect grades
            if (mainMarkingMessage.grade) {
              grades.push(mainMarkingMessage.grade);
            }
          }

          // Extract question results
          const detectedQuestion = mainMarkingMessage.detectedQuestion;
          if (detectedQuestion?.examPapers && detectedQuestion.examPapers.length > 0) {
            detectedQuestion.examPapers.forEach((examPaper: any) => {
              // Track exam metadata
              const metadataKey = `${examPaper.examBoard}-${examPaper.examCode}-${examPaper.examSeries}`;
              examMetadataSet.add(metadataKey);

              if (examPaper.questions && Array.isArray(examPaper.questions)) {
                examPaper.questions.forEach((q: any) => {
                  const questionNum = q.questionNumber || '';
                  if (!questionNum) return;

                  // Check if question already exists (from another session)
                  const existingIndex = allQuestionResults.findIndex(qr => qr.questionNumber === questionNum);

                  if (existingIndex >= 0) {
                    // Update existing question (take max total marks)
                    const existing = allQuestionResults[existingIndex];
                    const newTotalMarks = q.marks || 0;
                    if (newTotalMarks > existing.score.totalMarks) {
                      existing.score.totalMarks = newTotalMarks;
                    }
                  } else {
                    // Add new question (will calculate average score later)
                    allQuestionResults.push({
                      questionNumber: questionNum,
                      score: {
                        awardedMarks: 0, // Will calculate average
                        totalMarks: q.marks || 0
                      }
                    });
                  }
                });
              }
            });
          }
        });
      }

      if (allQuestionResults.length === 0 || sessionScores.length === 0) {
        return null;
      }

      // Calculate averages
      const totalAwarded = sessionScores.reduce((sum, s) => sum + s.awarded, 0);
      const totalPossible = sessionScores.reduce((sum, s) => sum + s.total, 0);
      const avgAwarded = Math.round(totalAwarded / sessionScores.length);
      const avgTotal = Math.round(totalPossible / sessionScores.length);
      const avgPercentage = avgTotal > 0 ? Math.round((avgAwarded / avgTotal) * 100) : 0;

      // Calculate average score per question (simplified - distribute average percentage)
      const avgQuestionPercentage = avgTotal > 0 ? avgAwarded / avgTotal : 0;
      allQuestionResults.forEach((qr) => {
        const estimatedAwardedMarks = Math.round((qr.score.totalMarks || 0) * avgQuestionPercentage);
        qr.score.awardedMarks = estimatedAwardedMarks;
      });

      // Sort question results
      allQuestionResults.sort((a, b) => {
        const numA = this.extractNumericPart(a.questionNumber);
        const numB = this.extractNumericPart(b.questionNumber);
        return numA - numB;
      });

      // Get exam metadata from first session (or use subject parameter)
      const firstSession = await FirestoreService.getUnifiedSession(sessionIds[0]);
      const firstMarkingMessage = firstSession?.messages?.find((msg: any) =>
        msg.role === 'assistant' && msg.studentScore
      );
      const firstDetectedQuestion = firstMarkingMessage?.detectedQuestion;

      const examMetadata = {
        examBoard: firstDetectedQuestion?.examPapers?.[0]?.examBoard || '',
        examCode: firstDetectedQuestion?.examPapers?.[0]?.examCode || '',
        examSeries: firstDetectedQuestion?.examPapers?.[0]?.examSeries || '',
        subject: subject || firstDetectedQuestion?.examPapers?.[0]?.subject || '',
        paperTitle: firstDetectedQuestion?.examPapers?.[0]?.paperTitle || '',
        tier: firstDetectedQuestion?.examPapers?.[0]?.tier || ''
      };

      // Find highest grade (convert to number for comparison: 9 > 8 > 7, etc.)
      const highestGrade = this.findHighestGrade(grades);

      return {
        questionResults: allQuestionResults,
        overallScore: {
          awarded: avgAwarded, // Average awarded marks
          total: avgTotal, // Average total marks
          percentage: avgPercentage // Average percentage
        },
        examMetadata,
        grade: highestGrade, // Highest grade achieved
        averageGrade: this.calculateAverageGrade(grades), // Average grade (if calculable)
        sessionCount: sessionScores.length // Number of sessions analyzed
      };

    } catch (error) {
      console.error('❌ [ANALYSIS SERVICE] Error extracting marking data from multiple sessions:', error);
      return null;
    }
  }

  /**
   * Find highest grade from array of grade strings
   */
  private static findHighestGrade(grades: string[]): string | undefined {
    if (grades.length === 0) return undefined;

    // Convert grades to numbers for comparison (9 > 8 > 7 > ... > 1)
    const gradeNumbers = grades
      .map(g => {
        const num = parseInt(g, 10);
        return isNaN(num) ? 0 : num;
      })
      .filter(n => n > 0);

    if (gradeNumbers.length === 0) {
      // If no numeric grades, return first one
      return grades[0];
    }

    const highestNum = Math.max(...gradeNumbers);
    return String(highestNum);
  }

  /**
   * Calculate average grade (simplified - returns most common grade)
   */
  private static calculateAverageGrade(grades: string[]): string | undefined {
    if (grades.length === 0) return undefined;

    // Count occurrences
    const gradeCounts = new Map<string, number>();
    grades.forEach(g => {
      gradeCounts.set(g, (gradeCounts.get(g) || 0) + 1);
    });

    // Find most common
    let maxCount = 0;
    let mostCommon = grades[0];
    gradeCounts.forEach((count, grade) => {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = grade;
      }
    });

    return mostCommon;
  }

  /**
   * Extract marking data from UnifiedSession
   */
  private static async getMarkingDataFromSession(sessionId: string): Promise<MarkingDataForAnalysis | null> {
    try {
      const session = await FirestoreService.getUnifiedSession(sessionId);

      if (!session || !session.messages) {
        return null;
      }

      // Find all assistant messages with marking results
      // Check for studentScore and either marking_annotated type or imageDataArray/imageData
      const markingMessages = session.messages.filter((msg: UnifiedMessage) =>
        msg.role === 'assistant' &&
        msg.studentScore &&
        (msg.type === 'marking_annotated' || (msg as any).imageDataArray || (msg as any).imageData)
      );

      if (markingMessages.length === 0) {
        return null;
      }

      // Get the main marking message (usually the last one with studentScore)
      const mainMarkingMessage = markingMessages[markingMessages.length - 1];

      // Extract overall score from studentScore
      const totalAwarded = mainMarkingMessage.studentScore?.awardedMarks || 0;
      const totalPossible = mainMarkingMessage.studentScore?.totalMarks || 0;

      // Extract detected question for exam metadata
      const detectedQuestion = mainMarkingMessage.detectedQuestion;
      if (!detectedQuestion || !detectedQuestion.found) {
        return null;
      }

      const examMetadata = {
        examBoard: detectedQuestion?.examPapers?.[0]?.examBoard || '',
        examCode: detectedQuestion?.examPapers?.[0]?.examCode || '',
        examSeries: detectedQuestion?.examPapers?.[0]?.examSeries || '',
        subject: detectedQuestion?.examPapers?.[0]?.subject || '',
        paperTitle: detectedQuestion?.examPapers?.[0]?.paperTitle || ''
      };

      // Reconstruct question results from detectedQuestion.questions
      // Note: Annotations are not stored in the message, so we'll use a simplified approach
      // We'll estimate question scores based on overall performance distribution
      const questionResults: MarkingDataForAnalysis['questionResults'] = [];

      // Build question results from detectedQuestion structure
      if (detectedQuestion.examPapers && detectedQuestion.examPapers.length > 0) {
        // Handle multiple exam papers if needed
        detectedQuestion.examPapers.forEach((examPaper: any) => {
          if (examPaper.questions && Array.isArray(examPaper.questions)) {
            const totalPossibleMarks = examPaper.questions.reduce((sum: number, q: any) => sum + (q.marks || 0), 0);
            const overallPercentage = totalPossible > 0 ? totalAwarded / totalPossible : 0;

            examPaper.questions.forEach((q: any) => {
              const questionNum = q.questionNumber || '';
              if (!questionNum) return;

              // Estimate awarded marks based on overall performance percentage
              // This is a simplified approach - in a real system, question scores would be stored
              const estimatedAwardedMarks = Math.round((q.marks || 0) * overallPercentage);

              questionResults.push({
                questionNumber: questionNum,
                score: {
                  awardedMarks: estimatedAwardedMarks,
                  totalMarks: q.marks || 0
                }
              });
            });
          }
        });
      }

      // Sort question results by question number
      questionResults.sort((a, b) => {
        const numA = this.extractNumericPart(a.questionNumber);
        const numB = this.extractNumericPart(b.questionNumber);
        return numA - numB;
      });

      // Calculate percentage
      const percentage = totalPossible > 0 ? Math.round((totalAwarded / totalPossible) * 100) : 0;

      return {
        questionResults,
        overallScore: {
          awarded: totalAwarded,
          total: totalPossible,
          percentage
        },
        examMetadata,
        grade: mainMarkingMessage.grade || undefined
      };

    } catch (error) {
      console.error('❌ [ANALYSIS SERVICE] Error extracting marking data:', error);
      return null;
    }
  }

  /**
   * Extract numeric part from question number (e.g., "3a" -> 3, "12" -> 12)
   */
  private static extractNumericPart(questionNumber: string): number {
    const match = questionNumber.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Format marking data for AI prompt
   */
  private static formatDataForAI(
    markingData: MarkingDataForAnalysis,
    lastAnalysisReport?: AnalysisResult
  ): string {
    let formatted = `MARKING RESULTS ANALYSIS\n`;
    formatted += `========================\n\n`;

    formatted += `EXAM INFORMATION:\n`;
    formatted += `- Exam Board: ${markingData.examMetadata.examBoard || 'N/A'}\n`;
    formatted += `- Exam Code: ${markingData.examMetadata.examCode || 'N/A'}\n`;
    formatted += `- Exam Series: ${markingData.examMetadata.examSeries || 'N/A'}\n`;
    formatted += `- Subject: ${markingData.examMetadata.subject || 'N/A'}\n`;
    if (markingData.sessionCount && markingData.sessionCount > 1) {
      formatted += `- Number of Sessions Analyzed: ${markingData.sessionCount}\n`;
    }
    formatted += `\n`;

    formatted += `OVERALL PERFORMANCE (${markingData.sessionCount && markingData.sessionCount > 1 ? 'AVERAGE ACROSS ALL SESSIONS' : 'SINGLE SESSION'}):\n`;
    formatted += `- Average Score: ${markingData.overallScore.awarded}/${markingData.overallScore.total}\n`;
    formatted += `- Average Percentage: ${markingData.overallScore.percentage}%\n`;
    formatted += `- **IMPORTANT: Use this exact score (${markingData.overallScore.awarded}/${markingData.overallScore.total}) for grade analysis, NOT the sum of question results**\n`;
    if (markingData.grade) {
      formatted += `- Highest Grade Achieved: ${markingData.grade}\n`;
    }
    if (markingData.averageGrade) {
      formatted += `- Average Grade: ${markingData.averageGrade}\n`;
    }
    formatted += `\n`;

    // Include grade boundaries if available
    if (markingData.gradeBoundaries) {
      formatted += `GRADE BOUNDARIES:\n`;
      formatted += `- Boundary Type: ${markingData.gradeBoundaries.boundaryType}\n`;
      formatted += `- Boundaries:\n`;
      const sortedBoundaries = Object.entries(markingData.gradeBoundaries.boundaries)
        .sort(([a], [b]) => {
          const numA = parseInt(a, 10) || 0;
          const numB = parseInt(b, 10) || 0;
          return numB - numA; // Descending: 9, 8, 7, ...
        });

      sortedBoundaries.forEach(([grade, boundary]) => {
        formatted += `  Grade ${grade}: ${boundary} marks\n`;
      });
      formatted += `\n`;
      formatted += `Current Performance: ${markingData.overallScore.awarded} marks\n`;
      formatted += `\n`;

      // Calculate grade gap and provide strategic context
      const currentMarks = markingData.overallScore.awarded;
      let currentGrade: string | null = null;
      let nextGrade: string | null = null;
      let marksToNextGrade: number | null = null;
      let nextGradeBoundary: number | null = null;

      // Find current grade and next grade
      for (let i = 0; i < sortedBoundaries.length; i++) {
        const [grade, boundary] = sortedBoundaries[i];
        const boundaryMarks = boundary as number;
        if (currentMarks >= boundaryMarks) {
          currentGrade = grade;
          if (i > 0) {
            nextGrade = sortedBoundaries[i - 1][0];
            nextGradeBoundary = sortedBoundaries[i - 1][1] as number;
            marksToNextGrade = nextGradeBoundary - currentMarks;
          }
          break;
        }
      }

      // If below lowest grade, set next grade as lowest
      if (!currentGrade && sortedBoundaries.length > 0) {
        nextGrade = sortedBoundaries[sortedBoundaries.length - 1][0];
        nextGradeBoundary = sortedBoundaries[sortedBoundaries.length - 1][1] as number;
        marksToNextGrade = nextGradeBoundary - currentMarks;
      }

      // Handle case where student is at highest grade (no next grade available)
      if (currentGrade && !nextGrade && sortedBoundaries.length > 0) {
        // Student is at highest grade - focus on maintaining or perfect score
        const highestGradeBoundary = sortedBoundaries[0][1] as number;
        const marksToPerfect = markingData.overallScore.total - currentMarks;
        formatted += `GRADE IMPROVEMENT ANALYSIS:\n`;
        formatted += `- Current Grade: ${currentGrade} (Highest Grade)\n`;
        formatted += `- Current Marks: ${currentMarks} marks\n`;
        formatted += `- Perfect Score: ${markingData.overallScore.total} marks\n`;
        formatted += `- Marks to Perfect: ${marksToPerfect} marks\n`;
        formatted += `\nSTRATEGIC FOCUS:\n`;
        formatted += `- Focus on maintaining Grade ${currentGrade} and reducing errors\n`;
        formatted += `- Analyze question-by-question results to identify where ${marksToPerfect} marks were lost\n`;
        formatted += `- Target areas for perfection: reduce calculation errors, improve presentation, ensure all method marks are earned\n`;
        formatted += `\n`;
      } else if (currentGrade && nextGrade && marksToNextGrade !== null && marksToNextGrade > 0) {
        formatted += `GRADE IMPROVEMENT ANALYSIS:\n`;
        formatted += `- Current Grade: ${currentGrade}\n`;
        formatted += `- Next Grade Target: ${nextGrade}\n`;
        formatted += `- Marks Needed: ${marksToNextGrade} marks\n`;
        formatted += `- Current Marks: ${currentMarks} marks\n`;
        formatted += `- Next Grade Boundary: ${nextGradeBoundary} marks\n`;
        formatted += `\nSTRATEGIC FOCUS:\n`;
        formatted += `- Analyze question-by-question results to identify:\n`;
        formatted += `  * Which weak areas, if improved, could gain the ${marksToNextGrade} marks needed\n`;
        formatted += `  * Which strong areas can be leveraged for additional marks (1-2 marks through perfection)\n`;
        formatted += `  * Prioritize improvements with highest mark potential and "marks per effort" ratio\n`;
        formatted += `- Consider: If close to boundary (≤5 marks), focus on reducing errors and partial credit. If far (6+ marks), focus on foundational understanding.\n`;
        formatted += `\n`;
      } else if (nextGrade && marksToNextGrade !== null && marksToNextGrade > 0) {
        formatted += `GRADE IMPROVEMENT ANALYSIS:\n`;
        formatted += `- Current Performance: Below Grade ${nextGrade}\n`;
        formatted += `- Target Grade: ${nextGrade}\n`;
        formatted += `- Marks Needed: ${marksToNextGrade} marks\n`;
        formatted += `- Current Marks: ${currentMarks} marks\n`;
        formatted += `- Grade Boundary: ${nextGradeBoundary} marks\n`;
        formatted += `\nSTRATEGIC FOCUS:\n`;
        formatted += `- Focus on foundational understanding and systematic practice\n`;
        formatted += `- Target areas with highest mark potential\n`;
        formatted += `\n`;
      }
    }

    formatted += `QUESTION-BY-QUESTION RESULTS:\n`;
    formatted += `(Analyze these to identify student weaknesses, patterns of errors, and specific improvement targets)\n`;
    formatted += `**IMPORTANT: The sum of question results may differ from the actual overall score. Always use the overall score ${markingData.overallScore.awarded}/${markingData.overallScore.total} from above for grade calculations.**\n`;
    markingData.questionResults.forEach((qr) => {
      const marksLost = qr.score.totalMarks - qr.score.awardedMarks;
      const percentage = qr.score.totalMarks > 0 ? Math.round((qr.score.awardedMarks / qr.score.totalMarks) * 100) : 0;
      const scoreText = `${qr.score.awardedMarks}/${qr.score.totalMarks}`;
      formatted += `\nQuestion ${qr.questionNumber}:\n`;
      formatted += `  Score: ${scoreText} (${qr.score.awardedMarks}/${qr.score.totalMarks}, ${percentage}%)\n`;
      formatted += `  Marks Lost: ${marksLost} marks\n`;
    });

    // Add summary of weak questions
    const weakQuestions = markingData.questionResults.filter((qr) => {
      const percentage = qr.score.totalMarks > 0 ? (qr.score.awardedMarks / qr.score.totalMarks) : 0;
      return percentage < 0.7; // Less than 70%
    });

    if (weakQuestions.length > 0) {
      formatted += `\nWEAK QUESTIONS (scoring <70%):\n`;
      weakQuestions.forEach((qr) => {
        const percentage = qr.score.totalMarks > 0 ? Math.round((qr.score.awardedMarks / qr.score.totalMarks) * 100) : 0;
        const scoreText = `${qr.score.awardedMarks}/${qr.score.totalMarks}`;
        formatted += `- Q${qr.questionNumber}: ${scoreText} (${percentage}%) - ${qr.score.totalMarks - qr.score.awardedMarks} marks lost\n`;
      });
      formatted += `\n`;
    }

    if (lastAnalysisReport) {
      formatted += `\n\nPREVIOUS ANALYSIS REPORT:\n`;
      formatted += `========================\n`;
      formatted += `Summary: ${lastAnalysisReport.performance.summary}\n`;
      formatted += `Strengths: ${lastAnalysisReport.strengths.join(', ')}\n`;
      formatted += `Weaknesses: ${lastAnalysisReport.weaknesses.join(', ')}\n`;
      formatted += `\nPlease build upon this previous analysis, highlighting what has improved and what still needs work.\n`;
    }

    return formatted;
  }

  /**
   * Parse AI response into structured AnalysisResult
   */
  private static parseAnalysisResponse(aiResponse: string): AnalysisResult {
    try {
      // Try to extract JSON from response
      let jsonString = aiResponse;

      // Check for JSON code block
      const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        jsonString = jsonMatch[1];
      } else {
        // Check for JSON object directly
        const objectMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          jsonString = objectMatch[0];
        }
      }

      // Parse JSON
      const parsed = JSON.parse(jsonString.trim());

      // Validate and structure the response
      return {
        performance: {
          overallScore: parsed.performance?.overallScore || 'N/A',
          percentage: parsed.performance?.percentage || 0,
          grade: parsed.performance?.grade, // Highest grade
          averageGrade: parsed.performance?.averageGrade, // Average grade
          summary: parsed.performance?.summary || 'No summary available.',
          gradeAnalysis: parsed.performance?.gradeAnalysis || undefined // Strategic grade improvement analysis
        },
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
        weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : []
      };

    } catch (error) {
      console.error('❌ [ANALYSIS SERVICE] Error parsing AI response:', error);
      console.error('❌ [ANALYSIS SERVICE] Raw response:', aiResponse);

      // Fallback: Return a basic structure with the raw response as summary
      return {
        performance: {
          overallScore: 'N/A',
          percentage: 0,
          grade: undefined,
          averageGrade: undefined,
          summary: 'Failed to parse analysis. Please try again.',
          gradeAnalysis: undefined
        },
        strengths: [],
        weaknesses: []
      };
    }
  }

  /**
   * Get existing analysis from session (if stored in a message)
   */
  static async getExistingAnalysis(sessionId: string): Promise<AnalysisResult | null> {
    try {
      const session = await FirestoreService.getUnifiedSession(sessionId);

      if (!session || !session.messages) {
        return null;
      }

      // Look for a message with type 'analysis' or containing analysis data
      const analysisMessage = session.messages.find((msg: UnifiedMessage) =>
        msg.type === 'analysis' || (msg as any).analysisResult
      );

      if (analysisMessage && (analysisMessage as any).analysisResult) {
        return (analysisMessage as any).analysisResult as AnalysisResult;
      }

      return null;

    } catch (error) {
      console.error('❌ [ANALYSIS SERVICE] Error getting existing analysis:', error);
      return null;
    }
  }

  /**
   * Check if session has new marking results (compared to last analysis)
   */
  static async hasNewMarkingResults(sessionId: string): Promise<boolean> {
    try {
      const session = await FirestoreService.getUnifiedSession(sessionId);

      if (!session || !session.messages) {
        return false;
      }

      // Find last analysis message timestamp
      const lastAnalysisMessage = session.messages
        .filter((msg: UnifiedMessage) => msg.type === 'analysis')
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

      if (!lastAnalysisMessage) {
        // No previous analysis, so there are "new" results
        return true;
      }

      // Find marking messages after last analysis
      const markingMessagesAfterAnalysis = session.messages.filter((msg: UnifiedMessage) =>
        msg.role === 'assistant' &&
        msg.type === 'marking_annotated' &&
        new Date(msg.timestamp).getTime() > new Date(lastAnalysisMessage.timestamp).getTime()
      );

      return markingMessagesAfterAnalysis.length > 0;

    } catch (error) {
      console.error('❌ [ANALYSIS SERVICE] Error checking for new results:', error);
      return true; // Default to true to allow regeneration
    }
  }

  /**
   * Fetch grade boundaries for the exam
   */
  private static async fetchGradeBoundaries(
    examBoard: string,
    examSeries: string,
    subject: string,
    examCode: string,
    tier: string
  ): Promise<{ boundaries: { [grade: string]: number }; boundaryType: 'Paper-Specific' | 'Overall-Total' } | null> {
    try {
      const { GradeBoundaryService } = await import('../marking/GradeBoundaryService.js');

      // Use GradeBoundaryService to find boundaries
      const boundaryEntry = await GradeBoundaryService.findMatchingGradeBoundary(
        examBoard,
        examSeries,
        subject,
        examCode,
        tier
      );

      if (!boundaryEntry) {
        return null;
      }

      // Find matching subject and tier
      const matchingSubject = boundaryEntry.subjects?.find((s: any) =>
        s.name?.toLowerCase() === subject.toLowerCase()
      );

      if (!matchingSubject) {
        return null;
      }

      const normalizedTier = this.normalizeTier(tier);
      const matchingTier = matchingSubject.tiers?.find((t: any) =>
        this.normalizeTier(t.tier_level) === normalizedTier
      );

      if (!matchingTier) {
        // Try to get first tier if tier doesn't match
        const firstTier = matchingSubject.tiers?.[0];
        if (firstTier) {
          // Get boundaries based on type
          if (firstTier.boundaries_type === 'Paper-Specific' && firstTier.papers) {
            // Find matching paper
            const matchingPaper = firstTier.papers.find((p: any) => p.code === examCode);
            if (matchingPaper && matchingPaper.boundaries) {
              return {
                boundaries: matchingPaper.boundaries,
                boundaryType: 'Paper-Specific'
              };
            }
          } else if (firstTier.boundaries_type === 'Overall-Total' && firstTier.overall_total_boundaries) {
            return {
              boundaries: firstTier.overall_total_boundaries,
              boundaryType: 'Overall-Total'
            };
          }
        }
        return null;
      }

      // Get boundaries based on type
      if (matchingTier.boundaries_type === 'Paper-Specific' && matchingTier.papers) {
        // Find matching paper
        const matchingPaper = matchingTier.papers.find((p: any) => p.code === examCode);
        if (matchingPaper && matchingPaper.boundaries) {
          return {
            boundaries: matchingPaper.boundaries,
            boundaryType: 'Paper-Specific'
          };
        }
      } else if (matchingTier.boundaries_type === 'Overall-Total' && matchingTier.overall_total_boundaries) {
        return {
          boundaries: matchingTier.overall_total_boundaries,
          boundaryType: 'Overall-Total'
        };
      }

      return null;
    } catch (error) {
      console.error('❌ [ANALYSIS SERVICE] Error fetching grade boundaries:', error);
      return null;
    }
  }

  /**
   * Extract paper code from examCode (e.g., "1MA1/1H" -> "1H")
   */
  private static extractPaperCode(examCode: string): string | null {
    if (!examCode || !examCode.includes('/')) {
      return null;
    }
    const parts = examCode.split('/');
    return parts.length > 1 ? parts[parts.length - 1].trim() : null;
  }

  /**
   * Get marking data from subjectMarkingResults collection
   * Supports filtering by qualification, exam board, and paper code set
   */
  private static async getMarkingDataFromSubjectMarkingResult(
    userId: string,
    subject: string,
    qualification?: string,
    examBoard?: string,
    paperCodeSet?: string[]
  ): Promise<MarkingDataForAnalysis | null> {
    try {
      const subjectResult = await FirestoreService.getSubjectMarkingResult(userId, subject);

      if (!subjectResult || !subjectResult.markingResults || subjectResult.markingResults.length === 0) {
        return null;
      }

      let markingResults = subjectResult.markingResults;

      // Filter by qualification if provided
      if (qualification) {
        markingResults = markingResults.filter((mr: any) =>
          mr.examMetadata?.qualification === qualification
        );
      }

      // Filter by exam board if provided
      if (examBoard) {
        markingResults = markingResults.filter((mr: any) =>
          mr.examMetadata?.examBoard === examBoard
        );
      }

      // Filter by paper code set if provided
      if (paperCodeSet && paperCodeSet.length > 0) {
        markingResults = markingResults.filter((mr: any) => {
          const paperCode = this.extractPaperCode(mr.examMetadata?.examCode || '');
          return paperCode && paperCodeSet.includes(paperCode);
        });
      }

      if (markingResults.length === 0) {
        return null;
      }

      // Aggregate question results from filtered marking results
      const questionResultsMap = new Map<string, MarkingDataForAnalysis['questionResults'][0]>();
      const sessionScores: Array<{ awarded: number; total: number; percentage: number; grade?: string }> = [];
      const grades: string[] = [];

      markingResults.forEach((mr: any) => {
        // Compute percentage from awardedMarks/totalMarks
        const percentage = mr.overallScore.totalMarks > 0
          ? Math.round((mr.overallScore.awardedMarks / mr.overallScore.totalMarks) * 100)
          : 0;

        // Track session scores
        sessionScores.push({
          awarded: mr.overallScore.awardedMarks,
          total: mr.overallScore.totalMarks,
          percentage: percentage,
          grade: mr.grade
        });

        if (mr.grade) {
          grades.push(mr.grade);
        }

        // Aggregate question results (take latest if duplicate question numbers)
        if (mr.questionResults && Array.isArray(mr.questionResults)) {
          mr.questionResults.forEach((qr: any) => {
            const qNum = qr.questionNumber;
            if (qNum) {
              // Update if not exists or if this one has more marks (prefer higher total marks)
              const existing = questionResultsMap.get(qNum);
              if (!existing || qr.score.totalMarks > existing.score.totalMarks) {
                questionResultsMap.set(qNum, {
                  questionNumber: qNum,
                  score: qr.score
                });
              }
            }
          });
        }
      });

      // Convert map to array and sort
      const allQuestionResults = Array.from(questionResultsMap.values()).sort((a, b) => {
        const numA = this.extractNumericPart(a.questionNumber);
        const numB = this.extractNumericPart(b.questionNumber);
        return numA - numB;
      });

      // Calculate averages
      const totalAwarded = sessionScores.reduce((sum, s) => sum + s.awarded, 0);
      const totalPossible = sessionScores.reduce((sum, s) => sum + s.total, 0);
      const avgAwarded = sessionScores.length > 0 ? Math.round(totalAwarded / sessionScores.length) : 0;
      const avgTotal = sessionScores.length > 0 ? Math.round(totalPossible / sessionScores.length) : 0;
      const avgPercentage = avgTotal > 0 ? Math.round((avgAwarded / avgTotal) * 100) : 0;

      // Get exam metadata from first marking result
      const firstResult = markingResults[0];
      const examMetadata = {
        examBoard: firstResult.examMetadata.examBoard || '',
        examCode: firstResult.examMetadata.examCode || '',
        examSeries: firstResult.examMetadata.examSeries || '',
        subject: subject,
        tier: firstResult.examMetadata.tier || ''
      };

      // Find highest grade
      const highestGrade = grades.length > 0
        ? grades.reduce((highest, grade) => {
          const numHighest = parseInt(highest, 10) || 0;
          const numGrade = parseInt(grade, 10) || 0;
          return numGrade > numHighest ? grade : highest;
        })
        : undefined;

      // Find most common grade
      const gradeCounts = new Map<string, number>();
      grades.forEach(g => gradeCounts.set(g, (gradeCounts.get(g) || 0) + 1));
      let maxCount = 0;
      let averageGrade: string | undefined = undefined;
      gradeCounts.forEach((count, grade) => {
        if (count > maxCount) {
          maxCount = count;
          averageGrade = grade;
        }
      });

      // Extract grade boundaries from first marking result that has them
      let gradeBoundaries: { boundaries: { [grade: string]: number }; boundaryType: 'Paper-Specific' | 'Overall-Total' } | undefined = undefined;
      for (const mr of markingResults) {
        if (mr.gradeBoundaries && mr.gradeBoundaries.boundaries) {
          gradeBoundaries = {
            boundaries: mr.gradeBoundaries.boundaries,
            boundaryType: mr.gradeBoundaries.boundaryType
          };
          break; // Use first available
        }
      }

      return {
        questionResults: allQuestionResults,
        overallScore: {
          awarded: avgAwarded,
          total: avgTotal,
          percentage: avgPercentage
        },
        examMetadata,
        grade: highestGrade,
        averageGrade,
        sessionCount: markingResults.length,
        gradeBoundaries
      };

    } catch (error) {
      console.error('❌ [ANALYSIS SERVICE] Error getting marking data from subjectMarkingResults:', error);
      return null;
    }
  }

  /**
   * Normalize tier name (e.g., "Higher Tier" -> "higher")
   */
  private static normalizeTier(tier: string): string {
    if (!tier) return '';
    return tier.toLowerCase()
      .replace(/\s+tier\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

