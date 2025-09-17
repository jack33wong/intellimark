/**
 * Protected Route Component
 * Wraps routes that require authentication
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import './ProtectedRoute.css';

const ProtectedRoute = ({ children, requireAdmin = false }) => {
  const { user, loading, isAdmin } = useAuth();
  const navigate = useNavigate();

  // Show loading spinner while checking authentication
  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner large"></div>
        <p>Loading...</p>
      </div>
    );
  }

  // If not authenticated, redirect to login page
  if (!user) {
    navigate('/login');
    return null;
  }

  // If admin access is required but user is not admin
  if (requireAdmin && !isAdmin()) {
    return (
      <div className="access-denied">
        <div className="access-denied-content">
          <h2>🔒 Access Denied</h2>
          <p>You don't have permission to access this page.</p>
          <p>Admin privileges are required.</p>
        </div>
      </div>
    );
  }

  // User is authenticated and has required permissions
  return children;
};

export default ProtectedRoute;
