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

const isLive = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_');

// Keep both sets of product IDs in the code
const STRIPE_PLANS = {
  test: {
    pro: {
      monthly: { productId: process.env.STRIPE_TEST_PRO_MONTHLY_PRODUCT_ID || process.env.STRIPE_PRO_MONTHLY_PRODUCT_ID || '' },
      yearly: { productId: process.env.STRIPE_TEST_PRO_YEARLY_PRODUCT_ID || process.env.STRIPE_PRO_YEARLY_PRODUCT_ID || '' },
    },
    ultra: {
      monthly: { productId: process.env.STRIPE_TEST_ULTRA_MONTHLY_PRODUCT_ID || process.env.STRIPE_ULTRA_MONTHLY_PRODUCT_ID || '' },
      yearly: { productId: process.env.STRIPE_TEST_ULTRA_YEARLY_PRODUCT_ID || process.env.STRIPE_ULTRA_YEARLY_PRODUCT_ID || '' },
    },
  },
  live: {
    pro: {
      monthly: { productId: process.env.STRIPE_LIVE_PRO_MONTHLY_PRODUCT_ID || '' },
      yearly: { productId: process.env.STRIPE_LIVE_PRO_YEARLY_PRODUCT_ID || '' },
    },
    ultra: {
      monthly: { productId: process.env.STRIPE_LIVE_ULTRA_MONTHLY_PRODUCT_ID || '' },
      yearly: { productId: process.env.STRIPE_LIVE_ULTRA_YEARLY_PRODUCT_ID || '' },
    },
  }
};

export const STRIPE_CONFIG = {
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  secretKey: process.env.STRIPE_SECRET_KEY || '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  currency: 'gbp',
  mode: isLive ? 'live' : 'test',
  plans: isLive ? STRIPE_PLANS.live : STRIPE_PLANS.test,
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
      '   STRIPE_ULTRA_MONTHLY_PRODUCT_ID=prod_xxx\n' +
      '   STRIPE_ULTRA_YEARLY_PRODUCT_ID=prod_xxx'
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
    return cachedPrices;
  }

  console.log('🔄 Fetching fresh prices from Stripe...');

  try {
    const plans: any = { pro: {}, ultra: {} };
    const tiers = ['pro', 'ultra'] as const;
    const cycles = ['monthly', 'yearly'] as const;

    // Create a list of all fetch operations to run in parallel
    const retrievalPromises: Promise<any>[] = [];
    const mapping: { tier: string, cycle: string }[] = [];

    for (const tier of tiers) {
      for (const cycle of cycles) {
        const productId = (STRIPE_CONFIG.plans as any)[tier][cycle].productId;
        if (productId) {
          retrievalPromises.push(stripe.products.retrieve(productId));
          mapping.push({ tier, cycle });
        }
      }
    }

    // Step 1: Fetch all products in parallel
    const products = await Promise.all(retrievalPromises);

    // Step 2: Extract price IDs and fetch all prices in parallel
    const priceRetrievalPromises: Promise<any>[] = [];
    const priceMapping: { tier: string, cycle: string }[] = [];

    products.forEach((product, index) => {
      const { tier, cycle } = mapping[index];
      if (product.default_price) {
        const priceId = typeof product.default_price === 'string'
          ? product.default_price
          : product.default_price.id;

        priceRetrievalPromises.push(stripe.prices.retrieve(priceId));
        priceMapping.push({ tier, cycle });
      }
    });

    const prices = await Promise.all(priceRetrievalPromises);

    // Map results back to the plans object
    prices.forEach((price, index) => {
      const { tier, cycle } = priceMapping[index];
      plans[tier][cycle] = {
        amount: (price.unit_amount || 0) / 100,
        currency: price.currency,
        priceId: price.id
      };
    });

    cachedPrices = plans;
    console.log('✅ Stripe prices fetched and cached');
    return plans;
  } catch (error) {
    console.error('❌ Failed to fetch Stripe prices:', error);
    throw error;
  }
}

export default stripe;
