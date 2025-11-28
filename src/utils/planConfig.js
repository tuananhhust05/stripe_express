const PlanPrice = require('../models/PlanPrice');

// Base plan configuration (without price)
const basePlans = {
  monthly: {
    id: 'monthly',
    label: 'One-Month Access',
    description: 'Full feature access for 30 days',
    priceId: process.env.STRIPE_PRICE_MONTHLY,
    durationDays: 30,
    defaultPrice: 40
  },
  lifetime: {
    id: 'lifetime',
    label: 'Lifetime Access',
    description: 'One-time purchase, permanent access',
    priceId: process.env.STRIPE_PRICE_LIFETIME,
    durationDays: null,
    defaultPrice: 120
  }
};

// Get plans with prices from database (or use defaults)
const getPlans = async () => {
  try {
    const planPrices = await PlanPrice.find({}).lean();
    const priceMap = {};
    planPrices.forEach(pp => {
      priceMap[pp.planId] = pp.price;
    });

    const plans = {};
    Object.keys(basePlans).forEach(planId => {
      plans[planId] = {
        ...basePlans[planId],
        price: priceMap[planId] || basePlans[planId].defaultPrice
      };
    });

    return plans;
  } catch (error) {
    console.error('Error loading plan prices:', error);
    // Fallback to defaults
    const plans = {};
    Object.keys(basePlans).forEach(planId => {
      plans[planId] = {
        ...basePlans[planId],
        price: basePlans[planId].defaultPrice
      };
    });
    return plans;
  }
};

// Get plans synchronously (for backward compatibility, uses defaults)
const plans = {};
Object.keys(basePlans).forEach(planId => {
  plans[planId] = {
    ...basePlans[planId],
    price: basePlans[planId].defaultPrice
  };
});

const getPlanOrThrow = async (planId) => {
  const allPlans = await getPlans();
  const plan = allPlans[planId];
  if (!plan) {
    throw new Error(`Plan ${planId} not found.`);
  }
  return plan;
};

// Synchronous version (for backward compatibility)
const getPlanOrThrowSync = (planId) => {
  const plan = plans[planId];
  if (!plan) {
    throw new Error(`Plan ${planId} not found.`);
  }
  return plan;
};

// Initialize default prices in database
const initializePlanPrices = async () => {
  try {
    for (const planId of Object.keys(basePlans)) {
      const existing = await PlanPrice.findOne({ planId });
      if (!existing) {
        await PlanPrice.create({
          planId,
          price: basePlans[planId].defaultPrice,
          updatedBy: 'system'
        });
        console.log(`✅ Initialized plan price for ${planId}: $${basePlans[planId].defaultPrice}`);
      }
    }
  } catch (error) {
    console.error('Error initializing plan prices:', error);
  }
};

const hasStripeConfig = () => {
  return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY);
};

module.exports = { 
  plans, 
  basePlans,
  getPlans, 
  getPlanOrThrow, 
  getPlanOrThrowSync,
  initializePlanPrices,
  hasStripeConfig 
};
