const User = require('../models/User');
const { generateUserToken } = require('../utils/jwt');

/**
 * Register new user
 */
const register = async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'User with this email already exists'
      });
    }

    // Create new user
    const user = await User.create({
      email: email.toLowerCase().trim(),
      password,
      name: name?.trim() || null
    });

    // Generate JWT token
    const token = generateUserToken(user._id, user.email);

    // Set JWT token in HTTP-only cookie
    // Use 'lax' instead of 'strict' to allow redirect after setting cookie
    res.cookie('userToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Changed from 'strict' to allow redirect after registration
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    console.log('✅ User registered:', user.email);

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        subscriptionStatus: user.subscriptionStatus,
        subscriptionPlan: user.subscriptionPlan
      }
    });
  } catch (error) {
    console.error('❌ Registration error:', error);
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: 'User with this email already exists'
      });
    }
    next(error);
  }
};

/**
 * Login user
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        error: 'Account is deactivated'
      });
    }

    // Check if user only has Google account (no password)
    if (!user.password) {
      return res.status(401).json({
        success: false,
        error: 'This account is linked to Google. Please sign in with Google.'
      });
    }

    const isValid = await user.comparePassword(password);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate JWT token
    const token = generateUserToken(user._id, user.email);

    // Set JWT token in HTTP-only cookie
    // Use 'lax' instead of 'strict' to allow redirect after setting cookie
    res.cookie('userToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Changed from 'strict' to allow redirect after login
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    console.log('✅ User logged in:', user.email);

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        subscriptionStatus: user.subscriptionStatus,
        subscriptionPlan: user.subscriptionPlan,
        subscriptionCurrentPeriodEnd: user.subscriptionCurrentPeriodEnd
      }
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    next(error);
  }
};

/**
 * Logout user
 */
const logout = async (req, res) => {
  res.clearCookie('userToken');
  res.json({
    success: true,
    message: 'Logout successful'
  });
};

/**
 * Get current user profile
 */
const getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        subscriptionStatus: user.subscriptionStatus,
        subscriptionPlan: user.subscriptionPlan,
        subscriptionCurrentPeriodEnd: user.subscriptionCurrentPeriodEnd,
        stripeCustomerId: user.stripeCustomerId,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Google OAuth callback handler
 */
const googleCallback = async (req, res, next) => {
  try {
    const user = req.user;

    if (!user) {
      return res.redirect('/login?error=authentication_failed');
    }

    if (!user.isActive) {
      return res.redirect('/login?error=account_deactivated');
    }

    // Generate JWT token
    const token = generateUserToken(user._id, user.email);

    // Set JWT token in HTTP-only cookie
    // Use 'lax' instead of 'strict' to allow redirect after setting cookie
    res.cookie('userToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Changed from 'strict' to allow redirect after Google OAuth
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    // Check if this is a new user (just created)
    const isNewUser = user.createdAt && (Date.now() - new Date(user.createdAt).getTime()) < 5000; // Created less than 5 seconds ago

    console.log('✅ User logged in via Google:', user.email, isNewUser ? '(new user)' : '(existing user)');

    // Get redirect URL from query string or session, default to /subscription
    // This matches the behavior of email/password login which redirects to /subscription
    const redirectUrl = req.query.redirect || (req.session && req.session.returnTo) || '/subscription';
    
    // Clear returnTo from session if exists
    if (req.session && req.session.returnTo) {
      delete req.session.returnTo;
    }

    // Redirect to subscription page (same as email/password login flow)
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('❌ Google callback error:', error);
    res.redirect('/login?error=authentication_failed');
  }
};

module.exports = {
  register,
  login,
  logout,
  getProfile,
  googleCallback
};


