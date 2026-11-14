import { ChatContextBuilder } from '../services/marking/ChatContextBuilder.js';
import { buildExamPaperStructure } from '../services/marking/questionDetectionService.js';
import { SuggestedFollowUpService } from '../services/marking/suggestedFollowUpService.js';
import { FirestoreService } from '../services/firestoreService.js';
import { ModelProvider } from '../utils/ModelProvider.js';
import contextualSystemPrompt from '../config/prompts/contextual_system_prompt.js';

describe('Question Mode Option A fixes', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('buildExamPaperStructure preserves extractedQuestionText, databaseQuestionText, and sourceImageIndex', () => {
    const { examPapers } = buildExamPaperStructure([
      {
        question: {
          questionNumber: '1',
          text: 'OCR extracted: Solve 2x + 3 = 11',
          sourceImageIndex: 1
        },
        detectionResult: {
          found: true,
          match: {
            board: 'Edexcel',
            paperCode: '1MA1/1H',
            examSeries: 'June 2024',
            tier: 'Higher',
            subject: 'Mathematics',
            questionNumber: '1',
            marks: 3,
            databaseQuestionText: 'DB text: Solve 2x + 3 = 11'
          },
          markingScheme: 'M1: 2x = 8\nA1: x = 4'
        }
      }
    ]);

    expect(examPapers).toHaveLength(1);
    expect(examPapers[0].questions[0].questionText).toBe('DB text: Solve 2x + 3 = 11');
    expect(examPapers[0].questions[0].extractedQuestionText).toBe('OCR extracted: Solve 2x + 3 = 11');
    expect(examPapers[0].questions[0].databaseQuestionText).toBe('DB text: Solve 2x + 3 = 11');
    expect((examPapers[0].questions[0] as any).sourceImageIndex).toBe(1);
  });

  it('ChatContextBuilder.buildQuestionModeContext falls back to detectedQuestion.questions when examPapers is empty (found: false)', async () => {
    const ctx = await ChatContextBuilder.buildQuestionModeContext({
      detectedQuestion: {
        found: false,
        multipleExamPapers: false,
        multipleQuestions: false,
        totalMarks: 0,
        examPapers: [],
        questions: [
          {
            questionNumber: '1',
            questionText: 'Find the area of a circle with radius 5 cm.',
            extractedQuestionText: 'Find the area of a circle with radius 5 cm.',
            marks: 3,
            markingScheme: '',
            sourceImageIndex: 0
          }
        ]
      }
    });

    expect(ctx.sessionType).toBe('Question');
    expect(ctx.totalQuestionsMarked).toBe(1);
    expect(ctx.questionResults).toHaveLength(1);
    expect(ctx.questionResults[0].number).toBe('1');
    expect(ctx.questionResults[0].text).toBe('Find the area of a circle with radius 5 cm.');
    expect(ctx.questionResults[0].extractedQuestionText).toBe('Find the area of a circle with radius 5 cm.');
    expect(ctx.questionResults[0].totalMarks).toBe(3);
  });

  it('ChatContextBuilder.buildQuestionModeContext merges unmatched questions on partial DB match and preserves sourceImageIndex', async () => {
    const ctx = await ChatContextBuilder.buildQuestionModeContext({
      detectedQuestion: {
        found: true,
        examPapers: [
          {
            examBoard: 'Edexcel',
            examCode: '1MA1/1H',
            examSeries: 'June 2024',
            tier: 'Higher',
            subject: 'Mathematics',
            questions: [
              {
                questionNumber: '1',
                questionText: 'DB Q1',
                databaseQuestionText: 'DB Q1',
                extractedQuestionText: 'OCR Q1',
                marks: 2,
                markingScheme: 'M1 A1'
              }
            ]
          }
        ],
        questions: [
          {
            questionNumber: '1',
            questionText: 'DB Q1',
            databaseQuestionText: 'DB Q1',
            extractedQuestionText: 'OCR Q1',
            marks: 2,
            sourceImageIndex: 0,
            detection: { found: true }
          },
          {
            questionNumber: '2',
            questionText: 'Unmatched Q2',
            extractedQuestionText: 'Unmatched Q2',
            marks: 4,
            sourceImageIndex: 1,
            detection: { found: false }
          }
        ]
      }
    });

    expect(ctx.totalQuestionsMarked).toBe(2);
    expect(ctx.questionResults.map(q => q.number)).toEqual(['1', '2']);
    expect(ctx.questionResults[1].extractedQuestionText).toBe('Unmatched Q2');
    expect(ctx.questionResults[1].pageIndex).toBe(1);
  });

  it('ChatContextBuilder.formatContextAsPrompt includes extractedQuestionText when it differs from databaseQuestionText and omits 0% score in Question Mode', async () => {
    const ctx = await ChatContextBuilder.buildQuestionModeContext({
      detectedQuestion: {
        found: true,
        examPapers: [
          {
            examBoard: 'AQA',
            examCode: '8300/1H',
            examSeries: 'June 2023',
            tier: 'Higher',
            subject: 'Mathematics',
            questions: [
              {
                questionNumber: '4',
                questionText: 'DB Question: Simplify 3a + 4b - a + 2b',
                databaseQuestionText: 'DB Question: Simplify 3a + 4b - a + 2b',
                extractedQuestionText: 'Student Image OCR: Simplify 3a + 5b - a + 2b',
                marks: 2,
                markingScheme: 'M1: 2a\nA1: 2a + 6b'
              }
            ]
          }
        ]
      }
    });

    const prompt = ChatContextBuilder.formatContextAsPrompt(ctx);
    expect(prompt).toContain('Session Type **: Question Mode');
    expect(prompt).not.toContain('Total Score **: N/A (0%)');
    expect(prompt).toContain('DB Question: Simplify 3a + 4b - a + 2b');
    expect(prompt).toContain('Uploaded Question Text (Extracted from Student Image)');
    expect(prompt).toContain('Student Image OCR: Simplify 3a + 5b - a + 2b');
  });

  it('SuggestedFollowUpService.handleSuggestedFollowUp executes model-answer when found=false and examPapers=[]', async () => {
    jest.spyOn(FirestoreService, 'getUnifiedSession').mockResolvedValue({
      id: 'sess-q-unmatched',
      messages: [
        {
          id: 'msg-1',
          role: 'assistant',
          detectedQuestion: {
            found: false,
            examPapers: [],
            questions: [
              {
                questionNumber: '1',
                questionText: 'Solve x + 5 = 12',
                extractedQuestionText: 'Solve x + 5 = 12',
                marks: 2,
                markingScheme: ''
              }
            ]
          }
        }
      ]
    } as any);

    const callTextSpy = jest.spyOn(ModelProvider, 'callText').mockResolvedValue({
      content: '<span class="model_question">Solve x + 5 = 12</span><p>$x = 7$</p>',
      usageTokens: 42
    } as any);

    const result = await SuggestedFollowUpService.handleSuggestedFollowUp({
      mode: 'model-answer',
      sessionId: 'sess-q-unmatched',
      model: 'gemini-2.5-flash'
    });

    expect(callTextSpy).toHaveBeenCalledTimes(1);
    expect(result.response).not.toBe('(No paper data available)');
    expect(result.response).toContain('Custom');
    expect(result.response).toContain('Question 1');
    expect(result.response).toContain('$x = 7$');
    expect(result.usageTokens).toBe(42);
  });

  it('SuggestedFollowUpService.handleSuggestedFollowUp includes unmatched questions on partial DB match', async () => {
    const callTextSpy = jest.spyOn(ModelProvider, 'callText').mockResolvedValue({
      content: '=== QUESTION_START: 1 ===\n<p>Ans 1</p>\n=== QUESTION_START: 2 ===\n<p>Ans 2</p>',
      usageTokens: 80
    } as any);

    const result = await SuggestedFollowUpService.handleSuggestedFollowUp({
      mode: 'marking-scheme',
      sessionId: 'sess-q-partial',
      model: 'gemini-2.5-flash',
      detectedQuestion: {
        found: true,
        examPapers: [
          {
            examBoard: 'Edexcel',
            examCode: '1MA1/1H',
            examSeries: 'June 2024',
            subject: 'Mathematics',
            questions: [
              {
                questionNumber: '1',
                questionText: 'DB Q1',
                databaseQuestionText: 'DB Q1',
                extractedQuestionText: 'OCR Q1',
                marks: 2,
                markingScheme: 'M1 A1'
              }
            ]
          }
        ],
        questions: [
          {
            questionNumber: '1',
            questionText: 'DB Q1',
            databaseQuestionText: 'DB Q1',
            extractedQuestionText: 'OCR Q1',
            marks: 2,
            detection: { found: true }
          },
          {
            questionNumber: '2',
            questionText: 'Unmatched Q2',
            extractedQuestionText: 'Unmatched Q2',
            marks: 3,
            detection: { found: false }
          }
        ]
      }
    });

    expect(callTextSpy).toHaveBeenCalledTimes(1);
    expect(result.response).toContain('Question 1');
    expect(result.response).toContain('Question 2');
    expect(result.response).toContain('Ans 2');
  });

  it('contextual_system_prompt supports Question Mode follow-up chat (marking typed answers & disputed DB matches)', () => {
    expect(contextualSystemPrompt).toContain('Question Mode');
    expect(contextualSystemPrompt).toContain('Uploaded Question Text (Extracted from Student Image)');
    expect(contextualSystemPrompt).toContain('NEVER use [SHOW_WORK_Q:X] in Question Mode');
  });
});
