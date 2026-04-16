import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, queryOne, execute } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { getCurrentPhase, getRankForWater } from '@eco-farm/game-engine';
import { notify } from '../lib/notify.js';

export const questsRouter = Router();
questsRouter.use(requireAuth);

async function getUserRank(userId: string) {
  const farm = await queryOne(
    `SELECT total_water_last_month FROM farms WHERE user_id = $1 AND harvested = false`,
    [userId]
  );
  return getRankForWater(farm?.total_water_last_month ?? 0);
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

questsRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const tzOffset = parseInt(req.headers['x-timezone-offset'] as string) || 0;
  const localHour = (new Date().getUTCHours() - tzOffset / 60 + 24) % 24;
  const phase = getCurrentPhase(localHour);
  const today = todayStr();

  const quests = await query(
    `SELECT * FROM quests WHERE active = true`
  );

  const completions = await query(
    `SELECT quest_id, count FROM quest_completions
     WHERE user_id = $1 AND completion_date = $2 AND phase = $3`,
    [userId, today, phase]
  );

  const completionMap = new Map(
    completions.map((c: any) => [c.quest_id, c.count])
  );

  const rank = await getUserRank(userId);

  const questsWithProgress = quests.map((q: any) => ({
    ...q,
    completedCount: completionMap.get(q.id) || 0,
    isCompleted: (completionMap.get(q.id) || 0) >= q.limit_per_phase,
  }));

  res.json({ success: true, data: { quests: questsWithProgress, phase, rank: rank.id } });
});

questsRouter.post('/checkin', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  let type: 'water' | 'nutrition';
  try {
    ({ type } = z.object({ type: z.enum(['water', 'nutrition']) }).parse(req.body));
  } catch {
    res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Invalid type' } });
    return;
  }
  const questKey = type === 'nutrition' ? 'checkin_fert' : 'checkin';
  const tzOffset = parseInt(req.headers['x-timezone-offset'] as string) || 0;
  const localHour = (new Date().getUTCHours() - tzOffset / 60 + 24) % 24;
  const phase = getCurrentPhase(localHour);
  const today = todayStr();

  let quest = await queryOne(`SELECT * FROM quests WHERE quest_key = $1 AND active = true`, [questKey]);
  if (!quest) {
    quest = await queryOne(`SELECT * FROM quests WHERE quest_key = 'checkin' AND active = true`);
  }
  if (!quest) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Check-in quest not found' } });
    return;
  }

  const upserted = await queryOne(
    `INSERT INTO quest_completions (user_id, quest_id, phase, completion_date, count)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (user_id, quest_id, phase, completion_date)
     DO UPDATE SET count = quest_completions.count + 1
     WHERE quest_completions.count < $5
     RETURNING count`,
    [userId, quest.id, phase, today, quest.limit_per_phase]
  );

  if (!upserted) {
    res.status(400).json({ success: false, error: { code: 'ALREADY_CLAIMED', message: 'Already claimed today' } });
    return;
  }

  const farm = await queryOne(
    `SELECT id, water_in_can, nutrition FROM farms WHERE user_id = $1 AND harvested = false`,
    [userId]
  );

  if (farm) {
    if (quest.reward_type === 'water') {
      const mo = new Date().toISOString().slice(0, 7);
      await execute(
        `UPDATE farms SET water_in_can = water_in_can + $1,
         total_water_this_month = CASE WHEN water_month = $3 THEN total_water_this_month + $1 ELSE $1 END,
         water_month = $3
         WHERE id = $2`,
        [quest.reward_amount, farm.id, mo]
      );
    } else if (quest.reward_type === 'nutrition') {
      await execute(`UPDATE farms SET nutrition = nutrition + $1 WHERE id = $2`, [quest.reward_amount, farm.id]);
    }
  }

  res.json({ success: true, data: { rewardType: quest.reward_type, rewardAmount: quest.reward_amount } });
});

questsRouter.post('/:id/complete', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const questId = req.params.id;
  const tzOffset = parseInt(req.headers['x-timezone-offset'] as string) || 0;
  const localHour = (new Date().getUTCHours() - tzOffset / 60 + 24) % 24;
  const phase = getCurrentPhase(localHour);
  const today = todayStr();

  const quest = await queryOne(`SELECT * FROM quests WHERE id = $1 AND active = true`, [questId]);

  if (!quest) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Quest not found' } });
    return;
  }

  const upserted = await queryOne(
    `INSERT INTO quest_completions (user_id, quest_id, phase, completion_date, count)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (user_id, quest_id, phase, completion_date)
     DO UPDATE SET count = quest_completions.count + 1
     WHERE quest_completions.count < $5
     RETURNING count`,
    [userId, questId, phase, today, quest.limit_per_phase]
  );

  if (!upserted) {
    res.status(400).json({ success: false, error: { code: 'LIMIT_REACHED', message: 'Quest limit reached' } });
    return;
  }

  const farm = await queryOne(
    `SELECT id, water_in_can, nutrition FROM farms WHERE user_id = $1 AND harvested = false`,
    [userId]
  );

  if (farm) {
    if (quest.reward_type === 'water') {
      const mo = new Date().toISOString().slice(0, 7);
      await execute(
        `UPDATE farms SET water_in_can = water_in_can + $1,
         total_water_this_month = CASE WHEN water_month = $3 THEN total_water_this_month + $1 ELSE $1 END,
         water_month = $3
         WHERE id = $2`,
        [quest.reward_amount, farm.id, mo]
      );
    } else if (quest.reward_type === 'nutrition') {
      await execute(
        `UPDATE farms SET nutrition = nutrition + $1 WHERE id = $2`,
        [quest.reward_amount, farm.id]
      );
    }
  }

  await notify(userId, 'quest', 'notif.quest_done', {
    reward: quest.reward_amount,
    unit: quest.reward_type === 'water' ? 'water' : 'nutrition',
  });

  res.json({
    success: true,
    data: { rewardType: quest.reward_type, rewardAmount: quest.reward_amount },
  });
});

function yesterdayStr(): string {
  const d = new Date(Date.now() - 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

questsRouter.get('/daily-challenge', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const today = todayStr();
  const yesterday = yesterdayStr();
  const rank = await getUserRank(userId);

  let challenge = await queryOne(
    `SELECT * FROM daily_challenges WHERE user_id = $1 AND challenge_date = $2`,
    [userId, today]
  );

  if (!challenge) {
    const yesterdayChallenge = await queryOne(
      `SELECT streak_days, completed, reward_claimed FROM daily_challenges
       WHERE user_id = $1 AND challenge_date = $2`,
      [userId, yesterday]
    );

    let streakDays = 0;
    if (yesterdayChallenge?.completed && yesterdayChallenge?.reward_claimed) {
      streakDays = (yesterdayChallenge.streak_days || 0) + 1;
    }

    challenge = await queryOne(
      `INSERT INTO daily_challenges (user_id, challenge_date, water_given, required, completed, reward_claimed, reward_amount, streak_days, reward_available_date)
       VALUES ($1, $2, 0, $3, false, false, $4, $5, ($2::date + 1)) RETURNING *`,
      [userId, today, rank.dailyChallengeWaterReq, rank.dailyChallengeReward, streakDays]
    );
  }

  const pendingReward = await queryOne(
    `SELECT reward_amount, challenge_date, streak_days FROM daily_challenges
     WHERE user_id = $1 AND completed = true AND reward_claimed = false
       AND reward_available_date <= $2
       AND challenge_date < $2
     ORDER BY challenge_date DESC LIMIT 1`,
    [userId, today]
  );

  const tomorrowReward = challenge!.completed && !challenge!.reward_claimed
    ? challenge!.reward_amount : null;

  res.json({
    success: true,
    data: {
      waterGiven: challenge!.water_given,
      required: challenge!.required,
      completed: challenge!.completed,
      rewardClaimed: challenge!.reward_claimed,
      reward: challenge!.reward_amount,
      streakDays: challenge!.streak_days,
      progress: Math.min(1, challenge!.water_given / challenge!.required),
      tomorrowReward,
      pendingReward: pendingReward ? {
        amount: pendingReward.reward_amount,
        date: pendingReward.challenge_date,
        streakDays: pendingReward.streak_days,
      } : null,
    },
  });
});

questsRouter.post('/daily-challenge/claim', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const today = todayStr();

  const challenge = await queryOne(
    `UPDATE daily_challenges SET reward_claimed = true
     WHERE user_id = $1 AND completed = true AND reward_claimed = false
       AND reward_available_date <= $2
       AND challenge_date < $2
     RETURNING *`,
    [userId, today]
  );

  if (!challenge) {
    res.status(400).json({ success: false, error: { code: 'CANNOT_CLAIM', message: 'No reward available yet. Complete the challenge and come back tomorrow!' } });
    return;
  }

  const mo = new Date().toISOString().slice(0, 7);
  await execute(
    `UPDATE farms SET water_in_can = water_in_can + $1,
     total_water_this_month = CASE WHEN water_month = $3 THEN total_water_this_month + $1 ELSE $1 END,
     water_month = $3
     WHERE user_id = $2 AND harvested = false`,
    [challenge.reward_amount, userId, mo]
  );

  const todayChallenge = await queryOne(
    `UPDATE daily_challenges SET streak_days = $1
     WHERE user_id = $2 AND challenge_date = $3
     RETURNING streak_days`,
    [(challenge.streak_days || 0) + 1, userId, today]
  );

  await notify(userId, 'gift', 'notif.daily_challenge_done', { reward: challenge.reward_amount });

  res.json({
    success: true,
    data: {
      rewardAmount: challenge.reward_amount,
      streakDays: todayChallenge?.streak_days ?? (challenge.streak_days || 0) + 1,
    },
  });
});
