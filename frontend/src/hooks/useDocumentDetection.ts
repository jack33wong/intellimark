import { useState, useEffect, useRef } from 'react';

export interface NormalizedPoint { x: number; y: number; }

declare global { interface Window { cv: any; } }

// GLOBAL PERSISTENCE
let GLOBAL_LAST_CORNERS: NormalizedPoint[] | null = null;

export const useDocumentDetection = (videoRef: React.RefObject<HTMLVideoElement>, isActive: boolean) => {
    // Initialize with global memory instantly
    const [detectedCorners, setDetectedCorners] = useState<NormalizedPoint[] | null>(GLOBAL_LAST_CORNERS);

    // Anchor Ref tracks the active box
    const anchorCornersRef = useRef<NormalizedPoint[] | null>(GLOBAL_LAST_CORNERS);

    const loopRef = useRef<number>();
    const processingRef = useRef(false);
    const stoppedRef = useRef(false);

    const sortCorners = (pts: { x: number, y: number }[]) => {
        const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
        const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
        const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
        let tlIdx = 0, minSum = Infinity;
        for (let i = 0; i < 4; i++) {
            if ((sorted[i].x + sorted[i].y) < minSum) { minSum = sorted[i].x + sorted[i].y; tlIdx = i; }
        }
        return [...sorted.slice(tlIdx), ...sorted.slice(0, tlIdx)];
    };

    useEffect(() => {
        stoppedRef.current = false;

        const startLoop = () => {
            if (!window.cv || !window.cv.Mat) return;

            const cv = window.cv;
            const src = new cv.Mat();
            const gray = new cv.Mat();
            const blur = new cv.Mat();
            const edges = new cv.Mat();
            const contours = new cv.MatVector();
            const poly = new cv.Mat();

            const processFrame = () => {
                if (stoppedRef.current) return;
                const video = videoRef.current;
                if (!video || processingRef.current) {
                    loopRef.current = requestAnimationFrame(processFrame);
                    return;
                }
                processingRef.current = true;

                try {
                    const w = 350;
                    const vW = video.videoWidth || 1;
                    const vH = video.videoHeight || 1;
                    const scale = w / vW;
                    const h = Math.floor(vH * scale);

                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });

                    if (ctx) {
                        ctx.drawImage(video, 0, 0, w, h);
                        const imgData = ctx.getImageData(0, 0, w, h);

                        if (stoppedRef.current) { processingRef.current = false; return; }

                        if (src.cols !== w || src.rows !== h) src.create(h, w, cv.CV_8UC4);
                        src.data.set(imgData.data);

                        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
                        cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
                        cv.Canny(blur, edges, 30, 100);

                        cv.findContours(edges, contours, new cv.Mat(), cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

                        let maxArea = 0;
                        let rawCandidate: { x: number, y: number }[] | null = null;
                        const minArea = (w * h) * 0.10;

                        for (let i = 0; i < contours.size(); ++i) {
                            const cnt = contours.get(i);
                            try {
                                const area = cv.contourArea(cnt);
                                if (area < minArea) continue;
                                const peri = cv.arcLength(cnt, true);
                                cv.approxPolyDP(cnt, poly, 0.02 * peri, true);
                                if (poly.rows === 4) {
                                    const rawPts = [];
                                    for (let j = 0; j < 4; j++) rawPts.push({ x: poly.data32S[j * 2], y: poly.data32S[j * 2 + 1] });
                                    const pts = sortCorners(rawPts);

                                    const topDx = Math.abs(pts[0].x - pts[1].x);
                                    const height = Math.abs(pts[0].y - pts[3].y);
                                    if (height > (topDx * 0.4) && area > maxArea) {
                                        maxArea = area;
                                        rawCandidate = pts;
                                    }
                                }
                            } finally { cnt.delete(); }
                        }

                        // --- V60: INFINITE MEMORY LOGIC ---
                        if (rawCandidate) {
                            const newNorm = rawCandidate.map(p => ({ x: p.x / w, y: p.y / h }));

                            // Calculate Steepness for dynamic smoothing
                            const wTop = Math.abs(newNorm[0].x - newNorm[1].x);
                            const wBot = Math.abs(newNorm[3].x - newNorm[2].x);
                            const steepness = Math.abs(wTop - wBot);
                            const smoothFactor = steepness > 0.15 ? 0.90 : 0.6; // 90% smooth for angles

                            if (anchorCornersRef.current) {
                                // Smooth update
                                const smoothed = newNorm.map((p, i) => ({
                                    x: anchorCornersRef.current![i].x * smoothFactor + p.x * (1 - smoothFactor),
                                    y: anchorCornersRef.current![i].y * smoothFactor + p.y * (1 - smoothFactor)
                                }));

                                anchorCornersRef.current = smoothed;
                                setDetectedCorners(smoothed);
                                GLOBAL_LAST_CORNERS = smoothed;
                            } else {
                                // First Lock
                                anchorCornersRef.current = newNorm;
                                setDetectedCorners(newNorm);
                                GLOBAL_LAST_CORNERS = newNorm;
                            }
                        }
                        // ELSE: Do NOTHING. 
                        // If no document found, we intentionally leave 'detectedCorners' as is.
                        // This keeps the green box frozen in place indefinitely until a new doc appears.
                    }
                } catch (e: any) {
                    console.error(e);
                }
                finally {
                    processingRef.current = false;
                    if (!stoppedRef.current) loopRef.current = requestAnimationFrame(processFrame);
                }
            };
            loopRef.current = requestAnimationFrame(processFrame);

            return () => {
                stoppedRef.current = true;
                if (loopRef.current) cancelAnimationFrame(loopRef.current);
                try { src.delete(); gray.delete(); blur.delete(); edges.delete(); contours.delete(); poly.delete(); } catch (e) { }
            };
        };

        const checkCv = setInterval(() => {
            if (window.cv && window.cv.Mat) { clearInterval(checkCv); startLoop(); }
        }, 100);

        return () => { clearInterval(checkCv); };
    }, [isActive, videoRef]);

    return { detectedCorners };
};
