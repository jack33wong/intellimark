/**
 * Analysis Service - Generates performance analysis reports from marking results
 */

import { ModelProvider } from '../../utils/ModelProvider.js';
import { FirestoreService } from '../firestoreService.js';
import { getPrompt } from '../../config/prompts.js';
import type { ModelType } from '../../config/aiModels.js';
import type { AnalysisRequest, AnalysisResult, MarkingDataForAnalysis } from './analysisTypes.js';
import type { UnifiedSession, UnifiedMessage } from '../../types/index.js';

export class AnalysisService {
  /**
   * Generate analysis report for a session
   * Cost-saving: Pass lastAnalysisReport if exists to avoid regenerating from scratch
   */
  static async generateAnalysis(
    request: AnalysisRequest,
    lastAnalysisReport?: AnalysisResult
  ): Promise<AnalysisResult> {
    try {
      // 1. Get marking data from session
      const markingData = await this.getMarkingDataFromSession(request.sessionId);
      
      if (!markingData || markingData.questionResults.length === 0) {
        throw new Error('No marking results found in session');
      }
      
      // 2. Format data for AI (include last report if available for context)
      const formattedData = this.formatDataForAI(markingData, lastAnalysisReport);
      
      // 3. Call AI with analysis prompt
      const systemPrompt = getPrompt('analysis.system');
      const userPrompt = getPrompt('analysis.user', formattedData, lastAnalysisReport || undefined);
      
      const aiResponse = await ModelProvider.callText(
        systemPrompt,
        userPrompt,
        request.model as ModelType,
        false
      );
      
      // 4. Parse AI response
      return this.parseAnalysisResponse(aiResponse.content);
      
    } catch (error) {
      console.error('❌ [ANALYSIS SERVICE] Error generating analysis:', error);
      throw error;
    }
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
    if (markingData.grade) {
      formatted += `- Grade: ${markingData.grade}\n`;
    }
    formatted += `\n`;
    
    formatted += `OVERALL PERFORMANCE:\n`;
    formatted += `- Score: ${markingData.overallScore.awarded}/${markingData.overallScore.total}\n`;
    formatted += `- Percentage: ${markingData.overallScore.percentage}%\n`;
    formatted += `\n`;
    
    formatted += `QUESTION-BY-QUESTION RESULTS:\n`;
    markingData.questionResults.forEach((qr) => {
      formatted += `\nQuestion ${qr.questionNumber}:\n`;
      formatted += `  Score: ${qr.score.scoreText}\n`;
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
          grade: parsed.performance?.grade,
          summary: parsed.performance?.summary || 'No summary available.'
        },
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
        weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
        topicAnalysis: Array.isArray(parsed.topicAnalysis) ? parsed.topicAnalysis : [],
        recommendations: {
          immediate: Array.isArray(parsed.recommendations?.immediate) ? parsed.recommendations.immediate : [],
          studyFocus: Array.isArray(parsed.recommendations?.studyFocus) ? parsed.recommendations.studyFocus : [],
          practiceAreas: Array.isArray(parsed.recommendations?.practiceAreas) ? parsed.recommendations.practiceAreas : []
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
}

