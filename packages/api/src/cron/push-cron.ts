import { query, execute } from '../lib/db.js';
import { sendPush } from '../lib/push.js';

const BUCKET_FILL_MINUTES = 50;
const PET_GIFT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

async function alreadySent(userId: string, triggerKey: string): Promise<boolean> {
  const row = await query(
    `SELECT 1 FROM push_sent_log WHERE user_id = $1 AND trigger_key = $2 AND sent_date = CURRENT_DATE`,
    [userId, triggerKey]
  );
  return row.length > 0;
}

async function markSent(userId: string, triggerKey: string): Promise<void> {
  await execute(
    `INSERT INTO push_sent_log (user_id, trigger_key, sent_date)
     VALUES ($1, $2, CURRENT_DATE)
     ON CONFLICT DO NOTHING`,
    [userId, triggerKey]
  );
}

async function checkBucketFull(): Promise<void> {
  const farms = await query(
    `SELECT f.user_id, f.bucket_last_collected_at
     FROM farms f
     JOIN push_tokens pt ON pt.user_id = f.user_id
     WHERE f.harvested = false
       AND f.bucket_last_collected_at + interval '${BUCKET_FILL_MINUTES} minutes' <= NOW()`,
    []
  );
  console.log(`[push-cron] bucket_full: ${farms.length} users with full bucket`);

  for (const farm of farms) {
    if (await alreadySent(farm.user_id, 'bucket_full')) continue;
    console.log(`[push-cron] sending bucket_full to ${farm.user_id}`);
    const ok = await sendPush(
      farm.user_id,
      'Bucket is full!',
      'Your bucket is full! Collect water before it overflows.',
      { type: 'bucket_full' }
    );
    if (ok) await markSent(farm.user_id, 'bucket_full');
  }
}

async function checkPetGift(): Promise<void> {
  const pets = await query(
    `SELECT up.user_id
     FROM user_pets up
     JOIN push_tokens pt ON pt.user_id = up.user_id
     WHERE up.is_active = true
       AND up.pet_id = 'hamster'
       AND (up.last_gift_at IS NULL OR up.last_gift_at + interval '24 hours' <= NOW())`,
    []
  );

  for (const pet of pets) {
    if (await alreadySent(pet.user_id, 'pet_gift')) continue;
    const ok = await sendPush(
      pet.user_id,
      'Hamster has a gift!',
      'Your hamster has a gift for you! Tap to collect.',
      { type: 'pet_gift' }
    );
    if (ok) await markSent(pet.user_id, 'pet_gift');
  }
}

async function checkDailyChallenge(): Promise<void> {
  const users = await query(
    `SELECT dc.user_id, dc.water_given, dc.required
     FROM daily_challenges dc
     JOIN push_tokens pt ON pt.user_id = dc.user_id
     WHERE dc.challenge_date = CURRENT_DATE
       AND dc.completed = false
       AND dc.reward_claimed = false`,
    []
  );

  for (const u of users) {
    if (await alreadySent(u.user_id, 'daily_challenge')) continue;
    const remaining = Math.max(0, Math.ceil(u.required - u.water_given));
    if (remaining <= 0) continue;
    const ok = await sendPush(
      u.user_id,
      'Daily Challenge',
      `You still need ${remaining}g to complete today's challenge!`,
      { type: 'daily_challenge' }
    );
    if (ok) await markSent(u.user_id, 'daily_challenge');
  }
}

async function checkCheckin(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  const users = await query(
    `SELECT pt.user_id
     FROM push_tokens pt
     WHERE NOT EXISTS (
       SELECT 1 FROM quest_completions qc
       JOIN quests q ON q.id = qc.quest_id
       WHERE qc.user_id = pt.user_id
         AND q.quest_key = 'checkin'
         AND qc.completion_date = $1
     )`,
    [today]
  );

  for (const u of users) {
    if (await alreadySent(u.user_id, 'checkin')) continue;
    const ok = await sendPush(
      u.user_id,
      'Daily reward!',
      "Don't forget to collect your daily check-in reward!",
      { type: 'checkin' }
    );
    if (ok) await markSent(u.user_id, 'checkin');
  }
}

/**
 * Close sessions that have been idle for > 30 minutes. We consider the client
 * "gone" when `ended_at` (which the activity tracker / heartbeat keeps fresh)
 * hasn't moved for a while. Duration is computed from started_at → ended_at.
 *
 * This is the single source of truth for session_duration metrics; as long as
 * this cron runs regularly, admin dashboards get accurate "avg session time"
 * even if the user just closes the app without hitting logout.
 */
async function closeIdleSessions(): Promise<void> {
  try {
    const rows = await query<{ id: string }>(
      `UPDATE sessions
       SET duration_sec = GREATEST(0, EXTRACT(EPOCH FROM (ended_at - started_at))::int)
       WHERE duration_sec IS NULL
         AND ended_at < now() - interval '30 minutes'
       RETURNING id`,
    );
    if (rows.length > 0) {
      console.log(`[push-cron] closed ${rows.length} idle sessions`);
    }
  } catch (err) {
    const msg = (err as Error).message || '';
    if (!/does not exist|relation.*sessions/i.test(msg)) {
      console.error('[push-cron] closeIdleSessions failed:', msg);
    }
  }
}

// C-3: batch rollover of total_water_last_month for farms that have not been
// touched in the current month. Idempotent — only affects rows where
// water_month is older than the current UTC month.
async function rolloverWaterMonth(): Promise<void> {
  try {
    const rows = await query<{ rollover_water_month_batch: number }>(
      `SELECT rollover_water_month_batch()`,
    );
    const n = rows[0]?.rollover_water_month_batch ?? 0;
    if (n > 0) console.log(`[push-cron] rolled over water month for ${n} farms`);
  } catch (err) {
    // If the function doesn't exist (e.g. migration 017 not applied yet), fall
    // back to a safe no-op. Do not throw — other cron tasks shouldn't fail.
    const msg = (err as Error).message || '';
    if (!/does not exist/i.test(msg)) {
      console.error('[push-cron] rollover failed:', msg);
    }
  }
}

export async function runPushCron(): Promise<void> {
  console.log('[push-cron] running checks...');
  try {
    const results = await Promise.allSettled([
      checkBucketFull(),
      checkPetGift(),
      checkDailyChallenge(),
      checkCheckin(),
      rolloverWaterMonth(),
      closeIdleSessions(),
    ]);
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const names = ['bucket', 'pet', 'challenge', 'checkin', 'rollover', 'sessions'];
        console.error(`[push-cron] ${names[i]} failed:`, r.reason);
      }
    });
    console.log('[push-cron] done');
  } catch (err) {
    console.error('[push-cron] error:', (err as Error).message);
  }
}
