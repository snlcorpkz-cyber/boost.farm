import { Router, type Request, type Response } from 'express';
import { query } from '../../lib/db.js';

export const partnerPostbacksRouter = Router();

/**
 * GET /partner/postbacks?limit=&offset=
 *
 * Outbound postback delivery log. Primary use: the partner can debug
 * their own endpoint — "did BoostFarm even try to call us?". Shows the
 * URL we called, HTTP status code, response body (truncated by us
 * server-side), attempt counter, and whether the postback is still
 * pending retry.
 */
partnerPostbacksRouter.get('/', async (req: Request, res: Response) => {
  const partnerId = req.partner!.partnerId;
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit as string) || 100));
  const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

  const rows = await query<{
    id: string;
    conversion_id: string | null;
    status: string;
    attempts: number;
    url: string;
    last_response_code: number | null;
    last_error: string | null;
    last_response_body: string | null;
    created_at: string;
    sent_at: string | null;
    next_retry_at: string;
  }>(
    `SELECT id, conversion_id, status, attempts, url,
            last_response_code, last_error,
            CASE WHEN last_response_body IS NULL THEN NULL
                 ELSE substring(last_response_body, 1, 300)
            END AS last_response_body,
            created_at, sent_at, next_retry_at
     FROM partner_postbacks_out
     WHERE partner_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [partnerId, limit, offset],
  );

  res.json({
    success: true,
    data: {
      rows: rows.map((r) => ({
        id: r.id,
        conversionId: r.conversion_id,
        status: r.status,
        attempts: r.attempts,
        url: r.url,
        lastResponseCode: r.last_response_code,
        lastError: r.last_error,
        lastResponseBody: r.last_response_body,
        createdAt: r.created_at,
        sentAt: r.sent_at,
        nextRetryAt: r.next_retry_at,
      })),
    },
  });
});
