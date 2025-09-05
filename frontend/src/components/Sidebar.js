import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Settings, 
  BookOpen,
  Code,
  Clock
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import MarkingHistoryService from '../services/markingHistoryService';

/**
 * Sidebar component displaying navigation
 * @returns {JSX.Element} The sidebar component
 */
function Sidebar({ isOpen = true, onMarkingHistoryClick, onMarkingResultSaved, onMarkHomeworkClick }) {
  const navigate = useNavigate();
  // const location = useLocation(); // Removed - not used
  const { user, getAuthToken } = useAuth();
  const [markingHistory, setMarkingHistory] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [lastFetchTime, setLastFetchTime] = useState(0);
  
  // Debug props and route

  


  // Function to refresh marking history with debouncing
  const refreshMarkingHistory = useCallback(async () => {
    const now = Date.now();
    const timeSinceLastFetch = now - lastFetchTime;
    
    // Debounce: don't fetch if we've fetched within the last 1 second
    if (timeSinceLastFetch < 1000) {
      return;
    }
    
    setIsLoadingHistory(true);
    setHistoryError(null);
    setLastFetchTime(now);
    
    try {
      // Get authentication token
      const authToken = getAuthToken();
      
      // Use actual user ID if available, otherwise fall back to anonymous
      const userIdToFetch = user?.uid || 'anonymous';
      
      const response = await MarkingHistoryService.getUserMarkingHistory(userIdToFetch, 20, authToken);
      
      if (response.success) {
        const results = response.results || [];
        setMarkingHistory(results);
      } else {
        setHistoryError('Failed to load marking history');
      }
      

    } catch (error) {
      setHistoryError('Failed to load marking history');
    } finally {
      setIsLoadingHistory(false);
    }
  }, [user?.uid, getAuthToken, lastFetchTime]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch marking history when user is available
  useEffect(() => {
    // Only fetch if we have a user or are fetching for anonymous
    if (user?.uid || !user) {
      refreshMarkingHistory();
    }
  }, [user?.uid, refreshMarkingHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  // Expose refresh function to parent component
  useEffect(() => {
    if (onMarkingResultSaved) {
      // Store the refresh function in the callback so parent can call it
      onMarkingResultSaved.refresh = refreshMarkingHistory;
    }
  }, [onMarkingResultSaved, refreshMarkingHistory]);

  const handleMarkingHistoryClick = (result) => {
    if (onMarkingHistoryClick && typeof onMarkingHistoryClick === 'function') {
      onMarkingHistoryClick(result);
    }
  };





  return (
    <div className={`sidebar ${!isOpen ? 'collapsed' : ''}`}>
      <div className="sidebar-content">
        <button 
          className="new-chat-btn" 
          onClick={() => {
            // Call the reset handler if provided
            if (onMarkHomeworkClick && typeof onMarkHomeworkClick === 'function') {
              onMarkHomeworkClick();
            }
            navigate('/mark-homework');
          }}
        >
          <BookOpen size={16} />
          Mark Homework
        </button>

        <div className="sidebar-section">
          <h3>Mark History</h3>
          {!user ? (
            <div className="mark-history-login-prompt">
              <div className="placeholder-item">
                <BookOpen size={16} />
                <span>Login to view history</span>
                <button 
                  className="login-prompt-btn"
                  onClick={() => navigate('/login')}
                >
                  Login
                </button>
              </div>
            </div>
          ) : isLoadingHistory ? (
            <div className="mark-history-loading">
              <div className="placeholder-item">
                <Clock size={16} />
                <span>Loading history...</span>
              </div>
            </div>
          ) : historyError ? (
            <div className="mark-history-error">
              <div className="placeholder-item">
                <BookOpen size={16} />
                <span>Error loading history</span>
              </div>
            </div>
          ) : markingHistory.length === 0 ? (
            <div className="mark-history-placeholder">
              <div className="placeholder-item">
                <BookOpen size={16} />
                <span>No marking history yet</span>
              </div>
            </div>
          ) : (
            <div className="mark-history-list">
              {markingHistory.map((result) => (
                <div
                  key={result.id}
                  className="mark-history-item"
                  onClick={() => handleMarkingHistoryClick(result)}
                >
                  <div className="mark-history-content">
                    <div className="mark-history-text">
                      {MarkingHistoryService.extractQuestionText(result)}
                    </div>
                    <div className="mark-history-date">
                      {MarkingHistoryService.formatDate(result.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="separator" />

      {user && (
        <div className="admin-section">
          <div className="admin-link" onClick={() => navigate('/markdown-demo')}>
            <Code size={16} />
            Markdown Demo
          </div>
          <div className="admin-link" onClick={() => navigate('/firebase-test')}>
            <Code size={16} />
            Firebase Test
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
