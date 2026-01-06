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
    onStatusUpdate?: (status: string) => void;
}

export const processScannerImage = async (
    file: File | Blob,
    options: ScanOptions = {}
): Promise<Blob> => {
    // Pro-grade settings for the "Super Scanner"
    const {
        maxWidth = 2800,
        maxHeight = 2800,
        quality = 0.9,
        onStatusUpdate
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
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });

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
            onStatusUpdate?.('Analyzing lighting...');
            const grayscale = new Uint8Array(width * height);
            for (let i = 0; i < data.length; i += 4) {
                // Standard luminance weights
                grayscale[i / 4] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
            }

            // Step 1.1: Box Blur (3x3) to reduce high-frequency noise/texture
            // This prevents "paper grain" from being detected as separate components
            const blurred = new Uint8Array(width * height);
            for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                    let sum = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            sum += grayscale[(y + dy) * width + (x + dx)];
                        }
                    }
                    blurred[y * width + x] = sum / 9;
                }
            }
            // Copy back to grayscale for next steps
            for (let i = 0; i < width * height; i++) grayscale[i] = blurred[i];

            // Contrast Normalization (Histogram Stretching)
            // This maximizes separation between dark background and light paper
            let minVal = 255, maxVal = 0;
            for (let i = 0; i < grayscale.length; i++) {
                if (grayscale[i] < minVal) minVal = grayscale[i];
                if (grayscale[i] > maxVal) maxVal = grayscale[i];
            }
            if (maxVal > minVal) {
                const scale = 255 / (maxVal - minVal);
                for (let i = 0; i < grayscale.length; i++) {
                    grayscale[i] = (grayscale[i] - minVal) * scale;
                }
            }


            // Step 2: Adaptive Thresholding (Bradley-Roth) - Tuned for maximum shadow kill
            onStatusUpdate?.('Removing shadows...');
            const s = Math.floor(width / 8); // Smaller window (1/8) handles gradients better
            const t = 16; // Tuned to 16 per user request. Slight reduction to improve text clarity.
            const integralImage = new Float64Array(width * height);

            // Calculate integral image (2D prefix sum)
            for (let i = 0; i < width; i++) {
                let colSum = 0;
                for (let j = 0; j < height; j++) {
                    const idx = j * width + i;
                    colSum += grayscale[idx];
                    if (i === 0) {
                        integralImage[idx] = colSum;
                    } else {
                        integralImage[idx] = integralImage[idx - 1] + colSum;
                    }
                }
            }

            // Perform thresholding and store B&W in data
            for (let i = 0; i < width; i++) {
                for (let j = 0; j < height; j++) {
                    const index = j * width + i;
                    const x1 = Math.max(i - Math.floor(s / 2), 0);
                    const x2 = Math.min(i + Math.floor(s / 2), width - 1);
                    const y1 = Math.max(j - Math.floor(s / 2), 0);
                    const y2 = Math.min(j + Math.floor(s / 2), height - 1);
                    const count = (x2 - x1) * (y2 - y1);

                    let sum = integralImage[y2 * width + x2];
                    if (x1 > 0) sum -= integralImage[y2 * width + (x1 - 1)];
                    if (y1 > 0) sum -= integralImage[(y1 - 1) * width + x2];
                    if (x1 > 0 && y1 > 0) sum += integralImage[(y1 - 1) * width + (x1 - 1)];

                    const val = (grayscale[index] * count) < (sum * (100 - t) / 100) ? 0 : 255;

                    data[index * 4] = val;
                    data[index * 4 + 1] = val;
                    data[index * 4 + 2] = val;
                    data[index * 4 + 3] = 255;
                }
            }

            // Step 3: Pro Rectification (RANSAC + Erosion)
            onStatusUpdate?.('Detecting edges...');

            // 3.1: Create Binary Mask & Erode to remove noise
            const mask = new Uint8Array(width * height);
            // First pass: fill mask from thresholded data
            for (let i = 0; i < width * height; i++) {
                mask[i] = data[i * 4] === 255 ? 1 : 0;
            }

            // Morphological Erosion (3x3) to detach paper from edge noise
            const erodedMask = new Uint8Array(width * height);
            const kernelSize = 1; // Radius 1 = 3x3 kernel
            for (let y = kernelSize; y < height - kernelSize; y++) {
                for (let x = kernelSize; x < width - kernelSize; x++) {
                    let minVal = 1;
                    // If any neighbor is 0 (black), the pixel becomes 0
                    for (let ky = -kernelSize; ky <= kernelSize; ky++) {
                        for (let kx = -kernelSize; kx <= kernelSize; kx++) {
                            if (mask[(y + ky) * width + (x + kx)] === 0) {
                                minVal = 0;
                                break;
                            }
                        }
                        if (minVal === 0) break;
                    }
                    erodedMask[y * width + x] = minVal;
                }
            }

            // 3.1.5: Noise Isolation - Largest Connected Component (LCC)
            // Filter out independent noise blobs (like desk edges) that aren't the main paper.
            // Using Iterative BFS with a pre-allocated queue for performance.

            onStatusUpdate?.('Isolating document...');

            const labels = new Int32Array(width * height); // 0 = unvisited/background, >0 = label
            let currentLabel = 1;
            const labelAreas: Record<number, number> = {};
            const queue = new Int32Array(width * height); // Pre-allocated queue to avoid GC

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = y * width + x;
                    if (erodedMask[idx] === 1 && labels[idx] === 0) {
                        // Start new component
                        const myLabel = currentLabel++;
                        labels[idx] = myLabel;
                        labelAreas[myLabel] = 1;

                        let qHead = 0;
                        let qTail = 0;
                        queue[qTail++] = idx;

                        while (qHead < qTail) {
                            const currIdx = queue[qHead++];
                            const cx = currIdx % width;
                            const cy = Math.floor(currIdx / width);

                            // Check 4-neighbors
                            const neighbors = [
                                { nx: cx - 1, ny: cy, nIdx: currIdx - 1 },
                                { nx: cx + 1, ny: cy, nIdx: currIdx + 1 },
                                { nx: cx, ny: cy - 1, nIdx: currIdx - width },
                                { nx: cx, ny: cy + 1, nIdx: currIdx + width }
                            ];

                            for (const { nx, ny, nIdx } of neighbors) {
                                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                    if (erodedMask[nIdx] === 1 && labels[nIdx] === 0) {
                                        labels[nIdx] = myLabel;
                                        labelAreas[myLabel]++;
                                        queue[qTail++] = nIdx;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Find largest component
            let maxLabel = -1;
            let maxArea = -1;
            for (const [lbl, area] of Object.entries(labelAreas)) {
                if (area > maxArea) {
                    maxArea = area;
                    maxLabel = parseInt(lbl);
                }
            }

            // Filter mask: Keep ONLY the largest component
            if (maxLabel !== -1) {
                for (let i = 0; i < width * height; i++) {
                    if (labels[i] !== maxLabel) {
                        erodedMask[i] = 0;
                    }
                }
            }

            // 3.1.6: Morphological Dilation (3x3) - "Grow" the mask back
            // The thresholding might have shrunk the paper due to shadows.
            // We dilate to push the edges back out to the real paper boundary.
            const dilatedMask = new Uint8Array(width * height);
            // Pass 1
            for (let y = kernelSize; y < height - kernelSize; y++) {
                for (let x = kernelSize; x < width - kernelSize; x++) {
                    let maxVal = 0;
                    for (let ky = -kernelSize; ky <= kernelSize; ky++) {
                        for (let kx = -kernelSize; kx <= kernelSize; kx++) {
                            if (erodedMask[(y + ky) * width + (x + kx)] === 1) {
                                maxVal = 1; break;
                            }
                        }
                        if (maxVal === 1) break;
                    }
                    dilatedMask[y * width + x] = maxVal;
                }
            }
            // Pass 2 (Double Dilation) - Ensure we cover the real edge
            const dilatedMask2 = new Uint8Array(width * height);
            for (let y = kernelSize; y < height - kernelSize; y++) {
                for (let x = kernelSize; x < width - kernelSize; x++) {
                    let maxVal = 0;
                    for (let ky = -kernelSize; ky <= kernelSize; ky++) {
                        for (let kx = -kernelSize; kx <= kernelSize; kx++) {
                            if (dilatedMask[(y + ky) * width + (x + kx)] === 1) {
                                maxVal = 1; break;
                            }
                        }
                        if (maxVal === 1) break;
                    }
                    dilatedMask2[y * width + x] = maxVal;
                }
            }

            // 3.2: Extract Edge Points from DILATED Mask
            const edgePoints: { x: number, y: number }[] = [];
            let cx = 0, cy = 0;
            let pointCount = 0;

            for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                    const idx = y * width + x;
                    if (dilatedMask2[idx] === 1) {
                        // Check if it's an edge (has a 0 neighbor)
                        let isEdge = false;
                        if (dilatedMask2[idx - 1] === 0 || dilatedMask2[idx + 1] === 0 ||
                            dilatedMask2[idx - width] === 0 || dilatedMask2[idx + width] === 0) {
                            isEdge = true;
                        }

                        if (isEdge) {
                            // Downsample edges for performance
                            if (Math.random() < 0.2) {
                                edgePoints.push({ x, y });
                            }
                        }

                        // Accumulate for centroid (use all points for stability)
                        // Optimization: sample for centroid too
                        if (x % 4 === 0 && y % 4 === 0) {
                            cx += x;
                            cy += y;
                            pointCount++;
                        }
                    }
                }
            }

            if (pointCount === 0 || edgePoints.length < 20) {
                // Fallback: Return original
                ctx.putImageData(imageData, 0, 0);
                canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', quality);
                return;
            }

            cx /= pointCount;
            cy /= pointCount;

            // 3.3 New Corner Finding Strategy: Quadrant Extremes (Robust for Trapezoids)
            // Instead of line intersection (which fails on angles), we find the specific pixel
            // in each quadrant that is "furthest" in the diagonal direction.
            // This is the absolute most robust way to find corners of an arbitrary convex blob.

            let tl = { x: 0, y: 0 }, tr = { x: width, y: 0 };
            let br = { x: width, y: height }, bl = { x: 0, y: height };
            let maxTL = -Infinity, maxTR = -Infinity, maxBR = -Infinity, maxBL = -Infinity;

            for (const p of edgePoints) {
                // Score = dot product with diagonal vector
                // TL: minimize x+y (or maximize -x-y)
                const scoreTL = -p.x - p.y;
                // TR: maximize x-y
                const scoreTR = p.x - p.y;
                // BR: maximize x+y
                const scoreBR = p.x + p.y;
                // BL: maximize -x+y
                const scoreBL = -p.x + p.y;

                if (scoreTL > maxTL) { maxTL = scoreTL; tl = p; }
                if (scoreTR > maxTR) { maxTR = scoreTR; tr = p; }
                if (scoreBR > maxBR) { maxBR = scoreBR; br = p; }
                if (scoreBL > maxBL) { maxBL = scoreBL; bl = p; }
            }

            // Safety check: if mask is weird, fallback to bbox
            const dist = (p1: any, p2: any) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
            if (dist(tl, tr) < width * 0.2) {
                tl = { x: 0, y: 0 }; tr = { x: width, y: 0 };
                br = { x: width, y: height }; bl = { x: 0, y: height };
            }

            // Pro-Warp Correction: Push corners slightly outwards (17%)
            // User requested 17% for unified tuning.
            const margin = 0.17;

            // 3.4: Pro-Warp Correction: Push corners slightly outwards (17%)
            // Fix: Use Bounding Box Center instead of Polygon Centroid.
            // Polygon centroid is biased towards the "wider" side (bottom) in perspective shots,
            // causing uneven margins (top gets expanded more than bottom).
            const minX = Math.min(tl.x, tr.x, br.x, bl.x);
            const maxX = Math.max(tl.x, tr.x, br.x, bl.x);
            const minY = Math.min(tl.y, tr.y, br.y, bl.y);
            const maxY = Math.max(tl.y, tr.y, br.y, bl.y);

            const center = {
                x: (minX + maxX) / 2,
                y: (minY + maxY) / 2
            };
            const expand = (p: { x: number, y: number }) => ({
                x: Math.max(0, Math.min(width - 1, p.x + (p.x - center.x) * margin)),
                y: Math.max(0, Math.min(height - 1, p.y + (p.y - center.y) * margin))
            });
            tl = expand(tl); tr = expand(tr); br = expand(br); bl = expand(bl);

            // Perspective Warp (Reuse logic)
            onStatusUpdate?.('Warping document...');
            const warp = (
                srcP: { x: number, y: number }[],
                dstP: { x: number, y: number }[],
                sW: number, sH: number, dW: number, dH: number
            ) => {
                const dCanvas = document.createElement('canvas');
                dCanvas.width = dW; dCanvas.height = dH;
                const dCtx = dCanvas.getContext('2d');
                if (!dCtx) return null;

                const getH = (s: typeof srcP, d: typeof dstP) => {
                    const a = [];
                    for (let i = 0; i < 4; i++) {
                        a.push([s[i].x, s[i].y, 1, 0, 0, 0, -s[i].x * d[i].x, -s[i].y * d[i].x]);
                        a.push([0, 0, 0, s[i].x, s[i].y, 1, -s[i].x * d[i].y, -s[i].y * d[i].y]);
                    }
                    const bA = [d[0].x, d[0].y, d[1].x, d[1].y, d[2].x, d[2].y, d[3].x, d[3].y];
                    const n = 8;
                    for (let i = 0; i < n; i++) {
                        let max = i;
                        for (let j = i + 1; j < n; j++) if (Math.abs(a[j][i]) > Math.abs(a[max][i])) max = j;
                        [a[i], a[max]] = [a[max], a[i]];
                        [bA[i], bA[max]] = [bA[max], bA[i]];
                        for (let j = i + 1; j < n; j++) {
                            const c = a[j][i] / a[i][i];
                            for (let k = i; k < n; k++) a[j][k] -= c * a[i][k];
                            bA[j] -= c * bA[i];
                        }
                    }
                    const x = new Array(n);
                    for (let i = n - 1; i >= 0; i--) {
                        let sv = 0;
                        for (let j = i + 1; j < n; j++) sv += a[i][j] * x[j];
                        x[i] = (bA[i] - sv) / a[i][i];
                    }
                    return [...x, 1];
                };

                const h = getH(dstP, srcP);
                const dImgData = dCtx.createImageData(dW, dH);
                const dD = dImgData.data;

                for (let y = 0; y < dH; y++) {
                    for (let x = 0; x < dW; x++) {
                        const w = h[6] * x + h[7] * y + h[8];
                        const sx = Math.floor((h[0] * x + h[1] * y + h[2]) / w);
                        const sy = Math.floor((h[3] * x + h[4] * y + h[5]) / w);
                        if (sx >= 0 && sx < sW && sy >= 0 && sy < sH) {
                            const si = (sy * sW + sx) * 4; const di = (y * dW + x) * 4;
                            dD[di] = data[si]; dD[di + 1] = data[si + 1]; dD[di + 2] = data[si + 2]; dD[di + 3] = 255;
                        } else {
                            // Out of bounds: Fill with WHITE (paper color) instead of transparent black
                            const di = (y * dW + x) * 4;
                            dD[di] = 255; dD[di + 1] = 255; dD[di + 2] = 255; dD[di + 3] = 255;
                        }
                    }
                }
                dCtx.putImageData(dImgData, 0, 0);
                return dCanvas;
            };


            const fW = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
            const fH = Math.round(Math.max(dist(tl, bl), dist(tr, br)));

            // 3.5: Border Cleanup
            // Remove "desk artifacts" that appear as black bars on the edges due to wide cropping.
            // Heuristic: Scan from edges. If > 50% of the row/col is black, clear it.
            const cleanBorders = (canvas: HTMLCanvasElement) => {
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                const w = canvas.width;
                const h = canvas.height;
                const imgData = ctx.getImageData(0, 0, w, h);
                const d = imgData.data;

                const isBlack = (pixelIdx: number) => d[pixelIdx] === 0; // Assuming threshold output is 0 or 255

                // Clean Top (Aggressive)
                for (let y = 0; y < h * 0.1; y++) { // Limit to 10% margin
                    let blackCount = 0;
                    for (let x = 0; x < w; x++) {
                        if (isBlack((y * w + x) * 4)) blackCount++;
                    }
                    if (blackCount > w * 0.15) { // Aggressive: > 15% black is enough to trigger clean
                        for (let x = 0; x < w; x++) {
                            const i = (y * w + x) * 4;
                            d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
                        }
                    } else break; // Stop at first "clean" row
                }

                // Clean Bottom (Conservative - Protect Footer Barcode)
                for (let y = h - 1; y > h * 0.95; y--) {
                    let blackCount = 0;
                    for (let x = 0; x < w; x++) {
                        if (isBlack((y * w + x) * 4)) blackCount++;
                    }
                    if (blackCount > w * 0.85) { // Conservative: Must be > 85% black (solid desk)
                        for (let x = 0; x < w; x++) {
                            const i = (y * w + x) * 4;
                            d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
                        }
                    } else break;
                }

                // Clean Left (Aggressive)
                for (let x = 0; x < w * 0.1; x++) {
                    let blackCount = 0;
                    for (let y = 0; y < h; y++) {
                        if (isBlack((y * w + x) * 4)) blackCount++;
                    }
                    if (blackCount > h * 0.15) { // Aggressive
                        for (let y = 0; y < h; y++) {
                            const i = (y * w + x) * 4;
                            d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
                        }
                    } else break;
                }

                // Clean Right (Aggressive)
                for (let x = w - 1; x > w * 0.9; x--) {
                    let blackCount = 0;
                    for (let y = 0; y < h; y++) {
                        if (isBlack((y * w + x) * 4)) blackCount++;
                    }
                    if (blackCount > h * 0.15) { // Aggressive
                        for (let y = 0; y < h; y++) {
                            const i = (y * w + x) * 4;
                            d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
                        }
                    } else break;
                }

                ctx.putImageData(imgData, 0, 0);
            };

            const warpedCanvas = warp(
                [tl, tr, br, bl],
                [{ x: 0, y: 0 }, { x: fW, y: 0 }, { x: fW, y: fH }, { x: 0, y: fH }],
                width, height, fW, fH
            );

            if (warpedCanvas) {
                // Post-process the warped result
                cleanBorders(warpedCanvas);
                warpedCanvas.toBlob((blob) => resolve(blob!), 'image/jpeg', quality);
            } else {
                ctx.putImageData(imageData, 0, 0);
                canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', quality);
            }
        };

        img.onerror = (err) => {
            URL.revokeObjectURL(url);
            reject(err);
        };

        img.src = url;
    });
};
