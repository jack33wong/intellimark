/**
 * Utility for client-side image scanning and enhancement.
 * This helper uses the Canvas API to:
 * 1. Fix orientation (by drawing to a canvas, we flatten EXIF)
 * 2. Apply document-style filters (Contrast, Brightness)
 * 3. Resize if necessary to save bandwidth
 */

export interface ScanOptions {
    contrast?: number;      // -100 to 100
    brightness?: number;    // -100 to 100
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;       // 0 to 1
}

export const processScannerImage = async (
    file: File | Blob,
    options: ScanOptions = {}
): Promise<Blob> => {
    const {
        contrast = 30,
        brightness = 5,
        maxWidth = 2000,
        maxHeight = 2000,
        quality = 0.85
    } = options;

    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);

            // Calculate new dimensions
            let width = img.width;
            let height = img.height;

            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = width * ratio;
                height = height * ratio;
            }

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                reject(new Error('Could not get canvas context'));
                return;
            }

            canvas.width = width;
            canvas.height = height;

            // Apply filters
            // Note: Canvas filters are applied relative to the baseline.
            // Contrast: 100% is normal.
            const contrastFactor = 1 + (contrast / 100);
            const brightnessFactor = 1 + (brightness / 100);

            ctx.filter = `contrast(${contrastFactor * 100}%) brightness(${brightnessFactor * 100}%) grayscale(10%)`;

            // Draw image to canvas
            // Browser automatically handles EXIF orientation for Image objects in modern browsers
            ctx.drawImage(img, 0, 0, width, height);

            // Export to Blob
            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Canvas toBlob failed'));
                    }
                },
                'image/jpeg',
                quality
            );
        };

        img.onerror = (err) => {
            URL.revokeObjectURL(url);
            reject(err);
        };

        img.src = url;
    });
};
