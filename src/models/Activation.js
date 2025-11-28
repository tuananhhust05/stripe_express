const mongoose = require('mongoose');

const activationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    plan: { type: String, enum: ['monthly', 'lifetime'], required: true },
    // Store hashed activation code for security
    activationCodeHash: { type: String, required: true, unique: true },
    // Keep plain code for backward compatibility during migration (will be removed later)
    activationCode: { type: String, sparse: true },
    status: { type: String, enum: ['pending', 'active', 'revoked'], default: 'active' },
    expiresAt: { type: Date, default: null },
    stripeSessionId: { type: String, unique: true, sparse: true },
    // Stripe subscription information
    stripeCustomerId: { type: String, sparse: true },
    stripeSubscriptionId: { type: String, sparse: true },
    stripeSubscriptionStatus: { type: String, sparse: true },
    stripeCurrentPeriodEnd: { type: Date, default: null },
    // Device tracking
    redeemedAt: { type: Date, default: null },
    redeemedDeviceId: { type: String, sparse: true },
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

activationSchema.index({ activationCodeHash: 1 });
activationSchema.index({ stripeCustomerId: 1 });
activationSchema.index({ stripeSubscriptionId: 1 });
activationSchema.index({ redeemedDeviceId: 1 });

module.exports = mongoose.model('Activation', activationSchema);

