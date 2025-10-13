const { ClassificationService } = require('../services/ai/ClassificationService');

describe('ClassificationService', () => {
  test('extractTextAndAnalyze returns proper structure', async () => {
    const image = 'data:image/png;base64,AAAA';
    const result = await ClassificationService.extractTextAndAnalyze(image, 'gemini-2.5-pro');
    expect(result).toEqual(
      expect.objectContaining({ 
        textAnalysis: expect.objectContaining({
          mode: expect.any(String),
          questionText: expect.any(String),
          confidence: expect.any(Number),
          reasoning: expect.any(String)
        }),
        visionResult: expect.objectContaining({
          passA: expect.any(Array),
          passB: expect.any(Array),
          passC: expect.any(Array),
          allBlocks: expect.any(Array),
          passAText: expect.any(String)
        })
      })
    );
  });
});



