import React from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, Sparkles, ArrowRight, X } from 'lucide-react';
import './GuestLimitModal.css';

export type GuestRequestType = 'marking' | 'model_answer' | 'marking_scheme' | 'single' | 'multi' | string;

interface GuestLimitModalProps {
    isOpen: boolean;
    onClose: () => void;
    limit?: number;
    usageLimit?: number;
    usageCount?: number;
    resetAt?: string | null;
    hasPendingUpload?: boolean;
    requestType?: GuestRequestType;
    onSignup?: (mode?: 'signup' | 'login') => Promise<void> | void;
}

function getModalContent(requestType: string | undefined, hasPendingUpload: boolean, effectiveLimit: number) {
    const normalized = (requestType || 'marking').toLowerCase().replace(/[-_]/g, '');

    if (normalized.includes('modelanswer')) {
        return {
            title: hasPendingUpload
                ? "Your Model Answer is Ready to Generate!"
                : effectiveLimit === 0
                    ? "Unlock Free Model Answers"
                    : "Guest Limit Reached",
            description: hasPendingUpload
                ? "Create a free account in seconds to generate your model answer immediately and get 10 free credits."
                : effectiveLimit === 0
                    ? "Create a free account to unlock our AI model answers, marking tools, and get 10 free credits instantly."
                    : "You've reached the free limit for guest users. Sign up for a free account to continue generating model answers and save your history.",
            benefit1: hasPendingUpload
                ? "Auto-generates your model answer immediately after sign-in"
                : "10 free credits included instantly",
            benefit2: "Step-by-step GCSE & A-Level exemplar answers",
            benefit3: "Save and sync your model answers & history",
            primaryButton: hasPendingUpload
                ? "Continue Free to See Model Answer"
                : "Sign up for free"
        };
    }

    if (normalized.includes('markingscheme') || normalized.includes('markscheme')) {
        return {
            title: hasPendingUpload
                ? "Your Mark Scheme is Ready to Explain!"
                : effectiveLimit === 0
                    ? "Unlock Free Mark Scheme Explanations"
                    : "Guest Limit Reached",
            description: hasPendingUpload
                ? "Create a free account in seconds to explain your mark scheme immediately and get 10 free credits."
                : effectiveLimit === 0
                    ? "Create a free account to unlock our AI mark scheme explanations, marking tools, and get 10 free credits instantly."
                    : "You've reached the free limit for guest users. Sign up for a free account to continue explaining mark schemes and save your history.",
            benefit1: hasPendingUpload
                ? "Auto-explains your mark scheme immediately after sign-in"
                : "10 free credits included instantly",
            benefit2: "Step-by-step GCSE & A-Level marking scheme breakdown",
            benefit3: "Save and sync your mark schemes & history",
            primaryButton: hasPendingUpload
                ? "Continue Free to See Mark Scheme"
                : "Sign up for free"
        };
    }

    // Default: marking
    return {
        title: hasPendingUpload
            ? "Your Work is Ready to Mark!"
            : effectiveLimit === 0
                ? "Unlock Free AI Marking"
                : "Guest Limit Reached",
        description: hasPendingUpload
            ? "Create a free account in seconds to grade your uploaded work immediately and get 10 free credits."
            : effectiveLimit === 0
                ? "Create a free account to unlock our AI marking tools, model answers, and get 10 free credits instantly."
                : "You've reached the free limit for guest users. Sign up for a free account to continue marking papers and save your history.",
        benefit1: hasPendingUpload
            ? "Auto-resumes your upload immediately after sign-in"
            : "10 free credits included instantly",
        benefit2: "Step-by-step GCSE & A-Level exam marking",
        benefit3: "Save and sync your marked papers & history",
        primaryButton: hasPendingUpload
            ? "Continue Free to See Results"
            : "Sign up for free"
    };
}

const GuestLimitModal: React.FC<GuestLimitModalProps> = ({
    isOpen,
    onClose,
    limit,
    usageLimit,
    hasPendingUpload = false,
    requestType = 'marking',
    onSignup
}) => {
    const navigate = useNavigate();

    if (!isOpen) return null;

    // Support both prop names and default to 0 (since signup is required before first use)
    const effectiveLimit = limit ?? usageLimit ?? 0;
    const content = getModalContent(requestType, hasPendingUpload, effectiveLimit);

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

                    <h2>{content.title}</h2>
                    <p>{content.description}</p>

                    <div className="guest-limit-benefits">
                        <div className="benefit-item">
                            <ArrowRight size={16} className="benefit-icon" />
                            <span>{content.benefit1}</span>
                        </div>
                        <div className="benefit-item">
                            <ArrowRight size={16} className="benefit-icon" />
                            <span>{content.benefit2}</span>
                        </div>
                        <div className="benefit-item">
                            <ArrowRight size={16} className="benefit-icon" />
                            <span>{content.benefit3}</span>
                        </div>
                    </div>

                    <div className="guest-limit-actions">
                        <button className="guest-limit-primary-btn" onClick={() => handleAuthAction('signup')}>
                            <User size={18} />
                            <span>{content.primaryButton}</span>
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
