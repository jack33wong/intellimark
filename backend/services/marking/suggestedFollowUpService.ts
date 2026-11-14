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
        msg.role === 'assistant' &&
        (msg.detectedQuestion?.found || (Array.isArray(msg.detectedQuestion?.questions) && msg.detectedQuestion.questions.length > 0))
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
   * Builds the TMUA-style exam metadata pill bar HTML for follow-up responses
   */
  private static buildExamMetaPills(detectedQuestion: any): string {
    const firstEp = detectedQuestion?.examPapers?.[0];

    // Check if it is a real past paper (not a generic fallback or custom upload)
    const board = String(firstEp?.examBoard || '').trim();
    const isCustomOrUnknown = !board || board.toLowerCase() === 'custom' || board.toLowerCase() === 'unknown';
    const isGeneric = firstEp?.isGeneric === true || firstEp?.examCode === 'Generic Question';
    const isNotFound = detectedQuestion?.found === false;

    // For custom mark scheme, non past paper: show "Custom" on the badge, only 1 badge
    if (isCustomOrUnknown || isGeneric || isNotFound || !firstEp) {
      return `<div class="tmua-exam-pills"><span class="tmua-pill">Custom</span></div>\n\n`;
    }

    const pills: string[] = [];

    // 1. Exam Board
    if (firstEp.examBoard && firstEp.examBoard !== 'Unknown') {
      pills.push(`<span class="tmua-pill">${firstEp.examBoard}</span>`);
    }

    // 2. Subject
    if (firstEp.subject && firstEp.subject !== 'General') {
      pills.push(`<span class="tmua-pill">${firstEp.subject}</span>`);
    }

    // 3. Exam Code
    if (firstEp.examCode && firstEp.examCode !== 'N/A') {
      pills.push(`<span class="tmua-pill strong">${firstEp.examCode}</span>`);
    }

    // 4. Exam Series
    const series = firstEp.examSeries || (firstEp as any).year;
    if (series) {
      pills.push(`<span class="tmua-pill">${series}</span>`);
    }

    // 5. Tier: Omit if n.a, empty, none, unknown, or untiered
    if (firstEp.tier) {
      const normTier = String(firstEp.tier).trim().toLowerCase();
      const isOmittedTier = !normTier || ['n/a', 'na', 'n.a', 'n.a.', 'none', 'unknown', 'untiered'].includes(normTier);
      if (!isOmittedTier) {
        pills.push(`<span class="tmua-pill">${firstEp.tier}</span>`);
      }
    }

    // Fallback: If no past paper pills were generated, show 1 Custom badge
    if (pills.length === 0) {
      return `<div class="tmua-exam-pills"><span class="tmua-pill">Custom</span></div>\n\n`;
    }

    // 6. Modified indicator pill (when past paper has modified questions)
    if (detectedQuestion?.isModifiedPaper) {
      pills.push(`<span class="tmua-pill modified">Modified</span>`);
    }

    return `<div class="tmua-exam-pills">${pills.join('')}</div>\n\n`;
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
    const isSimilarQuestions = mode === 'similarquestions';

    const detectedQuestion = targetMessage.detectedQuestion;
    const hasExamPapers = Array.isArray(detectedQuestion?.examPapers) &&
      detectedQuestion.examPapers.some((ep: any) => Array.isArray(ep.questions) && ep.questions.length > 0);
    const hasRootQuestions = Array.isArray(detectedQuestion?.questions) && detectedQuestion.questions.length > 0;

    if (!hasExamPapers && !hasRootQuestions) {
      progressTracker.finish();
      return { response: "(No paper data available)", apiUsed: model, progressData: null, usageTokens: 0 };
    }

    const firstEp = hasExamPapers ? detectedQuestion.examPapers[0] : undefined;
    const subjectProfile = resolveSubjectProfile({
      subject: firstEp?.subject,
      paperCode: firstEp?.examCode,
      paperTitle: firstEp?.paperTitle
    });
    const isEnglishLoR = subjectProfile.paradigm === 'LEVEL_OF_RESPONSE';

    const currentPromptKey = isModelAnswer ? `${config.promptKey}Html` : config.promptKey;
    let systemPrompt: string;
    if (isSimilarQuestions) {
      systemPrompt = getPrompt('similarquestions.system');
    } else if (isEnglishLoR) {
      systemPrompt = isModelAnswer ? getPrompt('englishModelAnswerHtml.system') : getPrompt('englishMarkingScheme.system');
    } else {
      systemPrompt = getPrompt(`${currentPromptKey}.system`);
    }

    // 2. Process Questions directly (Handle examPapers, root questions fallback when examPapers is empty, and partial matches)
    const examPaperQuestions = hasExamPapers
      ? detectedQuestion.examPapers.flatMap((ep: any) => ep.questions || [])
      : [];
    const unmatchedRootQuestions = hasRootQuestions
      ? (detectedQuestion.questions || []).filter((rq: any) => {
          const rqNum = String(rq.questionNumber || rq.number || '').trim().toLowerCase();
          const inExamPapers = examPaperQuestions.some((epq: any) => {
            const epqNum = String(epq.questionNumber || epq.number || '').trim().toLowerCase();
            return (rqNum && epqNum === rqNum) ||
              (rq.extractedQuestionText && epq.extractedQuestionText && rq.extractedQuestionText === epq.extractedQuestionText);
          });
          return !inExamPapers && (rq.detection?.found === false || !rq.databaseQuestionText);
        })
      : [];

    const effectiveExamPapers = hasExamPapers
      ? [
          ...detectedQuestion.examPapers,
          ...(unmatchedRootQuestions.length > 0
            ? [{ questions: unmatchedRootQuestions, examBoard: 'Custom', examCode: 'N/A' }]
            : [])
        ]
      : [{ questions: detectedQuestion.questions || [], examBoard: 'Custom', examCode: 'N/A' }];

    let questions = effectiveExamPapers.flatMap((ep: any) =>
      (ep.questions || []).map((q: any) => {
        const base = String(q.questionNumber || q.number || 'unknown');

        // Look up question result from targetMessage to get authoritative totalMarks (not the student's awarded score)
        const matchedQr = targetMessage?.questionResponses?.find(
          (qr: any) => String(qr.questionNumber || '').toLowerCase() === base.toLowerCase()
        );
        const matchedContextQr = targetMessage?.markingContext?.allQuestionResults?.find(
          (qr: any) => String(qr.questionNumber || '').toLowerCase() === base.toLowerCase()
        );

        const authoritativeTotalMarks =
          matchedQr?.score?.totalMarks ||
          matchedContextQr?.score?.totalMarks ||
          matchedContextQr?.totalMarks ||
          q.totalMarks ||
          q.score?.totalMarks ||
          q.marks ||
          0;

        return {
          ...q,
          base,
          marks: authoritativeTotalMarks,
          totalMarks: authoritativeTotalMarks,
          examBoard: ep.examBoard || 'Custom',
          examCode: ep.examCode || 'N/A'
        };
      })
    );

    // If contextQuestionId is provided, filter the questions array to ONLY include that question!
    if (contextQuestionId) {
      questions = questions.filter((q: any) => String(q.base).toLowerCase() === String(contextQuestionId).toLowerCase());
      
      // Fallback: If contextQuestionId didn't match any questions, proceed with all of them, or handle error?
      // It's safer to proceed with what we have if the filter returns empty
      if (questions.length === 0) {
         console.warn(`[FOLLOW-UP] contextQuestionId '${contextQuestionId}' did not match any questions. Proceeding with all questions.`);
         questions = effectiveExamPapers.flatMap((ep: any) =>
          (ep.questions || []).map((q: any) => ({
            ...q,
            base: String(q.questionNumber || q.number || 'unknown'),
            examBoard: ep.examBoard || 'Custom',
            examCode: ep.examCode || 'N/A'
          }))
        );
      }
    }

    // [FEATURE] Restore Debug Logging from environment variables
    const logUserPrompt = process.env.LOG_AI_MARKING_USER_PROMPT === 'true';
    const logSystemPrompt = process.env.LOG_AI_MARKING_SYSTEM_PROMPT === 'true';
    const logResponse = process.env.LOG_AI_MARKING_RESPONSE === 'true';
    const isLoggingEnabled = (isModelAnswer && process.env.LOG_SUGGESTED_MODEL_ANSWER === 'true') ||
                           (!isModelAnswer && mode === 'marking-scheme' && process.env.LOG_MARKING_SCHEME_EXPLAIN === 'true') ||
                           logUserPrompt ||
                           logSystemPrompt;

    // Helper to build user prompt for a single question
    const buildSingleQuestionUserPrompt = (q: any): string => {
      const {
        base,
        questionText: qText,
        markingScheme: qScheme,
        marks: qMarks,
        sourceExtracts: qExtracts,
        examinerReport: qReport
      } = q;

      const extractText = typeof qExtracts === 'string'
        ? qExtracts
        : (Array.isArray(qExtracts) ? qExtracts.join('\n\n') : (firstEp?.sourceExtracts || ''));
      const reportText = typeof qReport === 'string'
        ? qReport
        : (qReport && typeof qReport === 'object' ? MarkingPromptService.formatExaminerReport(qReport) : (firstEp?.examinerReport || ''));

      if (isSimilarQuestions) {
        return getPrompt('similarquestions.user', qText, this.stringifyMarkingScheme(qScheme), 3, base, qMarks);
      }
      if (isEnglishLoR) {
        const promptKey = isModelAnswer ? 'englishModelAnswerHtml' : 'englishMarkingScheme';
        return getPrompt(
          `${promptKey}.user`,
          qText,
          this.stringifyMarkingScheme(qScheme),
          qMarks,
          base,
          extractText,
          reportText
        );
      }
      const currentPromptKey = isModelAnswer ? `${config.promptKey}Html` : config.promptKey;
      return getPrompt(`${currentPromptKey}.user`, qText, this.stringifyMarkingScheme(qScheme), qMarks, base);
    };

    // Helper to wrap raw AI HTML for a single question into a .model-answer-block card
    const formatQuestionCard = (q: any, rawContent: string, qIndex: number): string => {
      const { base, questionText: qText, marks: qMarks, originalText: parentText } = q;
      let content = rawContent.replace(/^```(markdown|html)?\s*/i, '').replace(/\s*```$/i, '').trim();

      // Strip headers that duplicate the question number we inject ourselves
      content = content.replace(/<div class="model-question-number">.*?<\/div>/sig, '').trim();
      content = content.replace(/<div[^>]*>\s*(?:Question\s+)?\d+[a-z]*\s*<\/div>/sig, '').trim();

      const escapedBase = String(base).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const redundantPrefixRegex = new RegExp(`(<span class=["']model_question["']>\\s*)${escapedBase}\\s*[.)]\\s+`, 'i');
      content = content.replace(redundantPrefixRegex, '$1');

      const mark_str = `[${qMarks} mark${qMarks > 1 ? 's' : ''}]`;
      const headerTitle = isSimilarQuestions
        ? `Similar Practice Questions (Question ${base})`
        : `Question ${base}`;
      const header = `<div class="model-question-number${isSimilarQuestions ? ' practice-question-number' : ''}">${headerTitle} <span class="question-max-mark">${mark_str}</span></div>`;

      let finalContent = content;
      if (isModelAnswer && !content.includes('class="model_question"')) {
        if (isLoggingEnabled) console.log(`[FOLLOW-UP] Q${base}: Prepending verified question text (Safe Fallback)`);
        const safeText = qText || parentText || "";
        finalContent = `<span class="model_question">${safeText}</span>\n${content}`;
      }

      const isGuest = detectedQuestion?.isGuest === true;
      const blurClass = (isGuest && qIndex >= 4) ? ' paywall-blur' : '';
      const blockClass = isSimilarQuestions ? 'model-answer-block practice-question-block' : 'model-answer-block';

      const html = `
<div class="${blockClass}${blurClass}">
    ${header}
    <div class="model-question-content">
        ${finalContent}
    </div>
</div>`.trim();

      return html.replace(/<table(?:\s+[^>]*)?>/gi, '<table class="model_table">');
    };

    // 3. Batched Parallel Execution (Groups of 5 questions for multi-question Maths Model Answers & Marking Schemes)
    const isBatchableMode = (isModelAnswer || mode === 'marking-scheme') && !isEnglishLoR && questions.length > 1;
    const BATCH_SIZE = isBatchableMode ? 5 : 1;
    const questionBatches: any[][] = [];
    for (let i = 0; i < questions.length; i += BATCH_SIZE) {
      questionBatches.push(questions.slice(i, i + BATCH_SIZE));
    }

    const rawAnswersByBase = new Map<string, string>();
    let totalTokens = 0;

    await Promise.all(questionBatches.map(async (batch) => {
      if (batch.length === 1) {
        const q = batch[0];
        const userPrompt = buildSingleQuestionUserPrompt(q);
        if (isLoggingEnabled) {
          console.log(`\n🔍 [DEBUG] ${mode.toUpperCase()} PROMPT (Question ${q.base}):`);
          if (logSystemPrompt || !logUserPrompt) {
            console.log(`--- SYSTEM ---\n${systemPrompt}\n`);
          } else {
            console.log(`--- SYSTEM ---\n[REDACTED] (Set LOG_AI_MARKING_SYSTEM_PROMPT=true to enable)\n`);
          }
          console.log(`--- USER ---\n${userPrompt}\n`);
        }
        try {
          const followUpPhase = isModelAnswer ? 'modelAnswer' : (isSimilarQuestions ? 'similarquestions' : 'markingScheme');
          const ai = await ModelProvider.callText(systemPrompt, userPrompt, model as any, false, tracker, followUpPhase as any);
          if (logResponse) {
            console.log(`\n[LOG-DEBUG] Raw AI ${mode.toUpperCase()} Response (Q${q.base}):\n${ai.content}\n`);
          }
          totalTokens += ai.usageTokens || 0;
          rawAnswersByBase.set(String(q.base), ai.content);
        } catch (err) {
          console.error(`[FOLLOW-UP] Error Q${q.base}:`, err);
          rawAnswersByBase.set(String(q.base), `<div class="error">Error generating ${mode} for Q${q.base}</div>`);
        }
        return;
      }

      // Multi-question batch prompt (5 questions in 1 LLM call)
      const taskLabel = isModelAnswer ? 'model answers' : 'marking scheme explanations';
      const batchUserPrompt = `You are generating ${taskLabel} for a batch of ${batch.length} questions (${batch.map(q => `Question ${q.base}`).join(', ')}).\n` +
        `CRITICAL BATCH RULE: Output the response for each question preceded by the exact delimiter line:\n` +
        `=== QUESTION_START: <NUMBER> ===\n` +
        `Do NOT skip any question in the batch.\n\n` +
        batch.map(q => `=== QUESTION_START: ${q.base} ===\n${buildSingleQuestionUserPrompt(q)}`).join('\n\n');

      if (isLoggingEnabled) {
        console.log(`\n🔍 [DEBUG] ${mode.toUpperCase()} BATCH PROMPT (Questions ${batch.map(q => q.base).join(', ')}):`);
        console.log(`--- USER ---\n${batchUserPrompt}\n`);
      }

      try {
        const ai = await ModelProvider.callText(systemPrompt, batchUserPrompt, model as any, false, tracker, isModelAnswer ? 'modelAnswer' : 'markingScheme');
        if (logResponse) {
          console.log(`\n[LOG-DEBUG] Raw AI ${mode.toUpperCase()} BATCH Response:\n${ai.content}\n`);
        }
        totalTokens += ai.usageTokens || 0;
        const batchOutput = ai.content.replace(/^```(markdown|html)?\s*/i, '').replace(/\s*```$/i, '').trim();

        const delimiterRegex = /===\s*QUESTION_START:\s*(?:Question\s*)?([0-9a-zA-Z]+)\s*===/gi;
        const splitMatches = Array.from(batchOutput.matchAll(delimiterRegex));

        for (let i = 0; i < splitMatches.length; i++) {
          const qNum = String(splitMatches[i][1]).trim();
          const startIdx = (splitMatches[i].index || 0) + splitMatches[i][0].length;
          const endIdx = i + 1 < splitMatches.length ? (splitMatches[i + 1].index || batchOutput.length) : batchOutput.length;
          const segment = batchOutput.slice(startIdx, endIdx).trim();
          if (segment) {
            rawAnswersByBase.set(qNum, segment);
          }
        }
      } catch (batchErr) {
        console.warn(`[FOLLOW-UP] Batch error for Questions ${batch.map(q => q.base).join(', ')}, falling back to single calls:`, batchErr);
      }

      // Safety Fallback: Any question in the batch not populated is fetched individually
      const missingQuestions = batch.filter(q => !rawAnswersByBase.has(String(q.base)));
      if (missingQuestions.length > 0) {
        await Promise.all(missingQuestions.map(async (q) => {
          try {
            const singlePrompt = buildSingleQuestionUserPrompt(q);
            const followUpPhase = isModelAnswer ? 'modelAnswer' : (isSimilarQuestions ? 'similarquestions' : 'markingScheme');
            const ai = await ModelProvider.callText(systemPrompt, singlePrompt, model as any, false, tracker, followUpPhase as any);
            totalTokens += ai.usageTokens || 0;
            rawAnswersByBase.set(String(q.base), ai.content);
          } catch (err) {
            console.error(`[FOLLOW-UP] Fallback Error Q${q.base}:`, err);
            rawAnswersByBase.set(String(q.base), `<div class="error">Error generating ${mode} for Q${q.base}</div>`);
          }
        }));
      }
    }));

    // Assemble ordered question cards
    let combinedResponse = questions.map((q, idx) => {
      const raw = rawAnswersByBase.get(String(q.base)) || `<div class="error">Error generating ${mode} for Q${q.base}</div>`;
      return formatQuestionCard(q, raw, idx);
    }).join('\n\n');

    // [TWO-PROMPT BRIDGE] Single Batched Interceptor Pass for all Diagram Hints across the paper
    if (isModelAnswer && !isEnglishLoR) {
      const { DiagramBridgeService } = await import('../diagram/DiagramBridgeService.js');
      combinedResponse = await DiagramBridgeService.processDiagramHints(combinedResponse, model, tracker, 'MODEL-ANSWER-BATCH');
    }

    // Prepend exam metadata pills header for model answers and marking scheme explanations
    if (isModelAnswer || mode === 'marking-scheme') {
      const pillsHeader = this.buildExamMetaPills(detectedQuestion);
      combinedResponse = pillsHeader + combinedResponse;
    }

    // 4. Cleanup and Return
    progressTracker.completeCurrentStep();
    progressTracker.finish();

    const getRealApiName = (m: string) => m.includes('gemini') ? 'Google Gemini API' : m.includes('gpt') ? 'OpenAI API' : 'AI API';

    return {
      response: combinedResponse,
      apiUsed: `${getRealApiName(model)} (${model})`,
      progressData: null,
      usageTokens: totalTokens
    };
  }
}
