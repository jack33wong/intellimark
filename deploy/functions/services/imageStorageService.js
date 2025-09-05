import { getStorage } from 'firebase-admin/storage';
export class ImageStorageService {
    static async uploadImage(imageData, userId, sessionId, imageType) {
        try {
            console.log(`🔍 Uploading ${imageType} image for user ${userId}, session ${sessionId}`);
            const timestamp = Date.now();
            const random = Math.random().toString(36).substr(2, 9);
            const filename = `${imageType}-${timestamp}-${random}.jpg`;
            const storageRef = this.storage.bucket().file(`marking-images/${userId}/${sessionId}/${filename}`);
            const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            await storageRef.save(buffer, {
                metadata: {
                    contentType: 'image/jpeg',
                    metadata: {
                        userId,
                        sessionId,
                        imageType,
                        uploadedAt: new Date().toISOString()
                    }
                }
            });
            const downloadURL = await storageRef.getSignedUrl({
                action: 'read',
                expires: '03-01-2500'
            }).then(urls => urls[0]);
            console.log(`✅ ${imageType} image uploaded to Firebase Storage:`, downloadURL);
            return downloadURL;
        }
        catch (error) {
            console.error(`❌ Failed to upload ${imageType} image to Firebase Storage:`, error);
            throw new Error(`Image upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    static async deleteSessionImages(userId, sessionId) {
        try {
            console.log(`🔍 Deleting images for session ${sessionId}, user ${userId}`);
            const bucket = this.storage.bucket();
            const prefix = `marking-images/${userId}/${sessionId}/`;
            const [files] = await bucket.getFiles({ prefix });
            if (files.length === 0) {
                console.log('ℹ️ No images found for session:', sessionId);
                return;
            }
            const deletePromises = files.map(file => {
                console.log(`🗑️ Deleting image: ${file.name}`);
                return file.delete();
            });
            await Promise.all(deletePromises);
            console.log(`✅ Deleted ${files.length} images for session:`, sessionId);
        }
        catch (error) {
            console.error('❌ Failed to delete session images:', error);
        }
    }
    static async deleteUserImages(userId) {
        try {
            console.log(`🔍 Deleting all images for user ${userId}`);
            const bucket = this.storage.bucket();
            const prefix = `marking-images/${userId}/`;
            const [files] = await bucket.getFiles({ prefix });
            if (files.length === 0) {
                console.log('ℹ️ No images found for user:', userId);
                return;
            }
            const deletePromises = files.map(file => {
                console.log(`🗑️ Deleting image: ${file.name}`);
                return file.delete();
            });
            await Promise.all(deletePromises);
            console.log(`✅ Deleted ${files.length} images for user: ${userId}`);
        }
        catch (error) {
            console.error('❌ Failed to delete user images:', error);
        }
    }
    static async getImageUrl(imagePath) {
        try {
            const file = this.storage.bucket().file(imagePath);
            const [url] = await file.getSignedUrl({
                action: 'read',
                expires: '03-01-2500'
            });
            return url;
        }
        catch (error) {
            console.error('❌ Failed to get image URL:', error);
            throw new Error(`Failed to get image URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
ImageStorageService.storage = getStorage();
