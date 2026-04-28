/**
 * Partner postback dispatcher.
 *
 * Drains `partner_postbacks_out`. Same in-process pattern as the CAPI
 * and AppsFlyer S2S workers — no Redis, no BullMQ. The table is the
 * queue. We pick rows where `status = 'queued' AND next_retry_at <= now()`
 * and HTTP-call the partner's URL. Successes flip to `sent`, failures
 * back off exponentially up to MAX_ATTEMPTS, after which the row is
 * marked `dead` and stops being retried (admin can replay manually).
 *
 * Why this lives separately from CAPI / AF S2S workers:
 *   - Different SLA: partners get *near-real-time* postbacks; CAPI is
 *     allowed to lag a minute.
 *   - Different failure model: partners answer with their own status
 *     codes and bodies that we want to log verbatim for debugging from
 *     the partner portal's "postbacks" page.
 *   - Reversal events ride the same queue but we cannot batch them
 *     across partners (URLs differ).
 */
import { query, execute } from '../lib/db.js';

/** Per-tick row ceiling so a backlog can't monopolise the event loop. */
const MAX_ROWS_PER_TICK = 200;

/** Per-row HTTP timeout. Partners that don't ack in 10s are flaky. */
const HTTP_TIMEOUT_MS = 10_000;

/**
 * Hard ceiling on retries before we give up and mark the row `dead`.
 * Eight attempts with the backoff schedule below covers ~6 hours of
 * transient outage, after which a human should look at the partner's
 * endpoint anyway.
 */
const MAX_ATTEMPTS = 8;

/**
 * Exponential backoff with jitter, in milliseconds. attempt is 1-indexed:
 *   1 → ~30s, 2 → ~60s, 3 → ~2 min, 4 → ~4 min, 5 → ~10 min,
 *   6 → ~30 min, 7 → ~1 hour, 8 → ~3 hours.
 */
function nextBackoffMs(attempt: number): number {
  const base = Math.min(60 * 60 * 3 * 1000, 30 * 1000 * Math.pow(2, attempt - 1));
  const jitter = 0.7 + Math.random() * 0.6; // 0.7×–1.3×
  return Math.round(base * jitter);
}

interface QueueRow {
  id: string;
  partner_id: string;
  url: string;
  method: string;
  body: string | null;
  attempts: number;
}

/** Truncate huge response bodies before persisting. */
function clip(s: string | null, max = 4000): string | null {
  if (!s) return s;
  return s.length > max ? s.slice(0, max) + `…[truncated ${s.length - max} chars]` : s;
}

/**
 * Single tick. Returns counts so the boot log can announce activity.
 */
export async function runPartnerPostbackCron(): Promise<{ sent: number; failed: number; dead: number }> {
  const rows = await query<QueueRow>(
    `SELECT id, partner_id, url, method, body, attempts
       FROM partner_postbacks_out
      WHERE status = 'queued'
        AND next_retry_at <= now()
      ORDER BY next_retry_at ASC
      LIMIT $1`,
    [MAX_ROWS_PER_TICK],
  );

  if (rows.length === 0) return { sent: 0, failed: 0, dead: 0 };

  let sent = 0;
  let failed = 0;
  let dead = 0;

  await Promise.all(
    rows.map(async (row) => {
      const result = await deliverOne(row);
      if (result === 'sent') sent++;
      else if (result === 'dead') dead++;
      else failed++;
    }),
  );

  if (sent > 0 || failed > 0 || dead > 0) {
    console.log(`[partner-postback-cron] sent=${sent} failed=${failed} dead=${dead}`);
  }
  return { sent, failed, dead };
}

async function deliverOne(row: QueueRow): Promise<'sent' | 'failed' | 'dead'> {
  const attempt = row.attempts + 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let errorMsg: string | null = null;

  try {
    const init: RequestInit = {
      method: row.method,
      signal: controller.signal,
      headers: {
        'User-Agent': 'BoostFarm-PartnerPostback/1.0',
        Accept: '*/*',
      },
    };
    if (row.method === 'POST' && row.body) {
      (init.headers as Record<string, string>)['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = row.body;
    }

    const resp = await fetch(row.url, init);
    statusCode = resp.status;

    // Drain the body (best-effort). Partners often respond with empty
    // 200s; a few echo our params. Either way we keep at most 4 KB.
    try {
      responseBody = clip(await resp.text());
    } catch {
      responseBody = null;
    }

    if (resp.ok) {
      await execute(
        `UPDATE partner_postbacks_out
            SET status = 'sent',
                attempts = $2,
                last_response_code = $3,
                last_response_body = $4,
                last_error = NULL,
                sent_at = now()
          WHERE id = $1`,
        [row.id, attempt, statusCode, responseBody],
      );
      return 'sent';
    }

    // 4xx is permanent — no retry. The partner's endpoint actively
    // rejected our payload; retrying isn't going to fix it. We stamp
    // it `dead` so it stops being picked up.
    if (statusCode >= 400 && statusCode < 500) {
      await execute(
        `UPDATE partner_postbacks_out
            SET status = 'dead',
                attempts = $2,
                last_response_code = $3,
                last_response_body = $4,
                last_error = $5
          WHERE id = $1`,
        [row.id, attempt, statusCode, responseBody, `HTTP ${statusCode}`],
      );
      return 'dead';
    }

    errorMsg = `HTTP ${statusCode}`;
  } catch (err) {
    errorMsg = (err as Error).message || 'fetch_failed';
  } finally {
    clearTimeout(timer);
  }

  // Retry path (5xx, timeout, DNS, etc.).
  if (attempt >= MAX_ATTEMPTS) {
    await execute(
      `UPDATE partner_postbacks_out
          SET status = 'dead',
              attempts = $2,
              last_response_code = $3,
              last_response_body = $4,
              last_error = $5
        WHERE id = $1`,
      [row.id, attempt, statusCode, responseBody, errorMsg],
    );
    return 'dead';
  }

  const retryInMs = nextBackoffMs(attempt);
  await execute(
    `UPDATE partner_postbacks_out
        SET attempts = $2,
            last_response_code = $3,
            last_response_body = $4,
            last_error = $5,
            next_retry_at = now() + ($6 || ' milliseconds')::interval
      WHERE id = $1`,
    [row.id, attempt, statusCode, responseBody, errorMsg, retryInMs],
  );
  return 'failed';
}
