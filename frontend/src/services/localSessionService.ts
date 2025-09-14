/**
 * Local Session Service - Single Source of Truth for Memory Management
 * 
 * Design Principles:
 * - Only 1 full session in memory at a time
 * - Up to 50 lightweight sessions for sidebar
 * - Direct memory access, no complex sync
 * - Unified data structure throughout
 */

import { 
  UnifiedSession, 
  LightweightSession, 
  UnifiedMessage, 
  SessionManagerState, 
  SessionManagerActions,
  MarkHomeworkRequest,
  MarkHomeworkResponse,
  ChatRequest,
  ChatResponse
} from '../types/unifiedTypes';
import API_CONFIG from '../config/api';

class LocalSessionService implements SessionManagerActions {
  private state: SessionManagerState = {
    currentSession: null,
    sidebarSessions: [],
    isLoading: false,
    isProcessing: false,
    error: null
  };

  private listeners: Set<(state: SessionManagerState) => void> = new Set();
  private readonly MAX_SIDEBAR_SESSIONS = 50;

  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================

  private setState(updates: Partial<SessionManagerState>): void {
    this.state = { ...this.state, ...updates };
    this.notifyListeners();
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.state));
  }

  public subscribe(listener: (state: SessionManagerState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getState(): SessionManagerState {
    return { ...this.state };
  }

  // ============================================================================
  // SESSION MANAGEMENT
  // ============================================================================

  async loadSession(sessionId: string): Promise<void> {
    this.setState({ isLoading: true, error: null });

    try {
      // Fetch messages for session using new messages API
      const response = await fetch(`/api/messages/session/${sessionId}`, {
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to load session: ${response.status}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to load session');
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

  async createSession(sessionData: Partial<UnifiedSession>): Promise<string> {
    this.setState({ isProcessing: true, error: null });

    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: 'New chat session',
          model: 'chatgpt-4o',
          userId: sessionData.userId || 'anonymous',
          mode: sessionData.messageType?.toLowerCase() || 'chat'
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.status}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to create session');
      }

      // Load the created session
      await this.loadSession(data.sessionId);
      
      this.setState({ isProcessing: false });
      return data.sessionId;

    } catch (error) {
      this.setState({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        isProcessing: false 
      });
      throw error;
    }
  }

  async updateSession(sessionId: string, updates: Partial<UnifiedSession>): Promise<void> {
    if (!this.state.currentSession || this.state.currentSession.id !== sessionId) {
      throw new Error('Session not found in memory');
    }

    const updatedSession = { ...this.state.currentSession, ...updates };
    this.setState({ currentSession: updatedSession });
    this.updateSidebarSession(updatedSession);
  }

  async deleteSession(sessionId: string): Promise<void> {
    // Remove from sidebar
    const updatedSidebar = this.state.sidebarSessions.filter(s => s.id !== sessionId);
    this.setState({ sidebarSessions: updatedSidebar });

    // If it's the current session, clear it
    if (this.state.currentSession?.id === sessionId) {
      this.setState({ currentSession: null });
    }
  }

  // ============================================================================
  // MESSAGE MANAGEMENT
  // ============================================================================

  async addMessage(message: UnifiedMessage): Promise<void> {
    if (!this.state.currentSession) {
      throw new Error('No current session');
    }

    const updatedSession = {
      ...this.state.currentSession,
      messages: [...this.state.currentSession.messages, message],
      updatedAt: new Date().toISOString()
    };

    this.setState({ currentSession: updatedSession });
    this.updateSidebarSession(updatedSession);
  }

  async updateMessage(messageId: string, updates: Partial<UnifiedMessage>): Promise<void> {
    if (!this.state.currentSession) {
      throw new Error('No current session');
    }

    const updatedMessages = this.state.currentSession.messages.map(msg =>
      msg.id === messageId ? { ...msg, ...updates } : msg
    );

    const updatedSession = {
      ...this.state.currentSession,
      messages: updatedMessages,
      updatedAt: new Date().toISOString()
    };

    this.setState({ currentSession: updatedSession });
    this.updateSidebarSession(updatedSession);
  }

  // ============================================================================
  // SIDEBAR MANAGEMENT
  // ============================================================================

  async refreshSidebar(): Promise<void> {
    this.setState({ isLoading: true, error: null });

    try {
      // Get user ID from current session or use anonymous
      const userId = this.state.currentSession?.userId || 'anonymous';
      
      // Use new messages API to get sessions
      const response = await fetch(`/api/messages/sessions/${userId}`, {
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to load sessions: ${response.status}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to load sessions');
      }

      // Sessions are already in lightweight format from the messages API
      const lightweightSessions = data.sessions
        .slice(0, this.MAX_SIDEBAR_SESSIONS)
        .map((session: any) => this.convertApiSessionToLightweight(session));

      this.setState({ 
        sidebarSessions: lightweightSessions,
        isLoading: false 
      });

    } catch (error) {
      this.setState({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false 
      });
      throw error;
    }
  }

  async clearAllSessions(): Promise<void> {
    this.setState({ 
      currentSession: null,
      sidebarSessions: []
    });
  }

  // ============================================================================
  // PROCESSING METHODS
  // ============================================================================

  async processImage(imageData: string, model: string, mode: 'marking' | 'question'): Promise<UnifiedSession> {
    this.setState({ isProcessing: true, error: null });

    try {
      const request: MarkHomeworkRequest = {
        imageData,
        model,
        userId: this.state.currentSession?.userId || 'anonymous'
      };

      const response = await fetch(`${API_CONFIG.BASE_URL}/api/mark-homework`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        throw new Error(`Failed to process image: ${response.status}`);
      }

      const data: MarkHomeworkResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to process image');
      }

      // Convert to unified format
      const session = this.convertToUnifiedSession(data.session);
      
      // Update current session
      this.setState({ 
        currentSession: session,
        isProcessing: false 
      });

      // Update sidebar
      this.updateSidebarSession(session);

      return session;

    } catch (error) {
      this.setState({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        isProcessing: false 
      });
      throw error;
    }
  }

  async sendMessage(message: string, imageData?: string): Promise<void> {
    if (!this.state.currentSession) {
      throw new Error('No current session');
    }

    this.setState({ isProcessing: true, error: null });

    try {
      const request: ChatRequest = {
        message,
        model: 'chatgpt-4o',
        imageData,
        sessionId: this.state.currentSession.id,
        userId: this.state.currentSession.userId,
        mode: this.state.currentSession.messageType.toLowerCase() as 'marking' | 'question' | 'chat'
      };

      const response = await fetch(`${API_CONFIG.BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.status}`);
      }

      const data: ChatResponse = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to send message');
      }

      // Convert to unified format
      const session = this.convertToUnifiedSession(data.session);
      
      // Update current session
      this.setState({ 
        currentSession: session,
        isProcessing: false 
      });

      // Update sidebar
      this.updateSidebarSession(session);

    } catch (error) {
      this.setState({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        isProcessing: false 
      });
      throw error;
    }
  }

  // ============================================================================
  // CONVERSION UTILITIES
  // ============================================================================

  private convertToUnifiedSession(sessionData: any): UnifiedSession {
    return {
      id: sessionData.id,
      title: sessionData.title,
      messages: (sessionData.messages || []).map((msg: any) => this.convertToUnifiedMessage(msg)),
      userId: sessionData.userId,
      messageType: sessionData.messageType || 'Chat',
      createdAt: sessionData.createdAt || new Date().toISOString(),
      updatedAt: sessionData.updatedAt || new Date().toISOString(),
      favorite: sessionData.favorite || false,
      rating: sessionData.rating || 0,
      contextSummary: sessionData.contextSummary,
      lastSummaryUpdate: sessionData.lastSummaryUpdate,
      sessionMetadata: sessionData.sessionMetadata
    };
  }

  private convertToUnifiedMessage(messageData: any): UnifiedMessage {
    return {
      id: messageData.id,
      role: messageData.role,
      content: messageData.content,
      timestamp: messageData.timestamp,
      type: messageData.type,
      imageData: messageData.imageData,
      imageLink: messageData.imageLink,
      fileName: messageData.fileName,
      model: messageData.model,
      apiUsed: messageData.apiUsed,
      showRaw: messageData.showRaw || false,
      rawContent: messageData.rawContent || messageData.content,
      isImageContext: messageData.isImageContext || false,
      detectedQuestion: messageData.detectedQuestion,
      markingData: messageData.markingData,
      metadata: messageData.metadata
    };
  }

  private convertMessagesToUnifiedSession(sessionId: string, messages: any[]): UnifiedSession {
    if (messages.length === 0) {
      return {
        id: sessionId,
        title: 'Empty Session',
        messages: [],
        userId: 'anonymous',
        messageType: 'Chat',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        favorite: false,
        rating: 0
      };
    }

    // Convert messages to UnifiedMessage format
    const unifiedMessages = messages.map((msg: any) => this.convertToUnifiedMessage(msg));
    
    // Get session metadata from first message
    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];
    
    // Generate title from first message
    const title = this.generateSessionTitleFromMessage(firstMessage);
    
    // Determine message type
    const messageType = this.getSessionTypeFromMessages(messages);

    return {
      id: sessionId,
      title,
      messages: unifiedMessages,
      userId: firstMessage.userId || 'anonymous',
      messageType,
      createdAt: firstMessage.timestamp || new Date().toISOString(),
      updatedAt: lastMessage.timestamp || new Date().toISOString(),
      favorite: false,
      rating: 0,
      sessionMetadata: this.calculateSessionMetadata(messages)
    };
  }

  private convertApiSessionToLightweight(sessionData: any): LightweightSession {
    return {
      id: sessionData.id,
      title: sessionData.title,
      userId: sessionData.userId,
      messageType: sessionData.messageType || 'Chat',
      createdAt: sessionData.createdAt,
      updatedAt: sessionData.updatedAt,
      favorite: sessionData.favorite || false,
      rating: sessionData.rating || 0,
      lastMessage: sessionData.lastMessage,
      messageCount: sessionData.messageCount || 0,
      hasImage: sessionData.hasImage || false,
      lastApiUsed: sessionData.lastApiUsed
    };
  }

  private generateSessionTitleFromMessage(message: any): string {
    if (message.detectedQuestion?.examDetails) {
      const exam = message.detectedQuestion.examDetails;
      const questionNumber = message.detectedQuestion.questionNumber || 'Unknown';
      return `${exam.board || 'Unknown'} ${exam.qualification || 'Unknown'} ${exam.paperCode || 'Unknown'} - Q${questionNumber}`;
    }
    
    if (message.type === 'question_original') {
      return `Question - ${new Date(message.timestamp).toLocaleDateString()}`;
    }
    
    if (message.type === 'marking_original') {
      return `Marking - ${new Date(message.timestamp).toLocaleDateString()}`;
    }
    
    return `Chat - ${new Date(message.timestamp).toLocaleDateString()}`;
  }

  private getSessionTypeFromMessages(messages: any[]): 'Marking' | 'Question' | 'Chat' {
    const hasMarking = messages.some((msg: any) => msg.type?.includes('marking'));
    const hasQuestion = messages.some((msg: any) => msg.type?.includes('question'));
    
    if (hasMarking) return 'Marking';
    if (hasQuestion) return 'Question';
    return 'Chat';
  }

  private calculateSessionMetadata(messages: any[]): any {
    const totalMessages = messages.length;
    const lastMessage = messages[messages.length - 1];
    
    // Sum up processing times and tokens from message metadata
    let totalProcessingTime = 0;
    let totalTokens = 0;
    let totalConfidence = 0;
    let confidenceCount = 0;

    messages.forEach((msg: any) => {
      if (msg.metadata) {
        if (msg.metadata.processingTimeMs) {
          totalProcessingTime += msg.metadata.processingTimeMs;
        }
        if (msg.metadata.tokens && Array.isArray(msg.metadata.tokens)) {
          totalTokens += msg.metadata.tokens.reduce((a: number, b: number) => a + b, 0);
        }
        if (msg.metadata.confidence) {
          totalConfidence += msg.metadata.confidence;
          confidenceCount++;
        }
      }
    });

    return {
      totalProcessingTimeMs: totalProcessingTime,
      totalTokens: totalTokens,
      averageConfidence: confidenceCount > 0 ? totalConfidence / confidenceCount : 0,
      lastApiUsed: lastMessage?.apiUsed,
      lastModelUsed: lastMessage?.model,
      totalMessages: totalMessages
    };
  }

  private convertToLightweightSession(sessionData: any): LightweightSession {
    const messages = sessionData.messages || [];
    const lastMessage = messages[messages.length - 1];

    return {
      id: sessionData.id,
      title: sessionData.title,
      userId: sessionData.userId,
      messageType: sessionData.messageType || 'Chat',
      createdAt: sessionData.createdAt || new Date().toISOString(),
      updatedAt: sessionData.updatedAt || new Date().toISOString(),
      favorite: sessionData.favorite || false,
      rating: sessionData.rating || 0,
      lastMessage: lastMessage ? {
        content: lastMessage.content,
        role: lastMessage.role,
        timestamp: lastMessage.timestamp
      } : undefined,
      messageCount: messages.length,
      hasImage: messages.some((msg: any) => msg.imageData || msg.imageLink),
      lastApiUsed: lastMessage?.apiUsed
    };
  }

  private updateSidebarSession(session: UnifiedSession): void {
    const lightweightSession = this.convertToLightweightSession(session);
    
    // Update or add to sidebar
    const existingIndex = this.state.sidebarSessions.findIndex(s => s.id === session.id);
    
    if (existingIndex >= 0) {
      // Update existing
      const updatedSidebar = [...this.state.sidebarSessions];
      updatedSidebar[existingIndex] = lightweightSession;
      this.setState({ sidebarSessions: updatedSidebar });
    } else {
      // Add new (remove oldest if at limit)
      const updatedSidebar = [lightweightSession, ...this.state.sidebarSessions];
      if (updatedSidebar.length > this.MAX_SIDEBAR_SESSIONS) {
        updatedSidebar.splice(this.MAX_SIDEBAR_SESSIONS);
      }
      this.setState({ sidebarSessions: updatedSidebar });
    }
  }
}

// Export singleton instance
export const localSessionService = new LocalSessionService();
export default localSessionService;
