const Transaction = require('../models/Transaction');

const normalizeStatus = (stripePaymentStatus) => {
  switch (stripePaymentStatus) {
    case 'paid':
      return 'paid';
    case 'unpaid':
      return 'pending';
    case 'no_payment_required':
      return 'paid';
    default:
      return 'pending';
  }
};

const recordCheckoutSession = async (session, activationCode) => {
  const payload = {
    stripeSessionId: session.id,
    paymentIntentId: session.payment_intent || null,
    email: session.customer_details?.email || session.customer_email || session.metadata?.email || null,
    plan: session.metadata?.planId || null,
    amountTotal: session.amount_total,
    currency: session.currency,
    status: normalizeStatus(session.payment_status),
    activationCode: activationCode || null,
    paymentMethod: 'stripe'
  };

  const update = {
    ...payload,
    $push: {
      events: {
        eventType: 'checkout.session.completed',
        status: payload.status
      }
    }
  };

  await Transaction.findOneAndUpdate(
    { stripeSessionId: session.id },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const listTransactions = async ({ limit = 50 } = {}) => {
  return Transaction.find().sort({ createdAt: -1 }).limit(limit).lean();
};

const { v4: uuidv4 } = require('uuid');

const createManualTransaction = async ({ email, planId, activationCode, amountTotal, currency = 'usd' }) => {
  // Generate unique sessionId for manual transactions to avoid duplicate key errors
  let uniqueSessionId = `manual_${uuidv4()}`;
  let retries = 0;
  const maxRetries = 3;
  
  while (retries < maxRetries) {
    try {
      const transaction = await Transaction.create({
        email,
        plan: planId,
        amountTotal,
        currency,
        status: 'paid',
        activationCode,
        paymentMethod: 'manual',
        stripeSessionId: uniqueSessionId, // Set unique sessionId to avoid null duplicate errors
        events: [{
          eventType: 'manual.purchase',
          status: 'paid',
          receivedAt: new Date()
        }]
      });
      return transaction;
    } catch (err) {
      // If duplicate key error, generate new sessionId and retry
      if (err.code === 11000 && retries < maxRetries - 1) {
        uniqueSessionId = `manual_${uuidv4()}`;
        retries++;
        continue;
      }
      // Re-throw if not duplicate key or max retries reached
      throw err;
    }
  }
};

module.exports = {
  recordCheckoutSession,
  listTransactions,
  createManualTransaction
};

