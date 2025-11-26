const { verifyActivation, getActivationByCode } = require('../services/activationService');

const validateActivation = async (req, res, next) => {
  try {
    const { activationCode } = req.body;
    if (!activationCode) {
      return res.status(400).json({ error: 'activationCode is required' });
    }

    const result = await verifyActivation(activationCode.trim().toUpperCase());

    if (!result.ok) {
      return res.status(404).json({
        valid: false,
        reason: result.reason,
        plan: null,
        expiryDate: null,
        status: result.reason
      });
    }

    return res.json({
      valid: true,
      plan: result.data.plan,
      expiryDate: result.data.expiresAt,
      status: 'active',
      email: result.data.email
    });
  } catch (err) {
    next(err);
  }
};

const getActivationStatus = async (req, res, next) => {
  try {
    const { code } = req.params;
    if (!code) {
      return res.status(400).json({ error: 'Activation code is required' });
    }

    const activation = await getActivationByCode(code.trim().toUpperCase());
    if (!activation) {
      return res.status(404).json({ error: 'Activation code not found' });
    }

    return res.json(activation);
  } catch (err) {
    next(err);
  }
};

const verifyActivationCode = async (req, res, next) => {
  try {
    const { activationCode } = req.body;
    if (!activationCode) {
      return res.status(400).json({ error: 'activationCode is required' });
    }

    const result = await verifyActivation(activationCode.trim().toUpperCase());

    if (!result.ok) {
      return res.status(404).json(result);
    }

    return res.json(result);
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
        activationCode: activeActivation.activationCode
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
  verifyActivationCode,
  checkActivationByEmail
};

