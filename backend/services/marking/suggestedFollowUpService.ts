/**
 * Suggested Follow-up Service - Handles all suggested follow-up actions
 * Centralizes common logic for model answer, marking scheme, step-by-step, etc.
 */

import { FirestoreService } from '../firestoreService.js';
import { MarkingServiceLocator } from './MarkingServiceLocator.js';
import { ProgressTracker, getStepsForMode } from '../../utils/progressTracker.js';
import { getSuggestedFollowUpConfig, isValidSuggestedFollowUpMode } from '../../config/suggestedFollowUpConfig.js';
import { UsageTracker } from '../../utils/UsageTracker.js';

export interface SuggestedFollowUpRequest {
  mode: string;
  sessionId: string;
  sourceMessageId?: string;
  model: string;
  detectedQuestion?: any; // Optional: for unauthenticated users who don't have sessions in Firestore
  tracker?: UsageTracker; // NEW: optional tracker for usage stats
}

export interface SuggestedFollowUpResult {
  response: string;
  apiUsed: string;
  progressData: any;
  usageTokens?: number;
}

export class SuggestedFollowUpService {
  /**
   * Handle any follow-up request with common logic
   */
  static async handleSuggestedFollowUp(request: SuggestedFollowUpRequest): Promise<SuggestedFollowUpResult> {
    const { mode, sessionId, sourceMessageId, model, detectedQuestion, tracker } = request;

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

    // If no detected question found, check if we have manually provided detectedQuestion with text (from Question Mode fallback)
    if (!targetMessage?.detectedQuestion?.found && (!targetMessage?.detectedQuestion?.examPapers || targetMessage.detectedQuestion.examPapers.length === 0)) {
      // Check if we have a fallback question structure (e.g. from Question Mode "Full Page" extraction)
      // The QuestionModeHandlerService constructs a detectedQuestion object even if found=false
      // We should allow it if it has questions/text
      const hasManualQuestions = targetMessage?.detectedQuestion?.questions && targetMessage.detectedQuestion.questions.length > 0;

      if (!hasManualQuestions) {
        throw new Error(`No detected question found for ${mode}`);
      }
    }

    // Setup progress tracking
    let finalProgressData: any = null;
    const progressTracker = new ProgressTracker(getStepsForMode('text'), (data) => {
      finalProgressData = data;
    });

    // Execute the follow-up action
    const result = await this.executeFollowUpAction(mode, targetMessage, model, progressTracker, tracker);

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
    progressTracker: ProgressTracker,
    tracker?: UsageTracker
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
    console.log(`[DEBUG] SuggestedFollowUpService: mode=${mode}, promptKey=${config.promptKey}`);

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, config.processingDelayMs));

    // Get prompts and execute AI call
    const { getPrompt } = await import('../../config/prompts.js');

    // Use new clean structure if available, otherwise fall back to legacy
    const detectedQuestion = targetMessage.detectedQuestion;

    // Helper to stringify marking scheme (handles text, array, and object formats)
    const stringifyMarkingScheme = (scheme: any): string => {
      if (!scheme) return '';
      if (typeof scheme === 'string') return scheme;

      // Handle Object Wrapper (Sanitized Scheme) - extract the marks array
      let marksArray = scheme;
      if (!Array.isArray(scheme) && scheme.marks && Array.isArray(scheme.marks)) {
        marksArray = scheme.marks;
      }

      // Case 1: Standard Array (or extracted array)
      if (Array.isArray(marksArray)) {
        return marksArray.map((s: any) => `- ${s.mark || 'Mark'}: ${s.answer} ${s.comments ? `(${s.comments})` : ''}`).join('\n');
      }
      return '';
    };

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


      // Sort all questions by question number (ascending) for consistent ordering across all modes
      const sortedAllQuestions = [...allQuestions].sort((a, b) => {
        const numA = parseInt(String(a.questionNumber || '').replace(/\D/g, '')) || 0;
        const numB = parseInt(String(b.questionNumber || '').replace(/\D/g, '')) || 0;
        return numA - numB;
      });



      // For model answer and marking scheme modes: Group sub-questions (e.g., 8a, 8b) under main question (Question 8)
      if (mode === 'modelanswer' || mode === 'markingscheme') {
        const { ModelProvider } = await import('../../utils/ModelProvider.js');
        const isModelAnswer = mode === 'modelanswer';
        const systemPrompt = getPrompt(`${config.promptKey}.system`);

        // Group questions by base number (regex for leading digits)
        const groupedMap = new Map<string, typeof sortedAllQuestions>();
        sortedAllQuestions.forEach(q => {
          const qNumStr = String(q.questionNumber || '');
          const match = qNumStr.match(/^(\d+)/);
          const baseNum = match ? match[1] : qNumStr;
          if (!groupedMap.has(baseNum)) {
            groupedMap.set(baseNum, []);
          }
          groupedMap.get(baseNum)!.push(q);
        });

        // Sort groups by base number
        const sortedGroups = Array.from(groupedMap.entries())
          .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
          .map(([baseNum, questions]) => ({ baseNum, questions }));



        const parallelResults = await Promise.all(
          sortedGroups.map(async ({ baseNum, questions }) => {
            // Combine text and marking schemes for the group
            // Join with double newlines to ensure separation
            const combinedQuestionText = questions.map(q => {
              const text = q.questionText || '';
              const qNum = String(q.questionNumber || '');

              // Extract sub-label (e.g., "2ai" -> "ai", "8a" -> "a")
              const subLabel = qNum.replace(baseNum, '');

              // If text already starts with label, don't double-add
              if (subLabel && !text.trim().startsWith(subLabel)) {
                return `${subLabel}) ${text}`;
              }
              return text;
            }).join('\n\n');

            // markingScheme must be plain text
            const combinedMarkingScheme = questions.map(q => {
              // Convert array format to string if needed
              if (Array.isArray(q.markingScheme)) {
                return stringifyMarkingScheme(q.markingScheme);
              }
              if (typeof q.markingScheme !== 'string') {
                // Return empty if invalid, or throw? Better to return empty to avoid crashing if data is weird
                console.warn(`[MODEL ANSWER] Invalid marking scheme format for Q${q.questionNumber}: expected string/array, got ${typeof q.markingScheme}`);
                return '';
              }
              return q.markingScheme;
            }).join('\n\n');

            const totalMarks = questions.reduce((sum, q) => sum + (q.marks || 0), 0);

            // Pass the group's "Question X" number explicitly
            const questionNumberStr = baseNum;

            const userPrompt = isModelAnswer
              ? getPrompt(`${config.promptKey}.user`, combinedQuestionText, combinedMarkingScheme, totalMarks, questionNumberStr)
              : getPrompt(`${config.promptKey}.user`, combinedQuestionText, combinedMarkingScheme, questionNumberStr);

            // --- DEBUG LOGGING: Print Prompt ---
            if ((isModelAnswer && process.env.LOG_SUGGESTED_MODEL_ANSWER === 'true') || (!isModelAnswer && process.env.LOG_MARKING_SCHEME_EXPLAIN === 'true')) {
              console.log(`\n🔍 [DEBUG] ${mode.toUpperCase()} PROMPT (Group ${baseNum}):`);
              console.log(`--- SYSTEM ---\n${systemPrompt}\n`);
              console.log(`--- USER ---\n${userPrompt}\n`);
            }

            // Determine appropriate phase for tracking
            const phase = mode === 'modelanswer' ? 'modelAnswer' :
              mode === 'markingscheme' ? 'markingScheme' : 'other';

            const aiResult = await ModelProvider.callText(systemPrompt, userPrompt, model as any, false, tracker, phase as any);

            // --- DEBUG LOGGING: Print Response ---
            if ((isModelAnswer && process.env.LOG_SUGGESTED_MODEL_ANSWER === 'true') || (!isModelAnswer && process.env.LOG_MARKING_SCHEME_EXPLAIN === 'true')) {
              console.log(`\n✅ [DEBUG] ${mode.toUpperCase()} RESPONSE (Group ${baseNum}):`);
              console.log(`${aiResult.content}\n`);
            }

            return {
              response: aiResult.content,
              usageTokens: aiResult.usageTokens || 0
            };
          })
        );

        // Simply combine all responses with separators
        // Use simple spacing instead of markdown horizontal rule as requested
        const separator = '\n\n<br><br>\n\n';
        const combinedResponse = parallelResults
          .map(result => {
            // STRICT POST-PROCESSING: Remove any markdown code blocks that slipped through
            // For marking schemes, we PRESERVE list bullets (*) and bold (**) for structural rendering
            let cleanResponse = result.response;

            // Remove code block wrappers (```markdown ... ``` or ```html ... ```)
            cleanResponse = cleanResponse.replace(/^```(markdown|html)?\s*/i, '').replace(/\s*```$/i, '');

            if (mode === 'modelanswer') {
              // Only strip formatting for model answer flow which uses specialized component containers
              // Remove bold syntax (**Answer:** -> Answer:)
              cleanResponse = cleanResponse.replace(/\*\*(.*?)\*\*/g, '$1');

              // Also remove any single asterisks used for list items if they appear at start of line
              cleanResponse = cleanResponse.replace(/^\s*\*\s+/gm, '');

              // Remove HTML bold tags around "Answer:" (e.g. <b>Answer:</b> -> Answer:)
              cleanResponse = cleanResponse.replace(/<b>\s*Answer:\s*<\/b>/gi, 'Answer:');
            }

            return cleanResponse;
          })
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
          apiUsed: `${getRealApiName(model)} (${model}) - Grouped execution`,
          progressData: null,
          usageTokens: totalUsageTokens
        };
      }

      // For other modes or single question: use original sequential logic
      let questionText: string;
      let markingScheme: string;
      let totalMarks: number | undefined;
      let questionCount: number | undefined;

      // Deduplicate questions by number to prevent repetition (e.g. same question from multiple pages)
      const uniqueQuestionsMap = new Map();
      sortedAllQuestions.forEach(q => {
        if (q.questionNumber && !uniqueQuestionsMap.has(q.questionNumber)) {
          uniqueQuestionsMap.set(q.questionNumber, q);
        }
      });
      const uniqueSortedQuestions = Array.from(uniqueQuestionsMap.values());

      questionCount = uniqueSortedQuestions.length;

      // For multiple questions, format each separately in the prompt
      if (uniqueSortedQuestions.length > 1) {
        // Aggregate all question texts with clear separation (already sorted by question number)
        questionText = uniqueSortedQuestions.map((q, index) => {
          return `Question ${q.questionNumber} (${q.marks} marks) - ${q.examBoard} ${q.examCode} (${q.examSeries}) ${q.tier}:\n${q.questionText}`;
        }).join('\n\n---\n\n');

        // Aggregate all marking schemes (matches plain text requirement)
        // Format them with question labels for clarity (already sorted by question number)
        const combinedSchemeText = uniqueSortedQuestions.map(q => {
          const schemeText = stringifyMarkingScheme(q.markingScheme);
          if (!schemeText && q.markingScheme) {
            console.warn(`[MULTI-QUESTION] Could not stringify marking scheme for Q${q.questionNumber} (type: ${typeof q.markingScheme})`);
          }
          return `Question ${q.questionNumber} (${q.marks} marks):\n${schemeText}`;
        }).join('\n\n');

        markingScheme = combinedSchemeText;

        // Sum total marks across all questions
        totalMarks = uniqueSortedQuestions.reduce((sum, q) => sum + (q.marks || 0), 0);


      } else {
        // Single question (use sorted array for consistency)
        const q = uniqueSortedQuestions[0];
        questionText = q.questionText;
        // markingScheme must be plain text (same format as sent to AI for marking instruction)
        // DEBUG: Inspect raw marking scheme data
        if (process.env.LOG_MARKING_SCHEME_EXPLAIN === 'true') {
          console.log(`[DEBUG_FOLLOWUP] Raw marking scheme input for Q${q.questionNumber}:`, JSON.stringify(q.markingScheme, null, 2));
        }

        markingScheme = stringifyMarkingScheme(q.markingScheme);
        if (!markingScheme && q.markingScheme) {
          console.warn(`[SINGLE QUESTION] Could not stringify marking scheme for Q${q.questionNumber}`);
        }
        totalMarks = q.marks;
      }

      const systemPrompt = getPrompt(`${config.promptKey}.system`);
      // For model answer mode, pass question number; for other modes (e.g., similar questions), pass questionCount
      const singleQuestionNumber = mode === 'modelanswer' && uniqueSortedQuestions.length === 1
        ? String(uniqueSortedQuestions[0].questionNumber || '')
        : undefined;
      const userPrompt = getPrompt(`${config.promptKey}.user`,
        questionText,
        markingScheme,
        mode === 'modelanswer' ? totalMarks : questionCount,  // For model answer: pass totalMarks, for similar questions: pass questionCount
        mode === 'modelanswer' ? singleQuestionNumber : undefined  // For model answer: pass question number
      );

      // --- DEBUG LOGGING: Print Prompt ---
      if (mode === 'markingscheme' && process.env.LOG_MARKING_SCHEME_EXPLAIN === 'true') {
        console.log(`\n🔍 [DEBUG] MARKING SCHEME EXPLAIN PROMPT:`);
        console.log(`--- SYSTEM ---\n${systemPrompt}\n`);
        console.log(`--- USER ---\n${userPrompt}\n`);
      }

      // Use ModelProvider directly with custom prompts
      const { ModelProvider } = await import('../../utils/ModelProvider.js');

      // Determine appropriate phase for tracking
      const phase = mode === 'modelanswer' ? 'modelAnswer' :
        mode === 'markingscheme' ? 'markingScheme' : 'other';

      const aiResult = await ModelProvider.callText(systemPrompt, userPrompt, model as any, false, tracker, phase as any);

      // --- DEBUG LOGGING: Print Response ---
      if (mode === 'markingscheme' && process.env.LOG_MARKING_SCHEME_EXPLAIN === 'true') {
        console.log(`\n✅ [DEBUG] MARKING SCHEME EXPLAIN RESPONSE:`);
        console.log(`${aiResult.content}\n`);
      }

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
        progressData: null, // Will be set by the calling method
        usageTokens: contextualResult.usageTokens
      };
    } else {
      // No exam papers found - fallback to empty
      const systemPrompt = getPrompt(`${config.promptKey}.system`);
      const userPrompt = getPrompt(`${config.promptKey}.user`, '', '', undefined);

      const { ModelProvider } = await import('../../utils/ModelProvider.js');

      // Determine appropriate phase for tracking
      const phase = mode === 'modelanswer' ? 'modelAnswer' :
        mode === 'markingscheme' ? 'markingScheme' : 'other';

      const aiResult = await ModelProvider.callText(systemPrompt, userPrompt, model as any, false, tracker, phase as any);

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
        progressData: null,
        usageTokens: aiResult.usageTokens || 0
      };
    }
  }

}
