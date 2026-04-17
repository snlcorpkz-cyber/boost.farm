import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { queryOne, execute } from '../lib/db.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../lib/jwt.js';
import { randomUUID, randomInt } from 'crypto';
import { REFERRAL_REWARDS } from '@eco-farm/game-engine';
import { notify, getUserNickname } from '../lib/notify.js';
import { trackEvent, startSession, enrichUserProfile } from '../lib/analytics.js';
import { verifyGoogleIdToken } from '../lib/google-auth.js';
import { Resend } from 'resend';

const MAX_NUTRITION = 10000;
const GOOGLE_AUDIENCE = (process.env.GOOGLE_CLIENT_ID || '').trim() || undefined;

const AVATARS = ['bear', 'penguin', 'ram', 'dog'] as const;
function randomAvatar(): string {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)];
}
import {
  verifyTelegramInitData,
  parseTelegramUser,
  syntheticTelegramEmail,
} from '../lib/telegram-auth.js';

const resend = new Resend(process.env.RESEND_API_KEY || '');
const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;

function generateCode(): string {
  return String(randomInt(100000, 999999));
}

export const authRouter = Router();

const sendCodeSchema = z.object({
  email: z.string().email(),
});

const verifyCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().min(6).max(6),
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
    avatar_id: randomAvatar(),
    locale: 'en',
    created_at: new Date().toISOString(),
  };
}

function makeTokens(userId: string, email: string, sessionId: string) {
  return {
    accessToken: signAccessToken({ userId, email, sessionId }),
    refreshToken: signRefreshToken({ userId, email, sessionId }),
  };
}

async function createSession(userId: string): Promise<string> {
  const sessionId = randomUUID();
  await execute(`UPDATE users SET session_id = $1 WHERE id = $2`, [sessionId, userId]);
  return sessionId;
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
    `SELECT id, inviter_id FROM referrals WHERE UPPER(invite_code) = UPPER($1)`,
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

  // C-4: mark referral as completed so pet unlock logic (referrals-based) works.
  await execute(
    `UPDATE referrals SET completed = true, completed_at = now() WHERE id = $1`,
    [referral.id]
  );

  const fertReward = REFERRAL_REWARDS.NUTRITION;

  // M-2: apply nutrition cap to inviter's farm.
  await execute(
    `UPDATE farms SET nutrition = LEAST($3, nutrition + $1)
     WHERE user_id = $2 AND harvested = false`,
    [fertReward, referral.inviter_id, MAX_NUTRITION]
  );

  // C-5: new user may not have a farm yet. Try to credit; if no rows updated,
  // stash the bonus on users.pending_nutrition_bonus so /farm/new-crop can apply it.
  const credited = await execute(
    `UPDATE farms SET nutrition = LEAST($3, nutrition + $1)
     WHERE user_id = $2 AND harvested = false`,
    [fertReward, newUserId, MAX_NUTRITION]
  );
  if (credited === 0) {
    await execute(
      `UPDATE users SET pending_nutrition_bonus = pending_nutrition_bonus + $1 WHERE id = $2`,
      [fertReward, newUserId]
    );
  }

  const joinerName = await getUserNickname(newUserId);
  const inviterName = await getUserNickname(referral.inviter_id);
  await notify(referral.inviter_id, 'invite', 'notif.friend_joined', { name: joinerName, fert: fertReward });
  await notify(newUserId, 'invite', 'notif.friend_joined', { name: inviterName, fert: fertReward });
}

authRouter.post('/send-code', async (req: Request, res: Response) => {
  try {
    const { email } = sendCodeSchema.parse(req.body);
    const code = generateCode();

    await execute(
      `UPDATE verification_codes SET used = true WHERE email = $1 AND used = false`,
      [email],
    );

    await execute(
      `INSERT INTO verification_codes (email, code) VALUES ($1, $2)`,
      [email, code],
    );

    const fromAddr = process.env.RESEND_FROM || 'Boost Farm <noreply@boostfarm.io>';

    await resend.emails.send({
      from: fromAddr,
      to: email,
      subject: 'Your Boost Farm verification code',
      html: `
        <div style="font-family:sans-serif;max-width:400px;margin:0 auto;text-align:center;padding:40px 20px">
          <h2 style="color:#2E7D32;margin-bottom:8px">Boost Farm</h2>
          <p style="color:#555;margin-bottom:24px">Your verification code:</p>
          <div style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#333;background:#f5f5f5;border-radius:12px;padding:16px;margin-bottom:24px">${code}</div>
          <p style="color:#999;font-size:12px">This code expires in ${CODE_TTL_MIN} minutes. If you didn't request this, please ignore.</p>
        </div>
      `,
    });

    console.log(`[auth] Code sent to ${email}`);
    res.json({ success: true, data: { message: 'Code sent' } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION', message: err.message } });
      return;
    }
    console.error('[auth/send-code]', err);
    res.status(500).json({ success: false, error: { code: 'SEND_ERROR', message: 'Failed to send code' } });
  }
});

authRouter.post('/verify-code', async (req: Request, res: Response) => {
  try {
    const { email, code, refCode } = verifyCodeSchema.parse(req.body);

    const row = await queryOne(
      `SELECT id, code, attempts FROM verification_codes
       WHERE email = $1 AND used = false
         AND created_at > NOW() - INTERVAL '${CODE_TTL_MIN} minutes'
       ORDER BY created_at DESC LIMIT 1`,
      [email],
    );

    if (!row) {
      res.status(400).json({ success: false, error: { code: 'CODE_EXPIRED', message: 'Code expired or not found. Please request a new one.' } });
      return;
    }

    if (row.attempts >= MAX_ATTEMPTS) {
      await execute(`UPDATE verification_codes SET used = true WHERE id = $1`, [row.id]);
      res.status(400).json({ success: false, error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts. Please request a new code.' } });
      return;
    }

    if (row.code !== code) {
      await execute(
        `UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1`,
        [row.id],
      );
      res.status(400).json({ success: false, error: { code: 'INVALID_CODE', message: 'Invalid code' } });
      return;
    }

    await execute(`UPDATE verification_codes SET used = true WHERE id = $1`, [row.id]);

    let user: any = null;
    let isNewUser = false;

    try {
      user = await queryOne(`SELECT * FROM users WHERE email = $1`, [email]);
      isNewUser = !user;

      if (!user) {
        user = await queryOne(
          `INSERT INTO users (email, nickname, avatar_id, locale)
           VALUES ($1, $2, $3, 'en') RETURNING *`,
          [email, email.split('@')[0], randomAvatar()]
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

    const sessionId = await createSession(user.id);
    const tokens = makeTokens(user.id, email, sessionId);
    // Analytics: record session row (geo/device/ip) and backfill user cohort fields.
    startSession(user.id, sessionId, req).catch(() => {});
    enrichUserProfile(user.id, req).catch(() => {});
    trackEvent(user.id, isNewUser ? 'auth.register' : 'auth.login', { method: 'email' }, req, sessionId).catch(() => {});
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

    // C-2: cryptographically verify Google's signature and claims.
    let payload;
    try {
      payload = await verifyGoogleIdToken(idToken, GOOGLE_AUDIENCE);
    } catch (verifyErr) {
      console.warn('[auth/google] Token verification failed:', (verifyErr as Error).message);
      res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid Google token' } });
      return;
    }

    const email = payload.email;
    if (!email || payload.email_verified === false) {
      res.status(400).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Email not verified' } });
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
           VALUES ($1, $2, $3, 'en') RETURNING *`,
          [email, payload.name || email.split('@')[0], randomAvatar()]
        );
      } else {
        await execute(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
      }
    } catch (dbErr) {
      console.warn('[auth/google] DB unavailable, using demo user');
      user = makeDemoUser(email);
      isNewUser = true;
    }

    const sessionId = await createSession(user.id);
    const tokens = makeTokens(user.id, email, sessionId);
    startSession(user.id, sessionId, req).catch(() => {});
    enrichUserProfile(user.id, req).catch(() => {});
    trackEvent(user.id, isNewUser ? 'auth.register' : 'auth.login', { method: 'google' }, req, sessionId).catch(() => {});
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
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [email, nickname, randomAvatar(), locale, tgUser.id]
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

    const sessionId = await createSession(user.id);
    const tokens = makeTokens(user.id, user.email, sessionId);
    startSession(user.id, sessionId, req).catch(() => {});
    enrichUserProfile(user.id, req).catch(() => {});
    trackEvent(user.id, isNewUser ? 'auth.register' : 'auth.login', { method: 'telegram' }, req, sessionId).catch(() => {});
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

    // M-3: Tokens must be tied to a session. If the user currently has a
    // session_id, any refresh token without one (legacy) or with a mismatching
    // one must be rejected.
    const user = await queryOne(`SELECT session_id FROM users WHERE id = $1`, [payload.userId]);
    if (user && user.session_id) {
      if (!payload.sessionId || payload.sessionId !== user.session_id) {
        res.status(401).json({ success: false, error: { code: 'SESSION_EXPIRED', message: 'Logged in on another device' } });
        return;
      }
    }

    const sid = payload.sessionId || '';
    const newAccess = signAccessToken({ userId: payload.userId, email: payload.email, sessionId: sid });
    const newRefresh = signRefreshToken({ userId: payload.userId, email: payload.email, sessionId: sid });
    res.json({ success: true, data: { accessToken: newAccess, refreshToken: newRefresh } });
  } catch {
    res.status(401).json({ success: false, error: { code: 'REFRESH_EXPIRED', message: 'Refresh token expired' } });
  }
});
