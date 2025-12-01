const Admin = require('../models/Admin');
const { generateToken } = require('../utils/jwt');

const adminLogin = async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ 
        success: false,
        error: 'Username and password are required' 
      });
    }

    const normalizedUsername = username.toLowerCase().trim();
    console.log('🔐 Admin login attempt:', { username: normalizedUsername });

    const admin = await Admin.findOne({ username: normalizedUsername });
    if (!admin) {
      console.log('❌ Admin not found:', normalizedUsername);
      console.log('   Available admins:', await Admin.find({}, 'username'));
      return res.status(401).json({ 
        success: false,
        error: 'Invalid credentials' 
      });
    }

    console.log('✅ Admin found:', {
      id: admin._id,
      username: admin.username,
      isDefault: admin.isDefault
    });
    
    console.log('   Checking password...');
    const isValid = await admin.comparePassword(password);
    console.log('   Password match result:', isValid);
    
    if (!isValid) {
      console.log('❌ Invalid password for admin:', normalizedUsername);
      console.log('   Expected password: shadow_link@');
      return res.status(401).json({ 
        success: false,
        error: 'Invalid credentials' 
      });
    }

    // Generate JWT token
    const token = generateToken(admin._id, admin.username);
    console.log('✅ Admin login successful:', username.toLowerCase());
    
    // Set JWT token in HTTP-only cookie
    res.cookie('adminToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    
    res.json({ 
      success: true,
      message: 'Login successful',
      redirect: '/admin'
    });
  } catch (error) {
    console.error('❌ Admin login error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Login failed. Please try again.' 
    });
  }
};

const adminLogout = async (req, res) => {
  try {
    // Clear JWT token cookie
    res.clearCookie('adminToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });
    
    res.json({ 
      success: true,
      message: 'Logout successful',
      redirect: '/admin/login'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Logout failed' 
    });
  }
};

const Transaction = require('../models/Transaction');
const Activation = require('../models/Activation');

const getAdminStats = async (req, res, next) => {
  try {
    const stats = {
      totalTransactions: await Transaction.countDocuments(),
      totalPaid: await Transaction.countDocuments({ status: 'paid' }),
      totalPending: await Transaction.countDocuments({ status: 'pending' }),
      totalActivations: await Activation.countDocuments(),
      activeActivations: await Activation.countDocuments({ status: 'active' })
    };
    
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
};

const getAdminTransactions = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const search = req.query.search || '';
    const status = req.query.status || '';
    
    // Build query
    const query = {};
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { plan: { $regex: search, $options: 'i' } },
        { activationCode: { $regex: search, $options: 'i' } },
        { stripeSessionId: { $regex: search, $options: 'i' } }
      ];
    }
    if (status) {
      query.status = status;
    }
    
    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    
    const total = await Transaction.countDocuments(query);
    
    res.json({ 
      success: true, 
      data: transactions,
      total,
      limit
    });
  } catch (error) {
    next(error);
  }
};

const getAdminActivations = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const search = req.query.search || '';
    const status = req.query.status || '';
    const plan = req.query.plan || '';
    
    // Build query
    const query = {};
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { activationCode: { $regex: search, $options: 'i' } },
        { activationCodeHash: { $regex: search, $options: 'i' } },
        { plan: { $regex: search, $options: 'i' } }
      ];
    }
    if (status) {
      if (status === 'expired') {
        query.expiresAt = { $lt: new Date() };
      } else {
        query.status = status;
      }
    }
    if (plan) {
      query.plan = plan;
    }
    
    const activations = await Activation.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    
    // Mark expired activations
    const now = new Date();
    const processedActivations = activations.map(act => {
      const isExpired = act.expiresAt && new Date(act.expiresAt) < now;
      return {
        ...act,
        actualStatus: isExpired ? 'expired' : act.status,
        activationCode: act.activationCodeHash || act.activationCode // Show hash if available
      };
    });
    
    const total = await Activation.countDocuments(query);
    
    res.json({ 
      success: true, 
      data: processedActivations,
      total,
      limit
    });
  } catch (error) {
    next(error);
  }
};

const resendActivationEmail = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Activation ID is required'
      });
    }

    const { sendActivationEmail } = require('../services/emailService');
    const { getPlanOrThrow } = require('../utils/planConfig');

    // Find activation
    const activation = await Activation.findById(id);
    if (!activation) {
      return res.status(404).json({
        success: false,
        error: 'Activation not found'
      });
    }

    // Get activation code hash (or fallback to plain code)
    const activationCodeHash = activation.activationCodeHash || activation.activationCode;
    if (!activationCodeHash) {
      return res.status(400).json({
        success: false,
        error: 'Activation code not found'
      });
    }

    // Get plan label
    const plan = await getPlanOrThrow(activation.plan);
    const planLabel = plan.label;

    // Send email
    await sendActivationEmail({
      to: activation.email,
      activationCode: activationCodeHash,
      planLabel: planLabel,
      expiresAt: activation.expiresAt,
      deepLink: process.env.DEEP_LINK_URL || 'http://localhost:3334/'
    });

    console.log('✅ Admin resent activation email:', {
      activationId: id,
      email: activation.email,
      activationCodeHash: activationCodeHash.substring(0, 8) + '...'
    });

    res.json({
      success: true,
      message: 'Activation email sent successfully'
    });
  } catch (error) {
    console.error('❌ Error resending activation email:', error);
    next(error);
  }
};

const getPlanPrices = async (req, res, next) => {
  try {
    const PlanPrice = require('../models/PlanPrice');
    const { basePlans } = require('../utils/planConfig');
    
    const planPrices = await PlanPrice.find({}).lean();
    const prices = {};
    
    planPrices.forEach(pp => {
      prices[pp.planId] = {
        planId: pp.planId,
        price: pp.price,
        label: basePlans[pp.planId]?.label || pp.planId,
        updatedAt: pp.updatedAt,
        updatedBy: pp.updatedBy
      };
    });
    
    // Ensure both plans exist
    Object.keys(basePlans).forEach(planId => {
      if (!prices[planId]) {
        prices[planId] = {
          planId,
          price: basePlans[planId].defaultPrice,
          label: basePlans[planId].label,
          updatedAt: null,
          updatedBy: 'system'
        };
      }
    });
    
    res.json({
      success: true,
      data: Object.values(prices)
    });
  } catch (error) {
    next(error);
  }
};

const updatePlanPrice = async (req, res, next) => {
  try {
    const { planId, price } = req.body;
    
    if (!planId || !['monthly', 'lifetime'].includes(planId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid planId. Must be "monthly" or "lifetime"'
      });
    }
    
    if (!price || isNaN(price) || price < 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid price. Must be a positive number'
      });
    }
    
    const PlanPrice = require('../models/PlanPrice');
    const { getPlanOrThrow, basePlans } = require('../utils/planConfig');
    const { getPriceId, stripe } = require('../services/stripeService');
    const { hasStripeConfig } = require('../utils/planConfig');
    
    // Get admin username from request (set by requireAdmin middleware)
    const adminUsername = req.admin?.username || 'admin';
    
    // Update or create plan price
    const planPrice = await PlanPrice.findOneAndUpdate(
      { planId },
      { 
        price: parseFloat(price),
        updatedBy: adminUsername,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );
    
    // Update Stripe price if configured
    if (hasStripeConfig() && stripe) {
      try {
        const plan = await getPlanOrThrow(planId);
        // Update plan price temporarily for Stripe
        plan.price = parseFloat(price);
        
        // Get or create Stripe price with new amount
        const priceId = await getPriceId(planId);
        
        if (priceId) {
          // Retrieve existing price
          const existingPrice = await stripe.prices.retrieve(priceId);
          
          // If price changed, create new price and archive old one
          const newPriceAmount = parseFloat(price) * 100; // Convert to cents
          if (existingPrice.unit_amount !== newPriceAmount) {
            // Create new price
            const newPrice = await stripe.prices.create({
              product: existingPrice.product,
              unit_amount: newPriceAmount,
              currency: 'usd',
              metadata: {
                planId: planId,
                source: 'admin-updated'
              }
            });
            
            // Archive old price (don't delete, just deactivate)
            await stripe.prices.update(priceId, { active: false });
            
            console.log(`✅ Updated Stripe price for ${planId}: ${priceId} -> ${newPrice.id}`);
            
            // Update environment variable if set (optional)
            if (planId === 'monthly' && process.env.STRIPE_PRICE_MONTHLY === priceId) {
              console.log('⚠️ Consider updating STRIPE_PRICE_MONTHLY env variable to:', newPrice.id);
            } else if (planId === 'lifetime' && process.env.STRIPE_PRICE_LIFETIME === priceId) {
              console.log('⚠️ Consider updating STRIPE_PRICE_LIFETIME env variable to:', newPrice.id);
            }
          }
        }
      } catch (stripeError) {
        console.error('⚠️ Error updating Stripe price:', stripeError.message);
        // Don't fail the request, just log the error
      }
    }
    
    console.log(`✅ Admin updated plan price: ${planId} = $${price} by ${adminUsername}`);
    
    res.json({
      success: true,
      message: 'Plan price updated successfully',
      data: planPrice
    });
  } catch (error) {
    console.error('❌ Error updating plan price:', error);
    next(error);
  }
};

/**
 * Create test activation code (invalid/revoked) for testing payment failure scenarios
 */
const createTestActivation = async (req, res, next) => {
  try {
    const { email, plan = 'monthly' } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    if (!['monthly', 'lifetime'].includes(plan)) {
      return res.status(400).json({
        success: false,
        error: 'Plan must be monthly or lifetime'
      });
    }

    const Activation = require('../models/Activation');
    const { hashActivationCode } = require('../utils/cryptoUtils');
    const { v4: uuidv4 } = require('uuid');
    const { getPlanOrThrow } = require('../utils/planConfig');

    // Generate activation code
    const plainCode = uuidv4().replace(/-/g, '').slice(0, 16).toUpperCase();
    const codeHash = hashActivationCode(plainCode);

    // Get plan to calculate expiry
    const planConfig = await getPlanOrThrow(plan);
    let expiresAt = null;
    if (plan === 'monthly') {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
    }

    // Create activation with status 'revoked' (invalid for testing)
    const activation = await Activation.create({
      email: email.toLowerCase().trim(),
      plan: plan,
      activationCodeHash: codeHash,
      activationCode: plainCode,
      status: 'revoked', // Invalid status for testing
      expiresAt,
      // No Stripe session/subscription - this is a test code
    });

    console.log('✅ Test activation code created (invalid):', {
      email: activation.email,
      plan: activation.plan,
      status: activation.status,
      activationCodeHash: codeHash.substring(0, 8) + '...'
    });

    res.json({
      success: true,
      message: 'Test activation code created (invalid/revoked status)',
      activation: {
        id: activation._id,
        email: activation.email,
        plan: activation.plan,
        status: activation.status,
        activationCode: plainCode, // Return plain code for testing
        activationCodeHash: codeHash,
        expiresAt: activation.expiresAt
      }
    });
  } catch (error) {
    console.error('❌ Error creating test activation:', error);
    next(error);
  }
};

/**
 * Simulate subscription payment failure for testing
 * This will update subscription status to past_due/unpaid and revoke activations
 */
const simulatePaymentFailure = async (req, res, next) => {
  try {
    const { userId, subscriptionId } = req.body;

    if (!userId && !subscriptionId) {
      return res.status(400).json({
        success: false,
        error: 'Either userId or subscriptionId is required'
      });
    }

    const User = require('../models/User');
    const { stripe } = require('../services/stripeService');
    const Activation = require('../models/Activation');

    if (!stripe) {
      return res.status(500).json({
        success: false,
        error: 'Stripe is not configured'
      });
    }

    // Find user
    let user;
    if (userId) {
      user = await User.findById(userId);
    } else {
      user = await User.findOne({ subscriptionId });
    }

    if (!user || !user.subscriptionId) {
      return res.status(404).json({
        success: false,
        error: 'User or subscription not found'
      });
    }

    // Update subscription in Stripe to simulate payment failure
    // Note: In test mode, we can't actually fail a payment, but we can update metadata
    const subscription = await stripe.subscriptions.retrieve(user.subscriptionId);
    
    // Update subscription metadata to mark as payment failed
    await stripe.subscriptions.update(user.subscriptionId, {
      metadata: {
        ...subscription.metadata,
        paymentFailureSimulated: 'true',
        simulatedAt: new Date().toISOString()
      }
    });

    // Update subscription status to past_due (simulate payment failure)
    // Note: We can't directly change subscription status, but we can update our database
    user.subscriptionStatus = 'past_due';
    await user.save();

    // Revoke all activation records
    const activations = await Activation.find({
      $or: [
        { stripeSubscriptionId: user.subscriptionId },
        { stripeCustomerId: user.stripeCustomerId, email: user.email }
      ]
    });

    let revokedCount = 0;
    for (const activation of activations) {
      if (activation.status === 'active') {
        activation.status = 'revoked';
        activation.stripeSubscriptionStatus = 'past_due';
        await activation.save();
        revokedCount++;
      }
    }

    console.log('⚠️ Payment failure simulated:', {
      userId: user._id,
      email: user.email,
      subscriptionId: user.subscriptionId,
      activationsRevoked: revokedCount
    });

    res.json({
      success: true,
      message: 'Payment failure simulated successfully. Subscription status set to past_due and activations revoked.',
      subscription: {
        subscriptionId: user.subscriptionId,
        status: 'past_due',
        activationsRevoked: revokedCount
      }
    });
  } catch (error) {
    console.error('❌ Error simulating payment failure:', error);
    next(error);
  }
};

module.exports = {
  adminLogin,
  adminLogout,
  getAdminStats,
  getAdminTransactions,
  getAdminActivations,
  resendActivationEmail,
  getPlanPrices,
  updatePlanPrice,
  createTestActivation,
  simulatePaymentFailure
};

