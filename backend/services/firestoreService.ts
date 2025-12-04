/**
 * Firestore Service for Mark Homework System
 * Handles real database storage and retrieval of marking results
 */

import admin from 'firebase-admin';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getFirestore } from '../config/firebase.js';
import { createUserMessage, createAIMessage } from '../utils/messageUtils.js';

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
  UNIFIED_SESSIONS: 'unifiedSessions',  // NEW: Single collection with nested messages
  SUBJECT_MARKING_RESULTS: 'subjectMarkingResults',  // NEW: Subject-based marking results
  USAGE_RECORDS: 'usageRecords'  // NEW: Usage statistics for analytics
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
      text?: string;
    }>;
  };
  annotatedImage?: string;
  processingStats: {
    processingTimeMs: number;
    modelUsed: string;
    annotations: number;
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
   * Determine the appropriate messageType for a session based on existing and new messages
   * Simple rule: If follow-up message type doesn't match original session type, change to "Mixed"
   */
  private static determineSessionMessageType(existingMessages: any[], newMessage: any, existingMessageType: string): 'Marking' | 'Question' | 'Chat' | 'Mixed' {
    // If session is already Mixed, keep it Mixed
    if (existingMessageType === 'Mixed') {
      return 'Mixed';
    }

    // Determine what type the new message represents
    let newMessageCategory: 'Marking' | 'Question' | 'Chat';

    if (newMessage.type === 'marking_original' || newMessage.type === 'marking_annotated') {
      newMessageCategory = 'Marking';
    } else if (newMessage.type === 'question_original' || newMessage.type === 'question_response') {
      newMessageCategory = 'Question';
    } else if (newMessage.type === 'chat' || newMessage.type === 'follow_up') {
      newMessageCategory = 'Chat';
    } else {
      // Unknown message type, keep existing type
      return existingMessageType as 'Marking' | 'Question' | 'Chat';
    }

    // If the new message category is different from the existing session type, make it Mixed
    if (newMessageCategory !== existingMessageType) {
      return 'Mixed';
    }

    // Otherwise, keep the existing message type
    return existingMessageType as 'Marking' | 'Question' | 'Chat';
  }

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
    sessionStats?: any;
    isPastPaper?: boolean;
    detectedQuestion?: any;
  }): Promise<string> {
    try {
      ensureDbAvailable();
      const { sessionId, title, userId, messageType, messages, sessionStats, detectedQuestion } = sessionData;

      // Import ImageStorageService
      const { ImageStorageService } = await import('./imageStorageService.js');

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

          // Preserve ALL fields from the input message, with specific overrides for storage
          const messageDoc = {
            ...message, // Preserve all original fields
            imageLink: processedImageLink, // Override with processed image link
            // Only add updatedAt if it doesn't already exist (preserve existing timestamps)
            ...(message.updatedAt ? {} : { updatedAt: new Date().toISOString() })
          };

          // Remove null values, imageData, and base64 pdfContexts (base64 should not be in Firestore)
          const finalMessage = Object.fromEntries(
            Object.entries(messageDoc).filter(([key, value]) => {
              if (value === null || value === undefined) return false;
              if (key === 'imageData' && typeof value === 'string' && value.startsWith('data:image')) {
                // DIAGNOSTIC: Log if imageData (base64) is being filtered out
                const sizeMB = value.length / (1024 * 1024);
                console.log(`🔍 [DIAGNOSTIC] Filtering out imageData (base64) from message ${index}, size: ${sizeMB.toFixed(2)}MB`);
                return false; // Don't include base64 imageData in Firestore
              }
              if (key === 'pdfContexts' && Array.isArray(value)) {
                // Filter out base64 URLs from pdfContexts - only keep Firebase Storage URLs
                const filteredPdfContexts = value.map((pdf: any) => {
                  if (pdf.url && typeof pdf.url === 'string' && pdf.url.startsWith('data:')) {
                    // This is base64, filter it out
                    const sizeMB = pdf.url.length / (1024 * 1024);
                    console.log(`🔍 [DIAGNOSTIC] Filtering out pdfContext base64 from message ${index} (${pdf.originalFileName || 'unknown'}), size: ${sizeMB.toFixed(2)}MB`);
                    return null;
                  }
                  return pdf; // Keep Firebase URLs
                }).filter((pdf: any) => pdf !== null);

                // Only include pdfContexts if there are valid URLs (not all base64)
                if (filteredPdfContexts.length === 0) {
                  return false; // Remove pdfContexts if all items were base64
                }
                // Replace with filtered array
                messageDoc[key] = filteredPdfContexts;
                return true;
              }
              return true;
            })
          );

          // DIAGNOSTIC: Log message payload size before saving
          const messageSize = JSON.stringify(finalMessage).length;
          const messageSizeMB = messageSize / (1024 * 1024);
          if (messageSizeMB > 1) {
            console.log(`🔍 [DIAGNOSTIC] Message ${index} payload size: ${messageSize.toLocaleString()} bytes (${messageSizeMB.toFixed(2)}MB)`);
            // Log which fields are largest
            Object.entries(finalMessage).forEach(([key, value]) => {
              const fieldSize = JSON.stringify(value).length;
              const fieldSizeMB = fieldSize / (1024 * 1024);
              if (fieldSizeMB > 0.5) {
                console.log(`  - Field "${key}": ${fieldSize.toLocaleString()} bytes (${fieldSizeMB.toFixed(2)}MB)`);
              }
            });
          }

          return finalMessage;
        }));

      } catch (messageProcessingError) {
        console.error(`❌ Message processing failed:`, messageProcessingError);
        console.error(`❌ Error details:`, messageProcessingError.message);
        console.error(`❌ Error stack:`, messageProcessingError.stack);
        throw new Error(`Message processing failed: ${messageProcessingError.message}`);
      }

      // Create single session document with nested messages

      // DIAGNOSTIC: Calculate total payload size before saving
      const totalPayloadSize = JSON.stringify(unifiedMessages).length;
      const totalPayloadSizeMB = totalPayloadSize / (1024 * 1024);


      // Calculate cost for the session if sessionStats exists
      let finalSessionStats = sessionStats || null;
      if (sessionStats) {
        const { calculateTotalCost } = await import('../utils/CostCalculator.js');
        const cost = calculateTotalCost(sessionStats);
        finalSessionStats = {
          ...sessionStats,
          totalCost: cost.total,
          costBreakdown: {
            llmCost: cost.llmCost,
            mathpixCost: cost.mathpixCost
          }
        };
      }

      const sessionDoc: any = {
        id: sessionId,
        title,
        userId,
        messageType,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        favorite: false,
        rating: 0,
        isPastPaper: sessionData.isPastPaper || false,
        sessionStats: finalSessionStats,
        unifiedMessages: unifiedMessages  // Nested messages array with storage URLs
      };

      // DIAGNOSTIC: Calculate final document size
      const finalDocSize = JSON.stringify(sessionDoc).length;
      const finalDocSizeMB = finalDocSize / (1024 * 1024);


      // Only include detectedQuestion if it exists and is not null
      if (detectedQuestion) {
        sessionDoc.detectedQuestion = detectedQuestion;
      }

      // Save complete session document to unifiedSessions collection

      if (!db) {
        throw new Error('Database instance is null - Firestore not properly initialized');
      }

      try {
        await db.collection(COLLECTIONS.UNIFIED_SESSIONS).doc(sessionId).set(sessionDoc);
        // Verify the session was saved
        const verifyDoc = await db.collection(COLLECTIONS.UNIFIED_SESSIONS).doc(sessionId).get();
        if (!verifyDoc.exists) {
          throw new Error(`Session verification failed - document not found after save`);
        }

        // Write usage record if cost breakdown exists
        if (finalSessionStats?.costBreakdown) {
          await this.createUsageRecord(sessionId, userId, sessionDoc.createdAt, finalSessionStats);
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
        const timeA = new Date(a.timestamp || 0).getTime();
        const timeB = new Date(b.timestamp || 0).getTime();
        return timeA - timeB;
      });

      // Map messages to ensure frontend compatibility while preserving object references
      const mappedMessages = unifiedMessages.map((msg: any) => {

        // Only modify if absolutely necessary to preserve React component state
        if (!msg.id && msg.messageId) {
          // Add id field if missing - but only if it's actually missing
          if (msg.id === undefined) {
            msg.id = msg.messageId;
          }
          return msg; // Return the SAME object reference
        } else if (!msg.messageId && msg.id) {
          // Add messageId field if missing - but only if it's actually missing
          if (msg.messageId === undefined) {
            msg.messageId = msg.id;
          }
          return msg; // Return the SAME object reference
        } else if (!msg.id && !msg.messageId) {
          // Both missing, add both (shouldn't happen in normal flow)
          const fallbackId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          msg.id = fallbackId;
          msg.messageId = fallbackId;
          return msg; // Return the SAME object reference
        }
        // Both fields exist, return original object to preserve React state
        return msg;
      });

      // Create result without unifiedMessages to avoid duplication
      const result = {
        id: sessionData.id,
        title: sessionData.title,
        userId: sessionData.userId,
        messageType: sessionData.messageType,
        createdAt: sessionData.createdAt,
        updatedAt: sessionData.updatedAt,
        favorite: sessionData.favorite,
        rating: sessionData.rating,
        isPastPaper: sessionData.isPastPaper,  // Include isPastPaper
        detectedQuestion: sessionData.detectedQuestion,
        sessionStats: sessionData.sessionStats,
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
          detectedQuestion: sessionData.detectedQuestion || null, // Include detectedQuestion for Library page
          lastMessage: lastMessage ? {
            content: lastMessage.content,
            role: lastMessage.role,
            timestamp: lastMessage.timestamp
          } : null,
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
    processingStats: any,
    questionDetection?: any
  ): Promise<void> {
    try {
      // Upload images to Firebase Storage
      const { ImageStorageService } = await import('./imageStorageService.js');

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
        questionText: classification?.questions && Array.isArray(classification.questions)
          ? classification.questions.map((q: any) => q.text).join(' ')
          : classification?.extractedQuestionText || '',
        questionNumber: questionDetection.match?.questionNumber || '',
        subQuestionNumber: questionDetection.match?.subQuestionNumber || '',
        examBoard: questionDetection.match?.board || '',
        examCode: questionDetection.match?.paperCode || '',
        paperTitle: questionDetection.match?.qualification || '',
        subject: questionDetection.match?.qualification || '', // Using qualification as subject
        tier: questionDetection.match?.tier || '',
        examSeries: questionDetection.match?.examSeries || '',
        marks: questionDetection.match?.marks
      } : {
        found: false,
        questionText: '',
        questionNumber: '',
        subQuestionNumber: '',
        examBoard: '',
        examCode: '',
        paperTitle: '',
        subject: '',
        tier: '',
        examSeries: ''
      };

      // Create original image message using centralized factory
      const originalMessage = createUserMessage({
        content: 'Uploaded homework for marking',
        imageLink: originalImageUrl,
        sessionId: sessionId,
        model: 'auto'
      });

      // Add detectedQuestion data
      (originalMessage as any).detectedQuestion = removeUndefinedValues(detectedQuestion);

      // Create annotated image message with context summary using centralized factory
      const contextSummary = this.generateMarkingContextSummary(instructions, result);
      const annotatedMessage = createAIMessage({
        content: contextSummary,
        imageData: null, // We're using imageLink instead
        category: "questionAnswer",
        processingStats: {
          processingTimeMs: 0,
          modelUsed: 'auto',
          apiUsed: 'Legacy Session Creation',
          ocrMethod: 'Legacy Session Creation'
        }
      });

      // Add image link, detectedQuestion data, and student score
      (annotatedMessage as any).imageLink = annotatedImageUrl;
      (annotatedMessage as any).detectedQuestion = removeUndefinedValues(detectedQuestion);
      (annotatedMessage as any).studentScore = instructions.studentScore;

      // Add both messages to the session using unified approach
      await this.addMessageToUnifiedSession(sessionId, originalMessage);
      await this.addMessageToUnifiedSession(sessionId, annotatedMessage);

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
      const { ImageStorageService } = await import('./imageStorageService.js');

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
        questionText: classification?.questions && Array.isArray(classification.questions)
          ? classification.questions.map((q: any) => q.text).join(' ')
          : classification?.extractedQuestionText || '',
        questionNumber: questionDetection.match?.questionNumber || '',
        subQuestionNumber: questionDetection.match?.subQuestionNumber || '',
        examBoard: questionDetection.match?.board || '',
        examCode: questionDetection.match?.paperCode || '',
        paperTitle: questionDetection.match?.qualification || '',
        subject: questionDetection.match?.qualification || '', // Using qualification as subject
        tier: questionDetection.match?.tier || '',
        examSeries: questionDetection.match?.examSeries || '',
        marks: questionDetection.match?.marks
      } : {
        found: false,
        questionText: '',
        questionNumber: '',
        subQuestionNumber: '',
        examBoard: '',
        examCode: '',
        paperTitle: '',
        subject: '',
        tier: '',
        examSeries: ''
      };

      // Create question image message using centralized factory
      const questionMessage = createUserMessage({
        content: 'Uploaded question for tutoring',
        imageLink: originalImageUrl,
        sessionId: sessionId,
        model: 'auto'
      });

      // Add detectedQuestion data
      (questionMessage as any).detectedQuestion = removeUndefinedValues(detectedQuestion);

      // Add message to the session using unified approach
      await this.addMessageToUnifiedSession(sessionId, questionMessage);

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
   * Delete user with image cleanup
   */
  static async deleteUser(userId: string): Promise<void> {
    try {
      // Import ImageStorageService dynamically to avoid circular dependencies
      const { ImageStorageService } = await import('./imageStorageService.js');

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
      // Get session before deleting to extract subject
      const session = await this.getUnifiedSession(sessionId);

      // Delete the session document (which contains nested messages)
      await db.collection(COLLECTIONS.UNIFIED_SESSIONS).doc(sessionId).delete();

      // Remove marking result from subjectMarkingResults if session had marking results
      if (session) {
        // Find marking message with detectedQuestion
        const markingMessage = session.messages?.find(
          (msg: any) => msg.role === 'assistant' && msg.studentScore && msg.detectedQuestion?.found
        );

        if (markingMessage?.detectedQuestion) {
          const subject = markingMessage.detectedQuestion.examPapers?.[0]?.subject;
          if (subject) {
            // Remove in background (don't wait)
            this.removeMarkingResultFromSubject(userId, subject, sessionId).catch(err => {
              console.error('❌ [SUBJECT MARKING RESULT] Failed to remove marking result on session delete:', err);
            });
          }
        }
      }

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
    try {
      // Get the existing session
      const sessionRef = db.collection(COLLECTIONS.UNIFIED_SESSIONS).doc(sessionId);
      const sessionDoc = await sessionRef.get();

      if (!sessionDoc.exists) {
        throw new Error(`Session ${sessionId} not found`);
      }

      const sessionData = sessionDoc.data();
      const existingMessages = sessionData?.unifiedMessages || [];
      const existingMessageType = sessionData?.messageType || 'Chat';

      // Sanitize the new message
      const sanitizedMessage = sanitizeForFirestore(message);

      // Determine if the session should become "Mixed" based on message types
      const newMessageType = this.determineSessionMessageType(existingMessages, sanitizedMessage, existingMessageType);

      // Log when a session becomes "Mixed"
      if (newMessageType === 'Mixed' && existingMessageType !== 'Mixed') {
        // Session type changed to Mixed
      }

      // Add the new message to the array
      const updatedMessages = [...existingMessages, sanitizedMessage];

      // Get existing sessionStats and accumulate token counts
      const existingStats = sessionData?.sessionStats || {};
      const newMessageTokens = sanitizedMessage?.processingStats?.llmTokens || 0;
      const newMessageMathpix = sanitizedMessage?.processingStats?.mathpixCalls || 0;

      // Accumulate token counts (fix bug where they were being reset)
      const accumulatedLlmTokens = (existingStats.totalLlmTokens || 0) + newMessageTokens;
      const accumulatedMathpixCalls = (existingStats.totalMathpixCalls || 0) + newMessageMathpix;

      // Calculate cost based on accumulated stats
      const { calculateTotalCost } = await import('../utils/CostCalculator.js');
      const updatedStats = {
        ...existingStats,
        totalLlmTokens: accumulatedLlmTokens,
        totalMathpixCalls: accumulatedMathpixCalls,
        totalTokens: accumulatedLlmTokens + accumulatedMathpixCalls,
        lastModelUsed: sanitizedMessage?.processingStats?.modelUsed || existingStats.lastModelUsed || 'auto',
        lastApiUsed: sanitizedMessage?.processingStats?.apiUsed || existingStats.lastApiUsed || 'Unknown',
        totalMessages: updatedMessages.length,
        hasImage: updatedMessages.some((msg: any) => msg.imageLink)
      };

      const cost = calculateTotalCost(updatedStats);

      // Update the session with new message and metadata
      const updateData = {
        unifiedMessages: updatedMessages,
        messageType: newMessageType, // Update messageType if it should become "Mixed"
        updatedAt: new Date().toISOString(),
        'sessionStats.totalMessages': updatedMessages.length,
        'sessionStats.hasImage': updatedMessages.some((msg: any) => msg.imageLink),
        'sessionStats.lastApiUsed': updatedStats.lastApiUsed,
        'sessionStats.lastModelUsed': updatedStats.lastModelUsed,
        'sessionStats.totalLlmTokens': accumulatedLlmTokens,
        'sessionStats.totalMathpixCalls': accumulatedMathpixCalls,
        'sessionStats.totalTokens': updatedStats.totalTokens,
        'sessionStats.totalCost': cost.total,
        'sessionStats.costBreakdown': {
          llmCost: cost.llmCost,
          mathpixCost: cost.mathpixCost
        }
      };

      await sessionRef.update(updateData);

      // Update usage record since cost was recalculated
      await this.createUsageRecord(sessionId, sessionData.userId, sessionData.createdAt, {
        ...updatedStats,
        totalCost: cost.total,
        costBreakdown: {
          llmCost: cost.llmCost,
          mathpixCost: cost.mathpixCost
        }
      });

    } catch (error) {
      console.error('❌ Failed to add message to UnifiedSession:', error);
      throw error;
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

      // If sessionStats is being updated, calculate cost
      if (updates.sessionStats) {
        const { calculateTotalCost } = await import('../utils/CostCalculator.js');
        const cost = calculateTotalCost(updates.sessionStats);
        updates.sessionStats.totalCost = cost.total;
        updates.sessionStats.costBreakdown = {
          llmCost: cost.llmCost,
          mathpixCost: cost.mathpixCost
        };
      }

      // Sanitize updates and add timestamp
      const sanitizedUpdates = sanitizeForFirestore({
        ...updates,
        updatedAt: new Date().toISOString()
      });

      await sessionRef.update(sanitizedUpdates);

      // Update usage record if sessionStats (with cost) was updated
      if (updates.sessionStats?.costBreakdown) {
        const sessionData = sessionDoc.data();
        await this.createUsageRecord(sessionId, sessionData.userId, sessionData.createdAt, updates.sessionStats);
      }

    } catch (error) {
      console.error('❌ Failed to update UnifiedSession:', error);
      throw error;
    }
  }

  /**
   * Create usage record for analytics
   * This is a denormalized view optimized for querying usage statistics
   */
  static async createUsageRecord(
    sessionId: string,
    userId: string,
    createdAt: string,
    sessionStats: any
  ): Promise<void> {
    if (!db) {
      throw new Error('Firestore not available');
    }

    const costBreakdown = sessionStats.costBreakdown;
    if (!costBreakdown) {
      throw new Error('Cost breakdown is required');
    }

    const createdAtDate = new Date(createdAt);
    const llmCost = costBreakdown.llmCost;
    const mathpixCost = costBreakdown.mathpixCost;
    const totalCost = sessionStats.totalCost;
    const modelUsed = sessionStats.lastModelUsed;

    // Determine if model is Gemini or GPT and split costs accordingly
    const isGemini = modelUsed && (modelUsed.startsWith('gemini-') || modelUsed === 'auto');
    const geminiCost = isGemini ? llmCost : 0;
    const gptCost = !isGemini ? llmCost : 0;

    // Create usage record document
    const usageRecord = {
      sessionId,
      userId,
      createdAt: admin.firestore.Timestamp.fromDate(createdAtDate),
      totalCost: Math.round(totalCost * 1000000) / 1000000,
      llmCost: Math.round(llmCost * 1000000) / 1000000,
      geminiCost: Math.round(geminiCost * 1000000) / 1000000,
      gptCost: Math.round(gptCost * 1000000) / 1000000,
      mathpixCost: Math.round(mathpixCost * 1000000) / 1000000,
      modelUsed,
      date: createdAtDate.toISOString().split('T')[0], // YYYY-MM-DD format
      // NEW: API request tracking
      apiRequests: sessionStats.apiRequests || 0,
      apiRequestBreakdown: sessionStats.apiRequestBreakdown || {}
    };

    console.log('[DEBUG] Firestore usageRecord being saved:', JSON.stringify({
      sessionId: usageRecord.sessionId,
      apiRequests: usageRecord.apiRequests,
      apiRequestBreakdown: usageRecord.apiRequestBreakdown
    }, null, 2));

    // Use sessionId as document ID
    await db.collection(COLLECTIONS.USAGE_RECORDS).doc(sessionId).set(usageRecord);
  }

  /**
   * Get subject marking result document from subjectMarkingResults collection
   */
  static async getSubjectMarkingResult(userId: string, subject: string): Promise<any | null> {
    try {
      ensureDbAvailable();
      const normalizedSubject = subject.toLowerCase().replace(/\s+/g, '_');
      const docId = `${userId}_${normalizedSubject}`;
      const doc = await db.collection(COLLECTIONS.SUBJECT_MARKING_RESULTS).doc(docId).get();

      if (doc.exists) {
        return { id: doc.id, ...doc.data() };
      }
      return null;
    } catch (error) {
      console.error('❌ Failed to get subject marking result:', error);
      throw error;
    }
  }

  /**
   * Add or update marking result in subjectMarkingResults
   * This is called in background after marking completes
   */
  static async addMarkingResultToSubject(
    userId: string,
    subject: string,
    markingResult: any
  ): Promise<void> {
    try {
      ensureDbAvailable();
      const normalizedSubject = subject.toLowerCase().replace(/\s+/g, '_');
      const docId = `${userId}_${normalizedSubject}`;
      const docRef = db.collection(COLLECTIONS.SUBJECT_MARKING_RESULTS).doc(docId);
      const doc = await docRef.get();

      const now = new Date().toISOString();

      if (doc.exists) {
        // Update existing document
        const existing = doc.data()!;
        const markingResults = existing.markingResults || [];

        // Remove existing result for this sessionId (if re-marking)
        const filteredResults = markingResults.filter((r: any) => r.sessionId !== markingResult.sessionId);

        // Add new marking result
        filteredResults.push(markingResult);

        // Update statistics in background (don't wait)
        this.updateSubjectStatistics(docId, filteredResults).catch(err => {
          console.error('❌ Failed to update statistics in background:', err);
        });

        // Update document
        // Note: reAnalysisNeeded is now handled per filter combination in analysis structure
        await docRef.update({
          markingResults: filteredResults,
          updatedAt: now
        });
      } else {
        // Create new document
        const newDoc: any = {
          userId,
          subject,
          markingResults: [markingResult],
          statistics: {
            totalSessions: 1,
            totalQuestions: markingResult.questionResults?.length || 0,
            averageScore: {
              awardedMarks: markingResult.overallScore.awardedMarks,
              totalMarks: markingResult.overallScore.totalMarks,
              percentage: markingResult.overallScore.percentage
            },
            highestGrade: markingResult.grade,
            averageGrade: markingResult.grade,
            examSeries: [markingResult.examMetadata.examSeries],
            qualifications: [markingResult.examMetadata.qualification],
            examBoards: [markingResult.examMetadata.examBoard]
          },
          createdAt: now,
          updatedAt: now
        };

        await docRef.set(sanitizeForFirestore(newDoc));
      }
    } catch (error) {
      console.error('❌ Failed to add marking result to subject:', error);
      throw error;
    }
  }

  /**
   * Update aggregated statistics for a subject
   * Called in background after adding marking results
   */
  private static async updateSubjectStatistics(docId: string, markingResults: any[]): Promise<void> {
    try {
      ensureDbAvailable();

      if (markingResults.length === 0) {
        return;
      }

      // Calculate aggregated statistics
      const totalSessions = markingResults.length;
      const totalQuestions = markingResults.reduce((sum, r) => sum + (r.questionResults?.length || 0), 0);

      // Calculate average score
      const totalAwarded = markingResults.reduce((sum, r) => sum + (r.overallScore?.awardedMarks || 0), 0);
      const totalPossible = markingResults.reduce((sum, r) => sum + (r.overallScore?.totalMarks || 0), 0);
      const avgAwarded = totalSessions > 0 ? Math.round(totalAwarded / totalSessions) : 0;
      const avgTotal = totalSessions > 0 ? Math.round(totalPossible / totalSessions) : 0;
      const avgPercentage = avgTotal > 0 ? Math.round((avgAwarded / avgTotal) * 100) : 0;

      // Collect unique values
      const examSeriesSet = new Set<string>();
      const qualificationsSet = new Set<string>();
      const examBoardsSet = new Set<string>();
      const grades: string[] = [];

      markingResults.forEach(r => {
        if (r.examMetadata?.examSeries) examSeriesSet.add(r.examMetadata.examSeries);
        if (r.examMetadata?.qualification) qualificationsSet.add(r.examMetadata.qualification);
        if (r.examMetadata?.examBoard) examBoardsSet.add(r.examMetadata.examBoard);
        if (r.grade) grades.push(r.grade);
      });

      // Find highest grade (convert to number for comparison)
      const highestGrade = grades.length > 0
        ? grades.reduce((highest, grade) => {
          const numHighest = parseInt(highest, 10) || 0;
          const numGrade = parseInt(grade, 10) || 0;
          return numGrade > numHighest ? grade : highest;
        })
        : undefined;

      // Find most common grade
      const gradeCounts = new Map<string, number>();
      grades.forEach(g => gradeCounts.set(g, (gradeCounts.get(g) || 0) + 1));
      let maxCount = 0;
      let averageGrade: string | undefined = undefined;
      gradeCounts.forEach((count, grade) => {
        if (count > maxCount) {
          maxCount = count;
          averageGrade = grade;
        }
      });

      // Update statistics
      await db.collection(COLLECTIONS.SUBJECT_MARKING_RESULTS).doc(docId).update({
        statistics: {
          totalSessions,
          totalQuestions,
          averageScore: {
            awardedMarks: avgAwarded,
            totalMarks: avgTotal,
            percentage: avgPercentage
          },
          highestGrade,
          averageGrade,
          examSeries: Array.from(examSeriesSet),
          qualifications: Array.from(qualificationsSet),
          examBoards: Array.from(examBoardsSet)
        }
      });
    } catch (error) {
      console.error('❌ Failed to update subject statistics:', error);
      throw error;
    }
  }

  /**
   * Remove marking result from subject (when session is deleted/re-marked)
   */
  static async removeMarkingResultFromSubject(
    userId: string,
    subject: string,
    sessionId: string
  ): Promise<void> {
    try {
      ensureDbAvailable();
      const normalizedSubject = subject.toLowerCase().replace(/\s+/g, '_');
      const docId = `${userId}_${normalizedSubject}`;
      const docRef = db.collection(COLLECTIONS.SUBJECT_MARKING_RESULTS).doc(docId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return; // Document doesn't exist, nothing to remove
      }

      const existing = doc.data()!;
      const markingResults = (existing.markingResults || []).filter(
        (r: any) => r.sessionId !== sessionId
      );

      if (markingResults.length === 0) {
        // No more marking results, delete the document
        await docRef.delete();
      } else {
        // Update document with filtered results and recalculate statistics
        // Note: Analysis cache is per filter combination, so no global reAnalysisNeeded flag needed
        await docRef.update({
          markingResults,
          updatedAt: new Date().toISOString()
        });

        // Update statistics in background
        this.updateSubjectStatistics(docId, markingResults).catch(err => {
          console.error('❌ Failed to update statistics in background:', err);
        });
      }
    } catch (error) {
      console.error('❌ Failed to remove marking result from subject:', error);
      throw error;
    }
  }

  /**
   * Update analysis in subjectMarkingResults with filter-based storage
   * Stores analysis in nested structure: analysis[qualification][examBoard][paperCodeSetKey]
   */
  static async updateSubjectAnalysis(
    userId: string,
    subject: string,
    analysis: any,
    modelUsed: string,
    qualification?: string,
    examBoard?: string,
    paperCodeSet?: string[]
  ): Promise<void> {
    try {
      ensureDbAvailable();
      const normalizedSubject = subject.toLowerCase().replace(/\s+/g, '_');
      const docId = `${userId}_${normalizedSubject}`;
      const docRef = db.collection(COLLECTIONS.SUBJECT_MARKING_RESULTS).doc(docId);
      const doc = await docRef.get();

      const analysisData = {
        ...analysis,
        generatedAt: new Date().toISOString(),
        modelUsed
      };

      if (!qualification || !examBoard || !paperCodeSet || paperCodeSet.length === 0) {
        // If no filters provided, store at root level (legacy support)
        await docRef.update({
          analysis: analysisData
        });
        return;
      }

      // Generate paper code set key (e.g., "1H_2H_3H")
      const paperCodeSetKey = paperCodeSet.sort().join('_');

      // Get existing analysis structure
      const existing = doc.exists ? doc.data() : null;
      const existingAnalysis = existing?.analysis || {};

      // Build nested structure
      const updatedAnalysis = { ...existingAnalysis };
      if (!updatedAnalysis[qualification]) {
        updatedAnalysis[qualification] = {};
      }
      if (!updatedAnalysis[qualification][examBoard]) {
        updatedAnalysis[qualification][examBoard] = {};
      }
      updatedAnalysis[qualification][examBoard][paperCodeSetKey] = analysisData;

      await docRef.update({
        analysis: updatedAnalysis
      });
    } catch (error) {
      console.error('❌ Failed to update subject analysis:', error);
      throw error;
    }
  }

  /**
   * Get analysis from subjectMarkingResults by filter combination
   */
  static async getSubjectAnalysisByFilters(
    userId: string,
    subject: string,
    qualification?: string,
    examBoard?: string,
    paperCodeSet?: string[]
  ): Promise<any | null> {
    try {
      const subjectResult = await this.getSubjectMarkingResult(userId, subject);
      if (!subjectResult || !subjectResult.analysis) {
        return null;
      }

      const analysis = subjectResult.analysis;

      // If no filters provided, return root level analysis (legacy support)
      if (!qualification || !examBoard || !paperCodeSet || paperCodeSet.length === 0) {
        // Check if it's the old structure (direct analysis object) or new structure
        if (analysis.performance || analysis.strengths) {
          return analysis; // Old structure
        }
        return null;
      }

      // Generate paper code set key
      const paperCodeSetKey = paperCodeSet.sort().join('_');

      // Navigate nested structure
      if (analysis[qualification]?.[examBoard]?.[paperCodeSetKey]) {
        return analysis[qualification][examBoard][paperCodeSetKey];
      }

      return null;
    } catch (error) {
      console.error('❌ Failed to get subject analysis by filters:', error);
      return null;
    }
  }

  /**
   * Get all subject marking results for a user
   */
  static async getUserSubjectMarkingResults(userId: string): Promise<any[]> {
    try {
      ensureDbAvailable();
      const snapshot = await db.collection(COLLECTIONS.SUBJECT_MARKING_RESULTS)
        .where('userId', '==', userId)
        .get();

      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('❌ Failed to get user subject marking results:', error);
      throw error;
    }
  }
}
