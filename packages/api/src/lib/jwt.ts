import jwt from 'jsonwebtoken';

const JWT_SECRET: string = (() => {
  const s = process.env.JWT_SECRET;
  if (!s) {
    console.error('[FATAL] JWT_SECRET is required. Set it in .env');
    process.exit(1);
  }
  return s;
})();

const ACCESS_TOKEN_EXPIRY = '7d';
const REFRESH_TOKEN_EXPIRY = '90d';

export interface TokenPayload {
  userId: string;
  email: string;
  sessionId?: string;
}

export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY, algorithm: 'HS256' });
}

export function signRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY, algorithm: 'HS256' });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as unknown as TokenPayload;
}
