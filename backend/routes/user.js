const express = require('express');
const router = express.Router();

/**
 * Get user progress statistics
 * @route GET /api/user/progress
 * @returns {Object} User progress data
 */
router.get('/progress', (req, res) => {
  try {
    // Mock user progress data
    // In production, this would come from a database
    const progress = {
      totalChats: 15,
      totalMessages: 127,
      averageResponseTime: '2.3s',
      topicsCovered: ['Mathematics', 'Science', 'History', 'Literature'],
      weeklyActivity: [
        { week: 'Week 1', chats: 3, messages: 25 },
        { week: 'Week 2', chats: 5, messages: 42 },
        { week: 'Week 3', chats: 4, messages: 35 },
        { week: 'Week 4', chats: 3, messages: 25 }
      ],
      learningStreak: 7,
      lastActive: new Date().toISOString()
    };
    
    res.json(progress);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve user progress' });
  }
});

/**
 * Get admin dashboard data
 * @route GET /api/user/admin
 * @returns {Object} Admin dashboard statistics
 */
router.get('/admin', (req, res) => {
  try {
    // Mock admin data
    // In production, this would include real analytics and user management
    const adminData = {
      totalUsers: 1250,
      activeUsers: 847,
      totalChats: 15600,
      totalMessages: 89000,
      systemStatus: 'Healthy',
      recentActivity: [
        { action: 'New user registered', timestamp: new Date().toISOString() },
        { action: 'Chat session started', timestamp: new Date().toISOString() },
        { action: 'Message sent', timestamp: new Date().toISOString() }
      ],
      performance: {
        averageResponseTime: '1.8s',
        uptime: '99.9%',
        serverLoad: '45%'
      }
    };
    
    res.json(adminData);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve admin data' });
  }
});

module.exports = router;
