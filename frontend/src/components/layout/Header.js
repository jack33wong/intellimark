import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import SettingsModal from '../SettingsModal';
import UsageModal from '../UsageModal';
import {
  User,
  LogOut,
  Settings,
  ChevronDown,
  Crown,
  Calendar,
  CreditCard,
  CheckCircle,
  Bug,
  BarChart3
} from 'lucide-react';
import SubscriptionService from '../../services/subscriptionService.ts';
import API_CONFIG from '../../config/api';
import './Header.css';

const Header = ({ onMenuToggle, isSidebarOpen }) => {
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isProfileClosing, setIsProfileClosing] = useState(false);
  const [isSubscriptionDetailsOpen, setIsSubscriptionDetailsOpen] = useState(false);
  const [isSubscriptionDetailsClosing, setIsSubscriptionDetailsClosing] = useState(false);
  const [userSubscription, setUserSubscription] = useState(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isUsageModalOpen, setIsUsageModalOpen] = useState(false);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [debugMode, setDebugMode] = useState(localStorage.getItem('debugMode') === 'true');
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const profileRef = useRef(null);
  const subscriptionRef = useRef(null);

  // Debug mode is now passed per request, no need to sync with backend

  // Fetch user subscription data
  useEffect(() => {
    const fetchUserSubscription = async () => {
      if (!user?.uid) return;
      setSubscriptionLoading(true);
      try {
        const response = await SubscriptionService.getUserSubscription(user.uid);
        setUserSubscription(response.subscription);
      } catch (error) {
        console.error('Error fetching user subscription:', error);
      } finally {
        setSubscriptionLoading(false);
      }
    };

    fetchUserSubscription();
  }, [user?.uid]);

  // Check for subscription success parameter and create subscription record
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const subscriptionSuccess = urlParams.get('subscription');
    const sessionId = urlParams.get('session_id');

    if (subscriptionSuccess === 'success' && user?.uid && sessionId) {
      // Create subscription record after successful payment
      const createSubscriptionRecord = async () => {
        try {
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
            console.error('❌ Response error:', errorText);
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          await response.json();

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

      // Clean up URL parameters
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    } else if (subscriptionSuccess === 'success') {
    }
  }, [user?.uid]);

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

  const handleDebugModeToggle = () => {
    const newDebugMode = !debugMode;
    setDebugMode(newDebugMode);
    localStorage.setItem('debugMode', newDebugMode.toString());
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
      navigate('/upgrade');
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
      alert('Failed to cancel subscription. Please try again or contact support.');
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

        {/* Center - Navigation */}
        <nav className="header-nav">
          {user?.isAdmin && (
            <button
              className="nav-item admin-nav"
              onClick={() => navigate('/admin')}
            >
              Admin
            </button>
          )}

          {/* Debug Mode Toggle */}
          <button
            className={`nav-item debug-nav ${debugMode ? 'active' : ''}`}
            onClick={handleDebugModeToggle}
            title={debugMode ? 'Debug Mode ON - External APIs disabled' : 'Debug Mode OFF - External APIs enabled'}
          >
            <Bug size={16} />
            Debug {debugMode ? 'ON' : 'OFF'}
          </button>
        </nav>

        {/* Right side - Profile */}
        <div className="header-right">
          {user ? (
            <>
              <div className="subscription-section" ref={subscriptionRef}>
                <button
                  className="nav-item upgrade-nav"
                  onClick={handleUpgradeClick}
                >
                  {getUpgradeButtonIcon()}
                  {getUpgradeButtonText()}
                </button>

                {/* Subscription Details Dropdown */}
                {isSubscriptionDetailsOpen && userSubscription && (
                  <div className={`subscription-dropdown ${isSubscriptionDetailsClosing ? 'closing' : ''}`}>
                    <div className="subscription-dropdown-header">
                      <div className="subscription-title">
                        <Crown size={20} />
                        <span>{SubscriptionService.getPlanDisplayName(userSubscription.planId)} Plan</span>
                      </div>
                      <div className="subscription-status">
                        <CheckCircle size={16} />
                        <span className={`status ${userSubscription.status}`}>
                          {userSubscription.status.charAt(0).toUpperCase() + userSubscription.status.slice(1)}
                        </span>
                      </div>
                    </div>

                    <div className="subscription-details">
                      <div className="subscription-detail-item">
                        <CreditCard size={16} />
                        <div className="detail-content">
                          <span className="detail-label">Amount</span>
                          <span className="detail-value">
                            {formatAmount(userSubscription.amount, userSubscription.currency)}
                            <span className="billing-cycle">/{userSubscription.billingCycle}</span>
                          </span>
                        </div>
                      </div>

                      <div className="subscription-detail-item">
                        <Calendar size={16} />
                        <div className="detail-content">
                          <span className="detail-label">Current Period</span>
                          <span className="detail-value">
                            {formatDate(userSubscription.currentPeriodStart)} - {formatDate(userSubscription.currentPeriodEnd)}
                          </span>
                        </div>
                      </div>

                      <div className="subscription-detail-item">
                        <Calendar size={16} />
                        <div className="detail-content">
                          <span className="detail-label">Next Billing</span>
                          <span className="detail-value">
                            {formatDate(userSubscription.currentPeriodEnd)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="subscription-actions">
                      <button
                        className="subscription-action manage"
                        onClick={() => {
                          alert('Manage subscription feature coming soon!');
                          handleSubscriptionDetailsClose();
                        }}
                      >
                        Manage Subscription
                      </button>
                      <button
                        className="subscription-action cancel"
                        onClick={handleCancelSubscription}
                      >
                        Cancel Subscription
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
                    {user.photoURL ? (
                      <img src={user.photoURL} alt="Profile" />
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
                        {user.photoURL ? (
                          <img src={user.photoURL} alt="Profile" />
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
                          setIsUsageModalOpen(true);
                          handleProfileClose();
                        }}
                      >
                        <BarChart3 size={16} />
                        Usage
                      </button>
                      <button
                        className="profile-action"
                        onClick={() => {
                          setIsSettingsModalOpen(true);
                          handleProfileClose();
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
            <>
              <button
                className="nav-item upgrade-nav"
                onClick={() => navigate('/upgrade')}
              >
                Upgrade
              </button>
              <button
                className="login-button"
                onClick={() => navigate('/login')}
              >
                Sign In
              </button>
            </>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
      />

      {/* Usage Modal */}
      <UsageModal
        isOpen={isUsageModalOpen}
        onClose={() => setIsUsageModalOpen(false)}
      />
    </header>
  );
};

export default Header;
