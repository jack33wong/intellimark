import React, { useRef, useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { mobileUploadService } from '../services/MobileUploadService';
import { processScannerImage } from '../utils/imageScannerUtils';
import { Camera, Image as ImageIcon, Check, Share, Loader2, Wand2 } from 'lucide-react';
import app from '../config/firebase';
import './MobileCameraPage.css';

const MobileCameraPage: React.FC = () => {
    const { sessionId } = useParams<{ sessionId: string }>();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [file, setFile] = useState<File | Blob | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [status, setStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
    const [isProcessing, setIsProcessing] = useState<boolean>(false);
    const [errorMsg, setErrorMsg] = useState<string>('');

    useEffect(() => {
        // Cleanup preview URL on unmount
        return () => {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
        };
    }, [previewUrl]);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            try {
                setIsProcessing(true);
                setStatus('idle');

                // Process the image (fix orientation and apply scan filters)
                const processedBlob = await processScannerImage(selectedFile, {
                    contrast: 40,
                    brightness: 10,
                    maxWidth: 2400,
                    maxHeight: 2400
                });

                setFile(processedBlob);
                setPreviewUrl(URL.createObjectURL(processedBlob));
                setIsProcessing(false);
            } catch (err) {
                console.error('Failed to process image:', err);
                // Fallback to original file
                setFile(selectedFile);
                setPreviewUrl(URL.createObjectURL(selectedFile));
                setIsProcessing(false);
            }
        }
    };

    const handleUpload = async () => {
        if (!sessionId || !file) return;

        try {
            setStatus('uploading');

            // Create a timeout promise that rejects after 60 seconds
            const timeoutPromise = new Promise((_, reject) => {
                const id = setTimeout(() => {
                    clearTimeout(id);
                    reject(new Error('Upload timed out (60s). Please check your internet connection.'));
                }, 60000);
            });

            // Race the upload against the timeout
            await Promise.race([
                mobileUploadService.uploadImage(sessionId, file),
                timeoutPromise
            ]);

            setStatus('success');
        } catch (err) {
            console.error(err);
            setStatus('error');
            // Show the actual error message to help debugging
            const message = err instanceof Error ? err.message : String(err);
            const bucket = app?.options?.storageBucket || 'MISSING_BUCKET';
            setErrorMsg(`Upload failed: ${message} (Target: ${bucket})`);
        }
    };

    const triggerCamera = () => {
        fileInputRef.current?.click();
    };

    if (status === 'success') {
        return (
            <div className="mobile-page success">
                <div className="success-content">
                    <div className="big-icon">
                        <Check size={64} />
                    </div>
                    <h1>Sent!</h1>
                    <p>Your image has been sent to your laptop.</p>
                    <p className="sub-text">You can close this tab now.</p>

                    <button
                        className="secondary-btn"
                        onClick={() => {
                            setFile(null);
                            setPreviewUrl(null);
                            setStatus('idle');
                        }}
                    >
                        Send Another
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="mobile-page">


            <div className="mobile-content">
                {isProcessing && (
                    <div className="processing-overlay">
                        <div className="processing-content">
                            <Wand2 className="processing-icon spin-pulse" size={48} />
                            <h3>Enhancing Scan...</h3>
                            <p>Fixing orientation and lighting</p>
                        </div>
                    </div>
                )}
                {!previewUrl ? (
                    <div className="empty-state">
                        <div className="placeholder-camera" onClick={triggerCamera}>
                            <Camera size={48} />
                            <p>Tap to take photo</p>
                        </div>
                        <p className="connection-status">
                            Connected to session...
                        </p>
                    </div>
                ) : (
                    <div className="preview-container">
                        <img src={previewUrl} alt="Preview" className="image-preview" />
                        <div className="preview-overlay">
                            <button className="retake-btn" onClick={triggerCamera}>
                                Retake
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="mobile-actions">
                {/* Hidden File Input */}
                <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                />

                {!file ? (
                    <>
                        <button className="primary-action-btn" onClick={triggerCamera}>
                            <div className="shutter-inner" />
                        </button>
                        <div className="secondary-actions">
                            <button className="gallery-btn" onClick={() => { fileInputRef.current?.removeAttribute('capture'); fileInputRef.current?.click(); }}>
                                <ImageIcon size={24} />
                                <span >Gallery</span>
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="confirm-actions">
                        {status === 'uploading' ? (
                            <button className="send-btn loading" disabled>
                                <Loader2 size={24} className="spin" />
                                Sending...
                            </button>
                        ) : (
                            <button className="send-btn" onClick={handleUpload}>
                                <Share size={20} />
                                Send to Laptop
                            </button>
                        )}
                    </div>
                )}

                {status === 'error' && <p className="error-msg">{errorMsg}</p>}
            </div>
        </div >
    );
};

export default MobileCameraPage;
