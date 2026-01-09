import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import QRCode from 'react-qr-code';
import { X, Smartphone, Check, Loader2, RefreshCw } from 'lucide-react';
import { mobileUploadService, type UploadSession } from '../../services/MobileUploadService';
import './MobileUploadModal.css';

interface MobileUploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImageReceived: (imageUrls: string[]) => void;
    sessionIdProp?: string;
    onSessionCreated?: (id: string) => void;
}

const MobileUploadModal: React.FC<MobileUploadModalProps> = ({
    isOpen,
    onClose,
    onImageReceived,
    sessionIdProp,
    onSessionCreated
}) => {
    const [sessionId, setSessionId] = useState<string>(sessionIdProp || '');
    const [status, setStatus] = useState<UploadSession['status']>('waiting');
    const [receivedUrls, setReceivedUrls] = useState<string[]>([]);
    const [lastReceivedTime, setLastReceivedTime] = useState<string | null>(null);
    const [error, setError] = useState<string>('');

    // Initialize session
    useEffect(() => {
        if (!isOpen) return;

        const initSession = async () => {
            try {
                // If we already have a persistent session ID, just use it
                if (sessionIdProp) {
                    setSessionId(sessionIdProp);
                    return;
                }

                // Otherwise create a new one
                setError('');
                const newSessionId = mobileUploadService.generateSessionId();
                setSessionId(newSessionId);
                setStatus('waiting');
                await mobileUploadService.createSession(newSessionId);
                onSessionCreated?.(newSessionId);
            } catch (err) {
                console.error('Failed to init session:', err);
                setError('Failed to generate connection code');
            }
        };

        initSession();
    }, [isOpen, sessionIdProp, onSessionCreated]);

    // Listen to session updates
    useEffect(() => {
        if (!sessionId || !isOpen) return;

        const unsubscribe = mobileUploadService.listenToSession(sessionId, (data) => {
            if (data) {
                setStatus(data.status);
                if (data.imageUrls && data.imageUrls.length > receivedUrls.length) {
                    setReceivedUrls(data.imageUrls);
                    setLastReceivedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
                }
            }
        });

        return () => unsubscribe();
    }, [sessionId, isOpen, receivedUrls.length]);

    // V16.2: Manual Import Logic (kept for safety)
    const handleImport = async () => {
        if (receivedUrls.length > 0) {
            onImageReceived(receivedUrls);
            onClose();
        }
    };

    const handleFinalize = async () => {
        if (sessionId) {
            await mobileUploadService.cleanupSession(sessionId);
        }
        onClose();
    };

    if (!isOpen) return null;

    const uploadUrl = `${window.location.origin}/mobile-upload/${sessionId}`;

    return ReactDOM.createPortal(
        <div className="mobile-upload-overlay">
            <div className="mobile-upload-modal">
                <button className="close-btn" onClick={onClose}>
                    <X size={20} />
                </button>

                <div className="modal-content">
                    <div className="icon-header">
                        <Smartphone size={32} strokeWidth={1.5} />
                    </div>

                    <h2>Scan to Upload</h2>
                    <p className="subtitle">Use your phone camera to snap & upload instantly</p>

                    <div className="qr-container">
                        <div className="qr-wrapper">
                            {sessionId ? (
                                <QRCode
                                    value={uploadUrl}
                                    size={200}
                                    style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                                    viewBox={`0 0 256 256`}
                                />
                            ) : (
                                <div className="qr-placeholder">
                                    <Loader2 className="spin" size={32} />
                                </div>
                            )}
                            {status === 'uploading' && (
                                <div className="upload-spinner-overlay">
                                    <Loader2 className="spin" size={32} />
                                </div>
                            )}
                        </div>

                        {receivedUrls.length > 0 && (
                            <div className="batch-status-mini" style={{
                                marginTop: '16px',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '4px',
                                color: '#42f587',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
                                    <Check size={20} />
                                    <span>{receivedUrls.length} Page{receivedUrls.length !== 1 ? 's' : ''} Received</span>
                                </div>
                                {lastReceivedTime && (
                                    <div style={{ fontSize: '12px', opacity: 0.8, fontWeight: 'normal' }}>
                                        Latest batch received at {lastReceivedTime}
                                    </div>
                                )}
                            </div>
                        )}

                        {status === 'error' && (
                            <div className="status-wrapper error" style={{ color: '#ef4444', marginTop: '16px' }}>
                                <RefreshCw size={24} />
                                <p>Connection failed</p>
                                <button onClick={() => setStatus('waiting')} style={{ background: 'none', border: 'none', color: 'white', textDecoration: 'underline' }}>Try Again</button>
                            </div>
                        )}
                    </div>


                    {receivedUrls.length === 0 && (
                        <div className="instructions">
                            <div className="step">
                                <span className="step-num">1</span>
                                <span>Open Camera</span>
                            </div>
                            <div className="step-line" />
                            <div className="step">
                                <span className="step-num">2</span>
                                <span>Scan QR</span>
                            </div>
                            <div className="step-line" />
                            <div className="step">
                                <span className="step-num">3</span>
                                <span>Upload</span>
                            </div>
                        </div>
                    )}

                    <div className="modal-footer">
                        <p className="helper-text">Works with standard iPhone & Android cameras</p>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default MobileUploadModal;
