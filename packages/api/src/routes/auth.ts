import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, queryOne, execute } from '../lib/db.js';
import { signAccessToken, signRefreshToken } from '../lib/jwt.js';

export const authRouter = Router();

const sendCodeSchema = z.object({
  email: z.string().email(),
});

const verifyCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});

const googleAuthSchema = z.object({
  idToken: z.string(),
});

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

authRouter.post('/send-code', async (req: Request, res: Response) => {
  try {
    const { email } = sendCodeSchema.parse(req.body);
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await execute(
      `INSERT INTO auth_codes (email, code, expires_at) VALUES ($1, $2, $3)`,
      [email, code, expiresAt.toISOString()]
    );

    console.log(`[Auth] Code for ${email}: ${code}`);

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
    const { email, code } = verifyCodeSchema.parse(req.body);

    const authCode = await queryOne(
      `SELECT * FROM auth_codes
       WHERE email = $1 AND code = $2 AND used = false AND expires_at >= $3
       ORDER BY created_at DESC LIMIT 1`,
      [email, code, new Date().toISOString()]
    );

    if (!authCode) {
      res.status(400).json({ success: false, error: { code: 'INVALID_CODE', message: 'Invalid or expired code' } });
      return;
    }

    await execute(`UPDATE auth_codes SET used = true WHERE id = $1`, [authCode.id]);

    let user = await queryOne(`SELECT * FROM users WHERE email = $1`, [email]);
    const isNewUser = !user;

    if (!user) {
      user = await queryOne(
        `INSERT INTO users (email, nickname, avatar_id, locale)
         VALUES ($1, $2, 'cat', 'en') RETURNING *`,
        [email, email.split('@')[0]]
      );
    } else {
      await execute(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
    }

    const tokens = {
      accessToken: signAccessToken({ userId: user!.id, email }),
      refreshToken: signRefreshToken({ userId: user!.id, email }),
    };

    res.json({ success: true, data: { ...tokens, user, isNewUser } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION', message: err.message } });
      return;
    }
    throw err;
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

    let user = await queryOne(`SELECT * FROM users WHERE email = $1`, [email]);
    const isNewUser = !user;

    if (!user) {
      user = await queryOne(
        `INSERT INTO users (email, nickname, avatar_id, locale)
         VALUES ($1, $2, 'cat', 'en') RETURNING *`,
        [email, payload.name || email.split('@')[0]]
      );
    }

    const tokens = {
      accessToken: signAccessToken({ userId: user!.id, email }),
      refreshToken: signRefreshToken({ userId: user!.id, email }),
    };

    res.json({ success: true, data: { ...tokens, user, isNewUser } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION', message: err.message } });
      return;
    }
    throw err;
  }
});
