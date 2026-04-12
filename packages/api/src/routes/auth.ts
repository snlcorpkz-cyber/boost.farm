import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { queryOne, execute } from '../lib/db.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../lib/jwt.js';
import { randomUUID } from 'crypto';
import { REFERRAL_REWARDS } from '@eco-farm/game-engine';
import { notify, getUserNickname } from '../lib/notify.js';
import {
  verifyTelegramInitData,
  parseTelegramUser,
  syntheticTelegramEmail,
} from '../lib/telegram-auth.js';

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

const telegramInitSchema = z.object({
  initData: z.string().min(1),
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

function localeFromTelegram(code: string | undefined): string {
  if (!code) return 'en';
  const c = code.toLowerCase();
  if (c.startsWith('ru')) return 'ru';
  if (c.startsWith('es')) return 'es';
  return 'en';
}

function nicknameFromTelegram(tg: { id: number; first_name?: string; last_name?: string; username?: string }): string {
  if (tg.username) return tg.username.slice(0, 20);
  const name = [tg.first_name, tg.last_name].filter(Boolean).join(' ').trim();
  if (name) return name.slice(0, 20);
  return `Farmer${tg.id}`.slice(0, 20);
}

async function processReferral(newUserId: string, refCode: string) {
  const referral = await queryOne(
    `SELECT inviter_id FROM referrals WHERE UPPER(invite_code) = UPPER($1)`,
    [refCode]
  );
  if (!referral || referral.inviter_id === newUserId) return;

  const existing = await queryOne(
    `SELECT id FROM friends WHERE user_id = $1 AND friend_id = $2`,
    [newUserId, referral.inviter_id]
  );
  if (existing) return;

  await execute(
    `INSERT INTO friends (user_id, friend_id) VALUES ($1, $2), ($3, $4)`,
    [newUserId, referral.inviter_id, referral.inviter_id, newUserId]
  );

  const fertReward = REFERRAL_REWARDS.NUTRITION;
  await execute(
    `UPDATE farms SET nutrition = nutrition + $1 WHERE user_id = $2 AND harvested = false`,
    [fertReward, newUserId]
  );
  await execute(
    `UPDATE farms SET nutrition = nutrition + $1 WHERE user_id = $2 AND harvested = false`,
    [fertReward, referral.inviter_id]
  );

  const joinerName = await getUserNickname(newUserId);
  const inviterName = await getUserNickname(referral.inviter_id);
  await notify(referral.inviter_id, 'invite', 'notif.friend_joined', { name: joinerName, fert: fertReward });
  await notify(newUserId, 'invite', 'notif.friend_joined', { name: inviterName, fert: fertReward });
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
    const { email, refCode } = verifyCodeSchema.parse(req.body);

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

    if (refCode && user?.id) {
      try {
        await processReferral(user.id, refCode);
      } catch (refErr) {
        console.warn('[auth] Referral processing failed:', (refErr as Error).message);
      }
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

authRouter.post('/telegram', async (req: Request, res: Response) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    res.status(503).json({
      success: false,
      error: { code: 'TELEGRAM_DISABLED', message: 'Telegram auth is not configured' },
    });
    return;
  }

  try {
    const { initData } = telegramInitSchema.parse(req.body);

    if (!verifyTelegramInitData(initData, botToken)) {
      res.status(401).json({ success: false, error: { code: 'INVALID_INIT_DATA', message: 'Bad Telegram signature' } });
      return;
    }

    const tgUser = parseTelegramUser(initData);
    if (!tgUser?.id) {
      res.status(400).json({ success: false, error: { code: 'NO_USER', message: 'No user in init data' } });
      return;
    }

    const email = syntheticTelegramEmail(tgUser.id);
    const nickname = nicknameFromTelegram(tgUser);
    const locale = localeFromTelegram(tgUser.language_code);

    let user: any = await queryOne(`SELECT * FROM users WHERE telegram_id = $1`, [tgUser.id]);
    let isNewUser = false;

    if (!user) {
      user = await queryOne(`SELECT * FROM users WHERE email = $1`, [email]);
      if (user) {
        await execute(`UPDATE users SET telegram_id = $1, last_login_at = NOW() WHERE id = $2`, [tgUser.id, user.id]);
        user = await queryOne(`SELECT * FROM users WHERE id = $1`, [user.id]);
      }
    }

    if (!user) {
      try {
        user = await queryOne(
          `INSERT INTO users (email, nickname, avatar_id, locale, telegram_id)
           VALUES ($1, $2, 'bear', $3, $4) RETURNING *`,
          [email, nickname, locale, tgUser.id]
        );
        isNewUser = true;
      } catch (e: any) {
        if (e.code === '23505') {
          user = await queryOne(
            `SELECT * FROM users WHERE telegram_id = $1 OR email = $2`,
            [tgUser.id, email]
          );
        }
        if (!user) throw e;
      }
    } else {
      await execute(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
    }

    const tokens = makeTokens(user.id, user.email);
    res.json({ success: true, data: { ...tokens, user, isNewUser } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION', message: err.message } });
      return;
    }
    console.error('[auth/telegram]', err);
    res.status(500).json({ success: false, error: { code: 'AUTH_ERROR', message: 'Telegram auth failed' } });
  }
});

authRouter.post('/refresh', async (req: Request, res: Response) => {
  let refreshToken: string;
  try {
    ({ refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body));
  } catch {
    res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Missing refresh token' } });
    return;
  }

  try {
    const payload = verifyToken(refreshToken);
    const newAccess = signAccessToken({ userId: payload.userId, email: payload.email });
    const newRefresh = signRefreshToken({ userId: payload.userId, email: payload.email });
    res.json({ success: true, data: { accessToken: newAccess, refreshToken: newRefresh } });
  } catch {
    res.status(401).json({ success: false, error: { code: 'REFRESH_EXPIRED', message: 'Refresh token expired' } });
  }
});
