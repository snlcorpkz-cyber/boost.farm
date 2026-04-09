import { Router, Request, Response } from 'express';
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

questsRouter.post('/:id/complete', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const questId = req.params.id;
  const tzOffset = parseInt(req.headers['x-timezone-offset'] as string) || 0;
  const localHour = (new Date().getUTCHours() - tzOffset / 60 + 24) % 24;
  const phase = getCurrentPhase(localHour);
  const today = todayStr();

  const quest = await queryOne(`SELECT * FROM quests WHERE id = $1`, [questId]);

  if (!quest) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Quest not found' } });
    return;
  }

  const existing = await queryOne(
    `SELECT * FROM quest_completions
     WHERE user_id = $1 AND quest_id = $2 AND phase = $3 AND completion_date = $4`,
    [userId, questId, phase, today]
  );

  if (existing && existing.count >= quest.limit_per_phase) {
    res.status(400).json({ success: false, error: { code: 'LIMIT_REACHED', message: 'Quest limit reached' } });
    return;
  }

  if (existing) {
    await execute(
      `UPDATE quest_completions SET count = count + 1 WHERE id = $1`,
      [existing.id]
    );
  } else {
    await execute(
      `INSERT INTO quest_completions (user_id, quest_id, phase, completion_date, count)
       VALUES ($1, $2, $3, $4, 1)`,
      [userId, questId, phase, today]
    );
  }

  const farm = await queryOne(
    `SELECT id, water_in_can, nutrition FROM farms WHERE user_id = $1 AND harvested = false`,
    [userId]
  );

  if (farm) {
    if (quest.reward_type === 'water') {
      await execute(
        `UPDATE farms SET water_in_can = water_in_can + $1 WHERE id = $2`,
        [quest.reward_amount, farm.id]
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

questsRouter.get('/daily-challenge', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const today = todayStr();
  const rank = await getUserRank(userId);

  let challenge = await queryOne(
    `SELECT * FROM daily_challenges WHERE user_id = $1 AND challenge_date = $2`,
    [userId, today]
  );

  if (!challenge) {
    challenge = await queryOne(
      `INSERT INTO daily_challenges (user_id, challenge_date, water_given, required, completed, reward_claimed, reward_amount)
       VALUES ($1, $2, 0, $3, false, false, $4) RETURNING *`,
      [userId, today, rank.dailyChallengeWaterReq, rank.dailyChallengeReward]
    );
  }

  res.json({
    success: true,
    data: {
      waterGiven: challenge!.water_given,
      required: challenge!.required,
      completed: challenge!.completed,
      rewardClaimed: challenge!.reward_claimed,
      reward: challenge!.reward_amount,
      progress: Math.min(1, challenge!.water_given / challenge!.required),
    },
  });
});

questsRouter.post('/daily-challenge/claim', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const today = todayStr();
  const rank = await getUserRank(userId);

  const challenge = await queryOne(
    `SELECT * FROM daily_challenges WHERE user_id = $1 AND challenge_date = $2`,
    [userId, today]
  );

  if (!challenge || !challenge.completed || challenge.reward_claimed) {
    res.status(400).json({ success: false, error: { code: 'CANNOT_CLAIM', message: 'Cannot claim reward' } });
    return;
  }

  await execute(
    `UPDATE daily_challenges SET reward_claimed = true WHERE id = $1`,
    [challenge.id]
  );

  await execute(
    `UPDATE farms SET water_in_can = water_in_can + $1 WHERE user_id = $2 AND harvested = false`,
    [rank.dailyChallengeReward, userId]
  );

  await notify(userId, 'gift', 'notif.daily_challenge_done', { reward: rank.dailyChallengeReward });

  res.json({
    success: true,
    data: { rewardAmount: rank.dailyChallengeReward },
  });
});
