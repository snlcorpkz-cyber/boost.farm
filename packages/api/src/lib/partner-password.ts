import crypto from 'crypto';

/**
 * Password hashing for partner-portal logins.
 *
 * We use Node's built-in `scrypt` instead of bcrypt/argon2 so the partner
 * portal has zero extra runtime dependencies — scrypt is memory-hard and
 * considered at least as strong as bcrypt for the threat model here
 * (one low-volume login endpoint behind rate limiting).
 *
 * Stored format: `scrypt$N$r$p$salt_b64$hash_b64`. The cost parameters
 * travel with the hash so we can raise them in the future without a
 * forced reset — old hashes keep verifying against their own cost.
 */

const SCRYPT_N = 1 << 15; // 32 768 — ~50ms on a modern CPU, painful for brute force
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN  = 32;
const SALT_LEN = 16;

// N=32768, r=8 needs exactly 128 * r * N = 32 MiB of memory, which is
// also Node's default `maxmem`. Depending on libssl build (Alpine/OpenSSL
// adds internal bookkeeping) scryptSync trips "memory limit exceeded".
// Raise the cap to 64 MiB so the allocation always fits.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export function hashPartnerPassword(plain: string): string {
  const salt = crypto.randomBytes(SALT_LEN);
  const hash = crypto.scryptSync(plain, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

export function verifyPartnerPassword(plain: string, stored: string): boolean {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = parseInt(parts[1], 10);
    const r = parseInt(parts[2], 10);
    const p = parseInt(parts[3], 10);
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    const actual = crypto.scryptSync(plain, salt, expected.length, {
      N, r, p,
      maxmem: SCRYPT_MAXMEM,
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Generate a human-typable random password for handing to a partner over
 * a secure channel. 16 chars, URL-safe alphabet, no ambiguous glyphs
 * (O/0/I/l) so Anthony can type it without squinting.
 */
export function generatePartnerPassword(len = 16): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}
