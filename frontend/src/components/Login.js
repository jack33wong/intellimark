/**
 * Login Component
 * Handles user authentication with Firebase
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AlertCircle, Chrome, Facebook } from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider, facebookProvider } from '../config/firebase';
import './Login.css';

const Login = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [providers, setProviders] = useState(null);
  const [firebaseError, setFirebaseError] = useState(null);
  const navigate = useNavigate();
  
  const { user, socialLogin, getProviders, error: authError } = useAuth();

  // Debug Firebase imports and set body class for full width
  useEffect(() => {
    // Add login-page class to body for full width
    document.body.classList.add('login-page');
    
    console.log('🔍 Login Component Debug:', {
      auth: !!auth,
      googleProvider: !!googleProvider,
      facebookProvider: !!facebookProvider,
      authType: typeof auth,
      googleProviderType: typeof googleProvider
    });
    
    // Check if Firebase is properly configured
    if (!auth || !googleProvider || !facebookProvider) {
      console.error('❌ Firebase not properly configured:', { auth, googleProvider, facebookProvider });
      setFirebaseError('Firebase configuration issue detected. Some features may not work properly.');
    } else {
      console.log('✅ Firebase properly configured');
      setFirebaseError(null);
    }
    
    // Cleanup function to remove the class when component unmounts
    return () => {
      document.body.classList.remove('login-page');
    };
  }, []);

  // Redirect if user is already authenticated
  useEffect(() => {
    if (user) {
      navigate('/mark-homework');
    }
  }, [user, navigate]);

  // Fetch available providers on component mount
  useEffect(() => {
    const fetchProviders = async () => {
      try {
        console.log('🔄 Fetching providers...');
        const providersData = await getProviders();
        console.log('✅ Providers fetched:', providersData);
        setProviders(providersData);
      } catch (error) {
        console.error('❌ Error fetching providers:', error);
        // Only set Firebase error if it's not already set
        if (!firebaseError) {
          setFirebaseError('Unable to load authentication providers. Please check your connection.');
        }
        // Set fallback providers
        setProviders({
          supported: ["google", "facebook"],
          google: { name: "Google", icon: "🔍", description: "Sign in with your Google account" },
          facebook: { name: "Facebook", icon: "📘", description: "Sign in with your Facebook account" }
        });
      }
    };
    fetchProviders();
  }, [getProviders, firebaseError]);

  const handleSocialLogin = async (provider) => {
    // Check if Firebase is available before attempting login
    if (!auth || !googleProvider || !facebookProvider) {
      setFirebaseError('Firebase not available. Please refresh the page and try again.');
      return;
    }
    
    setIsLoading(true);
    setFirebaseError(null);
    
    try {
      if (provider === 'google') {
        const result = await signInWithPopup(auth, googleProvider);
        // Handle successful login
        const idToken = await result.user.getIdToken();
        const loginResult = await socialLogin(idToken, 'google');
        
        if (loginResult.success) {
          navigate('/mark-homework');
        } else {
          setFirebaseError(loginResult.message);
        }
      } else if (provider === 'facebook') {
        const result = await signInWithPopup(auth, facebookProvider);
        // Handle successful login
        const idToken = await result.user.getIdToken();
        const loginResult = await socialLogin(idToken, 'facebook');
        
        if (loginResult.success) {
          navigate('/mark-homework');
        } else {
          setFirebaseError(loginResult.message);
        }
      }
    } catch (error) {
      console.error(`${provider} login error:`, error);
      if (error.code === 'auth/popup-closed-by-user') {
        setFirebaseError('Login was cancelled. Please try again.');
      } else if (error.code === 'auth/popup-blocked') {
        setFirebaseError('Popup was blocked. Please allow popups for this site and try again.');
      } else {
        setFirebaseError(`Failed to start ${provider} login. Please try again.`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Don't render login form if user is already authenticated
  if (user) {
    return (
      <div className="loading-container">
        <div className="loading-spinner large"></div>
        <p>Redirecting to main application...</p>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">
            <div className="logo-icon">🎯</div>
            <h1>Intellimark</h1>
          </div>
          <p className="auth-subtitle">Sign in to your account</p>
        </div>

        <div className="auth-form">
          {/* Show Firebase configuration errors */}
          {firebaseError && (
            <div className="auth-error">
              <AlertCircle size={16} />
              <span>{firebaseError}</span>
            </div>
          )}

          {/* Show authentication errors */}
          {authError && (
            <div className="auth-error">
              <AlertCircle size={16} />
              <span>{authError}</span>
            </div>
          )}

          <div className="social-login-section">
            <p className="social-login-text">Choose your login method:</p>
            
            {providers && (
              <div className="social-buttons">
                <button
                  type="button"
                  className="social-button google"
                  onClick={() => handleSocialLogin('google')}
                  disabled={isLoading}
                >
                  <Chrome size={20} />
                  <span>Continue with Google</span>
                </button>
                
                <button
                  type="button"
                  className="social-button facebook"
                  onClick={() => handleSocialLogin('facebook')}
                  disabled={isLoading}
                >
                  <Facebook size={20} />
                  <span>Continue with Facebook</span>
                </button>
              </div>
            )}
            
            {!providers && (
              <div className="loading-providers">
                <div className="loading-spinner" />
                <p>Loading login options...</p>
              </div>
            )}
          </div>
        </div>

        <div className="auth-footer">
          <p className="auth-info">
            Secure login with your social media account
          </p>
          {firebaseError && (
            <p className="auth-warning">
              ⚠️ Firebase configuration issue detected. Some features may not work properly.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
