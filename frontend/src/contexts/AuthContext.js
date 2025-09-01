/**
 * Authentication Context
 * Manages user authentication state across the application
 */

import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext();

/**
 * Custom hook to use authentication context
 */
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

/**
 * Authentication Provider component
 */
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check if user is authenticated on component mount
  useEffect(() => {
    console.log('AuthContext: Starting authentication check...');
    checkAuthStatus();
  }, []);

  /**
   * Check if user is currently authenticated
   */
  const checkAuthStatus = async () => {
    try {
      console.log('AuthContext: Checking authentication status...');
      const token = localStorage.getItem('authToken');
      console.log('AuthContext: Token found:', !!token);
      
      if (!token) {
        console.log('AuthContext: No token found, user not authenticated');
        setLoading(false);
        return;
      }

      // Verify token with backend
      const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '';
      console.log('AuthContext: Verifying token with backend at:', API_BASE);
      
      const response = await fetch(`${API_BASE}/api/auth/profile`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        console.log('AuthContext: Token verified, user authenticated:', data.user);
        setUser(data.user);
      } else {
        console.log('AuthContext: Token invalid, removing from storage');
        // Token is invalid, remove it
        localStorage.removeItem('authToken');
        setUser(null);
      }
    } catch (error) {
      console.error('AuthContext: Auth check failed:', error);
      localStorage.removeItem('authToken');
      setUser(null);
    } finally {
      console.log('AuthContext: Authentication check complete, loading:', false);
      setLoading(false);
    }
  };

  /**
   * Social media login
   */
  const socialLogin = async (idToken, provider) => {
    try {
      setError(null);
      setLoading(true);

      // Use the correct backend API URL
      const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '';
      
      const response = await fetch(`${API_BASE}/api/auth/social-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ idToken, provider })
      });

      const data = await response.json();

      if (response.ok) {
        // Store the ID token
        localStorage.setItem('authToken', idToken);
        
        // Set user data
        setUser(data.user);
        return { success: true, message: data.message };
      } else {
        throw new Error(data.message || 'Social login failed');
      }
    } catch (error) {
      setError(error.message);
      return { success: false, message: error.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Get supported authentication providers
   */
  const getProviders = async () => {
    try {
      // Use the correct backend API URL
      const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '';
      
      const response = await fetch(`${API_BASE}/api/auth/providers`);
      if (response.ok) {
        const data = await response.json();
        return data;
      } else {
        throw new Error('Failed to fetch providers');
      }
    } catch (error) {
      console.error('Error fetching providers:', error);
      // Return default providers if backend fails
      return {
        supported: ["google", "facebook"],
        google: { name: "Google", icon: "🔍", description: "Sign in with your Google account" },
        facebook: { name: "Facebook", icon: "📘", description: "Sign in with your Facebook account" }
      };
    }
  };

  /**
   * Logout user
   */
  const logout = () => {
    localStorage.removeItem('authToken');
    setUser(null);
    setError(null);
  };

  /**
   * Update user profile
   */
  const updateProfile = async (updates) => {
    try {
      setError(null);
      setLoading(true);

      const token = localStorage.getItem('authToken');
      if (!token) {
        throw new Error('No authentication token');
      }

      const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '';
      
      const response = await fetch(`${API_BASE}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updates)
      });

      const data = await response.json();

      if (response.ok) {
        // Update local user state
        setUser(prev => ({ ...prev, ...updates }));
        return { success: true, message: data.message };
      } else {
        throw new Error(data.message || 'Profile update failed');
      }
    } catch (error) {
      setError(error.message);
      return { success: false, message: error.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Check if user has admin role
   */
  const isAdmin = () => {
    return user && user.role === 'admin';
  };

  /**
   * Get authentication token for API requests
   */
  const getAuthToken = () => {
    return localStorage.getItem('authToken');
  };

  /**
   * Set authentication token (used after Firebase Auth)
   */
  const setAuthToken = (token) => {
    localStorage.setItem('authToken', token);
  };

  const value = {
    user,
    loading,
    error,
    socialLogin,
    getProviders,
    logout,
    updateProfile,
    isAdmin,
    getAuthToken,
    setAuthToken,
    checkAuthStatus
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
