import React, { useState } from 'react';
import { Star, X } from 'lucide-react';
import { useTelemetry } from '../../hooks/useTelemetry';
import '../common/InsufficientCreditsModal.css'; // Re-use styling

interface MarkingFeedbackModalProps {
    isOpen: boolean;
    onClose: () => void;
    sessionId: string;
    modelUsed: string;
}

const MarkingFeedbackModal: React.FC<MarkingFeedbackModalProps> = ({ isOpen, onClose, sessionId, modelUsed }) => {
    const { logEvent } = useTelemetry();
    const [rating, setRating] = useState(0);
    const [submitted, setSubmitted] = useState(false);

    if (!isOpen) return null;

    const handleRating = (stars: number) => {
        setRating(stars);
        if (stars >= 4) {
            logEvent('marking_feedback', { sessionId, modelUsed, stars, tags: [] });
            setSubmitted(true);
            setTimeout(() => onClose(), 2000);
        }
    };

    const submitDetailedFeedback = (tag: string) => {
        logEvent('marking_feedback', { sessionId, modelUsed, stars: rating, tags: [tag] });
        setSubmitted(true);
        setTimeout(() => onClose(), 2000);
    };

    return (
        <div className="credits-modal-overlay" onClick={onClose}>
            <div className="credits-modal-container" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
                <button className="credits-modal-close" onClick={onClose} aria-label="Close">
                    <X size={20} />
                </button>
                <div className="credits-modal-content">
                    {submitted ? (
                        <>
                            <h2 className="credits-modal-title" style={{ marginTop: '16px' }}>Thank You!</h2>
                            <p className="credits-modal-description">Your feedback helps us train the AI to be better.</p>
                        </>
                    ) : (
                        <>
                            <h2 className="credits-modal-title" style={{ marginTop: '16px' }}>Rate the AI Marking</h2>
                            <p className="credits-modal-description">How accurate was the grading for this paper?</p>
                            
                            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '24px' }}>
                                {[1, 2, 3, 4, 5].map((star) => (
                                    <Star 
                                        key={star} 
                                        size={32} 
                                        onClick={() => handleRating(star)}
                                        fill={rating >= star ? '#fbbf24' : 'none'}
                                        color={rating >= star ? '#fbbf24' : '#d1d5db'}
                                        style={{ cursor: 'pointer', transition: '0.2s' }}
                                    />
                                ))}
                            </div>
                            
                            {rating > 0 && rating <= 3 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                                    <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px', textAlign: 'center' }}>What went wrong?</h3>
                                    <button className="credits-cancel-btn" style={{ width: '100%' }} onClick={() => submitDetailedFeedback('Missed student handwriting')}>Missed student handwriting</button>
                                    <button className="credits-cancel-btn" style={{ width: '100%' }} onClick={() => submitDetailedFeedback('Calculated wrong total score')}>Calculated wrong total score</button>
                                    <button className="credits-cancel-btn" style={{ width: '100%' }} onClick={() => submitDetailedFeedback('AI hallucinated steps')}>AI made up steps/hallucinated</button>
                                    <button className="credits-cancel-btn" style={{ width: '100%' }} onClick={() => submitDetailedFeedback('Marking was too strict')}>Marking was too strict</button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MarkingFeedbackModal;
