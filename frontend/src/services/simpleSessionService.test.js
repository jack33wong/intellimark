import { act } from 'react';
import { simpleSessionService } from './simpleSessionService';

// 👇 FIX: The mock for eventManager is now complete. It correctly exports
// both the `dispatch` function and the `EVENT_TYPES` object.
jest.mock('../utils/eventManager', () => ({
  __esModule: true, // This is important for modules with named exports
  default: {
    dispatch: jest.fn(),
  },
  EVENT_TYPES: {
    SESSION_UPDATED: 'SESSION_UPDATED',
  },
}));

describe('simpleSessionService', () => {
  let consoleErrorSpy;
  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    // Reset the service's state before each test for isolation
    simpleSessionService.clearAllSessions();
  });
  
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  // Test Case 1: Verifies the fix for the "Processing..." title bug.
  it('should correctly update a temporary session to a real session with a final title', () => {
    // ARRANGE (Step 1): Simulate the start of a new chat
    const optimisticUserMessage = { id: 'user-temp-1', role: 'user', content: 'First message' };
    const thinkingMessage = { id: 'thinking-1', role: 'assistant', isProcessing: true, content: '' };
    
    act(() => {
        simpleSessionService.addMessage(optimisticUserMessage);
        simpleSessionService.addMessage(thinkingMessage);
    });

    const tempSession = simpleSessionService.getCurrentSession();
    expect(tempSession.title).toBe('Processing...');
    expect(tempSession.messages.length).toBe(2);

    // ARRANGE (Step 2): Simulate the response from the backend
    const serverSession = {
      id: 'session-real-abc',
      title: 'A Real Title',
      messages: [
        { id: 'user-real-def', role: 'user', content: 'First message', imageLink: null },
        { id: 'ai-1', role: 'assistant', content: 'Here is the response.' }
      ],
    };

    // ACT: Call the merging function
    act(() => {
        simpleSessionService._setAndMergeCurrentSession(serverSession);
    });

    const finalSession = simpleSessionService.getCurrentSession();
    
    // ASSERT
    expect(finalSession.title).toBe('A Real Title'); // Title is updated
    expect(finalSession.messages.length).toBe(2); // No duplicates
    expect(finalSession.messages.find(m => m.isProcessing)).toBeUndefined(); 
    expect(finalSession.messages.find(m => m.role === 'assistant').content).toBe('Here is the response.');
  });

  // Test Case 2: Verifies the fix for the "ghost message" / "stuck thinking dot" bug.
  it('should correctly replace the thinking message without leaving a ghost', () => {
    const initialMessages = [
        { id: 'user-1', role: 'user', content: 'Message one' },
        { id: 'ai-1', role: 'assistant', content: 'Response one' },
        { id: 'user-2', role: 'user', content: 'Message two' },
    ];
    const thinkingMessage = { id: 'thinking-2', role: 'assistant', isProcessing: true, content: '' };
    
    act(() => {
        simpleSessionService.setCurrentSession({ id: 'session-123', messages: initialMessages });
        simpleSessionService.addMessage(thinkingMessage);
    });

    const serverSession = {
      id: 'session-123',
      messages: [
        ...initialMessages,
        { id: 'ai-2-final', role: 'assistant', content: 'Final response' }
      ]
    };
    
    act(() => {
        simpleSessionService._setAndMergeCurrentSession(serverSession);
    });

    const finalSession = simpleSessionService.getCurrentSession();
    expect(finalSession.messages.length).toBe(4);
    expect(finalSession.messages.find(m => m.isProcessing)).toBeUndefined();
    expect(finalSession.messages[3].content).toBe('Final response');
  });

  // Test Case 3: Verifies the fix for the multi-image refresh bug.
  it('should preserve imageData for all user images in a session', () => {
    const localSession = {
      id: 'session-multi-image',
      messages: [
        { id: 'user-1-temp', role: 'user', content: 'First image', imageData: 'base64_image_1' },
        { id: 'ai-1', role: 'assistant', content: 'Got it.' },
        { id: 'user-2-temp', role: 'user', content: 'Second image', imageData: 'base64_image_2' },
      ],
    };
    act(() => {
        simpleSessionService.setCurrentSession(localSession);
    });

    const serverSession = {
      id: 'session-multi-image',
      messages: [
        { id: 'user-1-final', role: 'user', content: 'First image', imageLink: 'link_1' },
        { id: 'ai-1', role: 'assistant', content: 'Got it.' },
        { id: 'user-2-final', role: 'user', content: 'Second image', imageLink: 'link_2' },
        { id: 'ai-2', role: 'assistant', content: 'Got that too.' },
      ]
    };
    
    act(() => {
        simpleSessionService._setAndMergeCurrentSession(serverSession);
    });

    const finalSession = simpleSessionService.getCurrentSession();
    const firstImageMsg = finalSession.messages.find(m => m.content === 'First image');
    const secondImageMsg = finalSession.messages.find(m => m.content === 'Second image');
    
    expect(firstImageMsg.imageData).toBe('base64_image_1');
    expect(secondImageMsg.imageData).toBe('base64_image_2');
    expect(finalSession.messages.length).toBe(4);
  });
});

