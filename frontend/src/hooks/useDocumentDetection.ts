import { useState, useEffect, useRef } from 'react';

export interface NormalizedPoint { x: number; y: number; }

declare global { interface Window { cv: any; } }

export const useDocumentDetection = (videoRef: React.RefObject<HTMLVideoElement>, isActive: boolean) => {
    const [detectedCorners, setDetectedCorners] = useState<NormalizedPoint[] | null>(null);
    const [detectionStatus, setDetectionStatus] = useState<string>("Initializing...");

    const loopRef = useRef<number>();
    const processingRef = useRef(false);
    const stoppedRef = useRef(false);
    const historyRef = useRef<NormalizedPoint[][]>([]);
    const frameCountRef = useRef(0); // Heartbeat counter

    // Sort: TL, TR, BR, BL
    const sortCorners = (pts: { x: number, y: number }[]) => {
        const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
        const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
        const sorted = [...pts].sort((a, b) =>
            Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
        );
        let tlIdx = 0, minSum = Infinity;
        for (let i = 0; i < 4; i++) {
            if ((sorted[i].x + sorted[i].y) < minSum) { minSum = sorted[i].x + sorted[i].y; tlIdx = i; }
        }
        return [...sorted.slice(tlIdx), ...sorted.slice(0, tlIdx)];
    };

    useEffect(() => {
        // V42 CHANGE: We DO NOT return early if !isActive.
        // We force the loop to run so you can debug the Green Box.
        stoppedRef.current = false;

        const startLoop = () => {
            if (!window.cv || !window.cv.Mat) {
                setDetectionStatus("Error: OpenCV Missing");
                return;
            }

            const cv = window.cv;
            const src = new cv.Mat();
            const gray = new cv.Mat();
            const blur = new cv.Mat();
            const edges = new cv.Mat();
            const contours = new cv.MatVector();
            const hierarchy = new cv.Mat();
            const poly = new cv.Mat();

            const processFrame = () => {
                // 1. ZOMBIE CHECK (Prevents Crash)
                if (stoppedRef.current) return;

                const video = videoRef.current;

                if (!video) {
                    loopRef.current = requestAnimationFrame(processFrame);
                    return;
                }

                // 2. VIDEO CHECK
                if (video.readyState !== 4 || video.videoWidth === 0) {
                    setDetectionStatus(`Waiting for Camera... (State: ${video.readyState})`);
                    loopRef.current = requestAnimationFrame(processFrame);
                    return;
                }

                if (processingRef.current) {
                    loopRef.current = requestAnimationFrame(processFrame);
                    return;
                }
                processingRef.current = true;
                frameCountRef.current++; // Increment Heartbeat

                try {
                    const w = 350;
                    const scale = w / video.videoWidth;
                    const h = Math.floor(video.videoHeight * scale);

                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });

                    if (ctx) {
                        ctx.drawImage(video, 0, 0, w, h);
                        const imgData = ctx.getImageData(0, 0, w, h);

                        // DOUBLE ZOMBIE CHECK (Safety)
                        if (stoppedRef.current) { processingRef.current = false; return; }

                        if (src.cols !== w || src.rows !== h) {
                            src.delete(); src.create(h, w, cv.CV_8UC4);
                        }
                        src.data.set(imgData.data);

                        // 3. PROCESS
                        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
                        cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
                        cv.Canny(blur, edges, 30, 100);

                        cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

                        let maxArea = 0;
                        let bestPts: { x: number, y: number }[] | null = null;
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
                                    for (let j = 0; j < 4; j++) {
                                        rawPts.push({ x: poly.data32S[j * 2], y: poly.data32S[j * 2 + 1] });
                                    }
                                    const pts = sortCorners(rawPts);

                                    // TRAPEZOID LOCK
                                    const topDy = Math.abs(pts[0].y - pts[1].y);
                                    const topDx = Math.abs(pts[0].x - pts[1].x);
                                    const botDy = Math.abs(pts[3].y - pts[2].y);
                                    const botDx = Math.abs(pts[3].x - pts[2].x);

                                    const isTopFlat = topDy < (topDx * 0.20);
                                    const isBotFlat = botDy < (botDx * 0.20);
                                    const height = Math.abs(pts[0].y - pts[3].y);
                                    const isTall = height > (topDx * 0.5);

                                    if (isTopFlat && isBotFlat && isTall && area > maxArea) {
                                        maxArea = area;
                                        bestPts = pts;
                                    }
                                }
                            } finally {
                                cnt.delete(); // CRITICAL MEMORY RELEASE
                            }
                        }

                        // 4. UPDATE STATUS
                        // We check isActive here only for the status text, not to stop the loop.
                        const activeLabel = isActive ? "" : "[INACTIVE]";

                        if (bestPts) {
                            const norm = bestPts.map(p => ({ x: p.x / w, y: p.y / h }));
                            historyRef.current.push(norm);
                            if (historyRef.current.length > 5) historyRef.current.shift();

                            const avg = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
                            historyRef.current.forEach(f => f.forEach((p, i) => { avg[i].x += p.x; avg[i].y += p.y }));
                            const smoothed = avg.map(p => ({ x: p.x / historyRef.current.length, y: p.y / historyRef.current.length }));

                            setDetectedCorners(smoothed);
                            setDetectionStatus(`LOCKED ${activeLabel} (${frameCountRef.current})`);
                        } else {
                            if (historyRef.current.length > 0) {
                                historyRef.current.shift();
                                setDetectedCorners(null);
                            }
                            setDetectionStatus(`Scanning... ${activeLabel} (${frameCountRef.current})`);
                        }
                    }
                } catch (e: any) {
                    if (!e.message?.includes('deleted')) {
                        setDetectionStatus(`ERROR: ${e.message}`);
                    }
                }
                finally {
                    processingRef.current = false;
                    if (!stoppedRef.current) {
                        loopRef.current = requestAnimationFrame(processFrame);
                    }
                }
            };

            loopRef.current = requestAnimationFrame(processFrame);

            return () => {
                stoppedRef.current = true; // Signal Stop
                if (loopRef.current) cancelAnimationFrame(loopRef.current);
                try {
                    src.delete(); gray.delete(); blur.delete();
                    edges.delete(); contours.delete(); hierarchy.delete(); poly.delete();
                } catch (e) { }
            };
        };

        const checkCv = setInterval(() => {
            if (window.cv && window.cv.Mat) { clearInterval(checkCv); startLoop(); }
        }, 100);

        return () => { clearInterval(checkCv); };
    }, [isActive, videoRef]);

    return { detectedCorners, status: detectionStatus };
};
