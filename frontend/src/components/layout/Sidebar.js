import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Settings, 
  BookOpen,
  Clock,
  Trash2,
  Menu,
  X,
  Star,
  MoreVertical,
  Edit3,
  Heart,
  MoreHorizontal
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import MarkingHistoryService from '../../services/markingHistoryService';
import { simpleSessionService } from '../../services/simpleSessionService';
import { ensureStringContent } from '../../utils/contentUtils';
import EventManager, { EVENT_TYPES } from '../../utils/eventManager';
import { isOriginalImageMessage, isAnnotatedImageMessage } from '../../utils/sessionUtils';
import './Sidebar.css';

/**
 * Sidebar component displaying navigation
 * @returns {JSX.Element} The sidebar component
 */
function Sidebar({ isOpen = true, onMarkingHistoryClick, onMarkingResultSaved, onMarkHomeworkClick, onMenuToggle }) {
  const navigate = useNavigate();
  // const location = useLocation(); // Removed - not used
  const { user, getAuthToken } = useAuth();
  // Memory-first approach: Use simpleSessionService.sidebarSessions as primary data source
  const [chatSessions, setChatSessions] = useState([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState(null);
  const [deletingSessionId, setDeletingSessionId] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [dropdownSessionId, setDropdownSessionId] = useState(null);
  
  // Memory-first approach: Use simpleSessionService.sidebarSessions as primary data source
  useEffect(() => {
    const syncWithService = (serviceState) => {
      const { sidebarSessions } = serviceState;
      // Use sidebarSessions directly from memory as primary data source
      if (sidebarSessions) {
        // Sort by updatedAt for consistent ordering
        const sortedSessions = [...sidebarSessions].sort((a, b) => 
          new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
        );
        setChatSessions(sortedSessions);
      }
    };
    
    // Subscribe to service state changes
    const unsubscribe = simpleSessionService.subscribe(syncWithService);
    
    return unsubscribe;
  }, []);

  // Clear selected session when switching tabs
  useEffect(() => {
    setSelectedSessionId(null);
  }, [activeTab]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownSessionId && !event.target.closest('.mark-history-actions-container')) {
        setDropdownSessionId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [dropdownSessionId]);

  // Initialize sessions from database only once when user logs in
  const initializeSessions = useCallback(async () => {
    // Only load sessions for authenticated users
    if (!user?.uid) {
      setChatSessions([]);
      setSessionsError(null);
      setIsLoadingSessions(false);
      return;
    }

    setIsLoadingSessions(true);
    setSessionsError(null);
    
    try {
      // Get authentication token
      const authToken = await getAuthToken();
      
      // Load sessions only for authenticated users - this is the only database call
      const response = await MarkingHistoryService.getMarkingHistoryFromSessions(user.uid, 20, authToken);
      
      if (response.success) {
        const sessions = response.sessions || [];
        // Populate the service memory with initial data
        sessions.forEach(session => {
          simpleSessionService.updateSidebarSession(session);
        });
      } else {
        setSessionsError('Failed to load chat sessions');
      }

    } catch (error) {
      setSessionsError('Failed to load chat sessions');
    } finally {
      setIsLoadingSessions(false);
    }
  }, [user?.uid, getAuthToken]);

  // Initialize sessions from database only once when user logs in
  // Also clear sessions when user logs out
  useEffect(() => {
    if (user?.uid) {
      initializeSessions();
    } else {
      // User logged out, clear chat sessions
      setChatSessions([]);
      setSessionsError(null);
      setIsLoadingSessions(false);
      
      // Also clear all sessions in the service
      simpleSessionService.clearAllSessions();
    }
  }, [user?.uid, initializeSessions]); // Run when user changes (login/logout)

  // Expose refresh function to parent component
  useEffect(() => {
    if (onMarkingResultSaved) {
      // Store the refresh function in the callback so parent can call it
      onMarkingResultSaved.refresh = initializeSessions;
    }
  }, [onMarkingResultSaved, initializeSessions]);

  // Listen for custom events - no longer need database reloads since we use memory
  useEffect(() => {
    const cleanup = EventManager.listenToMultiple({
      [EVENT_TYPES.SESSIONS_CLEARED]: () => {
        // Clear memory and UI
        simpleSessionService.clearAllSessions();
        setChatSessions([]);
        setSessionsError(null);
        setIsLoadingSessions(false);
      },
      [EVENT_TYPES.SESSION_DELETED]: (event) => {
        // Remove session from memory
        const { sessionId } = event.detail;
        if (sessionId) {
          simpleSessionService.setState(prevState => ({
            sidebarSessions: prevState.sidebarSessions.filter(s => s.id !== sessionId)
          }));
        }
      },
      [EVENT_TYPES.USER_LOGGED_OUT]: () => {
        setChatSessions([]);
        setSessionsError(null);
        setIsLoadingSessions(false);
        simpleSessionService.clearAllSessions();
      }
    });
    
    return cleanup;
  }, []);

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
      
      // Remove the session from memory (immediate UI update)
      simpleSessionService.setState(prevState => ({
        sidebarSessions: prevState.sidebarSessions.filter(session => session.id !== sessionId)
      }));
      
      // Dispatch custom event to notify other components
      EventManager.dispatch(EVENT_TYPES.SESSION_DELETED, { sessionId });
      
      // Reset to upload mode and navigate to mark homework page
      if (onMarkHomeworkClick && typeof onMarkHomeworkClick === 'function') {
        onMarkHomeworkClick();
      } else {
        // Fallback: just navigate to mark homework page
        navigate('/mark-homework');
      }
      
    } catch (error) {
      console.error('❌ Error deleting session:', error);
      alert(`Failed to delete session: ${error.message}`);
    } finally {
      setDeletingSessionId(null);
    }
  };

  // Handle dropdown toggle
  const handleDropdownToggle = (sessionId, event) => {
    event.stopPropagation(); // Prevent triggering the session click
    setDropdownSessionId(dropdownSessionId === sessionId ? null : sessionId);
  };

  // Handle edit title
  const handleEditTitle = (session, event) => {
    event.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(session.title || 'Chat Session');
    setDropdownSessionId(null); // Close dropdown
  };

  // Handle save title
  const handleSaveTitle = async (sessionId, event) => {
    event.stopPropagation();
    
    if (editingTitle.trim() === '') {
      alert('Title cannot be empty');
      return;
    }

    try {
      const authToken = await getAuthToken();
      await MarkingHistoryService.updateSession(sessionId, { title: editingTitle.trim() }, authToken);
      
      // Update the session in memory
      simpleSessionService.setState(prevState => ({
        sidebarSessions: prevState.sidebarSessions.map(session => 
          session.id === sessionId 
            ? { ...session, title: editingTitle.trim(), updatedAt: new Date().toISOString() }
            : session
        )
      }));

      // Update current session if it's the one being edited
      const currentSession = simpleSessionService.getCurrentSession();
      if (currentSession && currentSession.id === sessionId) {
        simpleSessionService.setCurrentSession({
          ...currentSession,
          title: editingTitle.trim(),
          updatedAt: new Date().toISOString()
        });
      }

      setEditingSessionId(null);
      setEditingTitle('');
    } catch (error) {
      console.error('❌ Error updating session title:', error);
      alert(`Failed to update title: ${error.message}`);
    }
  };

  // Handle cancel edit
  const handleCancelEdit = (event) => {
    event.stopPropagation();
    setEditingSessionId(null);
    setEditingTitle('');
  };

  // Handle favorite toggle
  const handleToggleFavorite = async (session, event) => {
    event.stopPropagation();
    
    const newFavoriteStatus = !session.favorite;
    
    try {
      const authToken = await getAuthToken();
      await MarkingHistoryService.updateSession(session.id, { favorite: newFavoriteStatus }, authToken);
      
      // Update the session in memory
      simpleSessionService.setState(prevState => ({
        sidebarSessions: prevState.sidebarSessions.map(s => 
          s.id === session.id 
            ? { ...s, favorite: newFavoriteStatus, updatedAt: new Date().toISOString() }
            : s
        )
      }));

      // Update current session if it's the one being favorited
      const currentSession = simpleSessionService.getCurrentSession();
      if (currentSession && currentSession.id === session.id) {
        simpleSessionService.setCurrentSession({
          ...currentSession,
          favorite: newFavoriteStatus,
          updatedAt: new Date().toISOString()
        });
      }

      setDropdownSessionId(null); // Close dropdown
    } catch (error) {
      console.error('❌ Error updating favorite status:', error);
      alert(`Failed to update favorite: ${error.message}`);
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
      // Only show "No messages yet" if content is truly empty
      if (contentStr.trim().length === 0) {
        return 'No messages yet';
      }
      
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
      // Find the last non-processing message to display
      let lastMsg = null;
      for (let i = session.messages.length - 1; i >= 0; i--) {
        const msg = session.messages[i];
        // Skip processing messages (they have empty content)
        if (msg.content && !msg.isProcessing) {
          lastMsg = msg;
          break;
        }
      }
      
      if (lastMsg && lastMsg.content) {
        const contentStr = ensureStringContent(lastMsg.content);
        // Only show "No messages yet" if content is truly empty
        if (contentStr.trim().length === 0) {
          return 'No messages yet';
        }
        
        const truncated = contentStr.length > 20 ? contentStr.substring(0, 20) + '...' : contentStr;
        
        const hasImage = lastMsg.hasImage || isOriginalImageMessage(lastMsg) || isAnnotatedImageMessage(lastMsg);
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
            
            // Reset to upload mode and navigate
            if (onMarkHomeworkClick && typeof onMarkHomeworkClick === 'function') {
              onMarkHomeworkClick();
            }
            navigate('/mark-homework');
          }}
        >
          <BookOpen size={20} />
          Mark Homework
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
                      {editingSessionId === session.id ? (
                        <div className="title-edit-container">
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleSaveTitle(session.id, e);
                              } else if (e.key === 'Escape') {
                                handleCancelEdit(e);
                              }
                            }}
                            onBlur={(e) => handleSaveTitle(session.id, e)}
                            className="title-edit-input"
                            autoFocus
                          />
                        </div>
                      ) : (
                        getSessionTitle(session)
                      )}
                    </div>
                    <div className="mark-history-last-message">
                      {getLastMessage(session)}
                    </div>
                  </div>
                  
                  {/* Time and Actions Column */}
                  <div className="mark-history-actions">
                    {/* Update Time */}
                    <div className="mark-history-time">
                      {formatSessionDate(session)}
                    </div>
                    
                    {/* Actions Dropdown */}
                    {user?.uid && (
                      <div className="mark-history-actions-container">
                        <button
                          className="mark-history-dropdown-btn"
                          onClick={(e) => handleDropdownToggle(session.id, e)}
                          title="More options"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                        
                        {/* Dropdown Menu */}
                        {dropdownSessionId === session.id && (
                          <div className="mark-history-dropdown">
                            <div className="dropdown-item" onClick={(e) => handleEditTitle(session, e)}>
                              <Edit3 size={16} />
                              <span>Edit</span>
                            </div>
                            <div className="dropdown-item" onClick={(e) => handleToggleFavorite(session, e)}>
                              <Heart size={16} />
                              <span>{session.favorite ? 'Remove from Favorites' : 'Add to Favorites'}</span>
                            </div>
                            <div className="dropdown-item danger" onClick={(e) => handleDeleteSession(session.id, e)}>
                              <Trash2 size={16} />
                              <span>Delete</span>
                            </div>
                          </div>
                        )}
                      </div>
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
