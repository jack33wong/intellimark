import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import EventManager, { EVENT_TYPES } from '../../utils/eventManager';
import CreditIcon from '../common/CreditIcon';
import {
  User,
  LogOut,
  Settings,
  ChevronDown,
  Crown,
  Calendar,
  CreditCard,
  CheckCircle,
  Coins,
  BarChart3,
  AlertCircle,
  LayoutDashboard,
  Menu
} from 'lucide-react';
import API_CONFIG from '../../config/api';
import { SUPPORT_EMAIL } from '../../config/support';
import './Header.css';
import '../credits.css';
import { useCredits } from '../../hooks/useCredits';
import { useSubscription } from '../../hooks/useSubscription';
import SubscriptionService from '../../services/subscriptionService';
import ModelSelector from '../focused/ModelSelector';
import { STORAGE_KEYS } from '../../utils/constants';
import { useModels } from '../../contexts/ModelContext';
import { simpleSessionService } from '../../services/markingApiService';

const formatTokenValue = (val) => {
  if (val === null || val === undefined || isNaN(val)) return '0';
  const num = Number(val);
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';

  if (abs >= 1000) {
    const inK = abs / 1000;
    if (inK % 1 === 0) {
      return `${sign}${inK.toLocaleString()} K`;
    }
    // Truncate to at most 2 decimal places without rounding unspent tokens up
    const truncatedK = Math.floor(inK * 100) / 100;
    const formattedK = truncatedK.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
    return `${sign}${formattedK} K`;
  }

  if (Number.isInteger(num)) {
    return num.toLocaleString();
  }
  return Number(num.toFixed(2)).toLocaleString();
};

const getPercentLeftDisplay = (remaining, total) => {
  if (total <= 0) return remaining > 0 ? '100%' : '0%';
  if (remaining >= total) return '100%';
  if (remaining <= 0) return '0%';

  const pct = (remaining / total) * 100;
  if (pct % 1 === 0) {
    return `${pct}%`;
  }
  if (pct >= 99.9) {
    const rounded = Math.min(99.99, Number(pct.toFixed(2)));
    return `${rounded}%`;
  }
  if (pct >= 10) {
    const rounded = Number(pct.toFixed(1));
    return `${rounded}%`;
  }
  const rounded = Math.max(0.01, Number(pct.toFixed(1)));
  return `${rounded}%`;
};

const Header = ({ onMenuToggle, isSidebarOpen }) => {
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isProfileClosing, setIsProfileClosing] = useState(false);
  const [isSubscriptionDetailsOpen, setIsSubscriptionDetailsOpen] = useState(false);
  const [isSubscriptionDetailsClosing, setIsSubscriptionDetailsClosing] = useState(false);
  const { credits: userCredits } = useCredits();
  const { subscription: userSubscription, loading: subscriptionLoading, setSubscription: setUserSubscription, checkPermission } = useSubscription();

  const remainingTokens = typeof userCredits?.remainingCredits === 'number'
    ? userCredits.remainingCredits
    : (typeof userCredits?.remainingTokens === 'number' ? userCredits.remainingTokens : 0);

  const totalTokens = typeof userCredits?.totalCredits === 'number'
    ? userCredits.totalCredits
    : (typeof userCredits?.totalTokens === 'number' ? userCredits.totalTokens : 0);

  const percentLeftText = getPercentLeftDisplay(remainingTokens, totalTokens);

  const rawPercent = totalTokens > 0
    ? Math.max(0, Math.min(100, (remainingTokens / totalTokens) * 100))
    : (remainingTokens > 0 ? 100 : 0);

  const ringRadius = 6.8;
  const ringCircumference = 2 * Math.PI * ringRadius;
  // If tokens have been used, guarantee at least a small visible gap so it doesn't look 100% full
  const effectiveRingPercent = (remainingTokens < totalTokens && remainingTokens > 0)
    ? Math.min(98, rawPercent)
    : rawPercent;
  const ringOffset = ringCircumference * (1 - effectiveRingPercent / 100);
  const ringColor = rawPercent <= 10 ? '#ef4444' : rawPercent <= 25 ? '#f59e0b' : '#22c55e';

  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [avatarError, setAvatarError] = useState(false);
  const profileRef = useRef(null);
  const subscriptionRef = useRef(null);

  const { models, defaultModel, isLoading: isModelsLoading } = useModels();

  // New state for header model selection (syncing with MarkingPageContext)
  const [headerModel, setHeaderModel] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.SELECTED_MODEL) || 'fast';
    } catch (e) {
      return 'fast';
    }
  });

  // Track if a session is currently active (has messages) - model cannot be changed in active session
  const [isSessionActive, setIsSessionActive] = useState(false);

  useEffect(() => {
    const unsubscribe = simpleSessionService.subscribe((state) => {
      const hasMessages = state?.currentSession?.messages?.length > 0;
      setIsSessionActive(Boolean(hasMessages));
    });
    const current = simpleSessionService.getCurrentSession();
    setIsSessionActive(Boolean(current?.messages?.length > 0));
    return unsubscribe;
  }, []);

  // Sync model state with custom events
  useEffect(() => {
    const handleModelSync = (event) => {
      const newModel = event.detail;
      if (newModel && newModel !== headerModel) {
        setHeaderModel(newModel);
      }
    };

    window.addEventListener('modelChanged', handleModelSync);
    return () => window.removeEventListener('modelChanged', handleModelSync);
  }, [headerModel]);

  const handleHeaderModelChange = (model) => {
    // Model cannot be changed during an active session
    if (isSessionActive) {
      return;
    }

    if (model !== defaultModel && !checkPermission('model_selection')) {
      navigate('/upgrade', { state: { fromApp: true } });
      return;
    }

    setHeaderModel(model);
    try {
      localStorage.setItem(STORAGE_KEYS.SELECTED_MODEL, model);
      // Dispatch event to sync with MarkingPageContext and model selector in chat input
      window.dispatchEvent(new CustomEvent('modelChanged', { detail: model }));
    } catch (e) {
      console.error('Failed to save selected model to localStorage:', e);
    }
  };

  const isAppPage = location.pathname === '/app';







  // Check for subscription success parameter and create subscription record
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const subscriptionSuccess = urlParams.get('subscription');
    const sessionId = urlParams.get('session_id');

    if (subscriptionSuccess === 'success' && user?.uid && sessionId) {
      console.log('🔍 [Header] Detected subscription success param. user:', user.uid, 'session:', sessionId);

      // Create subscription record after successful payment
      const createSubscriptionRecord = async () => {
        try {
          console.log('🚀 [Header] calling create-subscription-after-payment...');
          const response = await fetch(`${API_CONFIG.BASE_URL}/api/payment/create-subscription-after-payment`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              sessionId: sessionId,
              userId: user.uid,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ [Header] Response error:', errorText);
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const result = await response.json();
          console.log('✅ [Header] Subscription created successfully:', result);

          // Refresh credits globally after successful creation
          console.log('📢 [Header] Dispatching REFRESH_CREDITS event...');
          EventManager.dispatch(EVENT_TYPES.REFRESH_CREDITS);

          // Refresh subscription data to get the latest
          const subscriptionResponse = await SubscriptionService.getUserSubscription(user.uid);
          setUserSubscription(subscriptionResponse.subscription);

        } catch (error) {
          console.error('❌ Error creating subscription record:', error);
          // Still try to refresh existing data as fallback
          try {
            const response = await SubscriptionService.getUserSubscription(user.uid);
            setUserSubscription(response.subscription);
          } catch (refreshError) {
            console.error('❌ Error refreshing subscription data:', refreshError);
          }
        }
      };

      createSubscriptionRecord();

      // Clean up URL parameters after a delay to ensure all trackers (like AnalyticsTracker)
      // have finished reading them before they are stripped.
      setTimeout(() => {
        const newUrl = window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
      }, 2000);
    } else if (subscriptionSuccess === 'success') {
    }
  }, [user?.uid]);

  // Reset avatar error when user changes
  useEffect(() => {
    setAvatarError(false);
  }, [user?.photoURL]);

  // Close profile dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        handleProfileClose();
      }
      if (subscriptionRef.current && !subscriptionRef.current.contains(event.target)) {
        handleSubscriptionDetailsClose();
      }
    };

    if (isProfileMenuOpen || isSubscriptionDetailsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isProfileMenuOpen, isSubscriptionDetailsOpen]);

  const handleLogout = () => {
    logout();
    navigate('/');
    handleProfileClose();
  };

  const handleProfileClick = () => {
    if (isProfileMenuOpen) {
      handleProfileClose();
    } else {
      setIsProfileMenuOpen(true);
      setIsProfileClosing(false);
    }
  };

  const handleProfileClose = () => {
    setIsProfileClosing(true);
    setTimeout(() => {
      setIsProfileMenuOpen(false);
      setIsProfileClosing(false);
    }, 300); // Match the CSS transition duration
  };

  const handleSubscriptionDetailsClose = () => {
    setIsSubscriptionDetailsClosing(true);
    setTimeout(() => {
      setIsSubscriptionDetailsOpen(false);
      setIsSubscriptionDetailsClosing(false);
    }, 300);
  };



  const getUpgradeButtonText = () => {
    if (subscriptionLoading) return 'Loading...';
    if (userSubscription && userSubscription.status === 'active') {
      const planName = SubscriptionService.getPlanDisplayName(userSubscription.planId);
      return `${planName} Plan`;
    }
    return 'Upgrade';
  };

  const getUpgradeButtonIcon = () => {
    if (userSubscription && userSubscription.status === 'active') {
      return <Crown size={16} />;
    }
    return null;
  };

  const handleUpgradeClick = () => {
    if (userSubscription && userSubscription.status === 'active') {
      // Show subscription details for subscribed users
      setIsSubscriptionDetailsOpen(true);
      setIsSubscriptionDetailsClosing(false);
    } else {
      // Navigate to upgrade page for non-subscribed users
      navigate('/upgrade', { state: { fromApp: true } });
    }
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      year: '2-digit',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatAmount = (amount, currency) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(amount / 100);
  };

  const handleCancelSubscription = async () => {
    if (!userSubscription) return;

    const confirmed = window.confirm(
      `Are you sure you want to cancel your ${SubscriptionService.getPlanDisplayName(userSubscription.planId)} subscription? You will lose access to premium features at the end of your current billing period.`
    );

    if (!confirmed) return;

    try {
      const response = await fetch(`/api/payment/cancel-subscription/${userSubscription.stripeSubscriptionId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to cancel subscription');
      }

      // Update local state to reflect cancellation
      setUserSubscription(prev => ({
        ...prev,
        status: 'canceled'
      }));

      alert('Your subscription has been canceled successfully. You will retain access until the end of your current billing period.');
      handleSubscriptionDetailsClose();
    } catch (error) {
      console.error('Error canceling subscription:', error);
      alert(`Failed to cancel subscription. Please try again or contact ${SUPPORT_EMAIL}.`);
    }
  };

  // Function to refresh subscription data (can be called from other components)
  // const refreshSubscriptionData = async () => {
  //   if (!user?.uid) return;
  //   
  //   try {
  //     const response = await SubscriptionService.getUserSubscription(user.uid);
  //     setUserSubscription(response.subscription);
  //     console.log('Subscription data refreshed:', response.subscription);
  //   } catch (error) {
  //     console.error('Error refreshing subscription data:', error);
  //   }
  // };

  return (
    <header className="header">
      <div className="header-content">
        {/* Left - Menu Toggle (Mobile) */}
        <div className="header-left">
          <button
            className="menu-toggle"
            onClick={onMenuToggle}
            aria-label="Toggle menu"
          >
            <Menu size={20} />
          </button>
          <Link to="/" className="header-logo">
            <img src="/images/logo.png" alt="AI Marking" className="header-logo-img" />
            <span className="header-logo-text">AI Marking</span>
          </Link>
        </div>

        {/* Center - Navigation or Model Selector */}
        <div className="header-center">
          {isAppPage && (
            <div className="header-model-selector-container">
              <ModelSelector
                selectedModel={headerModel}
                onModelChange={handleHeaderModelChange}
                disabled={isSessionActive}
                size="small"
                dropdownDirection="down"
              />
            </div>
          )}
        </div>

        {/* Right side - Profile */}
        <div className="header-right">
          {user ? (
            <>
              <div
                className="subscription-section"
                ref={subscriptionRef}
                onMouseEnter={() => setIsSubscriptionDetailsOpen(true)}
              >
                <button
                  className="nav-item credits-nav"
                  onClick={() => setIsSubscriptionDetailsOpen(!isSubscriptionDetailsOpen)}
                  title={`${remainingTokens.toLocaleString()} / ${totalTokens.toLocaleString()} tokens remaining (${percentLeftText})`}
                >
                  <div className="credits-nav-box">
                    <div className="credits-nav-top">
                      <span className="credits-percent-text">{percentLeftText} left</span>
                      <svg
                        className="credits-ring"
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}
                        aria-hidden="true"
                      >
                        <circle
                          cx="8"
                          cy="8"
                          r={ringRadius}
                          fill="none"
                          stroke="rgba(255, 255, 255, 0.2)"
                          strokeWidth="2.2"
                        />
                        <circle
                          cx="8"
                          cy="8"
                          r={ringRadius}
                          fill="none"
                          stroke={ringColor}
                          strokeWidth="2.2"
                          strokeDasharray={ringCircumference}
                          strokeDashoffset={ringOffset}
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>
                    <div className="credits-nav-subtext">
                      {formatTokenValue(remainingTokens)} / {formatTokenValue(totalTokens)}
                    </div>
                  </div>
                </button>

                {/* Subscription Details Dropdown */}
                {isSubscriptionDetailsOpen && (
                  <div className={`subscription-dropdown ${isSubscriptionDetailsClosing ? 'closing' : ''}`}>
                    <div className="credits-dropdown-header">
                      <div className="plan-info">
                        <span className="plan-name-large">
                          {userSubscription && userSubscription.status === 'active'
                            ? SubscriptionService.getPlanDisplayName(userSubscription.planId)
                            : 'Free'}
                        </span>
                      </div>
                      {(!userSubscription || userSubscription.status !== 'active' || userSubscription.planId === 'free') && (
                        <button
                          className="upgrade-btn-small"
                          onClick={() => {
                            navigate('/upgrade', { state: { fromApp: true } });
                            setIsSubscriptionDetailsOpen(false);
                          }}
                        >
                          Upgrade
                        </button>
                      )}
                    </div>

                    <div className="credits-divider"></div>

                    <div className="credits-details-row">
                      <div className="credits-label-group">
                        <CreditIcon size={16} className="credits-icon" />
                        <div>
                          <div className="credits-label-main">Credits</div>
                          <div className="credits-label-sub">
                            {userSubscription && userSubscription.status === 'active' ? 'Monthly credits' : 'Free credits'}
                          </div>
                        </div>
                      </div>
                      <div className="credits-value-group">
                        <div className="credits-value-main">
                          {typeof userCredits?.remainingCredits === 'number' ? userCredits.remainingCredits.toFixed(2) : (userCredits?.remainingCredits ?? 0)}
                        </div>
                        <div className="credits-value-sub">
                          {typeof userCredits?.totalCredits === 'number' ? userCredits.totalCredits.toFixed(2) : (userCredits?.totalCredits ?? 0)}
                        </div>
                      </div>
                    </div>

                    <div className="credits-footer">

                      <button
                        className="view-usage-link"
                        onClick={() => {
                          setIsSubscriptionDetailsOpen(false);
                          EventManager.dispatch('OPEN_PROFILE_MODAL', { tab: 'usage' });
                        }}
                      >
                        View usage &gt;
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="profile-section" ref={profileRef}>
                <button
                  className="profile-button"
                  onClick={handleProfileClick}
                  aria-label="Profile menu"
                >

                  <div className="profile-avatar">
                    {user.photoURL && !avatarError ? (
                      <img
                        src={user.photoURL}
                        alt="Profile"
                        onError={() => setAvatarError(true)}
                      />
                    ) : (
                      <User size={20} />
                    )}
                  </div>
                  <span className="profile-name">
                    {user.displayName || user.email?.split('@')[0] || ''}
                  </span>
                  <ChevronDown size={16} className={`chevron ${isProfileMenuOpen ? 'rotated' : ''}`} />
                </button>

                {/* Profile Dropdown */}
                {isProfileMenuOpen && (
                  <div className={`profile-dropdown ${isProfileClosing ? 'closing' : ''}`}>
                    <div className="profile-info">
                      <div className="profile-avatar large">
                        {user.photoURL && !avatarError ? (
                          <img
                            src={user.photoURL}
                            alt="Profile"
                            onError={() => setAvatarError(true)}
                          />
                        ) : (
                          <User size={24} />
                        )}
                      </div>
                      <div className="profile-details">
                        <div className="profile-name-large">
                          {user.displayName || ''}
                        </div>
                        <div className="profile-email">
                          {user.email}
                        </div>
                        {user.isAdmin && (
                          <div className="admin-badge">Admin</div>
                        )}
                      </div>
                    </div>

                    <div className="profile-actions">
                      <button
                        className="profile-action"
                        onClick={() => {
                          handleProfileClose();
                          EventManager.dispatch('OPEN_PROFILE_MODAL', { tab: 'plan' });
                        }}
                      >
                        <Crown size={16} />
                        {userSubscription && userSubscription.status === 'active'
                          ? `Manage Plan - ${SubscriptionService.getPlanDisplayName(userSubscription.planId)}`
                          : 'Upgrade Plan'}
                      </button>

                      <button
                        className="profile-action"
                        onClick={() => {
                          handleProfileClose();
                          EventManager.dispatch('OPEN_PROFILE_MODAL', { tab: 'account' });
                        }}
                      >
                        <User size={16} />
                        Account
                      </button>

                      <button
                        className="profile-action"
                        onClick={() => {
                          handleProfileClose();
                          EventManager.dispatch('OPEN_PROFILE_MODAL', { tab: 'usage' });
                        }}
                      >
                        <BarChart3 size={16} />
                        Usage
                      </button>
                      <button
                        className="profile-action"
                        onClick={() => {
                          handleProfileClose();
                          EventManager.dispatch('OPEN_PROFILE_MODAL', { tab: 'settings' });
                        }}
                      >
                        <Settings size={16} />
                        Settings
                      </button>
                      <button
                        className="profile-action logout"
                        onClick={handleLogout}
                      >
                        <LogOut size={16} />
                        Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="guest-header-actions">
              <button
                className="header-nav-link"
                onClick={() => navigate('/upgrade', { state: { fromApp: true } })}
              >
                Pricing
              </button>
              <button
                className="header-signin-btn"
                onClick={() => navigate('/login')}
              >
                Sign In
              </button>
              <button
                className="header-signup-btn"
                onClick={() => EventManager.dispatch(EVENT_TYPES.OPEN_AUTH_MODAL, { mode: 'signup' })}
              >
                Sign up
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
