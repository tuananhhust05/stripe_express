const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER
    ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    : undefined
});

const sendActivationEmail = async ({ to, activationCode, planLabel, expiresAt, deepLink }) => {
  // Log SMTP configuration (without password)
  console.log('📧 SMTP Configuration:');
  console.log('  Host:', process.env.SMTP_HOST || 'not set');
  console.log('  Port:', process.env.SMTP_PORT || '587');
  console.log('  Secure:', process.env.SMTP_SECURE === 'true');
  console.log('  User:', process.env.SMTP_USER || 'not set');
  console.log('  Password:', process.env.SMTP_PASS ? '***' + process.env.SMTP_PASS.slice(-3) : 'not set');
  console.log('  From:', process.env.MAIL_FROM || 'Shadow Link <no-reply@shadow.link>');
  console.log('  To:', to);
  
  const formattedExpiry = expiresAt ? new Date(expiresAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) : 'Never';
  
  // Default deep link if not provided
  const deepLinkUrl = deepLink || 'https://www.vtoobe.com/';
  
  // Load email template
  const templatePath = path.join(__dirname, '..', 'templates', 'activation-email.html');
  let html = fs.readFileSync(templatePath, 'utf8');
  
  // Replace placeholders
  html = html.replace(/\{\{ACTIVATION_CODE\}\}/g, activationCode);
  html = html.replace(/\{\{PLAN_LABEL\}\}/g, planLabel);
  html = html.replace(/\{\{EXPIRES_AT\}\}/g, formattedExpiry);
  html = html.replace(/\{\{EMAIL\}\}/g, to);
  html = html.replace(/\{\{DEEP_LINK\}\}/g, deepLinkUrl);

  try {
    await transporter.sendMail({
      to,
      from: process.env.MAIL_FROM || 'Shadow Link <no-reply@shadow.link>',
      subject: 'Your Shadow Link Activation Code',
      html
    });
    console.log('✅ Email sent successfully to:', to);
  } catch (error) {
    console.error('❌ Email sending failed:');
    console.error('  Error:', error.message);
    console.error('  Code:', error.code);
    throw error;
  }
};

module.exports = { sendActivationEmail };

