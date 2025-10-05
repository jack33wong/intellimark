/**
 * Auto Progress Tracker Tests
 * Tests the new auto-progress system without breaking existing functionality
 */

const { AutoProgressTracker, createAutoProgressTracker } = require('../utils/autoProgressTracker.js');

describe('AutoProgressTracker', () => {
  let mockOnProgress;
  let progressTracker;

  beforeEach(() => {
    mockOnProgress = jest.fn();
    const steps = [
      { id: 'step1', name: 'Step 1', description: 'First step' },
      { id: 'step2', name: 'Step 2', description: 'Second step' },
      { id: 'step3', name: 'Step 3', description: 'Third step' }
    ];
    progressTracker = new AutoProgressTracker(steps, mockOnProgress);
  });

  test('should register steps correctly', () => {
    progressTracker.registerStep('step1', {
      stepId: 'step1',
      stepName: 'Step 1',
      stepDescription: 'First step'
    });

    expect(progressTracker.stepMap.has('step1')).toBe(true);
  });

  test('should automatically track function execution', async () => {
    progressTracker.registerStep('step1', {
      stepId: 'step1',
      stepName: 'Step 1',
      stepDescription: 'First step'
    });

    const mockFunction = jest.fn().mockResolvedValue('result');
    const trackedFunction = progressTracker.withProgress('step1', mockFunction);

    const result = await trackedFunction('arg1', 'arg2');

    expect(result).toBe('result');
    expect(mockFunction).toHaveBeenCalledWith('arg1', 'arg2');
    expect(mockOnProgress).toHaveBeenCalled();
  });

  test('should handle function errors gracefully', async () => {
    progressTracker.registerStep('step1', {
      stepId: 'step1',
      stepName: 'Step 1',
      stepDescription: 'First step'
    });

    const mockFunction = jest.fn().mockRejectedValue(new Error('Test error'));
    const trackedFunction = progressTracker.withProgress('step1', mockFunction);

    await expect(trackedFunction()).rejects.toThrow('Test error');
    expect(mockOnProgress).toHaveBeenCalled();
  });

  test('should maintain backward compatibility with manual methods', () => {
    progressTracker.startStep('step1');
    expect(progressTracker.getCurrentStepId()).toBe('step1');

    progressTracker.completeCurrentStep();
    expect(mockOnProgress).toHaveBeenCalled();

    progressTracker.finish();
    expect(mockOnProgress).toHaveBeenCalled();
  });

  test('should create auto-progress tracker with helper function', () => {
    const steps = [
      { id: 'step1', name: 'Step 1', description: 'First step' }
    ];
    const tracker = createAutoProgressTracker(steps, mockOnProgress);

    expect(tracker).toBeInstanceOf(AutoProgressTracker);
  });
});
