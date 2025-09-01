import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import AdminPage from './components/AdminPage';
import MarkHomeworkPage from './components/MarkHomeworkPage';
import MarkdownMathDemo from './components/MarkdownMathDemo';
import './App.css';

/**
 * Main App component that manages the overall application state
 * @returns {JSX.Element} The main application layout
 */
function App() {

  // Using future flags to opt-in to React Router v7 behavior early
  // This eliminates all deprecation warnings:
  // - v7_startTransition: Wraps navigation updates in React.startTransition()
  // - v7_relativeSplatPath: Improves relative route resolution within splat routes
  return (
    <Router future={{ 
      v7_startTransition: true,
      v7_relativeSplatPath: true 
    }}>
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/mark-homework" element={
          <div className="app">
            <Sidebar />
            <MarkHomeworkPage />
          </div>
        } />

        <Route path="/markdown-demo" element={
          <div className="app">
            <Sidebar />
            <MarkdownMathDemo />
          </div>
        } />

        <Route path="/" element={
          <div className="app">
            <Sidebar />
            <div className="welcome-message">
              <h1>Welcome to Intellimark</h1>
              <p>Use the sidebar to navigate to different features:</p>
              <ul>
                <li><strong>Admin</strong> - Upload and manage past papers</li>
                <li><strong>Mark Homework</strong> - AI-powered homework marking</li>
                <li><strong>Markdown Demo</strong> - Test Markdown + LaTeX rendering</li>
              </ul>
            </div>
          </div>
        } />
      </Routes>
    </Router>
  );
}



export default App;

