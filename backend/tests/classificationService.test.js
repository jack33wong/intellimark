const { ClassificationService } = require('../services/ai/ClassificationService');

describe('ClassificationService', () => {
  test('classifyImage returns fallback when provider fails', async () => {
    const image = 'data:image/png;base64,AAAA';
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const result = await ClassificationService.classifyImage(image, 'gemini-2.5-pro');
    expect(result).toEqual(
      expect.objectContaining({ isQuestionOnly: false, apiUsed: 'Fallback' })
    );
    if (original) process.env.GEMINI_API_KEY = original;
  });
});


