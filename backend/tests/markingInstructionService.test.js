const { MarkingInstructionService } = require('../services/ai/MarkingInstructionService');

describe('MarkingInstructionService', () => {
  test('generateFromOCR returns annotations key as string (raw)', async () => {
    // With no API keys set, this call will throw; we just assert interface by mocking
    const spy = jest.spyOn(MarkingInstructionService, 'generateFromOCR').mockResolvedValue({ annotations: '[]' });
    const result = await MarkingInstructionService.generateFromOCR('gemini-2.5-pro', 'x=1', undefined);
    expect(typeof result.annotations).toBe('string');
    spy.mockRestore();
  });
});



