const express = require('express');
const { getPlans } = require('../utils/planConfig');
const Transaction = require('../models/Transaction');

const router = express.Router();

// router.get('/', async (req, res) => {
//   const plans = await getPlans();
//   let user = null;
  
//   // Check if user is logged in
//   try {
//     const { getUserTokenFromCookie, verifyUserToken } = require('../utils/jwt');
//     const User = require('../models/User');
//     const token = getUserTokenFromCookie(req);
//     if (token) {
//       const { valid, payload } = verifyUserToken(token);
//       if (valid && payload) {
//         user = await User.findById(payload.userId).select('-password');
//       }
//     }
//   } catch (err) {
//     // Ignore errors, just don't set user
//   }
  
//   res.render('landing', {
//     title: 'Shadow Link',
//     plans,
//     user,
//     stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY
//   });
// });

// router.get('/payment', async (req, res) => {
//   const plans = await getPlans();
//   res.render('payment', {
//     title: 'Shadow Link - Payment',
//     plans,
//     stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY
//   });
// });

// // User authentication pages
// router.get('/login', (req, res) => {
//   res.render('login', {
//     title: 'Login - Shadow Link'
//   });
// });

// router.get('/register', (req, res) => {
//   res.render('register', {
//     title: 'Register - Shadow Link'
//   });
// });

// // Subscription management pages (protected)
// const { requireUser } = require('../middleware/userAuth');
// router.get('/subscription', requireUser, async (req, res) => {
//   res.render('subscription', {
//     title: 'Subscription - Shadow Link',
//     user: req.user
//   });
// });

// router.get('/subscription/success', async (req, res) => {
//   const { session_id } = req.query;
//   let subscriptionData = null;
//   let user = null;

//   // First check if user is already logged in (has session cookie)
//   if (req.user) {
//     user = req.user;
//   }

//   if (session_id && session_id.startsWith('cs_')) {
//     try {
//       const { stripe } = require('../services/stripeService');
//       if (stripe) {
//         const session = await stripe.checkout.sessions.retrieve(session_id);
//         const { handleCheckoutSessionCompleted } = require('../services/subscriptionService');
//         await handleCheckoutSessionCompleted(session);
        
//         subscriptionData = {
//           sessionId: session.id,
//           mode: session.mode,
//           status: session.status,
//           paymentStatus: session.payment_status
//         };

//         // If user not found from session cookie, try to get from session metadata or customer
//         if (!user) {
//           if (session.metadata?.userId) {
//             const User = require('../models/User');
//             user = await User.findById(session.metadata.userId).select('-password');
//           } else if (session.customer) {
//             const User = require('../models/User');
//             user = await User.findOne({ stripeCustomerId: session.customer }).select('-password');
//           }
//         }

//         // If user found and logged in, redirect to subscription page immediately
//         if (user && req.user) {
//           return res.redirect('/subscription');
//         }
//       }
//     } catch (err) {
//       console.error('❌ Error processing subscription success:', err);
//     }
//   }

//   res.render('subscription-success', {
//     title: 'Subscription Success - Shadow Link',
//     subscriptionData,
//     user
//   });
// });

// router.get('/subscription/cancel', (req, res) => {
//   res.render('subscription-cancel', {
//     title: 'Subscription Canceled - Shadow Link'
//   });
// });

// // Simple in-memory rate limiting for success page
// const successPageAttempts = new Map();
// const RATE_LIMIT_WINDOW = 60000; // 1 minute
// const MAX_ATTEMPTS_PER_IP = 10;

// const rateLimitSuccessPage = (req, res, next) => {
//   const ip = req.ip || req.connection.remoteAddress;
//   const now = Date.now();
  
//   if (!successPageAttempts.has(ip)) {
//     successPageAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
//     return next();
//   }
  
//   const record = successPageAttempts.get(ip);
  
//   if (now > record.resetAt) {
//     // Reset window
//     successPageAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
//     return next();
//   }
  
//   if (record.count >= MAX_ATTEMPTS_PER_IP) {
//     console.warn(`⚠️ Rate limit exceeded for success page: ${ip}`);
//     return res.status(429).render('payment-success', {
//       title: 'Payment Success',
//       error: 'Too many requests. Please try again later.'
//     });
//   }
  
//   record.count++;
//   next();
// };

// router.get('/payment/success', rateLimitSuccessPage, async (req, res) => {
//   const { session_id } = req.query;
//   let sessionData = null;
//   let activationCode = null;
  
//   // Security: Validate session_id format (Stripe session IDs start with cs_)
//   if (session_id && !session_id.startsWith('cs_')) {
//     console.warn('⚠️ Invalid session_id format:', session_id);
//     return res.render('payment-success', {
//       title: 'Payment Success',
//       error: 'Invalid session ID'
//     });
//   }
  
//   // If session_id is provided, verify payment and create activation immediately
//   if (session_id) {
//     try {
//       const { stripe } = require('../services/stripeService');
      
//       if (!stripe) {
//         throw new Error('Stripe not configured');
//       }
//       const { processPaymentSession } = require('../controllers/paymentController');
      
//       // SECURITY: Always verify session from Stripe API (never trust client input)
//       const session = await stripe.checkout.sessions.retrieve(session_id);
      
//       // SECURITY: Additional validation
//       if (!session || !session.id) {
//         console.error('❌ Invalid session retrieved from Stripe');
//         return res.render('payment-success', {
//           title: 'Payment Success',
//           error: 'Invalid payment session'
//         });
//       }
      
//       // Log full session data from Stripe
//       console.log('📋 Full Stripe Session Data:', JSON.stringify(session, null, 2));
//       console.log('📋 Session Summary:', {
//         id: session.id,
//         object: session.object,
//         mode: session.mode,
//         status: session.status,
//         payment_status: session.payment_status,
//         customer: session.customer,
//         customer_email: session.customer_email,
//         customer_details: session.customer_details,
//         subscription: session.subscription,
//         payment_intent: session.payment_intent,
//         metadata: session.metadata,
//         amount_total: session.amount_total,
//         currency: session.currency,
//         created: session.created ? new Date(session.created * 1000).toISOString() : null,
//         expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
//         payment_method_types: session.payment_method_types,
//         line_items: session.line_items,
//         success_url: session.success_url,
//         cancel_url: session.cancel_url
//       });
      
//       // SECURITY: Log all attempts for audit trail
//       console.log('🔒 Success page access:', {
//         sessionId: session.id,
//         ip: req.ip || req.connection.remoteAddress,
//         userAgent: req.get('user-agent'),
//         timestamp: new Date().toISOString()
//       });
      
//       sessionData = {
//         id: session.id,
//         paymentStatus: session.payment_status,
//         email: session.customer_details?.email || session.customer_email || session.metadata?.email,
//         planId: session.metadata?.planId
//       };
      
//       // SECURITY: Only process if payment_status is 'paid' (verified from Stripe API)
//       if (session.payment_status === 'paid') {
//         try {
//           // processPaymentSession already has idempotency check (prevents duplicate activations)
//           const activation = await processPaymentSession(session);
//           if (activation) {
//             // Use activationCodeHash instead of plain code
//             activationCode = activation.activationCodeHash || activation.activationCode;
//             console.log('✅ Activation created on success page:', {
//               activationCodeHash: activationCode,
//               sessionId: session.id,
//               email: sessionData.email
//             });
//           }
//         } catch (err) {
//           console.error('❌ Error processing payment session:', {
//             error: err.message,
//             sessionId: session.id,
//             stack: err.stack
//           });
//           // Don't fail the page, just log the error
//         }
//       } else {
//         console.warn('⚠️ Payment not completed:', {
//           sessionId: session.id,
//           paymentStatus: session.payment_status
//         });
//       }
//     } catch (err) {
//       // SECURITY: Don't expose Stripe errors to client
//       console.error('❌ Error retrieving Stripe session:', {
//         error: err.message,
//         sessionId: session_id,
//         type: err.type
//       });
      
//       // If it's an invalid session, show error
//       if (err.type === 'StripeInvalidRequestError') {
//         return res.render('payment-success', {
//           title: 'Payment Success',
//           error: 'Invalid payment session. Please contact support if you completed payment.'
//         });
//       }
//     }
//   }
  
//   res.render('payment-success', { 
//     title: 'Payment Success',
//     sessionData,
//     activationCode,
//     stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY
//   });
// });

// router.get('/payment/cancel', (req, res) => {
//   res.render('payment-cancel', { title: 'Payment Canceled' });
// });

// router.get('/transactions', async (req, res, next) => {
//   try {
//     const transactions = await Transaction.find().sort({ createdAt: -1 }).limit(100).lean();
//     res.render('transactions', {
//       title: 'Shadow Link - Transactions',
//       transactions
//     });
//   } catch (err) {
//     next(err);
//   }
// });

module.exports = router;

