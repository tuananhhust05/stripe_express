const mongoose = require('mongoose');

const planPriceSchema = new mongoose.Schema(
  {
    planId: { 
      type: String, 
      enum: ['monthly', 'lifetime'], 
      required: true, 
      unique: true 
    },
    price: { 
      type: Number, 
      required: true, 
      min: 0 
    },
    updatedBy: { 
      type: String, 
      default: 'system' 
    },
    updatedAt: { 
      type: Date, 
      default: Date.now 
    }
  },
  { timestamps: true }
);

// Index for fast lookup
planPriceSchema.index({ planId: 1 });

module.exports = mongoose.model('PlanPrice', planPriceSchema);

