import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import AdminPage from './components/AdminPage';
import MarkHomeworkPage from './components/MarkHomeworkPage';
import LatexTestPage from './components/LatexTestPage';
import './App.css';

/**
 * Main App component that manages the overall application state
 * @returns {JSX.Element} The main application layout
 */
function App() {
  const [currentChat, setCurrentChat] = useState(null);
  const [chats, setChats] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // API base URL for development vs production
  const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '';

  /**
   * Create a new chat session (DISABLED)
   */
  // const createNewChat = async () => {
  //   try {
  //     setIsLoading(true);
  //     const response = await fetch(`${API_BASE}/api/chat/new`, {
  //       method: 'POST',
  //       headers: {
  //         'Content-Type': 'application/json',
  //       },
  //     });
  //     
  //     if (response.ok) {
  //       const newChat = await response.json();
  //       setChats(prevChats => [newChat, ...prevChats]);
  //       setCurrentChat(newChat);
  //     }
  //   } catch (error) {
  //     console.error('Failed to create new chat:', error);
  //   } finally {
  //     setIsLoading(false);
  //   }
  // };

  /**
   * Load existing chats from the backend
   */
  const loadChats = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/chat`);
      if (response.ok) {
        const chatList = await response.json();
        setChats(chatList);
        
        // Set the first chat as current if no chat is selected
        if (chatList.length > 0 && !currentChat) {
          setCurrentChat(chatList[0]);
        }
      }
    } catch (error) {
      console.error('Failed to load chats:', error);
    }
  };

  /**
   * Delete a chat session
   */
  const deleteChat = async (chatId) => {
    try {
      const response = await fetch(`${API_BASE}/api/chat/${chatId}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        setChats(prevChats => prevChats.filter(chat => chat.id !== chatId));
        
        // If the deleted chat was the current chat, select another one
        if (currentChat && currentChat.id === chatId) {
          const remainingChats = chats.filter(chat => chat.id !== chatId);
          setCurrentChat(remainingChats.length > 0 ? remainingChats[0] : null);
        }
      }
    } catch (error) {
      console.error('Failed to delete chat:', error);
    }
  };

  /**
   * Update chat title when messages are sent
   */
  const updateChatTitle = (chatId, newTitle) => {
    setChats(prevChats =>
      prevChats.map(chat =>
        chat.id === chatId ? { ...chat, title: newTitle } : chat
      )
    );
    
    if (currentChat && currentChat.id === chatId) {
      setCurrentChat(prev => ({ ...prev, title: newTitle }));
    }
  };

  // Load chats on component mount
  useEffect(() => {
    loadChats();
  }, []);

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
            <Sidebar
              chats={chats}
              currentChat={currentChat}
              onSelectChat={setCurrentChat}
              onDeleteChat={deleteChat}
              isLoading={isLoading}
            />
            <MarkHomeworkPage />
          </div>
        } />
        <Route path="/latex-test" element={
          <div className="app">
            <Sidebar
              chats={chats}
              currentChat={currentChat}
              onSelectChat={setCurrentChat}
              onDeleteChat={deleteChat}
              isLoading={isLoading}
            />
            <LatexTestPage />
          </div>
        } />
        <Route path="/" element={
          <div className="app">
            <Sidebar
              chats={chats}
              currentChat={currentChat}
              onSelectChat={setCurrentChat}
              onDeleteChat={deleteChat}
              isLoading={isLoading}
            />
            <ChatInterface
              currentChat={currentChat}
              onUpdateChatTitle={updateChatTitle}
            />
          </div>
        } />
      </Routes>
    </Router>
  );
}



export default App;

