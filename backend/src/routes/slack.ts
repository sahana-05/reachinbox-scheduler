import { Router } from 'express';
import { prisma } from '../db/prisma';
import { config } from '../config';
import { signSlackState, verifySlackState } from '../auth/token';
import { requireAuth } from '../middleware/auth';

export const slackRouter = Router();

slackRouter.get('/connect', requireAuth, (req, res) => {
  if (!config.slackClientId || !config.slackClientSecret) {
    res.status(503).json({ error: 'Slack OAuth is not configured' });
    return;
  }
  const params = new URLSearchParams({
    client_id: config.slackClientId,
    scope: 'incoming-webhook,chat:write',
    redirect_uri: config.slackRedirectUri,
    state: signSlackState(req.userId!),
  });
  res.redirect(`https://slack.com/oauth/v2/authorize?${params.toString()}`);
});

slackRouter.get('/callback', async (req, res, next) => {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !state) {
      res.status(400).json({ error: 'Missing OAuth code or state' });
      return;
    }
    const userId = verifySlackState(state);
    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.slackClientId, client_secret: config.slackClientSecret, code, redirect_uri: config.slackRedirectUri }),
    });
    const payload = await response.json() as {
      ok?: boolean;
      error?: string;
      access_token?: string;
      incoming_webhook?: { url?: string; channel?: string };
      team?: { name?: string };
    };
    if (!response.ok || !payload.ok || !payload.access_token) throw new Error(payload.error ?? 'Slack authorization failed');
    await prisma.user.update({
      where: { id: userId },
      data: {
        slackAccessToken: payload.access_token,
        slackWebhookUrl: payload.incoming_webhook?.url ?? null,
        slackChannel: payload.incoming_webhook?.channel ?? null,
        slackTeamName: payload.team?.name ?? null,
      },
    });
    res.redirect(`${config.frontendUrl}/dashboard?slack=connected`);
  } catch (error) {
    next(error);
  }
});

slackRouter.post('/test-webhook', requireAuth, async (req, res, next) => {
  try {
    const webhookUrl = typeof req.body?.webhookUrl === 'string' ? req.body.webhookUrl.trim() : '';
    if (webhookUrl) {
      let parsed: URL;
      try {
        parsed = new URL(webhookUrl);
      } catch {
        res.status(400).json({ error: 'A valid Slack webhook URL is required' });
        return;
      }
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'hooks.slack.com') {
        res.status(400).json({ error: 'Webhook URL must use the hooks.slack.com HTTPS host' });
        return;
      }
      await prisma.user.update({ where: { id: req.userId }, data: { slackWebhookUrl: webhookUrl } });
    }
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { slackWebhookUrl: true, slackAccessToken: true, slackChannel: true } });
    if (!user?.slackWebhookUrl && !(user?.slackAccessToken && user.slackChannel)) {
      res.status(400).json({ error: 'Connect Slack or provide an incoming webhook URL' });
      return;
    }
    if (user.slackWebhookUrl) {
      const response = await fetch(user.slackWebhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'ReachInbox Slack integration test' }) });
      if (!response.ok) throw new Error(`Slack webhook returned HTTP ${response.status}`);
    } else {
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { authorization: `Bearer ${user.slackAccessToken}`, 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ channel: user.slackChannel, text: 'ReachInbox Slack integration test' }),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error ?? 'Slack test message failed');
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

slackRouter.post('/disconnect', requireAuth, async (req, res, next) => {
  try {
    await prisma.user.update({ where: { id: req.userId }, data: { slackAccessToken: null, slackWebhookUrl: null, slackChannel: null, slackTeamName: null } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});
