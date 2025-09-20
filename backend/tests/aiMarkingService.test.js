const { AIMarkingService } = require('../services/aiMarkingService');
const fs = require('fs');
const path = require('path');

// Mock environment variables
process.env['OPENAI_API_KEY'] = 'test-openai-key';

// Mock fetch globally
global.fetch = jest.fn();

describe('AIMarkingService.classifyImage', () => {
  let questionImageData;
  let answerImageData;

  beforeAll(() => {
    // Load test images as base64 data
    const questionImagePath = path.join(__dirname, '../../Testing data/question.png');
    const answerImagePath = path.join(__dirname, '../../Testing data/answer.webp');
    
    const questionBuffer = fs.readFileSync(questionImagePath);
    const answerBuffer = fs.readFileSync(answerImagePath);
    
    questionImageData = `data:image/png;base64,${questionBuffer.toString('base64')}`;
    answerImageData = `data:image/webp;base64,${answerBuffer.toString('base64')}`;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('OpenAI API tests', () => {
    const testModel = 'chatgpt-4o';

    test('classifies question-only image correctly via OpenAI', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              isQuestionOnly: true,
              reasoning: 'This image shows only a math question without any student work or answers'
            })
          }
        }]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await AIMarkingService.classifyImage(questionImageData, testModel);

      expect(result).toEqual({
        isQuestionOnly: true,
        reasoning: 'This image shows only a math question without any student work or answers',
        apiUsed: 'OpenAI GPT-4 Omni'
      });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-openai-key'
          },
          body: expect.stringContaining('gpt-4o')
        })
      );
    });

    test('classifies homework image correctly via OpenAI', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify({
              isQuestionOnly: false,
              reasoning: 'This image shows a math question with student work and answers written down'
            })
          }
        }]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await AIMarkingService.classifyImage(answerImageData, testModel);

      expect(result).toEqual({
        isQuestionOnly: false,
        reasoning: 'This image shows a math question with student work and answers written down',
        apiUsed: 'OpenAI GPT-4 Omni'
      });
    });

    test('handles OpenAI API errors gracefully', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({
          error: { message: 'Invalid API key' }
        })
      });

      const result = await AIMarkingService.classifyImage(questionImageData, testModel);

      expect(result).toEqual({
        isQuestionOnly: false,
        reasoning: 'Classification failed, defaulting to homework marking',
        apiUsed: 'Fallback'
      });
    });

    test('handles malformed OpenAI response gracefully', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: 'Invalid JSON response'
          }
        }]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await AIMarkingService.classifyImage(questionImageData, testModel);

      expect(result).toEqual({
        isQuestionOnly: false,
        reasoning: 'Failed to parse AI response',
        apiUsed: 'OpenAI GPT-4 Omni'
      });
    });
  });

  describe('Gemini API tests', () => {
    const testModel = 'gemini-2.5-pro';

    test('classifies question-only image correctly via Gemini', async () => {
      const mockResponse = {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                isQuestionOnly: true,
                reasoning: 'This image contains only a math question, no student work visible'
              })
            }]
          }
        }]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await AIMarkingService.classifyImage(questionImageData, testModel);

      expect(result).toEqual({
        isQuestionOnly: true,
        reasoning: 'This image contains only a math question, no student work visible',
        apiUsed: 'Google Gemini 2.0 Flash Exp'
      });

      // Verify the fetch call was made to Gemini API
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('generativelanguage.googleapis.com'),
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );
    });

    test('classifies homework image correctly via Gemini', async () => {
      const mockResponse = {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                isQuestionOnly: false,
                reasoning: 'This image shows student work and answers alongside the question'
              })
            }]
          }
        }]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await AIMarkingService.classifyImage(answerImageData, testModel);

      expect(result).toEqual({
        isQuestionOnly: false,
        reasoning: 'This image shows student work and answers alongside the question',
        apiUsed: 'Google Gemini 2.0 Flash Exp'
      });
    });

    test('handles Gemini API errors gracefully', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request'
      });

      const result = await AIMarkingService.classifyImage(questionImageData, testModel);

      expect(result).toEqual({
        isQuestionOnly: false,
        reasoning: 'Classification failed, defaulting to homework marking',
        apiUsed: 'Fallback'
      });
    });

    test('handles malformed Gemini response gracefully', async () => {
      const mockResponse = {
        candidates: [{
          content: {
            parts: [{
              text: 'Invalid JSON response'
            }]
          }
        }]
      };

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await AIMarkingService.classifyImage(questionImageData, testModel);

      expect(result).toEqual({
        isQuestionOnly: false,
        reasoning: 'Failed to parse AI response',
        apiUsed: 'Google Gemini 2.0 Flash Exp'
      });
    });
  });

  describe('Image compression and validation', () => {
    test('handles invalid image data gracefully', async () => {
      const invalidImageData = 'invalid-image-data';

      await expect(
        AIMarkingService.classifyImage(invalidImageData, 'chatgpt-4o')
      ).rejects.toThrow('Invalid image data URL format');
    });

    test('handles empty image data gracefully', async () => {
      const emptyImageData = '';

      await expect(
        AIMarkingService.classifyImage(emptyImageData, 'chatgpt-4o')
      ).rejects.toThrow('Invalid image data format');
    });

    test('handles test placeholder data gracefully', async () => {
      const testImageData = 'data:image/jpeg;base64,test';

      await expect(
        AIMarkingService.classifyImage(testImageData, 'chatgpt-4o')
      ).rejects.toThrow('Invalid base64 image data');
    });
  });

  describe('Edge cases', () => {
    test('handles missing API keys gracefully', async () => {
      // Temporarily remove API keys
      const originalOpenAIKey = process.env['OPENAI_API_KEY'];
      
      delete process.env['OPENAI_API_KEY'];

      // Test that the service returns fallback response when API keys are missing
      const result1 = await AIMarkingService.classifyImage(questionImageData, 'chatgpt-4o');
      expect(result1).toEqual({
        isQuestionOnly: false,
        reasoning: 'Classification failed, defaulting to homework marking',
        apiUsed: 'Fallback'
      });

      const result2 = await AIMarkingService.classifyImage(questionImageData, 'gemini-2.5-pro');
      expect(result2).toEqual({
        isQuestionOnly: false,
        reasoning: 'Classification failed, defaulting to homework marking',
        apiUsed: 'Fallback'
      });

      // Restore API keys
      process.env['OPENAI_API_KEY'] = originalOpenAIKey;
    });

    test('handles network timeouts gracefully', async () => {
      fetch.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await AIMarkingService.classifyImage(questionImageData, 'chatgpt-4o');

      expect(result).toEqual({
        isQuestionOnly: false,
        reasoning: 'Classification failed, defaulting to homework marking',
        apiUsed: 'Fallback'
      });
    });
  });
});
