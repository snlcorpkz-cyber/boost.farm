import jwt from 'jsonwebtoken';

/**
 * JWTs for partner-portal logins.
 *
 * Uses the same HS256 secret as user tokens (we don't need a second
 * secret for this threat model — partner accounts live in their own
 * table and are matched by role), but carries a distinct payload shape
 * so a user token can never accidentally authenticate a partner route
 * (and vice versa). The `role` discriminator is checked in
 * `requirePartner`.
 */

const JWT_SECRET: string = (() => {
  const s = process.env.JWT_SECRET;
  if (!s) {
    console.error('[FATAL] JWT_SECRET is required for partner JWTs. Set it in .env');
    process.exit(1);
  }
  return s;
})();

const PARTNER_TOKEN_EXPIRY = '30d';

export interface PartnerTokenPayload {
  role: 'partner' | 'partner_admin';
  accountId: string;
  partnerId: string;
  partnerSlug: string;
  partnerName: string;
  email: string;
}

export function signPartnerToken(payload: PartnerTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: PARTNER_TOKEN_EXPIRY,
    algorithm: 'HS256',
  });
}

export function verifyPartnerToken(token: string): PartnerTokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as unknown as PartnerTokenPayload;
  if (decoded.role !== 'partner' && decoded.role !== 'partner_admin') {
    throw new Error('Not a partner token');
  }
  return decoded;
}
