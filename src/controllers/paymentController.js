const { getPlanOrThrow, hasStripeConfig } = require('../utils/planConfig');
const { createActivationRecord } = require('../services/activationService');
const { sendActivationEmail } = require('../services/emailService');
const { createManualTransaction } = require('../services/transactionService');
const { getPriceId, stripe } = require('../services/stripeService');
const { v4: uuidv4 } = require('uuid');

const createCheckoutSession = async (req, res, next) => {
  try {
    // Support both planKey (planId) and priceId, and customerEmail
    const { planKey, planId, priceId, customerEmail, email } = req.body;
    
    // Use customerEmail if provided, otherwise fallback to email
    const finalEmail = customerEmail || email;
    if (!finalEmail) {
      return res.status(400).json({ error: 'customerEmail or email is required' });
    }

    let finalPlanId = planKey || planId;
    let finalPriceId = priceId;

    // If priceId is provided, use it directly
    // Otherwise, use planKey/planId to get/create price
    if (!finalPriceId) {
      if (!finalPlanId) {
        return res.status(400).json({ error: 'planKey (or planId) or priceId is required' });
      }
      const plan = await getPlanOrThrow(finalPlanId);
      // Auto-create price if not exists
      finalPriceId = await getPriceId(finalPlanId);
      if (!finalPriceId) {
        throw new Error(`Failed to get/create price for plan: ${finalPlanId}`);
      }
    } else {
      // If priceId is provided, we still need planId for metadata
      // Try to get planId from price metadata or use provided planKey
      if (!finalPlanId) {
        try {
          const price = await stripe.prices.retrieve(finalPriceId);
          finalPlanId = price.metadata?.planId || 'monthly'; // Default to monthly if not found
        } catch (err) {
          // If can't retrieve price, default to monthly
          finalPlanId = 'monthly';
        }
      }
    }

    // Check if Stripe is configured
    if (!hasStripeConfig() || !stripe) {
      return res.status(400).json({ error: 'Stripe is not configured' });
    }

    try {
      // Create Stripe Checkout Session
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        customer_email: finalEmail.toLowerCase().trim(),
        metadata: { 
          planId: finalPlanId,
          email: finalEmail.toLowerCase().trim()
        },
        line_items: [{ 
          price: finalPriceId, 
          quantity: 1 
        }],
        success_url: `${process.env.APP_BASE_URL || (req.protocol + '://' + req.get('host'))}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.APP_BASE_URL || (req.protocol + '://' + req.get('host'))}/payment/cancel`
      });

      console.log('✅ Checkout session created:', {
        sessionId: session.id,
        planId: finalPlanId,
        priceId: finalPriceId,
        email: finalEmail
      });

      return res.json({
        success: true,
        checkoutUrl: session.url, // Stripe checkout URL
        sessionId: session.id,
        planId: finalPlanId,
        priceId: finalPriceId
      });
    } catch (stripeError) {
      console.error('❌ Stripe error:', stripeError.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to create checkout session: ' + stripeError.message
      });
    }
  } catch (err) {
    console.error('❌ Payment error:', err);
    
    // Generic error message for customers
    return res.status(500).json({
      success: false,
      error: 'Unable to create checkout session. Please try again or contact support.'
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
    // Get Stripe subscription info if available
    let stripeCustomerId = session.customer || null;
    let stripeSubscriptionId = session.subscription || null;
    let stripeSubscriptionStatus = null;
    let stripeCurrentPeriodEnd = null;

    // If subscription exists, fetch subscription details
    if (stripeSubscriptionId && stripe) {
      try {
        const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        stripeSubscriptionStatus = subscription.status;
        stripeCurrentPeriodEnd = subscription.current_period_end 
          ? new Date(subscription.current_period_end * 1000) 
          : null;
      } catch (err) {
        console.warn('⚠️ Could not retrieve subscription details:', err.message);
      }
    }

    const activation = await createActivationRecord({
      email: email.toLowerCase().trim(),
      planId,
      stripeSessionId: session.id,
      stripeCustomerId,
      stripeSubscriptionId,
      stripeSubscriptionStatus,
      stripeCurrentPeriodEnd
    });

    await recordCheckoutSession(session, activation.activationCode);

    // Send activationCodeHash to user (not plain code)
    const plan = await getPlanOrThrow(planId);
    await sendActivationEmail({
      to: activation.email,
      activationCode: activation.activationCodeHash, // Send hash instead of encrypted code
      planLabel: plan.label,
      expiresAt: activation.expiresAt
    });

    console.log('✅ Activation created and email sent:', {
      email: activation.email,
      sessionId: session.id,
      stripeCustomerId,
      stripeSubscriptionId,
      activationCodeHash: activation.activationCodeHash
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
  const { handleCheckoutSessionCompleted, handleSubscriptionWebhook } = require('../services/subscriptionService');

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      
      // Check if this is a subscription checkout (has userId in metadata)
      if (session.metadata?.userId) {
        // This is a subscription checkout for a logged-in user
        await handleCheckoutSessionCompleted(session);
      } else {
        // This is a legacy activation code checkout
        await processPaymentSession(session);
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      await handleSubscriptionWebhook(subscription);
      break;
    }
    case 'invoice.payment_succeeded': {
      // Handle subscription renewal - subscription is automatically renewed
      const invoice = event.data.object;
      if (invoice.subscription) {
        try {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
          await handleSubscriptionWebhook(subscription);
          console.log('✅ Subscription renewed - activation updated:', {
            subscriptionId: subscription.id,
            invoiceId: invoice.id
          });
        } catch (err) {
          console.error('❌ Error handling renewal webhook:', err.message);
        }
      }
      break;
    }
    case 'invoice.payment_failed': {
      // Handle failed payment - subscription may become past_due or unpaid
      const invoice = event.data.object;
      if (invoice.subscription) {
        try {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
          await handleSubscriptionWebhook(subscription);
          console.log('⚠️ Subscription payment failed - activation status updated:', {
            subscriptionId: subscription.id,
            invoiceId: invoice.id,
            status: subscription.status
          });
        } catch (err) {
          console.error('❌ Error handling payment failed webhook:', err.message);
        }
      }
      break;
    }
    case 'checkout.session.async_payment_failed':
    case 'payment_intent.payment_failed': {
      // Handle failed payment - create invalid activation code for testing
      let session = null;
      let customerEmail = null;
      let planId = null;

      if (event.type === 'checkout.session.async_payment_failed') {
        session = event.data.object;
        customerEmail = session.customer_details?.email || session.customer_email || session.metadata?.email;
        planId = session.metadata?.planId;
      } else if (event.type === 'payment_intent.payment_failed') {
        const paymentIntent = event.data.object;
        // Try to get session from payment intent metadata
        if (paymentIntent.metadata?.sessionId) {
          try {
            session = await stripe.checkout.sessions.retrieve(paymentIntent.metadata.sessionId);
            customerEmail = session.customer_details?.email || session.customer_email || session.metadata?.email;
            planId = session.metadata?.planId;
          } catch (err) {
            console.warn('⚠️ Could not retrieve session from payment intent:', err.message);
          }
        }
      }

      // Create invalid activation code for testing payment failure scenario
      if (customerEmail && planId) {
        try {
          const Activation = require('../models/Activation');
          const { hashActivationCode } = require('../utils/cryptoUtils');
          const { v4: uuidv4 } = require('uuid');
          const { getPlanOrThrow } = require('../utils/planConfig');

          // Check if activation already exists for this session
          const existingActivation = session?.id 
            ? await Activation.findOne({ stripeSessionId: session.id })
            : null;

          if (!existingActivation) {
            // Generate activation code
            const plainCode = uuidv4().replace(/-/g, '').slice(0, 16).toUpperCase();
            const codeHash = hashActivationCode(plainCode);

            // Get plan to calculate expiry
            const plan = await getPlanOrThrow(planId);
            let expiresAt = null;
            if (planId === 'monthly') {
              expiresAt = new Date();
              expiresAt.setDate(expiresAt.getDate() + 30);
            }

            // Create activation with status 'revoked' (invalid due to payment failure)
            const activation = await Activation.create({
              email: customerEmail.toLowerCase().trim(),
              plan: planId,
              activationCodeHash: codeHash,
              activationCode: plainCode,
              status: 'revoked', // Invalid status due to payment failure
              expiresAt,
              stripeSessionId: session?.id || null,
              stripeCustomerId: session?.customer || null
            });

            console.log('⚠️ Invalid activation code created (payment failed):', {
              email: activation.email,
              plan: activation.plan,
              status: activation.status,
              sessionId: session?.id,
              activationCodeHash: codeHash.substring(0, 8) + '...'
            });
          }
        } catch (err) {
          console.error('❌ Error creating invalid activation for failed payment:', err.message);
        }
      }
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

