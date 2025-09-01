import React, { useState } from 'react';
import { useFirestoreChat } from '../hooks/useFirestoreChat';
import './ChatContextDemo.css';

/**
 * Chat Context Demo Component
 * Demonstrates the new chat context management system
 */
export default function ChatContextDemo() {
  const [userId] = useState('demo-user-123');
  const [message, setMessage] = useState('');
  const [imageData, setImageData] = useState('');
  
  const {
    chatSessions,
    currentSessionId,
    currentSession,
    isLoading,
    error,
    createNewChat,
    switchToSession,
    updateSessionTitle,
    deleteSession,
    addMessageToCurrentSession,
    clearAllSessions,
    refreshSessions
  } = useFirestoreChat(userId);

  const handleSendMessage = async () => {
    if (!message.trim() || !currentSessionId) return;

    try {
      // Add user message to current session
      await addMessageToCurrentSession({
        role: 'user',
        content: message,
        imageData: imageData || undefined,
        imageName: imageData ? 'uploaded-image.png' : undefined
      });

      // In a real app, you would send this to the chat API
      // and then add the AI response to the session
      // For demo purposes, we'll simulate an AI response that builds on context
      const aiResponse = generateContextualResponse(message, currentSession?.messages || []);
      
      await addMessageToCurrentSession({
        role: 'assistant',
        content: aiResponse,
        apiUsed: 'Demo AI (Context-Aware)'
      });
      
      console.log('Message added to session:', currentSessionId);
      
      setMessage('');
      setImageData('');
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  // Simulate context-aware AI responses for demo purposes
  const generateContextualResponse = (userMessage, messageHistory) => {
    const recentMessages = messageHistory.slice(-4); // Last 4 messages for context
    
    if (recentMessages.length === 0) {
      return "Hello! I'm your math tutor. I can help you with math problems. What would you like to work on today?";
    }
    
    // Check if this is a follow-up question
    const hasPreviousContext = recentMessages.some(msg => msg.role === 'assistant');
    
    if (hasPreviousContext) {
      // Build upon previous context
      const lastAssistantMessage = recentMessages.reverse().find(msg => msg.role === 'assistant');
      
      if (userMessage.toLowerCase().includes('why') || userMessage.toLowerCase().includes('explain')) {
        return `Great question! Let me explain that further. Based on what we discussed earlier, ${lastAssistantMessage?.content ? 'the concept we covered' : 'the math principle'} applies here because... [This response builds on our previous conversation]`;
      } else if (userMessage.toLowerCase().includes('next') || userMessage.toLowerCase().includes('continue')) {
        return `Perfect! Let's continue from where we left off. The next step in our solution is... [Continuing the mathematical process we started]`;
      } else if (userMessage.toLowerCase().includes('help') || userMessage.toLowerCase().includes('stuck')) {
        return `I understand you're stuck. Let me help you get unstuck by building on what we've already covered. Remember when we discussed ${lastAssistantMessage?.content ? 'that concept' : 'the previous step'}? Well, now we need to... [Providing contextual help]`;
      } else if (userMessage.toLowerCase().includes('remember') || userMessage.toLowerCase().includes('said')) {
        return `Yes, I remember! We discussed that earlier. Let me build on what we covered... [Referencing previous conversation]`;
      } else {
        return `I see you're asking about "${userMessage}". This relates to what we've been working on. Let me continue our discussion by building on what we've already covered... [Building on previous context]`;
      }
    } else {
      // First interaction
      return `Thanks for your message: "${userMessage}". I'm here to help you with math! Let me start by explaining... [Beginning the tutoring session]`;
    }
  };

  const handleCreateNewChat = async () => {
    try {
      await createNewChat();
      console.log('New chat session created');
    } catch (err) {
      console.error('Failed to create new chat:', err);
    }
  };

  const handleSwitchSession = (sessionId) => {
    switchToSession(sessionId);
  };

  const handleDeleteSession = async (sessionId) => {
    try {
      await deleteSession(sessionId);
      console.log('Session deleted:', sessionId);
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const handleUpdateTitle = async (sessionId, newTitle) => {
    try {
      await updateSessionTitle(sessionId, newTitle);
      console.log('Session title updated');
    } catch (err) {
      console.error('Failed to update title:', err);
    }
  };

  if (isLoading) {
    return <div className="chat-demo">Loading chat sessions...</div>;
  }

  if (error) {
    return (
      <div className="chat-demo">
        <div className="error">Error: {error}</div>
        <button onClick={refreshSessions}>Retry</button>
      </div>
    );
  }

  return (
    <div className="chat-demo">
      <h2>Chat Context Management Demo</h2>
      
      {/* Context Explanation */}
      <div className="context-explanation">
        <h3>🎯 How Conversation Context Works</h3>
        <p>
          <strong>This demo shows how the AI maintains context within the same conversation:</strong>
        </p>
        <ul>
          <li>✅ <strong>Same Session Context:</strong> The AI remembers everything discussed in the current session</li>
          <li>✅ <strong>Building on Previous Messages:</strong> Responses reference and build upon earlier parts of the conversation</li>
          <li>✅ <strong>No Repetition:</strong> The AI won't repeat what it already explained unless you ask for clarification</li>
          <li>✅ <strong>Continuous Learning:</strong> Each response considers the full conversation history</li>
        </ul>
        <p>
          <em>Try asking follow-up questions like "Why does that work?" or "What's the next step?" to see context in action!</em>
        </p>
      </div>
      
      {/* Session Management */}
      <div className="session-controls">
        <button onClick={handleCreateNewChat} className="btn-primary">
          Create New Chat
        </button>
        <button onClick={() => refreshSessions()} className="btn-secondary">
          Refresh Sessions
        </button>
        <button onClick={() => clearAllSessions()} className="btn-danger">
          Clear All Sessions
        </button>
      </div>

      {/* Session List */}
      <div className="session-list">
        <h3>Chat Sessions ({chatSessions.length})</h3>
        {chatSessions.map(session => (
          <div 
            key={session.id} 
            className={`session-item ${session.id === currentSessionId ? 'active' : ''}`}
          >
            <div className="session-header">
              <span 
                className="session-title"
                onClick={() => handleSwitchSession(session.id)}
              >
                {session.title}
              </span>
              <div className="session-actions">
                <button 
                  onClick={() => {
                    const newTitle = prompt('Enter new title:', session.title);
                    if (newTitle) handleUpdateTitle(session.id, newTitle);
                  }}
                  className="btn-small"
                >
                  Edit
                </button>
                <button 
                  onClick={() => handleDeleteSession(session.id)}
                  className="btn-small btn-danger"
                >
                  Delete
                </button>
              </div>
            </div>
            <div className="session-info">
              <span>Messages: {session.messages.length}</span>
              <span>Created: {new Date(session.timestamp).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Current Session */}
      {currentSession && (
        <div className="current-session">
          <h3>Current Session: {currentSession.title}</h3>
          
          {/* Message Input */}
          <div className="message-input">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your message..."
              rows={3}
            />
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (e) => setImageData(e.target.result);
                  reader.readAsDataURL(file);
                }
              }}
            />
            <button 
              onClick={handleSendMessage}
              disabled={!message.trim() || !currentSessionId}
              className="btn-primary"
            >
              Send Message
            </button>
          </div>

          {/* Message History */}
          <div className="message-history">
            <h4>Message History ({currentSession.messages.length})</h4>
            
            {/* Context Display */}
            {currentSession.messages.length > 1 && (
              <div className="context-display">
                <h5>🎯 AI Context (Last 4 Messages)</h5>
                <div className="context-messages">
                  {currentSession.messages.slice(-4).map((msg, index) => (
                    <div key={`context-${index}`} className={`context-message ${msg.role}`}>
                      <span className="role-badge">{msg.role === 'user' ? 'Student' : 'Tutor'}</span>
                      <span className="content-preview">{msg.content.substring(0, 100)}...</span>
                    </div>
                  ))}
                </div>
                <p className="context-note">
                  <em>The AI uses these recent messages to maintain conversation context and build upon previous explanations.</em>
                </p>
              </div>
            )}
            
            {currentSession.messages.map((msg, index) => (
              <div key={index} className={`message ${msg.role}`}>
                <div className="message-header">
                  <span className="role">{msg.role === 'user' ? 'You' : 'AI'}</span>
                  <span className="timestamp">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="content">{msg.content}</div>
                {msg.imageData && (
                  <div className="image-attachment">
                    <img src={msg.imageData} alt="Attached" style={{ maxWidth: '200px' }} />
                  </div>
                )}
                {msg.apiUsed && (
                  <div className="api-info">API: {msg.apiUsed}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Debug Info */}
      <div className="debug-info">
        <h4>Debug Information</h4>
        <p>Current Session ID: {currentSessionId || 'None'}</p>
        <p>Total Sessions: {chatSessions.length}</p>
        <p>User ID: {userId}</p>
      </div>
    </div>
  );
}
