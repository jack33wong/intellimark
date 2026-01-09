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
}

const MobileUploadModal: React.FC<MobileUploadModalProps> = ({
    isOpen,
    onClose,
    onImageReceived
}) => {
    const [sessionId, setSessionId] = useState<string>('');
    const [status, setStatus] = useState<UploadSession['status']>('waiting');
    const [receivedUrls, setReceivedUrls] = useState<string[]>([]);
    const [error, setError] = useState<string>('');

    // Initialize session
    useEffect(() => {
        if (!isOpen) return;

        const initSession = async () => {
            try {
                // Reset state for new session
                setReceivedUrls([]);
                setError('');
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
                if (data.imageUrls && data.imageUrls.length > receivedUrls.length) {
                    setReceivedUrls(data.imageUrls);
                }
            }
        });

        return () => unsubscribe();
    }, [sessionId, isOpen, receivedUrls.length]);

    // V16.2: Manual Import Logic
    const handleImport = async () => {
        if (receivedUrls.length > 0) {
            onImageReceived(receivedUrls);
            setStatus('completed');
            // We don't close yet, let the user decide if they want more
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
                        {(status === 'waiting' || status === 'uploading') && receivedUrls.length === 0 && (
                            <div className="qr-wrapper">
                                <QRCode
                                    value={uploadUrl}
                                    size={200}
                                    style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                                    viewBox={`0 0 256 256`}
                                />
                                {status === 'uploading' && (
                                    <div className="upload-spinner-overlay">
                                        <Loader2 className="spin" size={32} />
                                    </div>
                                )}
                            </div>
                        )}

                        {receivedUrls.length > 0 && (
                            <div className="status-wrapper continuous">
                                <div className="batch-status-header">
                                    <div className="batch-icon">
                                        {status === 'completed' ? <Check size={32} /> : <Loader2 className="spin" size={32} />}
                                    </div>
                                    <div className="batch-count">
                                        <h3>{receivedUrls.length} Page{receivedUrls.length !== 1 ? 's' : ''} Received</h3>
                                        <p>{status === 'uploading' ? 'Scanning in progress...' : 'Ready to import'}</p>
                                    </div>
                                </div>

                                <div className="batch-actions">
                                    <button
                                        className="import-batch-btn"
                                        onClick={handleImport}
                                        disabled={status === 'uploading' || status === 'completed'}
                                    >
                                        {status === 'completed' ? 'Imported Successfully' : `Import ${receivedUrls.length} Pages`}
                                    </button>

                                    <button
                                        className="continue-scan-btn"
                                        onClick={() => setStatus('waiting')}
                                    >
                                        Keep Scanning More...
                                    </button>
                                </div>
                            </div>
                        )}

                        {status === 'error' && (
                            <div className="status-wrapper error" style={{ color: '#ef4444' }}>
                                <RefreshCw size={32} />
                                <p>Connection failed</p>
                                <button onClick={() => setStatus('waiting')}>Try Again</button>
                            </div>
                        )}
                    </div>

                    {receivedUrls.length > 0 && (
                        <div className="batch-footer">
                            <button
                                className="finalize-session-btn"
                                onClick={handleFinalize}
                            >
                                Finished? Close Connection
                            </button>
                        </div>
                    )}

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
