const express = require('express');
const { createCheckoutSession } = require('../controllers/paymentController');
const { validateActivation, getActivationStatus, verifyActivationCode, redeemActivationCode, verifyToken } = require('../controllers/activationController');
const { getTransactions } = require('../controllers/transactionController');
const { adminLogin, adminLogout } = require('../controllers/adminController');
const { register, login, logout, getProfile } = require('../controllers/userController');
const apiAuth = require('../middleware/apiAuth');
const { requireUser } = require('../middleware/userAuth');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Public routes
router.post('/checkout-session', createCheckoutSession);
router.get('/transactions', getTransactions);

// User authentication routes
router.post('/users/register', register);
router.post('/users/login', login);
router.post('/users/logout', logout);
router.get('/users/me', requireUser, getProfile);

// Subscription management routes (protected)
const { getSubscriptionStatus, createSubscriptionCheckout, changeSubscription, cancelSubscription, revokeSubscription, reactivateSubscription, stopService, startService, deleteSubscription } = require('../controllers/subscriptionController');
router.get('/subscriptions/status', requireUser, getSubscriptionStatus);
router.post('/subscriptions/checkout', requireUser, createSubscriptionCheckout);
router.post('/subscriptions/change', requireUser, changeSubscription);
router.post('/subscriptions/cancel', requireUser, cancelSubscription);
router.post('/subscriptions/revoke', requireUser, revokeSubscription);
router.post('/subscriptions/reactivate', requireUser, reactivateSubscription);
router.post('/subscriptions/stop-service', requireUser, stopService);
router.post('/subscriptions/start-service', requireUser, startService);
router.delete('/subscriptions/delete', requireUser, deleteSubscription);
router.get('/check-activation/:email', async (req, res, next) => {
  try {
    const { checkActivationByEmail } = require('../controllers/activationController');
    await checkActivationByEmail(req, res, next);
  } catch (error) {
    next(error);
  }
});

// Admin API routes
router.post('/admin/login', adminLogin);
router.post('/admin/logout', adminLogout);

// Admin data API (protected)
const { requireAdmin } = require('../middleware/adminAuth');
const { getAdminStats, getAdminTransactions, getAdminActivations, resendActivationEmail, getPlanPrices, updatePlanPrice, createTestActivation, simulatePaymentFailure } = require('../controllers/adminController');

router.get('/admin/stats', requireAdmin, getAdminStats);
router.get('/admin/transactions', requireAdmin, getAdminTransactions);
router.get('/admin/activations', requireAdmin, getAdminActivations);
router.post('/admin/activations/:id/resend-email', requireAdmin, resendActivationEmail);
router.post('/admin/activations/test', requireAdmin, createTestActivation);
router.post('/admin/subscriptions/simulate-payment-failure', requireAdmin, simulatePaymentFailure);
router.get('/admin/plan-prices', requireAdmin, getPlanPrices);
router.put('/admin/plan-prices', requireAdmin, updatePlanPrice);

// macOS app API routes (protected with secret)
router.post('/validate', apiAuth, validateActivation);
router.get('/status/:code', apiAuth, getActivationStatus);

// Activation redeem (replaces /activations/verify)
router.post('/activations/redeem', redeemActivationCode);

// Activation token verification
router.post('/activations/verifyToken', verifyToken);

// Legacy/backward compatible route (deprecated, use /activations/redeem)
router.post('/activations/verify', verifyActivationCode);

module.exports = router;

