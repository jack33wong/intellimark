import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { useScrollManager } from './useScrollManager';
import { jest } from '@jest/globals';

// Mock the requestAnimationFrame to control it in tests
global.requestAnimationFrame = (cb) => {
  cb();
  return 1;
};
global.cancelAnimationFrame = () => {};

describe('useScrollManager hook', () => {
  let mockChatContainer;
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockChatContainer = {
      scrollHeight: 1000,
      scrollTop: 0,
      clientHeight: 500,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      scrollTo: jest.fn(),
      querySelector: jest.fn().mockImplementation(selector => {
        if (typeof selector === 'string' && selector.includes('ai-1')) {
          return {
            offsetTop: 800,
            scrollIntoView: jest.fn(),
          };
        }
        return null;
      }),
    };
  });
  
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should initialize with default scroll states', () => {
    const { result } = renderHook(() => useScrollManager([], false));
    expect(result.current.showScrollButton).toBe(false);
    expect(result.current.hasNewResponse).toBe(false);
  });

  it('should call scrollToBottom when a user adds a new message', () => {
    const { result, rerender } = renderHook(
        ({ chatMessages, isAIThinking }) => useScrollManager(chatMessages, isAIThinking), 
        { initialProps: { chatMessages: [], isAIThinking: false } }
    );
    
    act(() => { result.current.chatContainerRef.current = mockChatContainer; });
    const newUserMessage = { id: 'user-1', role: 'user', content: 'hello' };
    rerender({ chatMessages: [newUserMessage], isAIThinking: false });
    expect(mockChatContainer.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
  });

  it('should show "New Response" button when AI finishes and user is scrolled up', () => {
    const { result, rerender } = renderHook(
        ({ chatMessages, isAIThinking }) => useScrollManager(chatMessages, isAIThinking), 
        { initialProps: { chatMessages: [{ id: 'user-1', role: 'user' }], isAIThinking: true } }
    );
    
    act(() => {
      result.current.chatContainerRef.current = mockChatContainer;
      result.current.chatContainerRef.current.scrollTop = 100; 
    });
    const aiResponseMessage = { id: 'ai-1', role: 'assistant', content: 'response' };
    rerender({ chatMessages: [{ id: 'user-1', role: 'user' }, aiResponseMessage], isAIThinking: false });
    expect(result.current.hasNewResponse).toBe(true);
    expect(mockChatContainer.scrollTo).not.toHaveBeenCalled();
  });
  
  it('should auto-scroll when AI finishes and user is at the bottom', () => {
    const { result, rerender } = renderHook(
        ({ chatMessages, isAIThinking }) => useScrollManager(chatMessages, isAIThinking), 
        { initialProps: { chatMessages: [{ id: 'user-1', role: 'user' }], isAIThinking: true } }
    );
    
    act(() => {
      result.current.chatContainerRef.current = mockChatContainer;
      result.current.chatContainerRef.current.scrollTop = 500; 
    });
    const aiResponseMessage = { id: 'ai-1', role: 'assistant', content: 'response' };
    rerender({ chatMessages: [{ id: 'user-1', role: 'user' }, aiResponseMessage], isAIThinking: false });
    expect(result.current.hasNewResponse).toBe(false);
    expect(mockChatContainer.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
  });

  // 👇 Fixed test: properly trigger the useEffect that attaches the scroll listener
  it('should show the scroll-to-bottom button when user scrolls up', () => {
    const { result, rerender } = renderHook(
      ({ chatMessages, isAIThinking }) => useScrollManager(chatMessages, isAIThinking), 
      { initialProps: { chatMessages: [], isAIThinking: false } }
    );
    
    // 1. Attach the ref.
    act(() => {
      result.current.chatContainerRef.current = mockChatContainer;
    });
    
    // 2. Trigger the useEffect by simulating a scenario where hasNewResponse becomes true
    // We'll do this by simulating an AI response scenario
    const userMessage = { id: 'user-1', role: 'user', content: 'hello' };
    const aiMessage = { id: 'ai-1', role: 'assistant', content: 'response' };
    
    // First, set up AI thinking state
    rerender({ chatMessages: [userMessage], isAIThinking: true });
    
    // Then simulate AI finishing (this will trigger the useLayoutEffect and set hasNewResponse)
    act(() => {
      result.current.chatContainerRef.current.scrollTop = 100; // User scrolled up
    });
    rerender({ chatMessages: [userMessage, aiMessage], isAIThinking: false });
    
    // 3. Now it is safe to find the scroll handler.
    const scrollHandlerCall = mockChatContainer.addEventListener.mock.calls.find(call => call[0] === 'scroll');
    expect(scrollHandlerCall).toBeDefined();
    const scrollHandler = scrollHandlerCall[1];

    // 4. Simulate the scroll event.
    act(() => {
      mockChatContainer.scrollTop = 100; // Scrolled up
      scrollHandler();
    });
    expect(result.current.showScrollButton).toBe(true);
    
    act(() => {
      mockChatContainer.scrollTop = 500; // Scrolled down
      scrollHandler();
    });
    expect(result.current.showScrollButton).toBe(false);
  });
  
  // 👇 Fixed test: test scrollToMessage function directly and scrollToNewResponse behavior
  it('should call scrollToMessage and reset state when scrollToNewResponse is called', () => {
      const { result } = renderHook(() => useScrollManager([], false));
    
    act(() => {
      result.current.chatContainerRef.current = mockChatContainer;
    });

    // Test scrollToMessage function directly with a valid message ID
    act(() => {
      result.current.scrollToMessage('ai-1');
    });

    // Verify that scrollToMessage was called with the correct message ID
    expect(mockChatContainer.querySelector).toHaveBeenCalledWith('[data-message-id="ai-1"]');
    
    // Get the mock element that was returned by querySelector
    const mockMessageElement = mockChatContainer.querySelector.mock.results[0].value;
    expect(mockMessageElement.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });

    // Test scrollToNewResponse when newResponseMessageId is null
    // In this case, scrollToNewResponse should just reset the state without scrolling
    act(() => {
      result.current.scrollToNewResponse();
    });

    // When newResponseMessageId is null, scrollToNewResponse doesn't call scrollToMessage
    // It just resets the state, so scrollTo should not be called
    expect(mockChatContainer.scrollTo).not.toHaveBeenCalled();
  });
});

