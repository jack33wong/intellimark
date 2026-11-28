import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, Sparkles, ArrowRight, X, Loader2 } from 'lucide-react';
import { signInWithPopup, getAdditionalUserInfo } from 'firebase/auth';
import { auth, googleProvider } from '../../config/firebase';
import { fireAdsSignupConversion } from '../../utils/analytics';
import { analyticsService } from '../../services/AnalyticsService';
import {
    markAuthWallShown,
    markAuthWallCtaClicked,
    markAuthWallDismissed,
    markAuthWallConverted,
    getLatestPreInspectSessionId
} from '../../utils/funnelTracker';
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
    fileCount?: number;
    preInspectSessionId?: string | null;
    onSignup?: (mode?: 'signup' | 'login') => Promise<void> | void;
    onDirectAuthSuccess?: () => void;
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
    fileCount = 0,
    preInspectSessionId = null,
    onSignup,
    onDirectAuthSuccess
}) => {
    const navigate = useNavigate();
    const outcomeFiredRef = useRef(false);
    const wasOpenRef = useRef(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);

    const normalizedType = (requestType || 'marking').toLowerCase().replace(/[-_]/g, '');
    const isMarkingTrigger =
        !normalizedType.includes('modelanswer') &&
        !normalizedType.includes('markingscheme') &&
        !normalizedType.includes('markscheme');

    useEffect(() => {
        if (isOpen && !wasOpenRef.current) {
            outcomeFiredRef.current = false;
            setAuthError(null);
            setIsGoogleLoading(false);
            if (isMarkingTrigger) {
                markAuthWallShown({
                    trigger: 'marking_submit',
                    fileCount: fileCount || (hasPendingUpload ? 1 : 0),
                    preInspectSessionId: preInspectSessionId || getLatestPreInspectSessionId() || null
                });
            }
        }
        wasOpenRef.current = isOpen;
    }, [isOpen, isMarkingTrigger, fileCount, hasPendingUpload, preInspectSessionId]);

    const handleDismiss = useCallback((dismissMethod: 'close_button' | 'backdrop' | 'escape') => {
        if (isGoogleLoading) return;
        if (isMarkingTrigger && !outcomeFiredRef.current) {
            outcomeFiredRef.current = true;
            markAuthWallDismissed(dismissMethod, 'interstitial');
        }
        onClose();
    }, [isGoogleLoading, isMarkingTrigger, onClose]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                handleDismiss('escape');
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, handleDismiss]);

    if (!isOpen) return null;

    // Support both prop names and default to 0 (since signup is required before first use)
    const effectiveLimit = limit ?? usageLimit ?? 0;
    const content = getModalContent(requestType, hasPendingUpload, effectiveLimit);

    const handleGoogleQuickAuth = async () => {
        if (isGoogleLoading) return;
        if (isMarkingTrigger) {
            markAuthWallCtaClicked(
                'interstitial',
                'continue_with_google',
                preInspectSessionId || getLatestPreInspectSessionId() || null
            );
        }
        if (!auth || !googleProvider) {
            setAuthError('Google sign-in is temporarily unavailable. Please continue with email.');
            return;
        }

        setIsGoogleLoading(true);
        setAuthError(null);
        try {
            // Must invoke signInWithPopup directly in the click handler (no prior await) to avoid browser popup blockers
            const result = await signInWithPopup(auth, googleProvider);
            outcomeFiredRef.current = true;

            const additionalInfo = getAdditionalUserInfo(result);
            if (additionalInfo?.isNewUser && result.user?.email) {
                fireAdsSignupConversion(result.user.email);
            }
            analyticsService.logSignUp('google');
            markAuthWallConverted('google', result.user?.uid || null);

            if (onDirectAuthSuccess) {
                onDirectAuthSuccess();
            } else {
                onClose();
            }
        } catch (error: any) {
            const code = error?.code || '';
            if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
                setAuthError('Google sign-in was cancelled. Try again or continue with email.');
            } else if (code === 'auth/popup-blocked') {
                setAuthError('Popup was blocked by your browser. Please allow popups or continue with email.');
            } else {
                setAuthError('Could not complete Google sign-in. Please try again or continue with email.');
            }
        } finally {
            setIsGoogleLoading(false);
        }
    };

    const handleAuthAction = async (mode: 'signup' | 'login') => {
        outcomeFiredRef.current = true;
        if (isMarkingTrigger) {
            markAuthWallCtaClicked(
                'interstitial',
                mode === 'signup' ? 'continue_with_email' : 'already_have_account_sign_in',
                preInspectSessionId || getLatestPreInspectSessionId() || null
            );
        }
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

    const pendingCount = fileCount || (hasPendingUpload ? 1 : 0);
    const trustNote = hasPendingUpload && pendingCount > 0
        ? `Free · No credit card · Auto-marks your ${pendingCount === 1 ? 'uploaded file' : `${pendingCount} uploaded files`}`
        : 'Free · No credit card required · 10 free credits included';

    return (
        <div
            className="guest-limit-modal-overlay"
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    handleDismiss('backdrop');
                }
            }}
        >
            <div className="guest-limit-modal-container">
                <button className="guest-limit-modal-close" onClick={() => handleDismiss('close_button')} aria-label="Close" disabled={isGoogleLoading}>
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

                    {authError && (
                        <div className="guest-limit-auth-error" role="alert">
                            {authError}
                        </div>
                    )}

                    <div className="guest-limit-actions">
                        <button
                            type="button"
                            className="guest-limit-google-btn"
                            onClick={handleGoogleQuickAuth}
                            disabled={isGoogleLoading}
                        >
                            {isGoogleLoading ? (
                                <Loader2 size={18} className="guest-limit-spinner" />
                            ) : (
                                <svg className="guest-limit-google-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                                </svg>
                            )}
                            <span>{isGoogleLoading ? 'Signing in...' : 'Continue with Google'}</span>
                        </button>

                        <div className="guest-limit-trust-note">{trustNote}</div>

                        <button
                            type="button"
                            className="guest-limit-secondary-btn"
                            onClick={() => handleAuthAction('signup')}
                            disabled={isGoogleLoading}
                        >
                            <Mail size={16} />
                            <span>Continue with Email</span>
                        </button>

                        <button
                            type="button"
                            className="guest-limit-text-link"
                            onClick={() => handleAuthAction('login')}
                            disabled={isGoogleLoading}
                        >
                            Already have an account? Sign In
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GuestLimitModal;
