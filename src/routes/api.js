const express = require('express');
const { createCheckoutSession } = require('../controllers/paymentController');
const { validateActivation, getActivationStatus, verifyActivationCode } = require('../controllers/activationController');
const { getTransactions } = require('../controllers/transactionController');
const { adminLogin, adminLogout } = require('../controllers/adminController');
const apiAuth = require('../middleware/apiAuth');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Public routes
router.post('/checkout-session', createCheckoutSession);
router.get('/transactions', getTransactions);
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
const { getAdminStats, getAdminTransactions, getAdminActivations } = require('../controllers/adminController');

router.get('/admin/stats', requireAdmin, getAdminStats);
router.get('/admin/transactions', requireAdmin, getAdminTransactions);
router.get('/admin/activations', requireAdmin, getAdminActivations);

// macOS app API routes (protected with secret)
router.post('/validate', apiAuth, validateActivation);
router.get('/status/:code', apiAuth, getActivationStatus);

// Legacy/backward compatible route
router.post('/activations/verify', verifyActivationCode);

module.exports = router;

