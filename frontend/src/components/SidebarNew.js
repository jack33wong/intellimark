/**
 * SidebarNew - Lightweight Session Management
 * 
 * Displays up to 50 lightweight sessions for fast sidebar loading
 * Only shows essential data for performance
 */

import React, { useState, useEffect } from 'react';
import localSessionService from '../services/localSessionService';
import { LightweightSession } from '../types/unifiedTypes';
import './Sidebar.css';

const SidebarNew = ({ onSessionSelect, selectedSessionId, onPageModeChange }) => {
  const [sessionState, setSessionState] = useState(localSessionService.getState());
  const [isExpanded, setIsExpanded] = useState(true);
  
  // ============================================================================
  // LOCAL SESSION SERVICE INTEGRATION
  // ============================================================================
  
  useEffect(() => {
    const unsubscribe = localSessionService.subscribe(setSessionState);
    return unsubscribe;
  }, []);
  
  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================
  
  const sidebarSessions = sessionState.sidebarSessions;
  const isLoading = sessionState.isLoading;
  const error = sessionState.error;
  
  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================
  
  const handleSessionClick = (sessionId) => {
    onSessionSelect(sessionId);
    onPageModeChange('chat');
  };
  
  const handleNewChat = () => {
    onPageModeChange('upload');
  };
  
  const handleRefresh = () => {
    localSessionService.refreshSidebar();
  };
  
  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to clear all sessions?')) {
      localSessionService.clearAllSessions();
    }
  };
  
  // ============================================================================
  // RENDER HELPERS
  // ============================================================================
  
  const formatTimestamp = (timestamp) => {
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);
      
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      
      return date.toLocaleDateString();
    } catch (error) {
      return 'Unknown';
    }
  };
  
  const getSessionIcon = (messageType) => {
    switch (messageType) {
      case 'Marking':
        return '📝';
      case 'Question':
        return '❓';
      case 'Chat':
        return '💬';
      default:
        return '💬';
    }
  };
  
  const renderSessionItem = (session) => (
    <div
      key={session.id}
      className={`session-item ${selectedSessionId === session.id ? 'active' : ''}`}
      onClick={() => handleSessionClick(session.id)}
    >
      <div className="session-header">
        <span className="session-icon">{getSessionIcon(session.messageType)}</span>
        <span className="session-title" title={session.title}>
          {session.title.length > 30 ? session.title.substring(0, 30) + '...' : session.title}
        </span>
        {session.favorite && <span className="favorite-star">⭐</span>}
      </div>
      
      <div className="session-preview">
        {session.lastMessage && (
          <div className="last-message">
            <span className="message-role">
              {session.lastMessage.role === 'user' ? 'You' : 'AI'}:
            </span>
            <span className="message-content">
              {session.lastMessage.content.length > 50 
                ? session.lastMessage.content.substring(0, 50) + '...'
                : session.lastMessage.content
              }
            </span>
          </div>
        )}
      </div>
      
      <div className="session-meta">
        <span className="session-time">{formatTimestamp(session.updatedAt)}</span>
        <span className="session-count">{session.messageCount} messages</span>
        {session.hasImage && <span className="has-image">📷</span>}
      </div>
      
      {session.lastApiUsed && (
        <div className="session-api">
          via {session.lastApiUsed}
        </div>
      )}
    </div>
  );
  
  // ============================================================================
  // MAIN RENDER
  // ============================================================================
  
  return (
    <div className={`sidebar ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="sidebar-header">
        <h2>Chat Sessions</h2>
        <div className="sidebar-controls">
          <button 
            className="btn-icon"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? '◀' : '▶'}
          </button>
        </div>
      </div>
      
      {isExpanded && (
        <>
          <div className="sidebar-actions">
            <button 
              className="btn btn-primary btn-small"
              onClick={handleNewChat}
            >
              New Chat
            </button>
            <button 
              className="btn btn-secondary btn-small"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              {isLoading ? '...' : 'Refresh'}
            </button>
            <button 
              className="btn btn-danger btn-small"
              onClick={handleClearAll}
            >
              Clear All
            </button>
          </div>
          
          <div className="sidebar-content">
            {error && (
              <div className="error-message">
                {error}
              </div>
            )}
            
            {isLoading ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Loading sessions...</p>
              </div>
            ) : sidebarSessions.length === 0 ? (
              <div className="empty-state">
                <p>No sessions yet</p>
                <p className="empty-hint">Start a new chat to begin</p>
              </div>
            ) : (
              <div className="sessions-list">
                {sidebarSessions.map(renderSessionItem)}
              </div>
            )}
          </div>
          
          <div className="sidebar-footer">
            <div className="session-stats">
              <span>{sidebarSessions.length} sessions</span>
              {sessionState.currentSession && (
                <span className="current-session">
                  Current: {sessionState.currentSession.title}
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default SidebarNew;
