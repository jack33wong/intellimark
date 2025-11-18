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
  detectedQuestion?: any; // Optional: for unauthenticated users who don't have sessions in Firestore
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
    const { mode, sessionId, sourceMessageId, model, detectedQuestion } = request;
    
    // Validate inputs
    if (!isValidSuggestedFollowUpMode(mode)) {
      throw new Error(`Invalid suggested follow-up mode: ${mode}`);
    }
    
    if (!sessionId) {
      throw new Error(`No sessionId provided for ${mode}`);
    }

    // Get target message with detected question data
    // For unauthenticated users, use detectedQuestion from request if provided
    // For authenticated users, fetch from Firestore
    let targetMessage;
    if (detectedQuestion) {
      // Unauthenticated user: use provided detectedQuestion directly
      targetMessage = {
        detectedQuestion: detectedQuestion
      };
    } else {
      // Authenticated user: fetch from Firestore
      targetMessage = await this.getTargetMessage(sessionId, sourceMessageId);
    }
    
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
      const targetMsg = existingSession?.messages?.find((msg: any) => 
        msg.id === sourceMessageId
      );
      
      if (targetMsg) {
        // Target message found
      }
      
      return targetMsg;
    } else {
      // Fallback: Find the most recent assistant message
      const messagesWithDetectedQuestion = existingSession?.messages?.filter((msg: any) => 
        msg.role === 'assistant' && msg.detectedQuestion?.found
      ) || [];
      
      if (messagesWithDetectedQuestion.length === 0) {
        // No assistant messages with detectedQuestion found
      }
      
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
      
      // Log all extracted questions for debugging
      console.log(`📋 [${mode.toUpperCase()}] Extracted ${allQuestions.length} questions: ${allQuestions.map(q => q.questionNumber).join(', ')}`);
      
      // Sort all questions by question number (ascending) for consistent ordering across all modes
      const sortedAllQuestions = [...allQuestions].sort((a, b) => {
        const numA = parseInt(String(a.questionNumber || '').replace(/\D/g, '')) || 0;
        const numB = parseInt(String(b.questionNumber || '').replace(/\D/g, '')) || 0;
        return numA - numB;
      });
      
      console.log(`📋 [${mode.toUpperCase()}] Questions sorted: ${sortedAllQuestions.map(q => q.questionNumber).join(', ')}`);
      
      // For model answer mode with multiple questions: run in parallel
      if (mode === 'modelanswer' && sortedAllQuestions.length > 1) {
        // Use already sorted questions (sorted above)
        const sortedQuestions = sortedAllQuestions;
        
        // Run parallel AI calls for each question (1 call per question, not per sub-question)
        // Each question already has FULL question text + FULL marking scheme stored
        const { ModelProvider } = await import('../../utils/ModelProvider.js');
        const systemPrompt = getPrompt(`${config.promptKey}.system`);
        
        const parallelResults = await Promise.all(
          sortedQuestions.map(async (q) => {
            const questionNumberStr = String(q.questionNumber || '');
            
            // Question text is already FULL (main + all sub-questions) - just clean prefix if needed
            let cleanedQuestionText = q.questionText || '';
            
            // Remove question number prefix from question text (e.g., "Question 12", "Q12", "12")
            const questionNumberPattern = questionNumberStr.replace(/[()]/g, '\\$&'); // Escape special chars
            const patterns = [
              new RegExp(`^Question\\s+${questionNumberPattern}\\s*[)\\-:\\.]?\\s*`, 'i'),
              new RegExp(`^Q\\s*${questionNumberPattern}\\s*[)\\-:\\.]?\\s*`, 'i'),
              new RegExp(`^${questionNumberPattern}\\s*[)\\-:\\.]\\s*`, 'i'), // "12)", "12:", "12."
              new RegExp(`^${questionNumberPattern}\\s+`, 'i') // "12 "
            ];
            
            for (const pattern of patterns) {
              cleanedQuestionText = cleanedQuestionText.replace(pattern, '');
            }
            cleanedQuestionText = cleanedQuestionText.trim();
            
            // markingScheme must be plain text (FULL marking scheme - all sub-questions combined, same format as sent to AI for marking instruction)
            if (typeof q.markingScheme !== 'string') {
              throw new Error(`[MODEL ANSWER] Invalid marking scheme format for Q${q.questionNumber}: expected plain text string, got ${typeof q.markingScheme}. Please clear old data and create new sessions.`);
            }
            const markingScheme = q.markingScheme; // FULL marking scheme (all sub-questions combined)
            const userPrompt = getPrompt(`${config.promptKey}.user`, cleanedQuestionText, markingScheme, q.marks, questionNumberStr);
            
            const aiResult = await ModelProvider.callText(systemPrompt, userPrompt, model as any);
            
            return {
              questionNumber: q.questionNumber,
              response: aiResult.content, // AI returns response in the format we specify (Question X, then sub-questions if any)
              usageTokens: aiResult.usageTokens || 0
            };
          })
        );
        
        // Simply combine all responses with separators (no parsing logic needed)
        // AI already returns responses in the correct format: "Question X\n\nquestion text\n\na) sub question text\n\nmodel answer\n\nb) sub question text\n\nmodel answer"
        const separator = '\n\n' + '='.repeat(50) + '\n\n';
        const combinedResponse = parallelResults
          .map(result => result.response) // Use AI response directly (already in correct format)
          .join(separator);
        
        const totalUsageTokens = parallelResults.reduce((sum, r) => sum + r.usageTokens, 0);
        
        // Get real API name based on model
        const getRealApiName = (modelName: string): string => {
          if (modelName.includes('gemini')) {
            return 'Google Gemini API';
          }
          if (modelName.includes('openai') || modelName.includes('gpt-')) {
            return 'OpenAI API';
          }
          return 'Unknown API';
        };
        
        // Complete progress tracking
        progressTracker.completeCurrentStep();
        progressTracker.finish();
        
        return {
          response: combinedResponse,
          apiUsed: `${getRealApiName(model)} (${model}) - Parallel execution`,
          progressData: null
        };
      }
      
      // For other modes or single question: use original sequential logic
      let questionText: string;
      let markingScheme: string;
      let totalMarks: number | undefined;
      let questionCount: number | undefined;
      
      questionCount = sortedAllQuestions.length;
      
      // For multiple questions, format each separately in the prompt
      if (sortedAllQuestions.length > 1) {
        // Aggregate all question texts with clear separation (already sorted by question number)
        questionText = sortedAllQuestions.map((q, index) => {
          const separator = '\n' + '='.repeat(50) + '\n';
          if (index === 0) {
            return `Question ${q.questionNumber} (${q.marks} marks) - ${q.examBoard} ${q.examCode} (${q.examSeries}) ${q.tier}:\n${q.questionText}`;
          }
          return `${separator}Question ${q.questionNumber} (${q.marks} marks) - ${q.examBoard} ${q.examCode} (${q.examSeries}) ${q.tier}:\n${q.questionText}`;
        }).join('\n\n');
        
        // Aggregate all marking schemes (must be plain text format)
        // Format them with question labels for clarity (already sorted by question number)
        const combinedSchemeText = sortedAllQuestions.map(q => {
          if (typeof q.markingScheme !== 'string') {
            throw new Error(`[MULTI-QUESTION] Invalid marking scheme format for Q${q.questionNumber}: expected plain text string, got ${typeof q.markingScheme}. Please clear old data and create new sessions.`);
          }
          return `**Question ${q.questionNumber} (${q.marks} marks):**\n${q.markingScheme}`;
        }).join('\n\n');
        
        markingScheme = combinedSchemeText;
        
        // Sum total marks across all questions
        totalMarks = sortedAllQuestions.reduce((sum, q) => sum + (q.marks || 0), 0);
        
        // Enhanced debug logging for multiple questions
        console.log(`📋 [${mode.toUpperCase()}] Aggregating data for ${sortedAllQuestions.length} questions (sorted by question number)`);
        sortedAllQuestions.forEach(q => {
          console.log(`  - Q${q.questionNumber}: ${q.marks} marks, ${q.markingScheme?.length || 0} mark points (${q.examBoard} ${q.examCode})`);
          console.log(`    Text: ${q.questionText?.substring(0, 60)}...`);
        });
      } else {
        // Single question (use sorted array for consistency)
        const q = sortedAllQuestions[0];
        questionText = q.questionText;
        // markingScheme must be plain text (same format as sent to AI for marking instruction)
        if (typeof q.markingScheme !== 'string') {
          throw new Error(`[SINGLE QUESTION] Invalid marking scheme format: expected plain text string, got ${typeof q.markingScheme}. Please clear old data and create new sessions.`);
        }
        markingScheme = q.markingScheme;
        totalMarks = q.marks;
      }
      
      const systemPrompt = getPrompt(`${config.promptKey}.system`);
      // For model answer mode, pass question number; for other modes (e.g., similar questions), pass questionCount
      const singleQuestionNumber = mode === 'modelanswer' && sortedAllQuestions.length === 1 
        ? String(sortedAllQuestions[0].questionNumber || '') 
        : undefined;
      const userPrompt = getPrompt(`${config.promptKey}.user`, 
        questionText,
        markingScheme,
        mode === 'modelanswer' ? totalMarks : questionCount,  // For model answer: pass totalMarks, for similar questions: pass questionCount
        mode === 'modelanswer' ? singleQuestionNumber : undefined  // For model answer: pass question number
      );
      
      // DEBUG: Print the detectedQuestion data and user prompt for all multi-question follow-ups
      if (sortedAllQuestions.length > 1) {
        console.log('='.repeat(80));
        console.log(`🔍 [${mode.toUpperCase()} DEBUG] detectedQuestion data (${sortedAllQuestions.length} questions, sorted by question number):`);
        sortedAllQuestions.forEach((q, idx) => {
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
      const aiResult = await ModelProvider.callText(systemPrompt, userPrompt, model as any);
      
      // Get real API name based on model
      const getRealApiName = (modelName: string): string => {
        if (modelName.includes('gemini')) {
          return 'Google Gemini API';
        }
        if (modelName.includes('openai') || modelName.includes('gpt-')) {
          return 'OpenAI API';
        }
        return 'Unknown API';
      };
      
      const contextualResult = {
        response: aiResult.content,
        apiUsed: `${getRealApiName(model)} (${model})`,
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
    } else {
      // No exam papers found - fallback to empty
      const systemPrompt = getPrompt(`${config.promptKey}.system`);
      const userPrompt = getPrompt(`${config.promptKey}.user`, '', '', undefined);
      
      const { ModelProvider } = await import('../../utils/ModelProvider.js');
      const aiResult = await ModelProvider.callText(systemPrompt, userPrompt, model as any);
      
      // Get real API name based on model
      const getRealApiName = (modelName: string): string => {
        if (modelName.includes('gemini')) {
          return 'Google Gemini API';
        }
        if (modelName.includes('openai') || modelName.includes('gpt-')) {
          return 'OpenAI API';
        }
        return 'Unknown API';
      };
      
      progressTracker.completeCurrentStep();
      progressTracker.finish();
      
      return {
        response: aiResult.content,
        apiUsed: `${getRealApiName(model)} (${model})`,
        progressData: null
      };
    }
  }

}
