/**
 * Login Component
 * Handles user authentication with Firebase
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { AlertCircle, Chrome, Mail, Lock, Eye, EyeOff, X, Loader2 } from 'lucide-react';
import { signInWithPopup, signInWithRedirect, getAdditionalUserInfo } from 'firebase/auth';
import { auth, googleProvider } from '../../config/firebase';
import './Login.css';
import '../common/LoadingSpinner.css';
import API_CONFIG from '../../config/api';
import { analyticsService } from '../../services/AnalyticsService';
import { fireAdsSignupConversion } from '../../utils/analytics';
import {
  markAuthWallCtaClicked,
  markAuthWallDismissed,
  markAuthWallConverted,
  markAuthWallGoogleError
} from '../../utils/funnelTracker';
import SEO from '../common/SEO';

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const emailInputRef = React.useRef(null);

  const [loadingMethod, setLoadingMethod] = useState(null); // 'google' | 'email' | null
  const isLoading = loadingMethod !== null;
  const [firebaseError, setFirebaseError] = useState(null);
  const [currentPage, setCurrentPage] = useState('main'); // 'main', 'email-signin', 'email-signup'
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });

  const fromLanding = location.state?.fromLanding;

  // 👇 FIX 1: Removed the obsolete `socialLogin` function from the destructuring.
  const { user, emailPasswordSignup, emailPasswordSignin, error: authError } = useAuth();

  useEffect(() => {
    document.body.classList.add('login-page');

    // Force light mode if coming from landing page
    const wasDark = document.documentElement.classList.contains('dark');
    if (fromLanding) {
      document.documentElement.classList.remove('dark');
    }

    if (!auth || !googleProvider) {
      console.error('Firebase not properly configured.');
      setFirebaseError('Firebase configuration issue detected.');
    }
    return () => {
      document.body.classList.remove('login-page');
      // Restore theme if it was forced
      if (fromLanding && wasDark) {
        document.documentElement.classList.add('dark');
      }
    };
  }, [fromLanding]);

  useEffect(() => {
    if (user) {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      // Safely route the user back to where they hit the limit, fallback to /app
      const returnPath = location.state?.returnTo || '/app';
      navigate(returnPath, { replace: true });
    }
  }, [user, navigate, location]);

  useEffect(() => {
    if (currentPage === 'main' && emailInputRef.current && window.innerWidth > 768) {
      emailInputRef.current.focus();
    }
  }, [currentPage]);

  const handleSocialLogin = async (provider, { skipCtaTracking = false } = {}) => {
    if (!skipCtaTracking) {
      markAuthWallCtaClicked('auth_modal', 'continue_with_google');
    }
    if (!auth || !googleProvider) {
      setFirebaseError('Firebase not available. Please refresh and try again.');
      return;
    }
    setLoadingMethod('google');
    setFirebaseError(null);
    try {
      const authProvider = googleProvider;
      // 👇 CAPTURE THE RESULT OF THE POPUP
      const result = await signInWithPopup(auth, authProvider);

      // 👇 CHECK IF THIS IS A BRAND NEW ACCOUNT
      const additionalInfo = getAdditionalUserInfo(result);
      if (additionalInfo?.isNewUser) {
        console.log(`[Ads Evidence] 🆕 Brand new Social User detected (${provider}). Firing Sign-up conversion.`);
        fireAdsSignupConversion(result.user.email);
      } else {
        console.log(`[Ads Evidence] 🔄 Returning Social User logged in (${provider}). No conversion fired.`);
      }

      // Track successful social login/signup in GA4
      analyticsService.logSignUp(provider);
      markAuthWallConverted(provider === 'google' ? 'google' : 'email', result.user?.uid || null);

      // The useEffect listening for the `user` object will now handle the redirect.
    } catch (error) {
      console.error(`${provider} login error:`, error);
      const code = error?.code || 'unknown';
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        markAuthWallGoogleError('auth_modal', code, { fallback: 'redirect' });
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectErr) {
          markAuthWallGoogleError('auth_modal', redirectErr?.code || 'redirect_failed');
          setFirebaseError('Popup was blocked. Please allow popups or continue with email.');
        }
      } else {
        markAuthWallGoogleError('auth_modal', code);
        if (code === 'auth/popup-closed-by-user') {
          setFirebaseError('Login was cancelled.');
        } else {
          setFirebaseError(`Failed to start ${provider} login.`);
        }
      }
    } finally {
      setLoadingMethod(null);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleEmailPasswordSubmit = async (e) => {
    e.preventDefault();
    setLoadingMethod('email');
    setFirebaseError(null);
    try {
      const isSignUp = currentPage === 'email-signup';
      const result = isSignUp
        ? await emailPasswordSignup(formData.email, formData.password, '')
        : await emailPasswordSignin(formData.email, formData.password);

      if (!result.success) {
        setFirebaseError(result.message);
      } else {
        markAuthWallConverted('email', result.user?.uid || auth?.currentUser?.uid || null);
        // Track successful email signup
        if (isSignUp) {
          console.log('[Ads Evidence] 🆕 Brand new Email User detected. Firing Sign-up conversion.');
          fireAdsSignupConversion(formData.email);
          analyticsService.logSignUp('email');
        }
      }
      // The useEffect will handle the redirect on success.
    } catch (error) {
      console.error('Email/password auth error:', error);
      setFirebaseError(error.message || 'Authentication failed');
    } finally {
      setLoadingMethod(null);
    }
  };

  const checkUserExists = async (email) => {
    try {
      setLoadingMethod('email');
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
      setLoadingMethod(null);
    }
  };

  const handleContinue = async () => {
    if (!formData.email) {
      setFirebaseError('Please enter your email address');
      return;
    }
    markAuthWallCtaClicked('auth_modal', 'email_continue');
    setFirebaseError(null);

    if (formData.email.toLowerCase().endsWith('@gmail.com')) {
      await handleSocialLogin('google', { skipCtaTracking: true });
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

  const handleClose = useCallback((dismissMethod = 'close_button') => {
    markAuthWallDismissed(dismissMethod, 'auth_modal');
    navigate(-1);
  }, [navigate]);

  useEffect(() => {
    if (user) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleClose('escape');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [user, handleClose]);

  if (user) {
    return null;
  }

  const renderMainPage = () => (
    <div className="auth-card">
      <div className="auth-header"><h1>AI Marking</h1><p>Sign in or sign up</p></div>
      <div className="auth-form">
        {firebaseError && <div className="auth-error"><AlertCircle size={16} /><span>{firebaseError}</span></div>}
        {authError && <div className="auth-error"><AlertCircle size={16} /><span>{authError}</span></div>}
        <div className="social-login-section">
          {googleProvider ? (
            <div className="social-buttons">
              <button type="button" className="social-button google" onClick={() => handleSocialLogin('google')} disabled={isLoading}>
                {loadingMethod === 'google' ? (
                  <><Loader2 size={18} className="auth-btn-spinner" /><span>Signing in with Google...</span></>
                ) : (
                  <><Chrome size={20} /><span>Continue with Google</span></>
                )}
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
            {loadingMethod === 'email' ? <Loader2 size={18} className="auth-btn-spinner" /> : 'Continue'}
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
            {loadingMethod === 'email' ? <Loader2 size={18} className="auth-btn-spinner" /> : 'Continue'}
          </button>
        </form>
        <button type="button" className="auth-back-button" onClick={handleBack}>← Back</button>
      </div>
    </div>
  );

  return (
    <div
      className="auth-container"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose('backdrop');
        }
      }}
    >
      <SEO
        title={currentPage === 'email-signup' ? "Sign Up" : "Login"}
        description="Access your AI marking account to grade GCSE Maths papers and view performance reports."
      />
      <div className="auth-card-container">
        <button className="auth-close-button" onClick={() => handleClose('close_button')} aria-label="Close">
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

