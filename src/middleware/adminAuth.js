const Admin = require('../models/Admin');
const { getTokenFromCookie, verifyToken } = require('../utils/jwt');

const requireAdmin = async (req, res, next) => {
  try {
    // Get token from cookie
    const token = getTokenFromCookie(req);
    
    if (!token) {
      // For API requests, return JSON error
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ 
          success: false,
          error: 'Unauthorized. Please login.' 
        });
      }
      // For page requests, redirect to login
      return res.redirect('/admin/login');
    }

    // Verify token
    const { valid, payload, error } = verifyToken(token);
    
    if (!valid) {
      console.log('❌ Invalid JWT token:', error);
      // Clear invalid cookie
      res.clearCookie('adminToken');
      
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ 
          success: false,
          error: 'Invalid or expired token' 
        });
      }
      return res.redirect('/admin/login');
    }

    // Get admin from database
    const admin = await Admin.findById(payload.adminId);
    if (!admin) {
      console.log('❌ Admin not found in database:', payload.adminId);
      res.clearCookie('adminToken');
      
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ 
          success: false,
          error: 'Admin not found' 
        });
      }
      return res.redirect('/admin/login');
    }

    // Attach admin to request
    req.admin = admin;
    req.adminId = payload.adminId;
    next();
  } catch (error) {
    console.error('❌ Admin auth error:', error);
    res.clearCookie('adminToken');
    
    if (req.path.startsWith('/api/')) {
      return res.status(500).json({ 
        success: false,
        error: 'Authentication error' 
      });
    }
    return res.redirect('/admin/login');
  }
};

module.exports = { requireAdmin };

