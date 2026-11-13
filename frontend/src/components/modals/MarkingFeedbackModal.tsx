import React, { useState, useRef, useEffect } from 'react';
import { X, Check, ThumbsDown } from 'lucide-react';
import { useTelemetry } from '../../hooks/useTelemetry';
import { SUPPORT_EMAIL, getSupportMailto } from '../../config/support';
import './MarkingFeedbackModal.css';

interface MarkingFeedbackModalProps {
    isOpen: boolean;
    onClose: () => void;
    sessionId: string;
    modelUsed: string;
    onRatingChange?: (rating: number) => Promise<void> | void;
}

interface FeedbackReason {
    id: string;
    label: string;
    description: string;
}

const FEEDBACK_REASONS: FeedbackReason[] = [
    {
        id: 'marking_accuracy',
        label: 'Marking accuracy or score calculation',
        description: 'Marks were too harsh, lenient, or calculated incorrectly'
    },
    {
        id: 'missed_handwriting',
        label: 'Missed student handwriting or working',
        description: 'Overlooked diagrams, illegible steps, or missed answer lines'
    },
    {
        id: 'wrong_scheme',
        label: 'Wrong question or marking scheme matched',
        description: 'Graded against the wrong paper, question number, or criteria'
    },
    {
        id: 'slow_response',
        label: 'Slow processing speed',
        description: 'Marking took longer than expected to complete'
    },
    {
        id: 'vague_feedback',
        label: 'Unclear or generic examiner feedback',
        description: 'Feedback was vague, repetitive, or lacked constructive guidance'
    },
    {
        id: 'other',
        label: 'Other issue',
        description: 'Something else went wrong (enter details below)'
    }
];

const MarkingFeedbackModal: React.FC<MarkingFeedbackModalProps> = ({
    isOpen,
    onClose,
    sessionId,
    modelUsed,
    onRatingChange
}) => {
    const { logEvent } = useTelemetry();
    const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
    const [customComment, setCustomComment] = useState<string>('');
    const [submitted, setSubmitted] = useState<boolean>(false);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    // Reset fields whenever modal opens
    useEffect(() => {
        if (isOpen) {
            setSelectedReasons([]);
            setCustomComment('');
            setSubmitted(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const toggleReason = (id: string) => {
        setSelectedReasons(prev => {
            const isSelected = prev.includes(id);
            const next = isSelected ? prev.filter(r => r !== id) : [...prev, id];
            if (!isSelected && id === 'other') {
                setTimeout(() => textareaRef.current?.focus(), 80);
            }
            return next;
        });
    };

    const handleSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        try {
            await logEvent('marking_feedback', {
                sessionId,
                modelUsed,
                stars: 1,
                vote: 'down',
                reasons: selectedReasons,
                comment: customComment.trim(),
                tags: [...selectedReasons, ...(customComment.trim() ? ['custom_comment'] : [])]
            });
            if (onRatingChange) {
                await onRatingChange(1);
            }
            setSubmitted(true);
            setTimeout(() => {
                onClose();
            }, 1600);
        } catch (err) {
            console.error('Failed to submit detailed feedback:', err);
            onClose();
        }
    };

    return (
        <div className="feedback-modal-overlay" onClick={onClose}>
            <div className="feedback-modal-container" onClick={(e) => e.stopPropagation()}>
                <button className="feedback-modal-close" onClick={onClose} aria-label="Close">
                    <X size={18} />
                </button>

                {submitted ? (
                    <div className="feedback-success-state">
                        <div className="feedback-success-icon">
                            <Check size={28} />
                        </div>
                        <h2 className="feedback-modal-title" style={{ justifyContent: 'center', marginBottom: '8px' }}>
                            Thank You for Your Feedback!
                        </h2>
                        <p className="feedback-modal-subtitle" style={{ textAlign: 'center', maxWidth: '340px' }}>
                            Your input directly helps us improve our AI marking accuracy, handwriting recognition, and grading speed.
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="feedback-modal-header">
                            <h2 className="feedback-modal-title">
                                <ThumbsDown size={18} color="#ef4444" style={{ marginTop: '1px' }} />
                                <span>Provide Feedback</span>
                            </h2>
                            <p className="feedback-modal-subtitle">
                                Why wasn't this response helpful? Choose all that apply:
                            </p>
                        </div>

                        {/* Polished Reasons Grid */}
                        <div className="feedback-reasons-grid">
                            {FEEDBACK_REASONS.map((reason) => {
                                const isSelected = selectedReasons.includes(reason.id);
                                return (
                                    <div
                                        key={reason.id}
                                        className={`feedback-reason-chip ${isSelected ? 'selected' : ''}`}
                                        onClick={() => toggleReason(reason.id)}
                                    >
                                        <div className="feedback-chip-checkbox">
                                            {isSelected && <Check size={12} color="#ffffff" strokeWidth={3} />}
                                        </div>
                                        <div>
                                            <div className="feedback-chip-label">{reason.label}</div>
                                            <div className="feedback-chip-desc">{reason.description}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Optional Custom Input */}
                        <div className="feedback-textarea-group">
                            <label className="feedback-textarea-label" htmlFor="feedback-comment">
                                Additional details (optional):
                            </label>
                            <textarea
                                id="feedback-comment"
                                ref={textareaRef}
                                className="feedback-textarea"
                                rows={3}
                                value={customComment}
                                onChange={(e) => setCustomComment(e.target.value)}
                                placeholder="What specifically could be improved about this response?"
                            />
                        </div>

                        {/* Actions */}
                        <div className="feedback-modal-actions">
                            <button
                                type="button"
                                className="feedback-btn-cancel"
                                onClick={onClose}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="feedback-btn-submit"
                                onClick={() => handleSubmit()}
                            >
                                Submit Feedback
                            </button>
                        </div>

                        <p style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-secondary, #64748b)', textAlign: 'center' }}>
                            Need a reply or billing help? Email{' '}
                            <a
                                href={getSupportMailto({
                                    subject: 'AI Marking Support',
                                    context: sessionId ? `Session ID: ${sessionId}` : undefined
                                })}
                                style={{ color: 'inherit', textDecoration: 'underline' }}
                            >
                                {SUPPORT_EMAIL}
                            </a>
                        </p>
                    </>
                )}
            </div>
        </div>
    );
};

export default MarkingFeedbackModal;
