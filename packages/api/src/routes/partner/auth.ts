import { Router, type Request, type Response } from 'express';
import { queryOne, execute } from '../../lib/db.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { verifyPartnerPassword } from '../../lib/partner-password.js';
import { signPartnerToken } from '../../lib/partner-jwt.js';

export const partnerAuthRouter = Router();

/**
 * POST /partner/auth/login
 * Body: { email, password }
 *
 * Email+password login for partner-portal users. Returns a 30d JWT
 * carrying the partner context. Generic error messages by design so
 * attackers can't probe whether an email exists.
 */
partnerAuthRouter.post('/login', rateLimit(10, 60_000), async (req: Request, res: Response) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!email || !password) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Email and password required' } });
    return;
  }

  const account = await queryOne<{
    id: string;
    partner_id: string;
    password_hash: string;
    role: 'partner' | 'partner_admin';
    status: 'active' | 'disabled';
    partner_slug: string;
    partner_name: string;
    partner_status: string;
  }>(
    `SELECT pa.id, pa.partner_id, pa.password_hash, pa.role, pa.status,
            p.slug AS partner_slug, p.name AS partner_name, p.status AS partner_status
     FROM partner_accounts pa
     JOIN partners p ON p.id = pa.partner_id
     WHERE pa.email = $1`,
    [email],
  );

  if (!account || account.status !== 'active' || account.partner_status === 'archived') {
    res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
    return;
  }

  if (!verifyPartnerPassword(password, account.password_hash)) {
    res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
    return;
  }

  await execute(`UPDATE partner_accounts SET last_login_at = now() WHERE id = $1`, [account.id]).catch(() => {});

  const token = signPartnerToken({
    role: account.role,
    accountId: account.id,
    partnerId: account.partner_id,
    partnerSlug: account.partner_slug,
    partnerName: account.partner_name,
    email,
  });

  res.json({
    success: true,
    data: {
      accessToken: token,
      partner: {
        slug: account.partner_slug,
        name: account.partner_name,
      },
    },
  });
});
