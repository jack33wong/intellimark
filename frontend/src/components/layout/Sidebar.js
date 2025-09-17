import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Settings, 
  BookOpen,
  Clock,
  Trash2,
  Menu,
  X,
  Star
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import MarkingHistoryService from '../../services/markingHistoryService';
import { ensureStringContent } from '../../utils/contentUtils';
import EventManager, { EVENT_TYPES } from '../../utils/eventManager';
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
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  
  // Clear selected session when switching tabs
  useEffect(() => {
    setSelectedSessionId(null);
  }, [activeTab]);
  
  // Debug props and route

  


  // Function to refresh chat sessions with debouncing
  const refreshChatSessions = useCallback(async () => {
    // Only load sessions for authenticated users
    if (!user?.uid) {
      setChatSessions([]);
      setSessionsError(null);
      setIsLoadingSessions(false);
      return;
    }

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
      
      // Load sessions only for authenticated users
      const response = await MarkingHistoryService.getMarkingHistoryFromSessions(user.uid, 20, authToken);
      
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

  // Fetch chat sessions for authenticated users only
  useEffect(() => {
    refreshChatSessions();
  }, [user?.uid, refreshChatSessions]);

  // Expose refresh function to parent component
  useEffect(() => {
    if (onMarkingResultSaved) {
      // Store the refresh function in the callback so parent can call it
      onMarkingResultSaved.refresh = refreshChatSessions;
    }
  }, [onMarkingResultSaved, refreshChatSessions]);

  // Listen for custom events to refresh sessions
  useEffect(() => {
    const cleanup = EventManager.listenToMultiple({
      [EVENT_TYPES.SESSIONS_CLEARED]: refreshChatSessions,
      [EVENT_TYPES.SESSION_UPDATED]: refreshChatSessions
    });
    
    return cleanup;
  }, [refreshChatSessions]);

  const handleSessionClick = (session) => {
    setSelectedSessionId(session.id);
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
      await MarkingHistoryService.deleteSession(sessionId, authToken);
      
      // Remove the session from the local state
      setChatSessions(prevSessions => 
        prevSessions.filter(session => session.id !== sessionId)
      );
      
      // Dispatch custom event to notify other components
      EventManager.dispatch(EVENT_TYPES.SESSION_DELETED, { sessionId });
      
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
    
    // Fallback: Use generic title
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

  // Helper function to get last message content (max 20 characters)
  const getLastMessage = (session) => {
    // Use lastMessage from unified sessions API
    if (session.lastMessage && session.lastMessage.content) {
      const contentStr = ensureStringContent(session.lastMessage.content);
      // Truncate to 20 characters as requested
      const truncated = contentStr.length > 20 ? contentStr.substring(0, 20) + '...' : contentStr;
      
      // Add image indicator if session has images
      if (session.hasImage) {
        return `📷 ${truncated}`;
      }
      
      return truncated;
    }
    
    // Fallback: check if session has images but no text content
    if (session.hasImage) {
      return '📷 Image message';
    }
    
    // Fallback: check old messages array format (for backward compatibility)
    if (session.messages && session.messages.length > 0) {
      const lastMsg = session.messages[session.messages.length - 1];
      if (lastMsg.content) {
        const contentStr = ensureStringContent(lastMsg.content);
        const truncated = contentStr.length > 20 ? contentStr.substring(0, 20) + '...' : contentStr;
        
        const hasImage = lastMsg.hasImage || lastMsg.type === 'marking_original' || lastMsg.type === 'question_original' || lastMsg.type === 'marking_annotated';
        if (hasImage) {
          return `📷 ${truncated}`;
        }
        
        return truncated;
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
    
    // Check if the session date is the same day as today
    const isSameDay = sessionDate.getDate() === now.getDate() &&
                     sessionDate.getMonth() === now.getMonth() &&
                     sessionDate.getFullYear() === now.getFullYear();
    
    if (isSameDay) {
      // Show time for today's sessions
      return sessionDate.toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false // Use 24-hour format
      });
    } else {
      // Show date for other days
      return sessionDate.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: sessionDate.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
      });
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
            // Reset selected session when navigating
            setSelectedSessionId(null);
            
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
                <span>
                  {`No ${activeTab === 'all' ? '' : activeTab === 'favorite' ? 'favorite ' : activeTab + ' '}sessions yet`}
                </span>
              </div>
            </div>
          ) : (
            <div className="mark-history-list">
              {getFilteredSessions().map((session) => (
                <div
                  key={session.id}
                  className={`mark-history-item ${selectedSessionId === session.id ? 'active' : ''}`}
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
                    {user?.uid && (
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
          </div>
        </div>
      </div>

      {user?.uid && (
        <div className="admin-section">
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
