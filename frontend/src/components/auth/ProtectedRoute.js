/**
 * Protected Route Component
 * Wraps routes that require authentication. This is the definitive, corrected version.
 */
import React from 'react';
// 👇 FIX 1: Import the Navigate component for correct redirects.
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import './ProtectedRoute.css';

const ProtectedRoute = ({ children, requireAdmin = false }) => {
  const { user, loading, isAdmin } = useAuth();

  // 👇 FIX 2: While loading, return null to prevent rendering the protected content.
  if (loading) {
    return null;
  }

  // If not authenticated, redirect to the login page.
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // 👇 FIX 3: If admin is required but user is not an admin, redirect to the homepage.
  // This is better user experience and matches the behavior you reported.
  if (requireAdmin && !isAdmin()) {
    return <Navigate to="/" replace />;
  }

  // User is authenticated and has the required permissions.
  return children;
};

export default ProtectedRoute;
