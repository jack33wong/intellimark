/**
 * Login Component
 * Handles user authentication with Firebase
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { AlertCircle, Chrome, Facebook, Mail, Lock, Eye, EyeOff, X } from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider, facebookProvider } from '../../config/firebase';
import './Login.css';
import '../common/LoadingSpinner.css';
import API_CONFIG from '../../config/api';
import { analyticsService } from '../../services/AnalyticsService';
import SEO from '../common/SEO';

const Login = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [firebaseError, setFirebaseError] = useState(null);
  const [currentPage, setCurrentPage] = useState('main'); // 'main', 'email-signin', 'email-signup'
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const navigate = useNavigate();
  const emailInputRef = React.useRef(null);

  // 👇 FIX 1: Removed the obsolete `socialLogin` function from the destructuring.
  const { user, emailPasswordSignup, emailPasswordSignin, error: authError } = useAuth();

  useEffect(() => {
    document.body.classList.add('login-page');
    if (!auth || !googleProvider || !facebookProvider) {
      console.error('Firebase not properly configured.');
      setFirebaseError('Firebase configuration issue detected.');
    }
    return () => {
      document.body.classList.remove('login-page');
    };
  }, []);

  useEffect(() => {
    if (user) {
      navigate('/app');
    }
  }, [user, navigate]);

  useEffect(() => {
    if (currentPage === 'main' && emailInputRef.current) {
      emailInputRef.current.focus();
    }
  }, [currentPage]);

  const handleSocialLogin = async (provider) => {
    if (!auth || !googleProvider || !facebookProvider) {
      setFirebaseError('Firebase not available. Please refresh and try again.');
      return;
    }
    setIsLoading(true);
    setFirebaseError(null);
    try {
      const authProvider = provider === 'google' ? googleProvider : facebookProvider;
      // 👇 FIX 2: The `signInWithPopup` is all that's needed. The onAuthStateChanged
      // listener in the AuthContext will handle the successful login.
      await signInWithPopup(auth, authProvider);

      // Track successful social login/signup (GA4 doesn't distinguish easily without more logic, 
      // but 'login' or 'sign_up' intent is clear here)
      analyticsService.logSignUp(provider);

      // The useEffect listening for the `user` object will now handle the redirect.
      // No need to call navigate here directly.
    } catch (error) {
      console.error(`${provider} login error:`, error);
      if (error.code === 'auth/popup-closed-by-user') {
        setFirebaseError('Login was cancelled.');
      } else if (error.code === 'auth/popup-blocked') {
        setFirebaseError('Popup was blocked. Please allow popups.');
      } else {
        setFirebaseError(`Failed to start ${provider} login.`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleEmailPasswordSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setFirebaseError(null);
    try {
      const isSignUp = currentPage === 'email-signup';
      const result = isSignUp
        ? await emailPasswordSignup(formData.email, formData.password, '')
        : await emailPasswordSignin(formData.email, formData.password);

      if (!result.success) {
        setFirebaseError(result.message);
      } else {
        // Track successful email signup
        if (isSignUp) {
          analyticsService.logSignUp('email');
        }
      }
      // The useEffect will handle the redirect on success.
    } catch (error) {
      console.error('Email/password auth error:', error);
      setFirebaseError(error.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  const checkUserExists = async (email) => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/auth/check-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      return data.exists;
    } catch (error) {
      console.error('Error checking user existence:', error);
      return false; // Assume user doesn't exist on error
    } finally {
      setIsLoading(false);
    }
  };

  const handleContinue = async () => {
    if (!formData.email) {
      setFirebaseError('Please enter your email address');
      return;
    }
    setFirebaseError(null);

    if (formData.email.toLowerCase().endsWith('@gmail.com')) {
      await handleSocialLogin('google');
      return;
    }

    const userExists = await checkUserExists(formData.email);
    setCurrentPage(userExists ? 'email-signin' : 'email-signup');
  };

  const handleBack = () => {
    setCurrentPage('main');
    setFormData(prev => ({ ...prev, password: '' }));
    setFirebaseError(null);
  };

  if (user) {
    return null;
  }

  const handleClose = () => {
    navigate(-1);
  };

  const renderMainPage = () => (
    <div className="auth-card">
      <div className="auth-header"><h1>AI Marking</h1><p>Sign in or sign up</p></div>
      <div className="auth-form">
        {firebaseError && <div className="auth-error"><AlertCircle size={16} /><span>{firebaseError}</span></div>}
        {authError && <div className="auth-error"><AlertCircle size={16} /><span>{authError}</span></div>}
        <div className="social-login-section">
          {(googleProvider && facebookProvider) ? (
            <div className="social-buttons">
              <button type="button" className="social-button google" onClick={() => handleSocialLogin('google')} disabled={isLoading}>
                <Chrome size={20} /><span>Continue with Google</span>
              </button>
              <button type="button" className="social-button facebook" onClick={() => handleSocialLogin('facebook')} disabled={isLoading}>
                <Facebook size={20} /><span>Continue with Facebook</span>
              </button>
            </div>
          ) : (
            <div className="loading-providers"><div className="loading-spinner" /><p>Loading login options...</p></div>
          )}
        </div>
        <div className="auth-divider"><span>or</span></div>
        <form onSubmit={(e) => { e.preventDefault(); handleContinue(); }} className="email-form">
          <div className="form-group">
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              required
              className="form-input"
              placeholder="Enter your email"
              ref={emailInputRef}
            />
          </div>
          <button type="submit" className="auth-submit-button compact" disabled={isLoading}>
            {isLoading ? <div className="loading-spinner loading-spinner-small"><div className="spinner spinner-white" /></div> : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );

  const renderEmailFormPage = (isSignUp) => (
    <div className="auth-card">
      <div className="auth-header"><h1>AI Marking</h1><p>{isSignUp ? 'Create your account' : 'Sign in with your password'}</p></div>
      <div className="auth-form">
        {firebaseError && <div className="auth-error"><AlertCircle size={16} /><span>{firebaseError}</span></div>}
        {authError && <div className="auth-error"><AlertCircle size={16} /><span>{authError}</span></div>}
        <form onSubmit={handleEmailPasswordSubmit} className="email-password-form">
          <div className="form-group">
            <label htmlFor="email" className="form-label"><Mail size={16} />Email</label>
            <input type="email" name="email" value={formData.email} onChange={handleInputChange} required className="form-input" readOnly />
          </div>
          <div className="form-group">
            <label htmlFor="password" className="form-label"><Lock size={16} />Password</label>
            <div className="password-input-container">
              <input type={showPassword ? 'text' : 'password'} name="password" value={formData.password} onChange={handleInputChange} required className="form-input password-input" placeholder="Enter your password" />
              <button type="button" className="password-toggle" onClick={() => setShowPassword(p => !p)}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <button type="submit" className="auth-submit-button" disabled={isLoading}>
            {isLoading ? <div className="loading-spinner loading-spinner-small"><div className="spinner spinner-white" /></div> : 'Continue'}
          </button>
        </form>
        <button type="button" className="auth-back-button" onClick={handleBack}>← Back</button>
      </div>
    </div>
  );

  return (
    <div className="auth-container">
      <SEO
        title={currentPage === 'email-signup' ? "Sign Up" : "Login"}
        description="Access your AI marking account to grade GCSE Maths papers and view performance reports."
      />
      <div className="auth-card-container">
        <button className="auth-close-button" onClick={handleClose} aria-label="Close">
          <X size={20} />
        </button>
        {
          currentPage === 'main' ? renderMainPage() :
            currentPage === 'email-signin' ? renderEmailFormPage(false) :
              renderEmailFormPage(true)
        }
      </div>
    </div>
  );
};

export default Login;

