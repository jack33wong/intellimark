import React from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, Sparkles, ArrowRight, X } from 'lucide-react';
import './GuestLimitModal.css';

interface GuestLimitModalProps {
    isOpen: boolean;
    onClose: () => void;
    limit?: number;
    usageLimit?: number;
    usageCount?: number;
    resetAt?: string | null;
    hasPendingUpload?: boolean;
    onSignup?: (mode?: 'signup' | 'login') => Promise<void> | void;
}

const GuestLimitModal: React.FC<GuestLimitModalProps> = ({
    isOpen,
    onClose,
    limit,
    usageLimit,
    hasPendingUpload = false,
    onSignup
}) => {
    const navigate = useNavigate();

    if (!isOpen) return null;

    // Support both prop names and default to 0 (since signup is required before first use)
    const effectiveLimit = limit ?? usageLimit ?? 0;

    const handleAuthAction = async (mode: 'signup' | 'login') => {
        if (onSignup) {
            await onSignup(mode);
        } else {
            onClose();
            import('../../utils/eventManager').then(({ default: EventManager, EVENT_TYPES }) => {
                EventManager.dispatch(EVENT_TYPES.OPEN_AUTH_MODAL, { mode });
            }).catch(() => {
                navigate('/login');
            });
        }
    };

    return (
        <div className="guest-limit-modal-overlay">
            <div className="guest-limit-modal-container">
                <button className="guest-limit-modal-close" onClick={onClose} aria-label="Close">
                    <X size={20} />
                </button>

                <div className="guest-limit-modal-content">
                    <div className="guest-limit-icon-wrapper">
                        {effectiveLimit === 0 || hasPendingUpload ? (
                            <Sparkles size={32} className="guest-limit-icon" />
                        ) : (
                            <Lock size={32} className="guest-limit-icon" />
                        )}
                    </div>

                    <h2>
                        {hasPendingUpload
                            ? "Your Work is Ready to Mark!"
                            : effectiveLimit === 0
                                ? "Unlock Free AI Marking"
                                : "Guest Limit Reached"}
                    </h2>
                    <p>
                        {hasPendingUpload
                            ? "Create a free account in seconds to grade your uploaded work immediately and get 10 free credits."
                            : effectiveLimit === 0
                                ? "Create a free account to unlock our AI marking tools, model answers, and get 10 free credits instantly."
                                : "You've reached the free limit for guest users. Sign up for a free account to continue marking papers and save your history."}
                    </p>

                    <div className="guest-limit-benefits">
                        <div className="benefit-item">
                            <ArrowRight size={16} className="benefit-icon" />
                            <span>{hasPendingUpload ? "Auto-resumes your upload immediately after sign-in" : "10 free credits included instantly"}</span>
                        </div>
                        <div className="benefit-item">
                            <ArrowRight size={16} className="benefit-icon" />
                            <span>Step-by-step GCSE & A-Level exam marking</span>
                        </div>
                        <div className="benefit-item">
                            <ArrowRight size={16} className="benefit-icon" />
                            <span>Save and sync your marked papers & history</span>
                        </div>
                    </div>

                    <div className="guest-limit-actions">
                        <button className="guest-limit-primary-btn" onClick={() => handleAuthAction('signup')}>
                            <User size={18} />
                            <span>{hasPendingUpload ? "Continue Free to See Results" : "Sign up for free"}</span>
                        </button>
                        <button className="guest-limit-secondary-btn" onClick={() => handleAuthAction('login')}>
                            Already have an account? Sign In
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GuestLimitModal;
