import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Settings, 
  BookOpen,
  Code,
  Clock,
  Trash2
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import MarkingHistoryService from '../services/markingHistoryService';
import './Sidebar.css';

/**
 * Sidebar component displaying navigation
 * @returns {JSX.Element} The sidebar component
 */
function Sidebar({ isOpen = true, onMarkingHistoryClick, onMarkingResultSaved, onMarkHomeworkClick, currentPageMode = 'upload' }) {
  const navigate = useNavigate();
  // const location = useLocation(); // Removed - not used
  const { user, getAuthToken } = useAuth();
  const [chatSessions, setChatSessions] = useState([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState(null);
  const [lastFetchTime, setLastFetchTime] = useState(0);
  const [deletingSessionId, setDeletingSessionId] = useState(null);
  
  // Debug props and route

  


  // Function to refresh chat sessions with debouncing
  const refreshChatSessions = useCallback(async () => {
    const now = Date.now();
    const timeSinceLastFetch = now - lastFetchTime;
    
    // Debounce: don't fetch if we've fetched within the last 1 second
    if (timeSinceLastFetch < 1000) {
      console.log('🔍 Sidebar: Debouncing fetch request');
      return;
    }
    
    console.log('🔍 Sidebar: Starting to fetch chat sessions');
    setIsLoadingSessions(true);
    setSessionsError(null);
    setLastFetchTime(now);
    
    try {
      // Get authentication token
      const authToken = getAuthToken();
      
      // Use actual user ID if available, otherwise fall back to anonymous
      const userIdToFetch = user?.uid || 'anonymous';
      console.log('🔍 Sidebar: Fetching sessions for user:', userIdToFetch);
      
      const response = await MarkingHistoryService.getMarkingHistoryFromSessions(userIdToFetch, 20, authToken);
      console.log('🔍 Sidebar: Service response:', response);
      
      if (response.success) {
        const sessions = response.sessions || [];
        console.log('🔍 Sidebar: Setting chat sessions:', sessions);
        setChatSessions(sessions);
      } else {
        console.log('🔍 Sidebar: Service returned success=false');
        setSessionsError('Failed to load chat sessions');
      }
      

    } catch (error) {
      console.error('🔍 Sidebar: Error fetching sessions:', error);
      setSessionsError('Failed to load chat sessions');
    } finally {
      setIsLoadingSessions(false);
    }
  }, [user?.uid, getAuthToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch chat sessions when user is available or for anonymous users
  useEffect(() => {
    // Always fetch sessions - either for authenticated user or anonymous
    refreshChatSessions();
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Expose refresh function to parent component
  useEffect(() => {
    if (onMarkingResultSaved) {
      // Store the refresh function in the callback so parent can call it
      onMarkingResultSaved.refresh = refreshChatSessions;
    }
  }, [onMarkingResultSaved, refreshChatSessions]);

  const handleSessionClick = (session) => {
    console.log('🔍 Sidebar: Session clicked:', session);
    console.log('🔍 Sidebar: Session messages count:', session.messages?.length || 0);
    console.log('🔍 Sidebar: Session messages:', session.messages);
    
    if (onMarkingHistoryClick && typeof onMarkingHistoryClick === 'function') {
      onMarkingHistoryClick(session);
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
      const authToken = getAuthToken();
      if (!authToken) {
        throw new Error('Authentication required to delete sessions');
      }

      await MarkingHistoryService.deleteSession(sessionId, authToken);
      
      // Remove the session from the local state
      setChatSessions(prevSessions => 
        prevSessions.filter(session => session.id !== sessionId)
      );
      
      console.log('✅ Session deleted successfully:', sessionId);
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
        {/* IM Intellimark Branding */}
        <div className="sidebar-branding">
          <h2 className="brand-title">IM Intellimark</h2>
        </div>

        {/* Upgrade and Sign In Buttons */}
        <div className="sidebar-auth-buttons">
          {user ? (
            <button 
              className="upgrade-btn"
              onClick={() => navigate('/upgrade')}
            >
              Upgrade
            </button>
          ) : (
            <>
              <button 
                className="upgrade-btn"
                onClick={() => navigate('/upgrade')}
              >
                Upgrade
              </button>
              <button 
                className="signin-btn"
                onClick={() => navigate('/login')}
              >
                Sign In
              </button>
            </>
          )}
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

        <div className="sidebar-section">
          <h3 className="mark-history-title">MARK HISTORY</h3>
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
          ) : chatSessions.length === 0 ? (
            <div className="mark-history-placeholder">
              <div className="placeholder-item">
                <BookOpen size={16} />
                <span>No sessions yet</span>
              </div>
            </div>
          ) : (
            <div className="mark-history-list">
              {chatSessions.map((session) => (
                <div
                  key={session.id}
                  className="mark-history-item"
                  onClick={() => handleSessionClick(session)}
                >
                  <div className="mark-history-content">
                    <div className="mark-history-text">
                      {getSessionTitle(session)}
                    </div>
                    <div className="mark-history-date">
                      {formatSessionDate(session)}
                    </div>
                  </div>
                  {user && (
                    <button
                      className="mark-history-delete-btn"
                      onClick={(e) => handleDeleteSession(session.id, e)}
                      disabled={deletingSessionId === session.id}
                      title="Delete session"
                    >
                      {deletingSessionId === session.id ? (
                        <Clock size={14} />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>
                  )}
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

      <div className="separator" />

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
