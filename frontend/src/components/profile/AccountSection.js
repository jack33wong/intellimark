import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { User, LogOut, Edit3, Save, X, Mail } from 'lucide-react';
// Styles handled by UnifiedProfileModal.css

const AccountSection = () => {
    const { user, updateProfile, logout } = useAuth();
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState({
        displayName: user?.displayName || '',
    });
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [avatarError, setAvatarError] = useState(false);

    useEffect(() => {
        setFormData({
            displayName: user?.displayName || '',
        });
        setAvatarError(false);
    }, [user]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleSave = async () => {
        if (!formData.displayName.trim()) {
            setMessage('Display name is required');
            return;
        }

        setIsLoading(true);
        setMessage('');

        try {
            await updateProfile({
                displayName: formData.displayName.trim()
            });
            setMessage('Profile updated successfully');
            setIsEditing(false);
            // Clear message after 3s
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error('Error updating profile:', error);
            setMessage('Failed to update profile');
        } finally {
            setIsLoading(false);
        }
    };

    const handleCancel = () => {
        setFormData({
            displayName: user?.displayName || '',
        });
        setIsEditing(false);
        setMessage('');
    };

    return (
        <div className="account-container">
            {/* Profile Card Summary */}
            <div className="profile-card">
                <div className="profile-avatar-large">
                    {user?.photoURL && !avatarError ? (
                        <img
                            src={user.photoURL}
                            alt="Profile"
                            onError={() => setAvatarError(true)}
                        />
                    ) : (
                        <User size={32} />
                    )}
                </div>

                <div className="profile-info-primary">
                    <div className="profile-display-name">
                        {user?.displayName || 'User'}
                    </div>
                    <div className="profile-email-text">
                        {user?.email}
                    </div>
                </div>

                <div className="account-actions">
                    {!isEditing && (
                        <button
                            className="action-btn"
                            onClick={() => setIsEditing(true)}
                        >
                            <Edit3 size={14} />
                            <span>Edit</span>
                        </button>
                    )}

                    <button
                        className="action-btn danger"
                        onClick={logout}
                        title="Logout"
                    >
                        <LogOut size={14} />
                    </button>
                </div>
            </div>

            {/* Edit or Details View */}
            {isEditing ? (
                <div className="account-form">
                    <div className="form-group">
                        <label className="form-label">Display Name</label>
                        <input
                            type="text"
                            name="displayName"
                            className="form-input"
                            value={formData.displayName}
                            onChange={handleInputChange}
                            placeholder="Enter your name"
                            disabled={isLoading}
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Email Address</label>
                        <input
                            type="text"
                            className="form-input"
                            value={user?.email || ''}
                            disabled
                        />
                    </div>

                    <div className="account-actions" style={{ marginTop: '8px' }}>
                        <button
                            className="action-btn primary"
                            onClick={handleSave}
                            disabled={isLoading}
                        >
                            <Save size={14} />
                            <span>{isLoading ? 'Saving...' : 'Save Changes'}</span>
                        </button>
                        <button
                            className="action-btn"
                            onClick={handleCancel}
                            disabled={isLoading}
                        >
                            <X size={14} />
                            <span>Cancel</span>
                        </button>
                    </div>
                </div>
            ) : (
                <div className="account-details-grid">
                    <div className="detail-label">Display Name</div>
                    <div className="detail-value">{user?.displayName || 'Not Set'}</div>

                    <div className="detail-label">Email</div>
                    <div className="detail-value">{user?.email}</div>

                    <div className="detail-label">User ID</div>
                    <div className="detail-value" style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {user?.uid}
                    </div>
                </div>
            )}

            {message && (
                <div className={`settings-message ${message.includes('success') ? 'success' : 'error'}`}>
                    {message}
                </div>
            )}
        </div>
    );
};

export default AccountSection;
