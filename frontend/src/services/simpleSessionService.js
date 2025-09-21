/**
 * Simple Session Service
 * 
 * Handles two-phase processing with simple state management
 * - Phase 1: Upload and show user message immediately
 * - Phase 2: AI processing in background
 * 
 * Design Principles:
 * - Simple and maintainable
 * - Fail fast error handling
 * - Real implementation (no mocks)
 * - Consistent logic
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
    this.state = { ...this.state, ...updates };
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
    // Don't create local sessions - let backend handle session creation
    // This prevents the retry problem where frontend creates temporary sessions
    // that don't exist in the backend database
    
    if (!this.state.currentSession) {
      // For first message, create minimal local session for UI display only
      // Backend will create the real session and return the actual sessionId
      const tempSession = {
        id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        title: 'Processing...',
        messages: [],
        userId: message.userId || 'anonymous',
        messageType: 'Marking',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        favorite: false,
        rating: 0
      };
      
      this.setState({ currentSession: tempSession });
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

  async processImage(imageData, model = 'auto', mode = 'marking') {
    console.log(`🔍 [${new Date().toISOString()}] Starting single-phase image processing with model: ${model}, mode: ${mode}`);
    
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
        console.log('⏰ Request timeout after 60 seconds');
        controller.abort();
      }, 60000); // 60 second timeout for AI processing
      
      // Prepare request body - only include model if it's not 'auto'
      const requestBody = {
        imageData,
        userId: this.state.currentSession?.userId,
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
          content: 'I have a question about this image. Can you help me understand it?',
          // Only send sessionId for follow-up messages (when we have a real session ID from backend)
          ...(this.state.currentSession?.id && 
              !this.state.currentSession.id.startsWith('temp-') && { 
            sessionId: this.state.currentSession?.id 
          }),
          imageData: imageData
        };
        requestBody.userMessage = userMessage;
        
        // Debug logging
        console.log(`🔍 [FRONTEND] Current session ID: ${this.state.currentSession?.id}`);
        console.log(`🔍 [FRONTEND] Is temp session: ${this.state.currentSession?.id?.startsWith('temp-')}`);
        console.log(`🔍 [FRONTEND] Sending sessionId: ${userMessage.sessionId || 'none'}`);
      }
      
      // ========================================
      // SINGLE-PHASE: Upload + Classification + AI Processing
      // ========================================
      console.log(`🚀 [${new Date().toISOString()}] Single-phase: Processing image...`);
      
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
      console.log(`🎉 [${new Date().toISOString()}] Single-phase processing complete!`);

      // Get existing messages (includes our local user message for immediate display)
      const existingMessages = this.state.currentSession?.messages || [];
      
      // Add the AI message from the response
      const aiMessage = data.aiMessage;
      
      // Check if this is a follow-up message (has real session ID, not temp)
      const isFollowUp = this.state.currentSession?.id && !this.state.currentSession.id.startsWith('temp-');
      
      if (isFollowUp) {
        // For follow-up messages, append to existing messages
        console.log(`🔄 [${new Date().toISOString()}] Adding follow-up AI message to existing session`);
        const updatedMessages = [...existingMessages, aiMessage];
        
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
        
        return updatedSession;
      } else {
        // For initial messages, use the real session ID returned by backend
        console.log(`🆕 [${new Date().toISOString()}] Creating new session with AI message`);
        console.log(`🔍 [FRONTEND] Backend returned sessionId: ${data.sessionId}`);
        console.log(`🔍 [FRONTEND] Current session ID before update: ${this.state.currentSession?.id}`);
        
        const newSession = {
          ...this.state.currentSession,
          id: data.sessionId || this.state.currentSession.id, // Use real session ID from backend
          messages: [...existingMessages, aiMessage],
          updatedAt: new Date().toISOString()
        };
        
        console.log(`🔍 [FRONTEND] New session ID after update: ${newSession.id}`);
        
        // Update state with new session (now has real session ID)
        this.setState({ 
          currentSession: newSession,
        });
        this.updateSidebarSession(newSession);
        
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
        console.log('No authenticated user, skipping chat history load');
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
        console.log(`✅ Loaded ${data.sessions.length} chat sessions from database`);
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

  // Set current session (for loading selected sessions)
  setCurrentSession(session) {
    this.setState({ 
      currentSession: session
    });
    
    // Update sidebar if not already present
    this.updateSidebarSession(session);
  }
}

// Export singleton instance
export const simpleSessionService = new SimpleSessionService();
export default simpleSessionService;
