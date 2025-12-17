import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { User, Mail, Shield, Save, Edit3, X, LogOut } from 'lucide-react';
import './SettingsModal.css';

const SettingsModal = ({ isOpen, onClose }) => {
  const { user, updateProfile, logout } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    displayName: user?.displayName || '',
    email: user?.email || ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleLogout = () => {
    logout();
    onClose(); // Close modal after logout
  };

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
      setMessage('Profile updated successfully!');
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating profile:', error);
      setMessage('Failed to update profile. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setFormData({
      displayName: user?.displayName || '',
      email: user?.email || ''
    });
    setIsEditing(false);
    setMessage('');
  };

  const handleEdit = () => {
    setIsEditing(true);
    setMessage('');
  };

  if (!isOpen) return null;

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="settings-modal-header">
          <div className="settings-modal-title">
            <Shield size={24} />
            <h2>Settings</h2>
          </div>
          <button className="settings-modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Modal Content */}
        <div className="settings-modal-content">
          {/* Profile Picture Section */}
          <div className="settings-section">
            <div className="settings-section-header">
              <h3>Profile Picture</h3>
            </div>
            <div className="settings-profile-picture">
              <div className="settings-avatar">
                {user?.photoURL ? (
                  <img src={user.photoURL} alt="Profile" />
                ) : (
                  <User size={40} />
                )}
              </div>
              <button
                className="settings-logout-icon"
                onClick={handleLogout}
                title="Logout"
              >
                <LogOut size={20} />
              </button>
              <p className="settings-profile-note">
                Profile pictures are managed by your authentication provider
              </p>
            </div>
          </div>

          {/* Personal Information Section */}
          <div className="settings-section">
            <div className="settings-section-header">
              <h3>Personal Information</h3>
              {!isEditing && (
                <button className="settings-edit-button" onClick={handleEdit}>
                  <Edit3 size={16} />
                  Edit
                </button>
              )}
            </div>

            {isEditing ? (
              <div className="settings-form">
                <div className="settings-form-group">
                  <label htmlFor="displayName">
                    <User size={16} />
                    Display Name
                  </label>
                  <input
                    type="text"
                    id="displayName"
                    name="displayName"
                    value={formData.displayName}
                    onChange={handleInputChange}
                    placeholder="Enter your display name"
                    disabled={isLoading}
                  />
                </div>

                <div className="settings-form-group">
                  <label htmlFor="email">
                    <Mail size={16} />
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    disabled
                    className="settings-disabled-input"
                  />
                  <small>Email cannot be changed</small>
                </div>

                <div className="settings-form-actions">
                  <button
                    className="settings-save-button"
                    onClick={handleSave}
                    disabled={isLoading}
                  >
                    <Save size={16} />
                    {isLoading ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    className="settings-cancel-button"
                    onClick={handleCancel}
                    disabled={isLoading}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="settings-info">
                <div className="settings-info-item">
                  <span className="settings-info-label">Display Name:</span>
                  <span className="settings-info-value">{user?.displayName || 'Not set'}</span>
                </div>
                <div className="settings-info-item">
                  <span className="settings-info-label">Email:</span>
                  <span className="settings-info-value">{user?.email || 'Not available'}</span>
                </div>
              </div>
            )}

            {message && (
              <div className={`settings-message ${message.includes('success') ? 'success' : 'error'}`}>
                {message}
              </div>
            )}
          </div>



        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
