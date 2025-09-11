import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SessionProvider } from './contexts/SessionContext';
import { useSessionActions } from './hooks/useSessionActions';
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [markHomeworkResetKey, setMarkHomeworkResetKey] = useState(0);
  const [currentPageMode, setCurrentPageMode] = useState('upload');

  // Get session actions from the new session management system
  const { selectSession } = useSessionActions();

  // Note: handleMarkingHistoryClick is no longer needed as session management 
  // is now handled by the new session management system in the sidebar

  const handleMarkHomeworkClick = () => {
    // Reset to upload mode and clear current session
    setCurrentPageMode('upload');
    selectSession(null); // Clear current session using new session management
    setMarkHomeworkResetKey(prev => prev + 1);
  };

  const handlePageModeChange = (mode) => {
    setCurrentPageMode(mode);
  };
  


  // Note: handleMarkingResultSaved is no longer needed as session management 
  // is now handled by the new session management system

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
                      onMarkHomeworkClick={handleMarkHomeworkClick}
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
                      onMarkHomeworkClick={handleMarkHomeworkClick}
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
                      onMarkHomeworkClick={handleMarkHomeworkClick}
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
                      onMarkHomeworkClick={handleMarkHomeworkClick}
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
                      onMarkHomeworkClick={handleMarkHomeworkClick}
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
      <SessionProvider>
        <Router future={{ 
          v7_startTransition: true,
          v7_relativeSplatPath: true 
        }}>
          <AppContent />
        </Router>
      </SessionProvider>
    </AuthProvider>
  );
}

export default App;

