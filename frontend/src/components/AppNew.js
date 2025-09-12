/**
 * AppNew - Main Application with Simplified Design
 * 
 * Integrates MarkHomeworkPageNew and SidebarNew with localSessionService
 * Implements the new simplified flow: Upload → AI API → localSessionService → Display
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import MarkHomeworkPageNew from './MarkHomeworkPageNew';
import SidebarNew from './SidebarNew';
import localSessionService from '../services/localSessionService';
import './App.css';

const AppNew = () => {
  const { user, loading: authLoading } = useAuth();
  const [pageMode, setPageMode] = useState('upload'); // 'upload' | 'chat'
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [selectedMarkingResult, setSelectedMarkingResult] = useState(null);
  
  // ============================================================================
  // SESSION MANAGEMENT
  // ============================================================================
  
  const handleSessionSelect = (sessionId) => {
    setSelectedSessionId(sessionId);
    setSelectedMarkingResult({ id: sessionId });
  };
  
  const handleClearSelectedResult = () => {
    setSelectedMarkingResult(null);
    setSelectedSessionId(null);
  };
  
  const handleMarkingResultSaved = () => {
    // Refresh sidebar after saving
    localSessionService.refreshSidebar();
  };
  
  const handlePageModeChange = (mode) => {
    setPageMode(mode);
    if (mode === 'upload') {
      handleClearSelectedResult();
    }
  };
  
  // ============================================================================
  // EFFECTS
  // ============================================================================
  
  useEffect(() => {
    // Initialize sidebar sessions on mount
    localSessionService.refreshSidebar();
  }, []);
  
  // ============================================================================
  // RENDER
  // ============================================================================
  
  if (authLoading) {
    return (
      <div className="app-loading">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }
  
  return (
    <div className="app">
      <div className="app-layout">
        <SidebarNew
          onSessionSelect={handleSessionSelect}
          selectedSessionId={selectedSessionId}
          onPageModeChange={handlePageModeChange}
        />
        
        <main className="main-content">
          <MarkHomeworkPageNew
            selectedMarkingResult={selectedMarkingResult}
            onClearSelectedResult={handleClearSelectedResult}
            onMarkingResultSaved={handleMarkingResultSaved}
            onPageModeChange={handlePageModeChange}
          />
        </main>
      </div>
    </div>
  );
};

export default AppNew;
