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
  const plan = getPlanOrThrow(planId);
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

  // Get Stripe session to validate payment status and expiry
  let stripeSession = null;
  if (activation.stripeSessionId && stripe) {
    try {
      stripeSession = await stripe.checkout.sessions.retrieve(activation.stripeSessionId);
      console.log('📋 Retrieved Stripe session for verification:', {
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
      // If Stripe session retrieval fails, fall back to existing expiry check
      if (activation.expiresAt && activation.expiresAt < new Date()) {
        return { ok: false, reason: 'expired' };
      }
    }
  } else {
    // Fallback: check existing expiry if no Stripe session
    if (activation.expiresAt && activation.expiresAt < new Date()) {
      return { ok: false, reason: 'expired' };
    }
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

  // Prepare session data for response
  const sessionData = stripeSession ? {
    id: stripeSession.id,
    object: stripeSession.object,
    mode: stripeSession.mode,
    status: stripeSession.status,
    payment_status: stripeSession.payment_status,
    customer: stripeSession.customer,
    customer_email: stripeSession.customer_email,
    customer_details: stripeSession.customer_details,
    subscription: stripeSession.subscription,
    payment_intent: stripeSession.payment_intent,
    metadata: stripeSession.metadata,
    amount_total: stripeSession.amount_total,
    currency: stripeSession.currency,
    created: stripeSession.created ? new Date(stripeSession.created * 1000).toISOString() : null,
    expires_at: stripeSession.expires_at ? new Date(stripeSession.expires_at * 1000).toISOString() : null,
    payment_method_types: stripeSession.payment_method_types,
    success_url: stripeSession.success_url,
    cancel_url: stripeSession.cancel_url
  } : null;

  return {
    ok: true,
    data: {
      email: activation.email,
      plan: activation.plan,
      expiresAt: activation.expiresAt,
      deviceId: activation.redeemedDeviceId,
      redeemedAt: activation.redeemedAt,
      session: sessionData
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

