import React, { useRef, useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { mobileUploadService } from '../services/MobileUploadService';
import { processScannerImage } from '../utils/imageScannerUtils';
import { Camera, Image as ImageIcon, Check, Share, Loader2, Wand2, X, Trash2, Undo2, RotateCw, AlertCircle } from 'lucide-react';
import app from '../config/firebase';
import './MobileCameraPage.css';

interface ScannedPage {
    blob: Blob;
    preview: string;
    id: string;
}

const MobileCameraPage: React.FC = () => {
    const { sessionId } = useParams<{ sessionId: string }>();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

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
    const activeStreamRef = useRef<MediaStream | null>(null);
    const allObjectUrls = useRef<Set<string>>(new Set());
    const carouselRef = useRef<HTMLDivElement>(null);

    // 1. Unified Camera Initialization (V15 - Crucial for iOS)
    useEffect(() => {
        let isMounted = true;

        const startCamera = async () => {
            if (isReviewOpen || selectedPageId) return;

            try {
                console.log("[Camera] initializing...");
                setStreamStatus('initializing');

                const constraints = {
                    video: {
                        facingMode: 'environment',
                        width: { ideal: 1920 },
                        height: { ideal: 1080 }
                    },
                    audio: false
                };

                const stream = await navigator.mediaDevices.getUserMedia(constraints)
                    .catch(async () => {
                        console.warn("[Camera] Ideal constraints failed, falling back...");
                        return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                    });

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

    const addScannedPage = async (blob: Blob) => {
        try {
            setProcessingStep('Analyzing...');
            const processedBlob = await processScannerImage(blob, {
                quality: 1.0,
                onStatusUpdate: setProcessingStep
            });

            const newPage: ScannedPage = {
                blob: processedBlob,
                preview: URL.createObjectURL(processedBlob),
                id: Math.random().toString(36).substr(2, 9)
            };
            allObjectUrls.current.add(newPage.preview);

            setScannedPages(prev => [...prev, newPage]);
            setProcessingStep('');
        } catch (err) {
            console.error('Failed to process image:', err);
            const originalPage: ScannedPage = {
                blob: blob,
                preview: URL.createObjectURL(blob),
                id: Math.random().toString(36).substr(2, 9)
            };
            allObjectUrls.current.add(originalPage.preview);
            setScannedPages(prev => [...prev, originalPage]);
            setProcessingStep('');
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            await addScannedPage(selectedFile);
        }
    };

    const capturePhoto = () => {
        if (!videoRef.current || !canvasRef.current) return;

        const video = videoRef.current;
        const canvas = canvasRef.current;

        // Match canvas size to video stream resolution
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(async (blob) => {
                if (blob) {
                    await addScannedPage(blob);
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
            for (const page of scannedPages) {
                await mobileUploadService.uploadBatchImage(sessionId, page.blob);
            }
            await mobileUploadService.finalizeSession(sessionId);

            // Success UX
            setNotification({
                message: `All ${pageCount} pages sent!`,
                type: 'success'
            });

            // Clear batch
            scannedPages.forEach(p => URL.revokeObjectURL(p.preview));
            setScannedPages([]);
            setStatus('idle');
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

    const triggerCamera = () => {
        fileInputRef.current?.click();
    };



    return (
        <div className="mobile-page">
            <div className="mobile-content">
                <div className="brand-logo"><img src="/images/logo.png" alt="IntelliMark" /></div>

                {!!processingStep && (
                    <div className="processing-overlay">
                        <div className="processing-content">
                            <Wand2 className="processing-icon spin-pulse" size={48} />
                            <h3>{processingStep}</h3>
                            <p>Optimizing for AI marking</p>
                        </div>
                    </div>
                )}

                <div className="camera-viewport">
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
                            opacity: streamStatus === 'active' ? 1 : 0.01,
                            pointerEvents: streamStatus === 'active' ? 'auto' : 'none'
                        }}
                    />

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
                                    <p style={{ fontWeight: '600', fontSize: '1.2rem', color: '#fff', marginTop: '12px' }}>
                                        {activeStreamRef.current ? "Scanner Ready" : "Starting Camera..."}
                                    </p>
                                    <p style={{ fontSize: '0.9rem', opacity: 0.7, marginTop: '8px' }}>
                                        {activeStreamRef.current ? "Tap anywhere to begin" : "Please wait a moment..."}
                                    </p>

                                    {cameraError && (
                                        <div className="camera-error-inline" style={{ marginTop: '10px', fontSize: '12px', color: '#ff6b6b', padding: '0 20px', textAlign: 'center', zIndex: 100 }}>
                                            <p onClick={() => setShowDebug(!showDebug)} style={{ textDecoration: 'underline', cursor: 'pointer', marginBottom: '8px' }}>
                                                {showDebug ? 'Hide Technical Info' : 'Show Technical Info'}
                                            </p>
                                            {showDebug && <code style={{ display: 'block', background: 'rgba(0,0,0,0.8)', padding: '10px', borderRadius: '8px', wordBreak: 'break-all', color: '#fff' }}>{cameraError}</code>}
                                        </div>
                                    )}


                                </>
                            )}
                        </div>
                    )}

                    <div className="camera-guides" style={{ opacity: streamStatus === 'active' ? 1 : 0 }}>
                        <div className="corner-tl" />
                        <div className="corner-tr" />
                        <div className="corner-bl" />
                        <div className="corner-br" />
                    </div>

                    {scannedPages.length > 0 && (
                        <div className="floating-batch-list" onClick={() => setIsReviewOpen(true)}>
                            <div className="batch-count-indicator">{scannedPages.length}</div>
                            <div className="batch-list-scroll">
                                {scannedPages.map((page, idx) => (
                                    <div key={page.id} className="batch-thumb">
                                        <img src={page.preview} alt={`Scan ${idx + 1}`} />
                                        <div className="thumb-idx">{idx + 1}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {notification && (
                        <div className={`toast-notification ${notification.type}`}>
                            {notification.type === 'success' ? <Check size={18} /> : <X size={18} />}
                            <span>{notification.message}</span>
                        </div>
                    )}

                    {/* Development Only: Simualte Camera with File Pick */}
                    {window.location.hostname === 'localhost' && sessionId && (
                        <div className="mobile-dev-tools">
                            <button className="dev-pick-btn" onClick={() => triggerCamera()}>
                                <ImageIcon size={18} />
                                <span>Simulate Camera</span>
                            </button>
                        </div>
                    )}
                    {/* Hidden Canvas for Capture */}
                    <canvas ref={canvasRef} style={{ display: 'none' }} />
                </div>
            </div>

            <div className="mobile-actions">
                <input type="file" accept="image/*" capture="environment" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} />

                <div className="shutter-row">
                    <button className="gallery-btn" onClick={() => { fileInputRef.current?.removeAttribute('capture'); fileInputRef.current?.click(); }}>
                        <ImageIcon size={24} />
                    </button>

                    <button className="shutter-btn" onClick={capturePhoto} disabled={streamStatus !== 'active'}>
                        <div className="shutter-inner" />
                    </button>

                    <button
                        className={`action-btn done-submit-btn ${scannedPages.length > 0 ? 'active' : ''}`}
                        onClick={handleUploadAll}
                        disabled={scannedPages.length === 0 || status === 'uploading'}
                    >
                        <div className="done-icon-wrapper">
                            {status === 'uploading' ? <Loader2 className="spin" size={20} /> : <Check size={20} />}
                        </div>
                        <span>Done</span>
                    </button>
                </div>
            </div>

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
