import {
    getFirestore,
    collection,
    doc,
    setDoc,
    onSnapshot,
    deleteDoc,
    serverTimestamp,
    arrayUnion,
    type DocumentSnapshot
} from 'firebase/firestore';
import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL
} from 'firebase/storage';
import app from '../config/firebase';

const db = getFirestore(app!);
const storage = getStorage(app!);
const TEMP_UPLOADS_COLLECTION = 'temp_uploads';

export interface UploadSession {
    id: string;
    status: 'waiting' | 'uploading' | 'completed' | 'error';
    imageUrls?: string[]; // Multiple images for batch
    filename?: string;
    createdAt: any;
}

class MobileUploadService {
    /**
     * Generates a random session ID
     */
    generateSessionId(): string {
        return Math.random().toString(36).substring(2, 10) + Date.now().toString(36).substring(4);
    }

    /**
     * Creates a new temporary upload session
     */
    async createSession(sessionId: string): Promise<void> {
        const sessionRef = doc(db, TEMP_UPLOADS_COLLECTION, sessionId);
        await setDoc(sessionRef, {
            id: sessionId,
            status: 'waiting',
            createdAt: serverTimestamp()
        });
    }

    /**
     * Listen for updates to a specific session (Used by Desktop)
     */
    listenToSession(sessionId: string, callback: (data: UploadSession | null) => void): () => void {
        const sessionRef = doc(db, TEMP_UPLOADS_COLLECTION, sessionId);
        return onSnapshot(sessionRef, (snapshot: DocumentSnapshot) => {
            if (snapshot.exists()) {
                callback(snapshot.data() as UploadSession);
            } else {
                callback(null);
            }
        });
    }

    /**
     * Upload an image as part of a batch
     */
    async uploadBatchImage(sessionId: string, file: Blob): Promise<string> {
        try {
            const sessionRef = doc(db, TEMP_UPLOADS_COLLECTION, sessionId);
            // 1. Mark as uploading — use setDoc+merge so it re-creates the doc
            // if the desktop already deleted it (e.g. user scans again after success)
            await setDoc(sessionRef, { id: sessionId, status: 'uploading', createdAt: serverTimestamp() }, { merge: true });

            // 2. Upload to Storage
            const filename = `mobile_upload_${Date.now()}.png`;
            const storageRef = ref(storage, `temp_uploads/${sessionId}/${filename}`);
            await uploadBytes(storageRef, file);
            const downloadUrl = await getDownloadURL(storageRef);

            // 3. Atomically add to array and maintain 'uploading' status
            await setDoc(sessionRef, {
                status: 'uploading',
                imageUrls: arrayUnion(downloadUrl)
            }, { merge: true });

            return downloadUrl;
        } catch (error) {
            console.error('Mobile upload failed:', error);
            const sessionRef = doc(db, TEMP_UPLOADS_COLLECTION, sessionId);
            // Best-effort error status — ignore if doc is gone
            await setDoc(sessionRef, { status: 'error' }, { merge: true }).catch(() => { });
            throw error;
        }
    }

    /**
     * Legacy single upload (kept for compatibility)
     */
    async uploadImage(sessionId: string, file: Blob): Promise<string> {
        const url = await this.uploadBatchImage(sessionId, file);
        await this.finalizeSession(sessionId);
        return url;
    }

    /**
     * Mark the session as completed (Used by Mobile after all pages are sent)
     */
    async finalizeSession(sessionId: string): Promise<void> {
        const sessionRef = doc(db, TEMP_UPLOADS_COLLECTION, sessionId);
        await setDoc(sessionRef, { status: 'completed' }, { merge: true });
    }

    /**
     * Resets the session status to waiting and clears images.
     * Used by Desktop to allow QR re-use for the next batch.
     */
    async resetSession(sessionId: string): Promise<void> {
        try {
            const sessionRef = doc(db, TEMP_UPLOADS_COLLECTION, sessionId);
            await setDoc(sessionRef, {
                status: 'waiting',
                imageUrls: []
            }, { merge: true });
        } catch (error) {
            console.warn('Failed to reset session:', error);
        }
    }

    /**
     * Clean up the session (Used by Desktop after successful receipt)
     */
    async cleanupSession(sessionId: string): Promise<void> {
        try {
            const sessionRef = doc(db, TEMP_UPLOADS_COLLECTION, sessionId);
            await deleteDoc(sessionRef);
        } catch (error) {
            console.warn('Failed to cleanup session:', error);
        }
    }
}

export const mobileUploadService = new MobileUploadService();
