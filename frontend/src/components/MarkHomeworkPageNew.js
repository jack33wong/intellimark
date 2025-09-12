/**
 * MarkHomeworkPage - New Simplified Design
 * 
 * Main flow: Upload image → AI API (returns full session) → localSessionService → Display
 * 
 * Design Principles:
 * - Only 1 full session in memory at a time
 * - Up to 50 lightweight sessions for sidebar
 * - Same data structure between frontend, backend, and memory
 * - Direct memory access, no complex sync
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import localSessionService from '../services/localSessionService';
import { UnifiedSession, LightweightSession, UnifiedMessage } from '../types/unifiedTypes';
import './MarkHomeworkPage.css';

const MarkHomeworkPageNew = ({ selectedMarkingResult, onClearSelectedResult, onMarkingResultSaved, onPageModeChange }) => {
  const { getAuthToken, user } = useAuth();
  
  // ============================================================================
  // STATE MANAGEMENT
  // ============================================================================
  
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedModel, setSelectedModel] = useState('chatgpt-4o');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [pageMode, setPageMode] = useState('upload'); // 'upload' | 'chat'
  
  // Chat state
  const [chatInput, setChatInput] = useState('');
  const [showInfoDropdown, setShowInfoDropdown] = useState(false);
  
  // Refs
  const fileInputRef = useRef(null);
  const chatContainerRef = useRef(null);
  const chatContentRef = useRef(null);
  
  // ============================================================================
  // LOCAL SESSION SERVICE INTEGRATION
  // ============================================================================
  
  const [sessionState, setSessionState] = useState(localSessionService.getState());
  
  useEffect(() => {
    const unsubscribe = localSessionService.subscribe(setSessionState);
    return unsubscribe;
  }, []);
  
  // ============================================================================
  // COMPUTED VALUES
  // ============================================================================
  
  const currentSession = sessionState.currentSession;
  const sidebarSessions = sessionState.sidebarSessions;
  const isLoading = sessionState.isLoading;
  const isProcessingState = sessionState.isProcessing;
  
  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================
  
  const scrollToBottom = useCallback(() => {
    if (chatContentRef.current) {
      chatContentRef.current.scrollTop = chatContentRef.current.scrollHeight;
    }
  }, []);
  
  const generateId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // ============================================================================
  // FILE HANDLING
  // ============================================================================
  
  const handleFileSelect = useCallback((event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file);
      setError(null);
    }
  }, []);
  
  const handleDrop = useCallback((event) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
      setSelectedFile(file);
      setError(null);
    }
  }, []);
  
  const handleDragOver = useCallback((event) => {
    event.preventDefault();
  }, []);
  
  // ============================================================================
  // MAIN PROCESSING FLOW
  // ============================================================================
  
  const handleAnalyzeImage = useCallback(async () => {
    if (!selectedFile) return;
    
    setIsProcessing(true);
    setError(null);
    
    try {
      // Convert file to base64
      const reader = new FileReader();
      const imageData = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });
      
      // Determine mode based on file name or user selection
      const mode = selectedFile.name.toLowerCase().includes('question') ? 'question' : 'marking';
      
      // Process image through AI API - returns full session data
      const session = await localSessionService.processImage(imageData, selectedModel, mode);
      
      // Session is automatically loaded into memory by localSessionService
      // Switch to chat mode
      setPageMode('chat');
      
      // Clear file selection
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      
    } catch (error) {
      console.error('Error processing image:', error);
      setError(error.message || 'Failed to process image. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  }, [selectedFile, selectedModel]);
  
  // ============================================================================
  // CHAT FUNCTIONALITY
  // ============================================================================
  
  const handleSendMessage = useCallback(async () => {
    if (!chatInput.trim() || !currentSession) return;
    
    try {
      // Send message through localSessionService
      await localSessionService.sendMessage(chatInput.trim());
      
      // Clear input
      setChatInput('');
      
      // Scroll to bottom
      setTimeout(scrollToBottom, 100);
      
    } catch (error) {
      console.error('Error sending message:', error);
      setError(error.message || 'Failed to send message. Please try again.');
    }
  }, [chatInput, currentSession, scrollToBottom]);
  
  const handleKeyPress = useCallback((event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);
  
  // ============================================================================
  // SESSION MANAGEMENT
  // ============================================================================
  
  const handleLoadSession = useCallback(async (sessionId) => {
    try {
      await localSessionService.loadSession(sessionId);
      setPageMode('chat');
    } catch (error) {
      console.error('Error loading session:', error);
      setError(error.message || 'Failed to load session.');
    }
  }, []);
  
  const handleCreateNewSession = useCallback(async () => {
    try {
      const sessionId = await localSessionService.createSession({
        title: 'New Chat Session',
        messageType: 'Chat',
        userId: user?.uid || 'anonymous'
      });
      
      setPageMode('chat');
    } catch (error) {
      console.error('Error creating session:', error);
      setError(error.message || 'Failed to create new session.');
    }
  }, [user]);
  
  // ============================================================================
  // EFFECTS
  // ============================================================================
  
  useEffect(() => {
    // Load sidebar sessions on mount
    localSessionService.refreshSidebar();
  }, []);
  
  useEffect(() => {
    // Handle selected marking result from sidebar
    if (selectedMarkingResult) {
      handleLoadSession(selectedMarkingResult.id);
    }
  }, [selectedMarkingResult, handleLoadSession]);
  
  // ============================================================================
  // RENDER HELPERS
  // ============================================================================
  
  const renderUploadMode = () => (
    <div className="mark-homework-page upload-mode">
      <div className="upload-container">
        <h1>Mark Homework</h1>
        <p>Upload an image to get AI-powered marking assistance</p>
        
        <div className="upload-area"
             onDrop={handleDrop}
             onDragOver={handleDragOver}
             onClick={() => fileInputRef.current?.click()}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          
          {selectedFile ? (
            <div className="file-selected">
              <img 
                src={URL.createObjectURL(selectedFile)} 
                alt="Selected file"
                className="preview-image"
              />
              <p>{selectedFile.name}</p>
              <button 
                className="btn btn-primary"
                onClick={handleAnalyzeImage}
                disabled={isProcessing}
              >
                {isProcessing ? 'Processing...' : 'Analyze Image'}
              </button>
            </div>
          ) : (
            <div className="upload-placeholder">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7,10 12,15 17,10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <p>Click to upload or drag and drop</p>
              <p className="upload-hint">PNG, JPG, GIF up to 10MB</p>
            </div>
          )}
        </div>
        
        <div className="model-selection">
          <label>AI Model:</label>
          <select 
            value={selectedModel} 
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={isProcessing}
          >
            <option value="chatgpt-4o">ChatGPT-4o</option>
            <option value="chatgpt-5">ChatGPT-5</option>
            <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
          </select>
        </div>
        
        {error && (
          <div className="error-message">
            {error}
          </div>
        )}
      </div>
    </div>
  );
  
  const renderChatMode = () => (
    <div className="mark-homework-page chat-mode">
      <div className="chat-container" ref={chatContainerRef}>
        <div className="chat-header">
          <div className="chat-header-content">
            <div className="chat-header-left">
              <h1>{currentSession?.title || 'Chat Session'}</h1>
            </div>
            <div className="chat-header-right">
              <button 
                className="btn btn-secondary"
                onClick={() => setPageMode('upload')}
              >
                New Upload
              </button>
            </div>
          </div>
        </div>
        
        <div className="chat-content" ref={chatContentRef}>
          <div className="chat-messages">
            {currentSession?.messages?.map((message) => (
              <div
                key={message.id}
                className={`chat-message chat-message-${message.role}`}
              >
                <div className="message-header">
                  <span className="message-role">
                    {message.role === 'user' ? 'You' : 'AI'}
                  </span>
                  <span className="message-time">{message.timestamp}</span>
                  {message.apiUsed && (
                    <span className="message-api">via {message.apiUsed}</span>
                  )}
                </div>
                
                <div className="message-content">
                  {message.type === 'question_original' && message.detectedQuestion && (
                    <div className="question-metadata">
                      <h4>Question {message.detectedQuestion.questionNumber}</h4>
                      <p>{message.detectedQuestion.questionText}</p>
                      <div className="confidence-badge">
                        Confidence: {Math.round(message.detectedQuestion.confidence * 100)}%
                      </div>
                    </div>
                  )}
                  
                  {message.imageData && (
                    <div className="message-image">
                      <img 
                        src={message.imageData} 
                        alt="Message content" 
                        className="content-image"
                      />
                    </div>
                  )}
                  
                  <div className="message-text">
                    {typeof message.content === 'string' ? message.content : String(message.content || '')}
                  </div>
                  
                  {message.metadata && (
                    <div className="message-metadata">
                      <div className="metadata-item">
                        <span>Processing Time:</span>
                        <span>{message.metadata.processingTimeMs}ms</span>
                      </div>
                      {message.metadata.tokens && (
                        <div className="metadata-item">
                          <span>Tokens:</span>
                          <span>{message.metadata.tokens.join(', ')}</span>
                        </div>
                      )}
                      {message.metadata.confidence && (
                        <div className="metadata-item">
                          <span>Confidence:</span>
                          <span>{Math.round(message.metadata.confidence * 100)}%</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="chat-input">
          <div className="input-container">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your message..."
              disabled={isProcessingState}
            />
            <button 
              onClick={handleSendMessage}
              disabled={!chatInput.trim() || isProcessingState}
              className="send-button"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
  
  // ============================================================================
  // MAIN RENDER
  // ============================================================================
  
  return (
    <>
      {pageMode === 'upload' ? renderUploadMode() : renderChatMode()}
      
      {/* Sidebar would be rendered by parent component */}
      {/* This component focuses on the main chat functionality */}
    </>
  );
};

export default MarkHomeworkPageNew;
