import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { X, Check, Zap, Users, Building2, Crown, AlertCircle, ArrowUp, ArrowDown, FileText, Database, TrendingUp, Layers, Workflow, Info, Award, RotateCcw, Crosshair, MessageSquare } from 'lucide-react';
import { Plan, BillingCycle } from '../../types/payment';
import { useAuth } from '../../contexts/AuthContext';
import API_CONFIG from '../../config/api';
import SubscriptionService from '../../services/subscriptionService';
import EventManager, { EVENT_TYPES } from '../../utils/eventManager';
import ConfirmationModal from '../common/ConfirmationModal';
import SEO from '../common/SEO';
import ConfigService from '../../services/configService';
import { useCredits } from '../../hooks/useCredits';
import { useSubscription } from '../../hooks/useSubscription';
import { useTelemetry } from '../../hooks/useTelemetry';
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
  const [internalLoading, setInternalLoading] = useState(true);
  const [planCredits, setPlanCredits] = useState<{ free: number; pro: number; ultra: number; admin_test: number } | null>(null);
  const [dynamicPlans, setDynamicPlans] = useState<any>(null); // Store fetched pricing
  const [creditError, setCreditError] = useState<string | null>(null);

  const { credits: userCredits } = useCredits();
  const { subscription: boundSubscription, loading: subLoading } = useSubscription();

  const loading = internalLoading || subLoading;

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
  const location = useLocation();
  const { user } = useAuth();
  const { logEvent } = useTelemetry();

  const effectivePlanId: Plan | null =
    currentSubscription && currentSubscription.status === 'active'
      ? (currentSubscription.planId as Plan)
      : user
        ? 'free'
        : null;

  const hasLoggedViewRef = React.useRef<string | null>(null);

  // Telemetry: Track pricing page view and Stripe checkout cancellations
  useEffect(() => {
    if (!user?.uid || loading) return;
    // Prevent duplicate firing in React StrictMode or when async hooks resolve
    const visitKey = `${location.key || 'init'}_${location.search}`;
    if (hasLoggedViewRef.current === visitKey) return;
    hasLoggedViewRef.current = visitKey;

    const searchParams = new URLSearchParams(location.search);
    const wasCanceled = searchParams.get('canceled') === 'true';

    if (wasCanceled) {
      logEvent('telemetry_events', {
        eventType: 'checkout_canceled',
        metadata: { fromStripe: true }
      });
      // Clean ?canceled=true from the URL so refreshes or re-renders don't re-log it
      navigate('/pricing', { replace: true, state: location.state });
    } else {
      logEvent('telemetry_events', {
        eventType: 'pricing_page_viewed',
        metadata: {
          fromApp: Boolean((location.state as any)?.fromApp),
          entrySource: (location.state as any)?.source || ((location.state as any)?.fromLanding ? 'landing' : 'direct'),
          currentPlan: effectivePlanId || 'free',
          remainingCredits: userCredits?.remainingCredits ?? null
        }
      });
    }
  }, [user?.uid, loading, location.key, location.search, effectivePlanId, userCredits?.remainingCredits, logEvent, navigate, location.state]);

  // Fetch configuration and pricing
  useEffect(() => {
    const fetchCreditConfig = async () => {
      try {
        const data = await ConfigService.getCreditConfig();
        setPlanCredits(data.planCredits);
      } catch (error) {
        console.error('Error fetching credit config:', error);
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        setCreditError(`Cannot connect to server to fetch credit configuration: ${errorMsg}`);
        setConfirmationData({
          isOpen: true,
          title: 'Credit Configuration Error',
          message: `Cannot fetch credit values from backend server.\n\nError: ${errorMsg}`,
          confirmText: 'Understood',
          variant: 'danger',
          showCancel: false,
          action: () => { }
        });
      }
    };

    const fetchPricing = async () => {
      try {
        const data = await ConfigService.getPricing();
        setDynamicPlans(data);
      } catch (error) {
        console.error('Error fetching dynamic pricing:', error);
      }
    };

    fetchCreditConfig();
    fetchPricing();
  }, []);

  // Sync current subscription with hooks
  useEffect(() => {
    if (boundSubscription) {
      const mergedSubscription = { ...boundSubscription };
      if (userCredits) {
        (mergedSubscription as any).credits = userCredits;
      }
      setCurrentSubscription(mergedSubscription);
    } else {
      setCurrentSubscription(null);
    }
  }, [boundSubscription, userCredits]);

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
      logEvent('telemetry_events', {
        eventType: 'payment_or_system_error',
        metadata: {
          stage: 'client_subscription_action',
          action: 'cancel_schedule',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        }
      });
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

  const productSchema = {
    "@context": "https://schema.org/",
    "@type": "Product",
    "name": "AI Marking Subscription",
    "image": "https://aimarking.ai/logo-social-share.jpg",
    "description": "Spatial AI-powered examiner for GCSE & A-Level Maths, GCSE English Language, and custom mark schemes. Get instant grades, method marks (M1/A1), and step-by-step feedback.",
    "brand": { "@type": "Brand", "name": "AI Marking" },
    "offers": [
      {
        "@type": "Offer",
        "name": "Pro Plan",
        "url": "https://aimarking.ai/pricing",
        "price": "9.99",
        "priceCurrency": "GBP",
        "priceValidUntil": "2027-01-01",
        "availability": "https://schema.org/InStock",
        "shippingDetails": {
          "@type": "OfferShippingDetails",
          "shippingRate": { "@type": "MonetaryAmount", "value": "0", "currency": "GBP" },
          "deliveryTime": {
            "@type": "ShippingDeliveryTime",
            "handlingTime": { "@type": "QuantitativeValue", "minValue": 0, "maxValue": 0, "unitCode": "DAY" }
          }
        },
        "hasMerchantReturnPolicy": {
          "@type": "MerchantReturnPolicy",
          "applicableCountry": "GB",
          "returnPolicyCategory": "https://schema.org/NoReturns"
        }
      },
      {
        "@type": "Offer",
        "name": "Ultra Plan",
        "url": "https://aimarking.ai/pricing",
        "price": "19.99",
        "priceCurrency": "GBP",
        "priceValidUntil": "2027-01-01",
        "availability": "https://schema.org/InStock",
        "shippingDetails": {
          "@type": "OfferShippingDetails",
          "shippingRate": { "@type": "MonetaryAmount", "value": "0", "currency": "GBP" }
        },
        "hasMerchantReturnPolicy": {
          "@type": "MerchantReturnPolicy",
          "applicableCountry": "GB",
          "returnPolicyCategory": "https://schema.org/NoReturns"
        }
      }
    ]
  };

  // Don't render plans if credits haven't loaded
  if (!planCredits) {
    return (
      <div className="upgrade-page">
        <SEO
          title="Pricing & Plans"
          description="Choose the perfect plan for your AI marking needs. From free trials to unlimited GCSE maths grading. Get instant grades and marks for your working out."
          schemaData={productSchema}
          canonical="https://aimarking.ai/pricing"
          image="https://aimarking.ai/logo-social-share.jpg"
          themeColor="#1a93fe"
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

  const adminTestPlan = {
    id: 'admin_test' as Plan,
    name: 'Admin Test',
    price: dynamicPlans?.admin_test?.[billingCycle]?.amount || 0.01,
    name_short: 'Admin',
    description: 'Internal testing only.',
    icon: <Database size={24} />,
    features: [
      {
        icon: <CreditsIcon size={16} />,
        text: `Unlimited (Test) Credits`,
        tooltip: "Admin-only test plan for verified internal debugging."
      },
      {
        icon: <Zap size={16} />,
        text: 'Full System Access'
      }
    ],
    popular: false,
    adminOnly: true
  } as any;

  const creditTooltipText =
    "1 Credit = 1 full page of handwritten work analyzed (approx. 15–20 credits per full past paper). Marking scheme pages uploaded alongside custom papers are free and do not consume credits.";

  const plans = [
    {
      id: 'free' as Plan,
      name: 'Free',
      price: 0,
      description: 'Best for trying your first paper & quick score checks.',
      icon: <Zap size={24} />,
      features: [
        {
          icon: <CreditsIcon size={16} />,
          text: `${planCredits.free || 10} Monthly Credits`,
          subtext: `(Marks approx. 10 pages / half a past paper)`,
          tooltip: creditTooltipText
        },
        {
          icon: <Zap size={16} />,
          text: 'Instant Examiner-Standard AI Grading',
          subtext: 'GCSE & A-Level Maths, English & Custom Mark Schemes'
        },
        {
          icon: <Crosshair size={16} />,
          text: 'Reads messy handwriting, fractions & diagrams'
        },
        {
          icon: <Award size={16} />,
          text: 'Step-by-step method marks (M1/A1) & rubric feedback'
        },
        {
          icon: <RotateCcw size={16} />,
          text: 'Error-Carried-Forward (ECF) working out detection'
        }
      ],
      popular: false
    },
    {
      id: 'pro' as Plan,
      name: 'Pro',
      price: dynamicPlans?.pro?.[billingCycle]?.amount || (billingCycle === 'monthly' ? 9.99 : 95.90),
      description: 'Best for active weekly GCSE & A-Level revision.',
      icon: <Users size={24} />,
      features: [
        {
          icon: <CreditsIcon size={16} />,
          text: `${planCredits.pro || 200} Monthly Credits`,
          subtext: `(Marks approx. 10–13 full past papers / month)`,
          tooltip: creditTooltipText
        },
        {
          icon: <Crown size={16} />,
          text: 'Unlock All Pro & Reasoning AI Models',
          subtext: 'Switch freely between Fast and Deep Reasoning models'
        },
        {
          icon: <Layers size={16} />,
          text: 'Full-length paper uploads (up to 50+ pages per batch)'
        },
        {
          icon: <Award size={16} />,
          text: 'All Subjects: Maths, English Language & Any Mark Scheme'
        },
        {
          icon: <MessageSquare size={16} />,
          text: '24/7 AI Examiner Tutor Chat on every question'
        },
        {
          icon: <FileText size={16} />,
          text: 'Full Grade 9 / A* Model Answers & Mark Scheme Explanations'
        },
        {
          icon: <TrendingUp size={16} />,
          text: 'Performance Analytics & Weak Topic Discovery'
        }
      ],
      popular: true
    },
    {
      id: 'ultra' as Plan,
      name: 'Ultra',
      price: dynamicPlans?.ultra?.[billingCycle]?.amount || (billingCycle === 'monthly' ? 19.99 : 191.90),
      description: 'Best for heavy mock practice & multi-subject exam season.',
      icon: <Building2 size={24} />,
      features: [
        {
          icon: <CreditsIcon size={16} />,
          text: `${planCredits.ultra || 600} Monthly Credits`,
          subtext: `(3x Pro capacity • Marks approx. 30–40 full past papers)`,
          tooltip: creditTooltipText
        },
        {
          icon: <Check size={16} />,
          text: 'Everything in Pro included',
          subtext: 'Full access to all frontier & reasoning AI models'
        },
        {
          icon: <Zap size={16} />,
          text: 'Priority AI Grading Queue',
          subtext: 'Fastest turnaround during peak GCSE/A-Level exam weeks'
        },
        {
          icon: <Database size={16} />,
          text: 'Unlimited Permanent Mock Exam Archive'
        },
        {
          icon: <Users size={16} />,
          text: 'Priority Direct Support'
        }
      ],
      popular: false
    }
  ].filter(p => {
    // Cycle availability check
    if (p.id !== 'free' && dynamicPlans) {
      const planPrices = dynamicPlans[p.id];
      if (!planPrices || !planPrices[billingCycle]) {
        return false;
      }
    }
    return true;
  });

  // Helper function to get plan level for comparison
  const getPlanLevel = (planId: string) => {
    const levels: { [key: string]: number } = { free: 0, pro: 1, ultra: 2, admin_test: 3 };
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
    if (planId === effectivePlanId) {
      if (planId === 'free') {
        setConfirmationData({
          isOpen: true,
          title: 'Current Plan',
          message: 'You are currently on the Free plan. Choose Pro or Ultra to upgrade.',
          confirmText: 'OK',
          variant: 'primary',
          showCancel: false,
          action: () => { }
        });
        return;
      }

      const remaining = currentSubscription?.credits?.remainingCredits ?? userCredits?.remainingCredits ?? 100;
      const isLowCredits = remaining < 5;

      if (isLowCredits) {
        // ALLOW EARLY RENEWAL
        setConfirmationData({
          isOpen: true,
          title: 'Top Up Credits (Early Renewal)',
          message: `Your current credits are low (${(remaining || 0).toFixed(2)} remaining). Renewing your plan early will start a new billing cycle immediately and grant you a fresh allocation of ${SubscriptionService.getPlanDisplayName(planId)} credits.\n\nYou will be charged the full plan amount now. Do you want to proceed?`,
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

    const plan = [...plans, adminTestPlan].find(p => p.id === planId);
    if (!plan) return;

    // ============================================
    // CASE 3: Downgrade to Free (Cancel subscription)
    // ============================================
    if (planId === 'free' && currentSubscription && currentSubscription.planId !== 'free' && currentSubscription.planId !== 'admin_test') {
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
                billingCycle: currentSubscription.billingCycle || 'monthly'
              })
            });

            if (!response.ok) {
              const error = await response.json();
              throw new Error(error.details || error.error || 'Failed to cancel subscription');
            }

            const result = await response.json();

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
            logEvent('telemetry_events', {
              eventType: 'payment_or_system_error',
              metadata: {
                stage: 'client_subscription_action',
                planId,
                billingCycle,
                errorMessage: error instanceof Error ? error.message : 'Unknown error'
              }
            });
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
    if (currentSubscription && currentSubscription.planId !== 'free' && currentSubscription.planId !== 'admin_test') {
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
                  billingCycle: currentSubscription.billingCycle || 'monthly'
                })
              });

              if (!response.ok) {
                const error = await response.json();
                throw new Error(error.details || error.error || 'Failed to upgrade plan');
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
              logEvent('telemetry_events', {
                eventType: 'payment_or_system_error',
                metadata: {
                  stage: 'client_subscription_action',
                  planId,
                  billingCycle,
                  errorMessage: error instanceof Error ? error.message : 'Unknown error'
                }
              });
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
                  billingCycle: currentSubscription.billingCycle || 'monthly'
                })
              });

              if (!response.ok) {
                const error = await response.json();
                throw new Error(error.details || error.error || 'Failed to schedule downgrade');
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
              logEvent('telemetry_events', {
                eventType: 'payment_or_system_error',
                metadata: {
                  stage: 'client_subscription_action',
                  planId,
                  billingCycle,
                  errorMessage: error instanceof Error ? error.message : 'Unknown error'
                }
              });
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
    if (planId === 'free') {
      navigate('/app');
      return;
    }

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
          successUrl: `${window.location.origin}/app?subscription=success&plan=${planId}&cycle=${billingCycle}`,
          cancelUrl: `${window.location.origin}/pricing?canceled=true`,
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
      logEvent('telemetry_events', {
        eventType: 'payment_or_system_error',
        metadata: {
          stage: 'client_subscription_action',
          planId,
          billingCycle,
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        }
      });
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
    EventManager.dispatch(EVENT_TYPES.REFRESH_CREDITS);
  };

  // Handle billing cycle change
  const handleBillingCycleChange = (cycle: BillingCycle) => {
    setBillingCycle(cycle);
  };


  const isFromApp = location.state?.fromApp;

  return (
    <div className={`upgrade-page ${!isFromApp ? 'light-mode-forced' : ''}`}>
      <SEO
        title="Pricing & Plans"
        description="Choose the perfect plan for your AI marking needs. From free trials to unlimited GCSE maths grading. Get instant grades, method marks (M1), and ECF logic analysis."
        schemaData={productSchema}
        canonical="https://aimarking.ai/pricing"
        image="https://aimarking.ai/logo-social-share.jpg"
        themeColor="#1a93fe"
      />
      {/* Close Button - Top Right */}
      <button
        className="upgrade-page-close-button"
        onClick={() => {
          if (location.state?.fromLanding) {
            navigate('/');
          } else if (user) {
            navigate('/app');
          } else {
            navigate('/');
          }
        }}
      >
        <X size={24} />
      </button>

      <div className="upgrade-page-container">
        {/* Header */}
        <div className="upgrade-header">
          <h1>Subscription Plans</h1>
          <p>Choose the plan that is right for you.</p>
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
              <div className="scheduled-banner-header">
                <strong>
                  {currentSubscription.scheduledPlanId === 'free' ? 'Cancellation Scheduled' : 'Downgrade Scheduled'}
                </strong>
                <span className="scheduled-effective-badge">
                  Effective: {new Date(currentSubscription.scheduleEffectiveDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
              </div>
              <p className="scheduled-banner-subtitle">
                Your subscription will change to{' '}
                <strong>{SubscriptionService.getPlanDisplayName(currentSubscription.scheduledPlanId)}</strong> on{' '}
                {new Date(currentSubscription.scheduleEffectiveDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. You&apos;ll continue to have full access and credits until then.
              </p>
            </div>
            <button
              className="cancel-schedule-button"
              onClick={handleCancelSchedule}
            >
              Don&apos;t Cancel
            </button>
          </div>
        )}

        {/* Current Subscription Info - Compact */}
        {currentSubscription && currentSubscription.status === 'active' && currentSubscription.planId !== 'admin_test' && (
          <div className="current-subscription-compact">
            <div className="subscription-compact-content">
              <span className="compact-label">Current Plan:</span>
              <span className="compact-plan">{SubscriptionService.getPlanDisplayName(currentSubscription.planId)}</span>
              <span className="compact-divider">•</span>
              <span className="compact-billing">£{(currentSubscription.amount / 100 || 0).toFixed(2)}/{currentSubscription.billingCycle}</span>
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
                    {(currentSubscription.credits.remainingCredits || 0).toFixed(2)}/{(currentSubscription.credits.totalCredits || 0).toFixed(2)} credits
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Low-Credit / Depleted Alert Banner */}
        {userCredits && userCredits.remainingCredits < 5 && (
          <div className="low-credits-banner">
            <AlertCircle size={18} />
            <span>
              {effectivePlanId === 'free' ? (
                userCredits.remainingCredits <= 0
                  ? `You have exhausted your free credits (${userCredits.remainingCredits.toFixed(2)} remaining). Upgrade to Pro or Ultra below to unlock instant credits and continue marking.`
                  : `Your free credits are running low (${userCredits.remainingCredits.toFixed(2)} remaining). Upgrade to Pro or Ultra below to unlock instant credits and continue marking.`
              ) : (
                userCredits.remainingCredits <= 0
                  ? `You have 0 credits remaining (${userCredits.remainingCredits.toFixed(2)}). Upgrade your plan or click 'Top Up Credits' on your current plan for an immediate refill.`
                  : `Your credits are running low (${userCredits.remainingCredits.toFixed(2)} remaining). Upgrade your plan or click 'Top Up Credits' on your current plan for an immediate refill.`
              )}
            </span>
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
            <span className="upgrade-billing-save-badge">Get 2 Months Free</span>
          </span>
        </div>

        <p className="credit-explainer-pill">
          <CreditsIcon size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: '6px' }} />
          <strong>1 Credit = 1 Page Marked</strong> (A full past paper is ~15–20 pages • Mark scheme uploads are free)
        </p>

        {/* Admin Debug Bar */}
        {user?.isAdmin && (
          <div className="admin-plan-bar">
            <div className="admin-plan-bar-left">
              <span className="admin-plan-tag">🛠️ Admin Testing Plan</span>
              <span className="admin-plan-meta">
                £{((currentSubscription?.amount || 50) / 100).toFixed(2)}/mo • {(userCredits?.remainingCredits || 0).toFixed(0)} credits remaining
              </span>
            </div>
            <div className="admin-plan-bar-right">
              {currentSubscription?.planId === 'admin_test' ? (
                <span className="admin-plan-active-badge">Active (Admin Plan)</span>
              ) : (
                <button
                  className="admin-plan-switch-btn"
                  onClick={() => handleSubscribe('admin_test')}
                >
                  Switch to Admin Test
                </button>
              )}
            </div>
          </div>
        )}

        {/* Plans Grid */}
        <div className="upgrade-plans-grid">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`upgrade-plan-card ${plan.popular ? 'popular' : ''} ${selectedPlan === plan.id ? 'selected' : ''} ${plan.id === 'ultra' ? 'ultra' : ''} ${plan.id === effectivePlanId ? 'current-plan' : ''}`}
              onClick={() => handlePlanSelect(plan.id)}
            >
              {plan.id === effectivePlanId ? (
                <span className="current-plan-pill">CURRENT PLAN</span>
              ) : plan.popular ? (
                <div className="upgrade-plan-popular-badge">Most Popular</div>
              ) : null}

              <div className="upgrade-plan-header">
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
              </div>

              <div className="upgrade-plan-pricing">
                <div className="upgrade-plan-price">
                  {plan.price !== undefined ? (
                    billingCycle === 'yearly' && plan.price > 0 ? (
                      <>£{(plan.price / 12).toFixed(2)}</>
                    ) : (
                      <>£{plan.price}</>
                    )
                  ) : (
                    <span>£...</span>
                  )}
                  <span className="upgrade-plan-period"> / month</span>
                </div>
                {billingCycle === 'yearly' && plan.price > 0 ? (
                  <div className="upgrade-plan-yearly-subtext">
                    Billed £{plan.price.toFixed(2)} yearly (2 months free)
                  </div>
                ) : (
                  <div className="upgrade-plan-yearly-subtext">
                    {plan.price === 0 ? 'Free forever' : 'Billed monthly • Cancel anytime'}
                  </div>
                )}
              </div>

              <button
                onClick={() => handleSubscribe(plan.id)}
                disabled={
                  (plan.id === effectivePlanId && (plan.id === 'free' || ((currentSubscription?.credits?.remainingCredits ?? userCredits?.remainingCredits ?? 100) >= 5))) ||
                  (currentSubscription?.scheduledPlanId === plan.id) ||
                  (currentSubscription?.scheduledPlanId && currentSubscription.scheduledPlanId !== plan.id)
                }
                className={`upgrade-plan-subscribe-button ${plan.id === effectivePlanId
                  ? (plan.id !== 'free' && (currentSubscription?.credits?.remainingCredits ?? userCredits?.remainingCredits ?? 100) < 5) ? 'early-renewal' : 'current'
                  : (currentSubscription?.scheduledPlanId === plan.id)
                    ? 'scheduled'
                    : (currentSubscription && currentSubscription.planId !== 'admin_test' && getPlanLevel(plan.id) < getPlanLevel(currentSubscription.planId))
                      ? 'downgrade'
                      : (currentSubscription?.scheduledPlanId && currentSubscription.scheduledPlanId !== plan.id)
                        ? 'disabled'
                        : ''
                  }`}
              >
                {!user
                  ? plan.id === 'free'
                    ? 'Get Started'
                    : `Subscribe to ${plan.name}`
                  : plan.id === effectivePlanId
                    ? (plan.id !== 'free' && (currentSubscription?.credits?.remainingCredits ?? userCredits?.remainingCredits ?? 100) < 5)
                      ? 'Top Up Credits (Renew Now)'
                      : 'Current Plan'
                    : (currentSubscription?.scheduledPlanId === plan.id)
                      ? `Change Scheduled`
                      : (currentSubscription?.scheduledPlanId && currentSubscription.scheduledPlanId !== plan.id)
                        ? 'Change Pending'
                        : effectivePlanId === 'free'
                          ? `Subscribe to ${plan.name}`
                          : currentSubscription?.planId === 'admin_test'
                            ? `Switch to ${plan.name}`
                            : plan.id === 'free'
                              ? 'Downgrade to Free'
                              : currentSubscription && getPlanLevel(plan.id) < getPlanLevel(currentSubscription.planId)
                                ? `Downgrade to ${plan.name}`
                                : `Subscribe to ${plan.name}`
                }
              </button>

              {/* Single-line subtle helper text directly below CTA button */}
              {currentSubscription && currentSubscription.planId !== 'free' && currentSubscription.planId !== 'admin_test' && plan.id !== effectivePlanId && (
                <div className="plan-button-subtext">
                  {getPlanLevel(plan.id) > getPlanLevel(currentSubscription.planId) ? (
                    <span>Immediate effect • Prorated billing</span>
                  ) : (
                    <span>Takes effect at end of billing cycle</span>
                  )}
                </div>
              )}

              <ul className="upgrade-plan-features">
                {plan.features.map((feature: any, index: number) => (
                  <li key={index} className={feature.subtext ? 'has-subtext' : ''}>
                    {feature.icon || <Check size={16} />}
                    <div className="plan-feature-content">
                      <div className="plan-feature-main-row">
                        <span className="plan-feature-text">{feature.text}</span>
                        {(feature as any).tooltip && (
                          <div className="feature-tooltip-container">
                            <Info size={14} className="feature-info-icon" />
                            <div className="feature-tooltip-content">
                              {(feature as any).tooltip}
                            </div>
                          </div>
                        )}
                      </div>
                      {feature.subtext && (
                        <div className="plan-feature-subtext">{feature.subtext}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Trust Anchor Footer */}
        <div className="trust-anchor-footer">
          <div className="trust-anchor-content">
            <span className="trust-anchor-item">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
              </svg>
              <strong>GDPR Compliant</strong>
            </span>

            <span>Validated against <strong>2026 AI Quality Protocol</strong></span>

            <span>Papers are processed privately and not used for training</span>
          </div>
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
