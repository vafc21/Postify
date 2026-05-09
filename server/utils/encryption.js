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

module.exports = { encrypt, decrypt, maskKey };
