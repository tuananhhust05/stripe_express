const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const { generateUserToken } = require('../utils/jwt');

// Configure Google OAuth Strategy
const getCallbackURL = () => {
  if (process.env.GOOGLE_CALLBACK_URL) {
    return process.env.GOOGLE_CALLBACK_URL;
  }
  const baseURL = process.env.APP_BASE_URL || 'http://localhost:3334';
  return `${baseURL}/api/auth/google/callback`;
};

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: getCallbackURL()
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Check if user exists with this Google ID
        let user = await User.findOne({ googleId: profile.id });

        if (user) {
          // User exists, update last login
          user.lastLogin = new Date();
          await user.save();
          return done(null, user);
        }

        // Check if user exists with this email (but registered with password)
        user = await User.findOne({ email: profile.emails[0].value.toLowerCase() });

        if (user) {
          // If user already has a different Google ID, don't allow linking
          if (user.googleId && user.googleId !== profile.id) {
            return done(new Error('This email is already linked to a different Google account'), null);
          }
          
          // Link Google account to existing user (if not already linked)
          if (!user.googleId) {
            user.googleId = profile.id;
            console.log('✅ Linked Google account to existing user:', user.email);
          }
          
          if (!user.name && profile.displayName) {
            user.name = profile.displayName;
          }
          user.lastLogin = new Date();
          await user.save();
          return done(null, user);
        }

        // Create new user
        user = await User.create({
          googleId: profile.id,
          email: profile.emails[0].value.toLowerCase(),
          name: profile.displayName || null,
          password: undefined // No password for Google OAuth users
        });

        console.log('✅ User registered via Google:', user.email);
        return done(null, user);
      } catch (error) {
        console.error('❌ Google OAuth error:', error);
        return done(error, null);
      }
    }
  )
);

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user._id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).select('-password');
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;

