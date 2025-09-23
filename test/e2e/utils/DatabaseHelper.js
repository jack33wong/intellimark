const admin = require('firebase-admin');
const path = require('path');

class DatabaseHelper {
  constructor() {
    this.db = null;
    this.isInitialized = false;
  }

  async connectToFirestore() {
    if (this.isInitialized) {
      return this.db;
    }

    try {
      // Initialize Firebase Admin SDK
      const serviceAccountPath = path.join(__dirname, '../../../backend/intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccountPath),
        projectId: 'intellimark-6649e'
      });

      this.db = admin.firestore();
      this.isInitialized = true;
      
      console.log('✅ Connected to Firestore successfully');
      return this.db;
    } catch (error) {
      console.error('❌ Failed to connect to Firestore:', error);
      throw error;
    }
  }

  async getUnifiedSession(sessionId) {
    await this.connectToFirestore();
    
    try {
      const sessionDoc = await this.db.collection('unifiedSessions').doc(sessionId).get();
      
      if (sessionDoc.exists) {
        return {
          id: sessionDoc.id,
          ...sessionDoc.data()
        };
      }
      
      return null;
    } catch (error) {
      console.error('❌ Error getting UnifiedSession:', error);
      throw error;
    }
  }

  async getUnifiedMessages(sessionId) {
    await this.connectToFirestore();
    
    try {
      // Messages are stored in the unifiedMessages field of the session document
      const sessionDoc = await this.db
        .collection('unifiedSessions')
        .doc(sessionId)
        .get();
      
      if (!sessionDoc.exists) {
        return [];
      }
      
      const sessionData = sessionDoc.data();
      return sessionData.unifiedMessages || [];
    } catch (error) {
      console.error('❌ Error getting UnifiedMessages:', error);
      throw error;
    }
  }

  async verifyMessageCount(sessionId, expectedCount) {
    const messages = await this.getUnifiedMessages(sessionId);
    const actualCount = messages.length;
    
    console.log(`📊 Expected message count: ${expectedCount}, Actual: ${actualCount}`);
    
    if (actualCount !== expectedCount) {
      console.log('📝 Messages found:');
      messages.forEach((msg, index) => {
        console.log(`  ${index + 1}. ${msg.type || 'unknown'} - ${msg.content?.substring(0, 50) || 'no content'}...`);
      });
    }
    
    return {
      expected: expectedCount,
      actual: actualCount,
      matches: actualCount === expectedCount,
      messages: messages
    };
  }

  async verifyMessageSequence(sessionId, expectedSequence) {
    const messages = await this.getUnifiedMessages(sessionId);
    
    const actualSequence = messages.map(msg => ({
      type: msg.type || 'unknown',
      content: msg.content || '',
      hasImage: !!(msg.imageData || msg.imageUrl)
    }));
    
    console.log('📝 Expected sequence:', expectedSequence);
    console.log('📝 Actual sequence:', actualSequence);
    
    const matches = JSON.stringify(actualSequence) === JSON.stringify(expectedSequence);
    
    return {
      expected: expectedSequence,
      actual: actualSequence,
      matches: matches
    };
  }

  async cleanupUnifiedSessions(userId) {
    await this.connectToFirestore();
    
    try {
      console.log(`🧹 Cleaning up unifiedSessions for userId: ${userId}`);
      
      const sessionsSnapshot = await this.db
        .collection('unifiedSessions')
        .where('userId', '==', userId)
        .get();
      
      let deletedSessions = 0;
      let deletedMessages = 0;
      
      // Delete each session and its messages
      for (const sessionDoc of sessionsSnapshot.docs) {
        const sessionId = sessionDoc.id;
        
        // Delete all messages in this session
        const messagesSnapshot = await this.db
          .collection('unifiedSessions')
          .doc(sessionId)
          .collection('UnifiedMessages')
          .get();
        
        const messageBatch = this.db.batch();
        messagesSnapshot.forEach(messageDoc => {
          messageBatch.delete(messageDoc.ref);
          deletedMessages++;
        });
        
        if (messagesSnapshot.size > 0) {
          await messageBatch.commit();
          console.log(`🗑️ Deleted ${messagesSnapshot.size} messages from session ${sessionId}`);
        }
        
        // Delete the session itself
        await this.db.collection('unifiedSessions').doc(sessionId).delete();
        deletedSessions++;
        console.log(`🗑️ Deleted session ${sessionId}`);
      }
      
      if (deletedSessions > 0) {
        console.log(`✅ Cleanup complete: ${deletedSessions} sessions and ${deletedMessages} messages deleted`);
      } else {
        console.log(`ℹ️  No unifiedSessions found for userId: ${userId}`);
      }
      
      return { sessions: deletedSessions, messages: deletedMessages };
    } catch (error) {
      console.error('❌ Error cleaning up unifiedSessions:', error);
      throw error;
    }
  }

  async cleanupAllTestData() {
    await this.connectToFirestore();
    
    try {
      console.log(`🧹 Cleaning up ALL test data...`);
      
      // Get all sessions
      const sessionsSnapshot = await this.db
        .collection('unifiedSessions')
        .get();
      
      let deletedSessions = 0;
      let deletedMessages = 0;
      
      // Delete each session and its messages
      for (const sessionDoc of sessionsSnapshot.docs) {
        const sessionId = sessionDoc.id;
        
        // Delete all messages in this session
        const messagesSnapshot = await this.db
          .collection('unifiedSessions')
          .doc(sessionId)
          .collection('UnifiedMessages')
          .get();
        
        const messageBatch = this.db.batch();
        messagesSnapshot.forEach(messageDoc => {
          messageBatch.delete(messageDoc.ref);
          deletedMessages++;
        });
        
        if (messagesSnapshot.size > 0) {
          await messageBatch.commit();
          console.log(`🗑️ Deleted ${messagesSnapshot.size} messages from session ${sessionId}`);
        }
        
        // Delete the session itself
        await this.db.collection('unifiedSessions').doc(sessionId).delete();
        deletedSessions++;
        console.log(`🗑️ Deleted session ${sessionId}`);
      }
      
      console.log(`✅ Complete cleanup: ${deletedSessions} sessions and ${deletedMessages} messages deleted`);
      return { sessions: deletedSessions, messages: deletedMessages };
    } catch (error) {
      console.error('❌ Error cleaning up all test data:', error);
      throw error;
    }
  }

  async getUnifiedSessionsByUserId(userId) {
    await this.connectToFirestore();
    
    try {
      const sessionsSnapshot = await this.db
        .collection('unifiedSessions')
        .where('userId', '==', userId)
        .get();
      
      const sessions = [];
      sessionsSnapshot.forEach(doc => {
        sessions.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      return sessions;
    } catch (error) {
      console.error('❌ Error getting unifiedSessions by userId:', error);
      throw error;
    }
  }

  async deleteUnifiedSession(sessionId) {
    await this.connectToFirestore();
    
    try {
      // First delete all messages in the session
      const messagesSnapshot = await this.db
        .collection('unifiedSessions')
        .doc(sessionId)
        .collection('UnifiedMessages')
        .get();
      
      const batch = this.db.batch();
      messagesSnapshot.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      // Then delete the session itself
      batch.delete(this.db.collection('unifiedSessions').doc(sessionId));
      
      await batch.commit();
      console.log(`✅ Deleted UnifiedSession: ${sessionId}`);
      
      return true;
    } catch (error) {
      console.error('❌ Error deleting UnifiedSession:', error);
      throw error;
    }
  }

  async getSessionByTitle(title) {
    await this.connectToFirestore();
    
    try {
      const sessionsSnapshot = await this.db
        .collection('unifiedSessions')
        .where('title', '==', title)
        .get();
      
      if (!sessionsSnapshot.empty) {
        const session = sessionsSnapshot.docs[0];
        return {
          id: session.id,
          ...session.data()
        };
      }
      
      return null;
    } catch (error) {
      console.error('❌ Error getting session by title:', error);
      throw error;
    }
  }

  async waitForSessionCreation(userId, timeout = 30000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const sessions = await this.getUnifiedSessionsByUserId(userId);
      if (sessions.length > 0) {
        return sessions[0]; // Return the first (newest) session
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    }
    
    throw new Error(`Timeout waiting for session creation for userId: ${userId}`);
  }

  async getMessageCount(sessionId) {
    await this.connectToFirestore();
    
    try {
      const sessionDoc = await this.db.collection('unifiedSessions').doc(sessionId).get();
      
      if (!sessionDoc.exists) {
        return 0;
      }
      
      const sessionData = sessionDoc.data();
      return sessionData.unifiedMessages ? sessionData.unifiedMessages.length : 0;
    } catch (error) {
      console.error('❌ Error getting message count:', error);
      throw error;
    }
  }

  async close() {
    if (this.isInitialized) {
      await admin.app().delete();
      this.isInitialized = false;
      console.log('🔌 Disconnected from Firestore');
    }
  }
}

module.exports = DatabaseHelper;
