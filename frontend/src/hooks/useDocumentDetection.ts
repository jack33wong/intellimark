import { useState, useEffect, useRef } from 'react';

export interface NormalizedPoint { x: number; y: number; }

declare global { interface Window { cv: any; } }
const isCvLoaded = () => window.cv && window.cv.Mat;

export const useDocumentDetection = (videoRef: React.RefObject<HTMLVideoElement>, isActive: boolean) => {
    const [detectedCorners, setDetectedCorners] = useState<NormalizedPoint[] | null>(null);
    const [isSteady, setIsSteady] = useState(false);

    const loopRef = useRef<number>();
    const processingRef = useRef(false);
    const historyRef = useRef<NormalizedPoint[][]>([]);

    // Config: How many frames to smooth over (stabilizes the jitter)
    const HISTORY_LENGTH = 5;

    useEffect(() => {
        if (!isActive || !videoRef.current || !isCvLoaded()) {
            if (loopRef.current) cancelAnimationFrame(loopRef.current);
            setDetectedCorners(null);
            setIsSteady(false);
            historyRef.current = [];
            return;
        }

        const video = videoRef.current;
        const cv = window.cv;

        // Pre-allocate OpenCV objects (Reuse memory to prevent crashes)
        let src: any, gray: any, blurred: any, edges: any, kernel: any;
        let contours: any, hierarchy: any, poly: any;

        const cleanup = () => {
            if (src && !src.isDeleted()) src.delete();
            if (gray && !gray.isDeleted()) gray.delete();
            if (blurred && !blurred.isDeleted()) blurred.delete();
            if (edges && !edges.isDeleted()) edges.delete();
            if (kernel && !kernel.isDeleted()) kernel.delete();
            if (contours && !contours.isDeleted()) contours.delete();
            if (hierarchy && !hierarchy.isDeleted()) hierarchy.delete();
            if (poly && !poly.isDeleted()) poly.delete();
            processingRef.current = false;
        };

        const processFrame = async () => {
            if (video.videoWidth === 0 || processingRef.current) {
                loopRef.current = requestAnimationFrame(processFrame);
                return;
            }
            processingRef.current = true;

            try {
                // 1. Work on a small scale (350px) for speed & noise reduction
                const scale = 350 / video.videoWidth;
                const w = 350;
                const h = Math.floor(video.videoHeight * scale);

                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (!ctx) throw new Error("No CTX");
                ctx.drawImage(video, 0, 0, w, h);
                const imgData = ctx.getImageData(0, 0, w, h);

                // 2. OpenCV Pipeline
                src = cv.matFromImageData(imgData);
                gray = new cv.Mat();
                blurred = new cv.Mat();
                edges = new cv.Mat();
                kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)); // 3x3 Dilation Kernel

                // Step A: Grayscale
                cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

                // Step B: Heavy Blur (Removes wood grain texture)
                cv.GaussianBlur(gray, blurred, new cv.Size(7, 7), 0);

                // Step C: Canny Edge Detection
                // Lower threshold (30) catches faint edges, High (100) defines strong lines
                cv.Canny(blurred, edges, 30, 100);

                // Step D: Dilation (CRITICAL FIX)
                // This closes small gaps in the edge lines caused by shadows
                cv.dilate(edges, edges, kernel);

                // Step E: Find Contours
                contours = new cv.MatVector();
                hierarchy = new cv.Mat();
                cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

                // Step F: Find Best Quadrilateral
                let maxArea = 0;
                let bestCorners: NormalizedPoint[] | null = null;
                poly = new cv.Mat();

                for (let i = 0; i < contours.size(); ++i) {
                    const cnt = contours.get(i);
                    const area = cv.contourArea(cnt);

                    // Filter small noise (< 10% of screen)
                    if (area < (w * h * 0.10)) continue;

                    const peri = cv.arcLength(cnt, true);
                    // Epsilon 0.04 = Allows slightly curved lines (common in paper)
                    cv.approxPolyDP(cnt, poly, 0.04 * peri, true);

                    // Must have 4 corners and be convex
                    if (poly.rows === 4 && cv.isContourConvex(poly) && area > maxArea) {
                        maxArea = area;

                        // Extract points
                        const rawPoints: { x: number, y: number }[] = [];
                        for (let j = 0; j < 4; j++) {
                            rawPoints.push({
                                x: poly.data32S[j * 2],
                                y: poly.data32S[j * 2 + 1]
                            });
                        }

                        // Robust Sort (Fixes the "Twisted/Bowtie" bug)
                        const sorted = sortPointsClockwise(rawPoints);

                        // Normalize (0.0 - 1.0)
                        bestCorners = sorted.map(p => ({ x: p.x / w, y: p.y / h }));
                    }
                }

                // 3. Update State with Smoothing
                if (bestCorners) {
                    historyRef.current.push(bestCorners);
                    if (historyRef.current.length > HISTORY_LENGTH) historyRef.current.shift();

                    const avgCorners = calculateAverage(historyRef.current);
                    setDetectedCorners(avgCorners);
                    setIsSteady(calculateSteadiness(bestCorners, avgCorners) < 0.015);
                } else {
                    // "Sticky" failure: Don't disappear instantly, fade out over 10 frames
                    if (historyRef.current.length > 0) {
                        historyRef.current.shift();
                        if (historyRef.current.length > 0) {
                            setDetectedCorners(calculateAverage(historyRef.current));
                        } else {
                            setDetectedCorners(null);
                            setIsSteady(false);
                        }
                    } else {
                        setDetectedCorners(null);
                        setIsSteady(false);
                    }
                }

            } catch (e) {
                console.warn("CV Error:", e);
            } finally {
                cleanup();
                loopRef.current = requestAnimationFrame(processFrame);
            }
        };

        const checkCv = setInterval(() => {
            if (isCvLoaded()) {
                clearInterval(checkCv);
                processFrame();
            }
        }, 500);

        return () => {
            clearInterval(checkCv);
            if (loopRef.current) cancelAnimationFrame(loopRef.current);
            cleanup();
        };
    }, [isActive, videoRef]);

    return { detectedCorners, isSteady, isCvReady: isCvLoaded() };
};

// --- HELPER ALGORITHMS ---

/**
 * Robust Spatial Sort: Sorts points clockwise around their center.
 * This guarantees we never get a "twisted" hourglass shape.
 */
function sortPointsClockwise(pts: { x: number, y: number }[]) {
    // 1. Find Center (Centroid)
    const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
    const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;

    // 2. Sort by angle relative to center
    // Math.atan2 returns -PI to +PI. 
    // We sort ascending to get clockwise order (starting from -PI usually)
    pts.sort((a, b) => {
        return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx);
    });

    // 3. Shift so Top-Left is first.
    // TL is the point with the smallest (x + y) usually, or closest to 0,0
    let tlIdx = 0;
    let minSum = Infinity;

    for (let i = 0; i < 4; i++) {
        const sum = pts[i].x + pts[i].y;
        if (sum < minSum) {
            minSum = sum;
            tlIdx = i;
        }
    }

    // Rotate array until TL is at index 0
    const sorted = [...pts.slice(tlIdx), ...pts.slice(0, tlIdx)];
    return sorted;
}

function calculateAverage(history: NormalizedPoint[][]): NormalizedPoint[] {
    if (history.length === 0) return [];
    const sums = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
    history.forEach(frame => {
        frame.forEach((p, i) => { sums[i].x += p.x; sums[i].y += p.y; });
    });
    return sums.map(s => ({ x: s.x / history.length, y: s.y / history.length }));
}

function calculateSteadiness(curr: NormalizedPoint[], avg: NormalizedPoint[]): number {
    let maxDev = 0;
    for (let i = 0; i < 4; i++) {
        const dx = Math.abs(curr[i].x - avg[i].x);
        const dy = Math.abs(curr[i].y - avg[i].y);
        maxDev = Math.max(maxDev, dx + dy);
    }
    return maxDev;
}
