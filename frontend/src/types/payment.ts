// Payment and subscription related type definitions

export type Plan = 'free' | 'pro' | 'enterprise';
export type BillingCycle = 'monthly' | 'yearly';

export interface PaymentPlan {
  planId: Plan;
  billingCycle: BillingCycle;
  amount: number;
  name: string;
}

export interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: string;
  client_secret: string;
}

export interface SubscriptionData {
  planId: Plan;
  billingCycle: BillingCycle;
  customerEmail: string;
  customerId?: string;
}

export interface SubscriptionResponse {
  subscriptionId: string;
  status: string;
  planId: Plan;
  billingCycle: BillingCycle;
  amount: number;
  currency: string;
  currentPeriodStart: number;
  currentPeriodEnd: number;
}

export interface PaymentFormProps {
  planId: Plan;
  billingCycle: BillingCycle;
  onSuccess: (subscriptionData: SubscriptionResponse) => void;
  onCancel: () => void;
}

export interface StripePaymentProps {
  planId: Plan;
  billingCycle: BillingCycle;
  onSuccess: (subscriptionData: SubscriptionResponse) => void;
  onCancel: () => void;
}

export interface PaymentError {
  type: string;
  code?: string;
  message: string;
}

export interface PaymentState {
  loading: boolean;
  error: PaymentError | null;
  paymentIntent: PaymentIntent | null;
  processing: boolean;
}

// Stripe-specific types
export interface StripeCardElement {
  // Stripe CardElement interface
}

export interface StripeElements {
  // Stripe Elements interface
}

export interface Stripe {
  // Stripe interface
}

export interface StripeCardElementOptions {
  style?: {
    base?: {
      fontSize?: string;
      color?: string;
      fontFamily?: string;
      '::placeholder'?: {
        color?: string;
      };
    };
    invalid?: {
      color?: string;
    };
  };
  hidePostalCode?: boolean;
}

// User subscription interface
export interface UserSubscription {
  userId: string;
  email: string;
  planId: Plan;
  billingCycle: BillingCycle;
  amount: number;
  currency: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: 'active' | 'canceled' | 'past_due' | 'unpaid';
  currentPeriodStart: number;
  currentPeriodEnd: number;
  createdAt: number;
  updatedAt: number;
}
