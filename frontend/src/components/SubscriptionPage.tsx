import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Zap, Users, Building2 } from 'lucide-react';
import { Plan, BillingCycle } from '../types/payment';
import './SubscriptionPage.css';

const SubscriptionPage: React.FC = () => {
  const [selectedPlan, setSelectedPlan] = useState<Plan>('pro');
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const navigate = useNavigate();

  const plans = [
    {
      id: 'free' as Plan,
      name: 'Free',
      price: 0,
      description: 'Perfect for getting started',
      icon: <Zap size={24} />,
      features: [
        '5 homework submissions per month',
        'Basic AI feedback',
        'Standard response time',
        'Email support'
      ],
      popular: false
    },
    {
      id: 'pro' as Plan,
      name: 'Pro',
      price: billingCycle === 'monthly' ? 19 : 190,
      description: 'For serious students',
      icon: <Users size={24} />,
      features: [
        'Unlimited homework submissions',
        'Advanced AI feedback with detailed explanations',
        'Priority response time',
        'Math step-by-step solutions',
        'Priority email support',
        'Export homework reports'
      ],
      popular: true
    },
    {
      id: 'enterprise' as Plan,
      name: 'Enterprise',
      price: billingCycle === 'monthly' ? 100 : 1000,
      description: 'For schools and institutions',
      icon: <Building2 size={24} />,
      features: [
        'Everything in Pro',
        'Multi-teacher dashboard',
        'Bulk student management',
        'Custom integrations',
        'Dedicated support',
        'Custom branding',
        'Advanced analytics'
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

    const plan = plans.find(p => p.id === planId);
    if (!plan) return;

    try {
      // Create checkout session on backend
      const response = await fetch('/api/payment/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          planId,
          billingCycle,
          successUrl: `${window.location.origin}/upgrade?success=true`,
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
    <div className="subscription-page">
      <div className="subscription-container">
        {/* Header */}
        <div className="subscription-header">
          <button 
            className="back-button"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft size={20} />
            Back
          </button>
          <h1>Choose Your Plan</h1>
          <p>Unlock the full potential of AI-powered homework assistance</p>
        </div>

        {/* Billing Toggle */}
        <div className="billing-toggle">
          <span className={billingCycle === 'monthly' ? 'active' : ''}>Monthly</span>
          <button
            className={`toggle-switch ${billingCycle === 'yearly' ? 'yearly' : ''}`}
            onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'yearly' : 'monthly')}
          >
            <div className="toggle-slider"></div>
          </button>
          <span className={billingCycle === 'yearly' ? 'active' : ''}>
            Yearly
            <span className="save-badge">Save 20%</span>
          </span>
        </div>

        {/* Plans Grid */}
        <div className="plans-grid">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`plan-card ${plan.popular ? 'popular' : ''} ${selectedPlan === plan.id ? 'selected' : ''}`}
              onClick={() => handlePlanSelect(plan.id)}
            >
              {plan.popular && <div className="popular-badge">Most Popular</div>}
              
              <div className="plan-header">
                <div className="plan-icon">{plan.icon}</div>
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
              </div>

              <div className="plan-pricing">
                <div className="price">
                  ${plan.price}
                  <span className="period">/{billingCycle === 'monthly' ? 'month' : 'year'}</span>
                </div>
              </div>

              <button
                className={`subscribe-button ${plan.id === 'free' ? 'free' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSubscribe(plan.id);
                }}
              >
                {plan.id === 'free' ? 'Current Plan' : 'Subscribe Now'}
              </button>

              <ul className="plan-features">
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

        {/* FAQ Section */}
        <div className="faq-section">
          <h2>Frequently Asked Questions</h2>
          <div className="faq-grid">
            <div className="faq-item">
              <h3>Can I change my plan anytime?</h3>
              <p>Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately.</p>
            </div>
            <div className="faq-item">
              <h3>What payment methods do you accept?</h3>
              <p>We accept all major credit cards through our secure Stripe payment system.</p>
            </div>
            <div className="faq-item">
              <h3>Is there a free trial?</h3>
              <p>Yes! Start with our free plan and upgrade when you're ready for more features.</p>
            </div>
            <div className="faq-item">
              <h3>Can I cancel anytime?</h3>
              <p>Absolutely. Cancel your subscription anytime with no cancellation fees.</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="subscription-footer">
          <p>Questions? Contact us at <a href="mailto:support@intellimark.com">support@intellimark.com</a></p>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionPage;
