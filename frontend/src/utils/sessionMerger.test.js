import { mergeSessionData } from './sessionMerger';

describe('sessionMerger utility', () => {

  // Test Case 1: Initial AI Response (First Image)
  it('should correctly merge data for the first AI response', () => {
    // ARRANGE
    const localSession = {
      id: 'temp-123',
      messages: [{
        id: 'user-temp-1',
        role: 'user',
        content: 'Check this image',
        imageData: 'base64_data_for_image_1'
      }],
      sessionMetadata: { modelUsed: 'auto' }
    };

    const serverSession = {
      id: 'session-real-abc',
      messages: [
        { id: 'user-real-def', role: 'user', content: 'Check this image', imageLink: 'http://storage.link/image_1.jpg' },
        { id: 'ai-1', role: 'assistant', content: 'Here is the feedback.' }
      ],
      sessionMetadata: { totalProcessingTimeMs: 500 }
    };
    
    const modelUsed = 'gemini-pro';

    // ACT
    const mergedSession = mergeSessionData(localSession, serverSession, modelUsed);
    const mergedUserMessage = mergedSession.messages.find(m => m.role === 'user');

    // ASSERT
    // It should preserve the local imageData to prevent the refresh
    expect(mergedUserMessage.imageData).toBe('base64_data_for_image_1');
    // It should have the final imageLink from the server
    expect(mergedUserMessage.imageLink).toBe('http://storage.link/image_1.jpg');
    // It should merge the metadata correctly
    expect(mergedSession.sessionMetadata.modelUsed).toBe('gemini-pro');
    expect(mergedSession.sessionMetadata.totalProcessingTimeMs).toBe(500);
    // It should contain both messages
    expect(mergedSession.messages.length).toBe(2);
  });

  // Test Case 2: Follow-up AI Response (Second Image)
  it('should correctly preserve imageData for ALL user images during a follow-up response', () => {
    // ARRANGE
    const localSession = {
      id: 'session-real-abc',
      messages: [
        { id: 'user-real-def', role: 'user', content: 'Check this image', imageData: 'base64_data_for_image_1', imageLink: 'http://storage.link/image_1.jpg' },
        { id: 'ai-1', role: 'assistant', content: 'Here is the feedback.' },
        { id: 'user-temp-2', role: 'user', content: 'What about this one?', imageData: 'base64_data_for_image_2' }
      ],
      sessionMetadata: { modelUsed: 'gemini-pro', totalProcessingTimeMs: 500 }
    };

    const serverSession = {
      id: 'session-real-abc',
      messages: [
        { id: 'user-real-def', role: 'user', content: 'Check this image', imageLink: 'http://storage.link/image_1.jpg' },
        { id: 'ai-1', role: 'assistant', content: 'Here is the feedback.' },
        { id: 'user-real-ghi', role: 'user', content: 'What about this one?', imageLink: 'http://storage.link/image_2.jpg' },
        { id: 'ai-2', role: 'assistant', content: 'That one is different.' }
      ],
      sessionMetadata: { modelUsed: 'gemini-ultra', totalProcessingTimeMs: 1200 }
    };
    
    const modelUsed = 'gemini-ultra';

    // ACT
    const mergedSession = mergeSessionData(localSession, serverSession, modelUsed);
    const firstUserImage = mergedSession.messages.find(m => m.content === 'Check this image');
    const secondUserImage = mergedSession.messages.find(m => m.content === 'What about this one?');

    // ASSERT
    // It should preserve the imageData for the FIRST image
    expect(firstUserImage.imageData).toBe('base64_data_for_image_1');
    // It should preserve the imageData for the SECOND image
    expect(secondUserImage.imageData).toBe('base64_data_for_image_2');
    // The metadata should be correctly updated
    expect(mergedSession.sessionMetadata.modelUsed).toBe('gemini-ultra');
    expect(mergedSession.sessionMetadata.totalProcessingTimeMs).toBe(1200);
    // It should contain all four messages
    expect(mergedSession.messages.length).toBe(4);
  });

  // Test Case 3: Loading from History
  it('should correctly handle loading a session from history', () => {
    // ARRANGE
    // When loading from history, the "local session" is null
    const localSession = null; 
    
    const serverSession = {
      id: 'session-real-abc',
      messages: [
        { id: 'user-real-def', role: 'user', content: 'Check this image', imageLink: 'http://storage.link/image_1.jpg' },
        { id: 'ai-1', role: 'assistant', content: 'Here is the feedback.' }
      ],
      sessionMetadata: { modelUsed: 'gemini-pro' }
    };

    // ACT
    const mergedSession = mergeSessionData(localSession, serverSession);
    const mergedUserMessage = mergedSession.messages.find(m => m.role === 'user');

    // ASSERT
    // It should NOT have imageData, as it's loaded from history
    expect(mergedUserMessage.imageData).toBeUndefined();
    expect(mergedUserMessage.imageLink).toBe('http://storage.link/image_1.jpg');
    // The metadata should be correct
    expect(mergedSession.sessionMetadata.modelUsed).toBe('gemini-pro');
  });

});
