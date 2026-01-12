import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Settings,
  Settings2,
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
  Lock,
  ChevronDown,
  PanelLeft,
  User
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSubscription } from '../../hooks/useSubscription';
import MarkingHistoryService from '../../services/markingHistoryService';
import { simpleSessionService } from '../../services/markingApiService';
import { ensureStringContent } from '../../utils/contentUtils';
import EventManager, { EVENT_TYPES } from '../../utils/eventManager';

import type { UnifiedSession } from '../../types';
import ConfirmationModal from '../common/ConfirmationModal';
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
  const [editingTitle, setEditingTitle] = useState('');

  const [dropdownSessionId, setDropdownSessionId] = useState<string | null>(null);
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);

  const editInputRef = useRef<HTMLInputElement>(null);
  const { checkPermission, loading: subLoading } = useSubscription();
  const canAccessAnalysis = checkPermission('analysis');
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);

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
      const response = await MarkingHistoryService.getMarkingHistoryFromSessions(user.uid, 1000, authToken) as MarkingHistoryResponse;
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

  // Auto-sync selectedSessionId with the current session from the service
  useEffect(() => {
    const unsubscribe = simpleSessionService.subscribe((state: any) => {
      if (state.currentSession?.id) {
        setSelectedSessionId(state.currentSession.id);
      } else {
        setSelectedSessionId(null);
      }
    });

    // Initial sync
    const current = simpleSessionService.getCurrentSession() as UnifiedSession | null;
    if (current?.id) {
      setSelectedSessionId(current.id);
    }

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      const input = editInputRef.current;
      input.focus();
      input.select();
      input.scrollLeft = 0;
    }
  }, [editingSessionId]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (dropdownSessionId && !target.closest('.mark-history-actions-container')) {
        setDropdownSessionId(null);
      }
      if (isFilterDropdownOpen && !target.closest('.mark-history-filter-container')) {
        setIsFilterDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [dropdownSessionId, isFilterDropdownOpen]);

  // Helper to close sidebar on mobile navigation
  const closeSidebarIfMobile = () => {
    if (window.innerWidth <= 768) {
      onMenuToggle();
    }
  };

  const handleGoToMarkHomework = () => {
    setSelectedSessionId(null);
    onMarkHomeworkClick();
    navigate('/app');
    closeSidebarIfMobile();
  };

  const handleSessionClick = (session: UnifiedSession) => {
    setSelectedSessionId(session.id);
    onMarkingHistoryClick(session);
    closeSidebarIfMobile();
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
    let title = session.title || 'Chat Session';
    title = title.replace(/:::[^\s\n]+/g, '');
    title = title.replace(/\*\*/g, '').replace(/###/g, '').trim();
    const maxLength = 50;
    return title.length > maxLength ? title.substring(0, maxLength) + '...' : title;
  };

  const getLastMessage = (session: any) => {
    const cleanContent = (content: string) => {
      if (!content) return '';
      let clean = content;
      clean = clean.replace(/:::[^\s\n]+/g, '');
      const labels = ['YOUR WORK:', 'REASONING:', 'SUMMARY:', 'CONTEXT:', 'STUDENT WORK:'];
      labels.forEach(label => {
        const regex = new RegExp(label, 'gi');
        clean = clean.replace(regex, '');
      });
      clean = clean.replace(/\*\*/g, '').replace(/###/g, '').trim();
      return clean;
    };

    if (session?.lastMessage?.content) {
      const contentStr = ensureStringContent(session.lastMessage.content);
      const cleaned = cleanContent(contentStr);
      if (cleaned.length > 0) {
        return cleaned.length > 30 ? `${cleaned.substring(0, 30)}...` : cleaned;
      }
    }

    if (session?.messages && session.messages.length > 0) {
      const lastMsgWithContent = [...session.messages].reverse().find(m => m.content && !m.isProcessing);
      if (lastMsgWithContent) {
        const contentStr = ensureStringContent(lastMsgWithContent.content);
        const cleaned = cleanContent(contentStr);
        if (cleaned.length > 0) {
          return cleaned.length > 30 ? `${cleaned.substring(0, 30)}...` : cleaned;
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
          <div className="sidebar-logo" onClick={handleGoToMarkHomework}>
            <img src="/images/logo.png" alt="AI Marking Logo" className="sidebar-logo-img" />
            <div>
              <h1 className="sidebar-logo-text">AI Marking</h1>
            </div>
          </div>
          <button className="sidebar-menu-toggle" onClick={onMenuToggle} aria-label="Toggle menu">
            <PanelLeft size={18} />
          </button>
        </div>
        <div className="sidebar-menu-group">
          <div className="sidebar-section-header-row">
            <div className="sidebar-section-header">MAIN</div>
          </div>
          <button className="mark-homework-main-btn" onClick={handleGoToMarkHomework}>
            <ClipboardCheck size={20} />
            <span>New Marking</span>
          </button>
          <button
            className="mark-homework-main-btn"
            onClick={() => {
              navigate('/library');
              closeSidebarIfMobile();
            }}
            style={{ marginTop: '8px' }}
          >
            <Library size={20} />
            <span>Library</span>
          </button>
          <button
            className={`mark-homework-main-btn ${(!user || !canAccessAnalysis) ? 'disabled-feature' : ''}`}
            onClick={() => {
              if (user && canAccessAnalysis) {
                navigate('/analysis');
                closeSidebarIfMobile();
              } else {
                setIsUpgradeModalOpen(true);
              }
            }}
            style={{ marginTop: '8px', opacity: (user && canAccessAnalysis) ? 1 : 0.6 }}
            title={!user ? "Sign up to access Analysis" : (!canAccessAnalysis ? "Available on Pro and Ultra plans" : "Analysis")}
          >
            {(user && canAccessAnalysis) ? <BarChart3 size={20} /> : <Lock size={20} />}
            <span>Analysis</span>
          </button>
        </div>

        <ConfirmationModal
          isOpen={isUpgradeModalOpen}
          onClose={() => setIsUpgradeModalOpen(false)}
          onConfirm={() => {
            setIsUpgradeModalOpen(false);
            if (!user) {
              navigate('/login');
              EventManager.dispatch(EVENT_TYPES.OPEN_AUTH_MODAL, { mode: 'signup' });
            } else {
              navigate('/upgrade', { state: { fromApp: true } });
            }
          }}
          title={!user ? "Authentication Required" : "Upgrade Required"}
          message={!user
            ? "Analysis feature is available on Pro and Ultra plans. Please sign up or log in to access this feature and unlock diagnostic insights."
            : "Analysis feature is available on Pro and Ultra plans. Would you like to upgrade now and unlock diagnostic insights?"}
          confirmText={!user ? "Sign Up / Log In" : "Upgrade to Pro"}
          cancelText="Maybe later"
          variant="primary"
          icon={<BarChart3 size={24} />}
        />
        <div className="sidebar-section">
          {user ? (
            <>
              <div className="sidebar-section-header-row">
                <div className="sidebar-section-header">RECENT PAPERS</div>
                <div className="mark-history-filter-container">
                  <button
                    className="mark-history-filter-trigger"
                    onClick={(e) => { e.stopPropagation(); setIsFilterDropdownOpen(!isFilterDropdownOpen); }}
                  >
                    <span>{activeTab === 'all' ? 'All' : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</span>
                    <ChevronDown size={14} className={`filter-chevron ${isFilterDropdownOpen ? 'open' : ''}`} />
                  </button>
                  {isFilterDropdownOpen && (
                    <div className="mark-history-filter-dropdown">
                      <div className={`filter-option ${activeTab === 'all' ? 'selected' : ''}`} onClick={() => { setActiveTab('all'); setIsFilterDropdownOpen(false); }}>All</div>
                      <div className={`filter-option ${activeTab === 'mark' ? 'selected' : ''}`} onClick={() => { setActiveTab('mark'); setIsFilterDropdownOpen(false); }}>Mark</div>
                      <div className={`filter-option ${activeTab === 'question' ? 'selected' : ''}`} onClick={() => { setActiveTab('question'); setIsFilterDropdownOpen(false); }}>Question</div>
                      <div className={`filter-option ${activeTab === 'favorite' ? 'selected' : ''}`} onClick={() => { setActiveTab('favorite'); setIsFilterDropdownOpen(false); }}>Favorite</div>
                    </div>
                  )}
                </div>
              </div>
              <div className="mark-history-scrollable">
                {getFilteredSessions().length > 0 ? (
                  getFilteredSessions().map((session) => (
                    <div
                      key={session.id}
                      className={`mark-history-item ${selectedSessionId === session.id ? 'active' : ''} ${dropdownSessionId === session.id ? 'has-open-dropdown' : ''}`}
                      onClick={() => handleSessionClick(session)}
                    >
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
                  ))
                ) : (
                  <div className="mark-history-empty">
                    <Clock size={24} style={{ opacity: 0.3, marginBottom: '8px' }} />
                    <p>No history yet</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="guest-history-cta">
              <div className="guest-cta-icon-bg">
                <Clock size={24} className="guest-cta-icon" />
              </div>
              <h3>Save your history</h3>
              <p>Sign up to save your marking results and sync them across all your devices.</p>
              <button
                className="guest-cta-btn"
                onClick={() => EventManager.dispatch(EVENT_TYPES.OPEN_AUTH_MODAL, { mode: 'signup' })}
              >
                Sign up for free
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="admin-section">
        <div className="admin-link" onClick={() => {
          if (user) {
            EventManager.dispatch('OPEN_PROFILE_MODAL', { tab: 'account' });
            closeSidebarIfMobile();
          } else {
            EventManager.dispatch(EVENT_TYPES.OPEN_AUTH_MODAL, { mode: 'login' });
          }
        }}>
          <User className="text-[var(--icon-secondary)]" size={18} />
          <span>{user ? 'Account' : 'Sign In'}</span>
        </div>

        {isAdmin() && (
          <div className="admin-link" onClick={() => {
            navigate('/admin');
            closeSidebarIfMobile();
          }}>
            <Settings size={16} />
            <span>Admin</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
