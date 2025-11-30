const path = require('path');
const express = require('express');
const morgan = require('morgan');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const dotenv = require('dotenv');

dotenv.config();

const webRoutes = require('./routes/web');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const stripeWebhook = require('./routes/webhook');
const { initAdmin } = require('./utils/initAdmin');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(morgan('combined'));

// Cookie parser for JWT tokens
app.use(cookieParser());

// Session configuration for Passport
app.use(
  session({
    secret: process.env.SESSION_SECRET || process.env.API_SECRET || 'your-session-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  })
);

// Initialize Passport
const passport = require('./config/passport');
app.use(passport.initialize());
app.use(passport.session());

// Stripe webhook needs the  raw  body , so register  before global body parsers
app.use('/webhook/stripe', stripeWebhook);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use('/', webRoutes);
app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);

const PORT = process.env.PORT || 3334;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/shadow_link';

mongoose
  .connect(MONGO_URI, { autoIndex: true })
  .then(async () => {
    // Initialize admin user
    await initAdmin();
    
    // Initialize plan prices
    const { initializePlanPrices } = require('./utils/planConfig');
    await initializePlanPrices();
    
    app.listen(PORT, () => {
      console.log(`Shadow Link server listening on ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB', err);
    process.exit(1);
  });

module.exports = app;

