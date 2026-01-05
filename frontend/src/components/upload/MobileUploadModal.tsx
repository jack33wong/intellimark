import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import QRCode from 'react-qr-code';
import { X, Smartphone, Check, Loader2, RefreshCw } from 'lucide-react';
import { mobileUploadService, type UploadSession } from '../../services/MobileUploadService';
import './MobileUploadModal.css';

interface MobileUploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImageReceived: (imageUrl: string) => void;
}

const MobileUploadModal: React.FC<MobileUploadModalProps> = ({
    isOpen,
    onClose,
    onImageReceived
}) => {
    const [sessionId, setSessionId] = useState<string>('');
    const [status, setStatus] = useState<UploadSession['status']>('waiting');
    const [error, setError] = useState<string>('');

    // Initialize session
    useEffect(() => {
        if (!isOpen) return;

        const initSession = async () => {
            try {
                const newSessionId = mobileUploadService.generateSessionId();
                setSessionId(newSessionId);
                setStatus('waiting');
                await mobileUploadService.createSession(newSessionId);
            } catch (err) {
                console.error('Failed to init session:', err);
                setError('Failed to generate connection code');
            }
        };

        initSession();
    }, [isOpen]);

    // Listen to session updates
    useEffect(() => {
        if (!sessionId || !isOpen) return;

        const unsubscribe = mobileUploadService.listenToSession(sessionId, (data) => {
            if (data) {
                setStatus(data.status);
                if (data.status === 'completed' && data.imageUrl) {
                    // Add a small delay so user sees the success state
                    setTimeout(async () => {
                        onImageReceived(data.imageUrl!);
                        onClose();
                        // Cleanup checks
                        await mobileUploadService.cleanupSession(sessionId);
                    }, 1500);
                }
            }
        });

        return () => unsubscribe();
    }, [sessionId, isOpen, onImageReceived, onClose]);

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
                        {status === 'waiting' && (
                            <div className="qr-wrapper">
                                <QRCode
                                    value={uploadUrl}
                                    size={200}
                                    style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                                    viewBox={`0 0 256 256`}
                                />
                            </div>
                        )}

                        {status === 'uploading' && (
                            <div className="status-wrapper uploading">
                                <Loader2 size={48} className="spin" />
                                <p>Receiving image...</p>
                            </div>
                        )}

                        {status === 'completed' && (
                            <div className="status-wrapper success">
                                <div className="success-icon">
                                    <Check size={32} />
                                </div>
                                <p>Image received!</p>
                            </div>
                        )}

                        {status === 'error' && (
                            <div className="status-wrapper error" style={{ color: '#ef4444' }}>
                                <div className="error-icon" style={{
                                    width: '64px',
                                    height: '64px',
                                    background: 'rgba(239, 68, 68, 0.1)',
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    marginBottom: '16px'
                                }}>
                                    <RefreshCw size={32} />
                                </div>
                                <p>Connection failed</p>
                                <button
                                    onClick={() => setStatus('waiting')}
                                    style={{
                                        marginTop: '12px',
                                        background: 'transparent',
                                        border: '1px solid currentColor',
                                        padding: '6px 16px',
                                        borderRadius: '16px',
                                        cursor: 'pointer',
                                        fontSize: '0.9rem'
                                    }}
                                >
                                    Try Again
                                </button>
                            </div>
                        )}
                    </div>

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
