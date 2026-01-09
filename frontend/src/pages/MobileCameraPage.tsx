import React, { useRef, useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { mobileUploadService } from '../services/MobileUploadService';
import { processScannerImage, performInstantCrop } from '../utils/imageScannerUtils';
import { useDocumentDetection, NormalizedPoint } from '../hooks/useDocumentDetection';
import { Camera, Check, Share, Loader2, Wand2, X, Trash2, Undo2, RotateCw, AlertCircle, ArrowLeft } from 'lucide-react';
import app from '../config/firebase';
import './MobileCameraPage.css';

interface ScannedPage {
    blob: Blob;
    preview: string;
    id: string;
}


// Helper: Map Screen Points (Standard Cover Mode logic)
function mapPointToScreen(
    p: { x: number; y: number },
    videoW: number,
    videoH: number,
    elementW: number,
    elementH: number
) {
    const videoRatio = videoW / videoH;
    const screenRatio = elementW / elementH;

    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;

    // "Contain" logic ensures the green box tracks perfectly with black bars.
    if (screenRatio > videoRatio) {
        scale = elementH / videoH;
        const drawnW = videoW * scale;
        offsetX = (elementW - drawnW) / 2;
    } else {
        scale = elementW / videoW;
        const drawnH = videoH * scale;
        offsetY = (elementH - drawnH) / 2;
    }

    return {
        x: (p.x * videoW * scale) + offsetX,
        y: (p.y * videoH * scale) + offsetY
    };
}

// Helper: Trust detection (V4TrustMode) - No longer rejecting "weird" quads
const isValidQuad = (corners: NormalizedPoint[]) => {
    return true; // We always trust the green box if it's on screen
};

const MobileCameraPage: React.FC = () => {
    const { sessionId } = useParams<{ sessionId: string }>();
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [scannedPages, setScannedPages] = useState<ScannedPage[]>([]);
    const [currentPreview, setCurrentPreview] = useState<string | null>(null);
    const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
    const [streamStatus, setStreamStatus] = useState<'initializing' | 'active' | 'denied' | 'error'>('initializing');
    const [processingStep, setProcessingStep] = useState<string>('');
    const [errorMsg, setErrorMsg] = useState<string>('');
    const [isReviewOpen, setIsReviewOpen] = useState(false);
    const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [showDebug, setShowDebug] = useState(false);
    const [correctionMsg, setCorrectionMsg] = useState<string | null>(null);
    const activeStreamRef = useRef<MediaStream | null>(null);
    const allObjectUrls = useRef<Set<string>>(new Set());
    const carouselRef = useRef<HTMLDivElement>(null);

    // V27: BURST MODE QUEUE
    const [queue, setQueue] = useState<{ id: number, blob: Blob, corners: NormalizedPoint[] | null }[]>([]);
    const processingRef = useRef(false);

    // Latest Corners Ref for Shutter (V19)
    const latestCornersRef = useRef<NormalizedPoint[] | null>(null);

    // 1. Pro CV Engine (V21/V23/V25)
    const { detectedCorners, isSteady, isCvReady, cvStatus, debugLog, debugCanvasRef } = useDocumentDetection(
        videoRef,
        streamStatus === 'active' && !isReviewOpen && !processingStep
    );

    // Update ref whenever hook gives new corners
    useEffect(() => {
        latestCornersRef.current = detectedCorners;
    }, [detectedCorners]);

    // --- V27: BACKGROUND PROCESSOR ---
    useEffect(() => {
        if (processingRef.current || queue.length === 0) return;

        const processNext = async () => {
            processingRef.current = true;

            const item = queue[0];

            try {
                let processedBlob: Blob;
                if (item.corners) {
                    processedBlob = await performInstantCrop(item.blob, item.corners);
                } else {
                    // Fallback to process scanner if no corners
                    processedBlob = await processScannerImage(item.blob, { quality: 1.0 });
                }

                const newPage: ScannedPage = {
                    blob: processedBlob,
                    preview: URL.createObjectURL(processedBlob),
                    id: Math.random().toString(36).substr(2, 9)
                };
                allObjectUrls.current.add(newPage.preview);
                setScannedPages(prev => [...prev, newPage]);
            } catch (err) {
                console.error("[V27] Processing failed:", err);
                const fallbackPage: ScannedPage = {
                    blob: item.blob,
                    preview: URL.createObjectURL(item.blob),
                    id: Math.random().toString(36).substr(2, 9)
                };
                allObjectUrls.current.add(fallbackPage.preview);
                setScannedPages(prev => [...prev, fallbackPage]);
            } finally {
                setQueue(prev => prev.slice(1));
                processingRef.current = false;
            }
        };

        processNext();
    }, [queue]);

    // 1. Unified Camera Initialization (V15 - Crucial for iOS)
    useEffect(() => {
        let isMounted = true;

        const startCamera = async () => {
            if (isReviewOpen || selectedPageId) return;

            try {
                // V22: FORCE 4:3 PHOTO MODE
                const constraints = {
                    video: {
                        facingMode: 'environment',
                        // 1.333 Aspect Ratio = 4:3 = Full Sensor = WIDER VIEW
                        aspectRatio: { ideal: 1.333 },
                        width: { ideal: 2560 },
                        height: { ideal: 1920 }
                    },
                    audio: false
                };

                const stream = await navigator.mediaDevices.getUserMedia(constraints);

                if (!isMounted) {
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }

                // 2. IMMEDIATE ASSIGNMENT (Crucial for iOS)
                activeStreamRef.current = stream;

                if (videoRef.current) {
                    const video = videoRef.current;
                    video.srcObject = stream;
                    video.muted = true;
                    video.playsInline = true;

                    // Fire-and-forget play attempt in the same executive tick
                    video.play().catch(e => {
                        console.warn("[Camera] Autoplay initially blocked or pending:", e.name);
                    });
                }
            } catch (err) {
                console.error('[Camera] Error:', err);
                if (isMounted) {
                    setCameraError(err instanceof Error ? err.message : String(err));
                    setStreamStatus('denied');
                }
            }
        };

        startCamera();

        return () => {
            isMounted = false;
            if (activeStreamRef.current) {
                console.log("[Camera] Stopping stream track...");
                activeStreamRef.current.getTracks().forEach(track => track.stop());
                activeStreamRef.current = null;
            }
        };
    }, [isReviewOpen, !!selectedPageId]);

    // 2. Unmount-Only Cleanup: Revoke all object URLs only when leaving the page entirely
    useEffect(() => {
        return () => {
            console.log("[Camera] Component unmounting... Revoking all tracked preview URLs.");
            allObjectUrls.current.forEach(url => URL.revokeObjectURL(url));
        };
    }, []);

    // 3. Carousel Management: Scroll to latest when review opens
    useEffect(() => {
        if (isReviewOpen && carouselRef.current && scannedPages.length > 0) {
            // Give layout a moment to settle across devices
            setTimeout(() => {
                if (carouselRef.current) {
                    carouselRef.current.scrollTo({
                        left: carouselRef.current.scrollWidth,
                        behavior: 'smooth'
                    });
                }
            }, 50);
        }
    }, [isReviewOpen, scannedPages.length]);

    const manualStart = async () => {
        console.log("[Camera] Gesture detected. Attempting playback unlock...");
        if (videoRef.current && streamStatus !== 'active') {
            try {
                if (activeStreamRef.current && videoRef.current.srcObject !== activeStreamRef.current) {
                    videoRef.current.srcObject = activeStreamRef.current;
                }
                const playPromise = videoRef.current.play();
                if (playPromise !== undefined) {
                    await playPromise;
                }
                setStreamStatus('active');
                setCameraError(null);
            } catch (err) {
                const name = err instanceof Error ? err.name : 'Unknown';
                console.warn("Gesture-start failed (expected if stream not ready):", name);
            }
        }
    };

    // V14 Gesture Harvesting: Allow any interaction to unlock the camera
    useEffect(() => {
        const handler = () => {
            if (streamStatus !== 'active') {
                manualStart();
            }
        };
        // Use capture: true to ensure we catch it before children
        window.addEventListener('touchstart', handler, { passive: true, capture: true });
        window.addEventListener('mousedown', handler, { passive: true, capture: true });
        window.addEventListener('scroll', handler, { passive: true, capture: true });

        return () => {
            window.removeEventListener('touchstart', handler, { capture: true });
            window.removeEventListener('mousedown', handler, { capture: true });
            window.removeEventListener('scroll', handler, { capture: true });
        };
    }, [streamStatus]);

    // V27: addScannedPage is removed in favor of the background queue


    const capturePhoto = () => {
        if (!videoRef.current || !canvasRef.current || queue.length > 5) return;

        const video = videoRef.current;
        const canvas = canvasRef.current;
        const corners = latestCornersRef.current; // Grab instantly

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(video, 0, 0);
            canvas.toBlob((blob) => {
                if (blob) {
                    setQueue(prev => [...prev, { id: Date.now(), blob, corners }]);
                }
            }, 'image/jpeg', 0.95);
        }
    };


    const removePage = (id: string) => {
        setScannedPages(prev => {
            const filtered = prev.filter(p => {
                if (p.id === id) URL.revokeObjectURL(p.preview);
                return p.id !== id;
            });
            if (filtered.length === 0) setIsReviewOpen(false);
            return filtered;
        });
    };

    const handleUploadAll = async () => {
        if (!sessionId || scannedPages.length === 0) return;

        const pageCount = scannedPages.length;
        try {
            setStatus('uploading');
            let count = 0;
            for (const page of scannedPages) {
                count++;
                setProcessingStep(`Sending Page ${count} of ${pageCount}...`);
                await mobileUploadService.uploadBatchImage(sessionId, page.blob);
            }
            // V16.3: Finalize here triggers auto-import on Desktop
            await mobileUploadService.finalizeSession(sessionId);

            // Success UX
            setNotification({
                message: `Sent ${pageCount} page${pageCount !== 1 ? 's' : ''}!`,
                type: 'success'
            });

            // Clear batch but stay on page
            scannedPages.forEach(p => URL.revokeObjectURL(p.preview));
            setScannedPages([]);
            setProcessingStep('');
            setStatus('success');
            setIsReviewOpen(false);

            // Auto-dismiss notification
            setTimeout(() => setNotification(null), 3000);
        } catch (err) {
            console.error(err);
            setStatus('error');
            const message = err instanceof Error ? err.message : String(err);
            setNotification({ message: `Upload failed: ${message}`, type: 'error' });
            setTimeout(() => setNotification(null), 5000);
        }
    };




    return (
        <div className="mobile-page">
            <div className="mobile-content" style={{ backgroundColor: '#111' }}>
                {/* V21 TOP BAR */}
                <div style={{
                    padding: '20px', display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', zIndex: 20,
                    background: 'rgba(0,0,0,0.4)'
                }}>
                    <button onClick={() => window.history.back()} style={{ background: 'none', border: 'none', color: 'white' }}>
                        <ArrowLeft size={28} />
                    </button>
                    <div style={{ color: 'white', fontWeight: 600 }}>
                        {queue.length > 0 ? `Enhancing (${queue.length})...` : 'Scan Document'}
                    </div>
                    {queue.length > 0 ? (
                        <Loader2 className="animate-spin" color="#42f587" size={24} />
                    ) : (
                        <div style={{ width: 28 }} />
                    )}
                </div>

                {status === 'success' ? (
                    <div className="success-screen">
                        <div className="success-content">
                            <div className="success-checkmark">
                                <Check size={64} />
                            </div>
                            <h2>All Set!</h2>
                            <p>Your work has been submitted successfully.</p>
                            <div className="success-details">
                                <p>You can now return to your computer to see the results, or add more pages below.</p>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', maxWidth: '280px' }}>
                                <button className="add-more-success-btn" onClick={() => setStatus('idle')} style={{
                                    backgroundColor: '#42f587', color: '#111', padding: '14px', borderRadius: '12px',
                                    fontWeight: 'bold', border: 'none', cursor: 'pointer', display: 'flex',
                                    alignItems: 'center', justifyContent: 'center', gap: '8px'
                                }}>
                                    <Camera size={20} /> Add More Pages
                                </button>
                                <button className="done-close-btn" onClick={() => window.close()} style={{
                                    backgroundColor: 'transparent', color: '#666', border: '1px solid #333',
                                    padding: '12px', borderRadius: '12px', cursor: 'pointer'
                                }}>
                                    Close Scanner
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        {!!processingStep && (
                            <div className="processing-overlay">
                                <div className="processing-content">
                                    <Wand2 className="processing-icon spin-pulse" size={48} />
                                    <h3>{processingStep}</h3>
                                    <p>Optimizing for AI marking</p>
                                </div>
                            </div>
                        )}

                        <div className="camera-viewport" ref={containerRef} style={{ backgroundColor: '#000' }}>
                            {/* Always render video to ensure Ref availability, hidden until active */}
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                className="live-camera"
                                onLoadedData={() => {
                                    console.log("[Camera] Data loaded, switching to active");
                                    setStreamStatus('active');
                                    setCameraError(null);
                                }}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'contain',
                                    opacity: streamStatus === 'active' ? 1 : 0.01,
                                    pointerEvents: streamStatus === 'active' ? 'auto' : 'none'
                                }}
                            />

                            {/* GREEN BOX OVERLAY */}
                            {detectedCorners && videoRef.current && containerRef.current && (
                                <div className="detection-overlay">
                                    <svg
                                        style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            width: '100%',
                                            height: '100%',
                                            pointerEvents: 'none',
                                            zIndex: 10
                                        }}
                                    >
                                        <polygon
                                            points={detectedCorners.map(p => {
                                                const rect = containerRef.current!.getBoundingClientRect();
                                                const mapped = mapPointToScreen(
                                                    p,
                                                    videoRef.current!.videoWidth,
                                                    videoRef.current!.videoHeight,
                                                    rect.width,
                                                    rect.height
                                                );
                                                return `${mapped.x},${mapped.y}`;
                                            }).join(' ')}
                                            fill="rgba(66, 245, 135, 0.2)"
                                            stroke="#42f587"
                                            strokeWidth="2"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                    {isSteady && (
                                        <div className="steady-indicator">
                                            Hold Steady
                                        </div>
                                    )}
                                </div>
                            )}

                            {streamStatus !== 'active' && (
                                <div className="view-finder" onClick={manualStart} style={{ cursor: 'pointer' }}>
                                    {streamStatus === 'denied' ? (
                                        <>
                                            <AlertCircle size={48} color="#ef4444" />
                                            <p>Camera permission denied.</p>
                                            <button className="retry-perm-btn" onClick={() => window.location.reload()}>
                                                <RotateCw size={16} /> Enable Camera
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <Loader2 size={48} className="spin" />
                                            <p className="status-main-text">
                                                {activeStreamRef.current ? "Scanner Ready" : "Starting Camera..."}
                                            </p>
                                            <p className="status-sub-text">
                                                {activeStreamRef.current ? "Tap anywhere to begin" : "Please wait a moment..."}
                                            </p>

                                            {cameraError && (
                                                <div className="camera-error-inline">
                                                    <p onClick={() => setShowDebug(!showDebug)} style={{ textDecoration: 'underline', cursor: 'pointer', marginBottom: '8px' }}>
                                                        {showDebug ? 'Hide Technical Info' : 'Show Technical Info'}
                                                    </p>
                                                    {showDebug && <code className="debug-code">{cameraError}</code>}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Stacked Preview (V20) */}
                            {scannedPages.length > 0 && (
                                <div className="stacked-preview-container" onClick={() => setIsReviewOpen(true)}>
                                    <div className="preview-stack">
                                        {scannedPages.slice(-3).map((page, idx) => (
                                            <div
                                                key={page.id}
                                                className="stack-layer"
                                                style={{ transform: `rotate(${(idx - 1) * 5}deg) translate(${idx * 2}px, ${idx * 2}px)` }}
                                            >
                                                <img src={page.preview} alt="Stack" />
                                            </div>
                                        ))}
                                        <div className="stack-badge">{scannedPages.length}</div>
                                    </div>
                                    <span className="modify-label">Modify</span>
                                </div>
                            )}

                            {notification && (
                                <div className={`toast-notification ${notification.type}`}>
                                    {notification.type === 'success' ? <Check size={18} /> : <X size={18} />}
                                    <span>{notification.message}</span>
                                </div>
                            )}

                            <canvas ref={canvasRef} style={{ display: 'none' }} />

                            {correctionMsg && (
                                <div style={{
                                    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                                    background: 'rgba(0,0,0,0.85)', color: '#42f587', padding: '12px 24px',
                                    borderRadius: '20px', fontWeight: 'bold', display: 'flex', gap: '8px', alignItems: 'center',
                                    zIndex: 10000
                                }}>
                                    <Wand2 size={18} /> {correctionMsg}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {status !== 'success' && (
                <div className="mobile-actions" style={{ padding: '40px 20px', background: '#111', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '40px' }}>

                    <div className="shutter-row" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '40px' }}>
                        <button
                            className="action-icon-btn discard-btn"
                            onClick={() => {
                                if (window.confirm("Discard all scanned pages?")) {
                                    scannedPages.forEach(p => URL.revokeObjectURL(p.preview));
                                    setScannedPages([]);
                                    setIsReviewOpen(false);
                                }
                            }}
                            disabled={scannedPages.length === 0}
                            style={{ background: 'none', border: 'none', color: 'white' }}
                        >
                            <Undo2 size={28} />
                        </button>

                        <button
                            className="shutter-btn"
                            onClick={capturePhoto}
                            disabled={streamStatus !== 'active' || queue.length > 5}
                            style={{
                                width: '80px', height: '80px', borderRadius: '50%',
                                backgroundColor: queue.length > 5 ? '#555' : 'white',
                                border: '4px solid rgba(255,255,255,0.3)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: 'pointer',
                                transition: 'transform 0.1s'
                            }}
                            onMouseDown={e => e.currentTarget.style.transform = 'scale(0.95)'}
                            onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
                        >
                            <div style={{
                                width: '68px', height: '68px', borderRadius: '50%',
                                border: '2px solid #111', backgroundColor: 'white'
                            }} />
                        </button>

                        <button
                            className={`done-status-btn ${scannedPages.length > 0 || queue.length > 0 ? 'active' : ''}`}
                            onClick={handleUploadAll}
                            disabled={(scannedPages.length === 0 && queue.length === 0) || status === 'uploading'}
                            style={{ background: 'none', border: 'none', color: (scannedPages.length > 0 || queue.length > 0) ? '#42f587' : '#666', fontWeight: 'bold' }}
                        >
                            {status === 'uploading' ? <Loader2 className="spin" size={20} /> : "Done"}
                        </button>
                    </div>
                </div>
            )}

            {isReviewOpen && (
                <div className="review-modal">
                    <div className="review-header">
                        <h3>Review Scans ({scannedPages.length})</h3>
                        <button onClick={() => setIsReviewOpen(false)}><X /></button>
                    </div>
                    <div className="review-list horizontal-carousel" ref={carouselRef}>
                        {scannedPages.map((page, idx) => (
                            <div key={page.id} className="review-item carousel-slide" onClick={() => setSelectedPageId(page.id)}>
                                <div className="slide-content">
                                    <img src={page.preview} alt={`Scan ${idx + 1}`} />
                                    <button className="delete-btn" onClick={(e) => { e.stopPropagation(); removePage(page.id); }}>
                                        <Trash2 size={24} />
                                    </button>
                                    <div className="page-idx">Page {idx + 1} of {scannedPages.length}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="review-footer">
                        <button className="add-more-btn" onClick={() => setIsReviewOpen(false)}>
                            <Camera size={20} /> Add More Pages
                        </button>
                    </div>
                </div>
            )}

            {selectedPageId && (
                <div className="fullscreen-viewer" onClick={() => setSelectedPageId(null)}>
                    <div className="viewer-header">
                        <button onClick={() => setSelectedPageId(null)}><X /></button>
                    </div>
                    <div className="viewer-content">
                        <img src={scannedPages.find(p => p.id === selectedPageId)?.preview} alt="Full View" />
                    </div>
                    <div className="viewer-footer">
                        <button className="vw-delete-btn" onClick={(e) => { e.stopPropagation(); removePage(selectedPageId); setSelectedPageId(null); }}>
                            <Trash2 size={20} /> Delete this page
                        </button>
                    </div>
                </div>
            )}

            {status === 'error' && <p className="error-msg">{errorMsg}</p>}
        </div>
    );
};

export default MobileCameraPage;
