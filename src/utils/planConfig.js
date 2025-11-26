const plans = {
  monthly: {
    id: 'monthly',
    label: 'One-Month Access',
    description: 'Full feature access for 30 days',
    priceId: process.env.STRIPE_PRICE_MONTHLY,
    durationDays: 30,
    price: 40
  },
  lifetime: {
    id: 'lifetime',
    label: 'Lifetime Access',
    description: 'One-time purchase, permanent access',
    priceId: process.env.STRIPE_PRICE_LIFETIME,
    durationDays: null,
    price: 120
  }
};

const getPlanOrThrow = (planId) => {
  const plan = plans[planId];
  if (!plan) {
    throw new Error(`Plan ${planId} not found.`);
  }
  return plan;
};

const hasStripeConfig = () => {
  return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY);
};

module.exports = { plans, getPlanOrThrow, hasStripeConfig };
