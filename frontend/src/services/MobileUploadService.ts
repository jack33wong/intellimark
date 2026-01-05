import {
    getFirestore,
    collection,
    doc,
    setDoc,
    onSnapshot,
    deleteDoc,
    serverTimestamp,
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
    imageUrl?: string;
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
     * Upload an image from the mobile device
     */
    async uploadImage(sessionId: string, file: Blob): Promise<string> {
        try {
            // 1. Update status to uploading
            const sessionRef = doc(db, TEMP_UPLOADS_COLLECTION, sessionId);
            await setDoc(sessionRef, { status: 'uploading' }, { merge: true });

            // 2. Upload to Storage
            const filename = `mobile_upload_${Date.now()}.jpg`;
            const storageRef = ref(storage, `temp_uploads/${sessionId}/${filename}`);
            await uploadBytes(storageRef, file);
            const downloadUrl = await getDownloadURL(storageRef);

            // 3. Update Firestore with URL and completed status
            await setDoc(sessionRef, {
                status: 'completed',
                imageUrl: downloadUrl,
                filename: filename
            }, { merge: true });

            return downloadUrl;
        } catch (error) {
            console.error('Mobile upload failed:', error);
            const sessionRef = doc(db, TEMP_UPLOADS_COLLECTION, sessionId);
            await setDoc(sessionRef, { status: 'error' }, { merge: true });
            throw error;
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
