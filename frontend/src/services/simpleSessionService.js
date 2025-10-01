/**
 * Simple Session Service
 * This is the complete and definitive version of the service class,
 * containing all necessary methods and fixes for data synchronization.
 */
import API_CONFIG from '../config/api';

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

  // All methods are arrow functions to preserve `this` context.
  getAuthToken = async () => {
    try {
      if (getAuthTokenFromContext) {
        const token = await getAuthTokenFromContext();
        if (token) return token;
      }
      return localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
    } catch (error) {
      console.warn('Could not get auth token:', error);
      return null;
    }
  }

  setAuthContext = (authContext) => {
    getAuthTokenFromContext = authContext.getAuthToken;
  }
  
  setState = (updates) => {
    const newState = typeof updates === 'function' ? updates(this.state) : updates;
    this.state = { ...this.state, ...newState };
    this.notifyListeners();
  }

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  notifyListeners = () => { this.listeners.forEach(listener => listener(this.state)); }
  getCurrentSession = () => this.state.currentSession;
  triggerSessionUpdate = (session) => {
    import('../utils/eventManager').then(({ default: EventManager, EVENT_TYPES }) => {
      EventManager.dispatch(EVENT_TYPES.SESSION_UPDATED, { session });
    });
  }
  
  addMessage = async (message) => {
    const session = this.state.currentSession;
    const newMessages = [...(session?.messages || []), message];
    if (!session) {
      this.setState({ currentSession: { id: `temp-${Date.now()}`, title: 'Processing...', messages: newMessages } });
    } else {
      this.setState({ currentSession: { ...session, messages: newMessages } });
    }
  }

  clearSession = () => { this.setState({ currentSession: null }); }
  clearAllSessions = () => { this.setState({ currentSession: null, sidebarSessions: [], error: null }); }
  
  _setAndMergeCurrentSession = (newSessionData, modelUsed = null) => {
    const localSession = this.state.currentSession;
    let mergedSession = { ...newSessionData };

    const localMeta = localSession?.sessionMetadata || {};
    const serverMeta = newSessionData.sessionMetadata || {};
    mergedSession.sessionMetadata = {
        ...localMeta,
        ...serverMeta,
        modelUsed: serverMeta.modelUsed || modelUsed || serverMeta.lastModelUsed || localMeta.modelUsed || 'N/A'
    };

    if (localSession?.messages && mergedSession.messages) {
        const lastOptimisticMsg = [...localSession.messages].reverse()
            .find(m => m.role === 'user' && m.imageData && !m.imageLink);

        if (lastOptimisticMsg) {
            // 👇 FIX: Match the message by content, not ID, as the ID changes.
            const serverMsgToUpdate = [...mergedSession.messages].reverse()
                .find(m => m.role === 'user' && m.content === lastOptimisticMsg.content && m.imageLink);

            if (serverMsgToUpdate) {
                // Restore the local imageData to prevent the image from refreshing.
                serverMsgToUpdate.imageData = lastOptimisticMsg.imageData;
            }
        }
    }

    this.setState({ currentSession: mergedSession });
    this.updateSidebarSession(mergedSession);
    this.triggerSessionUpdate(mergedSession);
  }

  setCurrentSession = (session) => {
    this._setAndMergeCurrentSession(session);
  }

  handleProcessComplete = (data, modelUsed) => {
    if (!data.success || !data.unifiedSession) {
      throw new Error(data.error || 'Failed to process image');
    }
    const newSession = this.convertToUnifiedSession(data.unifiedSession);
    this._setAndMergeCurrentSession(newSession, modelUsed);
    return newSession;
  }
  
  updateSessionState = (newSessionFromServer, modelUsed = null) => {
      this._setAndMergeCurrentSession(newSessionFromServer, modelUsed);
  }

  processImageWithProgress = async (imageData, model = 'auto', mode = 'marking', customText = null, onProgress = null) => {
    try {
      const authToken = await this.getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      
      const sessionId = this.state.currentSession?.id?.startsWith('temp-') ? null : this.state.currentSession?.id;

      const requestBody = {
        imageData,
        model,
        sessionId: sessionId,
        userMessage: { 
            content: customText || 'I have a question about this image.', 
            imageData: imageData,
            sessionId: sessionId
        }
      };
      
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/mark-homework/process-single-stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'complete') return this.handleProcessComplete(data.result, model);
              if (data.type === 'error') throw new Error(data.error);
              if (onProgress) onProgress(data);
            } catch (e) {}
          }
        }
      }
    } catch (error) {
      this.setState({ error: error.message });
      throw error;
    }
  }
  
  convertToUnifiedSession = (sessionData) => { 
    if (!sessionData) return null;
    const sessionMetadata = sessionData.sessionMetadata || {};
    if (sessionMetadata.lastModelUsed && !sessionMetadata.modelUsed) {
        sessionMetadata.modelUsed = sessionMetadata.lastModelUsed;
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
        sessionMetadata: sessionMetadata,
    };
  }
  
  updateSidebarSession = (session) => { 
    if (!session) return;
    const lightweightSession = {
      id: session.id,
      title: session.title,
      messageType: session.messageType,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      favorite: session.favorite,
      rating: session.rating,
      lastMessage: session.messages?.slice().reverse().find(m => m.content && !m.isProcessing) || null
    };
    this.setState(prevState => {
      const existingIndex = prevState.sidebarSessions.findIndex(s => s.id === session.id);
      let newSessions;
      if(existingIndex > -1) {
          newSessions = [...prevState.sidebarSessions];
          newSessions[existingIndex] = lightweightSession;
      } else {
          newSessions = [lightweightSession, ...prevState.sidebarSessions];
      }
      return { sidebarSessions: newSessions.slice(0, this.MAX_SIDEBAR_SESSIONS) };
    });
  }
  
  updateSession = async (sessionId, updates) => { 
    try {
      const token = await this.getAuthToken();
      if (!token) throw new Error('Authentication required');
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
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Failed to update session:', error);
      throw error;
    }
  }
}

export const simpleSessionService = new SimpleSessionService();

if (typeof window !== 'undefined') {
  window.simpleSessionService = simpleSessionService;
}

export default simpleSessionService;

