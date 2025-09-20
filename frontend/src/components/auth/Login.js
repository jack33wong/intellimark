/**
 * Login Component
 * Handles user authentication with Firebase
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { AlertCircle, Chrome, Facebook, Mail, Lock, User, Eye, EyeOff } from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider, facebookProvider } from '../../config/firebase';
import './Login.css';
import '../common/LoadingSpinner.css';

const Login = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [providers, setProviders] = useState(null);
  const [firebaseError, setFirebaseError] = useState(null);
  const [authMode, setAuthMode] = useState('signin'); // 'signin' or 'signup'
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    fullName: ''
  });
  const navigate = useNavigate();
  
  const { user, socialLogin, emailPasswordSignup, emailPasswordSignin, getProviders, error: authError } = useAuth();

  // Debug Firebase imports and set body class for full width
  useEffect(() => {
    // Add login-page class to body for full width
    document.body.classList.add('login-page');
    
    
    // Check if Firebase is properly configured
    if (!auth || !googleProvider || !facebookProvider) {
      console.error('❌ Firebase not properly configured:', { auth, googleProvider, facebookProvider });
      setFirebaseError('Firebase configuration issue detected. Some features may not work properly.');
    } else {
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

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleEmailPasswordSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setFirebaseError(null);
    
    try {
      let result;
      if (authMode === 'signup') {
        result = await emailPasswordSignup(formData.email, formData.password, formData.fullName);
      } else {
        result = await emailPasswordSignin(formData.email, formData.password);
      }
      
      if (result.success) {
        navigate('/mark-homework');
      } else {
        setFirebaseError(result.message);
      }
    } catch (error) {
      console.error('Email/password auth error:', error);
      setFirebaseError(error.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleAuthMode = () => {
    setAuthMode(prev => prev === 'signin' ? 'signup' : 'signin');
    setFormData({ email: '', password: '', fullName: '' });
    setFirebaseError(null);
  };

  const togglePasswordVisibility = () => {
    setShowPassword(prev => !prev);
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
            <h1>Intellimark</h1>
          </div>
          <p className="auth-subtitle">
            {authMode === 'signin' ? 'Sign in to your account' : 'Create your account'}
          </p>
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

          {/* Email/Password Form */}
          <form onSubmit={handleEmailPasswordSubmit} className="email-password-form">
            {authMode === 'signup' && (
              <div className="form-group">
                <label htmlFor="fullName" className="form-label">
                  <User size={16} />
                  Full Name
                </label>
                <input
                  type="text"
                  id="fullName"
                  name="fullName"
                  value={formData.fullName}
                  onChange={handleInputChange}
                  required={authMode === 'signup'}
                  className="form-input"
                  placeholder="Enter your full name"
                />
              </div>
            )}

            <div className="form-group">
              <label htmlFor="email" className="form-label">
                <Mail size={16} />
                Email
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                required
                className="form-input"
                placeholder="Enter your email"
              />
            </div>

            <div className="form-group">
              <label htmlFor="password" className="form-label">
                <Lock size={16} />
                Password
              </label>
              <div className="password-input-container">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  required
                  className="form-input password-input"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={togglePasswordVisibility}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="auth-submit-button"
              disabled={isLoading}
            >
              {isLoading ? (
                <div className="loading-spinner small" />
              ) : (
                authMode === 'signin' ? 'Sign In' : 'Sign Up'
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="auth-divider">
            <span>or</span>
          </div>

          {/* Social Login Section */}
          <div className="social-login-section">
            <p className="social-login-text">Continue with social media:</p>
            
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
            {authMode === 'signin' ? (
              <>
                Don't have an account?{' '}
                <button
                  type="button"
                  className="auth-link"
                  onClick={toggleAuthMode}
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  className="auth-link"
                  onClick={toggleAuthMode}
                >
                  Sign in
                </button>
              </>
            )}
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
