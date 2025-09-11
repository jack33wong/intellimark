/**
 * SessionManager - Centralized session management with auth token handling
 * Manages in-memory sessions and syncs with database (tasks collection)
 */

import API_CONFIG from '../config/api';

class SessionManager {
  constructor() {
    this.sessions = new Map(); // id -> session
    this.currentSessionId = null;
    this.getAuthToken = null; // Function from useAuth hook
    this.listeners = {}; // For event-driven updates
    this.isLoading = false;
    this.lastFetchTime = 0;
  }

  // --- Auth Token Management ---
  setAuthTokenGetter(getAuthTokenFn) {
    this.getAuthToken = getAuthTokenFn;
  }

  async getCurrentAuthToken() {
    if (!this.getAuthToken) {
      console.warn('Auth token getter not set in SessionManager. Proceeding without token.');
      return null;
    }
    return await this.getAuthToken();
  }

  // --- Event System ---
  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => callback(data));
    }
  }

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    
    // Return unsubscribe function
    return () => {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    };
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }

  // --- Session Management ---
  getSessions() {
    return Array.from(this.sessions.values());
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  setSession(session) {
    this.sessions.set(session.id, session);
    this.emit('sessionUpdated', { session });
  }

  deleteSession(sessionId) {
    this.sessions.delete(sessionId);
    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null;
    }
    this.emit('sessionDeleted', { sessionId });
  }

  setCurrentSessionId(sessionId) {
    this.currentSessionId = sessionId;
    this.emit('currentSessionChanged', { sessionId });
  }

  getCurrentSession() {
    return this.currentSessionId ? this.sessions.get(this.currentSessionId) : null;
  }

  // --- Database Operations ---
  async loadTasksFromDatabase(userId) {
    if (this.isLoading) return;
    
    this.isLoading = true;
    try {
      const authToken = await this.getCurrentAuthToken();
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/chat/tasks/${userId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success && data.sessions) {
        // Clear existing sessions and load new ones
        this.sessions.clear();
        data.sessions.forEach(session => {
          this.sessions.set(session.id, session);
        });
        this.lastFetchTime = Date.now();
        
        // Emit event for UI updates
        this.emit('sessionsLoaded', { sessions: this.getSessions() });
      }
    } catch (error) {
      console.error('Failed to load tasks from database:', error);
      this.emit('sessionsLoadError', { error });
    } finally {
      this.isLoading = false;
    }
  }

  async loadSingleTask(taskId) {
    try {
      const authToken = await this.getCurrentAuthToken();
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/chat/task/${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success && data.session) {
        // Update the session in memory with full data
        this.sessions.set(data.session.id, data.session);
        return data.session;
      }
      return null;
    } catch (error) {
      console.error('Failed to load single task:', error);
      throw error;
    }
  }

  async createTask(session) {
    try {
      const authToken = await this.getCurrentAuthToken();
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/chat/task/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(session)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success && data.task) {
        this.sessions.set(data.task.id, data.task);
        this.emit('sessionCreated', { session: data.task });
        return data.task;
      }
    } catch (error) {
      console.error('Failed to create task:', error);
      throw error;
    }
  }

  async updateTask(sessionId, updates) {
    try {
      const authToken = await this.getCurrentAuthToken();
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/chat/task/${sessionId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success) {
        // Update local cache
        const existingSession = this.sessions.get(sessionId);
        if (existingSession) {
          const updatedSession = { ...existingSession, ...updates };
          this.sessions.set(sessionId, updatedSession);
          this.emit('sessionUpdated', { session: updatedSession });
        }
        return data;
      }
    } catch (error) {
      console.error('Failed to update task:', error);
      throw error;
    }
  }

  async deleteTask(sessionId) {
    try {
      const authToken = await this.getCurrentAuthToken();
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/chat/task/${sessionId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.success) {
        this.deleteSession(sessionId);
        return data;
      }
    } catch (error) {
      console.error('Failed to delete task:', error);
      throw error;
    }
  }

  // --- Utility Methods ---
  getSessionCount() {
    return this.sessions.size;
  }

  clearAllSessions() {
    this.sessions.clear();
    this.currentSessionId = null;
    this.emit('sessionsCleared', {});
  }

  // Debounced refresh to prevent excessive API calls
  async refreshSessions(userId, debounceMs = 1000) {
    const now = Date.now();
    const timeSinceLastFetch = now - this.lastFetchTime;
    
    if (timeSinceLastFetch < debounceMs) {
      return;
    }
    
    await this.loadTasksFromDatabase(userId);
  }
}

// Export singleton instance
export default new SessionManager();
