import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import AdminPage from './components/AdminPage';
import MarkHomeworkPage from './components/MarkHomeworkPage';
import LatexTestPage from './components/LatexTestPage';
import FirebaseTest from './components/FirebaseTest';
import SimpleFirebaseTest from './components/SimpleFirebaseTest';
import ProfilePage from './components/ProfilePage';
import Login from './components/Login';
import MarkdownMathDemo from './components/MarkdownMathDemo';
import './App.css';

/**
 * Main App component that manages the overall application state
 * @returns {JSX.Element} The main application layout
 */
function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const handleMenuToggle = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  // Using future flags to opt-in to React Router v7 behavior early
  // This eliminates all deprecation warnings:
  // - v7_startTransition: Wraps navigation updates in React.startTransition()
  // - v7_relativeSplatPath: Improves relative route resolution within splat routes
  return (
    <AuthProvider>
      <Router future={{ 
        v7_startTransition: true,
        v7_relativeSplatPath: true 
      }}>
        <div className="app-container">
          <Routes>
            {/* Public route - no header/sidebar */}
            <Route path="/login" element={<Login />} />
            
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
                    <Sidebar isOpen={isSidebarOpen} />
                    <MarkHomeworkPage />
                  </div>
                </div>
              </ProtectedRoute>
            } />
            
            <Route path="/latex-test" element={
              <ProtectedRoute>
                <Header onMenuToggle={handleMenuToggle} isSidebarOpen={isSidebarOpen} />
                <div className="main-content">
                  <div className="app">
                    <Sidebar isOpen={isSidebarOpen} />
                    <LatexTestPage />
                  </div>
                </div>
              </ProtectedRoute>
            } />
            
            <Route path="/firebase-test" element={
              <ProtectedRoute>
                <Header onMenuToggle={handleMenuToggle} isSidebarOpen={isSidebarOpen} />
                <div className="main-content">
                  <div className="app">
                    <Sidebar isOpen={isSidebarOpen} />
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
                    <Sidebar isOpen={isSidebarOpen} />
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
                    <Sidebar isOpen={isSidebarOpen} />
                    <MarkdownMathDemo />
                  </div>
                </div>
              </ProtectedRoute>
            } />
            
            {/* Root route now redirects to mark-homework */}
            <Route path="/" element={<Navigate to="/mark-homework" replace />} />

            {/* Fallback route - redirect to login if no other route matches */}
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;

