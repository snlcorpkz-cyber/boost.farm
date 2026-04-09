import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, queryOne, execute } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getCurrentPhase,
  QUEST_LIMITS,
  FRIEND_WATERING_COST,
  getRankForWater,
  REFERRAL_REWARDS,
} from '@eco-farm/game-engine';

export const friendsRouter = Router();
friendsRouter.use(requireAuth);

async function getUserRank(userId: string) {
  const farm = await queryOne(
    `SELECT total_water_last_month FROM farms WHERE user_id = $1 AND harvested = false`,
    [userId]
  );
  return getRankForWater(farm?.total_water_last_month ?? 0);
}

friendsRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const friendLinks = await query(
    `SELECT f.friend_id, f.created_at, u.id, u.nickname, u.avatar_id
     FROM friends f JOIN users u ON f.friend_id = u.id
     WHERE f.user_id = $1`,
    [userId]
  );

  if (!friendLinks.length) {
    res.json({ success: true, data: { friends: [] } });
    return;
  }

  const friendIds = friendLinks.map((f: any) => f.friend_id);

  const farms = await query(
    `SELECT fa.user_id, fa.growth_percent, fa.current_stage, fa.product_id, p.name_key
     FROM farms fa JOIN products p ON fa.product_id = p.id
     WHERE fa.user_id = ANY($1) AND fa.harvested = false`,
    [friendIds]
  );

  const farmsByUser = new Map(farms.map((f: any) => [f.user_id, {
    growth_percent: f.growth_percent,
    current_stage: f.current_stage,
    product_id: f.product_id,
    products: { name_key: f.name_key },
  }]));

  const friends = friendLinks.map((f: any) => ({
    id: f.friend_id,
    nickname: f.nickname,
    avatarId: f.avatar_id,
    avatar_id: f.avatar_id,
    farm: farmsByUser.get(f.friend_id) || null,
    addedAt: f.created_at,
  }));

  res.json({ success: true, data: { friends } });
});

friendsRouter.post('/add', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { code } = z.object({ code: z.string() }).parse(req.body);

  const referral = await queryOne(
    `SELECT inviter_id FROM referrals WHERE invite_code = $1`,
    [code]
  );

  if (!referral) {
    res.status(404).json({ success: false, error: { code: 'INVALID_CODE', message: 'Invalid friend code' } });
    return;
  }

  if (referral.inviter_id === userId) {
    res.status(400).json({ success: false, error: { code: 'SELF_ADD', message: 'Cannot add yourself' } });
    return;
  }

  try {
    await execute(
      `INSERT INTO friends (user_id, friend_id) VALUES ($1, $2), ($3, $4)`,
      [userId, referral.inviter_id, referral.inviter_id, userId]
    );
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(400).json({ success: false, error: { code: 'ALREADY_FRIENDS', message: 'Already friends' } });
      return;
    }
    throw err;
  }

  const fertReward = REFERRAL_REWARDS.NUTRITION;

  await execute(
    `UPDATE farms SET nutrition = nutrition + $1 WHERE user_id = $2 AND harvested = false`,
    [fertReward, userId]
  );
  await execute(
    `UPDATE farms SET nutrition = nutrition + $1 WHERE user_id = $2 AND harvested = false`,
    [fertReward, referral.inviter_id]
  );

  res.json({ success: true, data: { friendId: referral.inviter_id, fertReward } });
});

friendsRouter.delete('/:id', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const friendId = req.params.id;

  await execute(`DELETE FROM friends WHERE user_id = $1 AND friend_id = $2`, [userId, friendId]);
  await execute(`DELETE FROM friends WHERE user_id = $1 AND friend_id = $2`, [friendId, userId]);

  res.json({ success: true });
});

friendsRouter.post('/:id/greet', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const friendId = req.params.id;
  const tzOffset = parseInt(req.headers['x-timezone-offset'] as string) || 0;

  const localHour = (new Date().getUTCHours() - tzOffset / 60 + 24) % 24;
  const phase = getCurrentPhase(localHour);
  const today = new Date().toISOString().split('T')[0];

  const actions = await query(
    `SELECT id FROM friend_actions
     WHERE actor_id = $1 AND action_type = 'greet' AND phase = $2 AND action_date = $3`,
    [userId, phase, today]
  );

  if (actions.length >= QUEST_LIMITS.GREET_PER_PHASE) {
    res.status(400).json({ success: false, error: { code: 'LIMIT_REACHED', message: 'Greeting limit reached for this phase' } });
    return;
  }

  const alreadyGreeted = await queryOne(
    `SELECT id FROM friend_actions
     WHERE actor_id = $1 AND target_id = $2 AND action_type = 'greet' AND phase = $3 AND action_date = $4`,
    [userId, friendId, phase, today]
  );

  if (alreadyGreeted) {
    res.status(400).json({ success: false, error: { code: 'ALREADY_GREETED', message: 'Already greeted this friend in this phase' } });
    return;
  }

  await execute(
    `INSERT INTO friend_actions (actor_id, target_id, action_type, phase, action_date)
     VALUES ($1, $2, 'greet', $3, $4)`,
    [userId, friendId, phase, today]
  );

  const rank = await getUserRank(userId);
  const waterReward = rank.greetWater;

  await execute(
    `UPDATE farms SET water_in_can = water_in_can + $1 WHERE user_id = $2 AND harvested = false`,
    [waterReward, userId]
  );

  await execute(
    `INSERT INTO notifications (user_id, type, payload) VALUES ($1, 'greet', $2)`,
    [friendId, JSON.stringify({ from_user_id: userId })]
  );

  res.json({ success: true, data: { waterEarned: waterReward } });
});

friendsRouter.post('/:id/water', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const friendId = req.params.id;
  const tzOffset = parseInt(req.headers['x-timezone-offset'] as string) || 0;

  const localHour = (new Date().getUTCHours() - tzOffset / 60 + 24) % 24;
  const phase = getCurrentPhase(localHour);
  const today = new Date().toISOString().split('T')[0];

  const actions = await query(
    `SELECT id FROM friend_actions
     WHERE actor_id = $1 AND action_type = 'water' AND phase = $2 AND action_date = $3`,
    [userId, phase, today]
  );

  if (actions.length >= QUEST_LIMITS.WATER_FRIEND_PER_PHASE) {
    res.status(400).json({ success: false, error: { code: 'LIMIT_REACHED', message: 'Water friend limit reached' } });
    return;
  }

  const myFarm = await queryOne(
    `SELECT id, water_in_can, nutrition, total_water_last_month FROM farms
     WHERE user_id = $1 AND harvested = false`,
    [userId]
  );

  if (!myFarm || myFarm.water_in_can < FRIEND_WATERING_COST) {
    res.status(400).json({ success: false, error: { code: 'NOT_ENOUGH_WATER', message: 'Not enough water' } });
    return;
  }

  const rank = getRankForWater(myFarm.total_water_last_month ?? 0);
  const fertReward = rank.waterFriendFert;

  await execute(
    `INSERT INTO friend_actions (actor_id, target_id, action_type, phase, action_date)
     VALUES ($1, $2, 'water', $3, $4)`,
    [userId, friendId, phase, today]
  );

  await execute(
    `UPDATE farms SET water_in_can = water_in_can - $1, nutrition = nutrition + $2 WHERE id = $3`,
    [FRIEND_WATERING_COST, fertReward, myFarm.id]
  );

  await execute(
    `UPDATE farms SET growth_percent = LEAST(100, growth_percent + 0.05)
     WHERE user_id = $1 AND harvested = false`,
    [friendId]
  );

  await execute(
    `INSERT INTO notifications (user_id, type, payload) VALUES ($1, 'friend_water', $2)`,
    [friendId, JSON.stringify({ from_user_id: userId })]
  );

  res.json({
    success: true,
    data: { waterSpent: FRIEND_WATERING_COST, nutritionEarned: fertReward },
  });
});

friendsRouter.get('/invite-code', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  let referral = await queryOne(
    `SELECT invite_code FROM referrals WHERE inviter_id = $1`,
    [userId]
  );

  if (!referral) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    referral = await queryOne(
      `INSERT INTO referrals (inviter_id, invite_code) VALUES ($1, $2) RETURNING invite_code`,
      [userId, code]
    );
  }

  const link = `${process.env.CLIENT_URL || 'http://localhost:5173'}/?ref=${referral!.invite_code}`;
  res.json({ success: true, data: { code: referral!.invite_code, link } });
});
