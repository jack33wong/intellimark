/**
 * Suggested Follow-up Service - Handles all suggested follow-up actions
 * Centralizes common logic for model answer, marking scheme, step-by-step, etc.
 */

import { FirestoreService } from '../firestoreService.js';
import { MarkingServiceLocator } from './MarkingServiceLocator.js';
import { MarkingPromptService } from './MarkingPromptService.js';
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
        // [FIX] Try to recover from session-level metadata if message-level is missing
        const session = await FirestoreService.getUnifiedSession(sessionId);
        if (session?.detectedQuestion?.found || (session?.detectedQuestion?.questions && session.detectedQuestion.questions.length > 0)) {
          console.log(`[FOLLOW-UP] Recovered metadata from session level for ${sessionId}`);
          targetMessage = { detectedQuestion: session.detectedQuestion };
        } else {
          throw new Error(`No detected question found for ${mode}`);
        }
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
   * Helper to stringify marking scheme (handles text, array, and object formats)
   * Public for testing purposes.
   */
  public static stringifyMarkingScheme(scheme: any): string {
    if (!scheme) return '';
    if (typeof scheme === 'string') return scheme;

    // Handle Object Wrapper (Sanitized Scheme) - extract the marks array
    let marksArray = scheme;
    if (!Array.isArray(scheme) && scheme.marks && Array.isArray(scheme.marks)) {
      marksArray = scheme.marks;
    }

    // Case 1: Standard Array (or extracted array)
    if (Array.isArray(marksArray)) {
      return marksArray.map((s: any) => {
        let comment = s.comments ? `(${s.comments})` : '';
        // Remove "Auto-balanced" from prompt - it doesn't help the AI write model answers
        if (s.comments === 'Auto-balanced' || s.comments === '(Auto-balanced)') {
          comment = '';
        }
        return `- ${s.mark || 'Mark'}: ${s.answer} ${comment}`;
      }).join('\n');
    }

    // Fallback: JSON stringify for unknown object structures to ensure data is passed to AI
    return JSON.stringify(scheme, null, 2);
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
    // 1. Setup
    progressTracker.startStep('ai_thinking');
    progressTracker.completeCurrentStep();
    progressTracker.startStep('generating_response');

    const config = getSuggestedFollowUpConfig(mode);
    if (!config) throw new Error(`No configuration found for mode: ${mode}`);

    const { getPrompt } = await import('../../config/prompts.js');
    const { ModelProvider } = await import('../../utils/ModelProvider.js');
    const isModelAnswer = mode === 'model-answer';
    const systemPrompt = getPrompt(`${config.promptKey}.system`);

    const detectedQuestion = targetMessage.detectedQuestion;
    if (!detectedQuestion?.examPapers || !Array.isArray(detectedQuestion.examPapers)) {
      progressTracker.finish();
      return { response: "(No paper data available)", apiUsed: model, progressData: null, usageTokens: 0 };
    }

    // 2. Process Questions directly (Handle both examPapers and root questions)
    const questions = (detectedQuestion.examPapers || [{ questions: detectedQuestion.questions || [] }]).flatMap((ep: any) =>
      (ep.questions || []).map((q: any) => ({
        ...q,
        base: String(q.questionNumber || q.number || 'unknown'),
        examBoard: ep.examBoard || 'Custom',
        examCode: ep.examCode || 'N/A'
      }))
    );

    // 3. Parallel Execution
    const results = await Promise.all(questions.map(async (q) => {
      const { base, questionText: qText, markingScheme: qScheme, marks: qMarks, originalText: parentText } = q;

      const userPrompt = isModelAnswer
        ? getPrompt(`${config.promptKey}.user`, qText, this.stringifyMarkingScheme(qScheme), qMarks, base)
        : getPrompt(`${config.promptKey}.user`, qText, this.stringifyMarkingScheme(qScheme), base, qMarks);

      // [FEATURE] Restore Debug Logging
      const isLoggingEnabled = (isModelAnswer && process.env.LOG_SUGGESTED_MODEL_ANSWER === 'true') ||
        (!isModelAnswer && process.env.LOG_MARKING_SCHEME_EXPLAIN === 'true');

      if (isLoggingEnabled) {
        console.log(`\n🔍 [DEBUG] ${mode.toUpperCase()} PROMPT (Question ${base}):`);
        console.log(`--- SYSTEM ---\n${systemPrompt}\n`);
        console.log(`--- USER ---\n${userPrompt}\n`);
      }

      try {
        const ai = await ModelProvider.callText(systemPrompt, userPrompt, model as any, false, tracker, isModelAnswer ? 'modelAnswer' : 'markingScheme');
        let content = ai.content.replace(/^```(markdown|html)?\s*/i, '').replace(/\s*```$/i, '').trim();

        if (isLoggingEnabled) {
          console.log(`✅ [DEBUG] ${mode.toUpperCase()} RESPONSE (Group ${base}):`);
          console.log(`${content}\n`);
        }

        // [FIX] Global Regex and Strict Filtering
        // Only strip the main header, keep the interleaved sub-questions if AI generated them
        content = content.replace(/<div class="model-question-number">.*?<\/div>/sig, '').trim();

        // [FIX] Header Alignment: Align Max Marks to the right
        // [FIX] Interleaved Layout: For model answers, we trust the AI to interleave sub-questions + answers.
        // We only prepend the verified parent text if it's there.
        const header = `<div class="model-question-number">Question ${base} <span style="float:right;">[${qMarks} marks]</span></div>`;

        // [FIX] Layout Duplication: Prepend aggregated question text ONLY if the AI hasn't already provided it 
        // Interleaved layout: AI provides sub-questions and answers mixed.
        // We prepend the verified parent text (parentText) if it exists.

        // [SAFETY FIX] Ensure model_question tag exists. If not, prepend verified qText.
        let finalContent = content;
        if (isModelAnswer && !content.includes('class="model_question"')) {
          console.log(`[FOLLOW-UP] Q${base}: Prepending verified question text (Safe Fallback)`);
          const safeText = qText || parentText || "";
          finalContent = `<span class="model_question">${safeText}</span>\n${content}`;
        }

        const html = `
<div class="model-answer-block">
    ${header}
    <div class="model-question-content">
        <div class="model-ai-answer">${finalContent}</div>
    </div>
</div>`.trim();
        return { html, tokens: ai.usageTokens || 0 };
      } catch (err) {
        console.error(`[FOLLOW-UP] Error Q${base}:`, err);
        return { html: `<div class="error">Error generating ${mode} for Q${base}</div>`, tokens: 0 };
      }
    }));

    // 4. Cleanup and Return
    progressTracker.completeCurrentStep();
    progressTracker.finish();

    const getRealApiName = (m: string) => m.includes('gemini') ? 'Google Gemini API' : m.includes('gpt') ? 'OpenAI API' : 'AI API';

    return {
      response: results.map(r => r.html).join('\n\n'),
      apiUsed: `${getRealApiName(model)} (${model})`,
      progressData: null,
      usageTokens: results.reduce((s, r) => s + r.tokens, 0)
    };
  }
}
