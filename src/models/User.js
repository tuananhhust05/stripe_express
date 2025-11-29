const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
    },
    password: {
      type: String,
      required: true,
      minlength: 6
    },
    name: {
      type: String,
      trim: true
    },
    // Stripe customer ID
    stripeCustomerId: {
      type: String,
      sparse: true,
      index: true
    },
    // Current subscription info
    subscriptionId: {
      type: String,
      sparse: true,
      index: true
    },
    subscriptionStatus: {
      type: String,
      enum: ['active', 'canceled', 'past_due', 'unpaid', 'trialing', 'paused', null],
      default: null
    },
    subscriptionPlan: {
      type: String,
      enum: ['monthly', 'lifetime', null],
      default: null
    },
    subscriptionCurrentPeriodEnd: {
      type: Date,
      default: null
    },
    // Account status
    isActive: {
      type: Boolean,
      default: true
    },
    lastLogin: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ stripeCustomerId: 1 });
userSchema.index({ subscriptionId: 1 });

module.exports = mongoose.model('User', userSchema);


