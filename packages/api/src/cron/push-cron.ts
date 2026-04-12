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

  for (const farm of farms) {
    if (await alreadySent(farm.user_id, 'bucket_full')) continue;
    await sendPush(
      farm.user_id,
      'Bucket is full!',
      'Your bucket is full! Collect water before it overflows.',
      { type: 'bucket_full' }
    );
    await markSent(farm.user_id, 'bucket_full');
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
    await sendPush(
      pet.user_id,
      'Hamster has a gift!',
      'Your hamster has a gift for you! Tap to collect.',
      { type: 'pet_gift' }
    );
    await markSent(pet.user_id, 'pet_gift');
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
    await sendPush(
      u.user_id,
      'Daily Challenge',
      `You still need ${remaining}g to complete today's challenge!`,
      { type: 'daily_challenge' }
    );
    await markSent(u.user_id, 'daily_challenge');
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
         AND qc.completed_at::date = $1
     )`,
    [today]
  );

  for (const u of users) {
    if (await alreadySent(u.user_id, 'checkin')) continue;
    await sendPush(
      u.user_id,
      'Daily reward!',
      "Don't forget to collect your daily check-in reward!",
      { type: 'checkin' }
    );
    await markSent(u.user_id, 'checkin');
  }
}

export async function runPushCron(): Promise<void> {
  try {
    await Promise.allSettled([
      checkBucketFull(),
      checkPetGift(),
      checkDailyChallenge(),
      checkCheckin(),
    ]);
  } catch (err) {
    console.error('[push-cron] error:', (err as Error).message);
  }
}
