import { EventEmitter } from 'events';
import { ChatContextBuilder } from '../services/marking/ChatContextBuilder.js';
import { MarkingServiceLocator } from '../services/marking/MarkingServiceLocator.js';
import { ModelProvider } from '../utils/ModelProvider.js';
import { getPrompt } from '../config/prompts.js';
import { buildContextualSystemPrompt } from '../config/prompts/contextual_system_prompt.js';
import { SUBJECT_PROFILES } from '../config/subjectProfiles.js';
import messagesRouter from '../routes/messages.js';
import { GuestUsageService } from '../services/guestUsageService.js';
import { FirestoreService } from '../services/firestoreService.js';
import { AdminAlertService } from '../services/AdminAlertService.js';
import { DiagramBridgeService } from '../services/diagram/DiagramBridgeService.js';

jest.mock('../config/firebase.js', () => ({
  getFirestore: jest.fn(() => null),
  getFirebaseAuth: jest.fn(() => null),
  getUserRole: jest.fn(async () => 'student')
}));

jest.mock('../services/creditService.js', () => ({
  checkCredits: jest.fn(async () => ({ canProceed: true, remaining: 100 })),
  deductCredits: jest.fn(async () => undefined)
}));

describe('Subject-aware follow-up chat prompts and Question Mode subject resolution', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('buildContextualSystemPrompt & getPrompt', () => {
    it('keeps [M1], [A1], [B1] for Maths and default', () => {
      const mathsPrompt = buildContextualSystemPrompt('MATHS');
      const defaultPrompt = getPrompt('marking.contextual.system');

      expect(mathsPrompt).toContain('[M1], [A1], [B1]');
      expect(mathsPrompt).not.toContain('AO5 Content & Organisation');
      expect(defaultPrompt).toBe(mathsPrompt);
    });

    it('uses English Language AO & Level-of-Response prompt for ENGLISH_LANGUAGE', () => {
      const engPrompt = getPrompt('marking.contextual.system', SUBJECT_PROFILES.ENGLISH_LANGUAGE);

      expect(engPrompt).toContain('AO1');
      expect(engPrompt).toContain('AO2');
      expect(engPrompt).toContain('AO3');
      expect(engPrompt).toContain('AO4');
      expect(engPrompt).toContain('AO5 Content & Organisation');
      expect(engPrompt).toContain('AO6 Technical Accuracy');
      expect(engPrompt).toContain('Level / Band');
      expect(engPrompt).toContain('NEVER use Maths codes like [M1], [A1], [B1]');
      expect(engPrompt).toContain('Uploaded Question Text (Extracted from Student Image)');
      expect(engPrompt).toContain('NEVER use [SHOW_WORK_Q:X] in Question Mode');
    });

    it('uses English Literature AO & Level-of-Response prompt for ENGLISH_LITERATURE', () => {
      const litPrompt = getPrompt('marking.contextual.system', SUBJECT_PROFILES.ENGLISH_LITERATURE);

      expect(litPrompt).toContain('GCSE English Literature');
      expect(litPrompt).toContain('AO1');
      expect(litPrompt).toContain('AO2');
      expect(litPrompt).toContain('AO3');
      expect(litPrompt).toContain('AO4');
      expect(litPrompt).toContain('Level / Band');
      expect(litPrompt).toContain('NEVER use Maths codes like [M1], [A1], [B1]');
    });

    it('uses subject-specific mark points for UNIVERSAL_BYOMS', () => {
      const bioPrompt = getPrompt('marking.contextual.system', {
        ...SUBJECT_PROFILES.UNIVERSAL_BYOMS,
        displayName: 'Biology'
      });

      expect(bioPrompt).toContain('AI Biology tutor');
      expect(bioPrompt).toContain('[1 mark]');
      expect(bioPrompt).not.toContain('[M1], [A1], [B1]');
    });
  });

  describe('ChatContextBuilder.buildQuestionModeContext & resolveSubjectProfile', () => {
    it('does not hardcode Mathematics when m.subject is missing on an English Language paper', async () => {
      const ctx = await ChatContextBuilder.buildQuestionModeContext({
        detectedQuestion: {
          found: true,
          examPapers: [
            {
              examBoard: 'AQA',
              examCode: '8700/1',
              examSeries: 'June 2023',
              questions: [
                {
                  questionNumber: '2',
                  questionText: 'How does the writer use language here to describe the storm?',
                  marks: 8,
                  markingScheme: ''
                }
              ]
            }
          ]
        }
      });

      expect(ctx.examInfo?.subject).toBe('GCSE English Language');
      expect(ChatContextBuilder.resolveSubjectProfile(ctx).key).toBe('ENGLISH_LANGUAGE');
      const prompt = ChatContextBuilder.formatContextAsPrompt(ctx);
      expect(prompt).toContain('** Subject **: GCSE English Language');
    });

    it('resolves ENGLISH_LITERATURE when m.subject is missing on an English Literature paper', async () => {
      const ctx = await ChatContextBuilder.buildQuestionModeContext({
        detectedQuestion: {
          found: true,
          examPapers: [
            {
              examBoard: 'AQA',
              examCode: '8702/1',
              examSeries: 'June 2023',
              questions: [
                {
                  questionNumber: '1',
                  questionText: 'Starting with this speech, explore how Shakespeare presents ambition in Macbeth.',
                  marks: 30,
                  markingScheme: ''
                }
              ]
            }
          ]
        }
      });

      expect(ctx.examInfo?.subject).toBe('GCSE English Literature');
      expect(ChatContextBuilder.resolveSubjectProfile(ctx).key).toBe('ENGLISH_LITERATURE');
    });

    it('resolves ENGLISH_LANGUAGE for found: false uploads from questionText without fabricating examInfo', async () => {
      const ctx = await ChatContextBuilder.buildQuestionModeContext({
        detectedQuestion: {
          found: false,
          examPapers: [],
          questions: [
            {
              questionNumber: '5',
              questionText: 'Write a description of a stormy sea as suggested by this picture.',
              extractedQuestionText: 'Write a description of a stormy sea as suggested by this picture.',
              marks: 40,
              markingScheme: ''
            }
          ]
        }
      });

      expect(ctx.examInfo).toBeUndefined();
      expect(ChatContextBuilder.resolveSubjectProfile(ctx).key).toBe('ENGLISH_LANGUAGE');
    });

    it('resolves ENGLISH_LANGUAGE for found: false reading comparison & retrieval questions', async () => {
      const ctx = await ChatContextBuilder.buildQuestionModeContext({
        detectedQuestion: {
          found: false,
          examPapers: [],
          questions: [
            {
              questionNumber: '4',
              questionText: 'For this question, you need to refer to the whole of Source A, together with the whole of Source B. Compare how the writers convey their different perspectives.',
              marks: 16,
              markingScheme: ''
            }
          ]
        }
      });

      expect(ChatContextBuilder.resolveSubjectProfile(ctx).key).toBe('ENGLISH_LANGUAGE');
    });

    it('resolves MATHS for found: false Maths uploads', async () => {
      const ctx = await ChatContextBuilder.buildQuestionModeContext({
        detectedQuestion: {
          found: false,
          examPapers: [],
          questions: [
            {
              questionNumber: '1',
              questionText: 'Solve 2x + 3 = 11',
              marks: 2,
              markingScheme: ''
            }
          ]
        }
      });

      expect(ChatContextBuilder.resolveSubjectProfile(ctx).key).toBe('MATHS');
    });

    it('replaces placeholder m.subject ("Unknown") with resolvedProfile.displayName', async () => {
      const ctx = await ChatContextBuilder.buildQuestionModeContext({
        detectedQuestion: {
          found: true,
          examPapers: [
            {
              examBoard: 'AQA',
              examCode: '8700/1',
              subject: 'Unknown',
              questions: [
                {
                  questionNumber: '2',
                  questionText: 'How does the writer use language here?',
                  marks: 8,
                  markingScheme: ''
                }
              ]
            }
          ]
        }
      });

      expect(ctx.examInfo?.subject).toBe('GCSE English Language');
      expect(ChatContextBuilder.resolveSubjectProfile(ctx).key).toBe('ENGLISH_LANGUAGE');
    });

    it('preserves detectedSubject on found: false uploads without fabricating examInfo', async () => {
      const ctx = await ChatContextBuilder.buildQuestionModeContext({
        detectedQuestion: {
          found: false,
          detectedSubject: 'ENGLISH_LANGUAGE',
          examPapers: [],
          questions: [
            {
              questionNumber: '5',
              questionText: 'Write a paragraph about your favourite place.',
              marks: 40,
              markingScheme: ''
            }
          ]
        }
      });

      expect(ctx.examInfo).toBeUndefined();
      expect(ctx.detectedSubject).toBe('ENGLISH_LANGUAGE');
      expect(ChatContextBuilder.resolveSubjectProfile(ctx).key).toBe('ENGLISH_LANGUAGE');
    });

    it('resolves ENGLISH_LANGUAGE for Q5 story/speech/article phrasings on found: false uploads', async () => {
      const storyCtx = await ChatContextBuilder.buildQuestionModeContext({
        detectedQuestion: {
          found: false,
          examPapers: [],
          questions: [
            {
              questionNumber: '5',
              questionText: 'Write a story. Your story must begin with a sudden knock at the door.',
              marks: 40,
              markingScheme: ''
            }
          ]
        }
      });
      const speechCtx = await ChatContextBuilder.buildQuestionModeContext({
        detectedQuestion: {
          found: false,
          examPapers: [],
          questions: [
            {
              questionNumber: '5',
              questionText: 'Write a speech in which you explain your views on social media.',
              marks: 40,
              markingScheme: ''
            }
          ]
        }
      });

      expect(ChatContextBuilder.resolveSubjectProfile(storyCtx).key).toBe('ENGLISH_LANGUAGE');
      expect(ChatContextBuilder.resolveSubjectProfile(speechCtx).key).toBe('ENGLISH_LANGUAGE');
    });

    it('resolves ENGLISH_LANGUAGE from rubricEvaluation on unmatched Marking Mode contexts', () => {
      const profile = ChatContextBuilder.resolveSubjectProfile({
        sessionType: 'Marking',
        totalQuestionsMarked: 1,
        overallScore: { awarded: 26, total: 40, percentage: 65, scoreText: '26/40' },
        questionResults: [
          {
            number: '5',
            text: 'Question 5',
            scheme: '',
            totalMarks: 40,
            earnedMarks: 26,
            hasScheme: false,
            parts: [],
            rubricEvaluation: {
              scoringType: 'DUAL_AO_LOR',
              awardedMarks: 26,
              maxMarks: 40,
              rubricStamp: '[AO5: 16/24 (L3) + AO6: 10/16 (L3) = 26/40]',
              aoBreakdown: [
                { ao: 'AO5', level: 3, levelLabel: 'Level 3 (Clear, consistent)', awardedMarks: 16, maxMarks: 24 },
                { ao: 'AO6', level: 3, levelLabel: 'Level 3 (Clear, accurate)', awardedMarks: 10, maxMarks: 16 }
              ]
            }
          }
        ]
      });

      expect(profile.key).toBe('ENGLISH_LANGUAGE');
    });
  });

  describe('MarkingServiceLocator.generateContextualResponse', () => {
    it('passes the English Language contextual system prompt when subjectProfile is ENGLISH_LANGUAGE', async () => {
      const callGeminiSpy = jest.spyOn(ModelProvider, 'callGeminiText').mockResolvedValue({
        content: 'Level 3 (Clear, Relevant) — 5/8 marks.',
        usageTokens: 50,
        inputTokens: 40,
        outputTokens: 10
      } as any);

      const res = await MarkingServiceLocator.generateContextualResponse(
        'Please mark my paragraph',
        [],
        'gemini-2.5-flash',
        'Question Mode context',
        undefined,
        'chat',
        SUBJECT_PROFILES.ENGLISH_LANGUAGE
      );

      expect(callGeminiSpy).toHaveBeenCalledTimes(1);
      const [systemPromptUsed] = callGeminiSpy.mock.calls[0];
      expect(systemPromptUsed).toContain('AO5 Content & Organisation');
      expect(systemPromptUsed).toContain('NEVER use Maths codes like [M1], [A1], [B1]');
      expect(res.response).toContain('Level 3');
    });

    it('passes the Maths contextual system prompt when subjectProfile is omitted or MATHS', async () => {
      const callGeminiSpy = jest.spyOn(ModelProvider, 'callGeminiText').mockResolvedValue({
        content: '[M1] 2x = 8, [A1] x = 4',
        usageTokens: 30,
        inputTokens: 20,
        outputTokens: 10
      } as any);

      await MarkingServiceLocator.generateContextualResponse(
        'Check my answer: x = 4',
        [],
        'gemini-2.5-flash',
        'Question Mode context'
      );

      expect(callGeminiSpy).toHaveBeenCalledTimes(1);
      const [systemPromptUsed] = callGeminiSpy.mock.calls[0];
      expect(systemPromptUsed).toContain('[M1], [A1], [B1]');
    });
  });

  describe('POST /api/messages/chat route integration', () => {
    const invokeChatRoute = async (body: Record<string, any>, authUser?: { uid: string; email?: string }) => {
      const layer = (messagesRouter as any).stack.find(
        (l: any) => l.route?.path === '/chat' && l.route?.methods?.post
      );
      if (!layer) {
        throw new Error('POST /chat route not found on messagesRouter');
      }

      const req: any = Object.assign(new EventEmitter(), {
        method: 'POST',
        url: '/chat',
        path: '/chat',
        headers: {},
        ip: '127.0.0.1',
        body,
        user: authUser
      });

      let statusCode = 200;
      let jsonBody: any = undefined;
      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(payload: any) {
          jsonBody = payload;
          return this;
        }
      };

      // Run route stack (skip optionalAuth middleware at index 0 when testing with explicit req.user)
      const handlers = layer.route.stack.map((s: any) => s.handle);
      const routeHandler = handlers[handlers.length - 1];
      await routeHandler(req, res, (err: any) => {
        if (err) throw err;
      });

      return { status: statusCode, body: jsonBody };
    };

    beforeEach(() => {
      jest.spyOn(GuestUsageService, 'checkLimit').mockResolvedValue({ allowed: true, remaining: 10, limit: 10 } as any);
      jest.spyOn(GuestUsageService, 'incrementUsage').mockResolvedValue(undefined as any);
      jest.spyOn(AdminAlertService, 'markUserActive').mockImplementation(() => {});
      jest.spyOn(AdminAlertService, 'recordSessionTurn').mockImplementation(() => {});
      jest.spyOn(DiagramBridgeService, 'processDiagramHints').mockImplementation(async (text) => text);
    });

    it('uses English Language prompt for guest Question Mode found: false upload', async () => {
      const callGeminiSpy = jest.spyOn(ModelProvider, 'callGeminiText').mockResolvedValue({
        content: 'Level 3 (Clear, Relevant) — 18/24 AO5 + 11/16 AO6 = 29/40.',
        usageTokens: 60,
        inputTokens: 45,
        outputTokens: 15
      } as any);

      const markingContext = await ChatContextBuilder.buildQuestionModeContext({
        detectedQuestion: {
          found: false,
          examPapers: [],
          questions: [
            {
              questionNumber: '5',
              questionText: 'Write a story. Your story must begin with a sudden knock at the door.',
              marks: 40,
              markingScheme: ''
            }
          ]
        }
      });

      const res = await invokeChatRoute({
        message: 'Please mark my opening paragraph: The wind howled against the warped oak.',
        model: 'gemini-2.5-flash',
        contextQuestionId: '5',
        markingContext
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(callGeminiSpy).toHaveBeenCalledTimes(1);
      const [systemPromptUsed, userPromptUsed] = callGeminiSpy.mock.calls[0];
      expect(systemPromptUsed).toContain('AO5 Content & Organisation');
      expect(systemPromptUsed).toContain('NEVER use Maths codes like [M1], [A1], [B1]');
      expect(userPromptUsed).toContain('Question Mode');
    });

    it('uses Maths prompt for guest Maths Question Mode upload', async () => {
      const callGeminiSpy = jest.spyOn(ModelProvider, 'callGeminiText').mockResolvedValue({
        content: '[M1] 2x = 8, [A1] x = 4',
        usageTokens: 30,
        inputTokens: 20,
        outputTokens: 10
      } as any);

      const markingContext = await ChatContextBuilder.buildQuestionModeContext({
        detectedQuestion: {
          found: false,
          examPapers: [],
          questions: [
            {
              questionNumber: '1',
              questionText: 'Solve 2x + 3 = 11',
              marks: 2,
              markingScheme: ''
            }
          ]
        }
      });

      const res = await invokeChatRoute({
        message: 'Is x = 4 right?',
        model: 'gemini-2.5-flash',
        contextQuestionId: '1',
        markingContext
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(callGeminiSpy).toHaveBeenCalledTimes(1);
      const [systemPromptUsed] = callGeminiSpy.mock.calls[0];
      expect(systemPromptUsed).toContain('[M1], [A1], [B1]');
      expect(systemPromptUsed).not.toContain('AO5 Content & Organisation');
    });

    it('uses English Language prompt for authenticated session loaded from Firestore', async () => {
      const callGeminiSpy = jest.spyOn(ModelProvider, 'callGeminiText').mockResolvedValue({
        content: 'Level 3 (Clear, Relevant) — 5/8 marks.',
        usageTokens: 40,
        inputTokens: 30,
        outputTokens: 10
      } as any);

      const storedMarkingContext = await ChatContextBuilder.buildQuestionModeContext({
        detectedQuestion: {
          found: true,
          examPapers: [
            {
              examBoard: 'AQA',
              examCode: '8700/1',
              questions: [
                {
                  questionNumber: '2',
                  questionText: 'How does the writer use language here to describe the storm?',
                  marks: 8,
                  markingScheme: ''
                }
              ]
            }
          ]
        }
      });

      jest.spyOn(FirestoreService, 'getUnifiedSession').mockResolvedValue({
        id: 'sess-eng-auth-1',
        userId: 'user-123',
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            content: 'Uploaded Question 2',
            markingContext: storedMarkingContext
          }
        ]
      } as any);
      jest.spyOn(FirestoreService, 'addMessageToUnifiedSession').mockResolvedValue(undefined as any);

      const res = await invokeChatRoute(
        {
          message: 'Mark my paragraph on the storm metaphor.',
          model: 'gemini-2.5-flash',
          sessionId: 'sess-eng-auth-1',
          contextQuestionId: '2'
        },
        { uid: 'user-123', email: 'student@example.com' }
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(callGeminiSpy).toHaveBeenCalledTimes(1);
      const [systemPromptUsed] = callGeminiSpy.mock.calls[0];
      expect(systemPromptUsed).toContain('GCSE English Language');
      expect(systemPromptUsed).toContain('NEVER use Maths codes like [M1], [A1], [B1]');
    });
  });
});
