import React from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, ArrowRight, X } from 'lucide-react';
import EventManager from '../../utils/eventManager';
import './GuestLimitModal.css';

interface GuestLimitModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const GuestLimitModal: React.FC<GuestLimitModalProps> = ({ isOpen, onClose }) => {
    const navigate = useNavigate();

    if (!isOpen) return null;

    const handleSignUp = () => {
        onClose();
        EventManager.dispatch('OPEN_AUTH_MODAL', { mode: 'signup' });
    };

    const handleSignIn = () => {
        onClose();
        navigate('/login');
    };

    return (
        <div className="guest-limit-modal-overlay">
            <div className="guest-limit-modal-container">
                <button className="guest-limit-modal-close" onClick={onClose}>
                    <X size={20} />
                </button>

                <div className="guest-limit-modal-content">
                    <div className="guest-limit-icon-wrapper">
                        <Lock size={32} className="guest-limit-icon" />
                    </div>

                    <h2>Guest Limit Reached</h2>
                    <p>
                        You've reached the free limit for guest users.
                        Sign up for a free account to continue marking papers and save your history.
                    </p>

                    <div className="guest-limit-benefits">
                        <div className="benefit-item">
                            <ArrowRight size={16} className="benefit-icon" />
                            <span>Save and sync your history</span>
                        </div>
                        <div className="benefit-item">
                            <ArrowRight size={16} className="benefit-icon" />
                            <span>Higher usage limits</span>
                        </div>
                        <div className="benefit-item">
                            <ArrowRight size={16} className="benefit-icon" />
                            <span>Detailed analysis & insights</span>
                        </div>
                    </div>

                    <div className="guest-limit-actions">
                        <button className="guest-limit-primary-btn" onClick={handleSignUp}>
                            <User size={18} />
                            <span>Sign up for free</span>
                        </button>
                        <button className="guest-limit-secondary-btn" onClick={handleSignIn}>
                            Already have an account? Sign In
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GuestLimitModal;
