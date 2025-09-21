/**
 * Authentication Context
 * Manages user authentication state across the application
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../config/firebase';

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
    checkAuthStatus();
  }, []);

  /**
   * Check if user is currently authenticated
   */
    const checkAuthStatus = async () => {
      try {
        const token = localStorage.getItem('authToken');
        
        if (!token) {
          setLoading(false);
          return;
        }

        // Verify token with backend
        const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '';
        
        const response = await fetch(`${API_BASE}/api/auth/profile`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          setUser(data.user);
        } else {
          // Token is invalid, remove it
          localStorage.removeItem('authToken');
          setUser(null);
        }
      } catch (error) {
        console.error('AuthContext: Auth check failed:', error);
        localStorage.removeItem('authToken');
        setUser(null);
      } finally {
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
   * Email and password signup
   */
  const emailPasswordSignup = async (email, password, fullName) => {
    try {
      setError(null);
      setLoading(true);

      // Use the correct backend API URL
      const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '';
      
      const response = await fetch(`${API_BASE}/api/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password, fullName })
      });

      const data = await response.json();

      if (response.ok) {
        // Use real Firebase authentication
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const idToken = await userCredential.user.getIdToken();
        
        localStorage.setItem('authToken', idToken);

        // Set user data
        setUser(data.user);
        return { success: true, message: data.message };
      } else {
        throw new Error(data.message || 'Signup failed');
      }
    } catch (error) {
      console.error(`🔍 [${new Date().toISOString()}] AuthContext: Signup failed:`, error);
      setError(error.message);
      return { success: false, message: error.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Email and password signin
   */
  const emailPasswordSignin = async (email, password) => {
    try {
      setError(null);
      setLoading(true);

      // Use the correct backend API URL
      const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '';
      
      const response = await fetch(`${API_BASE}/api/auth/signin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok) {
        // Use real Firebase authentication
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const idToken = await userCredential.user.getIdToken();
        
        localStorage.setItem('authToken', idToken);

        // Set user data
        setUser(data.user);
        return { success: true, message: data.message };
      } else {
        throw new Error(data.message || 'Signin failed');
      }
    } catch (error) {
      console.error(`🔍 [${new Date().toISOString()}] AuthContext: Signin failed:`, error);
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
   * Get authentication token for API requests with automatic refresh
   */
  const getAuthToken = async () => {
    const token = localStorage.getItem('authToken');
    
    if (!token) {
      return null;
    }

    // Check if token is expired by trying to use it
    try {
      const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '';
      const response = await fetch(`${API_BASE}/api/auth/profile`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        return token; // Token is still valid
      } else if (response.status === 401) {
        // Token is expired, try to refresh
        return await refreshAuthToken();
      }
    } catch (error) {
      console.error('AuthContext: Token validation failed:', error);
      return await refreshAuthToken();
    }

    return null;
  };

  /**
   * Refresh the authentication token
   */
  const refreshAuthToken = async () => {
    try {
      // Get the current user from Firebase Auth
      const { getAuth } = await import('firebase/auth');
      const auth = getAuth();
      const currentUser = auth.currentUser;

      if (!currentUser) {
        // User is not logged in, clear token
        localStorage.removeItem('authToken');
        setUser(null);
        return null;
      }

      // Get a fresh ID token
      const idToken = await currentUser.getIdToken(true); // Force refresh
      
      // Store the new token
      localStorage.setItem('authToken', idToken);
      
      // Verify the new token with backend
      const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '';
      const response = await fetch(`${API_BASE}/api/auth/profile`, {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        return idToken;
      } else {
        // New token is also invalid, logout user
        localStorage.removeItem('authToken');
        setUser(null);
        return null;
      }
    } catch (error) {
      console.error('AuthContext: Token refresh failed:', error);
      localStorage.removeItem('authToken');
      setUser(null);
      return null;
    }
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
    emailPasswordSignup,
    emailPasswordSignin,
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
