import express from 'express';
import { FirestoreService } from '../services/firestoreService';

const router = express.Router();

// Test endpoint to check Firestore session creation and retrieval
router.post('/firestore-session', async (req, res) => {
  try {
    console.log('🧪 Testing Firestore session creation...');
    
    // Create a test session
    const sessionData = {
      title: 'Test Session - ' + new Date().toISOString(),
      messages: [],
      userId: 'test-user',
      messageType: 'Chat' as const
    };
    
    console.log('🧪 Creating session with data:', sessionData);
    const sessionId = await FirestoreService.createChatSession(sessionData);
    console.log('🧪 Session created:', sessionId);
    
    // Try to retrieve the session
    console.log('🧪 Retrieving sessions for test-user...');
    const sessions = await FirestoreService.getChatSessions('test-user');
    console.log('🧪 Found sessions:', sessions.length);
    
    res.json({
      success: true,
      sessionId: sessionId,
      sessionsFound: sessions.length,
      sessions: sessions
    });
    
  } catch (error) {
    console.error('🧪 Test failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Test endpoint to check if anonymous sessions exist
router.get('/anonymous-sessions', async (req, res) => {
  try {
    console.log('🧪 Testing anonymous session retrieval...');
    
    const sessions = await FirestoreService.getChatSessions('anonymous');
    console.log('🧪 Found anonymous sessions:', sessions.length);
    
    res.json({
      success: true,
      sessionsFound: sessions.length,
      sessions: sessions
    });
    
  } catch (error) {
    console.error('🧪 Anonymous test failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
