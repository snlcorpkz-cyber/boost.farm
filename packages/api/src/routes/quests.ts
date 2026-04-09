import { Router, Request, Response } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { getCurrentPhase, DAILY_CHALLENGE_THRESHOLD } from '@eco-farm/game-engine';

export const questsRouter = Router();
questsRouter.use(requireAuth);

questsRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const tzOffset = parseInt(req.headers['x-timezone-offset'] as string) || 0;
  const localHour = (new Date().getUTCHours() - tzOffset / 60 + 24) % 24;
  const phase = getCurrentPhase(localHour);
  const today = new Date().toISOString().split('T')[0];

  const { data: quests } = await supabase
    .from('quests')
    .select('*')
    .eq('active', true);

  const { data: completions } = await supabase
    .from('quest_completions')
    .select('*')
    .eq('user_id', userId)
    .eq('completion_date', today)
    .eq('phase', phase);

  const completionMap = new Map(
    (completions || []).map((c: any) => [c.quest_id, c.count])
  );

  const questsWithProgress = (quests || []).map((q: any) => ({
    ...q,
    completedCount: completionMap.get(q.id) || 0,
    isCompleted: (completionMap.get(q.id) || 0) >= q.limit_per_phase,
  }));

  res.json({ success: true, data: { quests: questsWithProgress, phase } });
});

questsRouter.post('/:id/complete', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const questId = req.params.id;
  const tzOffset = parseInt(req.headers['x-timezone-offset'] as string) || 0;
  const localHour = (new Date().getUTCHours() - tzOffset / 60 + 24) % 24;
  const phase = getCurrentPhase(localHour);
  const today = new Date().toISOString().split('T')[0];

  const { data: quest } = await supabase
    .from('quests')
    .select('*')
    .eq('id', questId)
    .single();

  if (!quest) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Quest not found' } });
    return;
  }

  const { data: existing } = await supabase
    .from('quest_completions')
    .select('*')
    .eq('user_id', userId)
    .eq('quest_id', questId)
    .eq('phase', phase)
    .eq('completion_date', today)
    .single();

  if (existing && existing.count >= quest.limit_per_phase) {
    res.status(400).json({ success: false, error: { code: 'LIMIT_REACHED', message: 'Quest limit reached' } });
    return;
  }

  if (existing) {
    await supabase
      .from('quest_completions')
      .update({ count: existing.count + 1 })
      .eq('id', existing.id);
  } else {
    await supabase.from('quest_completions').insert({
      user_id: userId,
      quest_id: questId,
      phase,
      completion_date: today,
      count: 1,
    });
  }

  const { data: farm } = await supabase
    .from('farms')
    .select('id, water_in_can, nutrition')
    .eq('user_id', userId)
    .eq('harvested', false)
    .single();

  if (farm) {
    if (quest.reward_type === 'water') {
      await supabase
        .from('farms')
        .update({ water_in_can: farm.water_in_can + quest.reward_amount })
        .eq('id', farm.id);
    } else if (quest.reward_type === 'nutrition') {
      await supabase
        .from('farms')
        .update({ nutrition: farm.nutrition + quest.reward_amount })
        .eq('id', farm.id);
    }
  }

  res.json({
    success: true,
    data: { rewardType: quest.reward_type, rewardAmount: quest.reward_amount },
  });
});

questsRouter.get('/daily-challenge', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const { data: farm } = await supabase
    .from('farms')
    .select('total_waterings_today')
    .eq('user_id', userId)
    .eq('harvested', false)
    .single();

  const waterings = farm?.total_waterings_today || 0;
  const completed = waterings >= DAILY_CHALLENGE_THRESHOLD;

  res.json({
    success: true,
    data: {
      currentWaterings: waterings,
      required: DAILY_CHALLENGE_THRESHOLD,
      completed,
      progress: Math.min(1, waterings / DAILY_CHALLENGE_THRESHOLD),
    },
  });
});
