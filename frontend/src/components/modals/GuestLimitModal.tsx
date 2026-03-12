import React, { useEffect } from 'react';
import { X, Lock, Clock, TrendingUp } from 'lucide-react';
import './GuestLimitModal.css';

interface GuestLimitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSignup: () => void;
  usageCount?: number;
  usageLimit?: number;
  resetAt?: string | null;
}

function formatResetTime(resetAt: string | null): string {
  if (!resetAt) return 'in 24 hours';
  const resetDate = new Date(resetAt);
  const now = new Date();
  const diffMs = resetDate.getTime() - now.getTime();
  if (diffMs <= 0) return 'soon';

  const totalMins = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;

  if (hours > 0 && mins > 0) return `in ${hours}h ${mins}m`;
  if (hours > 0) return `in ${hours}h`;
  return `in ${mins}m`;
}

const GuestLimitModal: React.FC<GuestLimitModalProps> = ({
  isOpen,
  onClose,
  onSignup,
  usageCount,
  usageLimit,
  resetAt,
}) => {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const count = usageCount ?? 0;
  const limit = usageLimit ?? 5;
  const usedPercent = Math.min(100, Math.round((count / limit) * 100));
  const resetLabel = formatResetTime(resetAt ?? null);

  return (
    <div className="guest-limit-overlay" onClick={onClose}>
      <div className="guest-limit-modal" onClick={e => e.stopPropagation()}>
        {/* Close button */}
        <button className="guest-limit-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        {/* Icon */}
        <div className="guest-limit-icon-wrap">
          <Lock size={28} />
        </div>

        <h2 className="guest-limit-title">Guest Limit Reached</h2>
        <p className="guest-limit-subtitle">
          You've used all your free guest requests. Sign up for free to continue.
        </p>

        {/* Usage stats bar */}
        <div className="guest-limit-stats">
          <div className="guest-limit-stat-row">
            <TrendingUp size={14} />
            <span>Usage</span>
            <span className="guest-limit-stat-value"><strong>{count}</strong> / {limit} requests</span>
          </div>

          <div className="guest-limit-bar-track">
            <div
              className="guest-limit-bar-fill"
              style={{ width: `${usedPercent}%` }}
            />
          </div>

          <div className="guest-limit-stat-row">
            <Clock size={14} />
            <span>Resets</span>
            <span className="guest-limit-stat-value">{resetLabel}</span>
          </div>
        </div>

        {/* Actions */}
        <button className="guest-limit-cta" onClick={onSignup}>
          Create Free Account
        </button>
        <button className="guest-limit-secondary" onClick={onClose}>
          Maybe later
        </button>
      </div>
    </div>
  );
};

export default GuestLimitModal;
