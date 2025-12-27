import React, { useState, useEffect, useCallback } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { useAuth } from '../../contexts/AuthContext';
import {
  PaymentFormProps,
  PaymentState,
  SubscriptionResponse,
  StripeCardElementOptions,
  StripePaymentProps
} from '../../types/payment';
import { ArrowLeft, CreditCard, Lock } from 'lucide-react';
import API_CONFIG from '../../config/api';
import './StripePayment.css';

const stripePromise = loadStripe(process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY || '');

const CARD_ELEMENT_OPTIONS: StripeCardElementOptions = {
  style: {
    base: {
      fontSize: '16px',
      color: '#ffffff',
      fontFamily: '"Inter", sans-serif',
      '::placeholder': {
        color: '#9ca3af',
      },
    },
    invalid: {
      color: '#ef4444',
    },
  },
  hidePostalCode: true,
};

const PaymentForm: React.FC<PaymentFormProps> = ({ planId, billingCycle, onSuccess, onCancel }) => {
  const [state, setState] = useState<PaymentState>({
    loading: false,
    error: null,
    paymentIntent: null,
    processing: false,
  });

  const stripe = useStripe();
  const elements = useElements();
  const { user } = useAuth();

  const createPaymentIntent = useCallback(async () => {
    if (!user?.email || !user?.uid) return;

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/payment/create-payment-intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          planId,
          billingCycle,
          customerEmail: user.email,
          customerId: user.uid,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setState(prev => ({
        ...prev,
        paymentIntent: data.paymentIntent,
        loading: false
      }));
    } catch (error) {
      console.error('Error creating payment intent:', error);
      setState(prev => ({
        ...prev,
        error: {
          type: 'api_error',
          message: 'Failed to create payment intent'
        },
        loading: false
      }));
    }
  }, [planId, billingCycle, user?.email, user?.uid]);

  useEffect(() => {
    createPaymentIntent();
  }, [createPaymentIntent]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!stripe || !elements || !state.paymentIntent) {
      return;
    }

    setState(prev => ({ ...prev, processing: true, error: null }));

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      setState(prev => ({
        ...prev,
        error: { type: 'validation_error', message: 'Card element not found' },
        processing: false
      }));
      return;
    }

    try {
      // Confirm the card payment
      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(
        state.paymentIntent.client_secret,
        {
          payment_method: {
            card: cardElement,
            billing_details: {
              email: user?.email,
            },
          },
        }
      );

      if (stripeError) {
        setState(prev => ({
          ...prev,
          error: {
            type: 'stripe_error',
            code: stripeError.code,
            message: stripeError.message || 'Payment failed'
          },
          processing: false
        }));
        return;
      }

      if (paymentIntent?.status === 'succeeded') {
        // Create subscription
        await createSubscription();
      }
    } catch (error) {
      console.error('Payment error:', error);
      setState(prev => ({
        ...prev,
        error: {
          type: 'payment_error',
          message: 'Payment processing failed'
        },
        processing: false
      }));
    }
  };

  const createSubscription = async () => {
    if (!user?.email || !user?.uid) return;

    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/api/payment/create-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          planId,
          billingCycle,
          customerEmail: user.email,
          customerId: user.uid,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const subscriptionData: SubscriptionResponse = await response.json();
      onSuccess(subscriptionData);
    } catch (error) {
      console.error('Error creating subscription:', error);
      setState(prev => ({
        ...prev,
        error: {
          type: 'subscription_error',
          message: 'Failed to create subscription'
        },
        processing: false
      }));
    }
  };

  const getPlanDisplayName = (planId: string) => {
    switch (planId) {
      case 'pro': return 'Pro';
      case 'ultra': return 'Ultra';
      default: return planId;
    }
  };

  const getBillingDisplayName = (cycle: string) => {
    return cycle === 'monthly' ? 'Monthly' : 'Yearly';
  };

  if (state.loading) {
    return (
      <div className="stripe-payment">
        <div className="payment-container">
          <div className="loading-spinner">
            <div className="spinner"></div>
            <p>Setting up payment...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stripe-payment">
      <div className="payment-container">
        <div className="payment-header">
          <button className="back-button" onClick={onCancel}>
            <ArrowLeft size={20} />
            Back to Plans
          </button>
          <h1>Complete Your Subscription</h1>
          <div className="plan-summary">
            <h2>{getPlanDisplayName(planId)} Plan - {getBillingDisplayName(billingCycle)}</h2>
            <div className="price-display">
              £{state.paymentIntent ? (state.paymentIntent.amount / 100).toFixed(2) : '0.00'}
              <span className="period">/{billingCycle === 'monthly' ? 'month' : 'year'}</span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="payment-form">
          <div className="payment-section">
            <h3>
              <CreditCard size={20} />
              Payment Information
            </h3>
            <div className="card-element-container">
              <CardElement options={CARD_ELEMENT_OPTIONS} />
            </div>
          </div>

          {state.error && (
            <div className="error-message">
              <p>{state.error.message}</p>
            </div>
          )}

          <div className="payment-actions">
            <button
              type="button"
              className="cancel-button"
              onClick={onCancel}
              disabled={state.processing}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="submit-button"
              disabled={!stripe || state.processing}
            >
              {state.processing ? (
                <>
                  <div className="button-spinner"></div>
                  Processing...
                </>
              ) : (
                <>
                  <Lock size={16} />
                  Subscribe Now
                </>
              )}
            </button>
          </div>

          <div className="security-notice">
            <Lock size={16} />
            <span>Your payment information is secure and encrypted</span>
          </div>
        </form>
      </div>
    </div>
  );
};

const StripePayment: React.FC<StripePaymentProps> = ({ planId, billingCycle, onSuccess, onCancel }) => {
  return (
    <Elements stripe={stripePromise}>
      <PaymentForm
        planId={planId}
        billingCycle={billingCycle}
        onSuccess={onSuccess}
        onCancel={onCancel}
      />
    </Elements>
  );
};

export default StripePayment;
