import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CreditCard, ChevronRight, X, MessageSquare } from 'lucide-react';
import { useTelemetry } from '../../hooks/useTelemetry';
import './InsufficientCreditsModal.css';

interface InsufficientCreditsModalProps {
    isOpen: boolean;
    onClose: () => void;
    remainingCredits: number;
}

const InsufficientCreditsModal: React.FC<InsufficientCreditsModalProps> = ({ isOpen, onClose, remainingCredits }) => {
    const navigate = useNavigate();
    const { logEvent } = useTelemetry();
    const [step, setStep] = useState<'pitch' | 'survey'>('pitch');

    useEffect(() => {
        if (isOpen) {
            setStep('pitch');
            logEvent('telemetry_events', { eventType: 'paywall_viewed', metadata: { remainingCredits } });
        }
    }, [isOpen, logEvent, remainingCredits]);

    if (!isOpen) return null;

    const handleUpgrade = () => {
        logEvent('telemetry_events', { eventType: 'subscription_clicked', metadata: {} });
        navigate('/pricing', { state: { fromApp: true } });
        onClose();
    };

    const handleDismiss = () => {
        setStep('survey');
    };

    const submitExitSurvey = (reason: string) => {
        logEvent('telemetry_events', { eventType: 'exit_survey_submitted', metadata: { reason } });
        onClose();
    };

    return (
        <div className="credits-modal-overlay" onClick={onClose}>
            <div className="credits-modal-container" onClick={(e) => e.stopPropagation()}>
                <button className="credits-modal-close" onClick={onClose} aria-label="Close">
                    <X size={20} />
                </button>

                <div className="credits-modal-content">
                    {step === 'pitch' ? (
                        <>
                            <div className="credits-modal-icon-wrapper">
                                <div className="credits-modal-icon-bg">
                                    <AlertCircle size={32} className="credits-alert-icon" />
                                </div>
                            </div>
                            <h2 className="credits-modal-title">Insufficient Credits</h2>
                            <p className="credits-modal-description">
                                You currently have <span className="credits-negative-value">{remainingCredits.toFixed(2)}</span> credits remaining.
                                To continue using our AI features, please upgrade your plan.
                            </p>
                            <div className="credits-modal-actions">
                                <button className="credits-upgrade-btn" onClick={handleUpgrade}>
                                    <CreditCard size={18} />
                                    <span>Upgrade My Plan</span>
                                    <ChevronRight size={16} className="btn-chevron" />
                                </button>
                                <button className="credits-cancel-btn" onClick={handleDismiss}>
                                    Maybe later
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="credits-modal-icon-wrapper">
                                <div className="credits-modal-icon-bg" style={{ background: '#f3f4f6', color: '#4b5563' }}>
                                    <MessageSquare size={32} />
                                </div>
                            </div>
                            <h2 className="credits-modal-title" style={{ marginTop: '16px' }}>Before you go...</h2>
                            <p className="credits-modal-description" style={{ marginBottom: '24px' }}>
                                To help us improve the platform, what's holding you back from upgrading today?
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                                <button className="credits-cancel-btn" style={{ width: '100%' }} onClick={() => submitExitSurvey('Too expensive')}>Too expensive</button>
                                <button className="credits-cancel-btn" style={{ width: '100%' }} onClick={() => submitExitSurvey('Just testing it out')}>Just testing it out</button>
                                <button className="credits-cancel-btn" style={{ width: '100%' }} onClick={() => submitExitSurvey('Accuracy issues')}>AI Accuracy isn't good enough yet</button>
                                <button className="credits-cancel-btn" style={{ width: '100%' }} onClick={() => submitExitSurvey('Missing features')}>Missing features I need</button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default InsufficientCreditsModal;
