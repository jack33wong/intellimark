import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import OptionalAuthRoute from './components/OptionalAuthRoute';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import AdminPage from './components/AdminPage';
import MarkHomeworkPage from './components/MarkHomeworkPage';

import ProfilePage from './components/ProfilePage';
import Login from './components/Login';
import MarkdownMathDemo from './components/MarkdownMathDemo';
import SubscriptionPage from './components/SubscriptionPage.tsx';
import './App.css';

/**
 * App content component that can use React Router hooks
 * @returns {JSX.Element} The main application layout
 */
function AppContent() {
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedMarkingResult, setSelectedMarkingResult] = useState(null);
  const [markHomeworkResetKey, setMarkHomeworkResetKey] = useState(0);
  const [currentPageMode, setCurrentPageMode] = useState('upload');

  // Get auth token function - will be provided by AuthProvider
  const { getAuthToken } = useAuth();

  const handleMarkingHistoryClick = async (result) => {
    try {
      // If the result has a sessionId, fetch the full session data including images
      if (result.id) {
        const authToken = await getAuthToken();
        const headers = {
          'Content-Type': 'application/json',
        };
        if (authToken) {
          headers['Authorization'] = `Bearer ${authToken}`;
        }
        
        const response = await fetch(`${process.env.REACT_APP_API_BASE_URL || 'http://localhost:5001'}/api/chat/session/${result.id}`, {
          method: 'GET',
          headers,
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.session) {
            setSelectedMarkingResult(data.session);
          } else {
            console.warn('🔍 Failed to load full session data, using basic data');
            setSelectedMarkingResult(result);
          }
        } else {
          console.warn('🔍 Failed to fetch full session data, using basic data');
          setSelectedMarkingResult(result);
        }
      } else {
        setSelectedMarkingResult(result);
      }
      
      // Navigate to mark-homework route using React Router
      navigate('/mark-homework');
    } catch (error) {
      console.error('🔍 Error fetching full session data:', error);
      // Fallback to basic data
      setSelectedMarkingResult(result);
      navigate('/mark-homework');
    }
  };

  const handleMarkHomeworkClick = () => {
    if (currentPageMode === 'chat') {
      // In chat mode, reset to upload mode
      setCurrentPageMode('upload');
      setSelectedMarkingResult(null);
      setMarkHomeworkResetKey(prev => prev + 1);
    } else {
      // In upload mode, normal behavior
      setSelectedMarkingResult(null);
      setMarkHomeworkResetKey(prev => prev + 1);
    }
  };

  const handlePageModeChange = (mode) => {
    setCurrentPageMode(mode);
  };
  


  const handleMarkingResultSaved = () => {
    // This will be called when a new marking result is saved
    // We'll pass this to the Sidebar to refresh the history
    
    // Call the refresh function if it exists
    if (handleMarkingResultSaved.refresh) {
      handleMarkingResultSaved.refresh();
    }
  };

  // Using future flags to opt-in to React Router v7 behavior early
  // This eliminates all deprecation warnings:
  // - v7_startTransition: Wraps navigation updates in React.startTransition()
  // - v7_relativeSplatPath: Improves relative route resolution within splat routes
  return (
    <div className="app-container">
          <Routes>
            {/* Public routes - no header/sidebar */}
            <Route path="/login" element={<Login />} />
            <Route path="/upgrade" element={<SubscriptionPage />} />
            
            {/* Protected routes - with header and sidebar */}
            <Route path="/admin" element={
              <ProtectedRoute requireAdmin={true}>
                <div className="app-container">
                  <div className="app-body">
                    <Sidebar 
                      isOpen={isSidebarOpen} 
                      onMarkingHistoryClick={handleMarkingHistoryClick}
                      onMarkHomeworkClick={handleMarkHomeworkClick}
                      onMarkingResultSaved={handleMarkingResultSaved}
                      currentPageMode={currentPageMode}
                      onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)}
                    />
                    <div className="right-side">
                      <Header onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)} isSidebarOpen={isSidebarOpen} />
                      <div className="main-content">
                        <AdminPage />
                      </div>
                    </div>
                  </div>
                </div>
              </ProtectedRoute>
            } />
            
            <Route path="/mark-homework" element={
              <OptionalAuthRoute>
                <div className="app-container">
                  <div className="app-body">
                    <Sidebar 
                      isOpen={isSidebarOpen} 
                      onMarkingHistoryClick={handleMarkingHistoryClick}
                      onMarkHomeworkClick={handleMarkHomeworkClick}
                      onMarkingResultSaved={handleMarkingResultSaved}
                      currentPageMode={currentPageMode}
                      onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)}
                    />
                    <div className={`right-side ${currentPageMode === 'chat' ? 'chat-mode' : ''}`}>
                      {currentPageMode !== 'chat' && (
                        <Header onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)} isSidebarOpen={isSidebarOpen} />
                      )}
                      <div className="mark-homework-main-content">
                        <MarkHomeworkPage 
                          key={markHomeworkResetKey}
                          selectedMarkingResult={selectedMarkingResult}
                          onClearSelectedResult={() => setSelectedMarkingResult(null)}
                          onMarkingResultSaved={handleMarkingResultSaved}
                          onPageModeChange={handlePageModeChange}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </OptionalAuthRoute>
            } />
            

            
            
            <Route path="/profile" element={
              <ProtectedRoute>
                <div className="app-container">
                  <div className="app-body">
                    <Sidebar 
                      isOpen={isSidebarOpen} 
                      onMarkingHistoryClick={handleMarkingHistoryClick}
                      onMarkHomeworkClick={handleMarkHomeworkClick}
                      onMarkingResultSaved={handleMarkingResultSaved}
                      currentPageMode={currentPageMode}
                      onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)}
                    />
                    <div className="right-side">
                      <Header onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)} isSidebarOpen={isSidebarOpen} />
                      <div className="main-content">
                        <ProfilePage />
                      </div>
                    </div>
                  </div>
                </div>
              </ProtectedRoute>
            } />
            
            {/* Add the new MarkdownMathDemo route */}
            <Route path="/markdown-demo" element={
              <ProtectedRoute>
                <div className="app-container">
                  <div className="app-body">
                    <Sidebar 
                      isOpen={isSidebarOpen} 
                      onMarkingHistoryClick={handleMarkingHistoryClick}
                      onMarkHomeworkClick={handleMarkHomeworkClick}
                      onMarkingResultSaved={handleMarkingResultSaved}
                      currentPageMode={currentPageMode}
                      onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)}
                    />
                    <div className="right-side">
                      <Header onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)} isSidebarOpen={isSidebarOpen} />
                      <div className="main-content">
                        <MarkdownMathDemo />
                      </div>
                    </div>
                  </div>
                </div>
              </ProtectedRoute>
            } />
            
            {/* Main page route - handles subscription success */}
            <Route path="/" element={
              <OptionalAuthRoute>
                <div className="app-container">
                  <div className="app-body">
                    <Sidebar 
                      isOpen={isSidebarOpen} 
                      onMarkingHistoryClick={handleMarkingHistoryClick}
                      onMarkHomeworkClick={handleMarkHomeworkClick}
                      onMarkingResultSaved={handleMarkingResultSaved}
                      currentPageMode={currentPageMode}
                      onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)}
                    />
                    <div className="right-side">
                      <Header onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)} isSidebarOpen={isSidebarOpen} />
                      <div className="main-content">
                        <div className="welcome-message">
                          <h1>Welcome to IntelliMark</h1>
                          <p>Your AI-powered homework marking assistant</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </OptionalAuthRoute>
            } />

            {/* Fallback route - redirect to main page if no other route matches */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
  );
}

/**
 * Main App component
 * @returns {JSX.Element} The main application with routing
 */
function App() {
  return (
    <AuthProvider>
      <Router future={{ 
        v7_startTransition: true,
        v7_relativeSplatPath: true 
      }}>
        <AppContent />
      </Router>
    </AuthProvider>
  );
}

export default App;

