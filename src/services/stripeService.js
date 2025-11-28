const { hasStripeConfig } = require('../utils/planConfig');

// Cache Price IDs to avoid recreating
const priceCache = {};

// Initialize Stripe
let stripe = null;
if (hasStripeConfig()) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

/**
 * Get or create Stripe Price for a plan
 * @param {Object} plan - Plan object with id, label, price
 * @returns {Promise<string>} Price ID
 */
const getOrCreatePrice = async (plan) => {
  if (!stripe) {
    throw new Error('Stripe not configured');
  }

  // Check cache first
  if (priceCache[plan.id]) {
    return priceCache[plan.id];
  }

  // Check env variable first
  const envPriceId = process.env[`STRIPE_PRICE_${plan.id.toUpperCase()}`];
  if (envPriceId && envPriceId !== `price_${plan.id}_xxx`) {
    priceCache[plan.id] = envPriceId;
    return envPriceId;
  }

  try {
    // Try to find existing product by name
    const productName = `Shadow Link - ${plan.label}`;
    const products = await stripe.products.list({
      limit: 100,
      active: true
    });

    let product = products.data.find(p => p.name === productName);

    // Create product if not exists
    if (!product) {
      console.log(`📦 Creating Stripe product: ${productName}`);
      product = await stripe.products.create({
        name: productName,
        description: plan.description,
        metadata: {
          planId: plan.id,
          source: 'auto-created'
        }
      });
    }

    // Find existing price for this product
    const prices = await stripe.prices.list({
      product: product.id,
      active: true,
      limit: 100
    });

    // Find price with matching amount
    const priceAmount = plan.price * 100; // Convert to cents
    let price = prices.data.find(p => 
      p.unit_amount === priceAmount && 
      p.currency === 'usd' && 
      p.type === 'one_time'
    );

    // Create price if not exists
    if (!price) {
      console.log(`💰 Creating Stripe price: ${productName} - $${plan.price}`);
      price = await stripe.prices.create({
        product: product.id,
        unit_amount: priceAmount,
        currency: 'usd',
        metadata: {
          planId: plan.id,
          source: 'auto-created'
        }
      });
    }

    // Cache the price ID
    priceCache[plan.id] = price.id;
    console.log(`✅ Using Stripe Price ID for ${plan.id}: ${price.id}`);

    return price.id;
  } catch (error) {
    console.error(`❌ Error creating/getting Stripe price for ${plan.id}:`, error.message);
    throw error;
  }
};

/**
 * Get Price ID for a plan (with auto-create if needed)
 * @param {string} planId - Plan ID (monthly/lifetime)
 * @returns {Promise<string|null>} Price ID or null if Stripe not configured
 */
const getPriceId = async (planId) => {
  if (!hasStripeConfig() || !stripe) {
    return null;
  }

  const { getPlanOrThrow } = require('../utils/planConfig');
  const plan = await getPlanOrThrow(planId);
  
  if (!plan) {
    throw new Error(`Plan ${planId} not found`);
  }

  try {
    return await getOrCreatePrice(plan);
  } catch (error) {
    console.error(`❌ Failed to get/create price for ${planId}:`, error.message);
    return null;
  }
};

module.exports = {
  getPriceId,
  getOrCreatePrice,
  stripe
};

