import { createPublicKey, verify as cryptoVerify } from 'crypto';

// Minimal Google ID token verifier.
// We fetch Google's OIDC signing keys (JWKS), cache them, and validate the
// JWT signature + the essentials: iss, aud, exp. No external deps needed.

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ALLOWED_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

interface JWK {
  kid: string;
  n: string;
  e: string;
  alg: string;
  kty: string;
}

interface JWKSCache {
  keys: JWK[];
  fetchedAt: number;
}

let cache: JWKSCache | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function loadKeys(): Promise<JWK[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('Failed to fetch Google JWKS');
  const data = (await res.json()) as { keys: JWK[] };
  cache = { keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

function b64urlDecode(str: string): Buffer {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export interface GoogleIdTokenPayload {
  iss: string;
  aud: string;
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  exp: number;
  iat: number;
}

export async function verifyGoogleIdToken(
  idToken: string,
  expectedAudience?: string | string[],
): Promise<GoogleIdTokenPayload> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed ID token');

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(b64urlDecode(headerB64).toString()) as { alg: string; kid: string };
  if (header.alg !== 'RS256') throw new Error(`Unsupported alg: ${header.alg}`);

  const payload = JSON.parse(b64urlDecode(payloadB64).toString()) as GoogleIdTokenPayload;

  if (!ALLOWED_ISSUERS.includes(payload.iss)) throw new Error('Bad issuer');
  if (payload.exp * 1000 < Date.now()) throw new Error('Token expired');

  const audiences = expectedAudience
    ? Array.isArray(expectedAudience) ? expectedAudience : [expectedAudience]
    : null;
  if (audiences && !audiences.includes(payload.aud)) {
    throw new Error(`Bad audience: ${payload.aud}`);
  }

  const keys = await loadKeys();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown signing key');

  const publicKey = createPublicKey({ key: jwk as any, format: 'jwk' });
  const data = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = b64urlDecode(signatureB64);

  const ok = cryptoVerify('RSA-SHA256', data, publicKey, signature);
  if (!ok) throw new Error('Invalid signature');

  return payload;
}
