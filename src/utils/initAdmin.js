const Admin = require('../models/Admin');
const bcrypt = require('bcrypt');

const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'shadow_link@';

const initAdmin = async () => {
  try {
    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ username: DEFAULT_USERNAME.toLowerCase() });
    
    if (!existingAdmin) {
      // Create default admin - password will be hashed by pre('save') hook
      const admin = await Admin.create({
        username: DEFAULT_USERNAME.toLowerCase(),
        password: DEFAULT_PASSWORD, // Plain text, will be hashed by pre('save')
        isDefault: true
      });
      console.log('✅ Default admin user created:');
      console.log('   Username: admin');
      console.log('   Password: shadow_link@');
      console.log('   ID:', admin._id);
      
      // Verify password after creation
      const testMatch = await admin.comparePassword(DEFAULT_PASSWORD);
      console.log('   Password verification:', testMatch ? '✅ Match' : '❌ No match');
    } else {
      console.log('ℹ️  Admin user already exists');
      console.log('   Username:', existingAdmin.username);
      console.log('   ID:', existingAdmin._id);
      
      // Verify password can be compared (for debugging)
      const testMatch = await existingAdmin.comparePassword(DEFAULT_PASSWORD);
      console.log('   Password test match:', testMatch ? '✅ Match' : '❌ No match');
      
      // If password doesn't match, reset it
      if (!testMatch) {
        console.log('⚠️  Password mismatch detected. Resetting admin password...');
        existingAdmin.password = DEFAULT_PASSWORD; // Will be hashed by pre('save')
        await existingAdmin.save();
        console.log('✅ Admin password reset successfully');
        
        // Verify again
        const newTestMatch = await existingAdmin.comparePassword(DEFAULT_PASSWORD);
        console.log('   New password verification:', newTestMatch ? '✅ Match' : '❌ No match');
      }
    }
  } catch (error) {
    console.error('❌ Error initializing admin user:', error.message);
    console.error('   Stack:', error.stack);
  }
};

module.exports = { initAdmin };

