import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Check, Zap, Users, Building2, Crown, AlertCircle, ArrowUp, ArrowDown, FileText, Database, TrendingUp, Layers, Workflow } from 'lucide-react';
import { Plan, BillingCycle } from '../../types/payment';
import { useAuth } from '../../contexts/AuthContext';
import API_CONFIG from '../../config/api';
import SubscriptionService from '../../services/subscriptionService';
import EventManager, { EVENT_TYPES } from '../../utils/eventManager';
import ConfirmationModal from '../common/ConfirmationModal';
import SEO from '../common/SEO';
import './SubscriptionPage.css';
import '../credits.css';

const CreditsIcon = ({ size = 16, className = "", style = {} }: { size?: number, className?: string, style?: React.CSSProperties }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 18 18"
    fill="none"
    width={size}
    height={size}
    color="currentColor"
    className={`credits-icon ${className}`}
    style={style}
  >
    <path d="M14.0914 0.721827C14.1534 0.535432 14.4171 0.535433 14.4791 0.721828L14.8291 1.77428C15.0324 2.38523 15.5117 2.8646 16.1227 3.06782L17.1751 3.41791C17.3615 3.47991 17.3615 3.74357 17.1751 3.80557L16.1227 4.15565C15.5117 4.35888 15.0324 4.83825 14.8291 5.4492L14.4791 6.50165C14.4171 6.68804 14.1534 6.68804 14.0914 6.50165L13.7413 5.4492C13.5381 4.83825 13.0587 4.35888 12.4478 4.15565L11.3953 3.80557C11.2089 3.74357 11.2089 3.47991 11.3953 3.41791L12.4478 3.06782C13.0587 2.8646 13.5381 2.38523 13.7413 1.77428L14.0914 0.721827Z" fill="currentColor"></path>
    <path d="M7.775 2.61733C7.93004 2.15141 8.58899 2.15137 8.74399 2.61733L9.68369 5.44228C10.1511 6.84743 11.2537 7.94995 12.6588 8.41738L15.4837 9.35781C15.9497 9.51282 15.9497 10.1718 15.4837 10.3268L15.1212 10.4469L12.6588 11.2665L12.3988 11.3617C11.1182 11.8732 10.1219 12.9243 9.68369 14.2416L8.86411 16.704L8.74399 17.0666L8.70883 17.1486C8.5215 17.5054 7.99668 17.5055 7.80942 17.1486L7.775 17.0666L6.83457 14.2416C6.39635 12.9243 5.40012 11.8731 4.11948 11.3617L3.85947 11.2665L1.03452 10.3268C0.568551 10.1718 0.568594 9.51286 1.03452 9.35781L1.39633 9.23696L3.85947 8.41738C5.17688 7.97916 6.22869 6.98304 6.74008 5.70229L6.83457 5.44228L7.775 2.61733ZM8.25839 5.91616C7.68028 7.65406 6.36564 9.04128 4.67612 9.71596L4.33335 9.84121L4.32968 9.84194L4.33335 9.84341L4.67612 9.96865C6.36559 10.6434 7.68031 12.0306 8.25839 13.7685L8.25913 13.7714L8.26059 13.7685L8.38584 13.4257C9.06049 11.736 10.4476 10.4215 12.1856 9.84341L12.1886 9.84194L12.1856 9.84121C10.4478 9.26312 9.06055 7.9484 8.38584 6.25893L8.26059 5.91616L8.25913 5.9125L8.25839 5.91616Z" fill="currentColor"></path>
  </svg>
);

const SubscriptionPage: React.FC = () => {
  const [selectedPlan, setSelectedPlan] = useState<Plan>('pro');
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [currentSubscription, setCurrentSubscription] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [planCredits, setPlanCredits] = useState<{ free: number; pro: number; ultra: number } | null>(null);
  const [dynamicPlans, setDynamicPlans] = useState<any>(null); // Store fetched pricing
  const [creditError, setCreditError] = useState<string | null>(null);

  // Confirmation Modal State
  const [confirmationData, setConfirmationData] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    onClose?: () => void;
    showCancel?: boolean;
    variant: 'primary' | 'danger' | 'warning' | 'success';
    action: () => Promise<void> | void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    variant: 'primary',
    showCancel: true,
    action: () => { }
  });

  const navigate = useNavigate();
  const { user } = useAuth();

  // Fetch configuration and pricing
  useEffect(() => {
    const fetchCreditConfig = async () => {
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/api/config/credits`);
        if (!response.ok) {
          throw new Error(`Failed to fetch credit config: ${response.status}`);
        }
        const data = await response.json();
        setPlanCredits(data.planCredits);
      } catch (error) {
        console.error('Error fetching credit config:', error);
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        setCreditError(`Cannot connect to server to fetch credit configuration: ${errorMsg}`);
        setConfirmationData({
          isOpen: true,
          title: 'Credit Configuration Error',
          message: `Cannot fetch credit values from backend server.\n\nError: ${errorMsg}\n\nPlease ensure:\n1. Backend server is running\n2. /api/config/credits endpoint is registered\n3. Backend .env.local has credit variables set`,
          confirmText: 'Understood',
          variant: 'danger',
          showCancel: false,
          action: () => { }
        });
      }
    };

    const fetchPricing = async () => {
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/api/payment/plans`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.plans) {
            setDynamicPlans(data.plans);
          }
        }
      } catch (error) {
        console.error('Error fetching dynamic pricing:', error);
      }
    };

    fetchCreditConfig();
    fetchPricing();
  }, []);

  // Fetch current subscription
  useEffect(() => {
    const fetchSubscription = async () => {
      if (!user?.uid) {
        setLoading(false);
        return;
      }
      try {
        const response = await SubscriptionService.getUserSubscription(user.uid);
        const subscription = response.subscription;

        // Fetch credits if subscription exists
        if (subscription) {
          try {
            const creditsResponse = await fetch(`${API_CONFIG.BASE_URL}/api/credits/${user.uid}`);
            if (creditsResponse.ok) {
              const creditsData = await creditsResponse.json();
              (subscription as any).credits = creditsData;
            }
          } catch (creditsError) {
            console.error('Error fetching credits:', creditsError);
          }
        }

        setCurrentSubscription(subscription);
      } catch (error) {
        console.error('Error fetching subscription:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchSubscription();
  }, [user]);

  // Cancel scheduled plan change
  const handleCancelSchedule = async () => {
    if (!user?.uid) return;

    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/payment/cancel-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Refresh subscription data
        const subResponse = await fetch(`${API_CONFIG.BASE_URL}/api/payment/user-subscription/${user.uid}`);
        if (subResponse.ok) {
          const subData = await subResponse.json();
          setCurrentSubscription(subData.subscription);
        }
      } else {
        setConfirmationData({
          isOpen: true,
          title: 'Cancellation Failed',
          message: data.error || 'Failed to cancel scheduled downgrade',
          confirmText: 'OK',
          variant: 'danger',
          showCancel: false,
          action: () => { }
        });
      }
    } catch (error) {
      console.error('Error cancelling schedule:', error);
      setConfirmationData({
        isOpen: true,
        title: 'Error',
        message: 'Error cancelling scheduled downgrade',
        confirmText: 'OK',
        variant: 'danger',
        showCancel: false,
        action: () => { }
      });
    }
  };

  // Don't render plans if credits haven't loaded
  if (!planCredits) {
    return (
      <div className="upgrade-page">
        <SEO
          title="Pricing & Plans"
          description="Choose the perfect plan for your AI marking needs. From free trials to unlimited GCSE maths grading."
        />
        <div className="upgrade-page-container">
          <div className="upgrade-page-header">
            <h1>Loading Credit Configuration...</h1>
            {creditError && (
              <p style={{ color: 'var(--function-error)' }}>
                {creditError}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const plans = [
    {
      id: 'free' as Plan,
      name: 'Free',
      price: 0,
      description: 'Perfect for getting started',
      icon: <Zap size={24} />,
      features: [
        {
          icon: <CreditsIcon size={16} style={{ display: 'inline', verticalAlign: 'middle' }} />,
          text: `${planCredits.free} credits per month`
        },
        {
          icon: <FileText size={16} />,
          text: 'Limited marking submissions'
        },
        {
          icon: <Database size={16} />,
          text: 'Limited marking result storage'
        }
      ],
      popular: false
    },
    {
      id: 'pro' as Plan,
      name: 'Pro',
      price: dynamicPlans?.pro?.[billingCycle]?.amount,
      description: 'For serious students',
      icon: <Users size={24} />,
      features: [
        {
          icon: <CreditsIcon size={16} style={{ display: 'inline', verticalAlign: 'middle' }} />,
          text: `${planCredits.pro} credits per month`
        },
        {
          icon: <FileText size={16} />,
          text: 'Extended marking submissions'
        },
        {
          icon: <Database size={16} />,
          text: 'Extended marking result storage'
        },
        {
          icon: <TrendingUp size={16} />,
          text: 'Full access to progress analysis'
        },
        {
          icon: <Workflow size={16} />,
          text: 'AI Model selection (Gemini, OpenAI)'
        }
      ],
      popular: true
    },
    {
      id: 'ultra' as Plan,
      name: 'Ultra',
      price: dynamicPlans?.ultra?.[billingCycle]?.amount,
      description: 'For Serious Achievers',
      icon: <Building2 size={24} />,
      features: [
        {
          icon: <CreditsIcon size={16} style={{ display: 'inline', verticalAlign: 'middle' }} />,
          text: `${planCredits.ultra} credits per month`
        },
        {
          icon: <Layers size={16} />,
          text: '3x of everything in Pro'
        }
      ],
      popular: false
    }
  ];

  // Helper function to get plan level for comparison
  const getPlanLevel = (planId: string) => {
    const levels: { [key: string]: number } = { free: 0, pro: 1, ultra: 2 };
    return levels[planId] || 0;
  };

  const handlePlanSelect = (planId: Plan) => {
    setSelectedPlan(planId);
  };

  const handleSubscribe = async (planId: Plan) => {
    if (!user) {
      setConfirmationData({
        isOpen: true,
        title: 'Sign In Required',
        message: 'Please sign in to subscribe to a plan.',
        confirmText: 'Sign In',
        variant: 'primary',
        showCancel: true,
        action: () => { navigate('/login'); }
      });
      navigate('/login');
      return;
    }

    // ============================================
    // CASE 1: Already on this plan
    // ============================================
    if (planId === currentSubscription?.planId) {
      const remaining = currentSubscription?.credits?.remainingCredits ?? 100;
      const isLowCredits = remaining < 5;

      if (isLowCredits) {
        // ALLOW EARLY RENEWAL
        setConfirmationData({
          isOpen: true,
          title: 'Top Up Credits (Early Renewal)',
          message: `Your current credits are low (${remaining.toFixed(2)} remaining). Renewing your plan early will start a new billing cycle immediately and grant you a fresh allocation of ${SubscriptionService.getPlanDisplayName(planId)} credits.\n\nYou will be charged the full plan amount now. Do you want to proceed?`,
          confirmText: 'Renew Early & Top Up',
          variant: 'success',
          showCancel: true,
          action: async () => {
            // PROCEED TO CHECKOUT (Same logic as CASE 5)
            await createCheckoutSession(planId);
          }
        });
        return;
      } else {
        setConfirmationData({
          isOpen: true,
          title: 'Already Subscribed',
          message: 'You are already on this plan with sufficient credits!',
          confirmText: 'OK',
          variant: 'primary',
          showCancel: false,
          action: () => { }
        });
        return;
      }
    }

    // ============================================
    // CASE 2: Already scheduled this plan
    // ============================================
    if (planId === currentSubscription?.scheduledPlanId) {
      setConfirmationData({
        isOpen: true,
        title: 'Change Pending',
        message: `Change to ${SubscriptionService.getPlanDisplayName(planId)} is already scheduled.`,
        confirmText: 'OK',
        variant: 'primary',
        showCancel: false,
        action: () => { }
      });
      return;
    }

    // ============================================
    // CASE 2b: Block if ANY other schedule exists
    // ============================================
    if (currentSubscription?.scheduledPlanId && planId !== currentSubscription.scheduledPlanId) {
      setConfirmationData({
        isOpen: true,
        title: 'Plan Change Already Scheduled',
        message: `You already have a change scheduled to ${SubscriptionService.getPlanDisplayName(currentSubscription.scheduledPlanId)}. Please cancel the existing schedule before making another change.`,
        confirmText: 'OK',
        variant: 'warning',
        showCancel: false,
        action: () => { }
      });
      return;
    }

    const plan = plans.find(p => p.id === planId);
    if (!plan) return;

    // ============================================
    // CASE 3: Downgrade to Free (Cancel subscription)
    // ============================================
    if (planId === 'free' && currentSubscription && currentSubscription.planId !== 'free') {
      setConfirmationData({
        isOpen: true,
        title: 'Cancel Subscription',
        message: `Your subscription will be cancelled at the end of your current billing period. You will keep your ${SubscriptionService.getPlanDisplayName(currentSubscription.planId)} benefits and credits until ${new Date(currentSubscription.currentPeriodEnd * 1000).toLocaleDateString()}. Are you sure you want to cancel?`,
        confirmText: 'Cancel Subscription',
        variant: 'danger',
        action: async () => {
          try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/api/payment/change-plan`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: user.uid,
                newPlanId: 'free',
                billingCycle: currentSubscription.billingCycle
              })
            });

            if (!response.ok) {
              const error = await response.json();
              throw new Error(error.details || 'Failed to cancel subscription');
            }

            const result = await response.json();

            // Show Success Modal (reusing confirmation modal but just for info, or use alert for simple success)
            // For now, simple alert is fine for success feedback, or we could add a success modal state.
            // Let's stick to alert for success to keep it simple as requested "confirmation modal" replacement.
            setConfirmationData({
              isOpen: true,
              title: 'Subscription Cancelled',
              message: `Your plan will end on ${new Date(result.effectiveDate).toLocaleDateString()}.\nYou'll keep your current benefits and credits until then.`,
              confirmText: 'OK',
              variant: 'success',
              showCancel: false,
              action: () => { }
            });

            // Refresh subscription data
            const subResponse = await SubscriptionService.getUserSubscription(user.uid);
            setCurrentSubscription(subResponse.subscription);
            EventManager.dispatch(EVENT_TYPES.SUBSCRIPTION_UPDATED, { subscription: subResponse.subscription });
            refreshHeaderData();
          } catch (error) {
            console.error('Error cancelling subscription:', error);
            setConfirmationData({
              isOpen: true,
              title: 'Cancellation Failed',
              message: `Failed to cancel subscription: ${error instanceof Error ? error.message : 'Unknown error'}`,
              confirmText: 'OK',
              variant: 'danger',
              showCancel: false,
              action: () => { }
            });
          }
        }
      });
      return;
    }

    // ============================================
    // CASE 4: Plan Changes on Existing Subscription
    // Upgrades: Immediate via /change-plan
    // Downgrades: Scheduled via /change-plan
    // ============================================
    if (currentSubscription && currentSubscription.planId !== 'free') {
      const currentLevel = getPlanLevel(currentSubscription.planId);
      const newLevel = getPlanLevel(planId);
      const isUpgrade = newLevel > currentLevel;
      const isDowngrade = newLevel < currentLevel;

      if (isUpgrade) {
        setConfirmationData({
          isOpen: true,
          title: `Upgrade to ${plan.name}`,
          message: `You will be charged a prorated amount for the upgrade immediately. Your new credits and features will be available right away. Do you want to proceed?`,
          confirmText: `Upgrade to ${plan.name}`,
          variant: 'primary',
          action: async () => {
            try {
              const response = await fetch(`${API_CONFIG.BASE_URL}/api/payment/change-plan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  userId: user.uid,
                  newPlanId: planId,
                  billingCycle: currentSubscription.billingCycle
                })
              });

              if (!response.ok) {
                const error = await response.json();
                throw new Error(error.details || 'Failed to upgrade plan');
              }

              const result = await response.json();
              setConfirmationData({
                isOpen: true,
                title: 'Upgrade Successful',
                message: `✅ Upgraded to ${plan.name}!\n\nYour new credits are now available.`,
                confirmText: 'Awesome!',
                variant: 'success',
                showCancel: false,
                action: () => {
                  EventManager.dispatch(EVENT_TYPES.REFRESH_CREDITS);
                  navigate('/app');
                }
              });

              // Refresh subscription data
              const subResponse = await SubscriptionService.getUserSubscription(user.uid);
              setCurrentSubscription(subResponse.subscription);
              EventManager.dispatch(EVENT_TYPES.SUBSCRIPTION_UPDATED, { subscription: subResponse.subscription });
              refreshHeaderData();
            } catch (error) {
              console.error('Error upgrading plan:', error);
              setConfirmationData({
                isOpen: true,
                title: 'Upgrade Failed',
                message: `Failed to upgrade: ${error instanceof Error ? error.message : 'Unknown error'}`,
                confirmText: 'OK',
                variant: 'danger',
                showCancel: false,
                action: () => { }
              });
            }
          }
        });
        return;
      } else if (isDowngrade) {
        setConfirmationData({
          isOpen: true,
          title: `Downgrade to ${plan.name}`,
          message: `Your subscription will automatically downgrade at the end of your current billing period. You will retain your ${SubscriptionService.getPlanDisplayName(currentSubscription.planId)} benefits until ${new Date(currentSubscription.currentPeriodEnd * 1000).toLocaleDateString()}. Confirm downgrade?`,
          confirmText: `Downgrade`,
          variant: 'warning',
          action: async () => {
            try {
              const response = await fetch(`${API_CONFIG.BASE_URL}/api/payment/change-plan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  userId: user.uid,
                  newPlanId: planId,
                  billingCycle: currentSubscription.billingCycle
                })
              });

              if (!response.ok) {
                const error = await response.json();
                throw new Error(error.details || 'Failed to schedule downgrade');
              }

              const result = await response.json();
              setConfirmationData({
                isOpen: true,
                title: 'Downgrade Scheduled',
                message: `Your plan will downgrade to ${plan.name} on ${new Date(result.effectiveDate).toLocaleDateString()}.\nYou'll keep your current benefits and credits until then.`,
                confirmText: 'OK',
                variant: 'success',
                showCancel: false,
                action: () => { }
              });

              // Refresh subscription data
              const subResponse = await SubscriptionService.getUserSubscription(user.uid);
              setCurrentSubscription(subResponse.subscription);
              EventManager.dispatch(EVENT_TYPES.SUBSCRIPTION_UPDATED, { subscription: subResponse.subscription });
              refreshHeaderData();
            } catch (error) {
              console.error('Error scheduling downgrade:', error);
              setConfirmationData({
                isOpen: true,
                title: 'Downgrade Failed',
                message: `Failed to schedule downgrade: ${error instanceof Error ? error.message : 'Unknown error'}`,
                confirmText: 'OK',
                variant: 'danger',
                showCancel: false,
                action: () => { }
              });
            }
          }
        });
        return;
      }
    }

    // ============================================
    // CASE 5: New Subscription / Early Renewal
    // ============================================
    await createCheckoutSession(planId);
  };

  /**
   * Helper to create a Checkout Session (used for new subs and early renewal)
   */
  const createCheckoutSession = async (planId: Plan) => {
    if (!user?.uid) {
      navigate('/login');
      return;
    }
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/payment/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId,
          billingCycle,
          userId: user.uid,
          successUrl: `${window.location.origin}/app?subscription=success`,
          cancelUrl: `${window.location.origin}/upgrade?canceled=true`,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const { url: checkoutUrl } = await response.json();

      // Redirect to Stripe Checkout
      window.location.href = checkoutUrl;
    } catch (error) {
      console.error('Error creating checkout session:', error);
      setConfirmationData({
        isOpen: true,
        title: 'Checkout Error',
        message: 'Failed to create checkout session. Please try again.',
        confirmText: 'OK',
        variant: 'danger',
        showCancel: false,
        action: () => { }
      });
    }
  };

  // Refresh Header data when subscription changes
  const refreshHeaderData = () => {
    if (typeof window.refreshHeaderSubscription === 'function') {
      window.refreshHeaderSubscription();
    }
  };

  // Handle billing cycle change
  const handleBillingCycleChange = (cycle: BillingCycle) => {
    setBillingCycle(cycle);
  };


  return (
    <div className="upgrade-page">
      {/* Close Button - Top Right */}
      <button
        className="upgrade-page-close-button"
        onClick={() => navigate('/app')}
      >
        <X size={24} />
      </button>

      <div className="upgrade-page-container">
        {/* Header */}
        <div className="upgrade-header">
          <h1>Subscription Plans</h1>
          <p>Choose the plan that is right for you</p>
        </div>

        <ConfirmationModal
          isOpen={confirmationData.isOpen}
          onClose={() => {
            if (confirmationData.onClose) confirmationData.onClose();
            setConfirmationData(prev => ({ ...prev, isOpen: false }));
          }}
          onConfirm={() => {
            confirmationData.action();
            setConfirmationData(prev => ({ ...prev, isOpen: false }));
          }}
          title={confirmationData.title}
          message={confirmationData.message}
          confirmText={confirmationData.confirmText}
          variant={confirmationData.variant}
          showCancel={confirmationData.showCancel}
        />

        {/* Scheduled Change Banner */}
        {currentSubscription?.scheduledPlanId && (
          <div className="scheduled-banner">
            <div className="scheduled-banner-content">
              <AlertCircle size={20} />
              <div className="scheduled-banner-text">
                <strong>Plan Change Scheduled</strong>
                <span>
                  Your plan will downgrade to <strong>{currentSubscription.scheduledPlanId}</strong> on{' '}
                  {new Date(currentSubscription.scheduleEffectiveDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </span>
              </div>
            </div>
            <button
              className="cancel-schedule-button"
              onClick={handleCancelSchedule}
            >
              Cancel Downgrade
            </button>
          </div>
        )}

        {/* Current Subscription Info - Compact */}
        {currentSubscription && currentSubscription.status === 'active' && (
          <div className="current-subscription-compact">
            <div className="subscription-compact-content">
              <span className="compact-label">Current Plan:</span>
              <span className="compact-plan">{SubscriptionService.getPlanDisplayName(currentSubscription.planId)}</span>
              <span className="compact-divider">•</span>
              <span className="compact-billing">£{(currentSubscription.amount / 100).toFixed(2)}/{currentSubscription.billingCycle}</span>
              {currentSubscription.planId !== 'free' && (
                <>
                  <span className="compact-divider">•</span>
                  <span className="compact-next">Next: {new Date(currentSubscription.currentPeriodEnd * 1000).toLocaleDateString()}</span>
                </>
              )}
              {currentSubscription.credits && (
                <>
                  <span className="compact-divider">•</span>
                  <span className={`compact-credits ${currentSubscription.credits.remainingCredits < 5 ? 'low-credits' : ''}`}>
                    <CreditsIcon size={14} style={{ display: 'inline', marginRight: '4px' }} />
                    {currentSubscription.credits.remainingCredits.toFixed(2)}/{currentSubscription.credits.totalCredits.toFixed(2)} credits
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Billing Toggle */}
        <div className="upgrade-billing-toggle">
          <span className={billingCycle === 'monthly' ? 'active' : ''}>Monthly</span>
          <button
            className={`upgrade-billing-toggle-switch ${billingCycle === 'yearly' ? 'yearly' : ''}`}
            onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'yearly' : 'monthly')}
          >
            <div className="upgrade-billing-toggle-slider"></div>
          </button>
          <span className={billingCycle === 'yearly' ? 'active' : ''}>
            Yearly
            <span className="upgrade-billing-save-badge">Save 20%</span>
          </span>
        </div>

        {/* Plans Grid */}
        <div className="upgrade-plans-grid">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`upgrade-plan-card ${plan.popular ? 'popular' : ''} ${selectedPlan === plan.id ? 'selected' : ''} ${plan.id === 'ultra' ? 'ultra' : ''} ${plan.id === currentSubscription?.planId ? 'current-plan' : ''}`}
              onClick={() => handlePlanSelect(plan.id)}
            >
              {plan.popular && <div className="upgrade-plan-popular-badge">Most Popular</div>}

              <div className="upgrade-plan-header">
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
              </div>

              <div className="upgrade-plan-pricing">
                <div className="upgrade-plan-price">
                  {plan.price !== undefined ? (
                    <>
                      £{plan.price}
                    </>
                  ) : (
                    <span className="price-loading">£...</span>
                  )}
                  <span className="upgrade-plan-period"> / {billingCycle === 'monthly' ? 'month' : 'year'}</span>
                </div>
              </div>

              <button
                onClick={() => handleSubscribe(plan.id)}
                disabled={
                  (plan.id === currentSubscription?.planId && (currentSubscription?.credits?.remainingCredits ?? 100) >= 5) ||
                  (currentSubscription?.scheduledPlanId === plan.id) ||
                  (currentSubscription?.scheduledPlanId && currentSubscription.scheduledPlanId !== plan.id)
                }
                className={`upgrade-plan-subscribe-button ${plan.id === currentSubscription?.planId
                  ? (currentSubscription?.credits?.remainingCredits ?? 100) < 5 ? 'early-renewal' : 'current'
                  : (currentSubscription?.scheduledPlanId === plan.id)
                    ? 'scheduled'
                    : (currentSubscription?.scheduledPlanId && currentSubscription.scheduledPlanId !== plan.id)
                      ? 'disabled'
                      : ''
                  }`}
              >
                {plan.id === currentSubscription?.planId
                  ? (currentSubscription?.credits?.remainingCredits ?? 100) < 5
                    ? 'Top Up Credits'
                    : 'Current Plan'
                  : (currentSubscription?.scheduledPlanId === plan.id)
                    ? `Change Scheduled`
                    : (currentSubscription?.scheduledPlanId && currentSubscription.scheduledPlanId !== plan.id)
                      ? 'Change Pending'
                      : !currentSubscription
                        ? plan.id === 'free'
                          ? 'Get Started'
                          : `Subscribe to ${plan.name}`
                        : plan.id === 'free'
                          ? 'Downgrade to Free'
                          : currentSubscription && getPlanLevel(plan.id) < getPlanLevel(currentSubscription.planId)
                            ? `Downgrade to ${plan.name}`
                            : `Upgrade to ${plan.name}`
                }
              </button>

              <ul className="upgrade-plan-features">
                {plan.features.map((feature, index) => (
                  <li key={index}>
                    {feature.icon || <Check size={16} />}
                    <span className="feature-text">{feature.text}</span>
                  </li>
                ))}
              </ul>

              {/* Plan Change Info - Moved to bottom */}
              {currentSubscription && currentSubscription.planId !== 'free' && plan.id !== currentSubscription.planId && (
                <div className="plan-change-info">
                  {getPlanLevel(plan.id) > getPlanLevel(currentSubscription.planId) ? (
                    // Show upgrade info for any upgrade (Pro->Enterprise, Free->Pro, etc)
                    <div className="upgrade-info">
                      <ArrowUp size={14} />
                      <span>Upgrade: Immediate effect.</span>
                    </div>
                  ) : (
                    // Show downgrade info when going down
                    <div className="downgrade-info">
                      <ArrowDown size={14} />
                      <span>Downgrade: Takes effect at period end.</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="upgrade-page-footer">
          <p>Questions? Contact us at <a href="mailto:support@aimarking.ai">support@aimarking.ai</a></p>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionPage;
