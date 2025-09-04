import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import AdminPage from './components/AdminPage';
import MarkHomeworkPage from './components/MarkHomeworkPage';

import FirebaseTest from './components/FirebaseTest';
import SimpleFirebaseTest from './components/SimpleFirebaseTest';
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

  const handleMenuToggle = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const handleMarkingHistoryClick = (result) => {
    setSelectedMarkingResult(result);
    
    // Navigate to mark-homework route using React Router
    navigate('/mark-homework');
  };

  const handleMarkHomeworkClick = () => {
    setSelectedMarkingResult(null);
    setMarkHomeworkResetKey(prev => prev + 1);
  };
  


  const handleMarkingResultSaved = () => {
    // This will be called when a new marking result is saved
    // We'll pass this to the Sidebar to refresh the history
  };

  // Function to trigger mark history refresh
  const refreshMarkHistory = () => {
    if (handleMarkingResultSaved.refresh) {
      handleMarkingResultSaved.refresh();
    }
  };

  // Using future flags to opt-in to React Router v7 behavior early
  // This eliminates all deprecation warnings:
  // - v7_startTransition: Wraps navigation updates in React.startTransition()
  // - v7_relativeSplatPath: Improves relative route resolution within splat routes
  return (
    <AuthProvider>
      <div className="app-container">
          <Routes>
            {/* Public routes - no header/sidebar */}
            <Route path="/login" element={<Login />} />
            <Route path="/upgrade" element={<SubscriptionPage />} />
            
            {/* Protected routes - with header and sidebar */}
            <Route path="/admin" element={
              <ProtectedRoute requireAdmin={true}>
                <Header onMenuToggle={handleMenuToggle} isSidebarOpen={isSidebarOpen} />
                <div className="main-content">
                  <AdminPage />
                </div>
              </ProtectedRoute>
            } />
            
            <Route path="/mark-homework" element={
              <ProtectedRoute>
                <Header onMenuToggle={handleMenuToggle} isSidebarOpen={isSidebarOpen} />
                <div className="main-content">
                  <div className="app">
                    <Sidebar 
                      isOpen={isSidebarOpen} 
                      onMarkingHistoryClick={handleMarkingHistoryClick}
                      onMarkHomeworkClick={handleMarkHomeworkClick}
                      onMarkingResultSaved={handleMarkingResultSaved}
                    />


                    <MarkHomeworkPage 
                      key={markHomeworkResetKey}
                      selectedMarkingResult={selectedMarkingResult}
                      onClearSelectedResult={() => setSelectedMarkingResult(null)}
                      onMarkingResultSaved={refreshMarkHistory}
                    />
                  </div>
                </div>
              </ProtectedRoute>
            } />
            

            
            <Route path="/firebase-test" element={
              <ProtectedRoute>
                <Header onMenuToggle={handleMenuToggle} isSidebarOpen={isSidebarOpen} />
                <div className="main-content">
                  <div className="app">
                    <Sidebar 
                      isOpen={isSidebarOpen} 
                      onMarkingHistoryClick={handleMarkingHistoryClick}
                      onMarkHomeworkClick={handleMarkHomeworkClick}
                    />
                    <FirebaseTest />
                  </div>
                </div>
              </ProtectedRoute>
            } />
            
            <Route path="/simple-firebase-test" element={
              <ProtectedRoute>
                <Header onMenuToggle={handleMenuToggle} isSidebarOpen={isSidebarOpen} />
                <div className="main-content">
                  <div className="app">
                    <Sidebar 
                      isOpen={isSidebarOpen} 
                      onMarkingHistoryClick={handleMarkingHistoryClick}
                      onMarkHomeworkClick={handleMarkHomeworkClick}
                    />
                    <SimpleFirebaseTest />
                  </div>
                </div>
              </ProtectedRoute>
            } />
            
            <Route path="/profile" element={
              <ProtectedRoute>
                <Header onMenuToggle={handleMenuToggle} isSidebarOpen={isSidebarOpen} />
                <div className="main-content">
                  <ProfilePage />
                </div>
              </ProtectedRoute>
            } />
            
            {/* Add the new MarkdownMathDemo route */}
            <Route path="/markdown-demo" element={
              <ProtectedRoute>
                <Header onMenuToggle={handleMenuToggle} isSidebarOpen={isSidebarOpen} />
                <div className="main-content">
                  <div className="app">
                    <Sidebar 
                      isOpen={isSidebarOpen} 
                      onMarkingHistoryClick={handleMarkingHistoryClick}
                      onMarkHomeworkClick={handleMarkHomeworkClick}
                    />
                    <MarkdownMathDemo />
                  </div>
                </div>
              </ProtectedRoute>
            } />
            
            {/* Main page route - handles subscription success */}
            <Route path="/" element={
              <ProtectedRoute>
                <Header onMenuToggle={handleMenuToggle} isSidebarOpen={isSidebarOpen} />
                <div className="main-content">
                  <div className="app">
                    <Sidebar 
                      isOpen={isSidebarOpen} 
                      onMarkingHistoryClick={handleMarkingHistoryClick}
                      onMarkHomeworkClick={handleMarkHomeworkClick}
                    />
                    <div className="welcome-message">
                      <h1>Welcome to IntelliMark</h1>
                      <p>Your AI-powered homework marking assistant</p>
                    </div>
                  </div>
                </div>
              </ProtectedRoute>
            } />

            {/* Fallback route - redirect to login if no other route matches */}
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </div>
    </AuthProvider>
  );
}

/**
 * Main App component
 * @returns {JSX.Element} The main application with routing
 */
function App() {
  return (
    <Router future={{ 
      v7_startTransition: true,
      v7_relativeSplatPath: true 
    }}>
      <AppContent />
    </Router>
  );
}

export default App;

