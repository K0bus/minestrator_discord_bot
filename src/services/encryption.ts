import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Recommended IV length for GCM

/**
 * Retrieves the encryption key from environment variables.
 * Ensures the key is exactly 32 bytes.
 */
function getEncryptionKey(): Buffer {
  const keyStr = process.env.DATABASE_ENCRYPTION_KEY;
  if (!keyStr) {
    throw new Error('DATABASE_ENCRYPTION_KEY environment variable is missing.');
  }

  // Support hex-encoded 32-byte key OR 32-character plaintext key
  let key = Buffer.from(keyStr, 'utf8');
  if (key.length !== 32) {
    // If it's 64 hex characters, try parsing as hex
    if (keyStr.length === 64 && /^[0-9a-fA-F]+$/.test(keyStr)) {
      key = Buffer.from(keyStr, 'hex');
    }
  }

  if (key.length !== 32) {
    throw new Error(`DATABASE_ENCRYPTION_KEY must be exactly 32 bytes (currently got ${key.length} bytes).`);
  }

  return key;
}

/**
 * Encrypts cleartext using AES-256-GCM.
 * Output is formatted as iv_hex:auth_tag_hex:ciphertext_hex.
 */
export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * Decrypts ciphertext formatted as iv_hex:auth_tag_hex:ciphertext_hex using AES-256-GCM.
 */
export function decrypt(encryptedText: string): string {
  const key = getEncryptionKey();
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format (expected iv:authTag:ciphertext).');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const ciphertext = Buffer.from(parts[2], 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}
