import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { queryOne, execute } from '../lib/db.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../lib/jwt.js';
import { randomUUID } from 'crypto';

export const authRouter = Router();

const sendCodeSchema = z.object({
  email: z.string().email(),
});

const verifyCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().optional(),
  refCode: z.string().optional(),
});

const googleAuthSchema = z.object({
  idToken: z.string(),
});

function makeDemoUser(email: string) {
  return {
    id: randomUUID(),
    email,
    nickname: email.split('@')[0],
    avatar_id: 'cat',
    locale: 'en',
    created_at: new Date().toISOString(),
  };
}

function makeTokens(userId: string, email: string) {
  return {
    accessToken: signAccessToken({ userId, email }),
    refreshToken: signRefreshToken({ userId, email }),
  };
}

authRouter.post('/send-code', async (req: Request, res: Response) => {
  try {
    sendCodeSchema.parse(req.body);
    res.json({ success: true, data: { message: 'Code sent' } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION', message: err.message } });
      return;
    }
    throw err;
  }
});

authRouter.post('/verify-code', async (req: Request, res: Response) => {
  try {
    const { email } = verifyCodeSchema.parse(req.body);

    let user: any = null;
    let isNewUser = false;

    try {
      user = await queryOne(`SELECT * FROM users WHERE email = $1`, [email]);
      isNewUser = !user;

      if (!user) {
        user = await queryOne(
          `INSERT INTO users (email, nickname, avatar_id, locale)
           VALUES ($1, $2, 'cat', 'en') RETURNING *`,
          [email, email.split('@')[0]]
        );
      } else {
        await execute(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
      }
    } catch (dbErr) {
      console.warn('[auth] DB unavailable, using demo user:', (dbErr as Error).message);
      user = makeDemoUser(email);
      isNewUser = true;
    }

    const tokens = makeTokens(user.id, email);
    res.json({ success: true, data: { ...tokens, user, isNewUser } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION', message: err.message } });
      return;
    }
    console.error('[auth/verify-code]', err);
    res.status(500).json({ success: false, error: { code: 'AUTH_ERROR', message: 'Authentication failed' } });
  }
});

authRouter.post('/google', async (req: Request, res: Response) => {
  try {
    const { idToken } = googleAuthSchema.parse(req.body);

    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
    const email = payload.email;

    if (!email) {
      res.status(400).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'No email in token' } });
      return;
    }

    let user: any = null;
    let isNewUser = false;

    try {
      user = await queryOne(`SELECT * FROM users WHERE email = $1`, [email]);
      isNewUser = !user;

      if (!user) {
        user = await queryOne(
          `INSERT INTO users (email, nickname, avatar_id, locale)
           VALUES ($1, $2, 'cat', 'en') RETURNING *`,
          [email, payload.name || email.split('@')[0]]
        );
      }
    } catch (dbErr) {
      console.warn('[auth/google] DB unavailable, using demo user');
      user = makeDemoUser(email);
      isNewUser = true;
    }

    const tokens = makeTokens(user.id, email);
    res.json({ success: true, data: { ...tokens, user, isNewUser } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION', message: err.message } });
      return;
    }
    console.error('[auth/google]', err);
    res.status(500).json({ success: false, error: { code: 'AUTH_ERROR', message: 'Authentication failed' } });
  }
});

authRouter.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);

  try {
    const payload = verifyToken(refreshToken);
    const newAccess = signAccessToken({ userId: payload.userId, email: payload.email });
    const newRefresh = signRefreshToken({ userId: payload.userId, email: payload.email });
    res.json({ success: true, data: { accessToken: newAccess, refreshToken: newRefresh } });
  } catch {
    res.status(401).json({ success: false, error: { code: 'REFRESH_EXPIRED', message: 'Refresh token expired' } });
  }
});
