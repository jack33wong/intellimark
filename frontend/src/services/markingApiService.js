/**
 * Simple Session Service
 * This is the definitive version with the correct asynchronous state handling.
 */
import API_CONFIG from '../config/api';
import apiClient from './apiClient';

let getAuthTokenFromContext = null;
// A placeholder for the API controls from the useApiProcessor hook.
let apiControls = {
  stopAIThinking: () => console.warn('stopAIThinking not yet initialized'),
  stopProcessing: () => console.warn('stopProcessing not yet initialized'),
  handleError: (err) => console.error("Service error handler not initialized", err),
};

class SimpleSessionService {
  constructor() {
    this.state = {
      currentSession: null,
      sidebarSessions: []
    };
    this.MAX_SIDEBAR_SESSIONS = 50;
    this.listeners = new Set();
    this.processingSessions = new Set(); // Track sessions being processed
  }

  // A method to receive the state controls from the context.
  setApiControls = (controls) => {
    apiControls = controls;
  }

  setAuthContext = (authContext) => {
    getAuthTokenFromContext = authContext.getAuthToken;
  }

  getAuthToken = async () => {
    try {
      if (getAuthTokenFromContext) {
        // ALWAYS get fresh token from Firebase Auth Context
        const token = await getAuthTokenFromContext();
        if (token) return token;
      }
      // Fallback only if context is not available (not recommended)
      return null;
    } catch (error) {
      console.warn('Could not get auth token:', error);
      return null;
    }
  }

  setState = (updates) => {
    const newState = typeof updates === 'function' ? updates(this.state) : updates;
    this.state = { ...this.state, ...newState };
    this.notifyListeners();
  }

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  notifyListeners = () => {
    this.listeners.forEach(listener => listener(this.state));
  }
  getCurrentSession = () => this.state.currentSession;
  triggerSessionUpdate = (session) => {
    import('../utils/eventManager').then(({ default: EventManager, EVENT_TYPES }) => {
      EventManager.dispatch(EVENT_TYPES.SESSION_UPDATED, { session });
    });
  }

  triggerCreditRefresh = () => {
    import('../utils/eventManager').then(({ default: EventManager, EVENT_TYPES }) => {
      EventManager.dispatch(EVENT_TYPES.REFRESH_CREDITS);
    });
  }

  addMessage = async (message) => {
    const session = this.state.currentSession;

    // Check if a message with the same ID already exists (for processing messages)
    const existingMessages = session?.messages || [];
    const existingIndex = existingMessages.findIndex(msg => msg.id === message.id);

    let newMessages;
    if (existingIndex >= 0) {
      // Replace existing message (processing message -> final message)
      newMessages = [...existingMessages];
      newMessages[existingIndex] = message;
    } else {
      // Add new message
      newMessages = [...existingMessages, message];
    }

    if (!session) {
      this.setState({ currentSession: { id: `temp-${Date.now()}`, title: 'Processing...', messages: newMessages, sessionStats: {} } });
    } else {
      this.setState({ currentSession: { ...session, messages: newMessages } });
    }
  }

  clearSession = () => { this.setState({ currentSession: null }); }
  clearAllSessions = () => { this.setState({ currentSession: null, sidebarSessions: [], error: null }); }

  _setAndMergeCurrentSession = (newSessionData, modelUsed = null) => {
    const localSession = this.state.currentSession;

    // Prevent processing the same session multiple times
    if (localSession?.id === newSessionData.id && localSession?.updatedAt === newSessionData.updatedAt) {
      return;
    }

    let mergedSession = { ...localSession, ...newSessionData };
    mergedSession.title = newSessionData.title || localSession?.title || 'Chat Session';

    const localMeta = localSession?.sessionStats || {};
    const serverMeta = newSessionData.sessionStats || {};
    mergedSession.sessionStats = {
      ...localMeta,
      ...serverMeta, // This should preserve totalCost and costBreakdown from server
      lastModelUsed: serverMeta.lastModelUsed || modelUsed || serverMeta.lastModelUsed || localMeta.lastModelUsed || 'N/A',
      // Explicitly preserve cost data from server (in case it gets overwritten)
      totalCost: serverMeta.totalCost !== undefined ? serverMeta.totalCost : localMeta.totalCost,
      costBreakdown: serverMeta.costBreakdown || localMeta.costBreakdown
    };

    // 👇 SIMPLIFIED: Use server messages directly since we now have stable IDs
    // With content-based IDs, server messages should be stable and we don't need complex merging
    if (newSessionData.messages && Array.isArray(newSessionData.messages)) {
      // Smart deduplication: Allow duplicate user messages, prevent duplicate AI responses
      const seenIds = new Set();
      const filteredMessages = newSessionData.messages.filter(msg => {
        // Always allow user messages (they might legitimately send duplicates)
        if (msg.role === 'user') {
          return true;
        }

        // For AI messages, check for duplicates
        if (seenIds.has(msg.id)) {
          return false;
        }
        seenIds.add(msg.id);
        return true;
      });

      // FIXED: Sort messages by timestamp to ensure correct order
      mergedSession.messages = filteredMessages.sort((a, b) => {
        const timestampA = new Date(a.timestamp || a.createdAt || 0).getTime();
        const timestampB = new Date(b.timestamp || b.createdAt || 0).getTime();
        return timestampA - timestampB; // Ascending order (oldest first)
      });
    } else if (localSession?.messages) {
      // Fallback to local messages if server doesn't provide messages
      mergedSession.messages = localSession.messages;
    } else {
      mergedSession.messages = [];
    }

    // 👇 FIX: Only merge local image data if we are staying within the same session.
    // This prevents stale images from Session A leaking into Session B if they share message content.
    if (localSession?.id === newSessionData.id && localSession?.messages && mergedSession.messages) {
      const localImageContentMap = new Map();
      const localImageArrayContentMap = new Map();

      localSession.messages.forEach(msg => {
        if (msg.role === 'user') {
          if (msg.imageData) {
            localImageContentMap.set(msg.content, msg.imageData);
          }
          if (msg.imageDataArray) {
            localImageArrayContentMap.set(msg.content, msg.imageDataArray);
          }
        }
      });

      if (localImageContentMap.size > 0 || localImageArrayContentMap.size > 0) {
        mergedSession.messages = mergedSession.messages.map(serverMessage => {
          if (serverMessage.role === 'user') {
            const updatedMessage = { ...serverMessage };

            if (localImageContentMap.has(serverMessage.content)) {
              updatedMessage.imageData = localImageContentMap.get(serverMessage.content);
            }

            if (localImageArrayContentMap.has(serverMessage.content)) {
              updatedMessage.imageDataArray = localImageArrayContentMap.get(serverMessage.content);
            }

            return updatedMessage;
          }
          // Return the original message object to preserve React component state
          return serverMessage;
        });
      }
    }

    this.setState({ currentSession: mergedSession });
    this.updateSidebarSession(mergedSession);
    this.triggerSessionUpdate(mergedSession);
  }

  setCurrentSession = (session) => {
    this._setAndMergeCurrentSession(session);
  }

  // Update only the current session without affecting sidebar (for unauthenticated users)
  updateCurrentSessionOnly = (session) => {
    this.setState({ currentSession: session });
  }

  // Simple method to update just a message in the current session
  updateMessageInCurrentSession = (messageId, updates) => {
    const currentSession = this.state.currentSession;
    if (!currentSession?.messages) return;

    const updatedMessages = currentSession.messages.map(msg =>
      msg.id === messageId ? { ...msg, ...updates } : msg
    );

    const updatedSession = {
      ...currentSession,
      messages: updatedMessages
    };

    this.setState({ currentSession: updatedSession });
  }

  handleProcessComplete = (data, modelUsed, aiMessageId = null) => {
    try {
      // Trigger credit refresh after completion
      this.triggerCreditRefresh();

      // Check for success flag (if present) or assume success if not present
      if (data.success === false) {
        throw new Error(data.error || 'Failed to process image');
      }

      // Handle unifiedSession data (for both authenticated and unauthenticated users)
      if (data.unifiedSession) {
        // Extract the AI message from unifiedSession and add it directly
        const aiMessage = data.unifiedSession.messages?.find(msg => msg.role === 'assistant');
        if (aiMessage) {
          this.addMessage(aiMessage);
        }

        // Update session title and sidebar (only for authenticated users)
        if (data.unifiedSession.title && this.state.currentSession) {
          const updatedSession = {
            ...this.state.currentSession,
            title: data.unifiedSession.title,
            id: data.unifiedSession.id,
            sessionStats: data.unifiedSession.sessionStats || this.state.currentSession.sessionStats,
            updatedAt: data.unifiedSession.updatedAt || new Date().toISOString()
          };

          this.updateCurrentSessionOnly(updatedSession);

          // Update sidebar with the new session (only for authenticated users)
          if (data.unifiedSession.userId) {
            this.updateSidebarSession(updatedSession);
          }
        }

        return this.state.currentSession;
      }

      // Handle new multi-image/PDF response structure
      if (data.annotatedOutput && data.processingStats) {

        // Create AI message with the same structure as original pipeline
        const aiMessage = {
          id: aiMessageId || `ai-${Date.now()}`,
          role: 'assistant',
          content: 'Marking completed - see suggested follow-ups below',
          timestamp: new Date().toISOString(),
          type: 'marking_annotated',
          isProcessing: false,
          // Store the annotated images array
          imageDataArray: Array.isArray(data.annotatedOutput) ? data.annotatedOutput : [data.annotatedOutput],
          // resultsByQuestion removed - using processingStats instead
          // Use detectedQuestion data from backend (not from resultsByQuestion)
          detectedQuestion: data.detectedQuestion || {
            found: false,
            questionText: '',
            questionNumber: '',
            subQuestionNumber: '',
            examBoard: '',
            examCode: '',
            paperTitle: '',
            subject: '',
            tier: '',
            year: '',
            marks: 0,
            markingScheme: ''
          },
          // Add suggested follow-ups
          suggestedFollowUps: [
            'Provide model answer according to the marking scheme.',
            'Show marking scheme.',
            'Similar practice questions.'
          ],
          // Store processing metadata from backend (message-specific stats only)
          processingStats: {
            apiUsed: data.processingStats.apiUsed || 'Google Gemini API',
            modelUsed: data.processingStats.modelUsed || 'gemini-2.5-flash',
            annotations: data.processingStats.totalAnnotations || 0,
            totalMarks: data.processingStats.totalMarks || 0,
            awardedMarks: data.processingStats.awardedMarks || 0,
            questionCount: data.processingStats.questionCount || 1
          },
          // Preserve progress data for thinking text and progress details
          progressData: {
            currentStepDescription: 'Marking completed',
            allSteps: ["Input Validation", "Standardization", "Preprocessing", "OCR & Classification", "Question Detection", "Segmentation", "Marking", "Output Generation"],
            currentStepIndex: 7, // Output Generation (final step)
            isComplete: true
          }
        };

        // Append to current session as an AI message
        this.addMessage(aiMessage);

        // Stop spinners
        apiControls.stopAIThinking();
        apiControls.stopProcessing();
        return this.state.currentSession;
      }

      // Handle PDF output without navigating or causing reloads (legacy single PDF)
      if (data.outputFormat === 'pdf' && data.annotatedOutput) {
        // Create a lightweight assistant message with a file card style hint
        const pdfMessage = {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: 'PDF generated. Click to open.',
          timestamp: new Date().toISOString(),
          type: 'marking_annotated',
          // Pass through a data URL for user-initiated open in UI (avoid window.location assignment)
          pdfDataUrl: typeof data.annotatedOutput === 'string' && data.annotatedOutput.startsWith('data:application/pdf')
            ? data.annotatedOutput
            : `data:application/pdf;base64,${data.annotatedOutput}`,
          originalFileName: 'annotated.pdf',
          isProcessing: false
        };
        // Append to current session as an AI message
        this.addMessage(pdfMessage);
        // Stop spinners
        apiControls.stopAIThinking();
        apiControls.stopProcessing();
        return this.state.currentSession;
      }

      if (data.aiMessage) {
        // Unauthenticated users get only AI message - append to current session
        this.addMessage(data.aiMessage);

        // Update session title and ID in current session (for session header display only)
        // Don't update sidebar for unauthenticated users
        if (data.sessionTitle && this.state.currentSession) {
          // Extract processing stats from AI message for task details
          const processingStats = data.aiMessage?.processingStats || {};
          const existingStats = this.state.currentSession.sessionStats || {};

          // Accumulate token counts (fix bug where they were being reset)
          const accumulatedLlmTokens = (existingStats.totalLlmTokens || 0) + (processingStats.llmTokens || 0);
          const accumulatedMathpixCalls = (existingStats.totalMathpixCalls || 0) + (processingStats.mathpixCalls || 0);

          const sessionStats = {
            ...existingStats,
            lastModelUsed: processingStats.modelUsed || existingStats.lastModelUsed || 'N/A',
            totalProcessingTimeMs: processingStats.processingTimeMs || existingStats.totalProcessingTimeMs || 0,
            lastApiUsed: processingStats.apiUsed || existingStats.lastApiUsed || 'N/A',
            totalLlmTokens: accumulatedLlmTokens,
            totalMathpixCalls: accumulatedMathpixCalls,
            totalTokens: accumulatedLlmTokens + accumulatedMathpixCalls,
            averageConfidence: processingStats.confidence || existingStats.averageConfidence || 0,
            imageSize: processingStats.imageSize || existingStats.imageSize || 0,
            totalAnnotations: processingStats.annotations || existingStats.totalAnnotations || 0,
            // Preserve cost data from database (should not be overwritten by processing stats)
            totalCost: existingStats.totalCost,
            costBreakdown: existingStats.costBreakdown
          };

          // For unauthenticated users: Only update title if it's the first AI response
          // Keep the original title from the first AI response, don't overwrite on follow-ups
          const shouldUpdateTitle = !this.state.currentSession.title ||
            this.state.currentSession.title === 'Processing...' ||
            this.state.currentSession.title === 'Chat Session';

          const updatedSession = {
            ...this.state.currentSession,
            title: shouldUpdateTitle ? data.sessionTitle : this.state.currentSession.title,
            id: data.sessionId, // Use backend's permanent session ID (no fallback to temp ID)
            sessionStats: sessionStats,
            updatedAt: new Date().toISOString() // Add last updated time
          };
          this.updateCurrentSessionOnly(updatedSession);
        }

        return this.state.currentSession;
      } else {
        throw new Error('No AI message received from server');
      }
    } finally {
      apiControls.stopAIThinking();
      apiControls.stopProcessing();
    }
  }

  handleTextChatComplete = (data, modelUsed) => {
    try {
      // Trigger credit refresh after completion
      this.triggerCreditRefresh();
      if (!data.success) {
        throw new Error(data.error || 'Failed to process text chat');
      }

      if (data.aiMessage) {
        // All users (authenticated and unauthenticated) now get only AI message - append to current session
        this.addMessage(data.aiMessage);

        // Update session title and ID in current session (for session header display only)
        // Don't update sidebar for unauthenticated users
        if (data.sessionTitle && this.state.currentSession) {
          // Extract processing stats from AI message for task details
          const processingStats = data.aiMessage?.processingStats || {};
          const existingStats = this.state.currentSession.sessionStats || {};

          // Accumulate token counts (fix bug where they were being reset)
          const accumulatedLlmTokens = (existingStats.totalLlmTokens || 0) + (processingStats.llmTokens || 0);
          const accumulatedMathpixCalls = (existingStats.totalMathpixCalls || 0) + (processingStats.mathpixCalls || 0);

          const sessionStats = {
            ...existingStats,
            lastModelUsed: processingStats.modelUsed || existingStats.lastModelUsed || 'N/A',
            totalProcessingTimeMs: processingStats.processingTimeMs || existingStats.totalProcessingTimeMs || 0,
            lastApiUsed: processingStats.apiUsed || existingStats.lastApiUsed || 'N/A',
            totalLlmTokens: accumulatedLlmTokens,
            totalMathpixCalls: accumulatedMathpixCalls,
            totalTokens: accumulatedLlmTokens + accumulatedMathpixCalls,
            averageConfidence: processingStats.confidence || existingStats.averageConfidence || 0,
            imageSize: processingStats.imageSize || existingStats.imageSize || 0,
            totalAnnotations: processingStats.annotations || existingStats.totalAnnotations || 0,
            // Preserve cost data from database (should not be overwritten by processing stats)
            totalCost: existingStats.totalCost,
            costBreakdown: existingStats.costBreakdown
          };

          // For unauthenticated users: Only update title if it's the first AI response
          // Keep the original title from the first AI response, don't overwrite on follow-ups
          const shouldUpdateTitle = !this.state.currentSession.title ||
            this.state.currentSession.title === 'Processing...' ||
            this.state.currentSession.title === 'Chat Session';

          const updatedSession = {
            ...this.state.currentSession,
            title: shouldUpdateTitle ? data.sessionTitle : this.state.currentSession.title,
            id: data.sessionId, // Use backend's permanent session ID (no fallback to temp ID)
            sessionStats: sessionStats,
            updatedAt: new Date().toISOString() // Add last updated time
          };
          this.updateCurrentSessionOnly(updatedSession);

          // FIX: Also update sidebar so changes (like "Model Answers Generated" preview) show immediately
          if (data.sessionId && !data.sessionId.startsWith('temp-')) {
            this.updateSidebarSession(updatedSession);
          }
        }

        return this.state.currentSession;
      } else {
        throw new Error('No AI message received from server');
      }
    } finally {
      apiControls.stopAIThinking();
      apiControls.stopProcessing();
    }
  }

  updateSessionState = (newSessionFromServer, modelUsed = null) => {
    const sessionId = newSessionFromServer.id;

    // Prevent duplicate processing using a simple flag
    if (this.processingSessions.has(sessionId)) {
      return;
    }

    // Mark as processing
    this.processingSessions.add(sessionId);

    try {
      this._setAndMergeCurrentSession(newSessionFromServer, modelUsed);
      // Stop AI thinking when session is updated with new messages
      apiControls.stopAIThinking();
    } finally {
      // Remove from processing set after a short delay
      setTimeout(() => {
        this.processingSessions.delete(sessionId);
      }, 1000);
    }
  }

  async processStream(endpoint, paper, model = 'gemini-2.0-flash', onProgress = null, aiMessageId = null) {
    try {
      const authToken = await this.getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const response = await fetch(`${API_CONFIG.BASE_URL}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          paper,
          model,
          sessionId: this.state.currentSession?.id || null,
          aiMessageId
        })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      try {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const processChunk = (chunk) => {
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              let data;
              try {
                data = JSON.parse(line.slice(6));
              } catch (e) {
                continue;
              }

              if (data && data.currentStepDescription) {
                if (onProgress) onProgress(data);
                continue;
              }

              if (data.type === 'complete') {
                this.handleTextChatComplete(data.result, model);
                return true; // Stop processing
              }

              if (data.type === 'error') {
                throw new Error(data.error || 'Unknown error from server');
              }

              if (onProgress) onProgress(data);
            }
          }
          return false;
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (buffer) processChunk(buffer);
              break;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (processChunk(line)) {
                reader.releaseLock();
                return; // Exit success
              }
            }
          }
        } finally {
          if (reader.locked) reader.releaseLock();
        }
      } finally {
        // Ensure thinking state is stopped even if we return early from processChunk
        apiControls.stopAIThinking();
        apiControls.stopProcessing();
      }
    } catch (error) {
      this.setState({ error: error.message });
      apiControls.handleError(error);
      apiControls.stopAIThinking();
      apiControls.stopProcessing();
      throw error;
    }
  }

  async processMultiImageWithProgress(files, model = 'gemini-2.0-flash', mode = 'marking', customText = null, onProgress = null, aiMessageId = null) {
    try {
      const authToken = await this.getAuthToken();
      const headers = {};
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      // Create FormData for multipart/form-data upload with multiple files
      const formData = new FormData();

      // Add all files to the FormData under the 'files' key
      files.forEach((file, index) => {
        formData.append('files', file);
      });

      // Add other form data
      formData.append('model', model);
      if (aiMessageId) formData.append('aiMessageId', aiMessageId);
      if (customText) formData.append('customText', customText);


      const response = await fetch(`${API_CONFIG.BASE_URL}/api/marking/process`, {
        method: 'POST',
        headers,
        body: formData
      });


      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processChunk = (chunk) => {
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            let data;
            try {
              const rawData = line.slice(6);
              data = JSON.parse(rawData);
            } catch (e) {
              continue;
            }

            // Handle ProgressData format (unified format for all pipelines)
            if (data && data.currentStepDescription && data.allSteps && typeof data.currentStepIndex === 'number') {
              if (onProgress) onProgress(data);
              continue; // Next line
            }

            // Handle completion events
            if (data.type === 'complete') {
              this.handleProcessComplete(data.result, model, aiMessageId);
              return true;
            }
            if (data.type === 'error') {
              const error = new Error(data.error);
              if (data.credits_exhausted) {
                error.credits_exhausted = true;
              }
              throw error;
            }

            // Fallback: pass any other data to onProgress
            if (onProgress) onProgress(data);
          }
        }
        return false;
      };


      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer) processChunk(buffer);
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (processChunk(line)) {
              // Explicitly close the reader when processing is complete
              reader.releaseLock();
              return;
            }
          }
        }
      } finally {
        // Ensure reader is always released
        if (reader.locked) {
          reader.releaseLock();
        }
      }
    } catch (error) {
      if (error.response?.data?.credits_exhausted) {
        error.credits_exhausted = true;
      }
      console.error('❌ Multi-image processing error:', error);
      throw error;
    }
  }

  async processImageWithProgress(imageData, model = 'gemini-2.0-flash', mode = 'marking', customText = null, onProgress = null, aiMessageId = null, originalFileName = null) {
    try {
      const authToken = await this.getAuthToken();
      const headers = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const sessionId = this.state.currentSession?.id?.startsWith('temp-') ? null : this.state.currentSession?.id;

      // Convert base64 data URL (image/pdf) to Blob for multipart/form-data upload
      const dataUrlParts = imageData.split(',');
      const hasDataUrlPrefix = imageData.startsWith('data:') && dataUrlParts.length === 2;
      const base64Data = hasDataUrlPrefix ? dataUrlParts[1] : imageData; // Use raw if no prefix
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);

      // Determine mimetype and filename from originalFileName or data URL
      let mimeType = 'image/jpeg';
      let fileName = originalFileName || 'upload.jpg';
      const lowerName = (originalFileName || '').toLowerCase();

      // Prefer explicit PDF
      if (lowerName.endsWith('.pdf') || imageData.includes('data:application/pdf')) {
        mimeType = 'application/pdf';
        fileName = originalFileName || 'document.pdf';
      } else if (imageData.includes('data:image/png') || lowerName.endsWith('.png')) {
        mimeType = 'image/png';
        fileName = originalFileName || 'image.png';
      } else if (imageData.includes('data:image/webp') || lowerName.endsWith('.webp')) {
        mimeType = 'image/webp';
        fileName = originalFileName || 'image.webp';
      } else if (imageData.includes('data:image/gif') || lowerName.endsWith('.gif')) {
        mimeType = 'image/gif';
        fileName = originalFileName || 'image.gif';
      } else if (imageData.includes('data:image/jpeg') || imageData.includes('data:image/jpg') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
        mimeType = 'image/jpeg';
        fileName = originalFileName || 'image.jpg';
      }

      const blob = new Blob([byteArray], { type: mimeType });
      const file = new File([blob], fileName, { type: mimeType });

      // Create FormData for multipart/form-data upload
      const formData = new FormData();
      formData.append('files', file);
      formData.append('model', model);
      if (sessionId) formData.append('sessionId', sessionId);
      if (aiMessageId) formData.append('aiMessageId', aiMessageId);
      if (customText) formData.append('customText', customText);

      const response = await fetch(`${API_CONFIG.BASE_URL}/api/marking/process`, {
        method: 'POST',
        headers,
        body: formData
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processChunk = (chunk) => {
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            let data;
            try {
              data = JSON.parse(line.slice(6));
            } catch (e) {
              continue;
            }

            // Handle ProgressData format (unified format for all pipelines)
            if (data && data.currentStepDescription && data.allSteps && typeof data.currentStepIndex === 'number') {
              if (onProgress) onProgress(data);
              continue; // Next line
            }
            if (data.type === 'complete') {
              this.handleProcessComplete(data.result, model, aiMessageId);
              return true;
            }
            if (data.type === 'error') {
              const error = new Error(data.error);
              if (data.credits_exhausted) {
                error.credits_exhausted = true;
              }
              throw error;
            }
            if (onProgress) onProgress(data);
          }
        }
        return false;
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer) processChunk(buffer);
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (processChunk(line)) {
              // Explicitly close the reader when processing is complete
              reader.releaseLock();
              return;
            }
          }
        }
      } finally {
        // Ensure reader is always released
        if (reader.locked) {
          reader.releaseLock();
        }
      }
    } catch (error) {
      if (error.response?.data?.credits_exhausted) {
        error.credits_exhausted = true;
      }
      this.setState({ error: error.message });
      apiControls.handleError(error);
      apiControls.stopAIThinking();
      apiControls.stopProcessing();
      throw error;
    }
  }

  convertToUnifiedSession = (sessionData) => {
    if (!sessionData) return null;

    // Fail fast if old data structure is detected
    if (sessionData.sessionMetadata) {
      console.error('❌ [DATA STRUCTURE ERROR] Old sessionMetadata structure detected in session data');
      console.error('❌ [ERROR DETAILS] sessionData:', sessionData);
      throw new Error('Old sessionMetadata data structure detected. Please clear database and create new sessions.');
    }

    // Check for old metadata structure in messages
    if (sessionData.messages) {
      const messageWithOldMetadata = sessionData.messages.find(msg => msg.metadata);
      if (messageWithOldMetadata) {
        console.error('❌ [DATA STRUCTURE ERROR] Old metadata structure detected in message');
        console.error('❌ [ERROR DETAILS] message:', messageWithOldMetadata);
        throw new Error('Old metadata data structure detected in messages. Please clear database and create new sessions.');
      }

      // Check for old detectedQuestion structure
      const messageWithOldDetectedQuestion = sessionData.messages.find(msg =>
        msg.detectedQuestion && msg.detectedQuestion.message
      );
      if (messageWithOldDetectedQuestion) {
        console.error('❌ [DATA STRUCTURE ERROR] Old detectedQuestion structure detected with "message" field');
        console.error('❌ [ERROR DETAILS] detectedQuestion:', messageWithOldDetectedQuestion.detectedQuestion);
        throw new Error('Old detectedQuestion data structure detected. Please clear database and create new sessions.');
      }
    }

    const sessionStats = sessionData.sessionStats || {};
    return {
      id: sessionData.id,
      title: sessionData.title || 'Untitled Session',
      messages: sessionData.messages || [],
      userId: sessionData.userId || 'anonymous',
      messageType: sessionData.messageType || 'Chat',
      createdAt: sessionData.createdAt || new Date().toISOString(),
      updatedAt: sessionData.updatedAt || new Date().toISOString(),
      favorite: sessionData.favorite || false,
      pinned: sessionData.pinned || false,
      rating: sessionData.rating || 0,
      sessionStats: sessionStats,
    };
  }

  updateSidebarSession = (session) => {
    if (!session) return;
    // Don't add temp sessions to sidebar - they will be replaced by real sessions
    if (session.id && session.id.startsWith('temp-')) return;


    this.setState(prevState => {
      const existingIndex = prevState.sidebarSessions.findIndex(s => s.id === session.id);
      const existingSession = existingIndex > -1 ? prevState.sidebarSessions[existingIndex] : {};

      // Merge new data with existing session data to prevent losing fields like 'title'
      const mergedData = { ...existingSession, ...session };

      const lightweightSession = {
        id: mergedData.id,
        title: mergedData.title,
        messageType: mergedData.messageType,
        createdAt: mergedData.createdAt,
        updatedAt: mergedData.updatedAt || new Date().toISOString(),
        favorite: mergedData.favorite,
        pinned: mergedData.pinned,
        rating: mergedData.rating,
        lastMessage: (mergedData.messages && Array.isArray(mergedData.messages))
          ? (mergedData.messages.slice().reverse().find(m => m.content && !m.isProcessing) || mergedData.lastMessage || null)
          : (mergedData.lastMessage || null)
      };


      let newSessions;
      if (existingIndex > -1) {
        newSessions = [...prevState.sidebarSessions];
        newSessions[existingIndex] = lightweightSession;
      } else {
        newSessions = [lightweightSession, ...prevState.sidebarSessions];
      }
      return { sidebarSessions: newSessions.slice(0, this.MAX_SIDEBAR_SESSIONS) };
    });

    // Trigger event to update Sidebar component
    this.triggerSessionUpdate(session);
  }

  updateSidebarSessionsBatch = (sessions) => {
    if (!sessions || !Array.isArray(sessions)) return;

    this.setState(prevState => {
      const newSidebarSessions = [...prevState.sidebarSessions];

      sessions.forEach(session => {
        if (!session || (session.id && session.id.startsWith('temp-'))) return;

        const existingIndex = newSidebarSessions.findIndex(s => s.id === session.id);
        const existingSession = existingIndex > -1 ? newSidebarSessions[existingIndex] : {};
        const mergedData = { ...existingSession, ...session };

        const lightweightSession = {
          id: mergedData.id,
          title: mergedData.title,
          messageType: mergedData.messageType,
          createdAt: mergedData.createdAt,
          updatedAt: mergedData.updatedAt || new Date().toISOString(),
          favorite: mergedData.favorite,
          pinned: mergedData.pinned,
          rating: mergedData.rating,
          lastMessage: (mergedData.messages && Array.isArray(mergedData.messages))
            ? (mergedData.messages.slice().reverse().find(m => m.content && !m.isProcessing) || mergedData.lastMessage || null)
            : (mergedData.lastMessage || null)
        };

        if (existingIndex > -1) {
          newSidebarSessions[existingIndex] = lightweightSession;
        } else {
          newSidebarSessions.push(lightweightSession);
        }
      });

      // Sort and slice
      const sortedSessions = newSidebarSessions.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }).slice(0, this.MAX_SIDEBAR_SESSIONS);

      return { sidebarSessions: sortedSessions };
    });
  }

  updateSession = async (sessionId, updates) => {
    try {
      const response = await apiClient.put(`/api/messages/session/${sessionId}`, updates);
      return response.data;
    } catch (error) {
      console.error('Failed to update session:', error);
      throw error;
    }
  }

  getSession = async (sessionId) => {
    try {
      const response = await apiClient.get(`/api/messages/session/${sessionId}`);
      return response.data;
    } catch (error) {
      console.error('Failed to get session:', error);
      throw error;
    }
  }
}

export const simpleSessionService = new SimpleSessionService();

if (typeof window !== 'undefined') {
  window.simpleSessionService = simpleSessionService;
}

export default simpleSessionService;

