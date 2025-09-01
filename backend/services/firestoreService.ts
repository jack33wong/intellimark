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
  MARKING_RESULTS: 'marking_results',
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
        id: docRef.id,
        ...data
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
          id: doc.id,
          ...data
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
        uid: docRef.id,
        ...data
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
}
