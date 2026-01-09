import { useState, useEffect, useRef } from 'react';

export interface NormalizedPoint { x: number; y: number; }

declare global { interface Window { cv: any; } }

export const useDocumentDetection = (videoRef: React.RefObject<HTMLVideoElement>, isActive: boolean) => {
    const [detectedCorners, setDetectedCorners] = useState<NormalizedPoint[] | null>(null);
    const [cvStatus, setCvStatus] = useState<string>("Init...");
    const [debugLog, setDebugLog] = useState<string>("v33 | init");
    const debugCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const loopRef = useRef<number>();
    const processingRef = useRef(false);
    const historyRef = useRef<NormalizedPoint[][]>([]);

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
        if (!isActive) return;

        const startLoop = () => {
            const cv = window.cv;
            setCvStatus("Ready");
            const src = new cv.Mat();
            const gray = new cv.Mat();
            const blur = new cv.Mat();
            const edges = new cv.Mat();
            const contours = new cv.MatVector();
            const hierarchy = new cv.Mat();
            const poly = new cv.Mat();

            const processFrame = () => {
                const video = videoRef.current;

                if (!video || video.readyState < 2 || video.videoWidth === 0) {
                    loopRef.current = requestAnimationFrame(processFrame);
                    return;
                }

                if (processingRef.current) {
                    loopRef.current = requestAnimationFrame(processFrame);
                    return;
                }
                processingRef.current = true;

                try {
                    // Resolution: 350px
                    const w = 350;
                    const scale = w / video.videoWidth;
                    const h = Math.floor(video.videoHeight * scale);

                    // Sync Debug Canvas Size
                    if (debugCanvasRef.current) {
                        debugCanvasRef.current.width = w;
                        debugCanvasRef.current.height = h;
                    }

                    // 1. Draw Video to Internal Canvas (Source of Truth)
                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext('2d', { willReadFrequently: true });
                    if (!ctx) throw new Error("No CTX");
                    ctx.drawImage(video, 0, 0, w, h);
                    const imgData = ctx.getImageData(0, 0, w, h);

                    // 2. Load into OpenCV
                    if (src.cols !== w || src.rows !== h) {
                        src.delete(); src.create(h, w, cv.CV_8UC4);
                    }
                    src.data.set(imgData.data);

                    // 3. Processing Pipeline
                    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

                    // V33 FIX: Auto-Contrast (Equalize Hist)
                    // This forces the paper to stand out from the wood table
                    cv.equalizeHist(gray, gray);

                    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
                    cv.Canny(blur, edges, 50, 150);

                    // V33 FIX: Fail-Safe Rendering
                    // We simply draw the 'canvas' we just created. No complex conversions.
                    if (debugCanvasRef.current) {
                        const dCtx = debugCanvasRef.current.getContext('2d');
                        if (dCtx) {
                            // A. Draw Background (Video)
                            dCtx.drawImage(canvas, 0, 0);

                            // B. Draw Edges (Neon Overlay)
                            // We create a temp canvas for the edges
                            const edgeCanvas = document.createElement('canvas');
                            edgeCanvas.width = w; edgeCanvas.height = h;
                            const eCtx = edgeCanvas.getContext('2d');
                            if (eCtx) {
                                const eData = eCtx.createImageData(w, h);
                                for (let i = 0; i < w * h; i++) {
                                    if (edges.data[i] > 0) {
                                        eData.data[i * 4] = 0;     // R
                                        eData.data[i * 4 + 1] = 255; // G (Green)
                                        eData.data[i * 4 + 2] = 0;   // B
                                        eData.data[i * 4 + 3] = 255; // Alpha
                                    }
                                }
                                eCtx.putImageData(eData, 0, 0);
                                dCtx.globalAlpha = 0.6;
                                dCtx.drawImage(edgeCanvas, 0, 0);
                                dCtx.globalAlpha = 1.0;
                            }
                        }
                    }

                    // 4. Find Contours
                    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

                    let maxArea = 0;
                    let bestPts: { x: number, y: number }[] | null = null;
                    const minArea = (w * h) * 0.10;

                    for (let i = 0; i < contours.size(); ++i) {
                        const cnt = contours.get(i);
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

                            // Draw Candidate (Blue) on Debug
                            if (debugCanvasRef.current) {
                                const dCtx = debugCanvasRef.current.getContext('2d');
                                if (dCtx) {
                                    dCtx.strokeStyle = 'blue'; dCtx.lineWidth = 2;
                                    dCtx.beginPath(); dCtx.moveTo(pts[0].x, pts[0].y);
                                    pts.forEach(p => dCtx.lineTo(p.x, p.y));
                                    dCtx.closePath(); dCtx.stroke();
                                }
                            }

                            // Trapezoid Logic
                            const topDy = Math.abs(pts[0].y - pts[1].y);
                            const topDx = Math.abs(pts[0].x - pts[1].x);
                            const botDy = Math.abs(pts[3].y - pts[2].y);
                            const botDx = Math.abs(pts[3].x - pts[2].x);

                            const isTopHorizontal = topDy < (topDx * 0.35);
                            const isBotHorizontal = botDy < (botDx * 0.35);
                            const height = Math.abs(pts[0].y - pts[3].y);
                            const isTall = height > (topDx * 0.4);

                            if (isTopHorizontal && isBotHorizontal && isTall && area > maxArea) {
                                maxArea = area;
                                bestPts = pts;
                            }
                        }
                    }

                    // 5. Update State
                    if (bestPts) {
                        const norm = bestPts.map(p => ({ x: p.x / w, y: p.y / h }));

                        historyRef.current.push(norm);
                        if (historyRef.current.length > 5) historyRef.current.shift();

                        const avg = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
                        historyRef.current.forEach(f => f.forEach((p, i) => { avg[i].x += p.x; avg[i].y += p.y }));
                        const smoothed = avg.map(p => ({ x: p.x / historyRef.current.length, y: p.y / historyRef.current.length }));

                        setDetectedCorners(smoothed);

                        // Draw Winner (Red) on Debug
                        if (debugCanvasRef.current) {
                            const dCtx = debugCanvasRef.current.getContext('2d');
                            if (dCtx) {
                                dCtx.strokeStyle = 'red'; dCtx.lineWidth = 4;
                                dCtx.beginPath(); dCtx.moveTo(bestPts[0].x, bestPts[0].y);
                                bestPts.forEach(p => dCtx.lineTo(p.x, p.y));
                                dCtx.closePath(); dCtx.stroke();
                            }
                        }
                        setDebugLog(`v33 | Res: ${w}px | Area: ${Math.round(maxArea)} | LOCK`);
                    } else {
                        setDebugLog(`v33 | Res: ${w}px | SCANNING`);
                        // Decay
                        if (historyRef.current.length > 0) {
                            historyRef.current.shift();
                            if (historyRef.current.length > 0) {
                                const avg = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
                                historyRef.current.forEach(f => f.forEach((p, i) => { avg[i].x += p.x; avg[i].y += p.y }));
                                setDetectedCorners(avg.map(p => ({ x: p.x / historyRef.current.length, y: p.y / historyRef.current.length })));
                            } else setDetectedCorners(null);
                        } else setDetectedCorners(null);
                    }

                } catch (e) { console.error(e); }
                finally {
                    processingRef.current = false;
                    loopRef.current = requestAnimationFrame(processFrame);
                }
            };

            loopRef.current = requestAnimationFrame(processFrame);
        };

        const checkCv = setInterval(() => {
            if (window.cv && window.cv.Mat) { clearInterval(checkCv); startLoop(); }
        }, 100);

        return () => { clearInterval(checkCv); if (loopRef.current) cancelAnimationFrame(loopRef.current); };
    }, [isActive, videoRef]);

    return { detectedCorners, cvStatus, debugLog, debugCanvasRef };
};
