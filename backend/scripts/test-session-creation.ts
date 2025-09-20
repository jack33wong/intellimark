#!/usr/bin/env ts-node

import { FirestoreService } from '../services/firestoreService.js';

async function testSessionCreation() {
  try {
    
    const sessionData = {
      title: 'Test Session - AQA MATHEMATICS 8300/2H Q23 (2023)',
      messages: [],
      userId: 'anonymous',
      messageType: 'Question' as const
    };
    
    const sessionId = await FirestoreService.createChatSession(sessionData);
    
    const sessions = await FirestoreService.getChatSessions('anonymous');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testSessionCreation();
