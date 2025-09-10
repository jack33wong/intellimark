import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Bot, ChevronDown } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../common/Button';
import ImageUpload from './ImageUpload';
import ChatInterface from './ChatInterface';
import { 
  PAGE_MODES, 
  AI_MODELS, 
  SUBSCRIPTION_DELAYS
} from '../../utils/constants';
import { generateId } from '../../utils/helpers';
// CSS imported via App.css to avoid webpack circular dependency

/**
 * Main Mark Homework Page component
 * @param {Object} props - Component props
 * @param {Object|null} props.selectedMarkingResult - Pre-selected marking result
 * @param {Function} props.onClearSelectedResult - Clear selected result handler
 * @param {Function} props.onMarkingResultSaved - Marking result saved handler
 * @param {Function} props.onPageModeChange - Page mode change handler
 */
const MarkHomeworkPage = ({ 
  selectedMarkingResult, 
  onClearSelectedResult, 
  onMarkingResultSaved, 
  onPageModeChange 
}) => {
  // === AUTH ===
  const { getAuthToken } = useAuth();
  
  // === CORE STATE ===
  const [pageMode, setPageMode] = useState(PAGE_MODES.UPLOAD);
  
  // Notify parent of page mode changes
  useEffect(() => {
    if (onPageModeChange) {
      onPageModeChange(pageMode);
    }
  }, [pageMode, onPageModeChange]);
  
  // === UPLOAD MODE STATE ===
  const [selectedFile, setSelectedFile] = useState(null);
  // const [previewUrl, setPreviewUrl] = useState(null); // Not used in refactored version
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [selectedModel, setSelectedModel] = useState(AI_MODELS.GPT4);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  
  // === CHAT MODE STATE ===
  const [chatMessages, setChatMessages] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [isDelayActive, setIsDelayActive] = useState(false);
  const [delayCountdown, setDelayCountdown] = useState(0);
  const [lastRequestTime, setLastRequestTime] = useState(0);
  
  // === SUBSCRIPTION STATE ===
  const [subscriptionType] = useState('free');
  
  // Subscription delay configuration
  const subscriptionDelays = useMemo(() => ({
    free: parseInt(process.env.REACT_APP_SUBSCRIPTION_DELAY_FREE) || SUBSCRIPTION_DELAYS.FREE,
    pro: parseInt(process.env.REACT_APP_SUBSCRIPTION_DELAY_PRO) || SUBSCRIPTION_DELAYS.PRO,
    enterprise: parseInt(process.env.REACT_APP_SUBSCRIPTION_DELAY_ENTERPRISE) || SUBSCRIPTION_DELAYS.ENTERPRISE
  }), []);
  
  // Get current delay based on subscription
  const getCurrentDelay = useCallback(() => {
    return subscriptionDelays[subscriptionType] || parseInt(process.env.REACT_APP_SUBSCRIPTION_DELAY_DEFAULT) || 3000;
  }, [subscriptionType, subscriptionDelays]);
  
  // Check if enough time has passed since last request
  const canMakeRequest = useCallback(() => {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    return timeSinceLastRequest >= getCurrentDelay();
  }, [lastRequestTime, getCurrentDelay]);
  
  // Get remaining delay time
  const getRemainingDelay = useCallback(() => {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    const delay = getCurrentDelay();
    return Math.max(0, delay - timeSinceLastRequest);
  }, [lastRequestTime, getCurrentDelay]);
  
  // Handle delay countdown
  useEffect(() => {
    if (!isDelayActive) return;
    
    const interval = setInterval(() => {
      const remaining = getRemainingDelay();
      setDelayCountdown(Math.ceil(remaining / 1000));
      
      if (remaining <= 0) {
        setIsDelayActive(false);
        setDelayCountdown(0);
        clearInterval(interval);
      }
    }, 100);
    
    return () => clearInterval(interval);
  }, [isDelayActive, getRemainingDelay]);
  
  // === FILE HANDLING ===
  const handleFileSelect = useCallback((file) => {
    setSelectedFile(file);
    setError(null);
  }, []);
  
  const handleFileClear = useCallback(() => {
    setSelectedFile(null);
    setError(null);
  }, []);
  
  // === MODEL SELECTION ===
  const handleModelSelect = useCallback((model) => {
    setSelectedModel(model);
    setIsModelDropdownOpen(false);
  }, []);
  
  // === CHAT HANDLING ===
  const handleSendMessage = useCallback(async (message) => {
    if (!canMakeRequest()) {
      setError('Please wait before sending another message');
      return;
    }
    
    setIsProcessing(true);
    setLastRequestTime(Date.now());
    setIsDelayActive(true);
    
    try {
      const authToken = await getAuthToken();
      const headers = {
        'Content-Type': 'application/json',
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      const response = await fetch('/api/chat/', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: message.content,
          sessionId: currentSessionId,
          model: selectedModel,
          mode: 'question'
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.success) {
          const aiResponse = {
            id: generateId('msg'),
            role: 'assistant',
            content: data.response,
            timestamp: new Date().toLocaleTimeString(),
            apiUsed: data.apiUsed,
            showRaw: false
          };
          
          setChatMessages(prev => [...prev, message, aiResponse]);
        } else {
          setError(data.error || 'Failed to get AI response');
        }
      } else {
        setError('Failed to send message');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setError('Network error. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  }, [canMakeRequest, getAuthToken, currentSessionId, selectedModel]);
  
  // === IMAGE PROCESSING ===
  const handleAnalyzeImage = useCallback(async () => {
    if (!selectedFile) return;
    
    setIsProcessing(true);
    setError(null);
    
    try {
      // Convert file to base64
      const imageData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });
      
      const authToken = await getAuthToken();
      const headers = {
        'Content-Type': 'application/json',
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      const response = await fetch('/api/marking/', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          imageData,
          model: selectedModel,
          mode: 'question'
        }),
      });
      
      if (response.ok) {
        const result = await response.json();
        
        if (result.isQuestionOnly) {
          // Handle question-only mode
          setCurrentSessionId(result.sessionId);
          
          const initialUserMessage = {
            id: generateId('msg'),
            role: 'user',
            content: 'I have a question about this image. Can you help me understand it?',
            timestamp: new Date().toLocaleTimeString(),
            type: 'question_original',
            imageData: imageData,
            fileName: selectedFile.name,
            detectedQuestion: {
              examDetails: result.questionDetection?.match?.markingScheme?.examDetails || {},
              questionNumber: result.questionDetection?.match?.questionNumber || 'Unknown',
              questionText: result.questionDetection?.match?.questionText || '',
              confidence: result.questionDetection?.match?.markingScheme?.confidence || 0
            }
          };
          
          // Get AI response
          try {
            const chatResponse = await fetch('/api/chat/', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                message: 'I have a question about this image. Can you help me understand it?',
                imageData: imageData,
                model: selectedModel,
                sessionId: result.sessionId,
                mode: 'question'
              }),
            });
            
            if (chatResponse.ok) {
              const chatData = await chatResponse.json();
              const aiResponse = {
                id: generateId('msg'),
                role: 'assistant',
                content: chatData.response,
                timestamp: new Date().toLocaleTimeString(),
                type: 'question_response'
              };
              
              setChatMessages([initialUserMessage, aiResponse]);
            } else {
              setChatMessages([initialUserMessage]);
            }
          } catch (error) {
            console.error('Error getting AI response:', error);
            setChatMessages([initialUserMessage]);
          }
          
          setPageMode(PAGE_MODES.CHAT);
        } else {
          // Handle marking mode
          setError('This image appears to be for marking, not questions. Please use the marking mode.');
        }
      } else {
        setError('Failed to process image');
      }
    } catch (error) {
      console.error('Error processing image:', error);
      setError('Failed to process image. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  }, [selectedFile, selectedModel, getAuthToken]);
  
  // === RENDER ===
  if (pageMode === PAGE_MODES.CHAT) {
    return (
      <div className="mark-homework-page chat-mode">
        <div className="chat-header">
          <h2>Question Mode</h2>
          <Button
            variant="ghost"
            onClick={() => setPageMode(PAGE_MODES.UPLOAD)}
          >
            Upload New Image
          </Button>
        </div>
        
        <ChatInterface
          messages={chatMessages}
          onSendMessage={handleSendMessage}
          isProcessing={isProcessing}
          disabled={!canMakeRequest()}
        />
        
        {delayCountdown > 0 && (
          <div className="delay-indicator">
            Please wait {delayCountdown} seconds before sending another message
          </div>
        )}
      </div>
    );
  }
  
  return (
    <div className="mark-homework-page upload-mode">
      <div className="upload-section">
        <h2>Upload Question Image</h2>
        <p>Upload an image with a question you'd like help with</p>
        
        <div className="image-upload-container">
          <ImageUpload
            selectedFile={selectedFile}
            onFileSelect={handleFileSelect}
            disabled={isProcessing}
          />
        </div>
        
        {error && (
          <div className="error-message">
            <p>{error}</p>
          </div>
        )}
        
        <div className="model-selection">
          <label>AI Model:</label>
          <div className="model-dropdown">
            <button
              className="model-button"
              onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
            >
              {selectedModel}
              <ChevronDown size={16} />
            </button>
            {isModelDropdownOpen && (
              <div className="model-options">
                {Object.values(AI_MODELS).map(model => (
                  <button
                    key={model}
                    className="model-option"
                    onClick={() => handleModelSelect(model)}
                  >
                    {model}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        
        <div className="action-buttons">
          <Button
            variant="ghost"
            onClick={handleFileClear}
            disabled={!selectedFile || isProcessing}
          >
            Clear
          </Button>
          <Button
            variant="primary"
            onClick={handleAnalyzeImage}
            disabled={!selectedFile || isProcessing}
            loading={isProcessing}
          >
            <Bot size={20} />
            Analyze Question
          </Button>
        </div>
      </div>
    </div>
  );
};

export default MarkHomeworkPage;
