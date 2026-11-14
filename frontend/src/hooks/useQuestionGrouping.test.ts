import { renderHook } from '@testing-library/react';
import { useQuestionGrouping } from './useQuestionGrouping';
import type { DetectedQuestion } from '../types';

describe('useQuestionGrouping', () => {
  it('falls back to detectedQuestion.questions when examPapers is empty (found: false)', () => {
    const detectedQuestion = {
      found: false,
      multipleExamPapers: false,
      multipleQuestions: false,
      totalMarks: 0,
      examPapers: [],
      questions: [
        {
          questionNumber: '2a',
          questionText: 'Solve x^2 = 9',
          marks: 2,
          sourceImageIndex: 0
        },
        {
          questionNumber: '2b',
          questionText: 'Hence solve x^2 - 9 = 0',
          marks: 1,
          sourceImageIndex: 0
        }
      ]
    } as unknown as DetectedQuestion;

    const { result } = renderHook(() => useQuestionGrouping(detectedQuestion));

    expect(result.current.groupedQuestions).toHaveLength(1);
    expect(result.current.groupedQuestions[0].questionNumber).toBe('2');
    expect(result.current.groupedQuestions[0].totalMarks).toBe(3);
    expect(result.current.groupedQuestions[0].subQuestions).toEqual(['2a', '2b']);
  });

  it('merges unmatched detectedQuestion.questions when examPapers has partial DB match', () => {
    const detectedQuestion = {
      found: true,
      multipleExamPapers: false,
      multipleQuestions: true,
      totalMarks: 2,
      examPapers: [
        {
          examBoard: 'Edexcel',
          examCode: '1MA1/1H',
          questions: [
            {
              questionNumber: '1',
              questionText: 'DB Q1',
              databaseQuestionText: 'DB Q1',
              extractedQuestionText: 'OCR Q1',
              marks: 2
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
          questionNumber: '3',
          questionText: 'Unmatched Q3',
          extractedQuestionText: 'Unmatched Q3',
          marks: 4,
          sourceImageIndex: 1,
          detection: { found: false }
        }
      ]
    } as unknown as DetectedQuestion;

    const { result } = renderHook(() => useQuestionGrouping(detectedQuestion));

    expect(result.current.groupedQuestions.map(g => g.questionNumber)).toEqual(['1', '3']);
    expect(result.current.groupedQuestions[1].totalMarks).toBe(4);
    expect(result.current.groupedQuestions[1].sourceImageIndex).toBe(1);
  });
});
