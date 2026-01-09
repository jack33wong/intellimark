import { useState, useEffect, useRef } from 'react';

export interface NormalizedPoint { x: number; y: number; }

declare global { interface Window { cv: any; } }

export const useDocumentDetection = (videoRef: React.RefObject<HTMLVideoElement>, isActive: boolean) => {
    const [detectedCorners, setDetectedCorners] = useState<NormalizedPoint[] | null>(null);
    const [cvStatus, setCvStatus] = useState<string>("Init...");

    // We use a separate loop ref to ensure we can cancel cleanly
    const loopRef = useRef<number>();
    const processingRef = useRef(false);

    // Smoothing History
    const historyRef = useRef<NormalizedPoint[][]>([]);
    const HISTORY_LENGTH = 5;

    // Helper: Sort TL, TR, BR, BL
    const sortCorners = (pts: { x: number, y: number }[]) => {
        const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
        const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;

        // Sort by angle from center
        const sorted = [...pts].sort((a, b) =>
            Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
        );

        // Find top-left (smallest sum of x+y)
        let tlIdx = 0;
        let minSum = Infinity;
        for (let i = 0; i < 4; i++) {
            if ((sorted[i].x + sorted[i].y) < minSum) {
                minSum = sorted[i].x + sorted[i].y;
                tlIdx = i;
            }
        }

        return [...sorted.slice(tlIdx), ...sorted.slice(0, tlIdx)];
    };

    useEffect(() => {
        if (!isActive) return;

        const startLoop = () => {
            if (!window.cv || !window.cv.Mat) return;
            const cv = window.cv;

            // Pre-allocate memory (Reused every frame for performance)
            const src = new cv.Mat();
            const gray = new cv.Mat();
            const blur = new cv.Mat();
            const edges = new cv.Mat();
            const contours = new cv.MatVector();
            const poly = new cv.Mat();
            const hierarchy = new cv.Mat();

            const processFrame = () => {
                const video = videoRef.current;
                if (!video || video.videoWidth === 0) {
                    loopRef.current = requestAnimationFrame(processFrame);
                    return;
                }

                if (processingRef.current) {
                    loopRef.current = requestAnimationFrame(processFrame);
                    return;
                }
                processingRef.current = true;

                try {
                    // 1. DOWNSCALE (Massive Performance Boost)
                    // We only need 160px width to find a paper shape.
                    const w = 160;
                    const scale = w / video.videoWidth;
                    const h = Math.floor(video.videoHeight * scale);

                    // Create tiny canvas for processing
                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });

                    if (!ctx) throw new Error("No CTX");
                    ctx.drawImage(video, 0, 0, w, h);
                    const imgData = ctx.getImageData(0, 0, w, h);

                    // Load Data
                    if (src.cols !== w || src.rows !== h) {
                        src.release();
                        src.create(h, w, cv.CV_8UC4);
                    }
                    src.data.set(imgData.data);

                    // 2. FAST PIPELINE (Gray -> Canny)
                    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
                    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
                    // Standard Canny thresholds work well on documents
                    cv.Canny(blur, edges, 50, 150);

                    // 3. FIND CONTOURS
                    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

                    let maxArea = 0;
                    let bestPts: { x: number, y: number }[] | null = null;
                    const minArea = (w * h) * 0.15; // Must cover 15% of screen

                    for (let i = 0; i < contours.size(); ++i) {
                        const cnt = contours.get(i);
                        const area = cv.contourArea(cnt);

                        // Optimization: Skip small noise immediately
                        if (area < minArea) continue;

                        const peri = cv.arcLength(cnt, true);
                        cv.approxPolyDP(cnt, poly, 0.02 * peri, true);

                        if (poly.rows === 4) {
                            // Extract points
                            const rawPts = [];
                            for (let j = 0; j < 4; j++) {
                                rawPts.push({
                                    x: poly.data32S[j * 2],
                                    y: poly.data32S[j * 2 + 1]
                                });
                            }

                            // Sort: [TL, TR, BR, BL]
                            const pts = sortCorners(rawPts);

                            // --- V28: TRAPEZOID CONSTRAINT ---
                            // We enforce that Top/Bottom lines are roughly horizontal.

                            // Top Edge Angle (TL -> TR)
                            const topDx = Math.abs(pts[0].x - pts[1].x);
                            const topDy = Math.abs(pts[0].y - pts[1].y);

                            // Bottom Edge Angle (BL -> BR)
                            const botDx = Math.abs(pts[3].x - pts[2].x);
                            const botDy = Math.abs(pts[3].y - pts[2].y);

                            // CONSTRAINTS:
                            // 1. Horizontal Deviation: dy should be < 20% of dx (Approx 11 degrees)
                            const isTopHorizontal = topDy < (topDx * 0.20);
                            const isBotHorizontal = botDy < (botDx * 0.20);

                            if (isTopHorizontal && isBotHorizontal && area > maxArea) {
                                maxArea = area;
                                bestPts = pts;
                            }
                        }
                    }

                    // 4. UPDATE STATE
                    if (bestPts) {
                        // Convert back to Normalized (0..1)
                        const norm = bestPts.map(p => ({ x: p.x / w, y: p.y / h }));

                        historyRef.current.push(norm);
                        if (historyRef.current.length > HISTORY_LENGTH) historyRef.current.shift();

                        // Average for smoothness
                        const avg = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
                        historyRef.current.forEach(frame => {
                            frame.forEach((p, i) => { avg[i].x += p.x; avg[i].y += p.y; });
                        });
                        const smoothed = avg.map(p => ({
                            x: p.x / historyRef.current.length,
                            y: p.y / historyRef.current.length
                        }));

                        setDetectedCorners(smoothed);
                    } else {
                        // Decay history if lost
                        if (historyRef.current.length > 0) {
                            historyRef.current.shift();
                            // If we still have history, show old detection (prevents flickering)
                            if (historyRef.current.length > 0) {
                                const avg = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
                                historyRef.current.forEach(frame => {
                                    frame.forEach((p, i) => { avg[i].x += p.x; avg[i].y += p.y; });
                                });
                                setDetectedCorners(avg.map(p => ({ x: p.x / historyRef.current.length, y: p.y / historyRef.current.length })));
                            } else {
                                setDetectedCorners(null);
                            }
                        } else {
                            setDetectedCorners(null);
                        }
                    }

                } catch (e) {
                    console.error(e);
                } finally {
                    processingRef.current = false;
                    loopRef.current = requestAnimationFrame(processFrame);
                }
            };

            loopRef.current = requestAnimationFrame(processFrame);
        };

        // Initialize OpenCV
        const checkCv = setInterval(() => {
            if (window.cv && window.cv.Mat) {
                clearInterval(checkCv);
                setCvStatus("Ready");
                startLoop();
            }
        }, 100);

        return () => {
            clearInterval(checkCv);
            if (loopRef.current) cancelAnimationFrame(loopRef.current);
        };
    }, [isActive, videoRef]);

    return { detectedCorners, cvStatus };
};
