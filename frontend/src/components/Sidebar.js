import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Settings, 
  BookOpen,
  Code
} from 'lucide-react';

/**
 * Sidebar component displaying navigation
 * @returns {JSX.Element} The sidebar component
 */
function Sidebar({ isOpen = true }) {
  const navigate = useNavigate();





  return (
    <div className={`sidebar ${!isOpen ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <h1>Intellimark</h1>
        <p>AI-powered learning platform</p>
      </div>

      <div className="sidebar-content">
        <button 
          className="new-chat-btn" 
          onClick={() => navigate('/mark-homework')}
        >
          <BookOpen size={16} />
          Mark Homework
        </button>

        <div className="sidebar-section">
          <h3>Mark History</h3>
          <div className="mark-history-placeholder">
            <div className="placeholder-item">
              <BookOpen size={16} />
              <span>No marked homework yet</span>
            </div>
            <div className="placeholder-item">
              <BookOpen size={16} />
              <span>Start marking to see history</span>
            </div>
          </div>
        </div>
      </div>

      <div className="separator" />

      <div className="admin-section">
        <div className="admin-link" onClick={() => navigate('/latex-test')}>
          <Code size={16} />
          LaTeX Testing
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
    </div>
  );
}

export default Sidebar;
