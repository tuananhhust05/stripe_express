const { getPlanOrThrow, hasStripeConfig } = require('../utils/planConfig');
const { createActivationRecord } = require('../services/activationService');
const { sendActivationEmail } = require('../services/emailService');
const { createManualTransaction } = require('../services/transactionService');
const { getPriceId, stripe } = require('../services/stripeService');
const { v4: uuidv4 } = require('uuid');

const createCheckoutSession = async (req, res, next) => {
  try {
    const { planId = 'monthly', email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const plan = getPlanOrThrow(planId);

    // Check if Stripe is configured and get/create price
    if (hasStripeConfig() && stripe) {
      try {
        // Auto-create price if not exists
        const priceId = await getPriceId(planId);
        
        if (priceId) {
          // Use Stripe Checkout
          const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card'],
            customer_email: email,
            metadata: { 
              planId,
              email: email.toLowerCase().trim()
            },
            line_items: [{ 
              price: priceId, 
              quantity: 1 
            }],
            success_url: `${process.env.APP_BASE_URL || (req.protocol + '://localhost:3334')}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.APP_BASE_URL || (req.protocol + '://localhost:3334')}/payment/cancel`
          });

          return res.json({
            success: true,
            sessionId: session.id,
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
          });
        }
      } catch (stripeError) {
        console.error('❌ Stripe error, falling back to manual mode:', stripeError.message);
        // Fall through to manual mode
      }
    }

    // Fallback to manual mode (no Stripe configured)
    // Create activation record
    const fakeSessionId = `manual_${uuidv4()}`;
    const activation = await createActivationRecord({
      email,
      planId,
      stripeSessionId: fakeSessionId
    });

    // Create transaction record
    await createManualTransaction({
      email,
      planId,
      activationCode: activation.activationCode,
      amountTotal: plan.price * 100, // Convert to cents
      currency: 'usd'
    });

    // Send activation email
    await sendActivationEmail({
      to: activation.email,
      activationCode: activation.activationCode,
      planLabel: plan.label,
      expiresAt: activation.expiresAt
    });

    return res.json({
      success: true,
      message: 'Activation code sent to your email',
      activationCode: activation.activationCode
    });
  } catch (err) {
    console.error('❌ Payment error:', err);
    
    // Don't expose internal errors to customers
    if (err.code === 11000) {
      // Duplicate key error - try to get existing activation
      try {
        const Activation = require('../models/Activation');
        const existingActivation = await Activation.findOne({ 
          email: email.toLowerCase().trim() 
        }).sort({ createdAt: -1 });
        
        if (existingActivation) {
          // Resend email if activation exists
          await sendActivationEmail({
            to: existingActivation.email,
            activationCode: existingActivation.activationCode,
            planLabel: plan.label,
            expiresAt: existingActivation.expiresAt
          });
          
          return res.json({
            success: true,
            message: 'Activation code sent to your email',
            activationCode: existingActivation.activationCode
          });
        }
      } catch (retryErr) {
        console.error('Retry error:', retryErr);
      }
    }
    
    // Generic error message for customers
    return res.status(500).json({
      success: false,
      error: 'Unable to process your order. Please try again or contact support.'
    });
  }
};

// Process payment session and create activation (used by both webhook and success page)
// SECURITY: This function assumes session is already verified from Stripe API
const processPaymentSession = async (session) => {
  const { recordCheckoutSession } = require('../services/transactionService');
  const Activation = require('../models/Activation');
  
  // SECURITY: Validate session object
  if (!session || !session.id) {
    throw new Error('Invalid session object');
  }
  
  // SECURITY: Validate session ID format
  if (!session.id.startsWith('cs_')) {
    throw new Error('Invalid session ID format');
  }
  
  const email = session.customer_details?.email || session.customer_email || session.metadata?.email;
  const planId = session.metadata?.planId;

  if (!email || !planId) {
    console.error('❌ Missing email or plan metadata:', {
      email,
      planId,
      metadata: session.metadata,
      sessionId: session.id
    });
    throw new Error('Missing email or plan metadata on checkout session.');
  }

  // SECURITY: Idempotency check - prevent duplicate activations
  const existingActivation = await Activation.findOne({ stripeSessionId: session.id });
  if (existingActivation) {
    console.log('✅ Activation already exists for session (idempotency):', {
      sessionId: session.id,
      activationCode: existingActivation.activationCode
    });
    return existingActivation;
  }

  // SECURITY: Double-check payment status (should already be verified by caller)
  if (session.payment_status !== 'paid') {
    console.warn('⚠️ Payment not completed, skipping activation:', {
      sessionId: session.id,
      paymentStatus: session.payment_status
    });
    return null;
  }

  // SECURITY: Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }

  console.log('✅ Processing payment session:', {
    sessionId: session.id,
    email,
    planId,
    paymentStatus: session.payment_status,
    timestamp: new Date().toISOString()
  });

  try {
    const activation = await createActivationRecord({
      email: email.toLowerCase().trim(),
      planId,
      stripeSessionId: session.id
    });

    await recordCheckoutSession(session, activation.activationCode);

    await sendActivationEmail({
      to: activation.email,
      activationCode: activation.activationCode,
      planLabel: getPlanOrThrow(planId).label,
      expiresAt: activation.expiresAt
    });

    console.log('✅ Activation created and email sent:', {
      activationCode: activation.activationCode,
      email: activation.email,
      sessionId: session.id
    });
    
    return activation;
  } catch (err) {
    // SECURITY: Log all errors for audit
    console.error('❌ Error in processPaymentSession:', {
      error: err.message,
      sessionId: session.id,
      email,
      planId,
      stack: err.stack
    });
    throw err;
  }
};

const handleStripeWebhook = async (event) => {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      await processPaymentSession(session);
      break;
    }
    default:
      break;
  }
};

module.exports = {
  createCheckoutSession,
  handleStripeWebhook,
  processPaymentSession
};

