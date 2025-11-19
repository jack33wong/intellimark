/**
 * Analysis Service - Generates performance analysis reports from marking results
 */

import { ModelProvider } from '../../utils/ModelProvider.js';
import { FirestoreService } from '../firestoreService.js';
import { getPrompt } from '../../config/prompts.js';
import type { ModelType } from '../../config/aiModels.js';
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
        markingData = await this.getMarkingDataFromSubjectMarkingResult(userId, request.subject);
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
      if (markingData.examMetadata.examBoard && 
          markingData.examMetadata.examSeries && 
          markingData.examMetadata.subject &&
          markingData.examMetadata.examCode) {
        const gradeBoundaries = await this.fetchGradeBoundaries(
          markingData.examMetadata.examBoard,
          markingData.examMetadata.examSeries,
          markingData.examMetadata.subject,
          markingData.examMetadata.examCode,
          markingData.examMetadata.tier || ''
        );
        
        if (gradeBoundaries) {
          markingData.gradeBoundaries = gradeBoundaries;
        }
      }
      
      // 3. Format data for AI (include last report if available for context)
      const formattedData = this.formatDataForAI(markingData, lastAnalysisReport);
      
      // 4. Call AI with analysis prompt
      const systemPrompt = getPrompt('analysis.system');
      const userPrompt = getPrompt('analysis.user', formattedData, lastAnalysisReport || undefined);
      
      const aiResponse = await ModelProvider.callText(
        systemPrompt,
        userPrompt,
        request.model as ModelType,
        false
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
                        totalMarks: q.marks || 0,
                        scoreText: '0/0' // Will update
                      },
                      annotations: []
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
        qr.score.scoreText = `${estimatedAwardedMarks}/${qr.score.totalMarks}`;
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
                  totalMarks: q.marks || 0,
                  scoreText: `${estimatedAwardedMarks}/${q.marks || 0}`
                },
                annotations: [] // Annotations not available in stored message
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
    formatted += `- Paper Title: ${markingData.examMetadata.paperTitle || 'N/A'}\n`;
    if (markingData.sessionCount && markingData.sessionCount > 1) {
      formatted += `- Number of Sessions Analyzed: ${markingData.sessionCount}\n`;
    }
    formatted += `\n`;
    
    formatted += `OVERALL PERFORMANCE (${markingData.sessionCount && markingData.sessionCount > 1 ? 'AVERAGE ACROSS ALL SESSIONS' : 'SINGLE SESSION'}):\n`;
    formatted += `- Average Score: ${markingData.overallScore.awarded}/${markingData.overallScore.total}\n`;
    formatted += `- Average Percentage: ${markingData.overallScore.percentage}%\n`;
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
      Object.entries(markingData.gradeBoundaries.boundaries)
        .sort(([a], [b]) => {
          const numA = parseInt(a, 10) || 0;
          const numB = parseInt(b, 10) || 0;
          return numB - numA; // Descending: 9, 8, 7, ...
        })
        .forEach(([grade, boundary]) => {
          formatted += `  Grade ${grade}: ${boundary} marks\n`;
        });
      formatted += `\n`;
      formatted += `Current Performance: ${markingData.overallScore.awarded} marks\n`;
      formatted += `\nPlease advise the student on how many additional marks they need to achieve the next higher grade.\n`;
      formatted += `\n`;
    }
    
    formatted += `QUESTION-BY-QUESTION RESULTS:\n`;
    markingData.questionResults.forEach((qr) => {
      formatted += `\nQuestion ${qr.questionNumber}:\n`;
      formatted += `  Average Score: ${qr.score.scoreText}\n`;
    });
    
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
          summary: parsed.performance?.summary || 'No summary available.'
        },
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
        weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
        topicAnalysis: Array.isArray(parsed.topicAnalysis) ? parsed.topicAnalysis : [],
        recommendations: {
          immediate: [], // Removed - no longer used
          studyFocus: [], // Removed - no longer used
          practiceAreas: [] // Removed - no longer used
        },
        nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : []
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
          summary: 'Failed to parse analysis. Please try again.'
        },
        strengths: [],
        weaknesses: [],
        topicAnalysis: [],
        recommendations: {
          immediate: [],
          studyFocus: [],
          practiceAreas: []
        },
        nextSteps: []
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
   * Get marking data from subjectMarkingResults collection
   */
  private static async getMarkingDataFromSubjectMarkingResult(
    userId: string,
    subject: string
  ): Promise<MarkingDataForAnalysis | null> {
    try {
      const subjectResult = await FirestoreService.getSubjectMarkingResult(userId, subject);
      
      if (!subjectResult || !subjectResult.markingResults || subjectResult.markingResults.length === 0) {
        return null;
      }

      const markingResults = subjectResult.markingResults;
      
      // Aggregate question results from all marking results
      const questionResultsMap = new Map<string, MarkingDataForAnalysis['questionResults'][0]>();
      const sessionScores: Array<{ awarded: number; total: number; percentage: number; grade?: string }> = [];
      const grades: string[] = [];
      
      markingResults.forEach((mr: any) => {
        // Track session scores
        sessionScores.push({
          awarded: mr.overallScore.awardedMarks,
          total: mr.overallScore.totalMarks,
          percentage: mr.overallScore.percentage,
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
                  score: qr.score,
                  annotations: qr.annotations || []
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
        paperTitle: firstResult.examMetadata.paperTitle || '',
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
        sessionCount: markingResults.length
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

