import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import OptionalAuthRoute from './components/auth/OptionalAuthRoute';
import { Sidebar, Header } from './components/layout';
import AdminPage from './components/admin/AdminPage';
import MarkHomeworkPage from './components/markHomework/MarkHomeworkPageConsolidated';
import Login from './components/auth/Login';
import SubscriptionPage from './components/subscription/SubscriptionPage.tsx';
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


  const handleMarkingHistoryClick = async (result) => {
    try {
      // Fetch full session data including messages
      const response = await fetch(`http://localhost:5001/api/messages/session/${result.id}`);
      if (response.ok) {
        const sessionData = await response.json();
        if (sessionData.success && sessionData.session) {
          // Use full session data with messages
          setSelectedMarkingResult(sessionData.session);
        } else {
          // Fallback to sidebar data
          setSelectedMarkingResult(result);
        }
      } else {
        // Fallback to sidebar data
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
    // Reset to upload mode
    setSelectedMarkingResult(null);
    setMarkHomeworkResetKey(prev => prev + 1);
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
                      onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)}
                    />
                    <div className="right-side">
                      <Header onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)} isSidebarOpen={isSidebarOpen} />
                      <div className="mark-homework-main-content">
                        <MarkHomeworkPage 
                          key={markHomeworkResetKey}
                          selectedMarkingResult={selectedMarkingResult}
                          onClearSelectedResult={() => setSelectedMarkingResult(null)}
                          onMarkingResultSaved={handleMarkingResultSaved}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </OptionalAuthRoute>
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

