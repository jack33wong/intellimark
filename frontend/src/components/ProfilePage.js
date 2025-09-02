import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { User, Mail, Shield, Save, Edit3, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './ProfilePage.css';

const ProfilePage = () => {
  const { user, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    displayName: user?.displayName || '',
    email: user?.email || ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleHomeClick = () => {
    navigate('/');
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSave = async () => {
    setIsLoading(true);
    setMessage('');
    
    try {
      const updates = {};
      if (formData.displayName !== user?.displayName) {
        updates.displayName = formData.displayName;
      }
      
      if (Object.keys(updates).length > 0) {
        await updateProfile(updates);
        setMessage('Profile updated successfully!');
        setIsEditing(false);
      }
    } catch (error) {
      setMessage(`Error updating profile: ${error.message}`);
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

  return (
    <div className="profile-page">
      {/* Header with IntelliMark Logo */}
      <div className="profile-header-nav">
        <div className="profile-logo" onClick={handleHomeClick}>
          <Home size={24} />
          <span>IntelliMark</span>
        </div>
      </div>
      
      <div className="profile-container">
        <div className="profile-header">
          <h1>Profile Settings</h1>
          <p>Manage your account information and preferences</p>
        </div>

        <div className="profile-content">
          {/* Profile Picture Section */}
          <div className="profile-section">
            <h3>Profile Picture</h3>
            <div className="profile-picture">
              {user?.photoURL ? (
                <img src={user.photoURL} alt="Profile" />
              ) : (
                <div className="profile-picture-placeholder">
                  <User size={48} />
                </div>
              )}
            </div>
            <p className="profile-picture-note">
              Profile pictures are managed through your Google/Facebook account
            </p>
          </div>

          {/* Account Information Section */}
          <div className="profile-section">
            <div className="section-header">
              <h3>Account Information</h3>
              <button
                className="edit-button"
                onClick={() => setIsEditing(!isEditing)}
                disabled={isLoading}
              >
                {isEditing ? <Save size={16} /> : <Edit3 size={16} />}
                {isEditing ? 'Save' : 'Edit'}
              </button>
            </div>

            <div className="form-group">
              <label>
                <User size={16} />
                Display Name
              </label>
              <input
                type="text"
                name="displayName"
                value={formData.displayName}
                onChange={handleInputChange}
                disabled={!isEditing}
                placeholder="Enter your display name"
              />
            </div>

            <div className="form-group">
              <label>
                <Mail size={16} />
                Email Address
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                disabled={true}
                placeholder="Email address"
                className="disabled"
              />
              <small>Email cannot be changed</small>
            </div>

            {isEditing && (
              <div className="form-actions">
                <button
                  className="save-button"
                  onClick={handleSave}
                  disabled={isLoading}
                >
                  {isLoading ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  className="cancel-button"
                  onClick={handleCancel}
                  disabled={isLoading}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Account Status Section */}
          <div className="profile-section">
            <h3>Account Status</h3>
            <div className="status-item">
              <Shield size={16} />
              <span>Account Type: {user?.isAdmin ? 'Administrator' : 'Standard User'}</span>
              {user?.isAdmin && (
                <span className="admin-badge">Admin</span>
              )}
            </div>
            <div className="status-item">
              <User size={16} />
              <span>User ID: {user?.uid}</span>
            </div>
          </div>

          {/* Message Display */}
          {message && (
            <div className={`message ${message.includes('Error') ? 'error' : 'success'}`}>
              {message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
