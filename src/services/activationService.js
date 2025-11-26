const { v4: uuidv4 } = require('uuid');
const Activation = require('../models/Activation');
const { getPlanOrThrow } = require('../utils/planConfig');

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const generateActivationCode = () => uuidv4().replace(/-/g, '').slice(0, 16).toUpperCase();

const createActivationRecord = async ({ email, planId, stripeSessionId }) => {
  const plan = getPlanOrThrow(planId);
  const expiresAt = plan.durationDays ? new Date(Date.now() + plan.durationDays * DAY_IN_MS) : null;

  const existing = await Activation.findOne({ stripeSessionId });
  if (existing) {
    return existing;
  }

  const activation = await Activation.create({
    email,
    plan: planId,
    activationCode: generateActivationCode(),
    expiresAt,
    stripeSessionId,
    status: 'active'
  });

  return activation;
};

const verifyActivation = async (activationCode) => {
  const activation = await Activation.findOne({ activationCode });
  if (!activation) {
    return { ok: false, reason: 'not_found' };
  }
  if (activation.status !== 'active') {
    return { ok: false, reason: 'revoked' };
  }
  if (activation.expiresAt && activation.expiresAt < new Date()) {
    return { ok: false, reason: 'expired' };
  }

  return {
    ok: true,
    data: {
      email: activation.email,
      plan: activation.plan,
      expiresAt: activation.expiresAt,
      activationCode: activation.activationCode
    }
  };
};

const getActivationByCode = async (activationCode) => {
  const activation = await Activation.findOne({ activationCode });
  if (!activation) {
    return null;
  }

  const isExpired = activation.expiresAt && activation.expiresAt < new Date();
  const status = isExpired ? 'expired' : activation.status;

  return {
    activationCode: activation.activationCode,
    email: activation.email,
    plan: activation.plan,
    status,
    expiresAt: activation.expiresAt,
    createdAt: activation.createdAt,
    stripeSessionId: activation.stripeSessionId
  };
};

module.exports = {
  createActivationRecord,
  verifyActivation,
  getActivationByCode
};

