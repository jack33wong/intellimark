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
      sidebarSessions: [],
      isLoading: false,
      error: null
    };
    
    this.listeners = new Set();
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
    this.notifyListeners();
  }

  notifyListeners() {
    this.listeners.forEach(listener => listener(this.state));
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState() {
    return { ...this.state };
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
    if (!this.state.currentSession) {
      // Create a session if none exists
      await this.createSession();
    }

    const updatedSession = {
      ...this.state.currentSession,
      messages: [...this.state.currentSession.messages, message],
      updatedAt: new Date().toISOString()
    };

    this.setState({ currentSession: updatedSession });
    this.updateSidebarSession(updatedSession);
  }

  // ============================================================================
  // TWO-PHASE PROCESSING
  // ============================================================================

  async processImage(imageData, model = 'auto', mode = 'marking') {
    
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
      
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      // Prepare request body - only include model if it's not 'auto'
      const requestBody = {
        imageData,
        userId: this.state.currentSession?.userId,
        sessionId: this.state.currentSession?.id // Pass current session ID for follow-up uploads
      };
      
      // Only include model if it's not 'auto' (let backend use default)
      if (model && model !== 'auto') {
        requestBody.model = model;
      }
      
      // ========================================
      // PHASE 1: Upload & Classification
      // ========================================
      
      const phase1Response = await fetch(`${API_CONFIG.BASE_URL}/api/mark-homework/upload`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!phase1Response.ok) {
        const errorText = await phase1Response.text();
        console.error('Phase 1: Error response:', errorText);
        const error = new Error(`Failed to process image: ${phase1Response.status} - ${errorText}`);
        error.statusCode = phase1Response.status;
        error.responseText = errorText;
        throw error;
      }

      const phase1Data = await phase1Response.json();
      
      if (!phase1Data.success) {
        throw new Error(phase1Data.error || 'Failed to process image');
      }

      if (!phase1Data.unifiedSession) {
        throw new Error('Backend did not return unifiedSession data');
      }

      const phase1Session = this.convertToUnifiedSession(phase1Data.unifiedSession);
      
      // ========================================
      // PHASE 2: AI Processing & Marking
      // ========================================
      
      // AI thinking animation shows (handled by isProcessing state)
      let finalSession = phase1Session;
      if (phase1Session.id) {
          // Backend processes image and creates session
          // Backend generates marking instructions
          // Creates annotated image
          // AI response appears in chat
          
          // Add timeout to prevent hanging
          const controller2 = new AbortController();
          const timeoutId2 = setTimeout(() => controller2.abort(), 30000); // 30 second timeout
          
          // Get user message from Phase 1 session
          const userMessage = phase1Session.messages.find(msg => msg.role === 'user');
          
          const phase2Response = await fetch(`${API_CONFIG.BASE_URL}/api/mark-homework/process`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              imageData,
              model,
              sessionId: phase1Session.id,
              userMessage: userMessage
            }),
            signal: controller2.signal
          });
          
          clearTimeout(timeoutId2);

          if (!phase2Response.ok) {
            const errorText = await phase2Response.text();
            console.error('Phase 2: Error response:', errorText);
            const error = new Error(`Failed to process AI response: ${phase2Response.status} - ${errorText}`);
            error.statusCode = phase2Response.status;
            error.responseText = errorText;
            throw error;
          }

          const phase2Data = await phase2Response.json();
          
          if (!phase2Data.success) {
            throw new Error(phase2Data.error || 'Failed to process AI response');
          }

          if (!phase2Data.unifiedSession) {
            throw new Error('Backend did not return unifiedSession data for AI response');
          }

          const phase2Session = this.convertToUnifiedSession(phase2Data.unifiedSession);
          
          // Both phases return single messages: Phase 1 = user, Phase 2 = AI
          // Get existing messages (includes our local user message for immediate display)
          const existingMessages = this.state.currentSession?.messages || [];
          const phase1Messages = phase1Session.messages || [];
          const phase2Messages = phase2Session.messages || [];
          
          // Debug: Log what we're getting from each phase
          
          // Filter out duplicate user messages from backend (keep local user message)
          const filteredPhase1Messages = phase1Messages.filter(msg => msg.role !== 'user');
          const filteredPhase2Messages = phase2Messages.filter(msg => msg.role !== 'user');
          
          // Combine: existing messages (local user) + filtered backend messages (AI only)
          finalSession = {
            ...phase1Session,
            messages: [...existingMessages, ...filteredPhase1Messages, ...filteredPhase2Messages]
          };
          
        }

      const newSession = finalSession;
      
      // Replace session with complete session from API (contains both user and AI messages)
      
      // Replace session with complete session from API
      const mergedSession = newSession;
      
      
      // ========================================
      // PHASE 3: Complete
      // ========================================
      
      // Update current session with merged data
      // Ready for next interaction, Send button enable, chat input stay bottom
      this.setState({ 
        currentSession: mergedSession,
      });
      this.updateSidebarSession(mergedSession);

      return mergedSession;

    } catch (error) {
      this.setState({ 
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
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
      currentSession: session,
      error: null
    });
    
    // Update sidebar if not already present
    this.updateSidebarSession(session);
  }
}

// Export singleton instance
export const simpleSessionService = new SimpleSessionService();
export default simpleSessionService;
