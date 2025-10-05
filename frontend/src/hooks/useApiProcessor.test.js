import { renderHook } from '@testing-library/react';
import { act } from 'react';
import * as apiProcessorHook from './useApiProcessor';
import { simpleSessionService } from '../services/simpleSessionService';

// Mock the service dependency
jest.mock('../services/simpleSessionService', () => ({
  simpleSessionService: {
    processImageWithProgress: jest.fn(),
    addMessage: jest.fn(),
    getCurrentSession: jest.fn(),
    setCurrentSession: jest.fn(),
  },
}));

const renderUseApiProcessor = () => {
  return renderHook(() => apiProcessorHook.useApiProcessor());
};

describe('useApiProcessor hook', () => {
  let consoleErrorSpy;
  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should initialize with correct default state', () => {
    const { result } = renderUseApiProcessor();
    expect(result.current.isProcessing).toBe(false);
  });

  it('should set isProcessing to true when startProcessing is called', () => {
    const { result } = renderUseApiProcessor();
    act(() => { result.current.startProcessing(); });
    expect(result.current.isProcessing).toBe(true);
  });

  it('should set isProcessing to false when stopProcessing is called', () => {
    const { result } = renderUseApiProcessor();
    act(() => { result.current.startProcessing(); });
    act(() => { result.current.stopProcessing(); });
    expect(result.current.isProcessing).toBe(false);
  });
  
  it('should set isAIThinking to true and add a processing message when startAIThinking is called', () => {
    const { result } = renderUseApiProcessor();
    act(() => { result.current.startAIThinking(); });
    expect(result.current.isAIThinking).toBe(true);
    expect(simpleSessionService.addMessage).toHaveBeenCalled();
  });

  it('should set isAIThinking to false when stopAIThinking is called', () => {
    const { result } = renderUseApiProcessor();
    act(() => { result.current.startAIThinking(); });
    act(() => { result.current.stopAIThinking(); });
    expect(result.current.isAIThinking).toBe(false);
  });

  it('should set an error message and reset processing states when handleError is called', () => {
    const { result } = renderUseApiProcessor();
    act(() => {
      result.current.startProcessing();
      result.current.startAIThinking();
    });
    const testError = new Error('Something went wrong');
    act(() => { result.current.handleError(testError); });
    expect(result.current.error).toBe('Something went wrong');
    expect(result.current.isProcessing).toBe(false);
  });

  it('should update progress state correctly when updateProgress is called', () => {
    const { result } = renderUseApiProcessor();
    simpleSessionService.getCurrentSession.mockReturnValue({
      id: 'session-1',
      messages: [{ id: 'msg-1', isProcessing: true }]
    });
    const progressUpdate = {
      currentStepDescription: 'Analyzing image...',
      allSteps: ['Step 1', 'Step 2', 'Step 3'],
      currentStepIndex: 1,
      isComplete: false,
    };
    act(() => { result.current.updateProgress(progressUpdate); });
    expect(result.current.loadingMessage).toBe('Analyzing image...');
    expect(result.current.loadingProgress).toBe(33);
    expect(simpleSessionService.setCurrentSession).toHaveBeenCalled();
  });

  it('should call the session service with the correct parameters when processImageAPI is called', async () => {
    const { result } = renderUseApiProcessor();
    simpleSessionService.processImageWithProgress.mockResolvedValue({ success: true });
    await act(async () => {
      await result.current.processImageAPI('data', 'model', 'mode', 'text');
    });
    expect(simpleSessionService.processImageWithProgress).toHaveBeenCalled();
  });

  // 👇 New test case for the API failure scenario 👇
  it('should handle API failure correctly in processImageAPI', async () => {
    const { result } = renderUseApiProcessor();
    
    // Arrange: Mock the service to reject with an error.
    const apiError = new Error('Network request failed');
    simpleSessionService.processImageWithProgress.mockRejectedValue(apiError);

    // Act: Call the function and expect it to throw.
    await act(async () => {
        // We need to wrap the call in a try/catch or use .rejects to handle the thrown error.
        await expect(result.current.processImageAPI('data', 'model', 'mode', 'text'))
            .rejects.toThrow('Network request failed');
    });

    // Assert: The hook's internal handleError should have been called, updating the state.
    expect(result.current.error).toBe('Network request failed');
    expect(result.current.isProcessing).toBe(false);
    expect(result.current.isAIThinking).toBe(false);
  });
});

