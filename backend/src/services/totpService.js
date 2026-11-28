const crypto = require('crypto');
const QRCode = require('qrcode');
const { JWT_SECRET } = require('../config');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_PERIOD_SEC = 30;
const TOTP_DIGITS = 6;
const ISSUER_NAME = 'Credo Core OS';

// Derive dedicated 32-byte AES-256-GCM key for encrypting TOTP secrets at rest
const TOTP_VAULT_KEY = crypto
  .createHash('sha256')
  .update(`credo-totp-aes256gcm-v1:${JWT_SECRET}`)
  .digest();

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i += 1) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(str) {
  const clean = String(str || '')
    .toUpperCase()
    .replace(/=+$/, '')
    .replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (let i = 0; i < clean.length; i += 1) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateTotpSecretBase32() {
  // 20 bytes = 160-bit RFC 6238 secret -> 32 Base32 chars
  return base32Encode(crypto.randomBytes(20));
}

function encryptTotpSecret(secretBase32) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', TOTP_VAULT_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(secretBase32), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decryptTotpSecret(encryptedPayload) {
  if (!encryptedPayload || typeof encryptedPayload !== 'string') return '';
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) return '';
  try {
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const data = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', TOTP_VAULT_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function computeTotpForStep(secretBase32, stepCounter) {
  const key = base32Decode(secretBase32);
  const counterBuf = Buffer.alloc(8);
  let counter = BigInt(stepCounter);
  for (let i = 7; i >= 0; i -= 1) {
    counterBuf[i] = Number(counter & 0xffn);
    counter >>= 8n;
  }
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = binary % 10 ** TOTP_DIGITS;
  return String(otp).padStart(TOTP_DIGITS, '0');
}

/**
 * Verifies a 6-digit RFC 6238 TOTP code with ±1 window (30s clock tolerance)
 * and strict anti-replay enforcement (`matchedStep > lastUsedStep`).
 */
function verifyTotpCode(secretBase32, rawCode, lastUsedStep = 0, { allowCurrentStepReuse = false } = {}) {
  const cleanCode = String(rawCode || '').replace(/\s+/g, '').trim();
  if (!/^\d{6}$/.test(cleanCode) || !secretBase32) {
    return { valid: false };
  }
  const currentStep = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SEC);
  const lastStepNum = Number(lastUsedStep || 0);

  for (const offset of [0, -1, 1]) {
    const candidateStep = currentStep + offset;
    if (!allowCurrentStepReuse && candidateStep <= lastStepNum) continue;
    const expected = computeTotpForStep(secretBase32, candidateStep);
    const a = Buffer.from(cleanCode, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { valid: true, matchedStep: candidateStep };
    }
  }
  return { valid: false };
}

function hashBackupCode(rawCode) {
  const normalized = String(rawCode || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return crypto.createHash('sha256').update(`credo-2fa-backup:${normalized}`).digest('hex');
}

function generateBackupCodes(count = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // unambiguous chars
  const plainCodes = [];
  const hashes = [];
  for (let i = 0; i < count; i += 1) {
    const bytes = crypto.randomBytes(8);
    let chars = '';
    for (let j = 0; j < 8; j += 1) {
      chars += alphabet[bytes[j] % alphabet.length];
    }
    const formatted = `${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
    plainCodes.push(formatted);
    hashes.push(hashBackupCode(formatted));
  }
  return { plainCodes, hashes };
}

async function buildEnrollmentQr({ accountLabel, secretBase32 }) {
  const label = encodeURIComponent(`${ISSUER_NAME}:${accountLabel}`);
  const issuer = encodeURIComponent(ISSUER_NAME);
  const otpauthUrl = `otpauth://totp/${label}?secret=${encodeURIComponent(secretBase32)}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  const qrSvg = await QRCode.toString(otpauthUrl, {
    type: 'svg',
    margin: 1,
    width: 196,
    color: {
      dark: '#09090B',
      light: '#FFFFFF',
    },
  });
  return { otpauthUrl, qrSvg };
}

module.exports = {
  generateTotpSecretBase32,
  encryptTotpSecret,
  decryptTotpSecret,
  computeTotpForStep,
  verifyTotpCode,
  hashBackupCode,
  generateBackupCodes,
  buildEnrollmentQr,
};
