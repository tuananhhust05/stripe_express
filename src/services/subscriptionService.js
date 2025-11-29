const User = require('../models/User');
const { stripe } = require('../services/stripeService');

/**
 * Sync subscription data from Stripe to User model
 */
const syncSubscriptionToUser = async (subscriptionId, customerId = null) => {
  if (!stripe) {
    console.warn('⚠️ Stripe not configured, cannot sync subscription');
    return null;
  }

  try {
    // Retrieve subscription from Stripe
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    
    // Find user by subscriptionId or customerId
    let user;
    if (customerId) {
      user = await User.findOne({ stripeCustomerId: customerId });
    } else {
      user = await User.findOne({ subscriptionId: subscriptionId });
    }

    if (!user) {
      // Try to find by customer ID from subscription
      if (subscription.customer) {
        user = await User.findOne({ stripeCustomerId: subscription.customer });
      }
    }

    if (!user) {
      console.warn('⚠️ User not found for subscription:', subscriptionId);
      return null;
    }

    // Get planId from price metadata
    const planId = subscription.items.data[0]?.price?.metadata?.planId || 
                   subscription.metadata?.planId || 
                   'monthly';

    // Update user subscription info
    user.subscriptionId = subscription.id;
    user.subscriptionStatus = subscription.status;
    user.subscriptionPlan = planId === 'lifetime' ? 'lifetime' : 'monthly';
    user.subscriptionCurrentPeriodEnd = subscription.current_period_end 
      ? new Date(subscription.current_period_end * 1000) 
      : null;

    // If subscription is canceled and past period end, clear subscription
    if (subscription.status === 'canceled' && subscription.canceled_at) {
      const canceledAt = new Date(subscription.canceled_at * 1000);
      const now = new Date();
      if (canceledAt < now) {
        user.subscriptionStatus = 'canceled';
        user.subscriptionPlan = null;
        user.subscriptionCurrentPeriodEnd = null;
      }
    }

    await user.save();

    console.log('✅ Subscription synced to user:', {
      userId: user._id,
      email: user.email,
      subscriptionId: subscription.id,
      status: subscription.status,
      plan: planId
    });

    return user;
  } catch (error) {
    console.error('❌ Error syncing subscription to user:', error);
    throw error;
  }
};

/**
 * Handle subscription created/updated webhook
 * This handles: renewals, upgrades, downgrades, cancellations
 */
const handleSubscriptionWebhook = async (subscription) => {
  try {
    const customerId = subscription.customer;
    const subscriptionId = subscription.id;

    const user = await syncSubscriptionToUser(subscriptionId, customerId);

    if (!user) {
      return { success: true }; // User not found, skip activation update
    }

    const Activation = require('../models/Activation');
    
    // Find all activation records for this subscription or customer
    let activations = await Activation.find({
      $or: [
        { stripeSubscriptionId: subscriptionId },
        { stripeCustomerId: customerId, email: user.email }
      ]
    });

    // Handle different subscription statuses
    if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
      // Subscription canceled or unpaid - deactivate all related activations
      for (const activation of activations) {
        if (activation.status === 'active') {
          activation.status = 'revoked';
          activation.stripeSubscriptionStatus = subscription.status;
          await activation.save();
          console.log('❌ Activation revoked due to subscription cancellation:', {
            activationId: activation._id,
            email: activation.email,
            subscriptionStatus: subscription.status
          });
        }
      }
    } else if (['active', 'trialing', 'past_due'].includes(subscription.status)) {
      // Subscription is active - update or create activation records
      
      // Get plan from subscription
      const planId = subscription.items.data[0]?.price?.metadata?.planId || 
                     subscription.metadata?.planId || 
                     'monthly';

      // Update existing activations (do not create new ones on renewal)
      for (const activation of activations) {
        activation.stripeSubscriptionStatus = subscription.status;
        activation.status = 'active'; // Reactivate if it was revoked
        
        if (subscription.current_period_end) {
          activation.stripeCurrentPeriodEnd = new Date(subscription.current_period_end * 1000);
          if (activation.plan === 'monthly') {
            activation.expiresAt = activation.stripeCurrentPeriodEnd;
          } else if (activation.plan === 'lifetime') {
            activation.expiresAt = null; // Lifetime never expires
          }
        }
        
        // Update plan if changed
        if (planId && activation.plan !== planId) {
          activation.plan = planId;
        }
        
        await activation.save();
        
        console.log('✅ Activation updated from subscription webhook:', {
          activationId: activation._id,
          email: activation.email,
          subscriptionStatus: subscription.status,
          expiresAt: activation.expiresAt,
          plan: activation.plan
        });
      }

      // Only create new activation if this is a new subscription (not renewal)
      // Check if subscription was just created (created timestamp is recent)
      if (activations.length === 0) {
        const subscriptionCreated = new Date(subscription.created * 1000);
        const now = new Date();
        const timeSinceCreation = now - subscriptionCreated;
        // Only create if subscription was created within last 5 minutes (new subscription, not renewal)
        if (timeSinceCreation < 5 * 60 * 1000) {
          await createActivationFromSubscription(user, subscription);
        } else {
          console.log('⚠️ No activation found for existing subscription (likely renewal), skipping creation:', {
            subscriptionId: subscription.id,
            email: user.email,
            subscriptionAge: Math.floor(timeSinceCreation / 1000 / 60) + ' minutes'
          });
        }
      }
    }

    return { success: true };
  } catch (error) {
    console.error('❌ Error handling subscription webhook:', error);
    throw error;
  }
};

/**
 * Create activation record from subscription
 */
const createActivationFromSubscription = async (user, subscription) => {
  try {
    const Activation = require('../models/Activation');
    const { hashActivationCode } = require('../utils/cryptoUtils');
    const { v4: uuidv4 } = require('uuid');
    const { getPlanOrThrow } = require('../utils/planConfig');

    // Get plan from subscription
    const planId = subscription.items.data[0]?.price?.metadata?.planId || 
                   subscription.metadata?.planId || 
                   'monthly';
    const plan = await getPlanOrThrow(planId);

    // Check if activation already exists for this subscription
    const existingActivation = await Activation.findOne({ 
      stripeSubscriptionId: subscription.id,
      email: user.email
    });

    if (existingActivation) {
      console.log('✅ Activation already exists for subscription:', {
        subscriptionId: subscription.id,
        email: user.email
      });
      return existingActivation;
    }

    // Generate activation code
    const plainCode = uuidv4().replace(/-/g, '').slice(0, 16).toUpperCase();
    const codeHash = hashActivationCode(plainCode);

    // Calculate expiry
    let expiresAt = null;
    if (planId === 'monthly' && subscription.current_period_end) {
      expiresAt = new Date(subscription.current_period_end * 1000);
    }

    // Create activation record
    const activation = await Activation.create({
      email: user.email,
      plan: planId,
      activationCodeHash: codeHash,
      activationCode: plainCode, // For backward compatibility
      status: 'active',
      expiresAt,
      stripeCustomerId: user.stripeCustomerId,
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: subscription.status,
      stripeCurrentPeriodEnd: subscription.current_period_end 
        ? new Date(subscription.current_period_end * 1000) 
        : null
    });

    // Send activation email
    const { sendActivationEmail } = require('../services/emailService');
    await sendActivationEmail({
      to: user.email,
      activationCode: codeHash,
      planLabel: plan.label,
      expiresAt
    });

    console.log('✅ Activation created from subscription:', {
      email: user.email,
      subscriptionId: subscription.id,
      plan: planId,
      activationCodeHash: codeHash.substring(0, 8) + '...'
    });

    return activation;
  } catch (error) {
    console.error('❌ Error creating activation from subscription:', error);
    throw error;
  }
};

/**
 * Handle checkout session completed for subscription
 */
const handleCheckoutSessionCompleted = async (session) => {
  try {
    if (session.mode === 'subscription' && session.subscription) {
      // This is a subscription checkout
      const userId = session.metadata?.userId;
      const customerId = session.customer;

      let user;
      if (userId) {
        user = await User.findById(userId);
      } else if (customerId) {
        user = await User.findOne({ stripeCustomerId: customerId });
      }

      if (user) {
        // Sync subscription to user
        await syncSubscriptionToUser(session.subscription, customerId);
        
        // Retrieve full subscription to create activation
        if (stripe) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription);
          
          // If subscription is in trialing status, check if it's a downgrade from lifetime
          // For downgrade from lifetime, we want to keep trial (first month free) but treat as active
          // For new subscriptions, convert trialing to active immediately
          const isDowngradeFromLifetime = subscription.metadata?.downgradedFrom === 'lifetime' ||
                                         session.metadata?.fromPlan === 'lifetime' ||
                                         session.metadata?.action === 'downgrade';
          
          if (subscription.status === 'trialing' && !isDowngradeFromLifetime) {
            // New subscription with trial - convert to active immediately
            try {
              const updatedSubscription = await stripe.subscriptions.update(session.subscription, {
                trial_end: 'now' // End trial immediately
              });
              
              console.log('✅ Converted trialing subscription to active:', {
                subscriptionId: session.subscription,
                oldStatus: subscription.status,
                newStatus: updatedSubscription.status
              });
              
              user.subscriptionStatus = updatedSubscription.status;
              await user.save();
              
              await createActivationFromSubscription(user, updatedSubscription);
            } catch (err) {
              console.error('❌ Error converting trialing to active:', err.message);
              await createActivationFromSubscription(user, subscription);
            }
          } else if (subscription.status === 'trialing' && isDowngradeFromLifetime) {
            // Downgrade from lifetime - keep trial (first month free) but treat subscription as valid
            // Don't end trial - let it run for free first month
            console.log('✅ Downgrade from lifetime - keeping trial period (first month free):', {
              subscriptionId: session.subscription,
              status: subscription.status,
              trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null
            });
            
            // Update user status to trialing (but it's valid and free)
            user.subscriptionStatus = subscription.status;
            user.subscriptionPlan = 'monthly'; // Update plan to monthly
            await user.save();
            
            // Update ALL existing activation records to monthly (not just create new one)
            const Activation = require('../models/Activation');
            const activations = await Activation.find({
              $or: [
                { stripeSubscriptionId: subscription.id },
                { stripeCustomerId: user.stripeCustomerId, email: user.email }
              ]
            });

            // Update all activations to monthly
            for (const activation of activations) {
              activation.plan = 'monthly';
              activation.stripeSubscriptionId = subscription.id;
              activation.stripeSubscriptionStatus = subscription.status;
              if (subscription.current_period_end) {
                activation.stripeCurrentPeriodEnd = new Date(subscription.current_period_end * 1000);
                activation.expiresAt = activation.stripeCurrentPeriodEnd;
              }
              activation.status = 'active';
              await activation.save();
              console.log('✅ Activation updated to monthly (downgrade):', {
                activationId: activation._id,
                email: activation.email
              });
            }
            
            // Create new activation if none exists
            await createActivationFromSubscription(user, subscription);
          } else {
            // Subscription is already active
            await createActivationFromSubscription(user, subscription);
          }
        }
      }
    } else if (session.mode === 'payment' && session.metadata?.planId === 'lifetime') {
      // This is a lifetime payment
      const userId = session.metadata?.userId;
      const customerId = session.customer;

      if (userId) {
        const user = await User.findById(userId);
        if (user) {
          // For lifetime, we don't create a subscription, just update user
          // If this is an upgrade from monthly, update subscription metadata but keep it for tracking
          if (session.metadata?.action === 'upgrade' && user.subscriptionId) {
            // Update subscription metadata to mark as upgraded to lifetime
            // Keep subscription for tracking but mark it as lifetime
            try {
              const oldSubscription = await stripe.subscriptions.retrieve(user.subscriptionId);
              await stripe.subscriptions.update(user.subscriptionId, {
                metadata: {
                  ...oldSubscription.metadata,
                  planId: 'lifetime',
                  upgradedToLifetime: 'true',
                  upgradedAt: new Date().toISOString()
                },
                cancel_at_period_end: true // Cancel at period end but keep for tracking
              });
              console.log('✅ Subscription metadata updated to lifetime after upgrade:', {
                subscriptionId: user.subscriptionId
              });
            } catch (err) {
              console.warn('⚠️ Could not update subscription metadata:', err.message);
            }
            // Keep subscriptionId for tracking, but plan is now lifetime
          }
          
          user.subscriptionPlan = 'lifetime';
          user.subscriptionStatus = 'active';
          // Keep subscriptionCurrentPeriodEnd if exists (for reference), but plan is lifetime
          // user.subscriptionCurrentPeriodEnd = null; // Don't clear, keep for reference
          await user.save();
          
          console.log('✅ User upgraded to lifetime plan:', {
            userId: user._id,
            email: user.email
          });

          // Update ALL existing activation records to lifetime
          const Activation = require('../models/Activation');
          const activations = await Activation.find({
            $or: [
              { stripeSubscriptionId: user.subscriptionId },
              { stripeCustomerId: user.stripeCustomerId, email: user.email }
            ]
          });

          // Update all activations to lifetime
          for (const activation of activations) {
            activation.plan = 'lifetime';
            activation.expiresAt = null;
            activation.status = 'active';
            await activation.save();
            console.log('✅ Activation updated to lifetime:', {
              activationId: activation._id,
              email: activation.email
            });
          }

          // Create new activation record for lifetime if none exists
          const { hashActivationCode } = require('../utils/cryptoUtils');
          const { v4: uuidv4 } = require('uuid');
          const { getPlanOrThrow } = require('../utils/planConfig');
          const { sendActivationEmail } = require('../services/emailService');

          const plan = await getPlanOrThrow('lifetime');
          const existingLifetimeActivation = await Activation.findOne({ 
            email: user.email,
            plan: 'lifetime',
            stripeCustomerId: user.stripeCustomerId
          });

          if (!existingLifetimeActivation) {
            const plainCode = uuidv4().replace(/-/g, '').slice(0, 16).toUpperCase();
            const codeHash = hashActivationCode(plainCode);

            const activation = await Activation.create({
              email: user.email,
              plan: 'lifetime',
              activationCodeHash: codeHash,
              activationCode: plainCode,
              status: 'active',
              expiresAt: null,
              stripeCustomerId: user.stripeCustomerId,
              stripeSessionId: session.id
            });

            await sendActivationEmail({
              to: user.email,
              activationCode: codeHash,
              planLabel: plan.label,
              expiresAt: null
            });

            console.log('✅ Lifetime activation created for user:', {
              userId: user._id,
              email: user.email,
              activationCodeHash: codeHash.substring(0, 8) + '...'
            });
          }
        }
      }
    }

    return { success: true };
  } catch (error) {
    console.error('❌ Error handling checkout session completed:', error);
    throw error;
  }
};

module.exports = {
  syncSubscriptionToUser,
  handleSubscriptionWebhook,
  handleCheckoutSessionCompleted,
  createActivationFromSubscription
};


