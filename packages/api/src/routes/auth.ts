import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { queryOne, execute } from '../lib/db.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../lib/jwt.js';
import { randomUUID, randomInt } from 'crypto';
import { REFERRAL_REWARDS } from '@eco-farm/game-engine';
import { notify, getUserNickname } from '../lib/notify.js';
import { trackEvent, startSession, enrichUserProfile, getIp } from '../lib/analytics.js';
import { attributePartnerOnSignup } from '../lib/partner-attribution.js';
import { verifyGoogleIdToken } from '../lib/google-auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
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

/**
 * Email normalizer — trims whitespace and lowercases. Mobile keyboards
 * autocapitalize the first character even with `type="email"` on some
 * Android skins (Samsung, MIUI), so the same human-typed address can
 * land in the DB on /send-code as "Adil@gmail.com" but be sent as
 * "adil@gmail.com" by the Resend recipient or the user's manual retype.
 * Postgres `=` is case-sensitive on `text`, so without normalisation the
 * lookup misses the verification_codes row and we return CODE_EXPIRED
 * even though the code is still valid. Apply this transform on every
 * auth path (send-code, verify-code, google, telegram).
 */
const emailField = z
  .string()
  .email()
  .max(254)
  .transform((e) => e.trim().toLowerCase());

const sendCodeSchema = z.object({
  email: emailField,
});

/**
 * Attribution bag captured from the Play Install Referrer on native
 * and from URL params on web. Mirrors InstallReferrerHelper.snapshot()
 * shape on Android — each key is optional. Persisted on the user row
 * so downstream admin reports can segment by Meta ad/adset/campaign.
 *
 * We accept it on /verify-code (and all other auth entry points) so
 * a fresh install is attributed BEFORE the first `auth.register`
 * event is emitted — giving the CAPI worker the campaign_ids to send
 * back to Meta.
 */
/**
 * Lossy string field helper for attribution data. Real Meta ad payloads
 * stuff fully-expanded creative names + click macros into utm_content /
 * utm_campaign / af_ad_name, and these can blow past 256 characters
 * (one prod sample we observed: ad name "Mommy Cooking | UGC #4 (EN-US,
 * 30s, vertical) | iOS 17 | Adset: Tier 1 | …" → 380+ chars).
 *
 * The previous `.max(N)` schema returned a 400 VALIDATION error on
 * /verify-code for any user whose Install Referrer carried such a
 * value — meaning the user got the email code, typed it in, and
 * silently failed to register. Attribution is best-effort metadata;
 * we *truncate* on the way in and continue rather than abort the user
 * flow. The truncation cap is much larger than any realistic field so
 * downstream reports still have full granularity.
 */
function attrStr(maxLen: number) {
  return z
    .string()
    .transform((s) => (s.length > maxLen ? s.slice(0, maxLen) : s))
    .optional()
    .nullable();
}

const acquisitionSourceSchema = z
  .object({
    utmSource: attrStr(256),
    utmMedium: attrStr(256),
    utmCampaign: attrStr(512),
    utmContent: attrStr(1024),
    fbAdId: attrStr(128),
    fbAdsetId: attrStr(128),
    fbCampaignId: attrStr(128),
    // Meta Install Referrer URL after macro expansion routinely runs
    // past 2KB; 8KB matches Play Store's practical ceiling.
    raw: attrStr(8192),
    clickTs: z.number().int().optional().nullable(),
    installTs: z.number().int().optional().nullable(),
    // ─────────────────────────────────────────────────────────
    // AppsFlyer attribution. Mirrors the keys exposed by the
    // native bridge `getAfAttribution()` after the SDK's
    // onConversionDataSuccess callback fires.
    //
    // These fields populate the canonical creative/campaign
    // breakdown in admin reports — preferred over the legacy
    // fb* columns whenever both are present (AF carries a
    // de-duped, fraud-filtered view of the same data + works
    // for non-Meta networks too).
    // ─────────────────────────────────────────────────────────
    afStatus: attrStr(64),
    afMediaSource: attrStr(256),
    afCampaign: attrStr(512),
    afCampaignId: attrStr(128),
    afAdsetName: attrStr(512),
    afAdsetId: attrStr(128),
    afAdName: attrStr(1024),
    afAdId: attrStr(128),
    afAttributionId: attrStr(256),
    afAppsflyerId: attrStr(128),
  })
  .partial()
  .optional();

const verifyCodeSchema = z.object({
  email: emailField,
  code: z.string().trim().min(6).max(6),
  refCode: z.string().trim().optional().nullable(),
  acquisition: acquisitionSourceSchema,
});

const googleAuthSchema = z.object({
  idToken: z.string(),
});

const telegramInitSchema = z.object({
  initData: z.string().min(1),
});

function makeDemoUser(email: string) {
  const user = {
    id: randomUUID(),
    email,
    nickname: email.split('@')[0],
    avatar_id: randomAvatar(),
    locale: 'en',
    created_at: new Date().toISOString(),
    __demo: true as const,
  };
  demoUserIds.add(user.id);
  return user;
}

// Track demo ids so we don't pollute `users` with acquisition data
// keyed to a UUID that doesn't exist in Postgres. Demo users only
// appear when the DB is briefly unavailable during boot.
const demoUserIds = new Set<string>();
function isDemoUser(userId: string): boolean {
  return demoUserIds.has(userId);
}

/**
 * Writes campaign attribution to `users.acquisition_source`.
 *
 * Semantics: we only populate the column when it's currently NULL.
 * The `COALESCE(acquisition_source, $2)` guard preserves the first
 * referrer we ever saw — important because some devices re-open the
 * auth flow on day 2+ (e.g. re-link email) and at that point we've
 * lost the original Play install referrer. Campaign reports must
 * reflect the acquisition moment, not the latest session.
 */
async function saveAcquisitionSource(
  userId: string,
  acquisition: {
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
    fbAdId?: string | null;
    fbAdsetId?: string | null;
    fbCampaignId?: string | null;
    raw?: string | null;
    clickTs?: number | null;
    installTs?: number | null;
    afStatus?: string | null;
    afMediaSource?: string | null;
    afCampaign?: string | null;
    afCampaignId?: string | null;
    afAdsetName?: string | null;
    afAdsetId?: string | null;
    afAdName?: string | null;
    afAdId?: string | null;
    afAttributionId?: string | null;
    afAppsflyerId?: string | null;
  },
): Promise<void> {
  // Strip null/undefined/empty strings so the JSONB stays compact.
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(acquisition)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    cleaned[k] = v;
  }
  if (Object.keys(cleaned).length === 0) return;

  await execute(
    `UPDATE users
        SET acquisition_source = COALESCE(acquisition_source, $2::jsonb)
      WHERE id = $1`,
    [userId, JSON.stringify(cleaned)],
  );
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

// Reviewer account bypass: Play Store / App review teams need a stable way to
// log into the app without waiting for a real email. We accept one (or more)
// pre-declared review emails paired with a fixed code — no Resend call, no DB
// row, nothing observable from the outside.
//
// Defaults to `test@boostfarm.io` + `000000` so the current publisher can ship
// the listing. Override via env vars `REVIEWER_EMAILS` (comma-separated) and
// `REVIEWER_CODE` to rotate later without a redeploy.
const REVIEWER_EMAILS = (
  process.env.REVIEWER_EMAILS ?? 'test@boostfarm.io,test@manyboost.io'
)
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const REVIEWER_CODE = process.env.REVIEWER_CODE ?? '000000';

function isReviewerAccount(email: string): boolean {
  return REVIEWER_EMAILS.includes(email.trim().toLowerCase());
}

/**
 * Privacy-preserving email mask for logs: "adil@gmail.com" → "ad***@gmail.com".
 * Just enough to match an inbox the user is asking about, not enough to leak
 * the address into logfiles wholesale.
 */
function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(1, local.length - visible.length))}${domain}`;
}

authRouter.post('/send-code', rateLimit(10, 60_000), async (req: Request, res: Response) => {
  const ip = getIp(req) || 'unknown';
  try {
    const { email } = sendCodeSchema.parse(req.body);

    if (isReviewerAccount(email)) {
      console.log(`[auth] send-code reviewer email=${maskEmail(email)} ip=${ip}`);
      res.json({ success: true, data: { message: 'Code sent' } });
      return;
    }

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

    console.log(`[auth] send-code ok email=${maskEmail(email)} ip=${ip}`);
    res.json({ success: true, data: { message: 'Code sent' } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.warn(`[auth] send-code VALIDATION ip=${ip} issues=${JSON.stringify(err.issues)}`);
      res.status(400).json({ success: false, error: { code: 'VALIDATION', message: err.message } });
      return;
    }
    console.error(`[auth] send-code SEND_ERROR ip=${ip}`, err);
    res.status(500).json({ success: false, error: { code: 'SEND_ERROR', message: 'Failed to send code' } });
  }
});

authRouter.post('/verify-code', rateLimit(10, 60_000), async (req: Request, res: Response) => {
  const ip = getIp(req) || 'unknown';
  try {
    const { email, code, refCode, acquisition } = verifyCodeSchema.parse(req.body);

    const reviewer = isReviewerAccount(email);

    if (reviewer) {
      if (code !== REVIEWER_CODE) {
        console.warn(`[auth] verify-code reviewer INVALID_CODE email=${maskEmail(email)}`);
        res.status(400).json({ success: false, error: { code: 'INVALID_CODE', message: 'Invalid code' } });
        return;
      }
    } else {
      const row = await queryOne(
        `SELECT id, code, attempts FROM verification_codes
         WHERE email = $1 AND used = false
           AND created_at > NOW() - INTERVAL '${CODE_TTL_MIN} minutes'
         ORDER BY created_at DESC LIMIT 1`,
        [email],
      );

      if (!row) {
        // Most common real-user failure mode: the code email arrived later
        // than CODE_TTL_MIN, the user hit "Resend" once and the previous
        // row got marked used, or they typed a different email casing on
        // verify than on send. Counting unused codes for this email tells
        // us which one — log it so support can debug live without
        // hand-rolling a SQL query each time.
        const stats = await queryOne<{ total: number; recent: number }>(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '${CODE_TTL_MIN} minutes')::int AS recent
           FROM verification_codes WHERE email = $1`,
          [email],
        );
        console.warn(
          `[auth] verify-code CODE_EXPIRED email=${maskEmail(email)} ip=${ip} ` +
          `total_codes=${stats?.total ?? 0} recent_codes=${stats?.recent ?? 0}`,
        );
        res.status(400).json({ success: false, error: { code: 'CODE_EXPIRED', message: 'Code expired or not found. Please request a new one.' } });
        return;
      }

      if (row.attempts >= MAX_ATTEMPTS) {
        await execute(`UPDATE verification_codes SET used = true WHERE id = $1`, [row.id]);
        console.warn(`[auth] verify-code TOO_MANY_ATTEMPTS email=${maskEmail(email)} ip=${ip}`);
        res.status(400).json({ success: false, error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts. Please request a new code.' } });
        return;
      }

      if (row.code !== code) {
        await execute(
          `UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1`,
          [row.id],
        );
        console.warn(`[auth] verify-code INVALID_CODE email=${maskEmail(email)} ip=${ip} attempt=${row.attempts + 1}`);
        res.status(400).json({ success: false, error: { code: 'INVALID_CODE', message: 'Invalid code' } });
        return;
      }

      await execute(`UPDATE verification_codes SET used = true WHERE id = $1`, [row.id]);
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

    // Persist campaign attribution BEFORE auth.register so the CAPI
    // worker sees fb_ad_id / fb_adset_id / fb_campaign_id on the very
    // first registration event. Only writes when the JSONB is empty —
    // we never overwrite an existing acquisition_source because the
    // original install referrer is the true source of truth.
    if (acquisition && user?.id && !isDemoUser(user.id)) {
      await saveAcquisitionSource(user.id, acquisition).catch((err) => {
        console.warn('[auth] saveAcquisitionSource failed:', (err as Error).message);
      });
    }

    // Partner attribution: resolve utm_source → partners.slug, persist
    // partner_id + partner_click_id on the user row, and fire the
    // `install` conversion. No-op for organic users or when the
    // referrer is past the attribution window.
    if (user?.id && !isDemoUser(user.id)) {
      attributePartnerOnSignup({
        userId: user.id,
        isNewUser,
        acquisition: acquisition ?? null,
        req,
      }).catch(() => {});
    }

    // createSession used to be the silent-killer of /verify-code: if the
    // production DB ever lost migration 015 (users.session_id) the UPDATE
    // throws and the whole route returns 500 AUTH_ERROR — the user has
    // already been INSERT'd into `users`, so they appear in admin counts
    // but have no token and bounce back to the auth screen forever.
    // We isolate the failure now: log it loudly, fall back to a fresh
    // sessionId without persisting (single-device login still works,
    // multi-device kick-out is degraded but the user can play).
    let sessionId: string;
    try {
      sessionId = await createSession(user.id);
    } catch (sessErr) {
      console.error(
        `[auth] verify-code createSession FAILED user=${user.id} email=${maskEmail(email)} ip=${ip}:`,
        (sessErr as Error).message,
      );
      sessionId = randomUUID();
    }
    const tokens = makeTokens(user.id, email, sessionId);
    startSession(user.id, sessionId, req).catch(() => {});
    enrichUserProfile(user.id, req).catch(() => {});
    trackEvent(
      user.id,
      isNewUser ? 'auth.register' : 'auth.login',
      {
        method: 'email',
        ...(acquisition?.fbAdId ? { fb_ad_id: acquisition.fbAdId } : {}),
        ...(acquisition?.fbAdsetId ? { fb_adset_id: acquisition.fbAdsetId } : {}),
        ...(acquisition?.fbCampaignId ? { fb_campaign_id: acquisition.fbCampaignId } : {}),
      },
      req,
      sessionId,
    ).catch(() => {});
    console.log(
      `[auth] verify-code OK user=${user.id} email=${maskEmail(email)} ip=${ip} ` +
      `isNewUser=${isNewUser} hasAcquisition=${Boolean(acquisition)}`,
    );
    res.json({ success: true, data: { ...tokens, user, isNewUser } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.warn(`[auth] verify-code VALIDATION ip=${ip} issues=${JSON.stringify(err.issues)}`);
      res.status(400).json({ success: false, error: { code: 'VALIDATION', message: err.message } });
      return;
    }
    console.error(`[auth] verify-code AUTH_ERROR ip=${ip}`, err);
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
