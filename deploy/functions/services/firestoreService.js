import admin from 'firebase-admin';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
if (!admin.apps || admin.apps.length === 0) {
    try {
        const serviceAccountPath = join(__dirname, '..', 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccountPath)
        });
        console.log('✅ Firebase Admin initialized successfully in Firestore service');
    }
    catch (error) {
        console.error('❌ Firebase Admin initialization failed in Firestore service:', error);
    }
}
const db = admin.firestore();
const COLLECTIONS = {
    MARKING_RESULTS: 'markingResults',
    USERS: 'users',
    SESSIONS: 'sessions'
};
function sanitizeFirestoreData(obj) {
    return JSON.parse(JSON.stringify(obj, (key, value) => {
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
    static async saveMarkingResults(userId, userEmail, imageData, model, isQuestionOnly, classification, ocrResult, markingInstructions, annotatedImage, metadata) {
        try {
            console.log('🔍 Saving marking results to Firestore...');
            const docData = {
                userId,
                userEmail,
                imageData,
                model,
                isQuestionOnly,
                classification,
                ocrResult,
                markingInstructions,
                ...(annotatedImage && { annotatedImage }),
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
        }
        catch (error) {
            console.error('❌ Failed to save marking results to Firestore:', error);
            throw new Error(`Firestore save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    static async getMarkingResults(resultId) {
        try {
            console.log('🔍 Retrieving marking results from Firestore:', resultId);
            const docRef = await db.collection(COLLECTIONS.MARKING_RESULTS).doc(resultId).get();
            if (!docRef.exists) {
                console.log('🔍 Marking results not found:', resultId);
                return null;
            }
            const data = docRef.data();
            console.log('✅ Marking results retrieved from Firestore');
            return {
                ...data,
                id: docRef.id
            };
        }
        catch (error) {
            console.error('❌ Failed to retrieve marking results from Firestore:', error);
            throw new Error(`Firestore retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    static async getUserMarkingResults(userId, limit = 50) {
        try {
            console.log('🔍 Retrieving marking results for user:', userId);
            const querySnapshot = await db.collection(COLLECTIONS.MARKING_RESULTS)
                .where('userId', '==', userId)
                .limit(limit)
                .get();
            const results = [];
            querySnapshot.forEach(doc => {
                const data = doc.data();
                results.push({
                    ...data,
                    id: doc.id
                });
            });
            console.log(`✅ Retrieved ${results.length} marking results for user`);
            return results;
        }
        catch (error) {
            console.error('❌ Failed to retrieve user marking results from Firestore:', error);
            throw new Error(`Firestore user retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    static async updateMarkingResults(resultId, updates) {
        try {
            console.log('🔍 Updating marking results in Firestore:', resultId);
            await db.collection(COLLECTIONS.MARKING_RESULTS).doc(resultId).update({
                ...updates,
                updatedAt: admin.firestore.Timestamp.now()
            });
            console.log('✅ Marking results updated in Firestore');
        }
        catch (error) {
            console.error('❌ Failed to update marking results in Firestore:', error);
            throw new Error(`Firestore update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    static async deleteMarkingResults(resultId) {
        try {
            console.log('🔍 Deleting marking results from Firestore:', resultId);
            await db.collection(COLLECTIONS.MARKING_RESULTS).doc(resultId).delete();
            console.log('✅ Marking results deleted from Firestore');
        }
        catch (error) {
            console.error('❌ Failed to delete marking results from Firestore:', error);
            throw new Error(`Firestore deletion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    static async saveUser(userData) {
        try {
            console.log('🔍 Saving/updating user in Firestore:', userData.uid);
            await db.collection(COLLECTIONS.USERS).doc(userData.uid).set({
                ...userData,
                updatedAt: admin.firestore.Timestamp.now()
            }, { merge: true });
            console.log('✅ User saved/updated in Firestore');
        }
        catch (error) {
            console.error('❌ Failed to save user in Firestore:', error);
            throw new Error(`Firestore user save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    static async getUser(uid) {
        try {
            console.log('🔍 Retrieving user from Firestore:', uid);
            const docRef = await db.collection(COLLECTIONS.USERS).doc(uid).get();
            if (!docRef.exists) {
                console.log('🔍 User not found:', uid);
                return null;
            }
            const data = docRef.data();
            console.log('✅ User retrieved from Firestore');
            return {
                ...data,
                uid: docRef.id
            };
        }
        catch (error) {
            console.error('❌ Failed to retrieve user from Firestore:', error);
            throw new Error(`Firestore user retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    static async getSystemStats() {
        try {
            console.log('🔍 Retrieving system statistics from Firestore...');
            const [resultsSnapshot, usersSnapshot] = await Promise.all([
                db.collection(COLLECTIONS.MARKING_RESULTS).count().get(),
                db.collection(COLLECTIONS.USERS).count().get()
            ]);
            const oneDayAgo = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
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
        }
        catch (error) {
            console.error('❌ Failed to retrieve system statistics from Firestore:', error);
            throw new Error(`Firestore stats retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    static async createChatSession(sessionData) {
        try {
            console.log('🔍 Creating chat session in Firestore...');
            const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            console.log('🔍 Raw sessionData:', JSON.stringify(sessionData, null, 2));
            const serializedMessages = sessionData.messages.map(msg => {
                const sanitized = {
                    id: String(msg.id || ''),
                    role: String(msg.role || ''),
                    content: String(msg.content || ''),
                    timestamp: new Date().toISOString()
                };
                if (msg.imageData && typeof msg.imageData === 'string') {
                    sanitized.imageData = msg.imageData;
                }
                if (msg.model && typeof msg.model === 'string') {
                    sanitized.model = msg.model;
                }
                return sanitized;
            });
            const docData = {
                id: sessionId,
                title: String(sessionData.title || 'Untitled'),
                messages: serializedMessages,
                userId: String(sessionData.userId || 'anonymous'),
                timestamp: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                contextSummary: sessionData.contextSummary || null,
                lastSummaryUpdate: sessionData.lastSummaryUpdate ? new Date(sessionData.lastSummaryUpdate).toISOString() : null
            };
            console.log('🔍 Final docData payload:', JSON.stringify(docData, null, 2));
            const sanitizedDocData = sanitizeFirestoreData(docData);
            console.log('🔍 Sanitized payload:', JSON.stringify(sanitizedDocData, null, 2));
            try {
                await db.collection(COLLECTIONS.SESSIONS).doc(sessionId).set(sanitizedDocData);
            }
            catch (firestoreError) {
                console.error('❌ Direct Firestore write failed, trying alternative approach:', firestoreError);
                const batch = db.batch();
                const docRef = db.collection(COLLECTIONS.SESSIONS).doc(sessionId);
                batch.set(docRef, sanitizedDocData);
                await batch.commit();
            }
            console.log('✅ Chat session created in Firestore:', sessionId);
            return sessionId;
        }
        catch (error) {
            console.error('❌ Failed to create chat session in Firestore:', error);
            throw new Error(`Firestore session creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    static async getChatSession(sessionId) {
        try {
            console.log('🔍 Getting chat session from Firestore:', sessionId);
            const doc = await db.collection(COLLECTIONS.SESSIONS).doc(sessionId).get();
            if (!doc.exists) {
                console.log('📝 Chat session not found in Firestore');
                return null;
            }
            const data = doc.data();
            console.log('✅ Chat session retrieved from Firestore');
            return {
                id: doc.id,
                ...data,
                timestamp: data?.['timestamp']?.toDate ? data['timestamp'].toDate() : new Date(data?.['timestamp']),
                createdAt: data?.['createdAt']?.toDate ? data['createdAt'].toDate() : new Date(data?.['createdAt']),
                updatedAt: data?.['updatedAt']?.toDate ? data['updatedAt'].toDate() : new Date(data?.['updatedAt']),
                contextSummary: data?.['contextSummary'] || null,
                lastSummaryUpdate: data?.['lastSummaryUpdate'] ? new Date(data['lastSummaryUpdate']) : null
            };
        }
        catch (error) {
            console.error('❌ Failed to get chat session from Firestore:', error);
            throw new Error(`Firestore session retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    static async getChatSessions(userId) {
        try {
            console.log('🔍 Getting chat sessions for user from Firestore:', userId);
            if (userId === 'anonymous') {
                console.log('ℹ️ Anonymous user - returning empty sessions array');
                return [];
            }
            const snapshot = await db.collection(COLLECTIONS.SESSIONS)
                .where('userId', '==', userId)
                .get();
            const sessions = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    timestamp: data?.['timestamp']?.toDate(),
                    createdAt: data?.['createdAt']?.toDate(),
                    updatedAt: data?.['updatedAt']?.toDate()
                };
            });
            sessions.sort((a, b) => {
                const aTime = a.updatedAt || a.createdAt || new Date(0);
                const bTime = b.updatedAt || b.createdAt || new Date(0);
                return bTime.getTime() - aTime.getTime();
            });
            console.log('✅ Chat sessions retrieved from Firestore:', sessions.length);
            return sessions;
        }
        catch (error) {
            console.error('❌ Failed to get chat sessions from Firestore:', error);
            if (userId === 'anonymous') {
                console.log('ℹ️ Anonymous user - returning empty sessions array due to error');
                return [];
            }
            throw new Error(`Firestore sessions retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    static async addMessageToSession(sessionId, message) {
        try {
            console.log('🔍 Adding message to chat session in Firestore:', sessionId);
            const messageData = {
                id: message.id,
                role: message.role,
                content: message.content,
                timestamp: admin.firestore.Timestamp.now(),
                ...(message.imageData && { imageData: message.imageData }),
                ...(message.model && { model: message.model })
            };
            await db.collection(COLLECTIONS.SESSIONS).doc(sessionId).update({
                messages: admin.firestore.FieldValue.arrayUnion(messageData),
                updatedAt: admin.firestore.Timestamp.now()
            });
            console.log('✅ Message added to chat session in Firestore');
        }
        catch (error) {
            console.error('❌ Failed to add message to chat session in Firestore:', error);
            throw new Error(`Firestore message addition failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    static async updateChatSession(sessionId, updates) {
        try {
            console.log('🔍 Updating chat session in Firestore:', sessionId);
            await db.collection(COLLECTIONS.SESSIONS).doc(sessionId).update({
                ...updates,
                updatedAt: admin.firestore.Timestamp.now()
            });
            console.log('✅ Chat session updated in Firestore');
        }
        catch (error) {
            console.error('❌ Failed to update chat session in Firestore:', error);
            throw new Error(`Firestore session update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    static async createDocument(collection, docId, data) {
        try {
            let docRef;
            if (docId) {
                docRef = await db.collection(collection).doc(docId).set({
                    ...data,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                });
                console.log(`✅ Document created in ${collection}/${docId}`);
                return { id: docId };
            }
            else {
                docRef = await db.collection(collection).add({
                    ...data,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                });
                console.log(`✅ Document created in ${collection}/${docRef.id}`);
                return docRef;
            }
        }
        catch (error) {
            console.error(`❌ Error creating document in ${collection}:`, error);
            throw error;
        }
    }
    static async getDocument(collection, docId) {
        try {
            const doc = await db.collection(collection).doc(docId).get();
            if (doc.exists) {
                return { id: doc.id, ...doc.data() };
            }
            return null;
        }
        catch (error) {
            console.error(`❌ Error getting document from ${collection}:`, error);
            throw error;
        }
    }
    static async updateDocument(collection, docId, data) {
        try {
            await db.collection(collection).doc(docId).update({
                ...data,
                updatedAt: Date.now(),
            });
            console.log(`✅ Document updated in ${collection}/${docId}`);
        }
        catch (error) {
            console.error(`❌ Error updating document in ${collection}:`, error);
            throw error;
        }
    }
    static async queryCollection(collection, field, operator, value) {
        try {
            const snapshot = await db.collection(collection).where(field, operator, value).get();
            const results = [];
            snapshot.forEach(doc => {
                results.push({ id: doc.id, ...doc.data() });
            });
            return results;
        }
        catch (error) {
            console.error(`❌ Error querying collection ${collection}:`, error);
            throw error;
        }
    }
    static async saveMarkingResultsAsMessages(userId, sessionId, imageData, model, result, instructions, classification, metadata) {
        try {
            console.log('🔍 Saving marking results as session messages...');
            const { ImageStorageService } = await import('./imageStorageService');
            const originalImageUrl = await ImageStorageService.uploadImage(imageData, userId, sessionId, 'original');
            const annotatedImageUrl = await ImageStorageService.uploadImage(result.annotatedImage || imageData, userId, sessionId, 'annotated');
            const originalMessage = {
                id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                role: 'user',
                content: 'Uploaded homework for marking',
                timestamp: new Date().toISOString(),
                type: 'marking_original',
                imageLink: originalImageUrl,
                markingData: {
                    originalImageUrl,
                    ocrResult: result,
                    classification,
                    metadata
                }
            };
            const contextSummary = this.generateMarkingContextSummary(instructions, result);
            const annotatedMessage = {
                id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                role: 'assistant',
                content: contextSummary,
                timestamp: new Date().toISOString(),
                type: 'marking_annotated',
                imageLink: annotatedImageUrl,
                markingData: {
                    originalImageUrl,
                    annotatedImageUrl,
                    ocrResult: result,
                    markingInstructions: instructions,
                    classification,
                    metadata
                }
            };
            await this.addMessageToSession(sessionId, originalMessage);
            await this.addMessageToSession(sessionId, annotatedMessage);
            console.log('✅ Marking results saved as session messages');
        }
        catch (error) {
            console.error('❌ Failed to save marking results as session messages:', error);
            throw error;
        }
    }
    static generateMarkingContextSummary(instructions, result) {
        const annotationCount = instructions.annotations?.length || 0;
        const confidence = result.confidence || 0;
        return `I've marked your homework! Found ${annotationCount} areas to review with ${Math.round(confidence * 100)}% confidence. The annotated image shows my feedback and suggestions.`;
    }
    static async deleteChatSession(sessionId, userId) {
        try {
            console.log('🔍 Deleting chat session with image cleanup...');
            const { ImageStorageService } = await import('./imageStorageService');
            await ImageStorageService.deleteSessionImages(userId, sessionId);
            await db.collection(COLLECTIONS.SESSIONS).doc(sessionId).delete();
            console.log('✅ Chat session deleted with image cleanup');
        }
        catch (error) {
            console.error('❌ Failed to delete chat session:', error);
            throw error;
        }
    }
    static async deleteUser(userId) {
        try {
            console.log('🔍 Deleting user with image cleanup...');
            const { ImageStorageService } = await import('./imageStorageService');
            await ImageStorageService.deleteUserImages(userId);
            await db.collection(COLLECTIONS.USERS).doc(userId).delete();
            console.log('✅ User deleted with image cleanup');
        }
        catch (error) {
            console.error('❌ Failed to delete user:', error);
            throw error;
        }
    }
}
