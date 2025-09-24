/**
 * Simple Session Service
 * 
 * PURPOSE: Single source of truth for session data and API communication
 * REPLACES: Multiple services (sessionService, chatService, apiService)
 * 
 * WHY NOT SIMPLER:
 * - Manages complex session lifecycle (create → update → persist → load)
 * - Handles different API endpoints for different use cases
 * - Coordinates between frontend state and backend persistence
 * - Provides consistent interface for multiple components
 * 
 * USAGE PATTERNS:
 * - useMarkHomework.js:35 (session data retrieval)
 * - markhomeworkpageconsolidated.js:67 (session management)
 * - Sidebar.js:45 (session history)
 * 
 * API INTEGRATION:
 * - /api/mark-homework/process-single (initial uploads - line 263)
 * - /api/mark-homework/process (follow-up messages - line 423)
 * - /api/messages/sessions (session management)
 * 
 * DESIGN PRINCIPLES:
 * - Simple and maintainable
 * - Fail fast error handling
 * - Real implementation (no mocks)
 * - Consistent logic
 * - Single source of truth for session data
 */

import API_CONFIG from '../config/api';

// We'll need to get the auth context from the hook
let getAuthTokenFromContext = null;

class SimpleSessionService {
  constructor() {
    this.state = {
      currentSession: null,
      sidebarSessions: []
    };
    this.MAX_SIDEBAR_SESSIONS = 50;
    this.listeners = new Set();
  }

  // ============================================================================
  // AUTHENTICATION
  // ============================================================================

  async getAuthToken() {
    try {
      // Use the auth context if available
      if (getAuthTokenFromContext) {
        const token = await getAuthTokenFromContext();
        if (token) {
          return token;
        }
      }
      
      // Fallback to localStorage
      const token = localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
      return token;
    } catch (error) {
      console.warn('Could not get auth token:', error);
      return null;
    }
  }

  // Method to set the auth context function
  setAuthContext(authContext) {
    getAuthTokenFromContext = authContext.getAuthToken;
  }

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  setState(updates) {
    if (typeof updates === 'function') {
      // Handle function updates like React's setState
      const newState = updates(this.state);
      this.state = { ...this.state, ...newState };
    } else {
      // Handle object updates
      this.state = { ...this.state, ...updates };
    }
    
    
    this.notifyListeners();
  }

  // Subscription methods
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyListeners() {
    this.listeners.forEach(listener => listener(this.state));
  }

  // Trigger session update event for real-time UI updates
  triggerSessionUpdate(session) {
    // Import EventManager dynamically to avoid circular dependencies
    import('../utils/eventManager').then(({ default: EventManager, EVENT_TYPES }) => {
      EventManager.dispatch(EVENT_TYPES.SESSION_UPDATED, { session });
    }).catch(error => {
      console.warn('Could not dispatch session update event:', error);
    });
  }

  // ============================================================================
  // SESSION MANAGEMENT
  // ============================================================================

  async loadSession(sessionId) {
    this.setState({ isLoading: true, error: null });

    try {
      // Get auth token for authenticated requests
      const authToken = await this.getAuthToken();
      
      const headers = {
        'Content-Type': 'application/json',
      };
      
      // Add auth token if available
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      // Fetch messages for session using new messages API
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/messages/session/${sessionId}`, {
        headers
      });

      if (!response.ok) {
        throw new Error(`Failed to load session: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to load session');
      }

      // FAIL FAST: Check if session data exists
      if (!data.session) {
        console.error('❌ FAIL FAST: Backend did not return session data for loadSession!');
        console.error('❌ Backend response structure:', JSON.stringify(data, null, 2));
        throw new Error('Backend must return session data but got: ' + JSON.stringify(data));
      }

      // Use session data directly from parent-child structure
      const session = this.convertToUnifiedSession(data.session);
      
      // Update current session
      this.setState({ 
        currentSession: session,
        isLoading: false 
      });

      // Update sidebar if not already present
      this.updateSidebarSession(session);

    } catch (error) {
      this.setState({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false 
      });
      throw error;
    }
  }

  // ============================================================================
  // SESSION MANAGEMENT
  // ============================================================================

  async createSession(sessionData = {}) {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const session = {
      id: sessionId,
      title: sessionData.title || 'New Session',
      messages: sessionData.messages || [],
      userId: sessionData.userId || 'anonymous',
      messageType: sessionData.messageType || 'Marking',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      favorite: sessionData.favorite || false,
      rating: sessionData.rating || 0,
      ...sessionData
    };

    this.setState({ currentSession: session });
    this.updateSidebarSession(session);
    
    return session;
  }

  // ============================================================================
  // MESSAGE MANAGEMENT
  // ============================================================================

  async addMessage(message) {
    // For first message, create a minimal session for immediate UI display
    // This follows the existing architecture pattern
    if (!this.state.currentSession) {
      const tempSession = {
        id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        title: 'Processing...',
        messages: [message],
        userId: message.userId || 'anonymous',
        messageType: 'Marking',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        favorite: false,
        rating: 0
      };
      
      this.setState({ currentSession: tempSession });
      // Don't add temporary sessions to sidebar - they will be replaced by real sessions
      return;
    }

    // Add message to current session for immediate UI display
    const updatedSession = {
      ...this.state.currentSession,
      messages: [...(this.state.currentSession.messages || []), message],
      updatedAt: new Date().toISOString()
    };

    this.setState({ currentSession: updatedSession });
    this.updateSidebarSession(updatedSession);
  }

  // ============================================================================
  // TWO-PHASE PROCESSING
  // ============================================================================

  async processImage(imageData, model = 'auto', mode = 'marking', customText = null) {
    this.setState({ error: null });

    try {
      // Get auth token
      const authToken = await this.getAuthToken();
      const headers = {
        'Content-Type': 'application/json',
      };
      
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      // Add timeout to prevent hanging - increased for AI processing
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 60000); // 60 second timeout for AI processing
      
      // Prepare request body - only include model if it's not 'auto'
      const requestBody = {
        imageData,
        userId: this.state.currentSession?.userId,
        debug: localStorage.getItem('debugMode') === 'true', // Pass debug mode from localStorage
        // Only send sessionId for follow-up messages (when we have a real session ID from backend)
        // For first message, let backend create the session
        ...(this.state.currentSession?.id && 
            !this.state.currentSession.id.startsWith('temp-') && { 
          sessionId: this.state.currentSession?.id 
        })
      };
      
      // Only include model if it's not 'auto' (let backend use default)
      if (model && model !== 'auto') {
        requestBody.model = model;
      }

      // For authenticated users, pass user message for database persistence
      if (this.state.currentSession?.userId) {
        const userMessage = {
          content: customText || 'I have a question about this image. Can you help me understand it?',
          // Only send sessionId for follow-up messages (when we have a real session ID from backend)
          ...(this.state.currentSession?.id && 
              !this.state.currentSession.id.startsWith('temp-') && { 
            sessionId: this.state.currentSession?.id 
          }),
          imageData: imageData
        };
        requestBody.userMessage = userMessage;
        
        // Debug logging
        }
      
      // ========================================
      // SINGLE-PHASE: Upload + Classification + AI Processing
      // ========================================
      
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/mark-homework/process-single`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Single-phase: Error response:', errorText);
        const error = new Error(`Failed to process image: ${response.status} - ${errorText}`);
        error.statusCode = response.status;
        error.responseText = errorText;
        throw error;
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to process image');
      }

      if (!data.aiMessage) {
        throw new Error('Backend did not return AI message data');
      }

      // ========================================
      // COMPLETE: Add AI message to chat
      // ========================================
      // Check if this is a follow-up message (has real session ID, not temp)
      const isFollowUp = this.state.currentSession?.id && !this.state.currentSession.id.startsWith('temp-');
      
      if (isFollowUp) {
        // For follow-up messages, append to existing messages
        const existingMessages = this.state.currentSession?.messages || [];
        const updatedMessages = [...existingMessages, data.aiMessage];
        
        const updatedSession = {
          ...this.state.currentSession,
          messages: updatedMessages,
          updatedAt: new Date().toISOString()
        };
        
        // Update state with updated session
        this.setState({ 
          currentSession: updatedSession,
        });
        this.updateSidebarSession(updatedSession);
        
        // Trigger event for real-time updates
        this.triggerSessionUpdate(updatedSession);
        
        return updatedSession;
      } else {
        // For initial messages, preserve existing user messages and add AI response
        const existingMessages = this.state.currentSession?.messages || [];
        const newMessages = [...existingMessages, data.aiMessage];
        
        const newSession = data.unifiedSession ? {
          ...data.unifiedSession,
          messages: newMessages
        } : {
          id: data.sessionId || this.state.currentSession.id,
          title: data.sessionTitle || 'Marking Session',
          userId: this.state.currentSession?.userId || 'anonymous',
          messageType: 'Marking',
          messages: newMessages,
          isPastPaper: false,
          favorite: false,
          rating: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sessionMetadata: {
            totalProcessingTimeMs: 0,
            lastModelUsed: 'unknown',
            lastApiUsed: 'Unknown',
            llmTokens: 0,
            mathpixCalls: 0,
            totalTokens: 0,
            averageConfidence: 0,
            imageSize: 0,
            totalAnnotations: 0
          }
        };
        
        // Update state with new session (now has real session ID and metadata)
        // Force a new object reference to ensure React detects the change
        const newSessionWithRef = { ...newSession, _updatedAt: Date.now() };
        
        this.setState({ 
          currentSession: newSessionWithRef,
        });
        this.updateSidebarSession(newSessionWithRef);
        
        // Trigger event for real-time updates
        this.triggerSessionUpdate(newSessionWithRef);
        
        return newSession;
      }

    } catch (error) {
      console.error('❌ Single-phase processing error:', error);
      
      // Handle specific error types
      if (error.name === 'AbortError') {
        const timeoutError = new Error('Request timed out. The AI processing is taking longer than expected. Please try again.');
        this.setState({ 
          error: timeoutError.message,
        });
        throw timeoutError;
      }
      
      this.setState({ 
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Load chat history from database for authenticated users
  async loadChatHistory() {
    try {
      if (!this.state.currentSession?.userId) {
        return null;
      }

      const authToken = await this.getAuthToken();
      const headers = {
        'Content-Type': 'application/json',
      };
      
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/api/sessions`, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        throw new Error(`Failed to load chat history: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success && data.sessions) {
        return data.sessions;
      }

      return [];
    } catch (error) {
      console.error('❌ Failed to load chat history:', error);
      return [];
    }
  }

  // New method: Just get AI response without overwriting session
  async getAIResponse(imageData, model = 'auto') {
    try {
      // Get auth token
      const authToken = await this.getAuthToken();
      
      const headers = {
        'Content-Type': 'application/json',
      };
      
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      // Call Phase 2 API to get AI response
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/mark-homework/process`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          imageData,
          model,
          sessionId: this.state.currentSession?.id
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to process AI response: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to process AI response');
      }

      if (!data.unifiedSession) {
        throw new Error('Backend did not return unifiedSession data for AI response');
      }

      const newSession = this.convertToUnifiedSession(data.unifiedSession);
      
      // Return only the AI messages (not the full session)
      return newSession.messages || [];

    } catch (error) {
      console.error('❌ SimpleSessionService.getAIResponse error:', error);
      throw error;
    }
  }

  // ============================================================================
  // CONVERSION UTILITIES
  // ============================================================================

  convertToUnifiedSession(sessionData) {
    // FAIL FAST: sessionData must be defined
    if (!sessionData) {
      console.error('❌ FAIL FAST: sessionData is undefined in convertToUnifiedSession!');
      console.error('❌ Received sessionData:', sessionData);
      throw new Error('sessionData is required but was undefined');
    }

    // FAIL FAST: sessionData must have required fields
    if (!sessionData.id) {
      console.error('❌ FAIL FAST: sessionData.id is missing!');
      console.error('❌ sessionData structure:', JSON.stringify(sessionData, null, 2));
      throw new Error('sessionData.id is required but was missing');
    }

    return {
      id: sessionData.id,
      title: sessionData.title || 'Untitled Session',
      messages: sessionData.messages || [],
      userId: sessionData.userId || 'anonymous',
      messageType: sessionData.messageType || 'Chat',
      createdAt: sessionData.createdAt || new Date().toISOString(),
      updatedAt: sessionData.updatedAt || new Date().toISOString(),
      favorite: sessionData.favorite || false,
      rating: sessionData.rating || 0,
      isPastPaper: sessionData.isPastPaper,
      contextSummary: sessionData.contextSummary,
      lastSummaryUpdate: sessionData.lastSummaryUpdate,
      sessionMetadata: sessionData.sessionMetadata
    };
  }

  updateSidebarSession(session) {
    // Only add sessions to sidebar for authenticated users
    // Unauthenticated users should have empty sidebar (no persistence)
    if (session.userId === 'anonymous') {
      return;
    }

    const lightweightSession = {
      id: session.id,
      title: session.title,
      messageType: session.messageType,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      favorite: session.favorite,
      rating: session.rating,
      lastMessage: session.messages && session.messages.length > 0 
        ? session.messages[session.messages.length - 1] 
        : null
    };

    this.setState(prevState => {
      const existingIndex = prevState.sidebarSessions.findIndex(s => s.id === session.id);
      let newSidebarSessions;
      
      if (existingIndex >= 0) {
        // Update existing session
        newSidebarSessions = [...prevState.sidebarSessions];
        newSidebarSessions[existingIndex] = lightweightSession;
      } else {
        // Add new session at the beginning
        newSidebarSessions = [lightweightSession, ...prevState.sidebarSessions];
        
        // Keep only the most recent sessions
        if (newSidebarSessions.length > this.MAX_SIDEBAR_SESSIONS) {
          newSidebarSessions = newSidebarSessions.slice(0, this.MAX_SIDEBAR_SESSIONS);
        }
      }
      
      return { sidebarSessions: newSidebarSessions };
    });
  }

  // Clear current session
  clearSession() {
    this.setState({ 
      currentSession: null,
      error: null
    });
  }

  // Clear all sessions (for logout)
  clearAllSessions() {
    this.setState({ 
      currentSession: null,
      sidebarSessions: [],
      error: null
    });
  }

  // Set current session (for loading selected sessions)
  setCurrentSession(session) {
    this.setState({ 
      currentSession: session
    });
    
    // Update sidebar if not already present
    this.updateSidebarSession(session);
  }

  // ============================================================================
  // SESSION UPDATES (PERSISTENCE)
  // ============================================================================

  /**
   * Update session metadata in backend (favorite, rating, title, etc.)
   * @param {string} sessionId - The session ID to update
   * @param {object} updates - The updates to apply
   */
  async updateSession(sessionId, updates) {
    try {
      const token = await this.getAuthToken();
      if (!token) {
        throw new Error('Authentication required to update session');
      }

      const response = await fetch(`${API_CONFIG.BASE_URL}/api/messages/session/${sessionId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updates)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('❌ Failed to update session:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const simpleSessionService = new SimpleSessionService();

// Expose to window for debugging
if (typeof window !== 'undefined') {
  window.simpleSessionService = simpleSessionService;
}

export default simpleSessionService;
