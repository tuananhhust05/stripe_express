const crypto = require('crypto');

// Get encryption key from environment or use a default (should be set in production)
// AES-256 requires 32 bytes (64 hex characters)
let ENCRYPTION_KEY = process.env.ACTIVATION_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
} else {
  // Ensure key is exactly 64 hex characters (32 bytes)
  if (ENCRYPTION_KEY.length !== 64) {
    // If key is shorter, pad it; if longer, truncate it
    ENCRYPTION_KEY = ENCRYPTION_KEY.padEnd(64, '0').slice(0, 64);
  }
}
const ALGORITHM = 'aes-256-gcm';

/**
 * Hash activation code using SHA-256
 * This is used for storing in database
 */
const hashActivationCode = (code) => {
  return crypto.createHash('sha256').update(code.toUpperCase().trim()).digest('hex');
};

/**
 * Encrypt activation code for transmission
 * Returns encrypted code + IV + auth tag
 * NOTE: This function is deprecated - we now send hash directly
 */
const encryptActivationCode = (code) => {
  const iv = crypto.randomBytes(16);
  // ENCRYPTION_KEY is already 64 hex chars = 32 bytes
  const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex');
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
  
  let encrypted = cipher.update(code.toUpperCase().trim(), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Return: encrypted:iv:authTag (all hex encoded)
  return `${encrypted}:${iv.toString('hex')}:${authTag.toString('hex')}`;
};

/**
 * Decrypt activation code
 */
const decryptActivationCode = (encryptedData) => {
  try {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted format');
    }
    
    const [encrypted, ivHex, authTagHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    // ENCRYPTION_KEY is already 64 hex chars = 32 bytes
    const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (err) {
    throw new Error('Failed to decrypt activation code');
  }
};

/**
 * Verify if plain code matches hashed code
 */
const verifyActivationCode = (plainCode, hashedCode) => {
  const hash = hashActivationCode(plainCode);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hashedCode));
};

module.exports = {
  hashActivationCode,
  encryptActivationCode,
  decryptActivationCode,
  verifyActivationCode
};

