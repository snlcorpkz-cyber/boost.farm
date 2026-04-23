#!/usr/bin/env node
/**
 * Create (or reset) a partner-portal login.
 *
 * Usage:
 *   node scripts/create-partner-account.mjs --slug timebucks --email anthony@timebucks.com
 *   node scripts/create-partner-account.mjs --slug timebucks --email anthony@timebucks.com --name "Anthony"
 *   node scripts/create-partner-account.mjs --slug timebucks --email anthony@timebucks.com --password "my-own-pwd"
 *
 * Looks up the partner by `slug` (must already exist in `partners` —
 * seed it via a migration first). Generates a random password if `--password`
 * isn't passed, and prints the credentials ONCE to stdout so the operator
 * can hand them over to the partner. The password itself is never stored
 * in plain text — we only keep the scrypt hash in the database.
 *
 * Pure Node/pg/crypto — no transpilation, no build step, safe to run in
 * CI or on the production box directly.
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import crypto from 'crypto';
import pg from 'pg';

// ── Load .env manually (we avoid adding dotenv as a dev dep here) ──
const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '..', '.env');
try {
  const raw = readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
} catch {
  // .env is optional when DATABASE_URL is exported in the shell
}

// ── CLI args ──
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, tok, i, arr) => {
    if (tok.startsWith('--')) acc.push([tok.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

const slug = args.slug;
const email = args.email?.toLowerCase().trim();
const displayName = args.name || null;
let password = args.password;

if (!slug || !email) {
  console.error('Usage: node scripts/create-partner-account.mjs --slug <slug> --email <email> [--name "Full Name"] [--password <pwd>]');
  process.exit(1);
}

// ── scrypt (must match packages/api/src/lib/partner-password.ts) ──
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;
// Must match packages/api/src/lib/partner-password.ts — 64 MiB covers
// OpenSSL's bookkeeping on top of the 32 MiB hash grid.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

function hashPassword(plain) {
  const salt = crypto.randomBytes(SALT_LEN);
  const hash = crypto.scryptSync(plain, salt, KEY_LEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM,
  });
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64'), hash.toString('base64')].join('$');
}

function generatePassword(len = 16) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// ── Main ──
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL is not set. Populate .env or export it.');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: dbUrl.includes('supabase.co') ? { rejectUnauthorized: false } : undefined,
});

try {
  const { rows: partners } = await pool.query('SELECT id, name FROM partners WHERE slug = $1', [slug]);
  if (partners.length === 0) {
    console.error(`Partner with slug="${slug}" not found. Seed it via a migration first.`);
    process.exit(2);
  }
  const partner = partners[0];

  if (!password) password = generatePassword();
  const hash = hashPassword(password);

  const { rows } = await pool.query(
    `INSERT INTO partner_accounts (partner_id, email, password_hash, display_name, role, status)
     VALUES ($1, $2, $3, $4, 'partner', 'active')
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       display_name  = COALESCE(partner_accounts.display_name, EXCLUDED.display_name),
       status        = 'active'
     RETURNING id, email, (xmax = 0) AS created`,
    [partner.id, email, hash, displayName],
  );

  const row = rows[0];
  const action = row.created ? 'CREATED' : 'UPDATED';

  console.log('');
  console.log(`  ✓ ${action} partner account for ${partner.name}`);
  console.log('  ──────────────────────────────────────────────');
  console.log(`  Portal URL : ${process.env.PARTNER_PORTAL_URL || 'https://<your-host>/partner/'}`);
  console.log(`  Email      : ${row.email}`);
  console.log(`  Password   : ${password}`);
  console.log('  ──────────────────────────────────────────────');
  console.log('  Hand these credentials to the partner over a SECURE channel.');
  console.log('  The password is not stored in plain text and cannot be recovered');
  console.log('  — re-run this script to reset it if lost.');
  console.log('');
} catch (err) {
  console.error('Failed:', err.message);
  process.exit(3);
} finally {
  await pool.end();
}
