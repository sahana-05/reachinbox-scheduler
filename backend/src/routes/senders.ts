import { Router } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth } from '../middleware/auth';
import { createAdditionalSender } from '../services/senders';

export const sendersRouter = Router();
sendersRouter.use(requireAuth);

sendersRouter.get('/', async (req, res, next) => {
  try {
    const senders = await prisma.sender.findMany({ where: { userId: req.userId }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, email: true, smtpHost: true, smtpPort: true, createdAt: true } });
    res.json({ senders });
  } catch (error) {
    next(error);
  }
});

sendersRouter.post('/', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const sender = await createAdditionalSender(user);
    res.status(201).json({ sender });
  } catch (error) {
    next(error);
  }
});
