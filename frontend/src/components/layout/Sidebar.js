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
import './Sidebar.css';

function Sidebar({ isOpen = true, onMarkingHistoryClick, onMarkingResultSaved, onMarkHomeworkClick, onMenuToggle }) {
  const navigate = useNavigate();
  const { user, getAuthToken, isAdmin } = useAuth();
  const [chatSessions, setChatSessions] = useState([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [dropdownSessionId, setDropdownSessionId] = useState(null);
  
  const initializeSessions = useCallback(async () => {
    if (!user?.uid) {
      setChatSessions([]);
      return;
    }
    setIsLoadingSessions(true);
    try {
      const authToken = await getAuthToken();
      const response = await MarkingHistoryService.getMarkingHistoryFromSessions(user.uid, 50, authToken);
      if (response.success) {
        const sortedSessions = [...(response.sessions || [])].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
        setChatSessions(sortedSessions);
        sortedSessions.forEach(session => simpleSessionService.updateSidebarSession(session));
      } else {
        setSessionsError('Failed to load chat sessions');
      }
    } catch (error) {
      setSessionsError('Failed to load chat sessions');
    } finally {
      setIsLoadingSessions(false);
    }
  }, [user?.uid, getAuthToken]);

  useEffect(() => {
    if (user?.uid) {
      initializeSessions();
    } else {
      setChatSessions([]);
      simpleSessionService.clearAllSessions();
    }
  }, [user?.uid, initializeSessions]);

  useEffect(() => {
    // 👇 FIX 1: The handleSessionUpdate function now correctly removes temporary sessions.
    const handleSessionUpdate = (event) => {
      const { session: updatedSession } = event.detail;
      if (!updatedSession) return;
      setChatSessions(prevSessions => {
        // First, remove any temporary sessions that might exist.
        const sessionsWithoutTemp = prevSessions.filter(s => !s.id.startsWith('temp-'));
        
        const existingIndex = sessionsWithoutTemp.findIndex(s => s.id === updatedSession.id);
        let newSessions;
        if (existingIndex !== -1) {
          newSessions = [...sessionsWithoutTemp];
          newSessions[existingIndex] = updatedSession;
        } else {
          newSessions = [updatedSession, ...sessionsWithoutTemp];
        }
        return newSessions.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
      });
    };
    const handleSessionDeleted = (event) => {
      const { sessionId } = event.detail;
      if (sessionId) {
        setChatSessions(prevSessions => prevSessions.filter(s => s.id !== sessionId));
      }
    };
    const cleanup = EventManager.listenToMultiple({
      [EVENT_TYPES.SESSION_UPDATED]: handleSessionUpdate,
      [EVENT_TYPES.SESSION_DELETED]: handleSessionDeleted,
      [EVENT_TYPES.USER_LOGGED_OUT]: () => setChatSessions([]),
    });
    return cleanup;
  }, []);

  const handleGoToMarkHomework = () => {
    setSelectedSessionId(null);
    if (onMarkHomeworkClick) {
      onMarkHomeworkClick();
    }
    navigate('/mark-homework');
  };

  const handleSessionClick = (session) => {
    setSelectedSessionId(session.id);
    if (onMarkingHistoryClick) {
      onMarkingHistoryClick(session);
    }
  };

  const handleDeleteSession = async (sessionId, event) => {
    event.stopPropagation();
    if (window.confirm('Are you sure you want to delete this session?')) {
      try {
        const authToken = await getAuthToken();
        await MarkingHistoryService.deleteSession(sessionId, authToken);
        EventManager.dispatch(EVENT_TYPES.SESSION_DELETED, { sessionId });
        handleGoToMarkHomework();
      } catch (error) {
        console.error('Error deleting session:', error);
      }
    }
  };

  const handleDropdownToggle = (sessionId, event) => {
    event.stopPropagation();
    setDropdownSessionId(prev => (prev === sessionId ? null : sessionId));
  };
  
  const handleEditTitle = (session, event) => {
    event.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(session.title || 'Chat Session');
    setDropdownSessionId(null);
  };

  const handleSaveTitle = async (sessionId) => {
    if (editingTitle.trim() === '') return;
    try {
      const authToken = await getAuthToken();
      await MarkingHistoryService.updateSession(sessionId, { title: editingTitle.trim() }, authToken);
      const updatedSession = { ...chatSessions.find(s => s.id === sessionId), title: editingTitle.trim(), updatedAt: new Date().toISOString() };
      EventManager.dispatch(EVENT_TYPES.SESSION_UPDATED, { session: updatedSession });
      simpleSessionService.setCurrentSession(updatedSession);
      setEditingSessionId(null);
    } catch (error) {
      console.error('Error updating session title:', error);
    }
  };

  const handleToggleFavorite = async (session, event) => {
    event.stopPropagation();
    const newFavoriteStatus = !session.favorite;
    try {
      const authToken = await getAuthToken();
      await MarkingHistoryService.updateSession(session.id, { favorite: newFavoriteStatus }, authToken);
      const updatedSession = { ...session, favorite: newFavoriteStatus, updatedAt: new Date().toISOString() };
      EventManager.dispatch(EVENT_TYPES.SESSION_UPDATED, { session: updatedSession });
      simpleSessionService.setCurrentSession(updatedSession);
      setDropdownSessionId(null);
    } catch (error) {
      console.error('Error updating favorite status:', error);
    }
  };

  const getFilteredSessions = () => {
    switch (activeTab) {
      case 'mark':
        return chatSessions.filter(session => session.messageType === 'Marking');
      case 'question':
        return chatSessions.filter(session => session.messageType === 'Question');
      case 'favorite':
        return chatSessions.filter(session => session.favorite === true);
      default:
        return chatSessions;
    }
  };
  
  const getMessageTypeIcon = (messageType) => {
    switch (messageType) {
      case 'Marking': return <BookOpen size={16} />;
      case 'Question': return <Clock size={16} />;
      default: return <BookOpen size={16} />;
    }
  };

  // 👇 FIX 2: The getLastMessage function is now more robust and checks both sources.
  const getLastMessage = (session) => {
    if (session?.lastMessage?.content) {
        const contentStr = ensureStringContent(session.lastMessage.content);
        if (contentStr.trim().length > 0) {
            return contentStr.length > 20 ? `${contentStr.substring(0, 20)}...` : contentStr;
        }
    }
    
    if (session?.messages && session.messages.length > 0) {
        const lastMsgWithContent = [...session.messages].reverse().find(m => m.content && !m.isProcessing);
        if (lastMsgWithContent) {
            const contentStr = ensureStringContent(lastMsgWithContent.content);
            if (contentStr.trim().length > 0) {
                return contentStr.length > 20 ? `${contentStr.substring(0, 20)}...` : contentStr;
            }
        }
    }
    
    return 'No messages yet';
  };

  const formatSessionDate = (session) => {
    if (!session) return '';
    const dateStr = session.updatedAt || session.createdAt;
    if (!dateStr) return '';
    const sessionDate = new Date(dateStr);
    if (isNaN(sessionDate.getTime())) return '';
    const now = new Date();
    const isSameDay = sessionDate.toDateString() === now.toDateString();
    if (isSameDay) {
      return sessionDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } else {
      return sessionDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: sessionDate.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
    }
  };

  return (
    <div className={`sidebar ${!isOpen ? 'collapsed' : ''}`}>
      <div className="sidebar-content">
        <div className="sidebar-header">
          <button className="sidebar-menu-toggle" onClick={onMenuToggle} aria-label="Toggle menu">
            {isOpen ? <Menu size={24} /> : <X size={24} />}
          </button>
          <div className="sidebar-logo" onClick={handleGoToMarkHomework}>
            <h1 className="sidebar-logo-text">Intellimark</h1>
            <p className="sidebar-logo-subtitle">powered by AI</p>
          </div>
        </div>
        <button className="mark-homework-main-btn" onClick={handleGoToMarkHomework}>
          <BookOpen size={20} />
          Mark Homework
        </button>
        <div className="sidebar-section">
          <div className="mark-history-tabs">
            <button className={`mark-history-tab ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>All</button>
            <button className={`mark-history-tab ${activeTab === 'mark' ? 'active' : ''}`} onClick={() => setActiveTab('mark')}>Mark</button>
            <button className={`mark-history-tab ${activeTab === 'question' ? 'active' : ''}`} onClick={() => setActiveTab('question')}>Question</button>
            <button className={`mark-history-tab ${activeTab === 'favorite' ? 'active' : ''}`} onClick={() => setActiveTab('favorite')}>Favorite</button>
          </div>
          <div className="mark-history-scrollable">
            {isLoadingSessions ? (
              <div className="mark-history-loading">Loading...</div>
            ) : sessionsError ? (
              <div className="mark-history-error">Error loading sessions</div>
            ) : getFilteredSessions().length === 0 ? (
              <div className="mark-history-placeholder">No sessions yet</div>
            ) : (
              <div className="mark-history-list">
                {getFilteredSessions().map((session) => (
                  <div key={session.id} className={`mark-history-item ${selectedSessionId === session.id ? 'active' : ''}`} onClick={() => handleSessionClick(session)}>
                    <div className="mark-history-icon">{getMessageTypeIcon(session.messageType)}</div>
                    <div className="mark-history-content">
                      <div className="mark-history-item-title">
                        {session.favorite && <Star size={14} className="favorite-star-inline" />}
                        {editingSessionId === session.id ? (
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle(session.id)}
                            onBlur={() => handleSaveTitle(session.id)}
                            autoFocus
                          />
                        ) : (
                          session.title || 'Chat Session'
                        )}
                      </div>
                      <div className="mark-history-last-message">{getLastMessage(session)}</div>
                    </div>
                    <div className="mark-history-actions">
                      <div className="mark-history-time">{formatSessionDate(session)}</div>
                      {user?.uid && (
                        <div className="mark-history-actions-container">
                          <button className="mark-history-dropdown-btn" onClick={(e) => handleDropdownToggle(session.id, e)}>
                            <MoreHorizontal size={16} />
                          </button>
                          {dropdownSessionId === session.id && (
                            <div className="mark-history-dropdown">
                              <div className="dropdown-item" onClick={(e) => handleEditTitle(session, e)}><Edit3 size={16} /> Edit</div>
                              <div className="dropdown-item" onClick={(e) => handleToggleFavorite(session, e)}><Heart size={16} /> {session.favorite ? 'Unfavorite' : 'Favorite'}</div>
                              <div className="dropdown-item danger" onClick={(e) => handleDeleteSession(session.id, e)}><Trash2 size={16} /> Delete</div>
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
      {isAdmin() && (
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

