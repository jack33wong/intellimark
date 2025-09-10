import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Settings, 
  BookOpen,
  Code,
  Clock,
  Trash2,
  Menu,
  X,
  Star
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import MarkingHistoryService from '../services/markingHistoryService';
import './Sidebar.css';

/**
 * Sidebar component displaying navigation
 * @returns {JSX.Element} The sidebar component
 */
function Sidebar({ isOpen = true, onMarkingHistoryClick, onMarkingResultSaved, onMarkHomeworkClick, currentPageMode = 'upload', onMenuToggle }) {
  const navigate = useNavigate();
  // const location = useLocation(); // Removed - not used
  const { user, getAuthToken } = useAuth();
  const [chatSessions, setChatSessions] = useState([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState(null);
  const [lastFetchTime, setLastFetchTime] = useState(0);
  const [deletingSessionId, setDeletingSessionId] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  
  // Debug props and route

  


  // Function to refresh chat sessions with debouncing
  const refreshChatSessions = useCallback(async () => {
    const now = Date.now();
    const timeSinceLastFetch = now - lastFetchTime;
    
    // Debounce: don't fetch if we've fetched within the last 1 second
    if (timeSinceLastFetch < 1000) {
      return;
    }
    setIsLoadingSessions(true);
    setSessionsError(null);
    setLastFetchTime(now);
    
    try {
      // Get authentication token
      const authToken = await getAuthToken();
      
      // Use authenticated user ID or 'anonymous' for unauthenticated users
      const userIdToFetch = user?.uid || 'anonymous';
      
      const response = await MarkingHistoryService.getMarkingHistoryFromSessions(userIdToFetch, 20, authToken);
      
      if (response.success) {
        const sessions = response.sessions || [];
        setChatSessions(sessions);
      } else {
        setSessionsError('Failed to load chat sessions');
      }
      

    } catch (error) {
      setSessionsError('Failed to load chat sessions');
    } finally {
      setIsLoadingSessions(false);
    }
  }, [user?.uid, getAuthToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch chat sessions for both authenticated and anonymous users
  useEffect(() => {
    // Fetch sessions for both authenticated users and anonymous users
    refreshChatSessions();
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Expose refresh function to parent component
  useEffect(() => {
    if (onMarkingResultSaved) {
      // Store the refresh function in the callback so parent can call it
      onMarkingResultSaved.refresh = refreshChatSessions;
    }
  }, [onMarkingResultSaved, refreshChatSessions]);

  // Listen for custom events to refresh sessions
  useEffect(() => {
    const handleSessionsCleared = () => {
      refreshChatSessions();
    };

    window.addEventListener('sessionsCleared', handleSessionsCleared);
    
    return () => {
      window.removeEventListener('sessionsCleared', handleSessionsCleared);
    };
  }, [refreshChatSessions]);

  const handleSessionClick = (session) => {
    if (onMarkingHistoryClick && typeof onMarkingHistoryClick === 'function') {
      onMarkingHistoryClick(session);
    } else {
      console.warn('Sidebar: onMarkingHistoryClick not available');
    }
  };

  const handleDeleteSession = async (sessionId, event) => {
    event.stopPropagation(); // Prevent triggering the session click
    
    // Show confirmation dialog
    const confirmed = window.confirm('Are you sure you want to delete this session? This action cannot be undone.');
    if (!confirmed) {
      return;
    }

    setDeletingSessionId(sessionId);
    
    try {
      const authToken = await getAuthToken();
      if (!authToken) {
        throw new Error('Authentication required to delete sessions');
      }

      await MarkingHistoryService.deleteSession(sessionId, authToken);
      
      // Remove the session from the local state
      setChatSessions(prevSessions => 
        prevSessions.filter(session => session.id !== sessionId)
      );
      
      // Dispatch custom event to notify other components
      window.dispatchEvent(new CustomEvent('sessionDeleted', { detail: { sessionId } }));
      
      // Navigate to mark homework page after successful deletion
      navigate('/mark-homework');
      
    } catch (error) {
      console.error('❌ Error deleting session:', error);
      alert(`Failed to delete session: ${error.message}`);
    } finally {
      setDeletingSessionId(null);
    }
  };

  // Helper function to get session title
  const getSessionTitle = (session) => {
    if (session.title) {
      return session.title;
    }
    
    // Fallback: Find the first marking message to extract question text
    const markingMessage = session.messages?.find(msg => 
      msg.type === 'marking_original' || msg.type === 'marking_annotated' || msg.type === 'question_original'
    );
    
    if (markingMessage?.markingData?.ocrResult?.extractedText) {
      const text = markingMessage.markingData.ocrResult.extractedText;
      return text.length > 50 ? text.substring(0, 50) + '...' : text;
    }
    
    return 'Chat Session';
  };

  // Helper function to filter sessions based on active tab
  const getFilteredSessions = () => {
    if (activeTab === 'all') {
      return chatSessions;
    } else if (activeTab === 'mark') {
      return chatSessions.filter(session => session.messageType === 'Marking');
    } else if (activeTab === 'question') {
      return chatSessions.filter(session => session.messageType === 'Question');
    } else if (activeTab === 'favorite') {
      return chatSessions.filter(session => session.favorite === true);
    }
    return chatSessions;
  };

  // Helper function to get message type icon
  const getMessageTypeIcon = (messageType) => {
    switch (messageType) {
      case 'Marking':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
        );
      case 'Question':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
            <path d="M12 17h.01"/>
          </svg>
        );
      case 'Chat':
      default:
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        );
    }
  };

  // Helper function to get last message content
  const getLastMessage = (session) => {
    if (session.messages && session.messages.length > 0) {
      const lastMsg = session.messages[session.messages.length - 1];
      
      // Check if message has image data (even if excluded from response)
      const hasImage = lastMsg.hasImage || lastMsg.type === 'marking_original' || lastMsg.type === 'question_original' || lastMsg.type === 'marking_annotated';
      
      if (lastMsg.content) {
        let content = lastMsg.content.length > 150 ? lastMsg.content.substring(0, 150) + '...' : lastMsg.content;
        
        // Add image indicator if message contains an image
        if (hasImage) {
          content = `📷 ${content}`;
        }
        
        return content;
      } else if (hasImage) {
        // If no text content but has image, show image indicator
        return '📷 Image message';
      }
    }
    return 'No messages yet';
  };

  // Helper function to format session date
  const formatSessionDate = (session) => {
    const date = session.updatedAt || session.createdAt || session.timestamp;
    if (!date) return 'Unknown date';
    
    const sessionDate = new Date(date);
    const now = new Date();
    const diffMs = now - sessionDate;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return sessionDate.toLocaleDateString();
    }
  };





  return (
    <div className={`sidebar ${!isOpen ? 'collapsed' : ''}`}>
      <div className="sidebar-content">
        {/* Sidebar Header - Menu Toggle and Logo */}
        <div className="sidebar-header">
          <button 
            className="sidebar-menu-toggle"
            onClick={onMenuToggle}
            aria-label="Toggle menu"
          >
            {isOpen ? <Menu size={24} /> : <X size={24} />}
          </button>
          
          <div className="sidebar-logo" onClick={() => navigate('/')}>
            <h1 className="sidebar-logo-text">Intellimark</h1>
            <p className="sidebar-logo-subtitle">powered by AI</p>
          </div>
        </div>

        {/* Main Mark Homework Button */}
        <button 
          className="mark-homework-main-btn" 
          onClick={() => {
            if (currentPageMode === 'chat') {
              // In chat mode, this acts as a back button
              // We need to trigger the back functionality
              // This will be handled by the MarkHomeworkPage component
              if (onMarkHomeworkClick && typeof onMarkHomeworkClick === 'function') {
                onMarkHomeworkClick();
              }
            } else {
              // In upload mode, navigate to mark homework
              if (onMarkHomeworkClick && typeof onMarkHomeworkClick === 'function') {
                onMarkHomeworkClick();
              }
              navigate('/mark-homework');
            }
          }}
        >
          <BookOpen size={20} />
          {currentPageMode === 'chat' ? 'Back to Upload' : 'Mark Homework'}
        </button>

        {/* Test Scroll Button */}
        <button 
          className="mark-homework-main-btn test-scroll-btn" 
          onClick={() => navigate('/test-scroll')}
          style={{ marginTop: '8px', backgroundColor: '#28a745' }}
        >
          <Code size={20} />
          Test Scroll
        </button>

        <div className="sidebar-section">
          <div className="mark-history-tabs">
            <button 
              className={`mark-history-tab ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              All
            </button>
            <button 
              className={`mark-history-tab ${activeTab === 'mark' ? 'active' : ''}`}
              onClick={() => setActiveTab('mark')}
            >
              Mark
            </button>
            <button 
              className={`mark-history-tab ${activeTab === 'question' ? 'active' : ''}`}
              onClick={() => setActiveTab('question')}
            >
              Question
            </button>
            <button 
              className={`mark-history-tab ${activeTab === 'favorite' ? 'active' : ''}`}
              onClick={() => setActiveTab('favorite')}
            >
              Favorite
            </button>
          </div>
          <div className="mark-history-scrollable">
            {isLoadingSessions ? (
            <div className="mark-history-loading">
              <div className="placeholder-item">
                <Clock size={16} />
                <span>Loading sessions...</span>
              </div>
            </div>
          ) : sessionsError ? (
            <div className="mark-history-error">
              <div className="placeholder-item">
                <BookOpen size={16} />
                <span>Error loading sessions</span>
              </div>
            </div>
          ) : getFilteredSessions().length === 0 ? (
            <div className="mark-history-placeholder">
              <div className="placeholder-item">
                <BookOpen size={16} />
                <span>No {activeTab === 'all' ? '' : activeTab === 'favorite' ? 'favorite ' : activeTab + ' '}sessions yet</span>
              </div>
            </div>
          ) : (
            <div className="mark-history-list">
              {getFilteredSessions().map((session) => (
                <div
                  key={session.id}
                  className="mark-history-item"
                  onClick={() => handleSessionClick(session)}
                >
                  {/* Message Type Icon */}
                  <div className="mark-history-icon">
                    {getMessageTypeIcon(session.messageType)}
                  </div>
                  
                  {/* Content: Title (top) and Last Message (bottom) */}
                  <div className="mark-history-content">
                    <div className="mark-history-item-title">
                      {session.favorite && (
                        <Star size={14} className="favorite-star-inline" />
                      )}
                      {getSessionTitle(session)}
                    </div>
                    <div className="mark-history-last-message">
                      {getLastMessage(session)}
                    </div>
                  </div>
                  
                  {/* Time and Delete Button Column */}
                  <div className="mark-history-actions">
                    {/* Update Time */}
                    <div className="mark-history-time">
                      {formatSessionDate(session)}
                    </div>
                    
                    {/* Delete Button */}
                    {user && (
                      <button
                        className="mark-history-delete-btn"
                        onClick={(e) => handleDeleteSession(session.id, e)}
                        disabled={deletingSessionId === session.id}
                        title="Delete session"
                      >
                        {deletingSessionId === session.id ? (
                          <Clock size={16} />
                        ) : (
                          <Trash2 size={16} />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {/* Show login prompt for anonymous users */}
          {!user && (
            <div className="mark-history-login-prompt">
              <div className="placeholder-item">
                <BookOpen size={16} />
                <span>Login to save sessions permanently</span>
                <button 
                  className="login-prompt-btn"
                  onClick={() => navigate('/login')}
                >
                  Login
                </button>
              </div>
            </div>
          )}
          </div>
        </div>
      </div>

      {user && (
        <div className="admin-section">
          <div className="admin-link" onClick={() => navigate('/markdown-demo')}>
            <Code size={16} />
            Markdown Demo
          </div>
          <div className="admin-link" onClick={() => navigate('/admin')}>
            <Settings size={16} />
            Admin
          </div>
        </div>
      )}
    </div>
  );
}

export default Sidebar;
