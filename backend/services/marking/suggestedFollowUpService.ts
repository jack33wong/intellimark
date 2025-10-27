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
    
    if (detectedQuestion?.questions && Array.isArray(detectedQuestion.questions)) {
      // New clean structure - combine all questions for model answer
      const questions = detectedQuestion.questions;
      questionCount = questions.length;
      
      // For multiple questions, format each separately in the prompt
      if (questions.length > 1) {
        // Aggregate all question texts with clear separation
        questionText = questions.map((q, index) => {
          const separator = '\n' + '='.repeat(50) + '\n';
          if (index === 0) {
            return `Question ${q.questionNumber} (${q.marks} marks):\n${q.questionText}`;
          }
          return `${separator}Question ${q.questionNumber} (${q.marks} marks):\n${q.questionText}`;
        }).join('\n\n');
        
        // Aggregate all marking schemes in a readable format
        const combinedScheme = questions.map(q => ({
          questionNumber: q.questionNumber,
          marks: q.marks,
          markingScheme: q.markingScheme
        }));
        
        markingScheme = JSON.stringify(combinedScheme, null, 2);
        
        // Sum total marks across all questions
        totalMarks = questions.reduce((sum, q) => sum + (q.marks || 0), 0);
        
        // Enhanced debug logging for multiple questions
        console.log('📋 [MULTI-QUESTION] Aggregating data for', questions.length, 'questions');
        questions.forEach(q => {
          console.log(`  - Q${q.questionNumber}: ${q.marks} marks, ${q.markingScheme?.length || 0} mark points`);
          console.log(`    Text: ${q.questionText?.substring(0, 60)}...`);
        });
      } else {
        // Single question
        const q = questions[0];
        questionText = q.questionText;
        markingScheme = JSON.stringify(q.markingScheme || [], null, 2);
        totalMarks = q.marks;
      }
    } else {
      // Legacy structure - use existing fields
      questionText = detectedQuestion?.questionText || '';
      markingScheme = detectedQuestion?.markingScheme || '';
      totalMarks = detectedQuestion?.marks;
    }
    
    const systemPrompt = getPrompt(`${config.promptKey}.system`);
    const userPrompt = getPrompt(`${config.promptKey}.user`, 
      questionText,
      markingScheme,
      questionCount  // Pass question count for similar questions prompt
    );
    
    // DEBUG: Print the detectedQuestion data and user prompt for all multi-question follow-ups
    if (detectedQuestion?.questions && Array.isArray(detectedQuestion.questions) && detectedQuestion.questions.length > 1) {
      console.log('='.repeat(80));
      console.log(`🔍 [${mode.toUpperCase()} DEBUG] detectedQuestion data (${detectedQuestion.questions.length} questions):`);
      detectedQuestion.questions.forEach((q, idx) => {
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
