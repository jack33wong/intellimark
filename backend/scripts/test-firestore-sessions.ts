#!/usr/bin/env ts-node

import { FirestoreService } from '../services/firestoreService';

async function testFirestoreSessions() {
  try {
    
    // Test getting sessions for anonymous user
    const sessions = await FirestoreService.getChatSessions('anonymous');
    
    // Test creating a session
    const sessionData = {
      title: 'Test Session - AQA MATHEMATICS 8300/2H Q23 (2023)',
      messages: [],
      userId: 'anonymous',
      messageType: 'Question' as const
    };
    
    const sessionId = await FirestoreService.createChatSession(sessionData);
    
    // Test getting sessions again
    const sessionsAfter = await FirestoreService.getChatSessions('anonymous');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testFirestoreSessions();
