const { v4: uuidv4 } = require('uuid');
const Activation = require('../models/Activation');
const { getPlanOrThrow } = require('../utils/planConfig');
const { hashActivationCode } = require('../utils/cryptoUtils');

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const generateActivationCode = () => uuidv4().replace(/-/g, '').slice(0, 16).toUpperCase();

const createActivationRecord = async ({ 
  email, 
  planId, 
  stripeSessionId,
  stripeCustomerId = null,
  stripeSubscriptionId = null,
  stripeSubscriptionStatus = null,
  stripeCurrentPeriodEnd = null
}) => {
  const plan = await getPlanOrThrow(planId);
  const expiresAt = plan.durationDays ? new Date(Date.now() + plan.durationDays * DAY_IN_MS) : null;

  const existing = await Activation.findOne({ stripeSessionId });
  if (existing) {
    return existing;
  }

  // Generate plain activation code
  const plainCode = generateActivationCode();
  const codeHash = hashActivationCode(plainCode);

  const activation = await Activation.create({
    email,
    plan: planId,
    activationCodeHash: codeHash,
    // Keep plain code temporarily for backward compatibility
    activationCode: plainCode,
    expiresAt,
    stripeSessionId,
    stripeCustomerId,
    stripeSubscriptionId,
    stripeSubscriptionStatus,
    stripeCurrentPeriodEnd,
    status: 'active'
  });

  // Return activation with hash for email sending
  // User will receive activationCodeHash to use for verification
  return {
    ...activation.toObject(),
    activationCode: plainCode,
    activationCodeHash: codeHash
  };
};

const verifyActivation = async (activationCode, deviceId = null) => {
  const { hashActivationCode, verifyActivationCode: verifyHash } = require('../utils/cryptoUtils');
  const { stripe } = require('../services/stripeService');
  
  // Normalize input: trim whitespace
  const normalizedCode = activationCode.trim();
  
  // Check if input is already a hash (64 hex characters for SHA-256)
  // Hash is case-insensitive, but we normalize to lowercase for consistency
  const isHash = /^[a-f0-9]{64}$/i.test(normalizedCode);
  let activation;
  
  if (isHash) {
    // User provided hash directly - normalize to lowercase and find by hash
    // SHA-256 hash is always lowercase when generated, but user might send uppercase
    const hashLower = normalizedCode.toLowerCase();
    activation = await Activation.findOne({ activationCodeHash: hashLower });
  } else {
    // User provided plain code - hash it and find
    const codeHash = hashActivationCode(normalizedCode);
    activation = await Activation.findOne({ activationCodeHash: codeHash });
    
    // Fallback to plain code for backward compatibility during migration
    if (!activation) {
      activation = await Activation.findOne({ activationCode: normalizedCode.toUpperCase() });
      if (activation) {
        // Migrate: update to use hash
        activation.activationCodeHash = codeHash;
        await activation.save();
      }
    }
  }
  
  if (!activation) {
    return { ok: false, reason: 'not_found' };
  }
  
  // If user provided plain code but record has hash, verify it matches
  // Note: hashActivationCode already normalizes (toUpperCase().trim()), so this is consistent
  if (!isHash && activation.activationCodeHash) {
    // Use normalizedCode to ensure consistency (already trimmed)
    // hashActivationCode will normalize to uppercase, so this matches the creation process
    if (!verifyHash(normalizedCode, activation.activationCodeHash)) {
      return { ok: false, reason: 'invalid_code' };
    }
  }
  
  if (activation.status !== 'active') {
    return { ok: false, reason: 'revoked' };
  }

  // Sync plan from user/subscription before verification
  // This ensures activation.plan matches current subscription plan
  if (activation.stripeCustomerId) {
    try {
      const User = require('../models/User');
      const user = await User.findOne({ stripeCustomerId: activation.stripeCustomerId });
      
      if (user && user.subscriptionPlan && user.subscriptionPlan !== activation.plan) {
        // User's plan has changed - update activation
        console.log('🔄 Syncing activation plan from user:', {
          activationId: activation._id,
          oldPlan: activation.plan,
          newPlan: user.subscriptionPlan
        });
        activation.plan = user.subscriptionPlan;
        if (user.subscriptionPlan === 'lifetime') {
          activation.expiresAt = null;
        }
        await activation.save();
      }
    } catch (err) {
      console.warn('⚠️ Could not sync plan from user:', err.message);
    }
  }

  // Priority 1: Verify via subscription (new subscription-based model)
  let subscriptionValid = false;
  let subscriptionData = null;
  
  if (activation.stripeSubscriptionId && stripe) {
    try {
      const subscription = await stripe.subscriptions.retrieve(activation.stripeSubscriptionId);
      subscriptionData = subscription;
      
      // Get plan from subscription metadata (may be updated after upgrade)
      const subscriptionPlanId = subscription.metadata?.planId || 
                                 subscription.items.data[0]?.price?.metadata?.planId || 
                                 activation.plan;
      
      console.log('📋 Retrieved Stripe subscription for verification:', {
        subscriptionId: activation.stripeSubscriptionId,
        status: subscription.status,
        planId: subscriptionPlanId,
        activationPlan: activation.plan
      });
      
      // Sync plan from subscription metadata if different
      if (subscriptionPlanId && subscriptionPlanId !== activation.plan) {
        console.log('🔄 Syncing activation plan from subscription metadata:', {
          activationId: activation._id,
          oldPlan: activation.plan,
          newPlan: subscriptionPlanId
        });
        activation.plan = subscriptionPlanId;
        if (subscriptionPlanId === 'lifetime') {
          activation.expiresAt = null;
        } else if (subscriptionPlanId === 'monthly' && subscription.current_period_end) {
          // For monthly, set expiresAt to current_period_end
          activation.expiresAt = new Date(subscription.current_period_end * 1000);
        }
        await activation.save();
      }
      
      // Also sync from user.subscriptionPlan if available (more reliable)
      if (activation.stripeCustomerId) {
        try {
          const User = require('../models/User');
          const user = await User.findOne({ stripeCustomerId: activation.stripeCustomerId });
          if (user && user.subscriptionPlan && user.subscriptionPlan !== activation.plan) {
            console.log('🔄 Syncing activation plan from user.subscriptionPlan:', {
              activationId: activation._id,
              oldPlan: activation.plan,
              newPlan: user.subscriptionPlan
            });
            activation.plan = user.subscriptionPlan;
            if (user.subscriptionPlan === 'lifetime') {
              activation.expiresAt = null;
            } else if (user.subscriptionPlan === 'monthly' && subscription.current_period_end) {
              activation.expiresAt = new Date(subscription.current_period_end * 1000);
            }
            await activation.save();
          }
        } catch (err) {
          console.warn('⚠️ Could not sync plan from user:', err.message);
        }
      }
      
      // Check subscription status - must be active, trialing, or past_due (still valid)
      const validStatuses = ['active', 'trialing', 'past_due'];
      if (!validStatuses.includes(subscription.status)) {
        // If subscription is canceled but activation was revoked, return expired
        if (subscription.status === 'canceled' && activation.status === 'revoked') {
          return { 
            ok: false, 
            reason: 'expired', 
            message: 'Activation code has been revoked due to subscription cancellation.' 
          };
        }
        return { 
          ok: false, 
          reason: 'subscription_inactive', 
          message: `Subscription is ${subscription.status}. Activation code is not valid.` 
        };
      }
      
      // If activation status is revoked but subscription is active, reactivate it
      if (activation.status === 'revoked' && validStatuses.includes(subscription.status)) {
        activation.status = 'active';
        await activation.save();
        console.log('✅ Activation reactivated - subscription is active again:', {
          activationId: activation._id,
          subscriptionStatus: subscription.status
        });
      }
      
      // Update activation record with latest subscription info
      activation.stripeSubscriptionStatus = subscription.status;
      if (subscription.current_period_end) {
        activation.stripeCurrentPeriodEnd = new Date(subscription.current_period_end * 1000);
        // For monthly subscriptions, expiresAt = current_period_end
        if (activation.plan === 'monthly') {
          activation.expiresAt = activation.stripeCurrentPeriodEnd;
        }
      }
      await activation.save();
      
      subscriptionValid = true;
      
      // Check if service is enabled in Stripe subscription metadata
      const serviceEnabled = subscription.metadata?.serviceEnabled;
      if (serviceEnabled === 'false') {
        return { 
          ok: false, 
          reason: 'service_disabled', 
          message: 'Service is currently disabled. Please contact support.' 
        };
      }
      
      // Check expiry for monthly plans
      if (activation.plan === 'monthly' && activation.expiresAt && activation.expiresAt < new Date()) {
        return { ok: false, reason: 'expired', message: 'Subscription period has ended' };
      }
      
      // Lifetime plans never expire
      if (activation.plan === 'lifetime') {
        activation.expiresAt = null;
        await activation.save();
      }
    } catch (err) {
      console.error('❌ Error retrieving Stripe subscription:', {
        error: err.message,
        subscriptionId: activation.stripeSubscriptionId,
        type: err.type
      });
      // If subscription retrieval fails, fall back to session-based or expiry check
    }
  }
  
  // Priority 2: Verify via User subscription (if linked to user account)
  if (!subscriptionValid && activation.stripeCustomerId) {
    try {
      const User = require('../models/User');
      const user = await User.findOne({ stripeCustomerId: activation.stripeCustomerId });
      
      if (user && user.subscriptionId && user.subscriptionStatus === 'active') {
        // User has active subscription - verify it matches
        if (user.subscriptionId === activation.stripeSubscriptionId || !activation.stripeSubscriptionId) {
          // Update activation with user's subscription info
          if (!activation.stripeSubscriptionId && user.subscriptionId) {
            activation.stripeSubscriptionId = user.subscriptionId;
            activation.stripeSubscriptionStatus = user.subscriptionStatus;
            activation.stripeCurrentPeriodEnd = user.subscriptionCurrentPeriodEnd;
            if (activation.plan === 'monthly' && user.subscriptionCurrentPeriodEnd) {
              activation.expiresAt = user.subscriptionCurrentPeriodEnd;
            }
            await activation.save();
          }
          
          subscriptionValid = true;
          
          // Check expiry for monthly plans
          if (activation.plan === 'monthly' && activation.expiresAt && activation.expiresAt < new Date()) {
            return { ok: false, reason: 'expired', message: 'Subscription period has ended' };
          }
        }
      } else if (user && (!user.subscriptionId || user.subscriptionStatus !== 'active')) {
        // User subscription is not active
        return { 
          ok: false, 
          reason: 'subscription_inactive', 
          message: 'User subscription is not active' 
        };
      }
    } catch (err) {
      console.error('❌ Error checking user subscription:', err.message);
    }
  }
  
  // Priority 3: Fallback to session-based verification (legacy support)
  if (!subscriptionValid && activation.stripeSessionId && stripe) {
    try {
      const stripeSession = await stripe.checkout.sessions.retrieve(activation.stripeSessionId);
      console.log('📋 Fallback: Retrieved Stripe session for verification:', {
        sessionId: activation.stripeSessionId,
        paymentStatus: stripeSession.payment_status,
        planId: stripeSession.metadata?.planId
      });
      
      // Validate payment_status must be 'paid'
      if (stripeSession.payment_status !== 'paid') {
        return { ok: false, reason: 'payment_not_completed', message: 'Payment not completed for this activation code' };
      }
      
      // Check expiry based on planId from metadata
      const planId = stripeSession.metadata?.planId || activation.plan;
      if (planId === 'monthly') {
        // For monthly plan: expiresAt = session.created + 1 month
        if (stripeSession.created) {
          const sessionCreated = new Date(stripeSession.created * 1000);
          const expiresAt = new Date(sessionCreated);
          expiresAt.setMonth(expiresAt.getMonth() + 1);
          
          // Update activation record if expiry changed
          if (!activation.expiresAt || activation.expiresAt.getTime() !== expiresAt.getTime()) {
            activation.expiresAt = expiresAt;
            await activation.save();
          }
          
          // Check if expired
          if (expiresAt < new Date()) {
            return { ok: false, reason: 'expired', message: 'Activation code has expired' };
          }
        }
      } else if (planId === 'lifetime') {
        // Lifetime plan: no expiry check
        if (activation.expiresAt) {
          activation.expiresAt = null;
          await activation.save();
        }
      }
    } catch (err) {
      console.error('❌ Error retrieving Stripe session:', {
        error: err.message,
        sessionId: activation.stripeSessionId,
        type: err.type
      });
    }
  }
  
  // Check service enabled status for lifetime plans or when no subscription
  if (!subscriptionValid && activation.stripeCustomerId && stripe) {
    try {
      const customer = await stripe.customers.retrieve(activation.stripeCustomerId);
      const serviceEnabled = customer.metadata?.serviceEnabled;
      if (serviceEnabled === 'false') {
        return { 
          ok: false, 
          reason: 'service_disabled', 
          message: 'Service is currently disabled. Please contact support.' 
        };
      }
    } catch (err) {
      console.warn('⚠️ Could not retrieve customer to check service status:', err.message);
    }
  }

  // Final fallback: check existing expiry if no Stripe verification possible
  if (!subscriptionValid && activation.expiresAt && activation.expiresAt < new Date()) {
    return { ok: false, reason: 'expired', message: 'Activation code has expired' };
  }

  // deviceId is required
  if (!deviceId) {
    return { ok: false, reason: 'device_required', message: 'deviceId is required' };
  }

  // Check device ID: if already redeemed, must match the same device
  if (activation.redeemedDeviceId) {
    // Code already has deviceId - must match exactly
    if (activation.redeemedDeviceId !== deviceId) {
      return { ok: false, reason: 'device_mismatch', message: 'This activation code is already used on another device' };
    }
  } else {
    // First time redemption: record device ID (deviceId is required, so always save)
    activation.redeemedDeviceId = deviceId;
    activation.redeemedAt = new Date();
    await activation.save();
    console.log('✅ First time activation - deviceId recorded:', {
      activationCodeHash: activation.activationCodeHash?.substring(0, 8) + '...',
      deviceId: deviceId
    });
  }

  // Prepare subscription/session data for response
  // Use activation.plan as source of truth (already synced from user/subscription)
  // For lifetime plan, always return status as "active" regardless of actual subscription status
  let finalSubscriptionStatus = activation.stripeSubscriptionStatus;
  if (activation.plan === 'lifetime') {
    // Lifetime plan should always show as "active" status
    finalSubscriptionStatus = 'active';
  }
  
  const subscriptionResponse = subscriptionData ? {
    id: subscriptionData.id,
    status: activation.plan === 'lifetime' ? 'active' : subscriptionData.status, // Override to "active" for lifetime
    currentPeriodStart: subscriptionData.current_period_start ? new Date(subscriptionData.current_period_start * 1000).toISOString() : null,
    currentPeriodEnd: subscriptionData.current_period_end ? new Date(subscriptionData.current_period_end * 1000).toISOString() : null,
    cancelAtPeriodEnd: subscriptionData.cancel_at_period_end,
    plan: activation.plan // Use activation.plan as source of truth (already synced)
  } : null;

  return {
    ok: true,
    data: {
      email: activation.email,
      plan: activation.plan,
      expiresAt: activation.expiresAt,
      deviceId: activation.redeemedDeviceId,
      redeemedAt: activation.redeemedAt,
      subscription: subscriptionResponse,
      subscriptionId: activation.stripeSubscriptionId,
      subscriptionStatus: finalSubscriptionStatus // Always "active" for lifetime plan
    }
  };
};

const getActivationByCode = async (activationCode) => {
  const { hashActivationCode, verifyActivationCode: verifyHash } = require('../utils/cryptoUtils');
  
  // Try hash first
  const codeHash = hashActivationCode(activationCode);
  let activation = await Activation.findOne({ activationCodeHash: codeHash });
  
  // Fallback to plain code
  if (!activation) {
    activation = await Activation.findOne({ activationCode });
  }
  
  if (!activation) {
    return null;
  }

  const isExpired = activation.expiresAt && activation.expiresAt < new Date();
  const status = isExpired ? 'expired' : activation.status;

  return {
    email: activation.email,
    plan: activation.plan,
    status,
    expiresAt: activation.expiresAt,
    createdAt: activation.createdAt,
    stripeSessionId: activation.stripeSessionId,
    stripeCustomerId: activation.stripeCustomerId,
    stripeSubscriptionId: activation.stripeSubscriptionId,
    stripeSubscriptionStatus: activation.stripeSubscriptionStatus,
    stripeCurrentPeriodEnd: activation.stripeCurrentPeriodEnd,
    redeemedAt: activation.redeemedAt,
    redeemedDeviceId: activation.redeemedDeviceId
  };
};

module.exports = {
  createActivationRecord,
  verifyActivation,
  getActivationByCode
};

