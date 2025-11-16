/**
 * Suggested Follow-up Service - Handles all suggested follow-up actions
 * Centralizes common logic for model answer, marking scheme, step-by-step, etc.
 */

import { FirestoreService } from '../firestoreService.js';
import { MarkingServiceLocator } from './MarkingServiceLocator.js';
import { ProgressTracker, getStepsForMode } from '../../utils/progressTracker.js';
import { getSuggestedFollowUpConfig, isValidSuggestedFollowUpMode } from '../../config/suggestedFollowUpConfig.js';

export interface SuggestedFollowUpRequest {
  mode: string;
  sessionId: string;
  sourceMessageId?: string;
  model: string;
}

export interface SuggestedFollowUpResult {
  response: string;
  apiUsed: string;
  progressData: any;
}

export class SuggestedFollowUpService {
  /**
   * Handle any follow-up request with common logic
   */
  static async handleSuggestedFollowUp(request: SuggestedFollowUpRequest): Promise<SuggestedFollowUpResult> {
    const { mode, sessionId, sourceMessageId, model } = request;
    
    // Validate inputs
    if (!isValidSuggestedFollowUpMode(mode)) {
      throw new Error(`Invalid suggested follow-up mode: ${mode}`);
    }
    
    if (!sessionId) {
      throw new Error(`No sessionId provided for ${mode}`);
    }

    // Get target message with detected question data
    const targetMessage = await this.getTargetMessage(sessionId, sourceMessageId);
    if (!targetMessage?.detectedQuestion?.found) {
      throw new Error(`No detected question found for ${mode}`);
    }

    // Setup progress tracking
    let finalProgressData: any = null;
    const progressTracker = new ProgressTracker(getStepsForMode('text'), (data) => {
      finalProgressData = data;
    });

    // Execute the follow-up action
    const result = await this.executeFollowUpAction(mode, targetMessage, model, progressTracker);
    
    // Ensure progress data is included in result
    return {
      ...result,
      progressData: finalProgressData
    };
  }

  /**
   * Get the target message that triggered the follow-up
   */
  private static async getTargetMessage(sessionId: string, sourceMessageId?: string): Promise<any> {
    const existingSession = await FirestoreService.getUnifiedSession(sessionId);
    
    if (sourceMessageId) {
      // Find the specific message that triggered this follow-up
      return existingSession?.messages?.find((msg: any) => 
        msg.id === sourceMessageId
      );
    } else {
      // Fallback: Find the most recent assistant message
      const messagesWithDetectedQuestion = existingSession?.messages?.filter((msg: any) => 
        msg.role === 'assistant' && msg.detectedQuestion?.found
      ) || [];
      
      return messagesWithDetectedQuestion.length > 0 
        ? messagesWithDetectedQuestion[messagesWithDetectedQuestion.length - 1]
        : null;
    }
  }

  /**
   * Execute the specific follow-up action based on mode
   */
  private static async executeFollowUpAction(
    mode: string, 
    targetMessage: any, 
    model: string, 
    progressTracker: ProgressTracker
  ): Promise<SuggestedFollowUpResult> {
    // Start AI thinking step
    progressTracker.startStep('ai_thinking');
    
    // Complete AI thinking and start generating response
    progressTracker.completeCurrentStep();
    progressTracker.startStep('generating_response');
    
    // Get configuration for this mode
    const config = getSuggestedFollowUpConfig(mode);
    if (!config) {
      throw new Error(`No configuration found for suggested follow-up mode: ${mode}`);
    }
    
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, config.processingDelayMs));
    
    // Get prompts and execute AI call
    const { getPrompt } = await import('../../config/prompts.js');
    
    // Use new clean structure if available, otherwise fall back to legacy
    const detectedQuestion = targetMessage.detectedQuestion;
    let questionText: string;
    let markingScheme: string;
    let totalMarks: number | undefined;
    let questionCount: number | undefined;
    
    if (detectedQuestion?.examPapers && Array.isArray(detectedQuestion.examPapers)) {
      // Extract all questions from examPapers
      const allQuestions = detectedQuestion.examPapers.flatMap(examPaper => 
        examPaper.questions.map(q => ({
          ...q,
          examBoard: examPaper.examBoard,
          examCode: examPaper.examCode,
          examSeries: examPaper.examSeries,
          tier: examPaper.tier
        }))
      );
      
      questionCount = allQuestions.length;
      
      // For multiple questions, format each separately in the prompt
      if (allQuestions.length > 1) {
        // Aggregate all question texts with clear separation
        questionText = allQuestions.map((q, index) => {
          const separator = '\n' + '='.repeat(50) + '\n';
          if (index === 0) {
            return `Question ${q.questionNumber} (${q.marks} marks) - ${q.examBoard} ${q.examCode} (${q.examSeries}) ${q.tier}:\n${q.questionText}`;
          }
          return `${separator}Question ${q.questionNumber} (${q.marks} marks) - ${q.examBoard} ${q.examCode} (${q.examSeries}) ${q.tier}:\n${q.questionText}`;
        }).join('\n\n');
        
        // Aggregate all marking schemes in a readable format
        const combinedScheme = allQuestions.map(q => ({
          questionNumber: q.questionNumber,
          marks: q.marks,
          examBoard: q.examBoard,
          examCode: q.examCode,
          markingScheme: q.markingScheme
        }));
        
        markingScheme = JSON.stringify(combinedScheme, null, 2);
        
        // Sum total marks across all questions
        totalMarks = allQuestions.reduce((sum, q) => sum + (q.marks || 0), 0);
        
        // Enhanced debug logging for multiple questions
        console.log('📋 [MULTI-QUESTION] Aggregating data for', allQuestions.length, 'questions');
        allQuestions.forEach(q => {
          console.log(`  - Q${q.questionNumber}: ${q.marks} marks, ${q.markingScheme?.length || 0} mark points (${q.examBoard} ${q.examCode})`);
          console.log(`    Text: ${q.questionText?.substring(0, 60)}...`);
        });
      } else {
        // Single question
        const q = allQuestions[0];
        questionText = q.questionText;
        markingScheme = JSON.stringify(q.markingScheme || [], null, 2);
        totalMarks = q.marks;
      }
    } else {
      // No exam papers found
      questionText = '';
      markingScheme = '';
      totalMarks = 0;
    }
    
    const systemPrompt = getPrompt(`${config.promptKey}.system`);
    const userPrompt = getPrompt(`${config.promptKey}.user`, 
      questionText,
      markingScheme,
      questionCount  // Pass question count for similar questions prompt
    );
    
    // DEBUG: Print the detectedQuestion data and user prompt for all multi-question follow-ups
    if (detectedQuestion?.examPapers && Array.isArray(detectedQuestion.examPapers)) {
      const allQuestions = detectedQuestion.examPapers.flatMap(ep => ep.questions);
      if (allQuestions.length > 1) {
        console.log('='.repeat(80));
        console.log(`🔍 [${mode.toUpperCase()} DEBUG] detectedQuestion data (${allQuestions.length} questions):`);
        allQuestions.forEach((q, idx) => {
          console.log(`  Q${q.questionNumber}: ${q.marks} marks, ${q.questionText?.substring(0, 50)}...`);
        });
        console.log('Aggregated questionText length:', questionText.length);
        console.log('Aggregated markingScheme length:', markingScheme.length);
        console.log('Total marks:', totalMarks);
        console.log('='.repeat(80));
        console.log(`🔍 [${mode.toUpperCase()} DEBUG] Generated user prompt (first 500 chars):`);
        console.log(userPrompt.substring(0, 500) + '...');
        console.log('='.repeat(80));
      }
    }
    
    // Use ModelProvider directly with custom prompts
    const { ModelProvider } = await import('../../utils/ModelProvider.js');
    const aiResult = await ModelProvider.callGeminiText(systemPrompt, userPrompt, model as any);
    
    const contextualResult = {
      response: aiResult.content,
      apiUsed: `Gemini API (${model})`,
      confidence: 0.85,
      usageTokens: aiResult.usageTokens
    };
    
    // Complete progress tracking
    progressTracker.completeCurrentStep();
    progressTracker.finish();
    
    return {
      response: contextualResult.response,
      apiUsed: contextualResult.apiUsed,
      progressData: null // Will be set by the calling method
    };
  }

}
