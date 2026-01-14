const express = require('express');
const Admin = require('../models/Admin');
const Transaction = require('../models/Transaction');
const Activation = require('../models/Activation');
const { requireAdmin } = require('../middleware/adminAuth');

const router = express.Router();

// Login page
// router.get('/login', (req, res) => {
//   // Check if already logged in via JWT
//   const { getTokenFromCookie, verifyToken } = require('../utils/jwt');
//   const token = getTokenFromCookie(req);
  
//   if (token) {
//     const { valid } = verifyToken(token);
//     if (valid) {
//       return res.redirect('/admin');
//     }
//   }
  
//   res.render('admin/login', { title: 'Admin Login', error: null });
// });

// // Dashboard (protected) - just render the page, data will be loaded via API
// router.get('/', requireAdmin, (req, res) => {
//   res.render('admin/dashboard', { title: 'Admin Dashboard' });
// });

// // Transactions page - just render the page, data will be loaded via API
// router.get('/transactions', requireAdmin, (req, res) => {
//   res.render('admin/transactions', { title: 'Transactions' });
// });

// // Activations page - just render the page, data will be loaded via API
// router.get('/activations', requireAdmin, (req, res) => {
//   res.render('admin/activations', { title: 'Activations' });
// });

// // Pricing page - just render the page, data will be loaded via API
// router.get('/pricing', requireAdmin, (req, res) => {
//   res.render('admin/pricing', { title: 'Pricing' });
// });

module.exports = router;

