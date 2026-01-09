import React from 'react';
import { createPortal } from 'react-dom';
import { X, AlertCircle, CheckCircle, Info, ArrowRight } from 'lucide-react';
import './Modal.css';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'primary' | 'danger' | 'success' | 'warning';
    icon?: React.ReactNode;
    showCancel?: boolean;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'primary',
    icon,
    showCancel = true
}) => {
    if (!isOpen) return null;


    // Variant styles
    const getVariantStyles = () => {
        switch (variant) {
            case 'danger':
                return {
                    iconBg: 'rgba(239, 68, 68, 0.1)',
                    iconColor: '#ef4444',
                    buttonBg: '#ef4444',
                    buttonHover: '#dc2626'
                };
            case 'success':
                return {
                    iconBg: 'rgba(34, 197, 94, 0.1)',
                    iconColor: '#22c55e',
                    buttonBg: '#22c55e',
                    buttonHover: '#16a34a'
                };
            case 'warning':
                return {
                    iconBg: 'rgba(245, 158, 11, 0.1)',
                    iconColor: '#f59e0b',
                    buttonBg: '#f59e0b',
                    buttonHover: '#d97706'
                };
            case 'primary':
            default:
                return {
                    iconBg: 'rgba(59, 130, 246, 0.1)',
                    iconColor: '#3b82f6',
                    buttonBg: '#3b82f6',
                    buttonHover: '#2563eb'
                };
        }
    };

    const styles = getVariantStyles();

    // Default icons if none provided
    const getIcon = () => {
        if (icon) return icon;
        switch (variant) {
            case 'danger': return <AlertCircle size={24} />;
            case 'success': return <CheckCircle size={24} />;
            case 'warning': return <AlertCircle size={24} />;
            case 'primary': return <Info size={24} />;
            default: return <Info size={24} />;
        }
    };

    return createPortal(
        <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 999999 }}>
            <div
                className="modal modal-small"
                onClick={e => e.stopPropagation()}
                style={{
                    maxWidth: '440px',
                    width: '90%',
                    padding: '0',
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'var(--background-menu-white, #fff)',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                }}
            >
                <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Header with Icon */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', gap: '16px' }}>
                            <div style={{
                                width: '48px',
                                height: '48px',
                                borderRadius: '12px',
                                background: styles.iconBg,
                                color: styles.iconColor,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0
                            }}>
                                {getIcon()}
                            </div>
                            <div style={{ flex: 1 }}>
                                <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '600', color: 'var(--text-primary, #111)' }}>
                                    {title}
                                </h3>
                                <p style={{ margin: '0', fontSize: '14px', lineHeight: '1.5', color: 'var(--text-secondary, #666)', textAlign: 'left', whiteSpace: 'pre-wrap' }}>
                                    {message}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--text-tertiary, #999)',
                                cursor: 'pointer',
                                padding: '4px',
                                flexShrink: 0
                            }}
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '12px', marginTop: '8px', justifyContent: 'flex-end' }}>
                        {showCancel && (
                            <button
                                onClick={onClose}
                                style={{
                                    padding: '10px 16px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--border-color, #e5e7eb)',
                                    background: 'transparent',
                                    color: 'var(--text-secondary, #444)',
                                    fontSize: '14px',
                                    fontWeight: '500',
                                    cursor: 'pointer'
                                }}
                            >
                                {cancelText}
                            </button>
                        )}
                        <button
                            onClick={onConfirm}
                            style={{
                                padding: '10px 16px',
                                borderRadius: '8px',
                                border: 'none',
                                background: styles.buttonBg,
                                color: 'white',
                                fontSize: '14px',
                                fontWeight: '500',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                            }}
                        >
                            {confirmText}
                            <ArrowRight size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </div >,
        document.body
    );
};

export default ConfirmationModal;
