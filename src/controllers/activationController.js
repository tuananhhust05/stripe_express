const { verifyActivation, getActivationByCode } = require('../services/activationService');

const validateActivation = async (req, res, next) => {
  try {
    let { activationCode, deviceId } = req.body;
    if (!activationCode) {
      return res.status(400).json({ error: 'activationCode is required' });
    }

    // deviceId is required
    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    // activationCode can be either:
    // 1. Hash (64 hex characters) - directly from email
    // 2. Plain code (for backward compatibility)
    // verifyActivation will handle both cases
    const result = await verifyActivation(activationCode.trim(), deviceId);

    if (!result.ok) {
      return res.status(404).json({
        valid: false,
        reason: result.reason,
        message: result.message || result.reason,
        plan: null,
        expiryDate: null,
        status: result.reason,
        session: null
      });
    }

    return res.json({
      valid: true,
      plan: result.data.plan,
      expiryDate: result.data.expiresAt,
      status: 'active',
      email: result.data.email,
      deviceId: result.data.deviceId,
      redeemedAt: result.data.redeemedAt,
      session: result.data.session
    });
  } catch (err) {
    next(err);
  }
};

const getActivationStatus = async (req, res, next) => {
  try {
    let { code } = req.params;
    if (!code) {
      return res.status(400).json({ error: 'Activation code is required' });
    }

    // code can be either hash or plain code
    // getActivationByCode will handle both cases
    const activation = await getActivationByCode(code.trim());
    if (!activation) {
      return res.status(404).json({ error: 'Activation code not found' });
    }

    return res.json(activation);
  } catch (err) {
    next(err);
  }
};

const redeemActivationCode = async (req, res, next) => {
  try {
    let { activationCode, deviceId } = req.body;
    if (!activationCode) {
      return res.status(400).json({ error: 'activationCode is required' });
    }

    // deviceId is required
    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    // activationCode can be either:
    // 1. Hash (64 hex characters) - directly from email (e.g., "22a340837ecdee9ef5397a31ed1c8ed335e6ca75554e34c852631ec837b6e9b6")
    // 2. Plain code (for backward compatibility)
    // verifyActivation will handle both cases - it detects hash by checking if it's 64 hex chars
    const result = await verifyActivation(activationCode.trim(), deviceId);

    if (!result.ok) {
      return res.status(404).json(result);
    }

    // Generate access token (JWT)
    const Activation = require('../models/Activation');
    const { generateActivationToken } = require('../utils/jwt');
    
    // Find activation to get ID
    const { hashActivationCode } = require('../utils/cryptoUtils');
    const normalizedCode = activationCode.trim();
    const isHash = /^[a-f0-9]{64}$/i.test(normalizedCode);
    const hashLower = isHash ? normalizedCode.toLowerCase() : hashActivationCode(normalizedCode);
    
    const activation = await Activation.findOne({ activationCodeHash: hashLower });
    if (!activation) {
      return res.status(404).json({ ok: false, reason: 'not_found' });
    }

    // Generate JWT token
    const { token: accessToken, expiresAt: tokenExpiresAt } = generateActivationToken(
      activation._id,
      deviceId,
      result.data.plan,
      result.data.expiresAt
    );

    // Log subscription/session data for debugging
    if (result.data.subscription) {
      console.log('✅ Activation redeemed with Stripe subscription:', {
        activationCode: activationCode.substring(0, 8) + '...',
        subscriptionId: result.data.subscriptionId,
        subscriptionStatus: result.data.subscriptionStatus,
        plan: result.data.plan,
        deviceId: deviceId
      });
    } else if (result.data.session) {
      console.log('✅ Activation redeemed with Stripe session (legacy):', {
        activationCode: activationCode.substring(0, 8) + '...',
        sessionId: result.data.session.id,
        paymentStatus: result.data.session.payment_status,
        plan: result.data.plan,
        deviceId: deviceId
      });
    }

    return res.json({
      ok: true,
      data: {
        ...result.data,
        accessToken,
        expiresAt: tokenExpiresAt
      }
    });
  } catch (err) {
    next(err);
  }
};

// Backward compatibility: verifyActivationCode (without JWT token)
const verifyActivationCode = async (req, res, next) => {
  try {
    let { activationCode, deviceId } = req.body;
    if (!activationCode) {
      return res.status(400).json({ error: 'activationCode is required' });
    }

    // deviceId is required
    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    // activationCode can be either:
    // 1. Hash (64 hex characters) - directly from email
    // 2. Plain code (for backward compatibility)
    const result = await verifyActivation(activationCode.trim(), deviceId);

    if (!result.ok) {
      return res.status(404).json(result);
    }

    // Log subscription/session data for debugging
    if (result.data.subscription) {
      console.log('✅ Activation verified with Stripe subscription:', {
        activationCode: activationCode.substring(0, 8) + '...',
        subscriptionId: result.data.subscriptionId,
        subscriptionStatus: result.data.subscriptionStatus,
        plan: result.data.plan
      });
    } else if (result.data.session) {
      console.log('✅ Activation verified with Stripe session (legacy):', {
        activationCode: activationCode.substring(0, 8) + '...',
        sessionId: result.data.session.id,
        paymentStatus: result.data.session.payment_status,
        plan: result.data.plan
      });
    }

    return res.json(result);
  } catch (err) {
    next(err);
  }
};

const verifyToken = async (req, res, next) => {
  try {
    const { accessToken } = req.body;
    
    if (!accessToken) {
      return res.status(400).json({
        active: false,
        error: 'accessToken is required'
      });
    }

    const { verifyActivationToken } = require('../utils/jwt');
    const verification = verifyActivationToken(accessToken);

    if (!verification.valid) {
      return res.json({
        active: false,
        expiresAt: verification.expiresAt,
        error: verification.error || 'Invalid token'
      });
    }

    // Optionally verify activation is still active in database
    const Activation = require('../models/Activation');
    const activation = await Activation.findById(verification.payload.activationId);
    
    if (!activation || activation.status !== 'active') {
      return res.json({
        active: false,
        expiresAt: verification.expiresAt,
        error: 'Activation not found or inactive'
      });
    }

    // Check if activation is expired
    const now = new Date();
    if (activation.expiresAt && new Date(activation.expiresAt) < now) {
      return res.json({
        active: false,
        expiresAt: verification.expiresAt,
        error: 'Activation expired'
      });
    }

    return res.json({
      active: true,
      expiresAt: verification.expiresAt
    });
  } catch (err) {
    next(err);
  }
};

const checkActivationByEmail = async (req, res, next) => {
  try {
    const { email } = req.params;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const Activation = require('../models/Activation');
    const activations = await Activation.find({ 
      email: email.toLowerCase().trim(),
      status: 'active'
    }).sort({ createdAt: -1 }).lean();

    if (activations.length === 0) {
      return res.json({ 
        hasActive: false,
        message: null
      });
    }

    // Check if any activation is still valid (not expired)
    const now = new Date();
    const activeActivation = activations.find(act => {
      if (!act.expiresAt) return true; // Lifetime plan
      return new Date(act.expiresAt) > now;
    });

    if (activeActivation) {
      const expiresAt = activeActivation.expiresAt 
        ? new Date(activeActivation.expiresAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })
        : 'Never';
      
      return res.json({
        hasActive: true,
        message: `You already have an active ${activeActivation.plan === 'lifetime' ? 'lifetime' : 'monthly'} license. Your current license expires on ${expiresAt}.`,
        plan: activeActivation.plan,
        expiresAt: activeActivation.expiresAt,
        activationCode: activeActivation.activationCodeHash || activeActivation.activationCode // Return hash if available
      });
    }

    return res.json({ 
      hasActive: false,
      message: null
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  validateActivation,
  getActivationStatus,
  verifyActivationCode, // Keep for backward compatibility
  redeemActivationCode,
  verifyToken,
  checkActivationByEmail
};

