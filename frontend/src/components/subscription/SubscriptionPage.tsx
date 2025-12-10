import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Check, Zap, Users, Building2 } from 'lucide-react';
import { Plan, BillingCycle } from '../../types/payment';
import { useAuth } from '../../contexts/AuthContext';
import API_CONFIG from '../../config/api';
import './SubscriptionPage.css';

const SubscriptionPage: React.FC = () => {
  const [selectedPlan, setSelectedPlan] = useState<Plan>('pro');
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const navigate = useNavigate();
  const { user } = useAuth();

  const plans = [
    {
      id: 'free' as Plan,
      name: 'Free',
      price: 0,
      description: 'Perfect for getting started',
      icon: <Zap size={24} />,
      features: [
        'Limited marking submissions per month',
        'Limited marking result storage'
      ],
      popular: false
    },
    {
      id: 'pro' as Plan,
      name: 'Pro',
      price: billingCycle === 'monthly' ? 20 : 192, // 20 * 12 * 0.8 = 192 (20% off yearly)
      description: 'For serious students',
      icon: <Users size={24} />,
      features: [
        'Everything in free plus',
        'Extended limits on marking submission',
        'Extended marking result storage',
        'Full access to progress analysis'
      ],
      popular: true
    },
    {
      id: 'enterprise' as Plan,
      name: 'Enterprise',
      price: billingCycle === 'monthly' ? 100 : 960, // 100 * 12 * 0.8 = 960 (20% off yearly)
      description: 'For schools and institutions',
      icon: <Building2 size={24} />,
      features: [
        '20x of everything in Pro',
        'Support AI Model selection like gemini,openai'
      ],
      popular: false
    }
  ];

  const handlePlanSelect = (planId: Plan) => {
    setSelectedPlan(planId);
  };

  const handleSubscribe = async (planId: Plan) => {
    if (planId === 'free') {
      alert('You are already on the free plan!');
      return;
    }

    if (!user) {
      alert('Please sign in to subscribe to a plan.');
      navigate('/login');
      return;
    }

    const plan = plans.find(p => p.id === planId);
    if (!plan) return;

    try {
      // Create checkout session on backend
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/payment/create-checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          planId,
          billingCycle,
          userId: user.uid, // Include the user ID
          successUrl: `${window.location.origin}/mark-homework?subscription=success`,
          cancelUrl: `${window.location.origin}/upgrade?canceled=true`,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const { url } = await response.json();

      // Redirect to Stripe Checkout
      window.location.href = url;
    } catch (error) {
      console.error('Error creating checkout session:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to start checkout process. Please try again.';
      alert(`Error: ${errorMessage}`);
    }
  };



  return (
    <div className="upgrade-page">
      {/* Close Button - Top Right */}
      <button
        className="upgrade-page-close-button"
        onClick={() => navigate('/mark-homework')}
      >
        <X size={24} />
      </button>

      <div className="upgrade-page-container">
        {/* Header */}
        <div className="upgrade-page-header">
          <h1>Choose Your Plan</h1>
          <p>Unlock the full potential of AI-powered homework assistance</p>
        </div>

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
              className={`upgrade-plan-card ${plan.popular ? 'popular' : ''} ${selectedPlan === plan.id ? 'selected' : ''} ${plan.id === 'enterprise' ? 'enterprise' : ''}`}
              onClick={() => handlePlanSelect(plan.id)}
            >
              {plan.popular && <div className="upgrade-plan-popular-badge">Most Popular</div>}

              <div className="upgrade-plan-header">
                <div className="upgrade-plan-icon">{plan.icon}</div>
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
              </div>

              <div className="upgrade-plan-pricing">
                <div className="upgrade-plan-price">
                  £{plan.price}
                  <span className="upgrade-plan-period">/{billingCycle === 'monthly' ? 'month' : 'year'}</span>
                </div>
              </div>

              <button
                className={`upgrade-plan-subscribe-button ${plan.id === 'free' ? 'free' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSubscribe(plan.id);
                }}
              >
                {plan.id === 'free'
                  ? 'Current Plan'
                  : plan.id === 'pro'
                    ? 'Upgrade to Pro'
                    : 'Upgrade to Enterprise'
                }
              </button>

              <ul className="upgrade-plan-features">
                {plan.features.map((feature, index) => (
                  <li key={index}>
                    <Check size={16} />
                    {feature}
                  </li>
                ))}
              </ul>
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
