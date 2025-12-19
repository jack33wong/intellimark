import Stripe from 'stripe';
import * as dotenv from 'dotenv';

// Load environment variables BEFORE accessing process.env (same as credit.config.ts)
dotenv.config({ path: '.env.local' });

// Use singleton for in-memory caching (persists until server restart)
let cachedPrices: any = null;

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
      monthly: { productId: process.env.STRIPE_PRO_MONTHLY_PRODUCT_ID || '' },
      yearly: { productId: process.env.STRIPE_PRO_YEARLY_PRODUCT_ID || '' },
    },
    enterprise: {
      monthly: { productId: process.env.STRIPE_ENTERPRISE_MONTHLY_PRODUCT_ID || '' },
      yearly: { productId: process.env.STRIPE_ENTERPRISE_YEARLY_PRODUCT_ID || '' },
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

/**
 * Fetch plan prices from Stripe (Cached until server restart)
 */
export async function getPlanPrices() {
  if (cachedPrices) {
    console.log('✅ Returning cached Stripe prices');
    return cachedPrices;
  }

  console.log('🔄 Fetching fresh prices from Stripe...');

  try {
    const plans: any = { pro: {}, enterprise: {} };
    const tiers = ['pro', 'enterprise'];
    const cycles = ['monthly', 'yearly'];

    for (const tier of tiers) {
      for (const cycle of cycles) {
        const productId = (STRIPE_CONFIG.plans as any)[tier][cycle].productId;

        if (!productId) continue;

        const product = await stripe.products.retrieve(productId);

        if (product.default_price) {
          const priceId = typeof product.default_price === 'string'
            ? product.default_price
            : product.default_price.id;

          const price = await stripe.prices.retrieve(priceId);

          plans[tier][cycle] = {
            amount: (price.unit_amount || 0) / 100, // Convert cents to currency unit
            currency: price.currency,
            priceId: price.id
          };
        }
      }
    }

    cachedPrices = plans;
    console.log('✅ Stripe prices fetched and cached');
    return plans;
  } catch (error) {
    console.error('❌ Failed to fetch Stripe prices:', error);
    throw error;
  }
}

export default stripe;
