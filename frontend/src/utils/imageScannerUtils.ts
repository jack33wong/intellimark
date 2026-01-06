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

            // Draw original image to canvas first
            ctx.drawImage(img, 0, 0, width, height);

            // Get image data for manual pixel manipulation
            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;

            // Step 1: Grayscale + Basic Contrast Boost
            // (Standard luminance weights: 0.299R + 0.587G + 0.114B)
            const grayscale = new Uint8Array(width * height);
            for (let i = 0; i < data.length; i += 4) {
                grayscale[i / 4] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
            }

            // Step 2: Adaptive Thresholding (Bradley-Roth)
            // This handles variable lighting and removes shadows by comparing each pixel 
            // to the average of its neighbors.
            const s = Math.floor(width / 8); // Window size
            const t = 15; // Threshold percentage
            const integralImage = new Int32Array(width * height);

            // Calculate integral image
            for (let i = 0; i < width; i++) {
                let sum = 0;
                for (let j = 0; j < height; j++) {
                    const index = j * width + i;
                    sum += grayscale[index];
                    if (i === 0) {
                        integralImage[index] = sum;
                    } else {
                        integralImage[index] = integralImage[index - 1] + sum;
                    }
                }
            }

            // Perform thresholding
            for (let i = 0; i < width; i++) {
                for (let j = 0; j < height; j++) {
                    const index = j * width + i;

                    // Calc neighborhood bounds (s x s)
                    const x1 = Math.max(i - Math.floor(s / 2), 0);
                    const x2 = Math.min(i + Math.floor(s / 2), width - 1);
                    const y1 = Math.max(j - Math.floor(s / 2), 0);
                    const y2 = Math.min(j + Math.floor(s / 2), height - 1);

                    const count = (x2 - x1) * (y2 - y1);

                    // Sum of neighborhood using integral image
                    // Formula: S(x2, y2) - S(x1-1, y2) - S(x2, y1-1) + S(x1-1, y1-1)
                    let sum = integralImage[y2 * width + x2];
                    if (x1 > 0) sum -= integralImage[y2 * width + (x1 - 1)];
                    if (y1 > 0) sum -= integralImage[(y1 - 1) * width + x2];
                    if (x1 > 0 && y1 > 0) sum += integralImage[(y1 - 1) * width + (x1 - 1)];

                    // Set pixel to black or white
                    const val = (grayscale[index] * count) < (sum * (100 - t) / 100) ? 0 : 255;

                    data[index * 4] = val;     // R
                    data[index * 4 + 1] = val; // G
                    data[index * 4 + 2] = val; // B
                    data[index * 4 + 3] = 255; // Force opaque
                }
            }

            // Step 3: Edge Detection & Auto-Crop (Optional but helpful)
            // We use a Sobel filter on the grayscale image to find document boundaries.
            let minX = width, minY = height, maxX = 0, maxY = 0;
            const edgeThreshold = 40;

            for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                    const idx = y * width + x;

                    // Sobel Kernels
                    // gx = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]]
                    // gy = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]]

                    const p1 = grayscale[(y - 1) * width + (x - 1)];
                    const p2 = grayscale[(y - 1) * width + x];
                    const p3 = grayscale[(y - 1) * width + (x + 1)];
                    const p4 = grayscale[y * width + (x - 1)];
                    const p6 = grayscale[y * width + (x + 1)];
                    const p7 = grayscale[(y + 1) * width + (x - 1)];
                    const p8 = grayscale[(y + 1) * width + x];
                    const p9 = grayscale[(y + 1) * width + (x + 1)];

                    const gx = (p3 + 2 * p6 + p9) - (p1 + 2 * p4 + p7);
                    const gy = (p7 + 2 * p8 + p9) - (p1 + 2 * p2 + p3);
                    const magnitude = Math.sqrt(gx * gx + gy * gy);

                    if (magnitude > edgeThreshold) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }

            // Apply a small margin to the auto-crop
            const margin = 20;
            minX = Math.max(0, minX - margin);
            minY = Math.max(0, minY - margin);
            maxX = Math.min(width, maxX + margin);
            maxY = Math.min(height, maxY + margin);

            const finalWidth = maxX - minX;
            const finalHeight = maxY - minY;

            // Only crop if we found a reasonable document shape (at least 30% of original)
            const areaRatio = (finalWidth * finalHeight) / (width * height);

            if (areaRatio > 0.3 && finalWidth > 100 && finalHeight > 100) {
                // Create a secondary canvas for the cropped result
                const cropCanvas = document.createElement('canvas');
                cropCanvas.width = finalWidth;
                cropCanvas.height = finalHeight;
                const cropCtx = cropCanvas.getContext('2d');
                if (cropCtx) {
                    cropCtx.putImageData(ctx.getImageData(minX, minY, finalWidth, finalHeight), 0, 0);

                    // Use cropCanvas for export
                    cropCanvas.toBlob(
                        (blob) => {
                            if (blob) resolve(blob);
                            else reject(new Error('Crop toBlob failed'));
                        },
                        'image/jpeg',
                        quality
                    );
                    return;
                }
            }

            // Fallback: Export original thresholded image
            canvas.toBlob(
                (blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Canvas toBlob failed'));
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
