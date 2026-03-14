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

        const currentPromptKey = isModelAnswer ? `${config.promptKey}Html` : config.promptKey;
        const userPrompt = getPrompt(`${currentPromptKey}.user`, qText, this.stringifyMarkingScheme(qScheme), qMarks, base);

        // [FEATURE] Restore Debug Logging from environment variables
        const isLoggingEnabled = (isModelAnswer && process.env.LOG_SUGGESTED_MODEL_ANSWER === 'true') ||
                               (!isModelAnswer && mode === 'marking-scheme' && process.env.LOG_MARKING_SCHEME_EXPLAIN === 'true');

        if (isLoggingEnabled) {
          console.log(`\n🔍 [DEBUG] ${mode.toUpperCase()} PROMPT (Question ${base}):`);
          console.log(`--- SYSTEM ---\n${systemPrompt}\n`);
          console.log(`--- USER ---\n${userPrompt}\n`);
        }

      try {
        const ai = await ModelProvider.callText(systemPrompt, userPrompt, model as any, false, tracker, isModelAnswer ? 'modelAnswer' : 'markingScheme');
        let content = ai.content.replace(/^```(markdown|html)?\s*/i, '').replace(/\s*```$/i, '').trim();

        // [TWO-PROMPT BRIDGE] Interceptor Logic for Model Answers
        if (isModelAnswer) {
          if (isLoggingEnabled) {
            console.log("\n==================================================");
            console.log(`[DEBUG] Step 1: Sending question to Prompt 1 (HTML Formatter)...`);
            console.log(`[DEBUG] Step 1 Complete. Raw HTML Output from AI:`);
            console.log("--------------------------------------------------");
            console.log(content);
            console.log("--------------------------------------------------");
          }

          const diagramRegex = /\[(?:Type:\s*Diagram|Diagram):\s*(.*?)\]/gi;
          let match;
          let diagramCount = 0;

          // Sequential extraction for each detected diagram
          while (true) {
            const currentMatch = diagramRegex.exec(content);
            if (!currentMatch) break;

            diagramCount++;
            const fullMatchText = currentMatch[0];
            const hintDescription = currentMatch[1];
            
            if (isLoggingEnabled) {
              console.log(`\n[DEBUG] Step 2: Found Diagram Hint #${diagramCount}:`);
              console.log(`[DEBUG] Hint Text: "${hintDescription}"`);

              // Call Prompt 2 (JSON Extractor) with just the hint
              console.log(`[DEBUG] Step 3: Sending hint to Prompt 2 (JSON Extractor)...`);
            }
            const diagramSystemPrompt = getPrompt('diagramExtractor.system');
            const diagramUserPrompt = getPrompt('diagramExtractor.user', hintDescription);

            try {
              const diagramAi = await ModelProvider.callText(diagramSystemPrompt, diagramUserPrompt, model as any, false, tracker, 'modelAnswer');
              const jsonOutput = diagramAi.content.replace(/^```(json)?\s*/i, '').replace(/\s*```$/i, '').trim();
              
              if (isLoggingEnabled) {
                console.log(`[DEBUG] Step 3 Complete. Raw JSON Output from AI:`);
                console.log(jsonOutput);
              }

              // Verify the JSON is actually valid before injecting it
              try {
                JSON.parse(jsonOutput);
                if (isLoggingEnabled) console.log(`[DEBUG] JSON Validation: SUCCESS!`);
              } catch (parseError) {
                if (isLoggingEnabled) {
                  console.error(`[DEBUG] JSON Validation: FAILED! The AI generated invalid JSON.`);
                  console.error(`[DEBUG] Error Details:`, (parseError as any).message);
                }
              }

              const scriptTag = `<script type="application/json" class="ai-diagram-data">\n${jsonOutput}\n</script>`;
              
              // Replace the hint with the JSON script tag
              content = content.replace(fullMatchText, scriptTag);
              if (isLoggingEnabled) console.log(`[DEBUG] Step 4: Successfully replaced hint with <script> tag in HTML.`);
              
              // Reset regex index because content length changed
              diagramRegex.lastIndex = 0; 
            } catch (err) {
              console.error(`[PROMPT-BRIDGE] Error extracting diagram for Q${base}:`, err);
              content = content.replace(fullMatchText, `<!-- Diagram Extraction Error: ${hintDescription} -->`);
              diagramRegex.lastIndex = 0;
            }
          }

          if (diagramCount === 0) {
            if (isLoggingEnabled) console.log(`\n[DEBUG] No diagram hints were found in the HTML.`);
          }

          if (isLoggingEnabled) {
            console.log("\n[DEBUG] FINAL HTML READY FOR FRONTEND:");
            console.log(content);
            console.log("==================================================\n");
          }
        }

        if (isLoggingEnabled) {
          console.log(`✅ [DEBUG] ${mode.toUpperCase()} RESPONSE (Group ${base}):`);
          console.log(`${content}\n`);
        }

        // [FIX] Global Regex and Strict Filtering
        // Strip only headers that duplicate the question number we inject ourselves
        content = content.replace(/<div class="model-question-number">.*?<\/div>/sig, '').trim();
        // [FIX] Strip any AI-generated div (with or without class) whose sole content is "Question N" or just "N"
        // This catches: <div class="sub-question-title">Question 16</div>
        // And:          <div>Question 22</div>  (bare div with no class — AI hallucination)
        content = content.replace(/<div[^>]*>\s*(?:Question\s+)?\d+[a-z]*\s*<\/div>/sig, '').trim();

        // [FIX] Bible Compliance: Use marking-code class instead of inline styles
        const mark_str = `[${qMarks} mark${qMarks > 1 ? 's' : ''}]`;
        const header = `<div class="model-question-number">Question ${base} <span class="question-max-mark">${mark_str}</span></div>`;

        // [FIX] Layout Duplication: Prepend aggregated question text ONLY if the AI hasn't already provided it 
        // Interleaved layout: AI provides sub-questions and answers mixed.
        // We prepend the verified parent text (parentText) if it exists.

        // [SAFETY FIX] Ensure model_question tag exists. If not, prepend verified qText.
        let finalContent = content;
        if (isModelAnswer && !content.includes('class="model_question"')) {
          if (isLoggingEnabled) console.log(`[FOLLOW-UP] Q${base}: Prepending verified question text (Safe Fallback)`);
          const safeText = qText || parentText || "";
          finalContent = `<span class="model_question">${safeText}</span>\n${content}`;
        }

        const isGuest = detectedQuestion?.isGuest === true;
        const qIndex = questions.indexOf(q);
        const blurClass = (isGuest && qIndex >= 4) ? ' paywall-blur' : '';

        const html = `
<div class="model-answer-block${blurClass}">
    ${header}
    <div class="model-question-content">
        ${finalContent}
    </div>
</div>`.trim();

        // [FIX] Force model_table class on all tables
        const finalHtmlWithTableClass = html.replace(/<table(?:\s+[^>]*)?>/gi, '<table class="model_table">');

        return { html: finalHtmlWithTableClass, tokens: ai.usageTokens || 0 };
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
