import { jest } from '@jest/globals';
import { SUBJECT_PROFILES, buildUniversalEnglishRubricFallback } from '../config/subjectProfiles.js';
import { getPrompt } from '../config/prompts.js';
import { MarkingSchemeOrchestrationService } from '../services/marking/MarkingSchemeOrchestrationService.js';
import { questionDetectionService } from '../services/marking/questionDetectionService.js';
import { MarkingServiceLocator } from '../services/marking/MarkingServiceLocator.js';
import { QuestionModeHandlerService } from '../services/marking/QuestionModeHandlerService.js';
import { ChatContextBuilder } from '../services/marking/ChatContextBuilder.js';
import { ModelProvider } from '../utils/ModelProvider.js';
import { SessionManagementService } from '../services/sessionManagementService.js';

describe('Question Mode & Generic Mode English Subject-Awareness Fixes (Problems A, B, C)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Problem A: MarkingSchemeOrchestrationService Generic Mode for LEVEL_OF_RESPONSE', () => {
    it('uses Universal English LoR rubric instead of 132 Maths M1/A1/B1 codes when found: false for ENGLISH_LANGUAGE', async () => {
      jest.spyOn(questionDetectionService, 'detectQuestion').mockResolvedValue({
        found: false,
        message: 'No match found'
      } as any);

      const q5Text = "'Students should spend less time on screens and more time outdoors.' Write an article for your school website in which you argue your point of view on this statement. (24 marks for content and organisation 16 marks for technical accuracy)";
      const result = await MarkingSchemeOrchestrationService.orchestrateMarkingSchemeLookup(
        [{ text: q5Text, questionNumber: '5', sourceImageIndex: 0 }],
        { questions: [{ questionNumber: '5', text: q5Text }] },
        '8700/2',
        undefined,
        true,
        SUBJECT_PROFILES.ENGLISH_LANGUAGE
      );

      expect(result.detectionResults).toHaveLength(1);
      const match = result.detectionResults[0].detectionResult.match;
      expect(result.detectionResults[0].detectionResult.found).toBe(false);
      expect(match.isGeneric).toBe(true);
      expect(match.subject).toBe('GCSE English Language');
      expect(match.detectedSubject).toBe('ENGLISH_LANGUAGE');
      expect(match.markingScheme.questionMarks.marks).toEqual([]);
      expect(match.markingScheme.generalMarkingGuidance).toContain('UNIVERSAL GCSE ENGLISH LANGUAGE WRITING RUBRIC');
      expect(match.markingScheme.generalMarkingGuidance).toContain('AO5 Content & Organisation');
      expect(match.markingScheme.generalMarkingGuidance).toContain('AO6 Technical Accuracy');
      expect(match.markingScheme.generalMarkingGuidance).not.toContain('Prioritize correct mathematics');
      expect(match.markingScheme.generalMarkingGuidance).not.toContain('Use M1, M2, M3');
    });

    it('uses Universal English Literature LoR rubric when found: false for ENGLISH_LITERATURE', async () => {
      jest.spyOn(questionDetectionService, 'detectQuestion').mockResolvedValue({
        found: false,
        message: 'No match found'
      } as any);

      const litText = 'Explore how Shakespeare presents ambition in Macbeth. [30 marks]';
      const result = await MarkingSchemeOrchestrationService.orchestrateMarkingSchemeLookup(
        [{ text: litText, questionNumber: '1', sourceImageIndex: 0 }],
        { questions: [{ questionNumber: '1', text: litText }] },
        '8702/1',
        undefined,
        true,
        SUBJECT_PROFILES.ENGLISH_LITERATURE
      );

      const match = result.detectionResults[0].detectionResult.match;
      expect(match.subject).toBe('GCSE English Literature');
      expect(match.detectedSubject).toBe('ENGLISH_LITERATURE');
      expect(match.markingScheme.questionMarks.marks).toEqual([]);
      expect(match.markingScheme.generalMarkingGuidance).toContain('UNIVERSAL GCSE ENGLISH LITERATURE LEVEL-OF-RESPONSE RUBRIC');
      expect(match.markingScheme.generalMarkingGuidance).not.toContain('Prioritize correct mathematics');
    });

    it('preserves sequential M1/A1/B1 rubric for MATHS Generic Mode (regression check)', async () => {
      jest.spyOn(questionDetectionService, 'detectQuestion').mockResolvedValue({
        found: false,
        message: 'No match found'
      } as any);

      const mathsText = 'Solve 3x + 7 = 22 [2 marks]';
      const result = await MarkingSchemeOrchestrationService.orchestrateMarkingSchemeLookup(
        [{ text: mathsText, questionNumber: '1', sourceImageIndex: 0 }],
        { questions: [{ questionNumber: '1', text: mathsText }] },
        null,
        undefined,
        false,
        SUBJECT_PROFILES.MATHS
      );

      const match = result.detectionResults[0].detectionResult.match;
      expect(match.markingScheme.questionMarks.marks.length).toBeGreaterThan(0);
      expect(match.markingScheme.questionMarks.marks.some((m: any) => m.mark === 'M1')).toBe(true);
      expect(match.markingScheme.generalMarkingGuidance).toContain('Prioritize correct mathematics');
    });
  });

  describe('Problem B: Subject-aware Question Mode prompts & propagation', () => {
    it('getPrompt("marking.questionOnly.*") switches to English examiner prompts for ENGLISH_LANGUAGE and preserves Maths default', () => {
      const defaultSys = getPrompt('marking.questionOnly.system');
      expect(defaultSys).toContain('mathematics examiner');

      const engSys = getPrompt('marking.questionOnly.system', SUBJECT_PROFILES.ENGLISH_LANGUAGE);
      expect(engSys).toContain('GCSE English Language');
      expect(engSys).not.toContain('mathematics examiner');

      const defaultUser = getPrompt('marking.questionOnly.user', 'Solve x+1=2', 'M1 A1');
      expect(defaultUser).toContain('mathematics question');
      expect(defaultUser).toContain('You are a mathematician');

      const engUser = getPrompt('marking.questionOnly.user', 'Write an article...', 'AO5/AO6 rubric', SUBJECT_PROFILES.ENGLISH_LANGUAGE);
      expect(engUser).toContain('GCSE English Language');
      expect(engUser).toContain('NEVER use Maths mark codes');
      expect(engUser).not.toContain('mathematics question');
      expect(engUser).not.toContain('You are a mathematician');
      expect(engUser).not.toContain('<span class="mark-code">[M1]</span>');
      expect(engUser).not.toContain('<span class="marking-code">[M1]</span>');
      expect(engUser).not.toContain('class="mark-code"');
      expect(engUser).toContain('class="marking-code"');
      expect(engUser).toContain('at most ONE');
      expect(defaultUser).not.toContain('class="mark-code"');
      expect(defaultUser).toContain('class="marking-code"');
    });

    it('MarkingServiceLocator.generateChatResponse passes English prompts for questionOnly when subjectProfile is ENGLISH_LANGUAGE', async () => {
      const spy = jest.spyOn(ModelProvider, 'callGeminiText').mockResolvedValue({
        content: '<span class="model_question">Q5</span><div class="model_answer"><p>Sample</p></div>',
        usageTokens: 100,
        inputTokens: 60,
        outputTokens: 40
      } as any);

      await MarkingServiceLocator.generateChatResponse(
        'Write an article',
        'Write an article',
        'gemini-2.5-flash' as any,
        'questionOnly',
        false,
        undefined,
        false,
        undefined,
        undefined,
        SUBJECT_PROFILES.ENGLISH_LANGUAGE
      );

      expect(spy).toHaveBeenCalledTimes(1);
      const [sysPrompt, userPrompt] = spy.mock.calls[0];
      expect(sysPrompt).toContain('GCSE English Language');
      expect(sysPrompt).not.toContain('mathematics examiner');
      expect(userPrompt).not.toContain('Solve as a mathematician');
      expect(userPrompt).not.toContain('You are a mathematician');
      expect(userPrompt).toContain('NEVER use Maths mark codes');
    });

    it('QuestionModeHandlerService.handleQuestionMode propagates subjectProfile end-to-end in Generic English Mode', async () => {
      jest.spyOn(questionDetectionService, 'detectQuestion').mockResolvedValue({
        found: false,
        message: 'No match found'
      } as any);

      const geminiSpy = jest.spyOn(ModelProvider, 'callGeminiText').mockResolvedValue({
        content: '<span class="model_question">Write an article</span><div class="model_answer"><p>Compelling opening. <span class="marking-code">[AO5 L4: Tone]</span></p></div>',
        usageTokens: 120,
        inputTokens: 70,
        outputTokens: 50
      } as any);

      jest.spyOn(SessionManagementService, 'uploadOriginalFiles').mockResolvedValue({ originalImageLinks: [] } as any);
      jest.spyOn(SessionManagementService, 'persistQuestionSession').mockResolvedValue({ sessionId: 'sess-test', unifiedSession: {} } as any);

      const q5Text = 'Write an article for your school website arguing your point of view. (24 marks for content and organisation 16 marks for technical accuracy)';
      const result = await QuestionModeHandlerService.handleQuestionMode({
        classificationResult: {
          category: 'questionOnly',
          questions: [{ questionNumber: '5', text: q5Text }]
        },
        standardizedPages: [{ pageIndex: 0, imageData: 'base64', originalFileName: '8700_2_q5.png' } as any],
        files: [{ originalname: '8700_2_q5.png', buffer: Buffer.from('') } as any],
        actualModel: 'gemini-2.5-flash',
        userId: 'user-1',
        submissionId: 'sub-test',
        req: { body: {} },
        res: { write: jest.fn(), end: jest.fn() } as any,
        startTime: Date.now(),
        logStep: () => () => {},
        usageTracker: undefined as any,
        suppressSseCompletion: true,
        examPaperHint: '8700/2',
        subjectProfile: SUBJECT_PROFILES.ENGLISH_LANGUAGE
      });

      expect(geminiSpy).toHaveBeenCalledTimes(1);
      const [sysPrompt, userPrompt] = geminiSpy.mock.calls[0];
      expect(sysPrompt).toContain('GCSE English Language');
      expect(userPrompt).not.toContain('You are a mathematician');
      expect(userPrompt).toContain('UNIVERSAL GCSE ENGLISH LANGUAGE WRITING RUBRIC');
      expect(result.message.markingContext?.detectedSubject).toBe('ENGLISH_LANGUAGE');
      expect(result.message.markingContext?.examInfo?.subject).toBe('GCSE English Language');
    });
  });

  describe('Problem C: ChatContextBuilder excludes "General" and omits placeholder Exam line', () => {
    it('replaces "General" subject with resolvedProfile.displayName and omits "N/A Generic Question Unknown"', async () => {
      const ctx = await ChatContextBuilder.buildQuestionModeContext({
        detectedQuestion: {
          found: false,
          examPapers: [
            {
              examBoard: 'Unknown',
              examCode: 'Generic Question',
              examSeries: 'N/A',
              subject: 'General',
              tier: 'N/A',
              isGeneric: true,
              questions: [
                {
                  questionNumber: '5',
                  questionText: 'Write an article for your school website.',
                  marks: 40,
                  markingScheme: ''
                }
              ]
            }
          ]
        },
        subjectProfile: SUBJECT_PROFILES.ENGLISH_LANGUAGE,
        examPaperHint: '8700/2'
      });

      expect(ctx.detectedSubject).toBe('ENGLISH_LANGUAGE');
      expect(ctx.examInfo?.subject).toBe('GCSE English Language');

      const prompt = ChatContextBuilder.formatContextAsPrompt(ctx);
      expect(prompt).toContain('** Subject **: GCSE English Language');
      expect(prompt).not.toContain('N/A Generic Question Unknown');
      expect(prompt).not.toContain('** Subject **: General');
    });

    it('replaces "General" subject in buildMarkingContext as well', async () => {
      const ctx = await ChatContextBuilder.buildMarkingContext({
        allQuestionResults: [
          {
            questionNumber: '5',
            questionText: 'Write an article for your school website.',
            score: { awardedMarks: 30, totalMarks: 40 },
            annotations: []
          }
        ],
        questionDetection: {
          found: false,
          match: {
            board: 'Unknown',
            paperCode: 'Generic Question',
            year: 'N/A',
            tier: 'N/A',
            subject: 'General',
            paperTitle: 'General (No Match)'
          }
        },
        markingSchemesMap: new Map(),
        detectionResults: [],
        overallScore: { awardedMarks: 30, totalMarks: 40, percentage: 75, scoreText: '30/40' }
      });

      expect(ctx.detectedSubject).toBe('ENGLISH_LANGUAGE');
      expect(ctx.examInfo?.subject).toBe('GCSE English Language');

      const prompt = ChatContextBuilder.formatContextAsPrompt(ctx);
      expect(prompt).toContain('** Subject **: GCSE English Language');
      expect(prompt).not.toContain('N/A Generic Question Unknown');
      expect(prompt).not.toContain('** Subject **: General');
    });
  });

  describe('LoR Rubric Non-Overlapping Mark Bands', () => {
    it('computes contiguous, non-overlapping Level 1-4 mark bands for 40-mark writing (24 AO5 + 16 AO6)', () => {
      const rubric = buildUniversalEnglishRubricFallback({
        subjectKey: 'ENGLISH_LANGUAGE',
        questionNumber: '5',
        questionText: 'Write an article for your school website.',
        totalMarks: 40
      });

      // AO5 (24 marks): 1-6, 7-12, 13-18, 19-24
      expect(rubric).toContain('19-24 marks');
      expect(rubric).toContain('13-18 marks');
      expect(rubric).toContain('7-12 marks');
      expect(rubric).toContain('1-6 marks');
      expect(rubric).not.toContain('18-24 marks');

      // AO6 (16 marks): 1-4, 5-8, 9-12, 13-16
      expect(rubric).toContain('13-16 marks');
      expect(rubric).toContain('9-12 marks');
      expect(rubric).toContain('5-8 marks');
      expect(rubric).toContain('1-4 marks');
      expect(rubric).not.toContain('12-16 marks');
    });

    it('computes contiguous, non-overlapping Level 1-4 mark bands for 20-mark Q4 and 8-mark Q2/Q3 reading', () => {
      const q4Rubric = buildUniversalEnglishRubricFallback({
        subjectKey: 'ENGLISH_LANGUAGE',
        questionNumber: '4',
        questionText: 'To what extent do you agree?',
        totalMarks: 20
      });
      expect(q4Rubric).toContain('16-20 marks');
      expect(q4Rubric).toContain('11-15 marks');
      expect(q4Rubric).toContain('6-10 marks');
      expect(q4Rubric).toContain('1-5 marks');

      const q2Rubric = buildUniversalEnglishRubricFallback({
        subjectKey: 'ENGLISH_LANGUAGE',
        questionNumber: '2',
        questionText: 'How does the writer use language?',
        totalMarks: 8
      });
      expect(q2Rubric).toContain('7-8 marks');
      expect(q2Rubric).toContain('5-6 marks');
      expect(q2Rubric).toContain('3-4 marks');
      expect(q2Rubric).toContain('1-2 marks');
    });
  });
});
