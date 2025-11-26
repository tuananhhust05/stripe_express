const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'shadow-link-jwt-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

/**
 * Generate JWT token for admin
 */
const generateToken = (adminId, username) => {
  const payload = {
    adminId: adminId.toString(),
    username,
    type: 'admin'
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    issuer: 'shadow-link',
    audience: 'admin'
  });
};

/**
 * Verify JWT token
 */
const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'shadow-link',
      audience: 'admin'
    });
    return { valid: true, payload: decoded };
  } catch (error) {
    return { valid: false, error: error.message };
  }
};

/**
 * Get token from cookie
 */
const getTokenFromCookie = (req) => {
  return req.cookies?.adminToken || null;
};

module.exports = {
  generateToken,
  verifyToken,
  getTokenFromCookie
};

