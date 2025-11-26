const Admin = require('../models/Admin');
const { generateToken } = require('../utils/jwt');

const adminLogin = async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ 
        success: false,
        error: 'Username and password are required' 
      });
    }

    const normalizedUsername = username.toLowerCase().trim();
    console.log('🔐 Admin login attempt:', { username: normalizedUsername });

    const admin = await Admin.findOne({ username: normalizedUsername });
    if (!admin) {
      console.log('❌ Admin not found:', normalizedUsername);
      console.log('   Available admins:', await Admin.find({}, 'username'));
      return res.status(401).json({ 
        success: false,
        error: 'Invalid credentials' 
      });
    }

    console.log('✅ Admin found:', {
      id: admin._id,
      username: admin.username,
      isDefault: admin.isDefault
    });
    
    console.log('   Checking password...');
    const isValid = await admin.comparePassword(password);
    console.log('   Password match result:', isValid);
    
    if (!isValid) {
      console.log('❌ Invalid password for admin:', normalizedUsername);
      console.log('   Expected password: shadow_link@');
      return res.status(401).json({ 
        success: false,
        error: 'Invalid credentials' 
      });
    }

    // Generate JWT token
    const token = generateToken(admin._id, admin.username);
    console.log('✅ Admin login successful:', username.toLowerCase());
    
    // Set JWT token in HTTP-only cookie
    res.cookie('adminToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    
    res.json({ 
      success: true,
      message: 'Login successful',
      redirect: '/admin'
    });
  } catch (error) {
    console.error('❌ Admin login error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Login failed. Please try again.' 
    });
  }
};

const adminLogout = async (req, res) => {
  try {
    // Clear JWT token cookie
    res.clearCookie('adminToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });
    
    res.json({ 
      success: true,
      message: 'Logout successful',
      redirect: '/admin/login'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Logout failed' 
    });
  }
};

const Transaction = require('../models/Transaction');
const Activation = require('../models/Activation');

const getAdminStats = async (req, res, next) => {
  try {
    const stats = {
      totalTransactions: await Transaction.countDocuments(),
      totalPaid: await Transaction.countDocuments({ status: 'paid' }),
      totalPending: await Transaction.countDocuments({ status: 'pending' }),
      totalActivations: await Activation.countDocuments(),
      activeActivations: await Activation.countDocuments({ status: 'active' })
    };
    
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
};

const getAdminTransactions = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const search = req.query.search || '';
    const status = req.query.status || '';
    
    // Build query
    const query = {};
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { plan: { $regex: search, $options: 'i' } },
        { activationCode: { $regex: search, $options: 'i' } },
        { stripeSessionId: { $regex: search, $options: 'i' } }
      ];
    }
    if (status) {
      query.status = status;
    }
    
    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    
    const total = await Transaction.countDocuments(query);
    
    res.json({ 
      success: true, 
      data: transactions,
      total,
      limit
    });
  } catch (error) {
    next(error);
  }
};

const getAdminActivations = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const search = req.query.search || '';
    const status = req.query.status || '';
    const plan = req.query.plan || '';
    
    // Build query
    const query = {};
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { activationCode: { $regex: search, $options: 'i' } },
        { plan: { $regex: search, $options: 'i' } }
      ];
    }
    if (status) {
      if (status === 'expired') {
        query.expiresAt = { $lt: new Date() };
      } else {
        query.status = status;
      }
    }
    if (plan) {
      query.plan = plan;
    }
    
    const activations = await Activation.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    
    // Mark expired activations
    const now = new Date();
    const processedActivations = activations.map(act => {
      const isExpired = act.expiresAt && new Date(act.expiresAt) < now;
      return {
        ...act,
        actualStatus: isExpired ? 'expired' : act.status
      };
    });
    
    const total = await Activation.countDocuments(query);
    
    res.json({ 
      success: true, 
      data: processedActivations,
      total,
      limit
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { adminLogin, adminLogout, getAdminStats, getAdminTransactions, getAdminActivations };

