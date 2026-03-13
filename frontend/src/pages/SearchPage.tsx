import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search as SearchIcon, X, Clock, MessageSquare, Calendar, ChevronRight, ArrowLeft, Menu } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import MarkingHistoryService from '../services/markingHistoryService';
import { ensureStringContent } from '../utils/contentUtils';
import type { UnifiedSession } from '../types';
import SEO from '../components/common/SEO';
import './SearchPage.css';

interface SearchPageProps {
  setSidebarOpen?: (open: boolean) => void;
  onNewChat?: () => void;
}

const SearchPage: React.FC<SearchPageProps> = ({ setSidebarOpen, onNewChat }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, getAuthToken } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UnifiedSession[]>([]);
  const [recentChats, setRecentChats] = useState<UnifiedSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch 10 recent chats on mount
  useEffect(() => {
    fetchRecent();
    // Auto-focus input
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [user?.uid]);

  // Debounced search logic
  useEffect(() => {
    if (user?.uid) {
      if (query.trim() === '') {
        setResults([]);
      } else {
        const timer = setTimeout(() => {
          fetchSearch();
        }, 300);
        return () => clearTimeout(timer);
      }
    }
  }, [query, user?.uid]);

  const fetchRecent = async () => {
    if (!user?.uid) return;
    setIsLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) return;
      const response = await (MarkingHistoryService as any).getMarkingHistoryFromSessions(user.uid, 10, token);
      if (response.success && response.sessions) {
        setRecentChats(response.sessions);
      }
    } catch (error) {
      console.error('Error fetching recent chats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSearch = async () => {
    if (!user?.uid || query.trim() === '') return;
    setIsLoading(true);
    try {
      const token = await getAuthToken();
      if (!token) return;
      const response = await (MarkingHistoryService as any).getMarkingHistoryFromSessions(user.uid, 20, token, null, null, query);
      if (response.success && response.sessions) {
        setResults(response.sessions);
      }
    } catch (error) {
      console.error('Error searching chats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSessionClick = (session: UnifiedSession) => {
    navigate('/app');
    const event = new CustomEvent('loadMarkingSession', {
      detail: {
        session: { id: session.id, title: session.title }
      }
    });
    window.dispatchEvent(event);
  };

  const displaySessions = query.trim() === '' ? recentChats : results;
  const isSearching = query.trim() !== '';

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    
    if (date.toDateString() === now.toDateString()) {
      return `Today, ${timeStr}`;
    }
    
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday, ${timeStr}`;
    }

    return date.toLocaleString([], { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false
    });
  };

  const getLastMessage = (session: any) => {
    const isModelAnswer = (content: string) => {
      return content && (
        content.includes('model-exam-header') ||
        content.includes('has-your-work-outer-container') ||
        content.includes('class="model_answer"')
      );
    };

    const cleanContent = (content: string) => {
      if (!content) return '';
      if (isModelAnswer(content)) return "Model Answers Generated";
      
      let clean = content;
      clean = clean.replace(/:::[^\s\n]+/g, '');
      clean = clean.replace(/<[^>]*>/g, '');
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
      if (cleaned.length > 0) return cleaned;
    }
    return '';
  };

  const handleBack = () => {
    // Start new chat/reset session
    if (onNewChat) {
      onNewChat();
    }
    
    // Always navigate back to app
    navigate('/app');
    
    // Close sidebar on mobile
    if (setSidebarOpen) {
      setSidebarOpen(false);
    }
  };

  return (
    <div className="search-page-container">
      <SEO 
        title="Search History" 
        description="Search through your past AI marking and chat history."
      />
      
      <div className="search-page-header">
        <div className="search-bar-wrapper">
          <div className="search-bar-inner">
            <SearchIcon size={20} className="search-input-icon desktop-only" />
            <button className="search-back-btn mobile-only" onClick={handleBack}>
              <ArrowLeft size={20} />
            </button>
            <input
              ref={inputRef}
              type="text"
              placeholder="Search chats by title or keywords"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="search-page-input"
            />
            {query && (
              <button className="search-clear-btn" onClick={() => setQuery('')}>
                <X size={18} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="search-results-content">
        <h2 className="search-results-heading">
          {isSearching ? `${results.length} results for "${query}"` : 'Recent'}
        </h2>

        {isLoading ? (
          <div className="search-page-loading">
            <div className="loading-spinner-small" />
            <span>Searching your history...</span>
          </div>
        ) : !isSearching ? (
          <div className="recent-chats-list">
            {recentChats.map((session: UnifiedSession) => (
              <div 
                key={session.id} 
                className="recent-chat-item-vertical"
                onClick={() => handleSessionClick(session)}
              >
                <div className="recent-item-title">{session.title || 'Untitled'}</div>
                <div className="recent-item-date">{formatDate(session.updatedAt || session.createdAt || '')}</div>
              </div>
            ))}
          </div>
        ) : displaySessions.length > 0 ? (
          <div className="search-results-list">
            {results.map((session: UnifiedSession) => (
              <div 
                key={session.id} 
                className="search-result-item-detailed"
                onClick={() => handleSessionClick(session)}
              >
                <div className="result-item-header">
                  <span className="result-item-title">{session.title || 'Untitled Session'}</span>
                  <span className="result-item-date">{formatDate(session.updatedAt || session.createdAt || '')}</span>
                </div>
                <div className="result-item-preview">{getLastMessage(session)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="search-page-empty">
            {isSearching ? (
              <div className="empty-state">
                <SearchIcon size={48} className="empty-icon" />
                <p>No chats found matching "{query}"</p>
                <span>Try different keywords or check your spelling</span>
              </div>
            ) : (
              <div className="empty-state">
                <Clock size={48} className="empty-icon" />
                <p>No recent chats</p>
                <span>Your history will appear here once you start chatting</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchPage;
