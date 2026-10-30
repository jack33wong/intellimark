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
  contextQuestionId?: string; // Add contextQuestionId to filter
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
    const { mode, sessionId, sourceMessageId, model, detectedQuestion, tracker, contextQuestionId } = request;

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
    const result = await this.executeFollowUpAction(mode, targetMessage, model, progressTracker, tracker, contextQuestionId);

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

    let lorOutput = '';

    // Check for Level-of-Response (LoR) fields
    if (typeof scheme === 'object') {
      const parts: string[] = [];

      // 1. Levels / Descriptors
      const levels = scheme.levels || scheme.levelDescriptors || scheme.rubric?.levels;
      if (Array.isArray(levels) && levels.length > 0) {
        parts.push('### MARK SCHEME LEVELS & DESCRIPTORS:');
        levels.forEach((lvl: any) => {
          const lNum = lvl.level || lvl.levelNumber || '';
          const lMarks = lvl.marks || lvl.markRange || '';
          const lDesc = lvl.descriptor || lvl.description || lvl.skills || '';
          parts.push(`- Level ${lNum} (${lMarks}): ${lDesc}`);
        });
      } else if (typeof levels === 'string') {
        parts.push(`### MARK SCHEME LEVELS:\n${levels}`);
      }

      // 2. Indicative Standard / Content Exemplars
      const indicative = scheme.indicativeStandard || scheme.indicativeContent || scheme.exemplars;
      if (indicative) {
        if (Array.isArray(indicative)) {
          parts.push('### INDICATIVE STANDARD & CONTENT:');
          indicative.forEach((item: any) => parts.push(`- ${typeof item === 'string' ? item : JSON.stringify(item)}`));
        } else if (typeof indicative === 'string') {
          parts.push(`### INDICATIVE STANDARD:\n${indicative}`);
        } else if (typeof indicative === 'object') {
          parts.push(`### INDICATIVE STANDARD:\n${JSON.stringify(indicative, null, 2)}`);
        }
      }

      // 3. AO Content Bullets
      const aoBullets = scheme.aoContentBullets || scheme.contentBullets;
      if (aoBullets) {
        if (Array.isArray(aoBullets)) {
          parts.push('### AO CONTENT POINTS:');
          aoBullets.forEach((item: any) => parts.push(`- ${typeof item === 'string' ? item : JSON.stringify(item)}`));
        } else if (typeof aoBullets === 'string') {
          parts.push(`### AO CONTENT POINTS:\n${aoBullets}`);
        }
      }

      // 4. General / Specific Marking Guidance
      const guidance = scheme.guidance || scheme.generalMarkingGuidance;
      if (guidance) {
        if (Array.isArray(guidance)) {
          parts.push('### MARKING GUIDANCE:');
          guidance.forEach((g: any) => parts.push(`- ${typeof g === 'string' ? g : JSON.stringify(g)}`));
        } else if (typeof guidance === 'string') {
          parts.push(`### MARKING GUIDANCE:\n${guidance}`);
        }
      }

      // 5. Examiner Report Insights if present on scheme
      const report = scheme.examinerReport;
      if (report) {
        if (typeof report === 'string') {
          parts.push(`### EXAMINER REPORT:\n${report}`);
        } else if (typeof report === 'object') {
          parts.push(`### EXAMINER REPORT:\n${JSON.stringify(report, null, 2)}`);
        }
      }

      // 6. Raw text / schemeText fallback
      if (parts.length === 0 && (scheme.rawText || scheme.schemeText || scheme.text)) {
        parts.push(scheme.rawText || scheme.schemeText || scheme.text);
      }

      lorOutput = parts.join('\n\n').trim();
    }

    // Handle Object Wrapper (Sanitized Scheme) - extract the marks array
    let marksArray = scheme;
    if (!Array.isArray(scheme) && scheme.marks && Array.isArray(scheme.marks)) {
      marksArray = scheme.marks;
    }

    let marksOutput = '';
    if (Array.isArray(marksArray)) {
      // Grouping Logic: Check if marks have sub-question identifiers
      const groups: Record<string, any[]> = {};
      const ungrouped: any[] = [];

      marksArray.forEach((m: any) => {
        // Handle various sub-question identifiers (question_part from ModelAnswerController, subQuestion from others)
        const part = m.question_part || m.subQuestion;
        if (part) {
          if (!groups[part]) groups[part] = [];
          groups[part].push(m);
        } else {
          ungrouped.push(m);
        }
      });

      const formatMark = (s: any) => {
        let comment = s.comments ? `(${s.comments})` : '';
        if (s.comments === 'Auto-balanced' || s.comments === '(Auto-balanced)') {
          comment = '';
        }
        return `- ${s.mark || 'Mark'}: ${s.answer || s.text || ''} ${comment}`.trim();
      };

      const sortedParts = Object.keys(groups).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      if (sortedParts.length > 0) {
        let output = '';
        sortedParts.forEach(part => {
          output += `[Part ${part}]\n`;
          groups[part].forEach(m => {
            output += `${formatMark(m)}\n`;
          });
          output += '\n';
        });

        if (ungrouped.length > 0) {
          output += `[General]\n`;
          ungrouped.forEach(m => {
            output += `${formatMark(m)}\n`;
          });
        }
        marksOutput = output.trim();
      } else {
        marksOutput = marksArray.map(formatMark).join('\n');
      }
    }

    if (marksOutput && lorOutput) {
      return `${marksOutput}\n\n${lorOutput}`;
    }
    if (marksOutput) return marksOutput;
    if (lorOutput) return lorOutput;

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
    tracker?: UsageTracker,
    contextQuestionId?: string
  ): Promise<SuggestedFollowUpResult> {
    // 1. Setup
    progressTracker.startStep('ai_thinking');
    progressTracker.completeCurrentStep();
    progressTracker.startStep('generating_response');

    const config = getSuggestedFollowUpConfig(mode);
    if (!config) throw new Error(`No configuration found for mode: ${mode}`);

    const { getPrompt } = await import('../../config/prompts.js');
    const { ModelProvider } = await import('../../utils/ModelProvider.js');
    const { resolveSubjectProfile } = await import('../../config/subjectProfiles.js');
    const isModelAnswer = mode === 'model-answer';

    const detectedQuestion = targetMessage.detectedQuestion;
    if (!detectedQuestion?.examPapers || !Array.isArray(detectedQuestion.examPapers)) {
      progressTracker.finish();
      return { response: "(No paper data available)", apiUsed: model, progressData: null, usageTokens: 0 };
    }

    const firstEp = detectedQuestion.examPapers[0];
    const subjectProfile = resolveSubjectProfile({
      subject: firstEp?.subject,
      paperCode: firstEp?.examCode,
      paperTitle: firstEp?.paperTitle
    });
    const isEnglishLoR = subjectProfile.paradigm === 'LEVEL_OF_RESPONSE';

    const systemPrompt = isEnglishLoR
      ? (isModelAnswer ? getPrompt('englishModelAnswerHtml.system') : getPrompt('englishMarkingScheme.system'))
      : getPrompt(`${config.promptKey}.system`);

    // 2. Process Questions directly (Handle both examPapers and root questions)
    let questions = (detectedQuestion.examPapers || [{ questions: detectedQuestion.questions || [] }]).flatMap((ep: any) =>
      (ep.questions || []).map((q: any) => ({
        ...q,
        base: String(q.questionNumber || q.number || 'unknown'),
        examBoard: ep.examBoard || 'Custom',
        examCode: ep.examCode || 'N/A'
      }))
    );

    // If contextQuestionId is provided, filter the questions array to ONLY include that question!
    if (contextQuestionId) {
      questions = questions.filter((q: any) => String(q.base).toLowerCase() === String(contextQuestionId).toLowerCase());
      
      // Fallback: If contextQuestionId didn't match any questions, proceed with all of them, or handle error?
      // It's safer to proceed with what we have if the filter returns empty
      if (questions.length === 0) {
         console.warn(`[FOLLOW-UP] contextQuestionId '${contextQuestionId}' did not match any questions. Proceeding with all questions.`);
         questions = (detectedQuestion.examPapers || [{ questions: detectedQuestion.questions || [] }]).flatMap((ep: any) =>
          (ep.questions || []).map((q: any) => ({
            ...q,
            base: String(q.questionNumber || q.number || 'unknown'),
            examBoard: ep.examBoard || 'Custom',
            examCode: ep.examCode || 'N/A'
          }))
        );
      }
    }

    // 3. Parallel Execution
    const results = await Promise.all(questions.map(async (q) => {
      const {
        base,
        questionText: qText,
        markingScheme: qScheme,
        marks: qMarks,
        originalText: parentText,
        sourceExtracts: qExtracts,
        examinerReport: qReport
      } = q;

      const extractText = typeof qExtracts === 'string'
        ? qExtracts
        : (Array.isArray(qExtracts) ? qExtracts.join('\n\n') : (firstEp?.sourceExtracts || ''));
      const reportText = typeof qReport === 'string'
        ? qReport
        : (typeof qReport === 'object' ? JSON.stringify(qReport, null, 2) : (firstEp?.examinerReport || ''));

      let userPrompt: string;
      if (isEnglishLoR) {
        const promptKey = isModelAnswer ? 'englishModelAnswerHtml' : 'englishMarkingScheme';
        userPrompt = getPrompt(
          `${promptKey}.user`,
          qText,
          this.stringifyMarkingScheme(qScheme),
          qMarks,
          base,
          extractText,
          reportText
        );
      } else {
        const currentPromptKey = isModelAnswer ? `${config.promptKey}Html` : config.promptKey;
        userPrompt = getPrompt(`${currentPromptKey}.user`, qText, this.stringifyMarkingScheme(qScheme), qMarks, base);
      }

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

        // [TWO-PROMPT BRIDGE] Interceptor Logic for Model Answers (Only for Maths)
        if (isModelAnswer && !isEnglishLoR) {
          if (isLoggingEnabled) {
            console.log("\n==================================================");
            console.log(`[DEBUG] Step 1: Sending question to Prompt 1 (HTML Formatter)...`);
            console.log(`[DEBUG] Step 1 Complete. Raw HTML Output from AI:`);
            console.log("--------------------------------------------------");
            console.log(content);
            console.log("--------------------------------------------------");
          }

          const { DiagramBridgeService } = await import('../diagram/DiagramBridgeService.js');
          content = await DiagramBridgeService.processDiagramHints(content, model, tracker, `MODEL-ANSWER-Q${base}`);

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
