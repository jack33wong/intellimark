/**
 * Firestore Service for Mark Homework System
 * Handles real database storage and retrieval of marking results
 */

import admin from 'firebase-admin';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Firebase Admin if not already initialized
if (!admin.apps || admin.apps.length === 0) {
  try {
    const serviceAccountPath = join(__dirname, '..', 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath)
    });
    console.log('✅ Firebase Admin initialized successfully in Firestore service');
  } catch (error) {
    console.error('❌ Firebase Admin initialization failed in Firestore service:', error);
  }
}

// Get Firestore instance
const db = admin.firestore();

// Collection names
const COLLECTIONS = {
  MARKING_RESULTS: 'markingResults',
  USERS: 'users',
  SESSIONS: 'sessions'
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
   * Save marking results to Firestore
   */
  static async saveMarkingResults(
    userId: string,
    userEmail: string,
    imageData: string,
    model: string,
    isQuestionOnly: boolean,
    classification: any,
    ocrResult: any,
    markingInstructions: any,
    annotatedImage?: string,
    metadata?: any
  ): Promise<string> {
    try {
      console.log('🔍 Saving marking results to Firestore...');
      
      const docData: Omit<MarkingResultDocument, 'id' | 'createdAt' | 'updatedAt'> = {
        userId,
        userEmail,
        imageData,
        model,
        isQuestionOnly,
        classification,
        ocrResult,
        markingInstructions,
        ...(annotatedImage && { annotatedImage }), // Only include if defined
        metadata: metadata || {
          processingTime: new Date().toISOString(),
          modelUsed: model,
          totalAnnotations: markingInstructions?.annotations?.length || 0,
          imageSize: imageData.length,
          confidence: ocrResult?.confidence || 0,
          apiUsed: 'Complete AI Marking System',
          ocrMethod: 'Enhanced OCR Processing'
        }
      };

      const docRef = await db.collection(COLLECTIONS.MARKING_RESULTS).add({
        ...docData,
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now()
      });

      console.log('✅ Marking results saved to Firestore with ID:', docRef.id);
      return docRef.id;

    } catch (error) {
      console.error('❌ Failed to save marking results to Firestore:', error);
      throw new Error(`Firestore save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Retrieve marking results by ID
   */
  static async getMarkingResults(resultId: string): Promise<MarkingResultDocument | null> {
    try {
      console.log('🔍 Retrieving marking results from Firestore:', resultId);
      
      const docRef = await db.collection(COLLECTIONS.MARKING_RESULTS).doc(resultId).get();
      
      if (!docRef.exists) {
        console.log('🔍 Marking results not found:', resultId);
        return null;
      }

      const data = docRef.data() as MarkingResultDocument;
      console.log('✅ Marking results retrieved from Firestore');
      
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
      console.log('🔍 Retrieving marking results for user:', userId);
      
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

      console.log(`✅ Retrieved ${results.length} marking results for user`);
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
      console.log('🔍 Updating marking results in Firestore:', resultId);
      
      await db.collection(COLLECTIONS.MARKING_RESULTS).doc(resultId).update({
        ...updates,
        updatedAt: admin.firestore.Timestamp.now()
      });

      console.log('✅ Marking results updated in Firestore');

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
      console.log('🔍 Deleting marking results from Firestore:', resultId);
      
      await db.collection(COLLECTIONS.MARKING_RESULTS).doc(resultId).delete();

      console.log('✅ Marking results deleted from Firestore');

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
      console.log('🔍 Saving/updating user in Firestore:', userData.uid);
      
      await db.collection(COLLECTIONS.USERS).doc(userData.uid).set({
        ...userData,
        updatedAt: admin.firestore.Timestamp.now()
      }, { merge: true });

      console.log('✅ User saved/updated in Firestore');

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
      console.log('🔍 Retrieving user from Firestore:', uid);
      
      const docRef = await db.collection(COLLECTIONS.USERS).doc(uid).get();
      
      if (!docRef.exists) {
        console.log('🔍 User not found:', uid);
        return null;
      }

      const data = docRef.data() as UserDocument;
      console.log('✅ User retrieved from Firestore');
      
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
      console.log('🔍 Retrieving system statistics from Firestore...');
      
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

      console.log('✅ System statistics retrieved from Firestore:', stats);
      return stats;

    } catch (error) {
      console.error('❌ Failed to retrieve system statistics from Firestore:', error);
      throw new Error(`Firestore stats retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Chat Session Methods
  /**
   * Create a new chat session
   */
  static async createChatSession(sessionData: {
    title: string;
    messages: any[];
    userId?: string;
  }): Promise<string> {
    try {
      console.log('🔍 Creating chat session in Firestore...');
      
      const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Debug: Log the raw payload before processing
      console.log('🔍 Raw sessionData:', JSON.stringify(sessionData, null, 2));
      
      // Sanitize and serialize messages to plain objects for Firestore
      const serializedMessages = sessionData.messages.map(msg => {
        const sanitized: any = {
          id: String(msg.id || ''),
          role: String(msg.role || ''),
          content: String(msg.content || ''),
          timestamp: new Date().toISOString() // Use ISO string instead of Firestore Timestamp
        };
        
        // Only add optional fields if they exist and are valid
        if (msg.imageData && typeof msg.imageData === 'string') {
          sanitized.imageData = msg.imageData;
        }
        if (msg.model && typeof msg.model === 'string') {
          sanitized.model = msg.model;
        }
        
        return sanitized;
      });

      // Create a minimal document structure to avoid protobuf issues
      const docData = {
        id: sessionId,
        title: String(sessionData.title || 'Untitled'),
        messages: serializedMessages,
        userId: String(sessionData.userId || 'anonymous'),
        timestamp: new Date().toISOString(), // Use ISO string instead of Firestore Timestamp
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        contextSummary: (sessionData as any).contextSummary || null,
        lastSummaryUpdate: (sessionData as any).lastSummaryUpdate ? new Date((sessionData as any).lastSummaryUpdate).toISOString() : null
      };

      // Debug: Log the final payload before Firestore write
      console.log('🔍 Final docData payload:', JSON.stringify(docData, null, 2));
      
      // Sanitize the entire payload to remove any problematic fields
      const sanitizedDocData = sanitizeFirestoreData(docData);
      console.log('🔍 Sanitized payload:', JSON.stringify(sanitizedDocData, null, 2));

      // Try using Firebase Admin's Firestore methods instead of direct Google Cloud client
      try {
        await db.collection(COLLECTIONS.SESSIONS).doc(sessionId).set(sanitizedDocData);
      } catch (firestoreError) {
        console.error('❌ Direct Firestore write failed, trying alternative approach:', firestoreError);
        
        // Alternative: Use Firebase Admin's batch write
        const batch = db.batch();
        const docRef = db.collection(COLLECTIONS.SESSIONS).doc(sessionId);
        batch.set(docRef, sanitizedDocData);
        await batch.commit();
      }

      console.log('✅ Chat session created in Firestore:', sessionId);
      return sessionId;

    } catch (error) {
      console.error('❌ Failed to create chat session in Firestore:', error);
      throw new Error(`Firestore session creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get a specific chat session
   */
  static async getChatSession(sessionId: string): Promise<any | null> {
    try {
      console.log('🔍 Getting chat session from Firestore:', sessionId);
      
      const doc = await db.collection(COLLECTIONS.SESSIONS).doc(sessionId).get();
      
      if (!doc.exists) {
        console.log('📝 Chat session not found in Firestore');
        return null;
      }

      const data = doc.data();
      console.log('✅ Chat session retrieved from Firestore');
      
      // Process messages to convert Firestore timestamps
      const processedMessages = (data.messages || []).map((msg: any) => ({
        ...msg,
        timestamp: msg.timestamp?.toDate ? msg.timestamp.toDate() : 
                  (msg.timestamp?._seconds ? new Date(msg.timestamp._seconds * 1000) : 
                   (msg.timestamp ? new Date(msg.timestamp) : new Date()))
      }));
      
      return {
        id: doc.id,
        ...data,
        messages: processedMessages,
        timestamp: data?.['timestamp']?.toDate ? data['timestamp'].toDate() : new Date(data?.['timestamp']),
        createdAt: data?.['createdAt']?.toDate ? data['createdAt'].toDate() : new Date(data?.['createdAt']),
        updatedAt: data?.['updatedAt']?.toDate ? data['updatedAt'].toDate() : new Date(data?.['updatedAt']),
        contextSummary: data?.['contextSummary'] || null,
        lastSummaryUpdate: data?.['lastSummaryUpdate'] ? new Date(data['lastSummaryUpdate']) : null
      };

    } catch (error) {
      console.error('❌ Failed to get chat session from Firestore:', error);
      throw new Error(`Firestore session retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get all chat sessions for a user
   */
  static async getChatSessions(userId: string): Promise<any[]> {
    try {
      console.log('🔍 Getting chat sessions for user from Firestore:', userId);
      
      // For anonymous users, we still need to return their sessions
      // The sessions are created with userId: 'anonymous' so they should be retrievable
      console.log('🔍 Retrieving sessions for user:', userId);
      
      const snapshot = await db.collection(COLLECTIONS.SESSIONS)
        .where('userId', '==', userId)
        .get();

      const sessions = snapshot.docs.map(doc => {
        const data = doc.data();
        
        // Process messages to convert Firestore timestamps
        const processedMessages = (data.messages || []).map((msg: any) => ({
          ...msg,
          timestamp: msg.timestamp?.toDate ? msg.timestamp.toDate() : 
                    (msg.timestamp?._seconds ? new Date(msg.timestamp._seconds * 1000) : 
                     (msg.timestamp ? new Date(msg.timestamp) : new Date()))
        }));
        
        return {
          id: doc.id,
          ...data,
          messages: processedMessages,
          timestamp: data?.['timestamp']?.toDate ? data?.['timestamp']?.toDate() : data?.['timestamp'],
          createdAt: data?.['createdAt']?.toDate ? data?.['createdAt']?.toDate() : data?.['createdAt'],
          updatedAt: data?.['updatedAt']?.toDate ? data?.['updatedAt']?.toDate() : data?.['updatedAt']
        };
      });

      // Sort in memory instead of using Firestore orderBy
      sessions.sort((a, b) => {
        const aTime = a.updatedAt || a.createdAt || new Date(0);
        const bTime = b.updatedAt || b.createdAt || new Date(0);
        return bTime.getTime() - aTime.getTime(); // Descending order
      });

      console.log('✅ Chat sessions retrieved from Firestore:', sessions.length);
      return sessions;

    } catch (error) {
      console.error('❌ Failed to get chat sessions from Firestore:', error);
      console.error('❌ Error details:', error);
      // For anonymous users, return empty array instead of throwing error
      if (userId === 'anonymous') {
        console.log('ℹ️ Anonymous user - returning empty sessions array due to error');
        console.log('ℹ️ Error type:', typeof error);
        console.log('ℹ️ Error message:', error instanceof Error ? error.message : 'Unknown error');
        return [];
      }
      throw new Error(`Firestore sessions retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Add message to chat session
   */
  static async addMessageToSession(sessionId: string, message: any): Promise<void> {
    try {
      console.log('🔍 Adding message to chat session in Firestore:', sessionId);
      
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
      
      // Serialize message to plain object for Firestore
      const messageData = removeUndefinedValues({
        id: message.id,
        role: message.role,
        content: message.content,
        timestamp: admin.firestore.Timestamp.now(),
        ...(message.imageData && { imageData: message.imageData }),
        ...(message.model && { model: message.model }),
        ...(message.type && { type: message.type }),
        ...(message.imageLink && { imageLink: message.imageLink }),
        ...(message.detectedQuestion && { detectedQuestion: message.detectedQuestion })
      });

      await db.collection(COLLECTIONS.SESSIONS).doc(sessionId).update({
        messages: admin.firestore.FieldValue.arrayUnion(messageData),
        updatedAt: admin.firestore.Timestamp.now()
      });

      console.log('✅ Message added to chat session in Firestore');

    } catch (error) {
      console.error('❌ Failed to add message to chat session in Firestore:', error);
      throw new Error(`Firestore message addition failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update chat session
   */
  static async updateChatSession(sessionId: string, updates: any): Promise<void> {
    try {
      console.log('🔍 Updating chat session in Firestore:', sessionId);
      
      await db.collection(COLLECTIONS.SESSIONS).doc(sessionId).update({
        ...updates,
        updatedAt: admin.firestore.Timestamp.now()
      });

      console.log('✅ Chat session updated in Firestore');

    } catch (error) {
      console.error('❌ Failed to update chat session in Firestore:', error);
      throw new Error(`Firestore session update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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
        console.log(`✅ Document created in ${collection}/${docId}`);
        return { id: docId };
      } else {
        // Create document with auto-generated ID
        docRef = await db.collection(collection).add({
          ...data,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        console.log(`✅ Document created in ${collection}/${docRef.id}`);
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
      console.log(`✅ Document updated in ${collection}/${docId}`);
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
      console.log('🔍 Saving marking results as session messages...');
      
      // Upload images to Firebase Storage
      const { ImageStorageService } = await import('./imageStorageService');
      
      console.log('🔍 Uploading images to Firebase Storage...');
      const originalImageUrl = await ImageStorageService.uploadImage(imageData, userId, sessionId, 'original');
      const annotatedImageUrl = await ImageStorageService.uploadImage(annotatedImage, userId, sessionId, 'annotated');
      
      console.log('✅ Images uploaded to Firebase Storage');

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
      console.log('🔍 Question Detection Data:', JSON.stringify(questionDetection, null, 2));
      console.log('🔍 Classification Data:', JSON.stringify(classification, null, 2));
      
      const detectedQuestion = questionDetection?.found ? {
        examDetails: questionDetection.match?.markingScheme?.examDetails || questionDetection.match?.examDetails || {},
        questionNumber: questionDetection.match?.questionNumber || 'Unknown',
        questionText: questionDetection.match?.questionText || classification?.extractedQuestionText || '',
        confidence: questionDetection.match?.markingScheme?.confidence || questionDetection.match?.confidence || 0
      } : undefined;
      
      console.log('🔍 Detected Question Info:', JSON.stringify(detectedQuestion, null, 2));

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

      console.log('✅ Marking results saved as session messages');
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
      console.log('🔍 Saving question-only data as session messages...');
      
      // Upload image to Firebase Storage
      const { ImageStorageService } = await import('./imageStorageService');
      
      console.log('🔍 Uploading question image to Firebase Storage...');
      const originalImageUrl = await ImageStorageService.uploadImage(imageData, userId, sessionId, 'original');
      
      console.log('✅ Question image uploaded to Firebase Storage');

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
      console.log('🔍 Question Detection Data:', JSON.stringify(questionDetection, null, 2));
      console.log('🔍 Classification Data:', JSON.stringify(classification, null, 2));
      
      const detectedQuestion = questionDetection?.found ? {
        examDetails: questionDetection.match?.markingScheme?.examDetails || questionDetection.match?.examDetails || {},
        questionNumber: questionDetection.match?.questionNumber || 'Unknown',
        questionText: questionDetection.match?.questionText || classification?.extractedQuestionText || '',
        confidence: questionDetection.match?.markingScheme?.confidence || questionDetection.match?.confidence || 0
      } : undefined;
      
      console.log('🔍 Detected Question Info:', JSON.stringify(detectedQuestion, null, 2));

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

      console.log('✅ Question-only data saved as session messages');
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
   * Delete session with image cleanup
   */
  static async deleteChatSession(sessionId: string, userId: string): Promise<void> {
    try {
      console.log('🔍 Deleting chat session with image cleanup...');
      
      // Import ImageStorageService dynamically to avoid circular dependencies
      const { ImageStorageService } = await import('./imageStorageService');
      
      // Delete images from Firebase Storage
      await ImageStorageService.deleteSessionImages(userId, sessionId);
      
      // Delete session from Firestore
      await db.collection(COLLECTIONS.SESSIONS).doc(sessionId).delete();
      
      console.log('✅ Chat session deleted with image cleanup');
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
      console.log('🔍 Deleting user with image cleanup...');
      
      // Import ImageStorageService dynamically to avoid circular dependencies
      const { ImageStorageService } = await import('./imageStorageService');
      
      // Delete all user images
      await ImageStorageService.deleteUserImages(userId);
      
      // Delete user from Firestore
      await db.collection(COLLECTIONS.USERS).doc(userId).delete();
      
      console.log('✅ User deleted with image cleanup');
    } catch (error) {
      console.error('❌ Failed to delete user:', error);
      throw error;
    }
  }
}
