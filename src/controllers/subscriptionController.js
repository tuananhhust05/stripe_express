const User = require('../models/User');
const { stripe } = require('../services/stripeService');
const { getPlanOrThrow } = require('../utils/planConfig');

/**
 * Get current subscription status
 */
const getSubscriptionStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    let subscriptionDetails = null;
    let serviceEnabled = true; // Default to true if not set
    
    // Priority: Use user.subscriptionPlan from database (most accurate)
    // For lifetime plan, user won't have subscriptionId, so trust database
    let finalPlan = user.subscriptionPlan;
    
    // IMPORTANT: If user has lifetime plan, NEVER sync from Stripe subscription
    // Lifetime plan doesn't have subscription, so trust database value
    if (user.subscriptionPlan === 'lifetime') {
      // For lifetime plan, check customer metadata for serviceEnabled
      if (user.stripeCustomerId && stripe) {
        try {
          const customer = await stripe.customers.retrieve(user.stripeCustomerId);
          serviceEnabled = customer.metadata?.serviceEnabled !== 'false';
        } catch (err) {
          console.error('❌ Error retrieving customer from Stripe:', err.message);
        }
      }
      
      // Clear subscriptionId if it exists (shouldn't happen, but clean up)
      if (user.subscriptionId) {
        console.log('⚠️ User has lifetime plan but still has subscriptionId, clearing it:', {
          userId: user._id,
          subscriptionId: user.subscriptionId
        });
        user.subscriptionId = null;
        user.subscriptionCurrentPeriodEnd = null;
        await user.save();
      }
    } else if (user.subscriptionId && stripe) {
      // Only sync from Stripe if user has subscriptionId AND plan is NOT lifetime
      try {
        const subscription = await stripe.subscriptions.retrieve(user.subscriptionId);
        subscriptionDetails = {
          id: subscription.id,
          status: subscription.status,
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
          plan: subscription.items.data[0]?.price?.metadata?.planId || null
        };
        // Get serviceEnabled from subscription metadata
        serviceEnabled = subscription.metadata?.serviceEnabled !== 'false';
        
        // Sync subscription info to User model (update from Stripe)
        // But NEVER change plan to/from lifetime via Stripe sync
        const planId = subscription.items.data[0]?.price?.metadata?.planId || 
                       subscription.metadata?.planId || 
                       'monthly';
        
        // Only update if not lifetime (lifetime should only be set via payment, not subscription)
        if (planId !== 'lifetime' && user.subscriptionPlan !== 'lifetime') {
          user.subscriptionStatus = subscription.status;
          user.subscriptionPlan = 'monthly';
          user.subscriptionCurrentPeriodEnd = subscription.current_period_end 
            ? new Date(subscription.current_period_end * 1000) 
            : null;
          await user.save();
          finalPlan = user.subscriptionPlan;
        }
        
        console.log('✅ Subscription synced from Stripe (getSubscriptionStatus):', {
          userId: user._id,
          subscriptionId: subscription.id,
          currentPeriodEnd: user.subscriptionCurrentPeriodEnd,
          plan: finalPlan
        });
      } catch (err) {
        console.error('❌ Error retrieving subscription from Stripe:', err.message);
        // If subscription not found and user has subscriptionId, might be canceled
        if (err.code === 'resource_missing') {
          // Only clear if user doesn't have lifetime plan
          if (user.subscriptionPlan !== 'lifetime') {
            user.subscriptionId = null;
            user.subscriptionStatus = 'canceled';
            await user.save();
          }
        }
      }
    } else if (user.stripeCustomerId && stripe) {
      // For no subscription, check customer metadata
      try {
        const customer = await stripe.customers.retrieve(user.stripeCustomerId);
        serviceEnabled = customer.metadata?.serviceEnabled !== 'false';
      } catch (err) {
        console.error('❌ Error retrieving customer from Stripe:', err.message);
      }
    }

    res.json({
      success: true,
      subscription: {
        status: user.subscriptionStatus,
        plan: finalPlan, // Use finalPlan which respects lifetime plan
        currentPeriodEnd: user.subscriptionCurrentPeriodEnd,
        subscriptionId: user.subscriptionId,
        serviceEnabled: serviceEnabled,
        details: subscriptionDetails
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create checkout session for subscription
 */
const createSubscriptionCheckout = async (req, res, next) => {
  try {
    const { planKey } = req.body;
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (!planKey || !['monthly', 'lifetime'].includes(planKey)) {
      return res.status(400).json({
        success: false,
        error: 'Valid planKey (monthly or lifetime) is required'
      });
    }

    if (!stripe) {
      return res.status(500).json({
        success: false,
        error: 'Stripe is not configured'
      });
    }

    const plan = await getPlanOrThrow(planKey);
    const { getPriceId, stripe: stripeInstance } = require('../services/stripeService');
    
    // Get or create Stripe customer first
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripeInstance.customers.create({
        email: user.email,
        name: user.name || undefined,
        metadata: {
          userId: user._id.toString()
        }
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
      console.log('✅ Created Stripe customer for user:', {
        userId: user._id,
        email: user.email,
        customerId: customerId
      });
    }

    // Get or create price (will create recurring for monthly, one-time for lifetime)
    let priceId = await getPriceId(planKey);

    if (!priceId) {
      return res.status(500).json({
        success: false,
        error: 'Failed to get price for plan'
      });
    }

    // Verify price type matches the checkout mode
    try {
      const price = await stripeInstance.prices.retrieve(priceId);
      const isRecurring = price.type === 'recurring';
      const needsRecurring = planKey === 'monthly';
      
      if (needsRecurring && !isRecurring) {
        // Need to create a new recurring price
        console.log('⚠️ Price is not recurring, creating new recurring price for monthly plan');
        const productId = price.product;
        const priceAmount = plan.price * 100;
        
        const newPrice = await stripeInstance.prices.create({
          product: productId,
          unit_amount: priceAmount,
          currency: 'usd',
          recurring: {
            interval: 'month'
          },
          metadata: {
            planId: planKey,
            source: 'auto-created-recurring'
          }
        });
        
        priceId = newPrice.id;
        console.log('✅ Created recurring price:', priceId);
      } else if (!needsRecurring && isRecurring) {
        // Need one-time price for lifetime
        console.log('⚠️ Price is recurring, creating new one-time price for lifetime plan');
        const productId = price.product;
        const priceAmount = plan.price * 100;
        
        const newPrice = await stripeInstance.prices.create({
          product: productId,
          unit_amount: priceAmount,
          currency: 'usd',
          metadata: {
            planId: planKey,
            source: 'auto-created-onetime'
          }
        });
        
        priceId = newPrice.id;
        console.log('✅ Created one-time price:', priceId);
      }
    } catch (priceError) {
      console.error('❌ Error verifying price:', priceError.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to verify price type'
      });
    }

    // Create checkout session for subscription
    const sessionConfig = {
      mode: planKey === 'lifetime' ? 'payment' : 'subscription',
      customer: customerId,
      payment_method_types: ['card'],
      metadata: {
        userId: user._id.toString(),
        planId: planKey,
        email: user.email
      },
      line_items: [{
        price: priceId,
        quantity: 1
      }],
      success_url: `${process.env.APP_BASE_URL || (req.protocol + '://' + req.get('host'))}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_BASE_URL || (req.protocol + '://' + req.get('host'))}/subscription/cancel`
    };

    // For subscription mode, ensure no trial period - subscription should be active immediately
    if (planKey === 'monthly') {
      sessionConfig.subscription_data = {
        metadata: {
          planId: planKey,
          userId: user._id.toString(),
          email: user.email
        }
        // No trial_period_days or trial_end - subscription will be active immediately
      };
    }

    const session = await stripeInstance.checkout.sessions.create(sessionConfig);

    console.log('✅ Subscription checkout session created:', {
      sessionId: session.id,
      userId: user._id,
      planKey
    });

    res.json({
      success: true,
      checkoutUrl: session.url,
      sessionId: session.id
    });
  } catch (error) {
    console.error('❌ Error creating subscription checkout:', error);
    next(error);
  }
};

/**
 * Upgrade or downgrade subscription
 * - Downgrade lifetime → monthly: Create subscription without charge (free)
 * - Upgrade monthly → lifetime: Charge price difference
 */
const changeSubscription = async (req, res, next) => {
  try {
    const { planKey } = req.body;
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (!planKey || !['monthly', 'lifetime'].includes(planKey)) {
      return res.status(400).json({
        success: false,
        error: 'Valid planKey (monthly or lifetime) is required'
      });
    }

    if (!stripe) {
      return res.status(500).json({
        success: false,
        error: 'Stripe is not configured'
      });
    }

    const currentPlan = user.subscriptionPlan;
    
    // Check if user already has the requested plan
    if (currentPlan === planKey) {
      return res.status(400).json({
        success: false,
        error: `User already has ${planKey} plan`
      });
    }

    const { getPlans } = require('../utils/planConfig');
    const plans = await getPlans();
    const newPlan = plans[planKey];
    const { getPriceId } = require('../services/stripeService');
    const newPriceId = await getPriceId(planKey);

    if (!newPriceId) {
      return res.status(500).json({
        success: false,
        error: 'Failed to get price for plan'
      });
    }

    // Ensure user has Stripe customer
    if (!user.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name || undefined,
        metadata: {
          userId: user._id.toString()
        }
      });
      user.stripeCustomerId = customer.id;
      await user.save();
    }

    // Case 1: Downgrade from lifetime to monthly (FREE - no charge for first month)
    if (currentPlan === 'lifetime' && planKey === 'monthly') {
      // Use checkout session to allow user to add payment method
      // Customer may not have payment method attached (lifetime was one-time payment)
      const monthlyPriceId = await getPriceId('monthly');
      const plan = await getPlanOrThrow('monthly');

      // For downgrade from lifetime to monthly: first month is FREE
      // Use trial period to make first month free, then convert to active immediately
      // This ensures no charge for first month while subscription is active
      const sessionConfig = {
        mode: 'subscription',
        customer: user.stripeCustomerId,
        payment_method_types: ['card'],
        metadata: {
          userId: user._id.toString(),
          planId: 'monthly',
          email: user.email,
          action: 'downgrade',
          fromPlan: 'lifetime'
        },
        line_items: [{
          price: monthlyPriceId,
          quantity: 1
        }],
        subscription_data: {
          metadata: {
            planId: 'monthly',
            userId: user._id.toString(),
            email: user.email,
            downgradedFrom: 'lifetime'
          },
          // Use 1 month trial to make first month free
          // We'll convert trialing to active immediately in webhook handler
          trial_period_days: 30
        },
        success_url: `${process.env.APP_BASE_URL || (req.protocol + '://' + req.get('host'))}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.APP_BASE_URL || (req.protocol + '://' + req.get('host'))}/subscription/cancel`
      };

      const session = await stripe.checkout.sessions.create(sessionConfig);

      console.log('✅ Checkout session created for downgrade (lifetime → monthly, first month free):', {
        sessionId: session.id,
        userId: user._id,
        email: user.email,
        method: 'trial_period_30_days'
      });

      return res.json({
        success: true,
        message: 'Please complete checkout to switch to monthly plan. First month is free, then $' + plan.price.toFixed(2) + ' per month.',
        checkoutUrl: session.url,
        sessionId: session.id
      });
    }

    // Case 2: Upgrade from monthly to lifetime (charge price difference)
    if (currentPlan === 'monthly' && planKey === 'lifetime') {
      if (!user.subscriptionId) {
        return res.status(400).json({
          success: false,
          error: 'No active subscription found'
        });
      }

      // Retrieve current subscription
      const subscription = await stripe.subscriptions.retrieve(user.subscriptionId);
      
      // Calculate price difference
      const monthlyPrice = plans.monthly.price;
      const lifetimePrice = plans.lifetime.price;
      
      // Calculate how much user has already paid for current period
      const periodStart = subscription.current_period_start;
      const periodEnd = subscription.current_period_end;
      const now = Math.floor(Date.now() / 1000);
      const periodDuration = periodEnd - periodStart;
      const timeUsed = now - periodStart;
      const timeRemaining = periodEnd - now;
      const usedRatio = timeUsed / periodDuration;
      const paidAmount = monthlyPrice * usedRatio;
      
      // Price difference = lifetime price - (monthly price - paid amount)
      // Or simply: lifetime price - remaining monthly value
      const remainingValue = monthlyPrice * (timeRemaining / periodDuration);
      const priceDifference = lifetimePrice - remainingValue;

      // Update subscription metadata to mark as upgraded to lifetime
      // Keep subscription active but mark it as upgraded
      await stripe.subscriptions.update(user.subscriptionId, {
        metadata: {
          ...subscription.metadata,
          planId: 'lifetime', // Update planId in metadata
          upgradedToLifetime: 'true',
          upgradedAt: new Date().toISOString(),
          originalPlan: 'monthly'
        }
      });
      
      // Also cancel subscription at period end (but keep it for tracking)
      await stripe.subscriptions.update(user.subscriptionId, {
        cancel_at_period_end: true
      });

      // Create checkout session for price difference
      // If price difference is negative or zero, make it free
      const amountToCharge = Math.max(0, Math.round(priceDifference * 100)); // Convert to cents

      if (amountToCharge > 0) {
        // Create a one-time payment for the difference
        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          customer: user.stripeCustomerId,
          payment_method_types: ['card'],
          metadata: {
            userId: user._id.toString(),
            planId: 'lifetime',
            email: user.email,
            action: 'upgrade',
            fromPlan: 'monthly',
            priceDifference: priceDifference.toString()
          },
          line_items: [{
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'Upgrade to Lifetime Plan',
                description: `Price difference: $${priceDifference.toFixed(2)}`
              },
              unit_amount: amountToCharge
            },
            quantity: 1
          }],
          success_url: `${process.env.APP_BASE_URL || (req.protocol + '://' + req.get('host'))}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.APP_BASE_URL || (req.protocol + '://' + req.get('host'))}/subscription/cancel`
        });

        return res.json({
          success: true,
          message: `Upgrade to lifetime plan. Price difference: $${priceDifference.toFixed(2)}`,
          priceDifference: priceDifference,
          checkoutUrl: session.url,
          sessionId: session.id
        });
      } else {
        // Free upgrade (lifetime price is less than remaining monthly value)
        // Directly update to lifetime
        user.subscriptionPlan = 'lifetime';
        user.subscriptionStatus = 'active';
        user.subscriptionCurrentPeriodEnd = null;
        await user.save();

        // Update activation records
        const Activation = require('../models/Activation');
        const activations = await Activation.find({
          $or: [
            { stripeSubscriptionId: user.subscriptionId },
            { stripeCustomerId: user.stripeCustomerId, email: user.email }
          ]
        });

        for (const activation of activations) {
          activation.plan = 'lifetime';
          activation.expiresAt = null;
          activation.status = 'active';
          await activation.save();
        }

        return res.json({
          success: true,
          message: 'Successfully upgraded to lifetime plan (no additional charge).',
          subscription: {
            status: user.subscriptionStatus,
            plan: user.subscriptionPlan,
            currentPeriodEnd: null
          }
        });
      }
    }

    // Case 3: Same plan type change (shouldn't happen due to check above, but handle anyway)
    return res.status(400).json({
      success: false,
      error: 'Invalid plan change'
    });
  } catch (error) {
    console.error('❌ Error changing subscription:', error);
    next(error);
  }
};

/**
 * Cancel subscription
 * Supports two modes:
 * - immediate: false (default) - Cancel at period end, user can still use until period ends
 * - immediate: true - Cancel immediately and revoke all activations right away
 */
const cancelSubscription = async (req, res, next) => {
  try {
    const { immediate = false } = req.body;
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (!user.subscriptionId) {
      return res.status(400).json({
        success: false,
        error: 'No active subscription to cancel'
      });
    }

    if (!stripe) {
      return res.status(500).json({
        success: false,
        error: 'Stripe is not configured'
      });
    }

    const Activation = require('../models/Activation');
    const activations = await Activation.find({
      $or: [
        { stripeSubscriptionId: user.subscriptionId },
        { stripeCustomerId: user.stripeCustomerId, email: user.email }
      ]
    });

    if (immediate) {
      // Immediate cancellation: Cancel subscription right away and revoke all activations
      const subscription = await stripe.subscriptions.cancel(user.subscriptionId);

      // Update user record
      user.subscriptionStatus = 'canceled';
      user.subscriptionCurrentPeriodEnd = null;
      await user.save();

      // Immediately revoke all activation records
      for (const activation of activations) {
        if (activation.status === 'active') {
          activation.status = 'revoked';
          activation.stripeSubscriptionStatus = 'canceled';
          await activation.save();
          console.log('❌ Activation immediately revoked:', {
            activationId: activation._id,
            email: activation.email
          });
        }
      }

      console.log('✅ Subscription immediately canceled and activations revoked:', {
        userId: user._id,
        subscriptionId: user.subscriptionId,
        activationsRevoked: activations.length
      });

      res.json({
        success: true,
        message: 'Subscription canceled immediately. All activation codes have been revoked.',
        subscription: {
          status: 'canceled',
          canceledImmediately: true
        }
      });
    } else {
      // Cancel at period end (default behavior - user can still use until period ends)
      const subscription = await stripe.subscriptions.update(user.subscriptionId, {
        cancel_at_period_end: true
      });

      // Update user record
      user.subscriptionStatus = subscription.status;
      await user.save();

      // Update activation records - they remain active until period end
      for (const activation of activations) {
        // Activation remains active until period end
        activation.stripeSubscriptionStatus = subscription.status;
        // Note: status stays 'active' until period actually ends
        await activation.save();
      }

      console.log('✅ Subscription cancellation scheduled:', {
        userId: user._id,
        subscriptionId: user.subscriptionId,
        cancelAt: new Date(subscription.current_period_end * 1000),
        activationsAffected: activations.length
      });

      res.json({
        success: true,
        message: 'Subscription will be canceled at the end of the current period',
        subscription: {
          status: user.subscriptionStatus,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          currentPeriodEnd: new Date(subscription.current_period_end * 1000)
        }
      });
    }
  } catch (error) {
    console.error('❌ Error canceling subscription:', error);
    next(error);
  }
};

/**
 * Revoke subscription immediately
 * This will cancel the subscription right away and revoke all activation codes,
 * even if the subscription period hasn't ended yet.
 * Works for both monthly subscriptions and lifetime plans.
 */
const revokeSubscription = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Check if user has active subscription or lifetime plan
    if (!user.subscriptionId && user.subscriptionPlan !== 'lifetime') {
      return res.status(400).json({
        success: false,
        error: 'No active subscription or lifetime plan to revoke'
      });
    }

    const Activation = require('../models/Activation');
    
    // Find all activations for this user
    const activations = await Activation.find({
      $or: [
        { stripeSubscriptionId: user.subscriptionId },
        { stripeCustomerId: user.stripeCustomerId, email: user.email }
      ]
    });

    // For monthly subscription, cancel it in Stripe
    if (user.subscriptionId && stripe) {
      try {
        const subscription = await stripe.subscriptions.cancel(user.subscriptionId);
        console.log('✅ Stripe subscription canceled:', {
          subscriptionId: user.subscriptionId
        });
      } catch (stripeError) {
        // If subscription already canceled or doesn't exist, continue anyway
        console.warn('⚠️ Could not cancel Stripe subscription (may already be canceled):', stripeError.message);
      }
    }

    // Update user record
    user.subscriptionStatus = 'canceled';
    user.subscriptionPlan = null;
    user.subscriptionCurrentPeriodEnd = null;
    await user.save();

    // Immediately revoke all activation records
    let revokedCount = 0;
    for (const activation of activations) {
      if (activation.status === 'active') {
        activation.status = 'revoked';
        if (user.subscriptionId) {
          activation.stripeSubscriptionStatus = 'canceled';
        }
        await activation.save();
        revokedCount++;
        console.log('❌ Activation immediately revoked:', {
          activationId: activation._id,
          email: activation.email,
          plan: activation.plan
        });
      }
    }

    console.log('✅ Subscription/Plan immediately revoked:', {
      userId: user._id,
      subscriptionId: user.subscriptionId || 'lifetime',
      plan: user.subscriptionPlan || 'lifetime',
      activationsRevoked: revokedCount
    });

    res.json({
      success: true,
      message: 'Subscription revoked immediately. All activation codes have been disabled.',
      subscription: {
        status: 'canceled',
        revokedImmediately: true
      },
      activationsRevoked: revokedCount
    });
  } catch (error) {
    console.error('❌ Error revoking subscription:', error);
    next(error);
  }
};

/**
 * Reactivate canceled subscription
 */
const reactivateSubscription = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (!user.subscriptionId) {
      return res.status(400).json({
        success: false,
        error: 'No subscription to reactivate'
      });
    }

    if (!stripe) {
      return res.status(500).json({
        success: false,
        error: 'Stripe is not configured'
      });
    }

    // Remove cancellation
    const subscription = await stripe.subscriptions.update(user.subscriptionId, {
      cancel_at_period_end: false
    });

    // Update user record
    user.subscriptionStatus = subscription.status;
    user.subscriptionCurrentPeriodEnd = subscription.current_period_end 
      ? new Date(subscription.current_period_end * 1000) 
      : null;
    await user.save();

    // Reactivate activation records
    const Activation = require('../models/Activation');
    const activations = await Activation.find({
      $or: [
        { stripeSubscriptionId: user.subscriptionId },
        { stripeCustomerId: user.stripeCustomerId, email: user.email }
      ]
    });

    for (const activation of activations) {
      activation.status = 'active'; // Reactivate
      activation.stripeSubscriptionStatus = subscription.status;
      if (subscription.current_period_end) {
        activation.stripeCurrentPeriodEnd = new Date(subscription.current_period_end * 1000);
        if (activation.plan === 'monthly') {
          activation.expiresAt = activation.stripeCurrentPeriodEnd;
        }
      }
      await activation.save();
    }

    console.log('✅ Subscription reactivated:', {
      userId: user._id,
      subscriptionId: user.subscriptionId,
      activationsReactivated: activations.length
    });

    res.json({
      success: true,
      message: 'Subscription reactivated successfully',
      subscription: {
        status: user.subscriptionStatus,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        currentPeriodEnd: user.subscriptionCurrentPeriodEnd
      }
    });
  } catch (error) {
    console.error('❌ Error reactivating subscription:', error);
    next(error);
  }
};

/**
 * Stop service - Disable all activation codes immediately
 * This will set serviceEnabled = false in Stripe subscription/customer metadata and revoke all activations
 */
const stopService = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (!stripe) {
      return res.status(500).json({
        success: false,
        error: 'Stripe is not configured'
      });
    }

    // Update Stripe metadata to disable service
    if (user.subscriptionId) {
      // For monthly subscription - update subscription metadata (merge with existing)
      const subscription = await stripe.subscriptions.retrieve(user.subscriptionId);
      await stripe.subscriptions.update(user.subscriptionId, {
        metadata: {
          ...subscription.metadata,
          serviceEnabled: 'false'
        }
      });
      console.log('✅ Service disabled in Stripe subscription metadata:', {
        subscriptionId: user.subscriptionId
      });
    } else if (user.stripeCustomerId) {
      // For lifetime plan or no subscription - update customer metadata (merge with existing)
      const customer = await stripe.customers.retrieve(user.stripeCustomerId);
      await stripe.customers.update(user.stripeCustomerId, {
        metadata: {
          ...customer.metadata,
          serviceEnabled: 'false'
        }
      });
      console.log('✅ Service disabled in Stripe customer metadata:', {
        customerId: user.stripeCustomerId
      });
    } else {
      return res.status(400).json({
        success: false,
        error: 'No Stripe subscription or customer found'
      });
    }

    // Revoke all activation records for this user
    const Activation = require('../models/Activation');
    const activations = await Activation.find({
      $or: [
        { stripeSubscriptionId: user.subscriptionId },
        { stripeCustomerId: user.stripeCustomerId, email: user.email }
      ]
    });

    let revokedCount = 0;
    for (const activation of activations) {
      if (activation.status === 'active') {
        activation.status = 'revoked';
        await activation.save();
        revokedCount++;
        console.log('❌ Activation revoked (service stopped):', {
          activationId: activation._id,
          email: activation.email
        });
      }
    }

    console.log('✅ Service stopped:', {
      userId: user._id,
      email: user.email,
      activationsRevoked: revokedCount
    });

    res.json({
      success: true,
      message: 'Service stopped. All activation codes have been disabled.',
      activationsRevoked: revokedCount
    });
  } catch (error) {
    console.error('❌ Error stopping service:', error);
    next(error);
  }
};

/**
 * Start service - Re-enable service and reactivate all activations
 * This will set serviceEnabled = true in Stripe subscription/customer metadata and reactivate all valid activations
 */
const startService = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (!stripe) {
      return res.status(500).json({
        success: false,
        error: 'Stripe is not configured'
      });
    }

    // Check if subscription/plan is still valid before enabling service
    let isValid = false;
    let isExpired = false;
    
    if (user.subscriptionId) {
      // For monthly subscription - check if subscription is still active
      try {
        const subscription = await stripe.subscriptions.retrieve(user.subscriptionId);
        const validStatuses = ['active', 'trialing', 'past_due'];
        isValid = validStatuses.includes(subscription.status);
        
        // Check if period has ended
        if (subscription.current_period_end) {
          const periodEnd = new Date(subscription.current_period_end * 1000);
          isExpired = periodEnd < new Date();
        }
      } catch (err) {
        console.error('❌ Error checking subscription:', err.message);
      }
    } else if (user.subscriptionPlan === 'lifetime') {
      // Lifetime plans are always valid
      isValid = true;
    } else {
      // No subscription - check if currentPeriodEnd is still valid
      if (user.subscriptionCurrentPeriodEnd) {
        isValid = user.subscriptionCurrentPeriodEnd > new Date();
        isExpired = !isValid;
      }
    }

    // If expired, require new purchase
    if (isExpired) {
      return res.status(400).json({
        success: false,
        error: 'Your subscription has expired. Please purchase a new subscription to continue.',
        expired: true
      });
    }

    // If not valid, also require new purchase
    if (!isValid) {
      return res.status(400).json({
        success: false,
        error: 'Your subscription is not active. Please purchase a new subscription to continue.',
        expired: true
      });
    }

    // Update Stripe metadata to enable service
    if (user.subscriptionId) {
      // For monthly subscription - update subscription metadata (merge with existing)
      const subscription = await stripe.subscriptions.retrieve(user.subscriptionId);
      await stripe.subscriptions.update(user.subscriptionId, {
        metadata: {
          ...subscription.metadata,
          serviceEnabled: 'true'
        }
      });
      console.log('✅ Service enabled in Stripe subscription metadata:', {
        subscriptionId: user.subscriptionId
      });
    } else if (user.stripeCustomerId) {
      // For lifetime plan or no subscription - update customer metadata (merge with existing)
      const customer = await stripe.customers.retrieve(user.stripeCustomerId);
      await stripe.customers.update(user.stripeCustomerId, {
        metadata: {
          ...customer.metadata,
          serviceEnabled: 'true'
        }
      });
      console.log('✅ Service enabled in Stripe customer metadata:', {
        customerId: user.stripeCustomerId
      });
    } else {
      return res.status(400).json({
        success: false,
        error: 'No Stripe subscription or customer found'
      });
    }

    // Reactivate all valid activation records for this user
    const Activation = require('../models/Activation');
    const activations = await Activation.find({
      $or: [
        { stripeSubscriptionId: user.subscriptionId },
        { stripeCustomerId: user.stripeCustomerId, email: user.email }
      ]
    });

    let reactivatedCount = 0;
    for (const activation of activations) {
      // Only reactivate if subscription is still valid (for monthly) or if lifetime
      if (activation.status === 'revoked') {
        // Check if subscription is still valid (for monthly plans)
        let shouldReactivate = false;
        
        if (activation.plan === 'lifetime') {
          // Lifetime plans can always be reactivated if service is enabled
          shouldReactivate = true;
        } else if (activation.stripeSubscriptionId && stripe) {
          // For monthly plans, check if subscription is still active
          try {
            const subscription = await stripe.subscriptions.retrieve(activation.stripeSubscriptionId);
            const validStatuses = ['active', 'trialing', 'past_due'];
            if (validStatuses.includes(subscription.status)) {
              shouldReactivate = true;
              activation.stripeSubscriptionStatus = subscription.status;
              if (subscription.current_period_end) {
                activation.stripeCurrentPeriodEnd = new Date(subscription.current_period_end * 1000);
                activation.expiresAt = activation.stripeCurrentPeriodEnd;
              }
            }
          } catch (err) {
            console.warn('⚠️ Could not verify subscription for reactivation:', err.message);
          }
        } else {
          // No subscription ID - check if not expired
          if (!activation.expiresAt || activation.expiresAt > new Date()) {
            shouldReactivate = true;
          }
        }

        if (shouldReactivate) {
          activation.status = 'active';
          await activation.save();
          reactivatedCount++;
          console.log('✅ Activation reactivated (service started):', {
            activationId: activation._id,
            email: activation.email,
            plan: activation.plan
          });
        }
      }
    }

    console.log('✅ Service started:', {
      userId: user._id,
      email: user.email,
      activationsReactivated: reactivatedCount
    });

    res.json({
      success: true,
      message: 'Service started. All valid activation codes have been reactivated.',
      activationsReactivated: reactivatedCount
    });
  } catch (error) {
    console.error('❌ Error starting service:', error);
    next(error);
  }
};

/**
 * Delete subscription completely
 * This will:
 * - Cancel and delete subscription in Stripe (if exists)
 * - Delete all activation records for this user
 * - Clear all subscription data from user record
 * - Keep user account but remove all subscription info
 */
const deleteSubscription = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (!stripe) {
      return res.status(500).json({
        success: false,
        error: 'Stripe is not configured'
      });
    }

    const Activation = require('../models/Activation');
    
    // Find all activations for this user
    const activations = await Activation.find({
      $or: [
        { stripeSubscriptionId: user.subscriptionId },
        { stripeCustomerId: user.stripeCustomerId, email: user.email }
      ]
    });

    // Delete subscription in Stripe (if exists)
    if (user.subscriptionId) {
      try {
        // First try to cancel it
        await stripe.subscriptions.cancel(user.subscriptionId);
        console.log('✅ Stripe subscription canceled:', {
          subscriptionId: user.subscriptionId
        });
      } catch (stripeError) {
        // If subscription already canceled or doesn't exist, continue anyway
        console.warn('⚠️ Could not cancel Stripe subscription (may already be canceled):', stripeError.message);
      }
    }

    // Delete all activation records
    let deletedCount = 0;
    for (const activation of activations) {
      await Activation.deleteOne({ _id: activation._id });
      deletedCount++;
      console.log('🗑️ Activation deleted:', {
        activationId: activation._id,
        email: activation.email,
        plan: activation.plan
      });
    }

    // Clear all subscription data from user record
    user.subscriptionId = null;
    user.subscriptionPlan = null;
    user.subscriptionStatus = null;
    user.subscriptionCurrentPeriodEnd = null;
    // Keep stripeCustomerId for potential future purchases
    await user.save();

    console.log('✅ Subscription completely deleted:', {
      userId: user._id,
      email: user.email,
      subscriptionId: user.subscriptionId || 'none',
      activationsDeleted: deletedCount
    });

    res.json({
      success: true,
      message: 'Subscription and all activation codes have been completely deleted.',
      deleted: {
        subscription: true,
        activations: deletedCount
      }
    });
  } catch (error) {
    console.error('❌ Error deleting subscription:', error);
    next(error);
  }
};

module.exports = {
  getSubscriptionStatus,
  createSubscriptionCheckout,
  changeSubscription,
  cancelSubscription,
  revokeSubscription,
  reactivateSubscription,
  stopService,
  startService,
  deleteSubscription
};


