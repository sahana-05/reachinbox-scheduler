import { EmailJobStatus } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middleware/auth';
import { bulkIndexEmails, searchEmails } from '../services/elasticsearch';
import { emailQueue } from '../queues/emailQueue';
import { config } from '../config';

export const emailsRouter = Router();
emailsRouter.use(requireAuth);

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function scheduleTimes(startTime: Date, recipientsCount: number, hourlyLimit: number, delaySeconds: number): Date[] {
  const times: Date[] = [];
  const counts = new Map<number, number>();
  let lastScheduled = startTime.getTime() - delaySeconds * 1000;
  for (let index = 0; index < recipientsCount; index += 1) {
    let candidate = Math.max(startTime.getTime(), lastScheduled + delaySeconds * 1000);
    let hour = Math.floor(candidate / 3600000) * 3600000;
    while ((counts.get(hour) ?? 0) >= hourlyLimit) {
      candidate = hour + 3600000;
      hour += 3600000;
    }
    times.push(new Date(candidate));
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
    lastScheduled = candidate;
  }
  return times;
}

emailsRouter.post('/schedule', async (req, res, next) => {
  try {
    const { senderId, recipients, subject, body } = req.body ?? {};
    if (typeof senderId !== 'string' || !Array.isArray(recipients) || recipients.length === 0 || recipients.length > 10000 ||
      recipients.some((email: unknown) => typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email.trim())) ||
      typeof subject !== 'string' || !subject.trim() || typeof body !== 'string' || !body.trim()) {
      res.status(400).json({ error: 'senderId, subject, body, and 1 to 10000 valid recipient addresses are required' });
      return;
    }
    const sender = await prisma.sender.findFirst({ where: { id: senderId, userId: req.userId } });
    if (!sender) {
      res.status(404).json({ error: 'Sender not found' });
      return;
    }
    const startTime = req.body.startTime ? new Date(req.body.startTime) : new Date();
    if (Number.isNaN(startTime.getTime())) {
      res.status(400).json({ error: 'startTime must be a valid date' });
      return;
    }
    const delaySeconds = Math.max(1, Number(req.body.delaySeconds) || config.minDelaySeconds);
    const hourlyLimit = Math.max(1, Number(req.body.hourlyLimit) || config.maxEmailsPerHourPerSender);
    if (!Number.isFinite(delaySeconds) || !Number.isFinite(hourlyLimit) || delaySeconds > 86400 || hourlyLimit > 100000) {
      res.status(400).json({ error: 'delaySeconds or hourlyLimit is outside the supported range' });
      return;
    }
    const attachments = req.body.attachments ?? [];
    if (!Array.isArray(attachments)) {
      res.status(400).json({ error: 'attachments must be an array' });
      return;
    }
    const attachmentsJson = attachments.length ? JSON.stringify(attachments) : null;
    const times = scheduleTimes(startTime, recipients.length, hourlyLimit, delaySeconds);
    const campaign = await prisma.campaign.create({
      data: {
        userId: req.userId!, senderId, subject: subject.trim(), body,
        startTime, delaySeconds, hourlyLimit, attachmentsJson,
      },
    });
    const insert = await prisma.emailJob.createMany({
      data: recipients.map((recipient: string, index: number) => ({
        campaignId: campaign.id,
        userId: req.userId!,
        senderId,
        senderEmail: sender.email,
        recipientEmail: recipient.trim().toLowerCase(),
        subject: subject.trim(),
        body,
        attachmentsJson,
        scheduledAt: times[index],
        idempotencyKey: `${campaign.id}:${recipient.trim().toLowerCase()}`,
      })),
      skipDuplicates: true,
    });
    const emailJobs = await prisma.emailJob.findMany({ where: { campaignId: campaign.id }, orderBy: { scheduledAt: 'asc' } });
    await bulkIndexEmails(emailJobs);
    await emailQueue.addBulk(emailJobs.map((email) => ({
      name: 'deliver-email',
      data: { emailId: email.id },
      opts: { jobId: `email-${email.id}`, delay: Math.max(0, email.scheduledAt.getTime() - Date.now()), removeOnComplete: 1000, removeOnFail: 5000 },
    })));
    res.status(202).json({ campaignId: campaign.id, scheduledCount: insert.count, emailJobs: emailJobs.length });
  } catch (error) {
    next(error);
  }
});

emailsRouter.get('/', async (req, res, next) => {
  try {
    const statusText = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;
    if (statusText && !Object.values(EmailJobStatus).includes(statusText as EmailJobStatus)) {
      res.status(400).json({ error: 'status must be SCHEDULED, PROCESSING, SENT, or FAILED' });
      return;
    }
    const page = parsePositiveInt(req.query.page, 1, 1000000);
    const limit = parsePositiveInt(req.query.limit, 50, 100);
    const query = typeof req.query.search === 'string' ? req.query.search : undefined;
    const [result, scheduledCount, sentCount] = await Promise.all([
      searchEmails({ userId: req.userId!, status: statusText as EmailJobStatus | undefined, query, page, limit }),
      prisma.emailJob.count({ where: { userId: req.userId, status: { in: [EmailJobStatus.SCHEDULED, EmailJobStatus.PROCESSING] } } }),
      prisma.emailJob.count({ where: { userId: req.userId, status: EmailJobStatus.SENT } }),
    ]);
    res.json({ ...result, scheduledCount, sentCount });
  } catch (error) {
    next(error);
  }
});

emailsRouter.get('/:id', async (req, res, next) => {
  try {
    const email = await prisma.emailJob.findFirst({ where: { id: req.params.id, userId: req.userId }, include: { campaign: true, sender: { select: { id: true, name: true, email: true } } } });
    if (!email) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }
    res.json({ email });
  } catch (error) {
    next(error);
  }
});

emailsRouter.patch('/:id/star', async (req, res, next) => {
  try {
    const email = await prisma.emailJob.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!email) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }
    const starred = await prisma.emailJob.update({ where: { id: email.id }, data: { isStarred: !email.isStarred } });
    res.json({ isStarred: starred.isStarred });
  } catch (error) {
    next(error);
  }
});
