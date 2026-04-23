import { Router, type Request, type Response } from 'express';
import { queryOne, execute } from '../../lib/db.js';
import { hashPartnerPassword, verifyPartnerPassword } from '../../lib/partner-password.js';

export const partnerSettingsRouter = Router();

/**
 * GET /partner/settings
 *
 * Returns everything the partner can see/edit on their own row:
 * postback URL, contact email, approval mode, and payout defaults.
 * Readonly fields (status, slug, hold_hours) are returned for display
 * but cannot be changed from the partner portal — only from admin.
 */
partnerSettingsRouter.get('/', async (req: Request, res: Response) => {
  const partnerId = req.partner!.partnerId;

  const partner = await queryOne<{
    slug: string;
    name: string;
    status: string;
    default_payout_cents: number;
    postback_url_template: string | null;
    postback_method: string;
    approval_mode: string;
    hold_hours: number;
    contact_email: string | null;
  }>(
    `SELECT slug, name, status, default_payout_cents,
            postback_url_template, postback_method, approval_mode, hold_hours, contact_email
     FROM partners WHERE id = $1`,
    [partnerId],
  );

  if (!partner) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Partner not found' } });
    return;
  }

  res.json({
    success: true,
    data: {
      slug: partner.slug,
      name: partner.name,
      status: partner.status,
      defaultPayoutCents: partner.default_payout_cents,
      postbackUrlTemplate: partner.postback_url_template,
      postbackMethod: partner.postback_method,
      approvalMode: partner.approval_mode,
      holdHours: partner.hold_hours,
      contactEmail: partner.contact_email,
      macros: {
        clickId: '{CLICK_ID}',
        payoutUsd: '{PAYOUT_USD}',
        payoutCents: '{PAYOUT_CENTS}',
        event: '{EVENT}',
        conversionId: '{TXID}',
      },
    },
  });
});

/**
 * PATCH /partner/settings
 *
 * Partner may update their own postback URL and contact email.
 * Everything else (status, payout amounts, approval mode, slug) is
 * admin-only to prevent self-service abuse.
 */
partnerSettingsRouter.patch('/', async (req: Request, res: Response) => {
  const partnerId = req.partner!.partnerId;
  const body = req.body ?? {};

  const updates: string[] = [];
  const params: any[] = [];

  if (typeof body.postbackUrlTemplate === 'string') {
    const v = body.postbackUrlTemplate.trim();
    if (v.length > 0 && !/^https?:\/\//i.test(v)) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Postback URL must start with http:// or https://' } });
      return;
    }
    if (v.length > 2000) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Postback URL is too long' } });
      return;
    }
    params.push(v.length === 0 ? null : v);
    updates.push(`postback_url_template = $${params.length}`);
  }

  if (typeof body.postbackMethod === 'string' && (body.postbackMethod === 'GET' || body.postbackMethod === 'POST')) {
    params.push(body.postbackMethod);
    updates.push(`postback_method = $${params.length}`);
  }

  if (typeof body.contactEmail === 'string') {
    const v = body.contactEmail.trim();
    if (v.length > 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Invalid email' } });
      return;
    }
    params.push(v.length === 0 ? null : v);
    updates.push(`contact_email = $${params.length}`);
  }

  if (updates.length === 0) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Nothing to update' } });
    return;
  }

  updates.push(`updated_at = now()`);
  params.push(partnerId);

  await execute(
    `UPDATE partners SET ${updates.join(', ')} WHERE id = $${params.length}`,
    params,
  );

  res.json({ success: true });
});

/**
 * POST /partner/settings/password
 * Body: { current, next }
 *
 * Lets the partner rotate their own password. Verifies the current
 * password server-side before writing the new hash. Rate-limited by
 * the global partner-route limiter at the router level.
 */
partnerSettingsRouter.post('/password', async (req: Request, res: Response) => {
  const accountId = req.partner!.accountId;
  const current = typeof req.body?.current === 'string' ? req.body.current : '';
  const next = typeof req.body?.next === 'string' ? req.body.next : '';

  if (!current || !next) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'current and next required' } });
    return;
  }
  if (next.length < 10) {
    res.status(400).json({ success: false, error: { code: 'WEAK_PASSWORD', message: 'New password must be at least 10 characters' } });
    return;
  }

  const account = await queryOne<{ password_hash: string }>(
    `SELECT password_hash FROM partner_accounts WHERE id = $1`,
    [accountId],
  );

  if (!account || !verifyPartnerPassword(current, account.password_hash)) {
    res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect' } });
    return;
  }

  const newHash = hashPartnerPassword(next);
  await execute(`UPDATE partner_accounts SET password_hash = $1 WHERE id = $2`, [newHash, accountId]);

  res.json({ success: true });
});
