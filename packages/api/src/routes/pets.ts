import { Router, Request, Response } from 'express';
import { query, queryOne, execute } from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { activityTracker } from '../middleware/activity.js';
import {
  PetId,
  PET_IDS,
  PET_UNLOCK_CONDITIONS,
  PET_BONUSES,
} from '@eco-farm/game-engine';

export const petsRouter = Router();
petsRouter.use(requireAuth);
petsRouter.use(activityTracker);

async function getPetStats(userId: string) {
  const refRow = await queryOne(
    `SELECT COUNT(*)::int AS cnt FROM referrals WHERE inviter_id = $1 AND completed = true`,
    [userId]
  );
  const referralCount = refRow?.cnt ?? 0;

  const questRow = await queryOne(
    `SELECT COUNT(*)::int AS cnt FROM quest_completions WHERE user_id = $1`,
    [userId]
  );
  const totalQuestsCompleted = questRow?.cnt ?? 0;

  return { referralCount, totalQuestsCompleted };
}

function isPetUnlocked(petId: PetId, stats: { referralCount: number; totalQuestsCompleted: number }): boolean {
  const cond = PET_UNLOCK_CONDITIONS[petId];
  switch (cond.type) {
    case 'free':
      return true;
    case 'referrals':
      return stats.referralCount >= cond.required;
    case 'quests':
      return stats.totalQuestsCompleted >= cond.required;
    default:
      return false;
  }
}

petsRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const userPets = await query(
    `SELECT pet_id, is_active, last_gift_at FROM user_pets WHERE user_id = $1`,
    [userId]
  );

  const petMap = new Map(userPets.map((p: any) => [p.pet_id, p]));
  const stats = await getPetStats(userId);

  let activePet: string | null = null;
  for (const up of userPets) {
    if ((up as any).is_active) {
      activePet = (up as any).pet_id;
      break;
    }
  }

  const pets = PET_IDS.map((id) => {
    const userPet = petMap.get(id);
    const unlocked = isPetUnlocked(id, stats);
    const cond = PET_UNLOCK_CONDITIONS[id];
    let unlock_progress: { current: number; required: number } | undefined;
    if (!unlocked) {
      if (cond.type === 'referrals') {
        unlock_progress = { current: stats.referralCount, required: cond.required };
      } else if (cond.type === 'quests') {
        unlock_progress = { current: stats.totalQuestsCompleted, required: cond.required };
      }
    }
    return {
      id,
      is_active: userPet?.is_active ?? (id === 'hamster' && !activePet),
      unlocked,
      last_gift_at: id === 'hamster' ? (userPet?.last_gift_at ?? null) : null,
      unlock_progress,
    };
  });

  res.json({ success: true, data: { pets } });
});

petsRouter.post('/:id/activate', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const petId = req.params.id as PetId;

  if (!(PET_IDS as readonly string[]).includes(petId)) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pet not found' } });
    return;
  }

  const stats = await getPetStats(userId);
  if (!isPetUnlocked(petId, stats)) {
    res.status(400).json({ success: false, error: { code: 'LOCKED', message: 'Pet is locked' } });
    return;
  }

  await execute(`UPDATE user_pets SET is_active = false WHERE user_id = $1`, [userId]);

  const existing = await queryOne(
    `SELECT id FROM user_pets WHERE user_id = $1 AND pet_id = $2`,
    [userId, petId]
  );

  if (existing) {
    await execute(`UPDATE user_pets SET is_active = true WHERE id = $1`, [existing.id]);
  } else {
    await execute(
      `INSERT INTO user_pets (user_id, pet_id, is_active) VALUES ($1, $2, true)`,
      [userId, petId]
    );
  }

  res.json({ success: true, data: { activePetId: petId } });
});

petsRouter.post('/:id/gift', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const petId = req.params.id;

  if (petId !== 'hamster') {
    res.status(400).json({ success: false, error: { code: 'INVALID', message: 'Gift only available for hamster' } });
    return;
  }

  const giftAmount = PET_BONUSES.hamster.giftAmount!;
  const cooldownInterval = `${Math.floor(PET_BONUSES.hamster.giftCooldownMs! / 1000)} seconds`;

  const farm = await queryOne(
    `SELECT id FROM farms WHERE user_id = $1 AND harvested = false`,
    [userId]
  );

  if (!farm) {
    res.status(400).json({ success: false, error: { code: 'NO_FARM', message: 'Start a farm first to claim gifts' } });
    return;
  }

  // H-7: atomically ensure-and-claim. Race-safe because we either
  //  (a) insert the row and commit the gift for the very first time, or
  //  (b) bump last_gift_at only when the cooldown has elapsed (by updated > 0).
  // When neither succeeds, the request is on cooldown.
  const updated = await execute(
    `INSERT INTO user_pets (user_id, pet_id, is_active, last_gift_at)
     VALUES ($1, 'hamster', true, NOW())
     ON CONFLICT (user_id, pet_id) DO UPDATE
       SET last_gift_at = NOW()
       WHERE user_pets.last_gift_at IS NULL
          OR user_pets.last_gift_at < NOW() - $2::interval`,
    [userId, cooldownInterval]
  );

  if (updated === 0) {
    res.status(400).json({ success: false, error: { code: 'COOLDOWN', message: 'Gift on cooldown' } });
    return;
  }

  const mo = new Date().toISOString().slice(0, 7);
  await execute(
    `UPDATE farms SET water_in_can = water_in_can + $1,
     total_water_this_month = CASE WHEN water_month = $3 THEN total_water_this_month + $1 ELSE $1 END,
     water_month = $3
     WHERE id = $2`,
    [giftAmount, farm.id, mo]
  );

  res.json({ success: true, data: { waterEarned: giftAmount } });
});
