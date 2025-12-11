import Stripe from 'stripe';
import * as dotenv from 'dotenv';

// Load environment variables BEFORE accessing process.env (same as credit.config.ts)
dotenv.config({ path: '.env.local' });

// Validate Stripe secret key
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('❌ STRIPE_SECRET_KEY is not set in .env.local');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-08-27.basil',
});

export const STRIPE_CONFIG = {
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  secretKey: process.env.STRIPE_SECRET_KEY || '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  currency: 'gbp',
  plans: {
    pro: {
      monthly: { productId: process.env.STRIPE_PRO_MONTHLY_PRODUCT_ID || '', amount: 2000 }, // £20
      yearly: { productId: process.env.STRIPE_PRO_YEARLY_PRODUCT_ID || '', amount: 19200 }, // £192 (20 * 12 * 0.8)
    },
    enterprise: {
      monthly: { productId: process.env.STRIPE_ENTERPRISE_MONTHLY_PRODUCT_ID || '', amount: 10000 }, // £100
      yearly: { productId: process.env.STRIPE_ENTERPRISE_YEARLY_PRODUCT_ID || '', amount: 96000 }, // £960 (100 * 12 * 0.8)
    },
  },
};


/**
 * Get the default price ID from a Stripe product
 */
export async function getDefaultPriceFromProduct(productId: string): Promise<string> {
  if (!productId || productId.trim() === '') {
    throw new Error(
      '❌ Product ID is empty! Please check your .env.local file:\n' +
      '   STRIPE_PRO_MONTHLY_PRODUCT_ID=prod_xxx\n' +
      '   STRIPE_PRO_YEARLY_PRODUCT_ID=prod_xxx\n' +
      '   STRIPE_ENTERPRISE_MONTHLY_PRODUCT_ID=prod_xxx\n' +
      '   STRIPE_ENTERPRISE_YEARLY_PRODUCT_ID=prod_xxx'
    );
  }

  const product = await stripe.products.retrieve(productId);
  if (!product.default_price) {
    throw new Error(`Product ${productId} does not have a default price set in Stripe Dashboard`);
  }
  return typeof product.default_price === 'string'
    ? product.default_price
    : product.default_price.id;
}

export default stripe;
