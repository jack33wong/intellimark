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
    admin_test: {
      monthly: { productId: 'prod_U5Xgps0aVFgjYH' },
      yearly: { productId: '' },
    }
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
    admin_test: {
      monthly: { productId: 'prod_U5Xgps0aVFgjYH' },
      yearly: { productId: '' },
    }
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
    const plans: any = { pro: {}, ultra: {}, admin_test: {} };
    const tiers = ['pro', 'ultra', 'admin_test'] as const;
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

    // Step 1: Fetch all products (settled to avoid 500 on missing products)
    const settledProducts = await Promise.allSettled(retrievalPromises);

    // Step 2: Extract price IDs and fetch all prices
    const priceRetrievalPromises: Promise<any>[] = [];
    const priceMapping: { tier: string, cycle: string }[] = [];

    settledProducts.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const product = result.value;
        const { tier, cycle } = mapping[index];
        if (product.default_price) {
          const priceId = typeof product.default_price === 'string'
            ? product.default_price
            : product.default_price.id;

          priceRetrievalPromises.push(stripe.prices.retrieve(priceId));
          priceMapping.push({ tier, cycle });
        }
      } else {
        const { tier, cycle } = mapping[index];
        console.warn(`⚠️ Failed to retrieve Stripe product for ${tier} ${cycle}:`, result.reason?.message || result.reason);
      }
    });

    const settledPrices = await Promise.allSettled(priceRetrievalPromises);

    // Map results back to the plans object
    settledPrices.forEach((result, index) => {
      const { tier, cycle } = priceMapping[index];
      if (result.status === 'fulfilled') {
        const price = result.value;
        plans[tier][cycle] = {
          amount: (price.unit_amount || 0) / 100,
          currency: price.currency,
          priceId: price.id
        };
      } else {
        console.warn(`⚠️ Failed to retrieve Stripe price for ${tier} ${cycle}:`, result.reason?.message || result.reason);
      }
    });

    cachedPrices = plans;
    console.log('✅ Stripe prices fetched and cached (with resilience)');
    return plans;
  } catch (error) {
    console.error('❌ Critical failure in getPlanPrices:', error);
    throw error;
  }
}

export default stripe;
