import { createTransport, getTestMessageUrl } from 'nodemailer';
import type { Attachment } from 'nodemailer/lib/mailer';
import { DelayedError, Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { EmailJobStatus } from '@prisma/client';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { config } from '../config';
import { prisma } from '../db/prisma';
import { updateIndexedEmail } from '../services/elasticsearch';

export const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
export const emailQueue = new Queue('email-delivery-queue', { connection: redis });

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');
createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter });
export const bullBoardRouter = serverAdapter.getRouter();

const rateLimitScript = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[1])
local delay = tonumber(ARGV[3])
if count >= limit then
  local slot = redis.call('GET', KEYS[3])
  if not slot then
    slot = tonumber(ARGV[4])
    redis.call('SET', KEYS[3], slot, 'EX', 172800)
  else
    slot = redis.call('INCRBY', KEYS[3], delay)
  end
  return {2, tonumber(slot)}
end
local last = tonumber(redis.call('GET', KEYS[2]) or '0')
local nextAllowed = last + delay
if last > 0 and now < nextAllowed then
  return {1, nextAllowed}
end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 7200)
redis.call('SET', KEYS[2], now, 'EX', 7200)
return {0, now}
`;

type EmailJobPayload = { emailId: string };

function hourParts(date: Date): { key: string; start: number; nextStart: number } {
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours());
  const nextStart = start + 60 * 60 * 1000;
  const key = date.toISOString().slice(0, 13).replace('T', '-');
  return { key, start, nextStart };
}

async function alertRateLimit(senderId: string, senderEmail: string, hourlyLimit: number, hourKey: string, userId: string): Promise<void> {
  try {
    const lock = await redis.set(`slack_rate_alert:${senderId}:${hourKey}`, '1', 'EX', 3600, 'NX');
    if (lock !== 'OK') return;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { slackWebhookUrl: true, slackAccessToken: true, slackChannel: true } });
    if (!user) return;
    const text = `Sender ${senderEmail} reached the hourly limit (${hourlyLimit}/hr). Scheduled email jobs are shifting to the next hour window.`;
    if (user.slackWebhookUrl) {
      const response = await fetch(user.slackWebhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
      if (!response.ok) throw new Error(`Slack webhook returned HTTP ${response.status}`);
    } else if (user.slackAccessToken && user.slackChannel) {
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { authorization: `Bearer ${user.slackAccessToken}`, 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ channel: user.slackChannel, text }),
      });
      const result = await response.json() as { ok?: boolean };
      if (!response.ok || !result.ok) throw new Error('Slack API rejected the rate-limit alert');
    }
  } catch (error) {
    process.stderr.write(`Slack rate-limit alert failed: ${String(error)}\n`);
  }
}

function getAttachments(value: string | null): Attachment[] {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('Campaign attachments must be a JSON array');
  return parsed as Attachment[];
}

async function processEmail(job: Job<EmailJobPayload>, token?: string): Promise<void> {
  const email = await prisma.emailJob.findUnique({ where: { id: job.data.emailId }, include: { campaign: true, sender: true } });
  if (!email || email.status !== EmailJobStatus.SCHEDULED) return;
  const now = Date.now();
  const { key: hourKey, nextStart } = hourParts(new Date(now));
  const nextHourKey = new Date(nextStart).toISOString().slice(0, 13).replace('T', '-');
  const hourlyLimit = email.campaign.hourlyLimit || config.maxEmailsPerHourPerSender;
  const delaySeconds = email.campaign.delaySeconds || config.minDelaySeconds;
  const result = await redis.eval(
    rateLimitScript,
    3,
    `ratelimit:hourly:${email.senderId}:${hourKey}`,
    `ratelimit:last_send:${email.senderId}`,
    `ratelimit:next_slot:${email.senderId}:${nextHourKey}`,
    String(now),
    String(hourlyLimit),
    String(delaySeconds * 1000),
    String(nextStart),
  ) as [number | string, number | string];
  const action = Number(result[0]);
  const allowedAt = Number(result[1]);
  if (action !== 0) {
    if (action === 2) await alertRateLimit(email.senderId, email.senderEmail, hourlyLimit, hourKey, email.userId);
    await prisma.emailJob.update({ where: { id: email.id }, data: { scheduledAt: new Date(allowedAt) } });
    const updated = await prisma.emailJob.findUnique({ where: { id: email.id } });
    if (updated) await updateIndexedEmail(updated);
    if (!token) throw new Error('BullMQ lock token unavailable for delayed job');
    await job.moveToDelayed(allowedAt, token);
    throw new DelayedError();
  }

  const claim = await prisma.emailJob.updateMany({ where: { id: email.id, status: EmailJobStatus.SCHEDULED }, data: { status: EmailJobStatus.PROCESSING } });
  if (claim.count === 0) return;
  const processing = await prisma.emailJob.findUnique({ where: { id: email.id } });
  if (processing) await updateIndexedEmail(processing);
  try {
    const transporter = createTransport({
      host: email.sender.smtpHost,
      port: email.sender.smtpPort,
      secure: email.sender.smtpPort === 465,
      auth: { user: email.sender.smtpUser, pass: email.sender.smtpPass },
    });
    const info = await transporter.sendMail({
      from: { name: email.sender.name, address: email.senderEmail },
      to: email.recipientEmail,
      subject: email.subject,
      html: email.body,
      attachments: getAttachments(email.attachmentsJson),
    });
    const previewUrl = getTestMessageUrl(info);
    const updated = await prisma.emailJob.update({
      where: { id: email.id },
      data: { status: EmailJobStatus.SENT, sentAt: new Date(), etherealPreviewUrl: previewUrl || null, errorMessage: null },
    });
    await updateIndexedEmail(updated);
    await transporter.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await prisma.emailJob.update({ where: { id: email.id }, data: { status: EmailJobStatus.FAILED, errorMessage: message } });
    await updateIndexedEmail(failed);
    throw error;
  }
}

export const emailWorker = new Worker<EmailJobPayload>('email-delivery-queue', processEmail, {
  connection: redis,
  concurrency: Math.max(1, config.workerConcurrency),
});

export async function reconcileOnStartup(): Promise<void> {
  await prisma.emailJob.updateMany({ where: { status: EmailJobStatus.PROCESSING }, data: { status: EmailJobStatus.SCHEDULED } });
  const pending = await prisma.emailJob.findMany({ where: { status: EmailJobStatus.SCHEDULED }, select: { id: true, scheduledAt: true } });
  for (const email of pending) {
    const jobId = `email-${email.id}`;
    const existing = await emailQueue.getJob(jobId);
    if (!existing) {
      await emailQueue.add('deliver-email', { emailId: email.id }, {
        jobId,
        delay: Math.max(0, email.scheduledAt.getTime() - Date.now()),
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    } else {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') {
        await emailQueue.add('deliver-email', { emailId: email.id }, {
          jobId: `${jobId}-recovered-${Date.now()}`,
          delay: Math.max(0, email.scheduledAt.getTime() - Date.now()),
        });
      }
    }
  }
}
