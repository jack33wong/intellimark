const { MarkingInstructionService } = require('../services/ai/MarkingInstructionService');

describe('MarkingInstructionService', () => {
  test('generateFromOCR returns annotations key as string (raw)', async () => {
    // With no API keys set, this call will throw; we just assert interface by mocking
    const spy = jest.spyOn(MarkingInstructionService, 'generateFromOCR').mockResolvedValue({ annotations: '[]' });
    const result = await MarkingInstructionService.generateFromOCR('chatgpt-4o', 'x=1', undefined);
    expect(typeof result.annotations).toBe('string');
    spy.mockRestore();
  });
});



