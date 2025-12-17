import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Settings,
  BookOpen,
  Clock,
  Trash2,
  Menu,
  X,
  Star,
  MoreHorizontal,
  Edit3,
  Heart,
  FileText,
  MessageSquare,
  Library,
  ClipboardCheck,

  BarChart3,
  Lock
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSubscription } from '../../hooks/useSubscription';
import MarkingHistoryService from '../../services/markingHistoryService';
import { simpleSessionService } from '../../services/markingApiService';
import { ensureStringContent } from '../../utils/contentUtils';
import EventManager, { EVENT_TYPES } from '../../utils/eventManager';
import type { UnifiedSession } from '../../types';
import './Sidebar.css';

// Define the types for the props this component receives from App.tsx
interface SidebarProps {
  isOpen?: boolean;
  onMarkingHistoryClick: (session: UnifiedSession) => void;
  onMarkingResultSaved: () => void;
  onMarkHomeworkClick: () => void;
  onMenuToggle: () => void;
}

// Define the type for the service response
interface MarkingHistoryResponse {
  success: boolean;
  sessions?: UnifiedSession[];
}

const Sidebar: React.FC<SidebarProps> = ({
  isOpen = true,
  onMarkingHistoryClick,
  onMarkHomeworkClick,
  onMenuToggle
}) => {
  const navigate = useNavigate();
  const { user, getAuthToken, isAdmin } = useAuth();
  const [chatSessions, setChatSessions] = useState<UnifiedSession[]>([]);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const [dropdownSessionId, setDropdownSessionId] = useState<string | null>(null);

  const editInputRef = useRef<HTMLInputElement>(null);
  const { checkPermission, loading: subLoading } = useSubscription();
  const canAccessAnalysis = checkPermission('analysis');

  const initializeSessions = useCallback(async () => {
    if (!user?.uid) {
      setChatSessions([]);
      return;
    }
    try {
      const authToken = await getAuthToken();
      if (!authToken) {
        console.error('Authentication token not available.');
        return;
      }
      const response = await MarkingHistoryService.getMarkingHistoryFromSessions(user.uid, 50, authToken) as MarkingHistoryResponse;
      if (response.success && response.sessions) {
        const sortedSessions = [...response.sessions].sort((a, b) =>
          new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
        );
        setChatSessions(sortedSessions);
        sortedSessions.forEach(session => simpleSessionService.updateSidebarSession(session));
      } else {
        console.error('Failed to load chat sessions');
      }
    } catch (error) {
      console.error('Failed to load chat sessions:', error);
    } finally {
      // Loading complete
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
    const handleSessionUpdate = (event: CustomEvent<{ session: UnifiedSession }>) => {
      const { session: updatedSession } = event.detail;
      if (!updatedSession) return;

      // Only process session updates for authenticated users
      if (!user?.uid) return;

      setChatSessions(prevSessions => {
        const sessionsWithoutTemp = prevSessions.filter(s => !s.id.startsWith('temp-'));

        const existingIndex = sessionsWithoutTemp.findIndex(s => s.id === updatedSession.id);
        let newSessions;

        if (existingIndex !== -1) {
          newSessions = [...sessionsWithoutTemp];
          newSessions[existingIndex] = updatedSession;
        } else {
          newSessions = [updatedSession, ...sessionsWithoutTemp];
        }

        return newSessions.sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
      });
    };
    const handleSessionDeleted = (event: CustomEvent<{ sessionId: string }>) => {
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
    return () => {
      cleanup();
    };
  }, [user?.uid]);

  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      const input = editInputRef.current;
      input.focus();
      input.select();
      // 👇 FIX: Manually set the horizontal scroll position to the beginning.
      // This overrides the browser's default behavior and fixes the bug.
      input.scrollLeft = 0;
    }
  }, [editingSessionId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownSessionId && !(event.target as HTMLElement).closest('.mark-history-actions-container')) {
        setDropdownSessionId(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [dropdownSessionId]);


  const handleGoToMarkHomework = () => {
    setSelectedSessionId(null);
    onMarkHomeworkClick();
    navigate('/mark-homework');
  };

  const handleSessionClick = (session: UnifiedSession) => {
    setSelectedSessionId(session.id);
    onMarkingHistoryClick(session);
  };

  const handleDeleteSession = async (sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (window.confirm('Are you sure you want to delete this session?')) {
      try {
        const authToken = await getAuthToken();
        if (!authToken) return;
        await MarkingHistoryService.deleteSession(sessionId, authToken);
        EventManager.dispatch(EVENT_TYPES.SESSION_DELETED, { sessionId });
        handleGoToMarkHomework();
      } catch (error) {
        console.error('Error deleting session:', error);
      }
    }
  };

  const handleDropdownToggle = (sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setDropdownSessionId(prev => prev === sessionId ? null : sessionId);
  };

  const handleEditTitle = (session: UnifiedSession, event: React.MouseEvent) => {
    event.stopPropagation();
    setEditingSessionId(session.id);
    let fullTitle = session.title || 'Chat Session';
    if (fullTitle.endsWith('...')) {
      fullTitle = fullTitle.slice(0, -3).trim();
    }
    setEditingTitle(fullTitle);
    setDropdownSessionId(null);
  };


  const handleSaveTitle = async (sessionId: string) => {
    if (editingTitle.trim() === '') return;

    try {
      const authToken = await getAuthToken();
      if (!authToken) return;
      await MarkingHistoryService.updateSession(sessionId, { title: editingTitle.trim() }, authToken);
      const updatedSession = { ...chatSessions.find(s => s.id === sessionId), title: editingTitle.trim(), updatedAt: new Date().toISOString() } as UnifiedSession;
      EventManager.dispatch(EVENT_TYPES.SESSION_UPDATED, { session: updatedSession });
      simpleSessionService.setCurrentSession(updatedSession);
      setEditingSessionId(null);
    } catch (error) {
      console.error('Error updating session title:', error);
    }
  };

  const handleCancelEdit = () => {
    setEditingSessionId(null);
    setEditingTitle('');
  };

  const handleToggleFavorite = async (session: UnifiedSession, event: React.MouseEvent) => {
    event.stopPropagation();
    const newFavoriteStatus = !session.favorite;
    try {
      const authToken = await getAuthToken();
      if (!authToken) return;
      await MarkingHistoryService.updateSession(session.id, { favorite: newFavoriteStatus }, authToken);
      const updatedSession = { ...session, favorite: newFavoriteStatus, updatedAt: new Date().toISOString() };
      EventManager.dispatch(EVENT_TYPES.SESSION_UPDATED, { session: updatedSession });
      simpleSessionService.setCurrentSession(updatedSession);
      setDropdownSessionId(null);
    } catch (error) {
      console.error('Error updating favorite status:', error);
    }
  };

  const getFilteredSessions = (): UnifiedSession[] => {
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

  const getSessionTitle = (session: UnifiedSession) => {
    const title = session.title || 'Chat Session';
    const maxLength = 50;
    return title.length > maxLength ? title.substring(0, maxLength) + '...' : title;
  };
  const getMessageTypeIcon = (messageType?: string) => {
    switch (messageType) {
      case 'Marking': return <BookOpen size={16} />;
      case 'Question': return <Clock size={16} />;
      case 'Chat': return <MessageSquare size={16} />;
      case 'Mixed': return <FileText size={16} />;
      default: return <BookOpen size={16} />;
    }
  };

  const getLastMessage = (session: any) => {
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

  const formatSessionDate = (session: UnifiedSession) => {
    const dateStr = session.updatedAt || session.createdAt;
    if (!dateStr) return '';
    const sessionDate = new Date(dateStr);
    if (isNaN(sessionDate.getTime())) return '';
    const now = new Date();
    const isSameDay = sessionDate.toDateString() === now.toDateString();
    if (isSameDay) {
      return sessionDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } else {
      return sessionDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
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
            <img src="/images/logo.png" alt="IntelliMark Logo" className="sidebar-logo-img" />
            <div>
              <h1 className="sidebar-logo-text">AI Marking</h1>
              {/* <p className="sidebar-logo-subtitle">powered by AI</p> */}
            </div>
          </div>
        </div>
        <div className="sidebar-menu-group">
          <div className="sidebar-section-header">MAIN</div>
          <button className="mark-homework-main-btn" onClick={handleGoToMarkHomework}>
            <ClipboardCheck size={20} />
            <span>Mark Homework</span>
          </button>
          <button
            className="mark-homework-main-btn"
            onClick={() => navigate('/library')}
            style={{ marginTop: '8px' }}
          >
            <Library size={20} />
            <span>Library</span>
          </button>
          <button
            className={`mark-homework-main-btn ${!canAccessAnalysis ? 'disabled-feature' : ''}`}
            onClick={() => {
              if (canAccessAnalysis) {
                navigate('/analysis');
              } else {
                if (window.confirm('Analysis feature is available on Pro and Enterprise plans. Would you like to upgrade?')) {
                  navigate('/upgrade');
                }
              }
            }}
            style={{ marginTop: '8px', opacity: canAccessAnalysis ? 1 : 0.6 }}
            title={!canAccessAnalysis ? "Available on Pro and Enterprise plans" : "Analysis"}
          >
            {canAccessAnalysis ? <BarChart3 size={20} /> : <Lock size={20} />}
            <span>Analysis</span>
          </button>
        </div>
        <div className="sidebar-section">
          <div className="sidebar-section-header" style={{ paddingLeft: '20px', marginTop: '16px', marginBottom: '8px' }}>RECENT PAPERS</div>
          {/* <div className="mark-history-tabs"> */}
          {/* Tabs hidden or restyled if desired, sticking to image header for now. keeping tabs for functionality but maybe hide via CSS if purely following image? 
                Image doesn't show tabs. I will keep them but maybe simplify or make them subtle. 
                For now just adding the header above. */}
          {/* </div> */}
          <div className="mark-history-tabs">
            <button className={`mark-history-tab ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>All</button>
            <button className={`mark-history-tab ${activeTab === 'mark' ? 'active' : ''}`} onClick={() => setActiveTab('mark')}>Mark</button>
            <button className={`mark-history-tab ${activeTab === 'question' ? 'active' : ''}`} onClick={() => setActiveTab('question')}>Question</button>
            <button className={`mark-history-tab ${activeTab === 'favorite' ? 'active' : ''}`} onClick={() => setActiveTab('favorite')}>Favorite</button>
          </div>
          <div className="mark-history-scrollable">
            {getFilteredSessions().map((session) => (
              <div key={session.id} className={`mark-history-item ${selectedSessionId === session.id ? 'active' : ''}`} onClick={() => handleSessionClick(session)}>
                <div className="mark-history-content">
                  <div className="mark-history-item-top-row">
                    <div className="mark-history-item-title">
                      {session.favorite && <Star size={14} className="favorite-star-inline" />}
                      {editingSessionId === session.id ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          className="title-edit-input"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleSaveTitle(session.id);
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              handleCancelEdit();
                            }
                          }}
                          onBlur={() => handleSaveTitle(session.id)}
                          style={{ width: '100%' }}
                        />
                      ) : getSessionTitle(session)}
                    </div>
                  </div>
                  <div className="mark-history-item-bottom-row">
                    <div className="mark-history-last-message">{getLastMessage(session)}</div>
                    <div className="mark-history-meta">
                      <span className="mark-history-time">{formatSessionDate(session)}</span>
                      <div className={`mark-history-actions-container ${dropdownSessionId === session.id ? 'dropdown-open' : ''}`}>
                        <button className="mark-history-dropdown-btn" onClick={(e) => handleDropdownToggle(session.id, e)}>
                          <MoreHorizontal size={16} />
                        </button>
                        {dropdownSessionId === session.id && (
                          <div className="mark-history-dropdown">
                            <div className="dropdown-item" onClick={(e) => handleEditTitle(session, e)}><Edit3 size={16} /><span>Edit</span></div>
                            <div className="dropdown-item" onClick={(e) => handleToggleFavorite(session, e)}><Heart size={16} /><span>{session.favorite ? 'Unfavorite' : 'Favorite'}</span></div>
                            <div className="dropdown-item danger" onClick={(e) => handleDeleteSession(session.id, e)}><Trash2 size={16} /><span>Delete</span></div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div >
      {isAdmin() && (
        <div className="admin-section">
          <div className="admin-link" onClick={() => navigate('/admin')}>
            <Settings size={16} />
            <span>Admin</span>
          </div>
        </div>
      )}
    </div >
  );
};

export default Sidebar;

