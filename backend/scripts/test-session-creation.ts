#!/usr/bin/env ts-node

import { FirestoreService } from '../services/firestoreService.js';

async function testSessionCreation() {
  try {
    console.log('Testing session creation...');
    
    const sessionData = {
      title: 'Test Session - AQA MATHEMATICS 8300/2H Q23 (2023)',
      messages: [],
      userId: 'anonymous',
      messageType: 'Question' as const
    };
    
    console.log('Creating session with data:', sessionData);
    const sessionId = await FirestoreService.createChatSession(sessionData);
    console.log('Session created with ID:', sessionId);
    
    console.log('Retrieving sessions for anonymous user...');
    const sessions = await FirestoreService.getChatSessions('anonymous');
    console.log('Retrieved sessions:', sessions.length);
    console.log('Sessions:', JSON.stringify(sessions, null, 2));
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testSessionCreation();
