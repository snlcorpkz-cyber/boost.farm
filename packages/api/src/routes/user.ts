import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';

export const userRouter = Router();
userRouter.use(requireAuth);

const updateProfileSchema = z.object({
  nickname: z.string().min(2).max(20).optional(),
  avatarId: z.string().optional(),
  locale: z.enum(['en', 'ru', 'es']).optional(),
});

userRouter.get('/profile', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (!user) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found' } });
    return;
  }

  res.json({ success: true, data: { user } });
});

userRouter.patch('/profile', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const updates = updateProfileSchema.parse(req.body);
  const dbUpdates: Record<string, any> = {};
  if (updates.nickname) dbUpdates.nickname = updates.nickname;
  if (updates.avatarId) dbUpdates.avatar_id = updates.avatarId;
  if (updates.locale) dbUpdates.locale = updates.locale;

  const { data: user } = await supabase
    .from('users')
    .update(dbUpdates)
    .eq('id', userId)
    .select()
    .single();

  res.json({ success: true, data: { user } });
});

userRouter.get('/notifications', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const { data: notifications } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  res.json({ success: true, data: { notifications: notifications || [] } });
});

userRouter.delete('/account', async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  await supabase.from('farms').delete().eq('user_id', userId);
  await supabase.from('friends').delete().eq('user_id', userId);
  await supabase.from('friends').delete().eq('friend_id', userId);
  await supabase.from('users').delete().eq('id', userId);

  res.json({ success: true, data: { message: 'Account deleted' } });
});
