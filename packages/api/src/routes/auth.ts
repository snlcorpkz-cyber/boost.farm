import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { signAccessToken, signRefreshToken } from '../lib/jwt.js';

export const authRouter = Router();

const sendCodeSchema = z.object({
  email: z.string().email(),
});

const verifyCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});

const googleAuthSchema = z.object({
  idToken: z.string(),
});

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

authRouter.post('/send-code', async (req: Request, res: Response) => {
  try {
    const { email } = sendCodeSchema.parse(req.body);
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await supabase.from('auth_codes').insert({
      email,
      code,
      expires_at: expiresAt.toISOString(),
    });

    // TODO: Send email with code via nodemailer
    console.log(`[Auth] Code for ${email}: ${code}`);

    res.json({ success: true, data: { message: 'Code sent' } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION', message: err.message } });
      return;
    }
    throw err;
  }
});

authRouter.post('/verify-code', async (req: Request, res: Response) => {
  try {
    const { email, code } = verifyCodeSchema.parse(req.body);

    const { data: authCode } = await supabase
      .from('auth_codes')
      .select('*')
      .eq('email', email)
      .eq('code', code)
      .eq('used', false)
      .gte('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!authCode) {
      res.status(400).json({ success: false, error: { code: 'INVALID_CODE', message: 'Invalid or expired code' } });
      return;
    }

    await supabase
      .from('auth_codes')
      .update({ used: true })
      .eq('id', authCode.id);

    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    const isNewUser = !user;

    if (!user) {
      const { data: newUser } = await supabase
        .from('users')
        .insert({ email, nickname: email.split('@')[0], avatar_id: 'cat', locale: 'en' })
        .select()
        .single();
      user = newUser;
    } else {
      await supabase
        .from('users')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', user.id);
    }

    const tokens = {
      accessToken: signAccessToken({ userId: user!.id, email }),
      refreshToken: signRefreshToken({ userId: user!.id, email }),
    };

    res.json({ success: true, data: { ...tokens, user, isNewUser } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION', message: err.message } });
      return;
    }
    throw err;
  }
});

authRouter.post('/google', async (req: Request, res: Response) => {
  try {
    const { idToken } = googleAuthSchema.parse(req.body);

    // TODO: Verify Google ID token properly with google-auth-library
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
    const email = payload.email;

    if (!email) {
      res.status(400).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'No email in token' } });
      return;
    }

    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    const isNewUser = !user;

    if (!user) {
      const { data: newUser } = await supabase
        .from('users')
        .insert({
          email,
          nickname: payload.name || email.split('@')[0],
          avatar_id: 'cat',
          locale: 'en',
        })
        .select()
        .single();
      user = newUser;
    }

    const tokens = {
      accessToken: signAccessToken({ userId: user!.id, email }),
      refreshToken: signRefreshToken({ userId: user!.id, email }),
    };

    res.json({ success: true, data: { ...tokens, user, isNewUser } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION', message: err.message } });
      return;
    }
    throw err;
  }
});
