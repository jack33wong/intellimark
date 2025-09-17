/**
 * Optional Authentication Route Component
 * Allows access without authentication but provides different UI based on auth status
 */

import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import './OptionalAuthRoute.css';

const OptionalAuthRoute = ({ children, requireAuth = false }) => {
  const { user, loading } = useAuth();

  // Show loading spinner while checking authentication
  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner large"></div>
        <p>Loading...</p>
      </div>
    );
  }

  // If authentication is required but user is not authenticated
  if (requireAuth && !user) {
    return (
      <div className="access-denied">
        <div className="access-denied-content">
          <h2>🔒 Login Required</h2>
          <p>Please log in to access this feature.</p>
          <p>Chat history and session management require authentication.</p>
        </div>
      </div>
    );
  }

  // User is either authenticated or authentication is not required
  return children;
};

export default OptionalAuthRoute;
