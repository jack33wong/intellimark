import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  MessageSquare, 
  Settings, 
  Trash2,
  BookOpen
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

/**
 * Sidebar component displaying navigation and chat history
 * @param {Object} props - Component props
 * @param {Array} props.chats - Array of chat objects
 * @param {Object} props.currentChat - Currently selected chat
 * @param {Function} props.onNewChat - Function to create new chat
 * @param {Function} props.onSelectChat - Function to select a chat
 * @param {Function} props.onDeleteChat - Function to delete a chat
 * @param {boolean} props.isLoading - Loading state for new chat creation
 * @returns {JSX.Element} The sidebar component
 */
function Sidebar({ 
  chats, 
  currentChat, 
  onNewChat, 
  onSelectChat, 
  onDeleteChat, 
  isLoading 
}) {
  const navigate = useNavigate();
  const [userProgress, setUserProgress] = useState(null);
  
  // API base URL for development vs production
  const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '';

  /**
   * Load user progress data
   */
  const loadUserProgress = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/user/progress`);
      if (response.ok) {
        const progress = await response.json();
        setUserProgress(progress);
      }
    } catch (error) {
      console.error('Failed to load user progress:', error);
    }
  };

  /**
   * Handle chat deletion with confirmation
   */
  const handleDeleteChat = (chatId, event) => {
    event.stopPropagation();
    if (window.confirm('Are you sure you want to delete this chat?')) {
      onDeleteChat(chatId);
    }
  };

  /**
   * Format chat title for display
   */
  const formatChatTitle = (title) => {
    if (title.length > 30) {
      return title.substring(0, 30) + '...';
    }
    return title;
  };

  /**
   * Format timestamp for display
   */
  const formatTimestamp = (timestamp) => {
    try {
      return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
    } catch {
      return 'Recently';
    }
  };

  // Load user progress on component mount
  useEffect(() => {
    loadUserProgress();
  }, []);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>Intellimark Chat</h1>
        <p>AI-powered conversations</p>
      </div>

      <div className="sidebar-content">
        <button 
          className="new-chat-btn" 
          onClick={onNewChat}
          disabled={isLoading}
        >
          <MessageSquare size={16} />
          {isLoading ? 'Creating...' : 'New Chat'}
        </button>

        <div className="sidebar-section">
          <h3>User Progress</h3>
          <div className="progress-section">
            {userProgress ? (
              <>
                <div className="progress-item">
                  <span>Total Chats</span>
                  <span className="progress-value">{userProgress.totalChats}</span>
                </div>
                <div className="progress-item">
                  <span>Total Messages</span>
                  <span className="progress-value">{userProgress.totalMessages}</span>
                </div>
                <div className="progress-item">
                  <span>Learning Streak</span>
                  <span className="progress-value">{userProgress.learningStreak} days</span>
                </div>
                <div className="progress-item">
                  <span>Last Active</span>
                  <span className="progress-value">
                    {formatDistanceToNow(new Date(userProgress.lastActive), { addSuffix: true })}
                  </span>
                </div>
              </>
            ) : (
              <div className="progress-item">
                <span>Loading progress...</span>
              </div>
            )}
          </div>
        </div>

        <div className="separator" />

        <div className="sidebar-section">
          <h3>Chat History</h3>
          {chats.length > 0 ? (
            <ul className="chat-history">
              {chats.map((chat) => (
                <li
                  key={chat.id}
                  className={`chat-item ${currentChat?.id === chat.id ? 'active' : ''}`}
                  onClick={() => onSelectChat(chat)}
                >
                  <MessageSquare className="chat-item-icon" size={16} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: currentChat?.id === chat.id ? '600' : '400' }}>
                      {formatChatTitle(chat.title)}
                    </div>
                    <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '2px' }}>
                      {formatTimestamp(chat.updatedAt)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDeleteChat(chat.id, e)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'rgba(255, 255, 255, 0.6)',
                      cursor: 'pointer',
                      padding: '4px',
                      borderRadius: '4px',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                      e.target.style.color = 'rgba(255, 255, 255, 0.9)';
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.background = 'none';
                      e.target.style.color = 'rgba(255, 255, 255, 0.6)';
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ 
              textAlign: 'center', 
              padding: '20px', 
              opacity: 0.7,
              fontSize: '14px'
            }}>
              No chats yet
            </div>
          )}
        </div>
      </div>

      <div className="admin-section">
        <div className="admin-link" onClick={() => navigate('/mark-homework')}>
          <BookOpen size={16} />
          Mark Homework
        </div>
        <div className="admin-link" onClick={() => navigate('/admin')}>
          <Settings size={16} />
          Admin
        </div>
      </div>
    </div>
  );
}

export default Sidebar;
