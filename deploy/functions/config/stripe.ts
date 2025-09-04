import Stripe from 'stripe';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-08-27.basil',
});

export const STRIPE_CONFIG = {
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  secretKey: process.env.STRIPE_SECRET_KEY || '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  currency: 'usd',
  plans: {
    pro: {
      monthly: { priceId: process.env.STRIPE_PRO_MONTHLY_PRICE_ID || '', amount: 1900 },
      yearly: { priceId: process.env.STRIPE_PRO_YEARLY_PRICE_ID || '', amount: 19000 },
    },
    enterprise: {
      monthly: { priceId: process.env.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID || '', amount: 10000 },
      yearly: { priceId: process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID || '', amount: 100000 },
    },
  },
};

export default stripe;
