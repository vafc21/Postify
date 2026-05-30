const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY environment variable is not set');
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 * Returns base64-encoded: iv(16) + tag(16) + ciphertext
 */
function encrypt(plaintext) {
  if (!plaintext) return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  const result = Buffer.concat([
    iv,
    tag,
    Buffer.from(encrypted, 'hex'),
  ]).toString('base64');

  return result;
}

/**
 * Decrypt a base64-encoded AES-256-GCM ciphertext
 */
function decrypt(encryptedBase64) {
  if (!encryptedBase64) return null;
  try {
    const key = getEncryptionKey();
    const buffer = Buffer.from(encryptedBase64, 'base64');

    const iv = buffer.subarray(0, IV_LENGTH);
    const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = buffer.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    console.error('Decryption failed:', err.message);
    return null;
  }
}

/**
 * Mask an API key for safe display — shows prefix + last 4 chars
 * e.g. "sk-ant-api03-verylongkey" → "sk-ant-a••••••••long"
 */
function maskKey(key) {
  if (!key || key.length < 8) return '••••••••';
  const prefix = key.substring(0, Math.min(8, key.length - 4));
  const suffix = key.slice(-4);
  return `${prefix}••••••••${suffix}`;
}

/**
 * Read a stored token, falling back to the raw string if it's a legacy
 * plaintext value from before we encrypted access tokens. Lets us migrate
 * without breaking existing connections.
 */
function readToken(stored) {
  if (!stored) return null;
  // Encrypted tokens are base64 of iv(16) + tag(16) + ciphertext — min 32 bytes
  // before encoding, so the b64 string is > 43 chars and matches base64 alphabet.
  const looksEncrypted = /^[A-Za-z0-9+/=]+$/.test(stored) && stored.length >= 44;
  if (!looksEncrypted) return stored;
  const decrypted = decrypt(stored);
  return decrypted || stored;
}

module.exports = { encrypt, decrypt, readToken, maskKey };
