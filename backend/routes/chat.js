const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// In-memory storage for demo purposes
// In production, this would be replaced with a database
let chats = [];
let messages = [];

/**
 * Create a new chat session
 * @route POST /api/chat/new
 * @returns {Object} New chat object with ID and timestamp
 */
router.post('/new', (req, res) => {
  try {
    const newChat = {
      id: uuidv4(),
      title: 'New Chat',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0
    };
    
    chats.unshift(newChat); // Add to beginning of array
    res.status(201).json(newChat);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create new chat' });
  }
});

/**
 * Send a message in a chat
 * @route POST /api/chat/:chatId/message
 * @param {string} chatId - The chat ID
 * @returns {Object} The sent message and AI response
 */
router.post('/:chatId/message', (req, res) => {
  try {
    const { chatId } = req.params;
    const { content } = req.body;
    
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Message content is required' });
    }
    
    const chat = chats.find(c => c.id === chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    const userMessage = {
      id: uuidv4(),
      chatId,
      content,
      sender: 'user',
      timestamp: new Date().toISOString()
    };
    
    // Simulate AI response
    const aiResponse = {
      id: uuidv4(),
      chatId,
      content: `This is a simulated AI response to: "${content}"`,
      sender: 'ai',
      timestamp: new Date().toISOString()
    };
    
    messages.push(userMessage, aiResponse);
    
    // Update chat metadata
    chat.messageCount += 2;
    chat.updatedAt = new Date().toISOString();
    chat.title = content.length > 50 ? content.substring(0, 50) + '...' : content;
    
    res.json({
      userMessage,
      aiResponse,
      chat
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

/**
 * Get chat history
 * @route GET /api/chat/:chatId/messages
 * @param {string} chatId - The chat ID
 * @returns {Array} Array of messages in the chat
 */
router.get('/:chatId/messages', (req, res) => {
  try {
    const { chatId } = req.params;
    
    const chatMessages = messages
      .filter(m => m.chatId === chatId)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    res.json(chatMessages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve messages' });
  }
});

/**
 * Get all chats for the user
 * @route GET /api/chat
 * @returns {Array} Array of user's chats
 */
router.get('/', (req, res) => {
  try {
    res.json(chats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve chats' });
  }
});

/**
 * Delete a chat
 * @route DELETE /api/chat/:chatId
 * @param {string} chatId - The chat ID
 * @returns {Object} Success message
 */
router.delete('/:chatId', (req, res) => {
  try {
    const { chatId } = req.params;
    
    const chatIndex = chats.findIndex(c => c.id === chatId);
    if (chatIndex === -1) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Remove chat and its messages
    chats.splice(chatIndex, 1);
    messages = messages.filter(m => m.chatId !== chatId);
    
    res.json({ message: 'Chat deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete chat' });
  }
});

module.exports = router;
