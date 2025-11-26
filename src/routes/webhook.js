const express = require('express');
const bodyParser = require('body-parser');
const { handleStripeWebhook } = require('../controllers/paymentController');
const { stripe } = require('../services/stripeService');

const router = express.Router();

router.post(
  '/',
  bodyParser.raw({ type: 'application/json' }),
  async (req, res) => {
    if (!stripe) {
      console.error('❌ Stripe not configured, webhook ignored');
      return res.status(400).send('Stripe not configured');
    }

    const signature = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.warn('⚠️ STRIPE_WEBHOOK_SECRET not set, skipping signature verification');
      // In test mode, we can still process the webhook but log a warning
      try {
        const event = JSON.parse(req.body.toString());
        await handleStripeWebhook(event);
        return res.json({ received: true, warning: 'Webhook secret not configured' });
      } catch (err) {
        console.error('Failed processing webhook without verification:', err);
        return res.status(500).send('Webhook handler error');
      }
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch (err) {
      console.error('❌ Stripe webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      console.log('✅ Received Stripe webhook:', event.type);
      await handleStripeWebhook(event);
      return res.json({ received: true });
    } catch (err) {
      console.error('❌ Failed processing stripe webhook:', err);
      return res.status(500).send('Webhook handler error');
    }
  }
);

module.exports = router;

