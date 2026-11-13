import React, { useState } from 'react';
import { Copy, Check, HelpCircle, ExternalLink } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { SUPPORT_EMAIL } from '../../config/support';

const SupportSection = () => {
    const { user } = useAuth();
    const [copied, setCopied] = useState(false);

    const contextLines = [
        user?.uid ? `User ID: ${user.uid}` : null,
        typeof window !== 'undefined' ? `Page: ${window.location.pathname}` : null,
    ]
        .filter(Boolean)
        .join('\n');

    const gmailHref = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(SUPPORT_EMAIL)}&su=${encodeURIComponent('AI Marking Support Request')}&body=${encodeURIComponent([
        user?.email ? `Account Email: ${user.email}` : null,
        contextLines || null,
        'Issue / Question:',
        ''
    ].filter((v) => v !== null).join('\n'))}`;

    const handleCopyEmail = async () => {
        try {
            await navigator.clipboard.writeText(SUPPORT_EMAIL);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy support email:', err);
        }
    };

    return (
        <div className="account-container">
            <div className="profile-card">
                <div className="profile-avatar-large">
                    <HelpCircle size={28} />
                </div>
                <div className="profile-info-primary">
                    <div className="profile-display-name">Help &amp; Support</div>
                    <div className="profile-email-text">
                        Email us directly — typical reply within 24–48 hours.
                    </div>
                </div>
            </div>

            <div className="account-details-grid">
                <div className="detail-label">Support Email</div>
                <div className="detail-value">
                    {SUPPORT_EMAIL}
                </div>

                <div className="detail-label">What to Include</div>
                <div className="detail-value" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Your account email, paper code (if any), and a brief description or screenshot of the issue.
                </div>
            </div>

            <div className="account-actions" style={{ marginTop: '16px', flexWrap: 'wrap' }}>
                <a
                    href={gmailHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="action-btn primary"
                    style={{ textDecoration: 'none' }}
                >
                    <ExternalLink size={14} />
                    <span>Open in Gmail</span>
                </a>
                <button
                    type="button"
                    className="action-btn"
                    onClick={handleCopyEmail}
                >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copied ? 'Copied!' : 'Copy Email'}</span>
                </button>
            </div>
        </div>
    );
};

export default SupportSection;
