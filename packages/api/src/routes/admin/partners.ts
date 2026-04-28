/**
 * Admin partners panel.
 *
 * Endpoints under /admin/partners that the in-house team uses to:
 *   - flip a partner between draft → active → paused → archived
 *   - tune payout amounts, attribution window, allowed events, TZ
 *   - manage the country payout matrix (key for TimeBucks: only US pays)
 *   - inspect conversions and reverse fraudulent ones
 *
 * All routes assume the caller already passed `requireAdmin` middleware
 * at the parent /admin router. We never expose partner postback secrets
 * here (they don't exist yet, but reserved column is in the schema).
 */
import { Router, type Request, type Response } from 'express';
import { query, queryOne, execute } from '../../lib/db.js';
import { FRAUD_REASONS, reversePartnerConversion } from '../../lib/partner-conversions.js';
import type { FraudReason } from '../../lib/partner-conversions.js';

export const adminPartnersRouter = Router();

// ── Constants ───────────────────────────────────────────────────
const PARTNER_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
const PARTNER_TYPES = ['offerwall', 'affiliate', 'network', 'influencer', 'other'] as const;
const PARTNER_APPROVAL_MODES = ['auto', 'manual'] as const;
const POSTBACK_METHODS = ['GET', 'POST'] as const;

type PartnerStatus = typeof PARTNER_STATUSES[number];
type PartnerType = typeof PARTNER_TYPES[number];
type PartnerApprovalMode = typeof PARTNER_APPROVAL_MODES[number];
type PostbackMethod = typeof POSTBACK_METHODS[number];

const ALLOWED_EVENT_TYPES = new Set([
  'install',
  'register',
  'tutorial',
  'first_play',
  'engaged_d0',
  'd1_return',
  'stage_2',
  'stage_3',
  'stage_4',
  'stage_5',
  'stage_6',
  'harvest',
  'harvest_x3',
]);

interface PartnerRow {
  id: string;
  slug: string;
  name: string;
  type: PartnerType;
  status: PartnerStatus;
  default_payout_cents: number;
  postback_url_template: string | null;
  postback_method: PostbackMethod;
  approval_mode: PartnerApprovalMode;
  hold_hours: number;
  attribution_window_hours: number;
  report_tz: string;
  allowed_events: string[] | null;
  contact_email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function toJsonPartner(row: PartnerRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    type: row.type,
    status: row.status,
    defaultPayoutCents: row.default_payout_cents,
    postbackUrlTemplate: row.postback_url_template,
    postbackMethod: row.postback_method,
    approvalMode: row.approval_mode,
    holdHours: row.hold_hours,
    attributionWindowHours: row.attribution_window_hours,
    reportTz: row.report_tz,
    allowedEvents: row.allowed_events ?? [],
    contactEmail: row.contact_email,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── List partners ───────────────────────────────────────────────
adminPartnersRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await query<PartnerRow & { conversion_count: number; pending_postbacks: number }>(
      `SELECT p.*,
              (SELECT count(*)::int FROM partner_conversions c WHERE c.partner_id = p.id)
                AS conversion_count,
              (SELECT count(*)::int FROM partner_postbacks_out pb
                 WHERE pb.partner_id = p.id AND pb.status = 'queued')
                AS pending_postbacks
         FROM partners p
        ORDER BY
          CASE p.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END,
          p.name ASC`,
    );

    res.json({
      partners: rows.map((row) => ({
        ...toJsonPartner(row),
        conversionCount: row.conversion_count,
        pendingPostbacks: row.pending_postbacks,
      })),
    });
  } catch (err) {
    console.error('[admin/partners] list failed:', err);
    res.status(500).json({ error: 'Failed to load partners' });
  }
});

// ── Partner details ─────────────────────────────────────────────
adminPartnersRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const partner = await queryOne<PartnerRow>(
      `SELECT * FROM partners WHERE id = $1`,
      [req.params.id],
    );
    if (!partner) {
      res.status(404).json({ error: 'Partner not found' });
      return;
    }

    const [countryPayouts, accounts, totals] = await Promise.all([
      query<{ country_code: string; payout_cents: number; updated_at: string }>(
        `SELECT country_code, payout_cents, updated_at
           FROM partner_country_payouts
          WHERE partner_id = $1
          ORDER BY country_code ASC`,
        [partner.id],
      ),
      query<{ id: string; email: string; display_name: string | null; status: string; last_login_at: string | null }>(
        `SELECT id, email, display_name, status, last_login_at
           FROM partner_accounts
          WHERE partner_id = $1
          ORDER BY created_at ASC`,
        [partner.id],
      ),
      queryOne<{
        attributed_users: number;
        installs: number;
        stage4: number;
        harvests: number;
        reversed: number;
        payout_pending: number;
        payout_paid: number;
        payout_reversed: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM users WHERE partner_id = $1)                                                    AS attributed_users,
           (SELECT count(*)::int FROM partner_conversions WHERE partner_id = $1 AND event_type = 'install')           AS installs,
           (SELECT count(*)::int FROM partner_conversions WHERE partner_id = $1 AND event_type = 'stage_4')           AS stage4,
           (SELECT count(*)::int FROM partner_conversions WHERE partner_id = $1 AND event_type = 'harvest')           AS harvests,
           (SELECT count(*)::int FROM partner_conversions WHERE partner_id = $1 AND status = 'reversed')              AS reversed,
           (SELECT coalesce(sum(payout_cents),0)::int FROM partner_conversions WHERE partner_id = $1 AND status = 'pending')   AS payout_pending,
           (SELECT coalesce(sum(payout_cents),0)::int FROM partner_conversions WHERE partner_id = $1 AND status IN ('approved','paid')) AS payout_paid,
           (SELECT coalesce(sum(payout_cents),0)::int FROM partner_conversions WHERE partner_id = $1 AND status = 'reversed')  AS payout_reversed`,
        [partner.id],
      ),
    ]);

    res.json({
      partner: toJsonPartner(partner),
      countryPayouts: countryPayouts.map((r) => ({
        countryCode: r.country_code,
        payoutCents: r.payout_cents,
        updatedAt: r.updated_at,
      })),
      accounts: accounts.map((a) => ({
        id: a.id,
        email: a.email,
        displayName: a.display_name,
        status: a.status,
        lastLoginAt: a.last_login_at,
      })),
      totals: {
        attributedUsers: totals?.attributed_users ?? 0,
        installs: totals?.installs ?? 0,
        stage4: totals?.stage4 ?? 0,
        harvests: totals?.harvests ?? 0,
        reversed: totals?.reversed ?? 0,
        payoutPendingCents: totals?.payout_pending ?? 0,
        payoutPaidCents: totals?.payout_paid ?? 0,
        payoutReversedCents: totals?.payout_reversed ?? 0,
      },
    });
  } catch (err) {
    console.error('[admin/partners] detail failed:', err);
    res.status(500).json({ error: 'Failed to load partner details' });
  }
});

// ── Update partner ──────────────────────────────────────────────
adminPartnersRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const partnerId = req.params.id;
    const body = req.body ?? {};

    const updates: string[] = [];
    const params: any[] = [];

    if (typeof body.status === 'string') {
      if (!(PARTNER_STATUSES as readonly string[]).includes(body.status)) {
        res.status(400).json({ error: `Invalid status. Allowed: ${PARTNER_STATUSES.join(', ')}` });
        return;
      }
      params.push(body.status);
      updates.push(`status = $${params.length}`);
    }

    if (typeof body.type === 'string') {
      if (!(PARTNER_TYPES as readonly string[]).includes(body.type)) {
        res.status(400).json({ error: `Invalid type. Allowed: ${PARTNER_TYPES.join(', ')}` });
        return;
      }
      params.push(body.type);
      updates.push(`type = $${params.length}`);
    }

    if (typeof body.defaultPayoutCents === 'number' && body.defaultPayoutCents >= 0 && body.defaultPayoutCents <= 100_000) {
      params.push(Math.round(body.defaultPayoutCents));
      updates.push(`default_payout_cents = $${params.length}`);
    }

    if (typeof body.postbackUrlTemplate === 'string') {
      const v = body.postbackUrlTemplate.trim();
      if (v.length > 0 && !/^https?:\/\//i.test(v)) {
        res.status(400).json({ error: 'Postback URL must start with http:// or https://' });
        return;
      }
      params.push(v.length === 0 ? null : v);
      updates.push(`postback_url_template = $${params.length}`);
    }

    if (typeof body.postbackMethod === 'string') {
      if (!(POSTBACK_METHODS as readonly string[]).includes(body.postbackMethod)) {
        res.status(400).json({ error: `Invalid postback method. Allowed: ${POSTBACK_METHODS.join(', ')}` });
        return;
      }
      params.push(body.postbackMethod);
      updates.push(`postback_method = $${params.length}`);
    }

    if (typeof body.approvalMode === 'string') {
      if (!(PARTNER_APPROVAL_MODES as readonly string[]).includes(body.approvalMode)) {
        res.status(400).json({ error: `Invalid approval mode. Allowed: ${PARTNER_APPROVAL_MODES.join(', ')}` });
        return;
      }
      params.push(body.approvalMode);
      updates.push(`approval_mode = $${params.length}`);
    }

    if (typeof body.holdHours === 'number' && body.holdHours >= 0 && body.holdHours <= 24 * 30) {
      params.push(Math.round(body.holdHours));
      updates.push(`hold_hours = $${params.length}`);
    }

    if (typeof body.attributionWindowHours === 'number' && body.attributionWindowHours >= 1 && body.attributionWindowHours <= 8760) {
      params.push(Math.round(body.attributionWindowHours));
      updates.push(`attribution_window_hours = $${params.length}`);
    }

    if (typeof body.reportTz === 'string') {
      const v = body.reportTz.trim();
      if (v.length === 0 || v.length > 64) {
        res.status(400).json({ error: 'Invalid report_tz' });
        return;
      }
      params.push(v);
      updates.push(`report_tz = $${params.length}`);
    }

    if (Array.isArray(body.allowedEvents)) {
      const cleaned: string[] = [];
      for (const e of body.allowedEvents) {
        if (typeof e !== 'string') continue;
        const t = e.trim();
        if (!ALLOWED_EVENT_TYPES.has(t)) {
          res.status(400).json({ error: `Invalid event type: ${t}. Known: ${[...ALLOWED_EVENT_TYPES].join(', ')}` });
          return;
        }
        if (!cleaned.includes(t)) cleaned.push(t);
      }
      params.push(cleaned);
      updates.push(`allowed_events = $${params.length}::text[]`);
    }

    if (typeof body.contactEmail === 'string') {
      const v = body.contactEmail.trim();
      if (v.length > 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
        res.status(400).json({ error: 'Invalid contact email' });
        return;
      }
      params.push(v.length === 0 ? null : v);
      updates.push(`contact_email = $${params.length}`);
    }

    if (typeof body.notes === 'string') {
      params.push(body.notes.slice(0, 4000));
      updates.push(`notes = $${params.length}`);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'Nothing to update' });
      return;
    }

    updates.push('updated_at = now()');
    params.push(partnerId);
    await execute(
      `UPDATE partners SET ${updates.join(', ')} WHERE id = $${params.length}`,
      params,
    );

    const partner = await queryOne<PartnerRow>(`SELECT * FROM partners WHERE id = $1`, [partnerId]);
    if (!partner) {
      res.status(404).json({ error: 'Partner not found after update' });
      return;
    }
    res.json({ partner: toJsonPartner(partner) });
  } catch (err) {
    console.error('[admin/partners] update failed:', err);
    res.status(500).json({ error: 'Failed to update partner' });
  }
});

// ── Country payouts ─────────────────────────────────────────────
adminPartnersRouter.put('/:id/country-payouts/:country', async (req: Request, res: Response) => {
  try {
    const country = String(req.params.country || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) {
      res.status(400).json({ error: 'Country must be ISO-3166-1 alpha-2 (2 letters)' });
      return;
    }
    const cents = Number(req.body?.payoutCents);
    if (!Number.isFinite(cents) || cents < 0 || cents > 100_000) {
      res.status(400).json({ error: 'payoutCents must be between 0 and 100000' });
      return;
    }
    await execute(
      `INSERT INTO partner_country_payouts (partner_id, country_code, payout_cents)
       VALUES ($1, $2, $3)
       ON CONFLICT (partner_id, country_code)
       DO UPDATE SET payout_cents = EXCLUDED.payout_cents, updated_at = now()`,
      [req.params.id, country, Math.round(cents)],
    );
    res.json({ countryCode: country, payoutCents: Math.round(cents) });
  } catch (err) {
    console.error('[admin/partners] put country payout failed:', err);
    res.status(500).json({ error: 'Failed to set country payout' });
  }
});

adminPartnersRouter.delete('/:id/country-payouts/:country', async (req: Request, res: Response) => {
  try {
    const country = String(req.params.country || '').toUpperCase();
    await execute(
      `DELETE FROM partner_country_payouts WHERE partner_id = $1 AND country_code = $2`,
      [req.params.id, country],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/partners] delete country payout failed:', err);
    res.status(500).json({ error: 'Failed to delete country payout' });
  }
});

// ── Partner conversion ledger (admin view) ─────────────────────
adminPartnersRouter.get('/:id/conversions', async (req: Request, res: Response) => {
  try {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit as string) || 100));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

    const status = (req.query.status as string) || '';
    const event = (req.query.event as string) || '';
    const country = ((req.query.country as string) || '').toUpperCase();

    const where: string[] = ['c.partner_id = $1'];
    const params: any[] = [req.params.id];
    if (status) { params.push(status); where.push(`c.status = $${params.length}`); }
    if (event)  { params.push(event);  where.push(`c.event_type = $${params.length}`); }
    if (country && /^[A-Z]{2}$/.test(country)) {
      params.push(country); where.push(`c.country_code = $${params.length}`);
    }

    const totalRow = await queryOne<{ total: number }>(
      `SELECT count(*)::int AS total FROM partner_conversions c WHERE ${where.join(' AND ')}`,
      params,
    );

    params.push(limit, offset);
    const rows = await query<{
      id: string;
      user_id: string;
      user_email: string | null;
      click_id: string | null;
      event_type: string;
      country_code: string | null;
      payout_cents: number;
      status: string;
      fraud_reason: string | null;
      hold_until: string | null;
      created_at: string;
      approved_at: string | null;
      paid_at: string | null;
    }>(
      `SELECT c.id, c.user_id, u.email AS user_email,
              c.click_id, c.event_type, c.country_code, c.payout_cents,
              c.status, c.fraud_reason, c.hold_until, c.created_at,
              c.approved_at, c.paid_at
         FROM partner_conversions c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    res.json({
      total: totalRow?.total ?? 0,
      limit,
      offset,
      rows: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        userEmail: r.user_email,
        clickId: r.click_id,
        eventType: r.event_type,
        countryCode: r.country_code,
        payoutCents: r.payout_cents,
        status: r.status,
        fraudReason: r.fraud_reason,
        holdUntil: r.hold_until,
        createdAt: r.created_at,
        approvedAt: r.approved_at,
        paidAt: r.paid_at,
      })),
    });
  } catch (err) {
    console.error('[admin/partners] conversions failed:', err);
    res.status(500).json({ error: 'Failed to load conversions' });
  }
});

// ── Mark conversion as fraud (= reverse) ────────────────────────
adminPartnersRouter.post('/conversions/:conversionId/mark-fraud', async (req: Request, res: Response) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (!FRAUD_REASONS.includes(reason as FraudReason)) {
      res.status(400).json({
        error: `Invalid reason. Allowed: ${FRAUD_REASONS.join(', ')}`,
      });
      return;
    }

    const result = await reversePartnerConversion({
      conversionId: String(req.params.conversionId || ''),
      reason: reason as FraudReason,
    });

    if (!result.reversed) {
      const status = result.reason === 'not_found' ? 404 : 400;
      res.status(status).json({ error: result.reason || 'Failed to reverse' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/partners] mark-fraud failed:', err);
    res.status(500).json({ error: 'Failed to mark fraud' });
  }
});

// ── Admin view of postback delivery log ─────────────────────────
adminPartnersRouter.get('/:id/postbacks', async (req: Request, res: Response) => {
  try {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit as string) || 100));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

    const rows = await query<{
      id: string;
      conversion_id: string | null;
      event_type: string | null;
      url: string;
      status: string;
      attempts: number;
      last_response_code: number | null;
      last_error: string | null;
      created_at: string;
      sent_at: string | null;
      next_retry_at: string;
    }>(
      `SELECT id, conversion_id, event_type, url, status, attempts,
              last_response_code, last_error, created_at, sent_at, next_retry_at
         FROM partner_postbacks_out
        WHERE partner_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [req.params.id, limit, offset],
    );

    res.json({
      rows: rows.map((r) => ({
        id: r.id,
        conversionId: r.conversion_id,
        eventType: r.event_type,
        url: r.url,
        status: r.status,
        attempts: r.attempts,
        lastResponseCode: r.last_response_code,
        lastError: r.last_error,
        createdAt: r.created_at,
        sentAt: r.sent_at,
        nextRetryAt: r.next_retry_at,
      })),
    });
  } catch (err) {
    console.error('[admin/partners] postbacks failed:', err);
    res.status(500).json({ error: 'Failed to load postback log' });
  }
});

/**
 * Manual replay: forces a `dead`/`failed` row back into the queue.
 * Useful when a partner was down for >MAX_ATTEMPTS hours but their
 * endpoint is now back. Resets the attempt counter so the row gets a
 * fresh retry budget.
 */
adminPartnersRouter.post('/:id/postbacks/:postbackId/replay', async (req: Request, res: Response) => {
  try {
    const updated = await execute(
      `UPDATE partner_postbacks_out
          SET status = 'queued',
              attempts = 0,
              last_error = NULL,
              next_retry_at = now()
        WHERE id = $1 AND partner_id = $2`,
      [req.params.postbackId, req.params.id],
    );
    if (updated === 0) {
      res.status(404).json({ error: 'Postback not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/partners] replay failed:', err);
    res.status(500).json({ error: 'Failed to replay postback' });
  }
});

/** Expose the fraud reasons enum for the admin UI's reversal modal. */
adminPartnersRouter.get('/_meta/fraud-reasons', (_req: Request, res: Response) => {
  res.json({ reasons: FRAUD_REASONS });
});
