import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getCurrentPhase,
  QUEST_LIMITS,
  FRIEND_WATERING_COST,
  FRIEND_WATERING_NUTRITION_REWARD,
  GREETING_WATER_REWARD,
} from '@eco-farm/game-engine';

export const friendsRouter = Router();
friendsRouter.use(requireAuth);

friendsRouter.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const { data: friendLinks } = await supabase
    .from('friends')
    .select('friend_id, created_at, users!friends_friend_id_fkey(id, nickname, avatar_id)')
    .eq('user_id', userId);

  if (!friendLinks || friendLinks.length === 0) {
    res.json({ success: true, data: { friends: [] } });
    return;
  }

  const friendIds = friendLinks.map((f: any) => f.friend_id);

  const { data: farms } = await supabase
    .from('farms')
    .select('user_id, growth_percent, current_stage, product_id, products(name_key)')
    .in('user_id', friendIds)
    .eq('harvested', false);

  const farmsByUser = new Map((farms || []).map((f: any) => [f.user_id, f]));

  const friends = friendLinks.map((f: any) => ({
    id: f.friend_id,
    nickname: f.users?.nickname,
    avatarId: f.users?.avatar_id,
    farm: farmsByUser.get(f.friend_id) || null,
    addedAt: f.created_at,
  }));

  res.json({ success: true, data: { friends } });
});

friendsRouter.post('/add', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { code } = z.object({ code: z.string() }).parse(req.body);

  const { data: referral } = await supabase
    .from('referrals')
    .select('inviter_id')
    .eq('invite_code', code)
    .single();

  if (!referral) {
    res.status(404).json({ success: false, error: { code: 'INVALID_CODE', message: 'Invalid friend code' } });
    return;
  }

  if (referral.inviter_id === userId) {
    res.status(400).json({ success: false, error: { code: 'SELF_ADD', message: 'Cannot add yourself' } });
    return;
  }

  const { error: insertError } = await supabase.from('friends').insert([
    { user_id: userId, friend_id: referral.inviter_id },
    { user_id: referral.inviter_id, friend_id: userId },
  ]);

  if (insertError?.code === '23505') {
    res.status(400).json({ success: false, error: { code: 'ALREADY_FRIENDS', message: 'Already friends' } });
    return;
  }

  res.json({ success: true, data: { friendId: referral.inviter_id } });
});

friendsRouter.delete('/:id', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const friendId = req.params.id;

  await supabase.from('friends').delete().eq('user_id', userId).eq('friend_id', friendId);
  await supabase.from('friends').delete().eq('user_id', friendId).eq('friend_id', userId);

  res.json({ success: true });
});

friendsRouter.post('/:id/greet', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const friendId = req.params.id;
  const tzOffset = parseInt(req.headers['x-timezone-offset'] as string) || 0;

  const localHour = (new Date().getUTCHours() - tzOffset / 60 + 24) % 24;
  const phase = getCurrentPhase(localHour);
  const today = new Date().toISOString().split('T')[0];

  const { data: actions } = await supabase
    .from('friend_actions')
    .select('id')
    .eq('actor_id', userId)
    .eq('action_type', 'greet')
    .eq('phase', phase)
    .eq('action_date', today);

  if ((actions?.length || 0) >= QUEST_LIMITS.GREET_PER_PHASE) {
    res.status(400).json({ success: false, error: { code: 'LIMIT_REACHED', message: 'Greeting limit reached for this phase' } });
    return;
  }

  const { data: alreadyGreeted } = await supabase
    .from('friend_actions')
    .select('id')
    .eq('actor_id', userId)
    .eq('target_id', friendId)
    .eq('action_type', 'greet')
    .eq('phase', phase)
    .eq('action_date', today)
    .single();

  if (alreadyGreeted) {
    res.status(400).json({ success: false, error: { code: 'ALREADY_GREETED', message: 'Already greeted this friend in this phase' } });
    return;
  }

  await supabase.from('friend_actions').insert({
    actor_id: userId,
    target_id: friendId,
    action_type: 'greet',
    phase,
    action_date: today,
  });

  const { data: farm } = await supabase
    .from('farms')
    .select('id, water_in_can')
    .eq('user_id', userId)
    .eq('harvested', false)
    .single();

  if (farm) {
    await supabase
      .from('farms')
      .update({ water_in_can: farm.water_in_can + GREETING_WATER_REWARD })
      .eq('id', farm.id);
  }

  await supabase.from('notifications').insert({
    user_id: friendId,
    type: 'greet',
    payload: { from_user_id: userId },
  });

  res.json({ success: true, data: { waterEarned: GREETING_WATER_REWARD } });
});

friendsRouter.post('/:id/water', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const friendId = req.params.id;
  const tzOffset = parseInt(req.headers['x-timezone-offset'] as string) || 0;

  const localHour = (new Date().getUTCHours() - tzOffset / 60 + 24) % 24;
  const phase = getCurrentPhase(localHour);
  const today = new Date().toISOString().split('T')[0];

  const { data: actions } = await supabase
    .from('friend_actions')
    .select('id')
    .eq('actor_id', userId)
    .eq('action_type', 'water')
    .eq('phase', phase)
    .eq('action_date', today);

  if ((actions?.length || 0) >= QUEST_LIMITS.WATER_FRIEND_PER_PHASE) {
    res.status(400).json({ success: false, error: { code: 'LIMIT_REACHED', message: 'Water friend limit reached' } });
    return;
  }

  const { data: myFarm } = await supabase
    .from('farms')
    .select('id, water_in_can, nutrition')
    .eq('user_id', userId)
    .eq('harvested', false)
    .single();

  if (!myFarm || myFarm.water_in_can < FRIEND_WATERING_COST) {
    res.status(400).json({ success: false, error: { code: 'NOT_ENOUGH_WATER', message: 'Not enough water' } });
    return;
  }

  await supabase.from('friend_actions').insert({
    actor_id: userId,
    target_id: friendId,
    action_type: 'water',
    phase,
    action_date: today,
  });

  await supabase
    .from('farms')
    .update({
      water_in_can: myFarm.water_in_can - FRIEND_WATERING_COST,
      nutrition: myFarm.nutrition + FRIEND_WATERING_NUTRITION_REWARD,
    })
    .eq('id', myFarm.id);

  const { data: friendFarm } = await supabase
    .from('farms')
    .select('id, growth_percent, current_stage')
    .eq('user_id', friendId)
    .eq('harvested', false)
    .single();

  if (friendFarm) {
    const smallGrowth = 0.05;
    await supabase
      .from('farms')
      .update({ growth_percent: Math.min(100, friendFarm.growth_percent + smallGrowth) })
      .eq('id', friendFarm.id);
  }

  await supabase.from('notifications').insert({
    user_id: friendId,
    type: 'friend_water',
    payload: { from_user_id: userId },
  });

  res.json({
    success: true,
    data: {
      waterSpent: FRIEND_WATERING_COST,
      nutritionEarned: FRIEND_WATERING_NUTRITION_REWARD,
    },
  });
});

friendsRouter.get('/invite-code', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  let { data: referral } = await supabase
    .from('referrals')
    .select('invite_code')
    .eq('inviter_id', userId)
    .single();

  if (!referral) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { data: newRef } = await supabase
      .from('referrals')
      .insert({ inviter_id: userId, invite_code: code })
      .select()
      .single();
    referral = newRef;
  }

  res.json({ success: true, data: { inviteCode: referral!.invite_code } });
});
