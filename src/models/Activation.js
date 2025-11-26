const mongoose = require('mongoose');

const activationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    plan: { type: String, enum: ['monthly', 'lifetime'], required: true },
    activationCode: { type: String, required: true, unique: true },
    status: { type: String, enum: ['pending', 'active', 'revoked'], default: 'active' },
    expiresAt: { type: Date, default: null },
    stripeSessionId: { type: String, unique: true, sparse: true },
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

activationSchema.index({ activationCode: 1 });

module.exports = mongoose.model('Activation', activationSchema);

