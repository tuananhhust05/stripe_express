const User = require('../models/User');
const { getUserTokenFromCookie, verifyUserToken } = require('../utils/jwt');

const requireUser = async (req, res, next) => {
  try {
    // Get token from cookie
    const token = getUserTokenFromCookie(req);
    
    if (!token) {
      // For API requests, return JSON error
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ 
          success: false,
          error: 'Unauthorized. Please login.' 
        });
      }
      // For page requests, redirect to login
      return res.redirect('/login');
    }

    // Verify token
    const { valid, payload, error } = verifyUserToken(token);
    
    if (!valid) {
      console.log('❌ Invalid user JWT token:', error);
      // Clear invalid cookie
      res.clearCookie('userToken');
      
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ 
          success: false,
          error: 'Invalid or expired token' 
        });
      }
      return res.redirect('/login');
    }

    // Get user from database
    const user = await User.findById(payload.userId);
    if (!user) {
      console.log('❌ User not found in database:', payload.userId);
      res.clearCookie('userToken');
      
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ 
          success: false,
          error: 'User not found' 
        });
      }
      return res.redirect('/login');
    }

    if (!user.isActive) {
      res.clearCookie('userToken');
      if (req.path.startsWith('/api/')) {
        return res.status(403).json({ 
          success: false,
          error: 'Account is deactivated' 
        });
      }
      return res.redirect('/login');
    }

    // Attach user to request
    req.user = user;
    req.userId = payload.userId;
    next();
  } catch (error) {
    console.error('❌ User auth error:', error);
    res.clearCookie('userToken');
    
    if (req.path.startsWith('/api/')) {
      return res.status(500).json({ 
        success: false,
        error: 'Authentication error' 
      });
    }
    return res.redirect('/login');
  }
};

module.exports = { requireUser };


