import { Router, Request, Response } from 'express';
import { query, queryOne, execute } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { notify } from '../lib/notify.js';

export const gamesRouter = Router();
gamesRouter.use(requireAuth);

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

gamesRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const today = todayStr();

  const games = await query(`SELECT * FROM games WHERE active = true`);

  const completions = await query(
    `SELECT game_id, count FROM game_completions
     WHERE user_id = $1 AND completion_date = $2`,
    [userId, today]
  );

  const claimedSet = new Set(completions.map((c: any) => c.game_id));

  const gamesWithStatus = games.map((g: any) => ({
    ...g,
    claimed: claimedSet.has(g.id),
  }));

  res.json({ success: true, data: { games: gamesWithStatus } });
});

gamesRouter.post('/:id/claim', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const gameId = req.params.id;
  const today = todayStr();

  const game = await queryOne(`SELECT * FROM games WHERE id = $1`, [gameId]);

  if (!game) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Game not found' } });
    return;
  }

  const existing = await queryOne(
    `SELECT id FROM game_completions WHERE user_id = $1 AND game_id = $2 AND completion_date = $3`,
    [userId, gameId, today]
  );

  if (existing) {
    res.status(400).json({ success: false, error: { code: 'ALREADY_CLAIMED', message: 'Already claimed today' } });
    return;
  }

  await execute(
    `INSERT INTO game_completions (user_id, game_id, completion_date, count) VALUES ($1, $2, $3, 1)`,
    [userId, gameId, today]
  );

  if (game.reward_type === 'water') {
    await execute(
      `UPDATE farms SET water_in_can = water_in_can + $1 WHERE user_id = $2 AND harvested = false`,
      [game.reward_amount, userId]
    );
  } else if (game.reward_type === 'nutrition') {
    await execute(
      `UPDATE farms SET nutrition = nutrition + $1 WHERE user_id = $2 AND harvested = false`,
      [game.reward_amount, userId]
    );
  }

  await notify(userId, 'game', 'notif.game_reward', {
    reward: game.reward_amount,
    unit: game.reward_type === 'water' ? 'water' : 'nutrition',
  });

  res.json({
    success: true,
    data: { rewardType: game.reward_type, rewardAmount: game.reward_amount },
  });
});
