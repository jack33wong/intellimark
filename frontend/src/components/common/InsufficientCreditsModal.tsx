import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CreditCard, ChevronRight, X } from 'lucide-react';
import './InsufficientCreditsModal.css';

interface InsufficientCreditsModalProps {
    isOpen: boolean;
    onClose: () => void;
    remainingCredits: number;
}

const InsufficientCreditsModal: React.FC<InsufficientCreditsModalProps> = ({
    isOpen,
    onClose,
    remainingCredits
}) => {
    const navigate = useNavigate();

    if (!isOpen) return null;

    const handleUpgrade = () => {
        navigate('/pricing', { state: { fromApp: true } });
        onClose();
    };

    return (
        <div className="credits-modal-overlay" onClick={onClose}>
            <div className="credits-modal-container" onClick={(e) => e.stopPropagation()}>
                <button className="credits-modal-close" onClick={onClose} aria-label="Close">
                    <X size={20} />
                </button>

                <div className="credits-modal-content">
                    <div className="credits-modal-icon-wrapper">
                        <div className="credits-modal-icon-bg">
                            <AlertCircle size={32} className="credits-alert-icon" />
                        </div>
                    </div>

                    <h2 className="credits-modal-title">Insufficient Credits</h2>
                    <p className="credits-modal-description">
                        You currently have <span className="credits-negative-value">{remainingCredits.toFixed(2)}</span> credits remaining.
                        To continue using our AI features, please upgrade your plan or top up your credits.
                    </p>

                    <div className="credits-current-status">
                        <div className="status-label">Current Balance</div>
                        <div className="status-value negative">{remainingCredits.toFixed(2)}</div>
                    </div>

                    <div className="credits-modal-actions">
                        <button className="credits-upgrade-btn" onClick={handleUpgrade}>
                            <CreditCard size={18} />
                            <span>Upgrade My Plan</span>
                            <ChevronRight size={16} className="btn-chevron" />
                        </button>
                        <button className="credits-cancel-btn" onClick={onClose}>
                            Maybe later
                        </button>
                    </div>
                </div>

                <div className="credits-modal-footer">
                    <p>Get exclusive features and priority processing with our Ultra plan.</p>
                </div>
            </div>
        </div>
    );
};

export default InsufficientCreditsModal;
