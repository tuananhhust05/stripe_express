const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema(
  {
    eventType: { type: String, required: true },
    status: { type: String, required: true },
    receivedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const transactionSchema = new mongoose.Schema(
  {
    stripeSessionId: { type: String, unique: true, sparse: true },
    paymentIntentId: { type: String },
    email: { type: String, lowercase: true, trim: true, required: true },
    plan: { type: String, required: true },
    amountTotal: { type: Number },
    currency: { type: String, default: 'usd' },
    status: {
      type: String,
      enum: ['pending', 'paid', 'refunded', 'failed'],
      default: 'paid'
    },
    activationCode: { type: String },
    paymentMethod: { type: String, enum: ['stripe', 'manual'], default: 'manual' },
    events: [eventSchema]
  },
  { timestamps: true }
);

module.exports = mongoose.model('Transaction', transactionSchema);

