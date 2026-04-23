import { Router, type Request, type Response } from 'express';
import { query, queryOne } from '../../lib/db.js';

export const partnerConversionsRouter = Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/**
 * GET /partner/conversions?status=&event=&from=&to=&limit=&offset=
 *
 * Paginated conversion ledger. The partner sees everything attributed to
 * them with their own click_id, so the join is straightforward. We never
 * expose the raw user_id — only its hex hash (server-side) so the
 * partner can correlate multi-event journeys without being able to
 * target our actual users.
 */
partnerConversionsRouter.get('/', async (req: Request, res: Response) => {
  const partnerId = req.partner!.partnerId;

  const limit = Math.max(1, Math.min(MAX_LIMIT, parseInt(req.query.limit as string) || DEFAULT_LIMIT));
  const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : null;
  const eventType = typeof req.query.event === 'string' && req.query.event ? req.query.event : null;
  const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : null;
  const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : null;

  const clauses: string[] = [`partner_id = $1`];
  const params: any[] = [partnerId];

  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  if (eventType) {
    params.push(eventType);
    clauses.push(`event_type = $${params.length}`);
  }
  if (from) {
    params.push(from);
    clauses.push(`created_at >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to);
    clauses.push(`created_at < $${params.length}::timestamptz`);
  }

  const where = clauses.join(' AND ');

  const totalRow = await queryOne<{ total: number }>(
    `SELECT count(*)::int AS total FROM partner_conversions WHERE ${where}`,
    params,
  );

  params.push(limit, offset);
  const rows = await query<{
    id: string;
    click_id: string | null;
    event_type: string;
    payout_cents: number;
    status: string;
    hold_until: string | null;
    created_at: string;
    approved_at: string | null;
    paid_at: string | null;
    user_id_hash: string;
  }>(
    `SELECT id, click_id, event_type, payout_cents,
            status, hold_until, created_at, approved_at, paid_at,
            substr(md5(user_id::text), 1, 16) AS user_id_hash
     FROM partner_conversions
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  res.json({
    success: true,
    data: {
      total: totalRow?.total ?? 0,
      limit,
      offset,
      rows: rows.map((r) => ({
        id: r.id,
        clickId: r.click_id,
        eventType: r.event_type,
        payoutCents: r.payout_cents,
        status: r.status,
        holdUntil: r.hold_until,
        createdAt: r.created_at,
        approvedAt: r.approved_at,
        paidAt: r.paid_at,
        userIdHash: r.user_id_hash,
      })),
    },
  });
});

/**
 * GET /partner/conversions/export.csv?from=&to=
 *
 * Streams a CSV of conversions for the given range. Intended for the
 * partner to reconcile against their own internal accounting; we set
 * `Content-Disposition` so the browser downloads rather than renders.
 */
partnerConversionsRouter.get('/export.csv', async (req: Request, res: Response) => {
  const partnerId = req.partner!.partnerId;
  const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : null;
  const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : null;

  const clauses: string[] = [`partner_id = $1`];
  const params: any[] = [partnerId];
  if (from) { params.push(from); clauses.push(`created_at >= $${params.length}::timestamptz`); }
  if (to)   { params.push(to);   clauses.push(`created_at <  $${params.length}::timestamptz`); }

  const rows = await query<{
    created_at: string;
    click_id: string | null;
    event_type: string;
    payout_cents: number;
    status: string;
    user_id_hash: string;
  }>(
    `SELECT created_at, click_id, event_type, payout_cents, status,
            substr(md5(user_id::text), 1, 16) AS user_id_hash
     FROM partner_conversions
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at ASC
     LIMIT 50000`,
    params,
  );

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="conversions-${Date.now()}.csv"`);

  const escape = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  res.write('timestamp,click_id,event_type,payout_usd,status,user_hash\n');
  for (const r of rows) {
    res.write(
      [
        escape(r.created_at),
        escape(r.click_id ?? ''),
        escape(r.event_type),
        (r.payout_cents / 100).toFixed(2),
        escape(r.status),
        escape(r.user_id_hash),
      ].join(',') + '\n',
    );
  }
  res.end();
});
