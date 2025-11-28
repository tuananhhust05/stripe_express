const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'shadow-link-jwt-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const ACTIVATION_TOKEN_SECRET = process.env.ACTIVATION_TOKEN_SECRET || JWT_SECRET;
const ACTIVATION_TOKEN_EXPIRES_IN = process.env.ACTIVATION_TOKEN_EXPIRES_IN || '30d'; // Default 30 days

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
 * Generate JWT token for activation (access token)
 * Token expiration depends on plan expiry:
 * - Monthly plan: Token expires when activation expires
 * - Lifetime plan: Token expires after a very long time (10 years)
 */
const generateActivationToken = (activationId, deviceId, plan, expiresAt) => {
  const payload = {
    activationId: activationId.toString(),
    deviceId,
    plan,
    type: 'activation'
  };

  let tokenExpiresAt = null;
  let tokenExpiresIn = null;

  if (expiresAt) {
    // Monthly plan: Token expires exactly when activation expires
    const expiresAtDate = new Date(expiresAt);
    const now = new Date();
    const diffMs = expiresAtDate.getTime() - now.getTime();
    
    if (diffMs > 0) {
      // Calculate exact expiration time
      tokenExpiresAt = expiresAtDate;
      // For JWT, we need to calculate seconds from now
      const diffSeconds = Math.floor(diffMs / 1000);
      // JWT max expiration is limited, so we'll set it to the exact time
      // Use a large number but ensure it's within JWT limits
      tokenExpiresIn = diffSeconds; // seconds
    } else {
      // Already expired, set short expiration (1 hour)
      tokenExpiresIn = 3600; // 1 hour in seconds
      tokenExpiresAt = new Date(now.getTime() + 3600 * 1000);
    }
  } else {
    // Lifetime plan: Token expires after 10 years (very long but not infinite)
    const tenYearsFromNow = new Date();
    tenYearsFromNow.setFullYear(tenYearsFromNow.getFullYear() + 10);
    tokenExpiresAt = tenYearsFromNow;
    tokenExpiresIn = 10 * 365 * 24 * 60 * 60; // 10 years in seconds
  }

  // Sign token with expiration
  const token = jwt.sign(payload, ACTIVATION_TOKEN_SECRET, {
    expiresIn: tokenExpiresIn,
    issuer: 'shadow-link',
    audience: 'activation'
  });

  // Decode to get actual expiration time from token
  const decoded = jwt.decode(token);
  const actualTokenExpiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : tokenExpiresAt;

  return {
    token,
    expiresAt: actualTokenExpiresAt
  };
};

/**
 * Verify JWT token (for admin)
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
 * Verify activation token (access token)
 */
const verifyActivationToken = (token) => {
  try {
    const decoded = jwt.verify(token, ACTIVATION_TOKEN_SECRET, {
      issuer: 'shadow-link',
      audience: 'activation'
    });
    
    // Check if token is expired
    const now = Math.floor(Date.now() / 1000);
    const isExpired = decoded.exp && decoded.exp < now;
    
    return {
      valid: !isExpired,
      payload: decoded,
      expiresAt: decoded.exp ? new Date(decoded.exp * 1000) : null,
      error: isExpired ? 'Token expired' : null
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
      expiresAt: null
    };
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
  generateActivationToken,
  verifyToken,
  verifyActivationToken,
  getTokenFromCookie
};

