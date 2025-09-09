#!/usr/bin/env ts-node

import { FirestoreService } from '../services/firestoreService';

async function testFirestoreSessions() {
  try {
    console.log('Testing Firestore session retrieval...');
    
    // Test getting sessions for anonymous user
    console.log('Getting sessions for anonymous user...');
    const sessions = await FirestoreService.getChatSessions('anonymous');
    console.log('Found sessions:', sessions.length);
    console.log('Sessions:', JSON.stringify(sessions, null, 2));
    
    // Test creating a session
    console.log('\nCreating a test session...');
    const sessionData = {
      title: 'Test Session - AQA MATHEMATICS 8300/2H Q23 (2023)',
      messages: [],
      userId: 'anonymous',
      messageType: 'Question' as const
    };
    
    const sessionId = await FirestoreService.createChatSession(sessionData);
    console.log('Created session with ID:', sessionId);
    
    // Test getting sessions again
    console.log('\nGetting sessions again...');
    const sessionsAfter = await FirestoreService.getChatSessions('anonymous');
    console.log('Found sessions after creation:', sessionsAfter.length);
    console.log('Sessions:', JSON.stringify(sessionsAfter, null, 2));
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testFirestoreSessions();
