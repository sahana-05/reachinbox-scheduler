import { Response, Router } from 'express';
import bcrypt from 'bcryptjs';
import { google } from 'googleapis';
import { prisma } from '../db/prisma';
import { config } from '../config';
import { issueToken } from '../auth/token';
import { requireAuth } from '../middleware/auth';
import { ensureUserSenders } from '../services/senders';

export const authRouter = Router();

const oauthClient = new google.auth.OAuth2(config.googleClientId, config.googleClientSecret, config.googleCallbackUrl);
const cookieOptions = {
  httpOnly: true,
  secure: config.nodeEnv === 'production',
  sameSite: (config.nodeEnv === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

function setSession(res: Response, userId: string): string {
  const token = issueToken(userId);
  res.cookie('token', token, cookieOptions);
  return token;
}

authRouter.get('/google', (_req, res) => {
  if (!config.googleClientId || !config.googleClientSecret) {
    res.status(503).json({ error: 'Google OAuth is not configured' });
    return;
  }
  res.redirect(oauthClient.generateAuthUrl({ access_type: 'offline', scope: ['openid', 'email', 'profile'], prompt: 'select_account' }));
});

authRouter.get('/google/callback', async (req, res, next) => {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : undefined;
    if (!code) {
      res.status(400).json({ error: 'Missing OAuth code' });
      return;
    }
    const { tokens } = await oauthClient.getToken(code);
    oauthClient.setCredentials(tokens);
    const ticket = await oauthClient.verifyIdToken({ idToken: tokens.id_token ?? '', audience: config.googleClientId });
    const profile = ticket.getPayload();
    if (!profile?.sub || !profile.email || !profile.email_verified) throw new Error('Google did not return a verified email');
    const user = await prisma.user.upsert({
      where: { email: profile.email.toLowerCase() },
      create: { email: profile.email.toLowerCase(), name: profile.name ?? profile.email, avatarUrl: profile.picture, googleId: profile.sub },
      update: { googleId: profile.sub, name: profile.name ?? undefined, avatarUrl: profile.picture ?? undefined },
    });
    await ensureUserSenders(user);
    setSession(res, user.id);
    res.redirect(`${config.frontendUrl}/dashboard`);
  } catch (error) {
    next(error);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : email.split('@')[0];
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || password.length > 200) {
      res.status(400).json({ error: 'A valid email and password of at least 8 characters are required' });
      return;
    }
    let user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      if (!user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }
    } else {
      user = await prisma.user.create({ data: { email, name, passwordHash: await bcrypt.hash(password, 12) } });
    }
    await ensureUserSenders(user);
    const token = setSession(res, user.id);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl } });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, email: true, name: true, avatarUrl: true, slackChannel: true, slackTeamName: true } });
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie('token', { ...cookieOptions, maxAge: undefined });
  res.status(204).end();
});

