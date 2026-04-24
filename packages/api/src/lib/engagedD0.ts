/**
 * EngagedD0 — "quality install" detection.
 *
 * The problem:
 *  Meta Ads Manager optimizes on app events. If we feed it
 *  `CompletedRegistration` campaigns will flood us with bot / tourist
 *  installs that sign up and never touch the farm. We need a stronger
 *  signal — one that a real human would emit but a bot wouldn't.
 *
 * The definition (kept deliberately small):
 *  A user is "EngagedD0" when they have, within 24 hours of their first
 *  `auth.register`:
 *    • the register event itself, AND
 *    • at least one `farm.water` event, AND
 *    • at least one rewarded-ad event (`ad.rewarded` OR
 *      `ad.server_granted`).
 *  The water+ad combo is the floor for "user actually played and saw
 *  monetisation" — this is the lead the ads algorithm should optimise
 *  towards.
 *
 * Exactly-once semantics:
 *  We enforce uniqueness through a partial unique index on
 *  events (user_id) WHERE event_name = 'EngagedD0' — managed by the
 *  helper below (it creates the index on first call). The unique
 *  constraint means ON CONFLICT DO NOTHING gives us idempotent writes
 *  even under concurrent farm.water + ad.rewarded calls.
 */

import { execute, queryOne } from './db.js';

const SCOPED_EVENT_NAME = 'EngagedD0';

/**
 * Cached flag so we don't attempt the CREATE UNIQUE INDEX on every
 * call. The index itself is IF NOT EXISTS, but skipping the round-trip
 * is still a clear win under load.
 */
let indexReady = false;
let indexPromise: Promise<void> | null = null;

async function ensureUniqueIndex(): Promise<void> {
  if (indexReady) return;
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    try {
      // Partial unique index — only enforced on EngagedD0 rows, so the
      // bazillion farm.water / ad.rewarded events stay untouched.
      await execute(
        `CREATE UNIQUE INDEX IF NOT EXISTS events_engaged_d0_uniq
           ON events (user_id)
           WHERE event_name = 'EngagedD0'`,
      );
      indexReady = true;
    } catch (err) {
      // A race with another booting process is fine — the CREATE is
      // idempotent. Anything else, we log and allow retry next call.
      console.error('[engagedD0] ensureUniqueIndex failed', (err as Error).message);
      indexPromise = null;
      throw err;
    }
  })();
  return indexPromise;
}

interface CandidateRow {
  user_id: string;
  registered_at: string;
  has_water: boolean;
  has_ad: boolean;
  engaged_exists: boolean;
}

/**
 * Run after any farm.water / ad.server_granted / ad.rewarded for a user.
 * If the three-of-a-kind floor is met AND we haven't emitted EngagedD0
 * before AND we're still inside the 24h window, insert the event.
 *
 * Returns `true` when a new EngagedD0 row was written (caller can log
 * or trigger follow-up side effects), `false` otherwise. Never throws
 * — this is analytics: it must NEVER fail the user flow.
 */
export async function maybeMarkEngagedD0(userId: string): Promise<boolean> {
  if (!userId) return false;

  try {
    await ensureUniqueIndex();

    // One query: check all gates atomically.
    //   - first register timestamp (MIN so re-registrations don't shift the window)
    //   - whether there's a farm.water inside D0
    //   - whether there's a rewarded-ad inside D0
    //   - whether we already emitted EngagedD0 (short-circuit)
    // The date math is done on the DB side so clock-skew between app
    // servers is irrelevant.
    const row = await queryOne<CandidateRow>(
      `WITH
         reg AS (
           SELECT user_id, MIN(created_at) AS registered_at
             FROM events
            WHERE user_id = $1 AND event_name = 'auth.register'
            GROUP BY user_id
         )
       SELECT r.user_id,
              r.registered_at,
              EXISTS(
                SELECT 1 FROM events
                 WHERE user_id = $1
                   AND event_name = 'farm.water'
                   AND created_at <= r.registered_at + interval '24 hours'
              ) AS has_water,
              EXISTS(
                SELECT 1 FROM events
                 WHERE user_id = $1
                   AND event_name IN ('ad.rewarded','ad.server_granted')
                   AND created_at <= r.registered_at + interval '24 hours'
              ) AS has_ad,
              EXISTS(
                SELECT 1 FROM events
                 WHERE user_id = $1
                   AND event_name = 'EngagedD0'
              ) AS engaged_exists
         FROM reg r`,
      [userId],
    );

    if (!row) return false;
    if (row.engaged_exists) return false;
    if (!row.has_water || !row.has_ad) return false;

    // Outside the 24h window — the user did something engaging but
    // too late to count as D0. We simply don't insert; the event is
    // optimised for day-one acquisition.
    const registered = new Date(row.registered_at).getTime();
    const ageMs = Date.now() - registered;
    if (ageMs > 24 * 60 * 60 * 1000) return false;

    // The partial unique index means the conflict lane is "someone
    // already inserted EngagedD0 for this user" — which is exactly
    // the no-op we want under concurrent callers.
    // Partial unique index requires the WHERE clause on the inference
    // specification so Postgres matches the index. Without the WHERE
    // the planner can't prove which unique index we're targeting and
    // falls back to full-column uniqueness (which doesn't exist here).
    const result = await execute(
      `INSERT INTO events (user_id, event_name, properties, created_at)
       VALUES ($1, 'EngagedD0', $2::jsonb, now())
       ON CONFLICT (user_id) WHERE event_name = 'EngagedD0' DO NOTHING`,
      [
        userId,
        JSON.stringify({
          computed_at: new Date().toISOString(),
          registered_at: row.registered_at,
          window_hours: 24,
        }),
      ],
    );
    return result > 0;
  } catch (err) {
    console.error('[engagedD0] maybeMarkEngagedD0 failed', (err as Error).message);
    return false;
  }
}

/**
 * Hook point for quick-checks in tests / ops scripts. Exported alongside
 * the main helper so callers can verify whether the flag already fired
 * without triggering the write path.
 */
export async function hasEngagedD0(userId: string): Promise<boolean> {
  const row = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS(
        SELECT 1 FROM events WHERE user_id = $1 AND event_name = $2
     ) AS exists`,
    [userId, SCOPED_EVENT_NAME],
  );
  return !!row?.exists;
}
