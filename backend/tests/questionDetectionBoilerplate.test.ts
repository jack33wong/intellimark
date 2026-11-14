import { SimilarityService } from '../services/marking/SimilarityService.js';
import { stripExamBoilerplateForSimilarity } from '../utils/TextNormalizationUtils.js';
import { QuestionDetectionService } from '../services/marking/questionDetectionService.js';

const JUNE_2025_Q5_DB =
  "'Being in touch with plants, animals and birds is good for us. People spend far too much time indoors these days and need to get back to nature.' Write an article for your school website in which you argue your point of view on this statement. (24 marks for content and organisation 16 marks for technical accuracy) You are advised to plan your answer to Question 5 before you start to write.";

const JUNE_2026_Q5_UPLOAD =
  "Section B: Writing You are advised to spend about 45 minutes on this section. Write in full sentences. You are reminded of the need to plan your answer. You should leave enough time to check your work at the end. 0 5 'Many young people rely too much on technology. New inventions like artificial intelligence can be exciting and helpful but we must be careful how much we depend on them.' Write an article for a school website in which you argue your point of view on this statement. (24 marks for content and organisation 16 marks for technical accuracy) [40 marks] You are advised to plan your answer to Question 5 before you start to write.";

describe('Question Detection Boilerplate & Series Guards', () => {
  it('strips shared rubric boilerplate and mark-breakdown numbers', () => {
    const stripped2025 = stripExamBoilerplateForSimilarity(JUNE_2025_Q5_DB);
    const stripped2026 = stripExamBoilerplateForSimilarity(JUNE_2026_Q5_UPLOAD);

    expect(stripped2025).toContain('Being in touch with plants, animals and birds');
    expect(stripped2025).not.toContain('24 marks for content');
    expect(stripped2026).toContain('Many young people rely too much on technology');
    expect(stripped2026).not.toContain('40 marks');
    expect(stripped2026).not.toContain('You are advised to spend');
  });

  it('prevents June 2026 Q5 from falsely matching June 2025 Q5 in SimilarityService', () => {
    const score = SimilarityService.calculateQuestionHybridScore(
      JUNE_2026_Q5_UPLOAD,
      JUNE_2025_Q5_DB,
      false
    );

    expect(score.text).toBeLessThan(0.5);
    expect(score.total).toBeLessThan(0.5);
  });

  it('still matches the actual June 2025 Q5 prompt cleanly', () => {
    const score = SimilarityService.calculateQuestionHybridScore(
      JUNE_2025_Q5_DB,
      JUNE_2025_Q5_DB,
      false
    );

    expect(score.text).toBeCloseTo(1.0, 2);
    expect(score.total).toBeGreaterThan(0.8);
  });

  it('rejects June 2026 Q5 in QuestionDetectionService even when only June 2025 is in DB', async () => {
    const service = QuestionDetectionService.getInstance();
    const originalGetAllExamPapers = (service as any).getAllExamPapers;
    const originalFindMarkingScheme = (service as any).findCorrespondingMarkingScheme;
    (service as any).findCorrespondingMarkingScheme = async () => null;
    (service as any).getAllExamPapers = async () => [
      {
        id: 'aqa-8700-2-jun2025',
        metadata: {
          exam_board: 'AQA',
          qualification: 'GCSE',
          subject: 'English Language',
          exam_code: '8700/2',
          exam_series: 'June 2025',
        },
        questions: {
          '5': {
            questionNumber: '5',
            text: JUNE_2025_Q5_DB,
            marks: 40,
          },
        },
      },
    ];

    try {
      // Even without a year hint, boilerplate stripping triggers [CONTENT-LOCK] and rejects
      const noYearResult = await service.detectQuestion(JUNE_2026_Q5_UPLOAD, '5', '8700/2');
      expect(noYearResult.found).toBe(false);

      // With an explicit Jun26 hint, series guard blocks falling back to June 2025
      const jun26Result = await service.detectQuestion(JUNE_2026_Q5_UPLOAD, '5', '8700/2 Jun26');
      expect(jun26Result.found).toBe(false);

      // Actual June 2025 Q5 still matches
      const validResult = await service.detectQuestion(JUNE_2025_Q5_DB, '5', '8700/2');
      expect(validResult.found).toBe(true);
      expect(validResult.match?.paperCode).toBe('8700/2');
    } finally {
      (service as any).getAllExamPapers = originalGetAllExamPapers;
      (service as any).findCorrespondingMarkingScheme = originalFindMarkingScheme;
    }
  });

  it('strips mark-total noise in Maths without hurting real Maths matching', () => {
    const mathInput = 'Solve 3x + 5 = 17. (Total for Question 2 is 3 marks)';
    const mathDbSame = 'Solve 3x + 5 = 17. (3 marks)';
    const mathDbOther = 'Factorise x^2 - 9. (Total for Question 2 is 3 marks)';

    const sameScore = SimilarityService.calculateQuestionHybridScore(mathInput, mathDbSame, false);
    const otherScore = SimilarityService.calculateQuestionHybridScore(mathInput, mathDbOther, false);

    expect(sameScore.total).toBeGreaterThan(0.9);
    expect(otherScore.numeric).toBe(0);
    expect(otherScore.total).toBeLessThan(0.4);
  });
});
