/**
 * Firestore Service for Mark Homework System
 * Handles real database storage and retrieval of marking results
 */

import admin from 'firebase-admin';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getFirestore } from '../config/firebase';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper function to sanitize data for Firestore (remove undefined values)
function sanitizeForFirestore(obj: any): any {
  if (obj === null || obj === undefined) {
    return null;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForFirestore).filter(item => item !== undefined);
  }
  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        sanitized[key] = sanitizeForFirestore(value);
      }
    }
    return sanitized;
  }
  return obj;
}

// Initialize Firebase Admin if not already initialized
if (!admin.apps || admin.apps.length === 0) {
  try {
    const serviceAccountPath = join(__dirname, '..', 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath)
    });
  } catch (error) {
    console.error('❌ Firebase Admin initialization failed in Firestore service:', error);
  }
}

// Get Firestore instance
// Use the properly initialized Firestore instance
const db = getFirestore();

if (!db) {
  console.error('❌ Firestore database not available - check Firebase configuration');
  console.error('❌ This means sessions will not be saved to the database');
} else {
}

// Helper function to check if database is available
function ensureDbAvailable(): void {
  if (!db) {
    throw new Error('Firestore database not available - check Firebase configuration');
  }
}

// Collection names
const COLLECTIONS = {
  MARKING_RESULTS: 'markingResults',
  USERS: 'users',
  SESSIONS: 'sessions',
  UNIFIED_SESSIONS: 'unifiedSessions'  // NEW: Single collection with nested messages
} as const;

// Types for Firestore documents
export interface MarkingResultDocument {
  id: string;
  userId: string;
  userEmail: string;
  imageData: string;
  model: string;
  isQuestionOnly: boolean;
  classification: {
    isQuestionOnly: boolean;
    reasoning: string;
    apiUsed: string;
  };
  ocrResult: {
    ocrText: string;
    boundingBoxes: Array<{
      x: number;
      y: number;
      width: number;
      height: number;
      text: string;
      confidence?: number;
    }>;
    confidence: number;
    imageDimensions: {
      width: number;
      height: number;
    };
    isQuestion?: boolean;
  };
  markingInstructions: {
    annotations: Array<{
      action: 'tick' | 'circle' | 'underline' | 'comment';
      bbox: [number, number, number, number];
      comment?: string;
      text?: string;
    }>;
  };
  annotatedImage?: string;
  metadata: {
    processingTime: string;
    modelUsed: string;
    totalAnnotations: number;
    imageSize: number;
    confidence: number;
    apiUsed: string;
    ocrMethod: string;
  };
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

export interface UserDocument {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
  role?: string;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

/**
 * Sanitize data for Firestore by removing unsupported types
 */
function sanitizeFirestoreData(obj: any): any {
  return JSON.parse(JSON.stringify(obj, (key, value) => {
    // Remove functions, undefined, symbols, and other unsupported types
    if (typeof value === 'function' || 
        typeof value === 'undefined' || 
        typeof value === 'symbol' ||
        value instanceof Buffer ||
        typeof value === 'bigint') {
      return null;
    }
    return value;
  }));
}

export class FirestoreService {

  /**
   * Retrieve marking results by ID
   */
  static async getMarkingResults(resultId: string): Promise<MarkingResultDocument | null> {
    try {
      
      const docRef = await db.collection(COLLECTIONS.MARKING_RESULTS).doc(resultId).get();
      
      if (!docRef.exists) {
        return null;
      }

      const data = docRef.data() as MarkingResultDocument;
      
      return {
        ...data,
        id: docRef.id
      };

    } catch (error) {
      console.error('❌ Failed to retrieve marking results from Firestore:', error);
      throw new Error(`Firestore retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get marking results for a specific user
   */
  static async getUserMarkingResults(userId: string, limit: number = 50): Promise<MarkingResultDocument[]> {
    try {
      
      // Use a simpler query to avoid index requirements
      const querySnapshot = await db.collection(COLLECTIONS.MARKING_RESULTS)
        .where('userId', '==', userId)
        .limit(limit)
        .get();

      const results: MarkingResultDocument[] = [];
      querySnapshot.forEach(doc => {
        const data = doc.data() as MarkingResultDocument;
        results.push({
          ...data,
          id: doc.id
        });
      });

      return results;

    } catch (error) {
      console.error('❌ Failed to retrieve user marking results from Firestore:', error);
      throw new Error(`Firestore user retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update marking results
   */
  static async updateMarkingResults(
    resultId: string,
    updates: Partial<MarkingResultDocument>
  ): Promise<void> {
    try {
      
      await db.collection(COLLECTIONS.MARKING_RESULTS).doc(resultId).update({
        ...updates,
        updatedAt: admin.firestore.Timestamp.now()
      });


    } catch (error) {
      console.error('❌ Failed to update marking results in Firestore:', error);
      throw new Error(`Firestore update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete marking results
   */
  static async deleteMarkingResults(resultId: string): Promise<void> {
    try {
      
      await db.collection(COLLECTIONS.MARKING_RESULTS).doc(resultId).delete();


    } catch (error) {
      console.error('❌ Failed to delete marking results from Firestore:', error);
      throw new Error(`Firestore deletion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Save or update user document
   */
  static async saveUser(userData: Omit<UserDocument, 'createdAt' | 'updatedAt'>): Promise<void> {
    try {
      
      await db.collection(COLLECTIONS.USERS).doc(userData.uid).set({
        ...userData,
        updatedAt: admin.firestore.Timestamp.now()
      }, { merge: true });


    } catch (error) {
      console.error('❌ Failed to save user in Firestore:', error);
      throw new Error(`Firestore user save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get user document
   */
  static async getUser(uid: string): Promise<UserDocument | null> {
    try {
      
      const docRef = await db.collection(COLLECTIONS.USERS).doc(uid).get();
      
      if (!docRef.exists) {
        return null;
      }

      const data = docRef.data() as UserDocument;
      
      return {
        ...data,
        uid: docRef.id
      };

    } catch (error) {
      console.error('❌ Failed to retrieve user from Firestore:', error);
      throw new Error(`Firestore user retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get system statistics
   */
  static async getSystemStats(): Promise<{
    totalResults: number;
    totalUsers: number;
    recentActivity: number;
  }> {
    try {
      
      const [resultsSnapshot, usersSnapshot] = await Promise.all([
        db.collection(COLLECTIONS.MARKING_RESULTS).count().get(),
        db.collection(COLLECTIONS.USERS).count().get()
      ]);

      // Get recent activity (last 24 hours)
      const oneDayAgo = admin.firestore.Timestamp.fromDate(
        new Date(Date.now() - 24 * 60 * 60 * 1000)
      );
      
      const recentSnapshot = await db.collection(COLLECTIONS.MARKING_RESULTS)
        .where('createdAt', '>=', oneDayAgo)
        .count()
        .get();

      const stats = {
        totalResults: resultsSnapshot.data().count,
        totalUsers: usersSnapshot.data().count,
        recentActivity: recentSnapshot.data().count
      };

      return stats;

    } catch (error) {
      console.error('❌ Failed to retrieve system statistics from Firestore:', error);
      throw new Error(`Firestore stats retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Chat Session Methods
  /**
   * Create a new chat session (DEPRECATED - use createUnifiedSessionWithMessages)
   */
  static async createChatSession(sessionData: {
    title: string;
    messages: any[];
    userId?: string;
    messageType?: 'Marking' | 'Question' | 'Chat';
    favorite?: boolean;
    rating?: number;
    sessionMetadata?: any;
  }): Promise<string> {
    throw new Error(`
❌ DEPRECATED METHOD: createChatSession() is no longer supported.
📋 Use createUnifiedSessionWithMessages() instead.
💡 The old sessions collection has been removed. All data now uses unifiedSessions.
🔧 Update your code to use the new unified architecture.
    `);
  }

  /**
   * Get a specific chat session (DEPRECATED - use getUnifiedSession)
   */
  static async getChatSession(sessionId: string): Promise<any | null> {
    throw new Error(`
❌ DEPRECATED METHOD: getChatSession() is no longer supported.
📋 Use getUnifiedSession() instead.
💡 The old sessions collection has been removed. All data now uses unifiedSessions.
🔧 Update your code to use the new unified architecture.
🆔 Session ID: ${sessionId}
    `);
  }

  /**
   * Get all chat sessions for a user (DEPRECATED - use getUserUnifiedSessions)
   */
  static async getChatSessions(userId: string): Promise<any[]> {
    throw new Error(`
❌ DEPRECATED METHOD: getChatSessions() is no longer supported.
📋 Use getUserUnifiedSessions() instead.
💡 The old sessions collection has been removed. All data now uses unifiedSessions.
🔧 Update your code to use the new unified architecture.
👤 User ID: ${userId}
    `);
  }

  /**
   * Add message to chat session (DEPRECATED - use createUnifiedSessionWithMessages)
   */
  static async addMessageToSession(sessionId: string, message: any): Promise<void> {
    throw new Error(`
❌ DEPRECATED METHOD: addMessageToSession() is no longer supported.
📋 Use createUnifiedSessionWithMessages() to create complete sessions atomically.
💡 The old sessions collection has been removed. All data now uses unifiedSessions.
🔧 In the unified architecture, messages are created with sessions, not added individually.
🆔 Session ID: ${sessionId}
    `);
  }

  /**
   * Update chat session (REDIRECTED - deprecated in unified architecture)
   */
  static async updateChatSession(sessionId: string, updates: any): Promise<void> {
    // REDIRECTED: In unified architecture, sessions are immutable after creation
    // Updates should create new messages rather than modifying existing sessions
    return; // No-op - unified sessions are immutable
  }


  // Generic document operations for subscriptions
  static async createDocument(collection: string, docId: string | null, data: any): Promise<any> {
    try {
      let docRef;
      if (docId) {
        // Create document with specific ID
        docRef = await db.collection(collection).doc(docId).set({
          ...data,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        return { id: docId };
      } else {
        // Create document with auto-generated ID
        docRef = await db.collection(collection).add({
          ...data,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        return docRef;
      }
    } catch (error) {
      console.error(`❌ Error creating document in ${collection}:`, error);
      throw error;
    }
  }

  static async getDocument(collection: string, docId: string): Promise<any | null> {
    try {
      const doc = await db.collection(collection).doc(docId).get();
      if (doc.exists) {
        return { id: doc.id, ...doc.data() };
      }
      return null;
    } catch (error) {
      console.error(`❌ Error getting document from ${collection}:`, error);
      throw error;
    }
  }

  static async updateDocument(collection: string, docId: string, data: any): Promise<void> {
    try {
      await db.collection(collection).doc(docId).update({
        ...data,
        updatedAt: Date.now(),
      });
    } catch (error) {
      console.error(`❌ Error updating document in ${collection}:`, error);
      throw error;
    }
  }

  static async queryCollection(collection: string, field: string, operator: any, value: any): Promise<any[]> {
    try {
      const snapshot = await db.collection(collection).where(field, operator, value).get();
      const results: any[] = [];
      snapshot.forEach(doc => {
        results.push({ id: doc.id, ...doc.data() });
      });
      return results;
    } catch (error) {
      console.error(`❌ Error querying collection ${collection}:`, error);
      throw error;
    }
  }

  // ============================================================================
  // UNIFIED SESSIONS & MESSAGES (Parent-Child Structure)
  // ============================================================================

  /**
   * Create a UnifiedSession with nested messages (single document structure)
   * Stores large images in Firebase Storage and keeps only URLs in the document
   */
  static async createUnifiedSessionWithMessages(sessionData: {
    sessionId: string;
    title: string;
    userId: string;
    messageType: 'Marking' | 'Question' | 'Chat';
    messages: any[];
    sessionMetadata?: any;
    isPastPaper?: boolean;
  }): Promise<string> {
    try {
      ensureDbAvailable();
      const { sessionId, title, userId, messageType, messages, sessionMetadata } = sessionData;
      
      // Import ImageStorageService
      const { ImageStorageService } = await import('./imageStorageService');
      
      // Prepare messages array with proper formatting  
      
      let unifiedMessages = [];
      try {
        unifiedMessages = await Promise.all(messages.map(async (message, index) => {
        
        let processedImageLink = message.imageLink;

        // All images should already be uploaded to Firebase Storage and have imageLink
        if (!message.imageLink && message.imageData) {
          // Legacy fallback - upload to Firebase Storage if imageData exists
          try {
            const imageUrl = await ImageStorageService.uploadImage(
              message.imageData,
              userId,
              sessionId,
              message.type === 'marking_original' ? 'original' : 'annotated'
            );
            processedImageLink = imageUrl;
          } catch (error) {
            console.error(`❌ Legacy image upload failed:`, error);
            processedImageLink = null;
          }
        }


        const messageDoc = {
          id: message.id,
          role: message.role,
          content: message.content,
          timestamp: new Date().toISOString(),
          type: message.type || 'chat',
          imageLink: processedImageLink,
          fileName: message.fileName || null,
          model: message.model || null,
          apiUsed: message.apiUsed || null,
          detectedQuestion: message.detectedQuestion || null,
          metadata: message.metadata || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        // Remove null values
        const finalMessage = Object.fromEntries(
          Object.entries(messageDoc).filter(([_, value]) => value !== null && value !== undefined)
        );
        
        return finalMessage;
        }));
        
        
      } catch (messageProcessingError) {
        console.error(`❌ Message processing failed:`, messageProcessingError);
        console.error(`❌ Error details:`, messageProcessingError.message);
        console.error(`❌ Error stack:`, messageProcessingError.stack);
        throw new Error(`Message processing failed: ${messageProcessingError.message}`);
      }

      // Create single session document with nested messages
      const sessionDoc = {
        id: sessionId,
        title,
        userId,
        messageType,
        messageCount: messages.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        favorite: false,
        rating: 0,
        isPastPaper: sessionData.isPastPaper || false,
        sessionMetadata: sessionMetadata || null,
        unifiedMessages: unifiedMessages  // Nested messages array with storage URLs
      };

      // Save complete session document to unifiedSessions collection
      
      
      
      
      
      if (!db) {
        throw new Error('Database instance is null - Firestore not properly initialized');
      }
      
      try {
        console.log(`🔍 [SESSION_CREATE] Creating session ${sessionId} for user ${userId}`);
        await db.collection(COLLECTIONS.UNIFIED_SESSIONS).doc(sessionId).set(sessionDoc);
        console.log(`✅ [SESSION_CREATE] Session ${sessionId} saved to Firestore`);
        
        // Verify the session was saved
        const verifyDoc = await db.collection(COLLECTIONS.UNIFIED_SESSIONS).doc(sessionId).get();
        if (verifyDoc.exists) {
          console.log(`✅ [SESSION_CREATE] Session ${sessionId} verified in Firestore`);
        } else {
          throw new Error(`Session verification failed - document not found after save`);
        }
      } catch (firestoreError) {
        console.error(`❌ Firestore operation failed:`, firestoreError);
        console.error(`❌ Error type: ${firestoreError.constructor.name}`);
        console.error(`❌ Error message: ${firestoreError.message}`);
        if (firestoreError.stack) {
          console.error(`❌ Error stack: ${firestoreError.stack}`);
        }
        throw firestoreError;
      }

      return sessionId;
    } catch (error) {
      console.error('❌ Failed to create UnifiedSession with nested messages:', error);
      throw new Error(`Session creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get UnifiedSession with nested messages (single document structure)
   */
  static async getUnifiedSession(sessionId: string): Promise<any | null> {
    try {
      
      // Get session document with nested messages
      const sessionDoc = await db.collection(COLLECTIONS.UNIFIED_SESSIONS).doc(sessionId).get();
      
      if (!sessionDoc.exists) {
        return null;
      }

      const sessionData = sessionDoc.data();
      
      // Extract nested messages
      const unifiedMessages = sessionData?.unifiedMessages || [];
      
      // Sort messages by timestamp in JavaScript
      unifiedMessages.sort((a: any, b: any) => {
        const timeA = new Date(a.timestamp || a.createdAt || 0).getTime();
        const timeB = new Date(b.timestamp || b.createdAt || 0).getTime();
        return timeA - timeB;
      });

      // Map messages to ensure frontend compatibility (messageId -> id)
      const mappedMessages = unifiedMessages.map((msg: any) => ({
        ...msg,
        id: msg.messageId || msg.id, // Map messageId to id for frontend
        messageId: msg.messageId || msg.id // Keep original messageId
      }));

      // Create result without unifiedMessages to avoid duplication
      const result = {
        id: sessionData.id,
        title: sessionData.title,
        userId: sessionData.userId,
        messageType: sessionData.messageType,
        messageCount: sessionData.messageCount,
        createdAt: sessionData.createdAt,
        updatedAt: sessionData.updatedAt,
        favorite: sessionData.favorite,
        rating: sessionData.rating,
        sessionMetadata: sessionData.sessionMetadata,
        messages: mappedMessages  // Use mapped messages with id field
      };
      
      return result;
    } catch (error) {
      console.error('❌ Failed to get UnifiedSession:', error);
      throw new Error(`Failed to get session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get user's UnifiedSessions (lightweight list with nested messages)
   */
  static async getUserUnifiedSessions(userId: string, limit: number = 50): Promise<any[]> {
    try {
      
      const sessionsRef = db.collection(COLLECTIONS.UNIFIED_SESSIONS)
        .where('userId', '==', userId)
        .limit(limit);
      
      const snapshot = await sessionsRef.get();
      
      if (snapshot.empty) {
        return [];
      }

      const sessions = [];
      
      for (const doc of snapshot.docs) {
        const sessionData = doc.data();
        
        // Get nested messages directly from the session document
        const unifiedMessages = sessionData.unifiedMessages || [];
        
        // Find the last message by sorting in JavaScript
        let lastMessage = null;
        if (unifiedMessages.length > 0) {
          const sortedMessages = [...unifiedMessages].sort((a: any, b: any) => {
            const timeA = new Date(a.timestamp || a.createdAt || 0).getTime();
            const timeB = new Date(b.timestamp || b.createdAt || 0).getTime();
            return timeB - timeA; // Descending order
          });
          lastMessage = sortedMessages[0];
        }

        // Check if session has images in nested messages
        const hasImage = unifiedMessages.some((msg: any) => 
          msg.imageLink
        );

        sessions.push({
          id: doc.id,
          title: sessionData.title,
          userId: sessionData.userId,
          messageType: sessionData.messageType,
          createdAt: sessionData.createdAt,
          updatedAt: sessionData.updatedAt,
          favorite: sessionData.favorite || false,
          rating: sessionData.rating || 0,
          messages: unifiedMessages, // Include the actual messages array
          lastMessage: lastMessage ? {
            content: lastMessage.content,
            role: lastMessage.role,
            timestamp: lastMessage.timestamp
          } : null,
          messageCount: sessionData.messageCount || 0,
          hasImage,
          lastApiUsed: lastMessage?.apiUsed
        });
      }
      
      // Sort sessions by updatedAt in JavaScript
      sessions.sort((a: any, b: any) => {
        const timeA = new Date(a.updatedAt || 0).getTime();
        const timeB = new Date(b.updatedAt || 0).getTime();
        return timeB - timeA; // Descending order
      });
      
      return sessions;
    } catch (error) {
      console.error('❌ Failed to get user UnifiedSessions:', error);
      throw new Error(`Failed to get sessions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // NEW: Marking Results as Session Messages Methods

  /**
   * Save marking results as session messages
   */
  static async saveMarkingResultsAsMessages(
    userId: string,
    sessionId: string,
    imageData: string,
    model: string,
    result: any,
    instructions: any,
    classification: any,
    annotatedImage: string,
    metadata: any,
    questionDetection?: any
  ): Promise<void> {
    try {
      
      // Upload images to Firebase Storage
      const { ImageStorageService } = await import('./imageStorageService');
      
      const originalImageUrl = await ImageStorageService.uploadImage(imageData, userId, sessionId, 'original');
      const annotatedImageUrl = await ImageStorageService.uploadImage(annotatedImage, userId, sessionId, 'annotated');
      

      // Helper function to remove undefined values recursively
      const removeUndefinedValues = (obj: any): any => {
        if (obj === null || obj === undefined) {
          return null;
        }
        if (Array.isArray(obj)) {
          return obj.map(removeUndefinedValues).filter(item => item !== undefined);
        }
        if (typeof obj === 'object') {
          const cleaned: any = {};
          for (const [key, value] of Object.entries(obj)) {
            if (value !== undefined) {
              cleaned[key] = removeUndefinedValues(value);
            }
          }
          return cleaned;
        }
        return obj;
      };

      // Create sanitized result without large image data and undefined values
      const sanitizedResult = {
        confidence: result.confidence || 0,
        extractedText: result.extractedText || '',
        annotations: result.annotations || [],
        // Remove large image data fields
        // originalImage: result.originalImage, // Remove this
        // annotatedImage: result.annotatedImage, // Remove this
        // Any other fields that might contain large data
      };

      // Create sanitized instructions without large data and undefined values
      const sanitizedInstructions = {
        annotations: instructions.annotations || [],
        // Remove any large fields that might exist
        // Keep only essential data
      };

      // Create detected question info
      
      const detectedQuestion = questionDetection?.found ? {
        found: true,
        questionText: questionDetection.match?.questionText || classification?.extractedQuestionText || '',
        message: questionDetection.message || 'Question detected'
      } : {
        found: false,
        message: questionDetection?.message || 'No question detected'
      };
      

      // Create original image message
      const originalMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'user',
        content: 'Uploaded homework for marking',
        timestamp: new Date().toISOString(),
        type: 'marking_original',
        imageLink: originalImageUrl,
        detectedQuestion: removeUndefinedValues(detectedQuestion)
      };

      // Create annotated image message with context summary
      const contextSummary = this.generateMarkingContextSummary(instructions, result);
      const annotatedMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'assistant',
        content: contextSummary,
        timestamp: new Date().toISOString(),
        type: 'marking_annotated',
        imageLink: annotatedImageUrl,
        detectedQuestion: removeUndefinedValues(detectedQuestion)
      };

      // Add both messages to the session
      await this.addMessageToSession(sessionId, originalMessage);
      await this.addMessageToSession(sessionId, annotatedMessage);

    } catch (error) {
      console.error('❌ Failed to save marking results as session messages:', error);
      throw error;
    }
  }

  /**
   * Save question-only data as session messages
   */
  static async saveQuestionOnlyAsMessages(
    userId: string,
    sessionId: string,
    imageData: string,
    model: string,
    classification: any,
    questionDetection?: any
  ): Promise<void> {
    try {
      
      // Upload image to Firebase Storage
      const { ImageStorageService } = await import('./imageStorageService');
      
      const originalImageUrl = await ImageStorageService.uploadImage(imageData, userId, sessionId, 'original');
      

      // Helper function to remove undefined values recursively
      const removeUndefinedValues = (obj: any): any => {
        if (obj === null || obj === undefined) {
          return null;
        }
        if (Array.isArray(obj)) {
          return obj.map(removeUndefinedValues).filter(item => item !== undefined);
        }
        if (typeof obj === 'object') {
          const cleaned: any = {};
          for (const [key, value] of Object.entries(obj)) {
            if (value !== undefined) {
              cleaned[key] = removeUndefinedValues(value);
            }
          }
          return cleaned;
        }
        return obj;
      };

      // Create detected question info
      
      const detectedQuestion = questionDetection?.found ? {
        found: true,
        questionText: questionDetection.match?.questionText || classification?.extractedQuestionText || '',
        message: questionDetection.message || 'Question detected'
      } : {
        found: false,
        message: questionDetection?.message || 'No question detected'
      };
      

      // Create question image message
      const questionMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'user',
        content: 'Uploaded question for tutoring',
        timestamp: new Date().toISOString(),
        type: 'question_original',
        imageLink: originalImageUrl,
        detectedQuestion: removeUndefinedValues(detectedQuestion)
      };

      // Add message to the session
      await this.addMessageToSession(sessionId, questionMessage);

    } catch (error) {
      console.error('❌ Failed to save question-only data as session messages:', error);
      throw error;
    }
  }

  /**
   * Generate context summary for marking results
   */
  private static generateMarkingContextSummary(instructions: any, result: any): string {
    const annotationCount = instructions.annotations?.length || 0;
    const confidence = result.confidence || 0;
    
    return `I've marked your homework! Found ${annotationCount} areas to review with ${Math.round(confidence * 100)}% confidence. The annotated image shows my feedback and suggestions.`;
  }

  /**
   * Get all sessions from database
   */
  static async getAllSessions(): Promise<any[]> {
    try {
      const snapshot = await db.collection(COLLECTIONS.SESSIONS).get();
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('❌ Failed to get all sessions:', error);
      throw error;
    }
  }

  /**
   * Delete session with image cleanup
   */
  static async deleteChatSession(sessionId: string, userId?: string): Promise<void> {
    try {
      
      // Import ImageStorageService dynamically to avoid circular dependencies
      const { ImageStorageService } = await import('./imageStorageService');
      
      // Delete images from Firebase Storage (if userId provided)
      if (userId) {
        await ImageStorageService.deleteSessionImages(userId, sessionId);
      }
      
      // Delete session from Firestore
      await db.collection(COLLECTIONS.SESSIONS).doc(sessionId).delete();
      
    } catch (error) {
      console.error('❌ Failed to delete chat session:', error);
      throw error;
    }
  }

  /**
   * Delete user with image cleanup
   */
  static async deleteUser(userId: string): Promise<void> {
    try {
      
      // Import ImageStorageService dynamically to avoid circular dependencies
      const { ImageStorageService } = await import('./imageStorageService');
      
      // Delete all user images
      await ImageStorageService.deleteUserImages(userId);
      
      // Delete user from Firestore
      await db.collection(COLLECTIONS.USERS).doc(userId).delete();
      
    } catch (error) {
      console.error('❌ Failed to delete user:', error);
      throw error;
    }
  }

  /**
   * Delete a UnifiedSession and its messages
   */
  static async deleteUnifiedSession(sessionId: string, userId: string): Promise<void> {
    try {
      
      // Delete the session document (which contains nested messages)
      await db.collection(COLLECTIONS.UNIFIED_SESSIONS).doc(sessionId).delete();
      
    } catch (error) {
      console.error('❌ Failed to delete UnifiedSession:', error);
      throw error;
    }
  }

  /**
   * Add a message to an existing UnifiedSession
   * For chat functionality that requires incremental message addition
   */
  static async addMessageToUnifiedSession(sessionId: string, message: any): Promise<void> {
    const maxRetries = 3;
    const retryDelay = 2000; // 2 seconds
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // First, get the existing session
        const sessionRef = db.collection(COLLECTIONS.UNIFIED_SESSIONS).doc(sessionId);
        const sessionDoc = await sessionRef.get();
        
        console.log(`🔍 [SESSION_RETRY] Attempt ${attempt}/${maxRetries}: Looking for session ${sessionId}`);
        console.log(`🔍 [SESSION_RETRY] Session exists: ${sessionDoc.exists}`);
        
        if (!sessionDoc.exists) {
          if (attempt === maxRetries) {
            console.log(`❌ [SESSION_RETRY] Session ${sessionId} not found after ${maxRetries} attempts`);
            throw new Error(`Session ${sessionId} not found after ${maxRetries} attempts`);
          }
          // Wait and retry for eventual consistency
          console.log(`⏳ Session ${sessionId} not found, retrying in ${retryDelay}ms (attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
      
      const sessionData = sessionDoc.data();
      const existingMessages = sessionData?.unifiedMessages || [];
      
      // Sanitize the new message
      const sanitizedMessage = sanitizeForFirestore(message);
      
      // Add the new message to the array
      const updatedMessages = [...existingMessages, sanitizedMessage];
      
      // Update the session with new message and metadata
      const updateData = {
        unifiedMessages: updatedMessages,
        updatedAt: new Date().toISOString(),
        'sessionMetadata.totalMessages': updatedMessages.length,
        'sessionMetadata.hasImage': updatedMessages.some((msg: any) => msg.imageLink),
        'sessionMetadata.lastApiUsed': message.metadata?.apiUsed || 'Unknown',
        'sessionMetadata.lastModelUsed': message.metadata?.modelUsed || 'Unknown'
      };
      
        await sessionRef.update(updateData);
        
        // Success - break out of retry loop
        return;
        
      } catch (error) {
        if (attempt === maxRetries) {
          console.error('❌ Failed to add message to UnifiedSession after all retries:', error);
          throw error;
        }
        console.log(`⏳ Error adding message to session ${sessionId}, retrying in ${retryDelay}ms (attempt ${attempt}/${maxRetries}):`, error.message);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  /**
   * Update UnifiedSession metadata (favorite, rating, title, etc.)
   */
  static async updateUnifiedSession(sessionId: string, updates: any): Promise<void> {
    try {
      
      const sessionRef = db.collection(COLLECTIONS.UNIFIED_SESSIONS).doc(sessionId);
      const sessionDoc = await sessionRef.get();
      
      if (!sessionDoc.exists) {
        throw new Error(`Session ${sessionId} not found`);
      }
      
      // Sanitize updates and add timestamp
      const sanitizedUpdates = sanitizeForFirestore({
        ...updates,
        updatedAt: new Date().toISOString()
      });
      
      await sessionRef.update(sanitizedUpdates);
      
    } catch (error) {
      console.error('❌ Failed to update UnifiedSession:', error);
      throw error;
    }
  }
}
