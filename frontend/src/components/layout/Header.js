import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import EventManager from '../../utils/eventManager';
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
  LayoutDashboard
} from 'lucide-react';
import SubscriptionService from '../../services/subscriptionService.ts';
import API_CONFIG from '../../config/api';
import './Header.css';
import '../credits.css';

const Header = ({ onMenuToggle, isSidebarOpen }) => {
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isProfileClosing, setIsProfileClosing] = useState(false);
  const [isSubscriptionDetailsOpen, setIsSubscriptionDetailsOpen] = useState(false);
  const [isSubscriptionDetailsClosing, setIsSubscriptionDetailsClosing] = useState(false);
  const [userSubscription, setUserSubscription] = useState(null);
  const [userCredits, setUserCredits] = useState(null);

  const [subscriptionLoading, setSubscriptionLoading] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [avatarError, setAvatarError] = useState(false);
  const profileRef = useRef(null);
  const subscriptionRef = useRef(null);



  // Fetch user subscription and credits data
  useEffect(() => {
    const fetchUserSubscription = async () => {
      if (!user?.uid) return;
      setSubscriptionLoading(true);
      try {
        // Add timestamp to prevent caching
        const timestamp = Date.now();
        const response = await SubscriptionService.getUserSubscription(user.uid);
        setUserSubscription(response.subscription);

        // Fetch credits with cache-busting
        try {
          const creditsResponse = await fetch(`${API_CONFIG.BASE_URL}/api/credits/${user.uid}?t=${timestamp}`, {
            cache: 'no-store'
          });
          if (creditsResponse.ok) {
            const creditsData = await creditsResponse.json();
            setUserCredits(creditsData);
          }
        } catch (creditsError) {
          console.error('Error fetching credits:', creditsError);
        }
      } catch (error) {
        console.error('Error fetching user subscription:', error);
      } finally {
        setSubscriptionLoading(false);
      }
    };

    fetchUserSubscription();
  }, [user?.uid, refreshKey]);

  // Expose refresh function globally for other components to trigger
  useEffect(() => {
    window.refreshHeaderSubscription = () => {
      setRefreshKey(prev => prev + 1);
    };
    return () => {
      delete window.refreshHeaderSubscription;
    };
  }, []);

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

      // Refresh credits after successful subscription
      setTimeout(async () => {
        try {
          const timestamp = Date.now();
          const creditsResponse = await fetch(`${API_CONFIG.BASE_URL}/api/credits/${user.uid}?t=${timestamp}`, {
            cache: 'no-store'
          });
          if (creditsResponse.ok) {
            const creditsData = await creditsResponse.json();
            setUserCredits(creditsData);
            console.log('✅ Credits synced after subscription:', creditsData);
          }
        } catch (creditsError) {
          console.error('Error syncing credits:', creditsError);
        }
      }, 1000); // Wait 1 second for backend to initialize credits

      // Clean up URL parameters
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
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
        {/* Center - Navigation - Removed Admin link from here */}
        <nav className="header-nav">
          {/* Empty or removed if no other items */}
        </nav>

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
                >
                  <CreditIcon size={16} className="credits-icon" />
                  <span className="credits-count">{userCredits?.remainingCredits ?? 0}</span>
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
                      {(!userSubscription || userSubscription.status !== 'active') && (
                        <button
                          className="upgrade-btn-small"
                          onClick={() => {
                            navigate('/upgrade');
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
                        <div className="credits-value-main">{userCredits?.remainingCredits ?? 0}</div>
                        <div className="credits-value-sub">{userCredits?.totalCredits ?? 0}</div>
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
    </header>
  );
};

export default Header;
