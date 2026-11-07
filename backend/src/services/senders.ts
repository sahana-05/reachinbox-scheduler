import nodemailer from 'nodemailer';
import { User } from '@prisma/client';
import { prisma } from '../db/prisma';
import { config } from '../config';

type SmtpAccount = { user: string; pass: string; host: string; port: number };

async function createEtherealAccount(): Promise<SmtpAccount> {
  const account = await nodemailer.createTestAccount();
  return { user: account.user, pass: account.pass, host: account.smtp.host, port: account.smtp.port };
}

async function provisionSender(user: User, index: number) {
  let account: SmtpAccount;
  let usedFallback = false;
  try {
    account = await createEtherealAccount();
  } catch {
    usedFallback = true;
    account = {
      user: config.etherealFallbackUser,
      pass: config.etherealFallbackPass,
      host: 'smtp.ethereal.email',
      port: 587,
    };
  }
  const display = user.name.trim() || user.email.split('@')[0] || 'ReachInbox';
  const fallbackAddress = config.etherealFallbackUser.includes('@')
    ? `${config.etherealFallbackUser.split('@')[0]}+${user.id.slice(0, 8)}-${index + 1}@${config.etherealFallbackUser.split('@')[1]}`
    : `${user.id.slice(0, 8)}-${index + 1}@ethereal.email`;
  const address = usedFallback ? fallbackAddress : account.user;
  return prisma.sender.create({
    data: {
      userId: user.id,
      name: `${display} ${index + 1}`,
      email: address,
      smtpHost: account.host,
      smtpPort: account.port,
      smtpUser: account.user,
      smtpPass: account.pass,
    },
  });
}

export async function ensureUserSenders(user: User): Promise<void> {
  const existing = await prisma.sender.count({ where: { userId: user.id } });
  for (let index = existing; index < 2; index += 1) {
    try {
      await provisionSender(user, index);
    } catch (error) {
      if (index === 0) throw error;
      break;
    }
  }
}

export async function createAdditionalSender(user: User) {
  const sender = await provisionSender(user, await prisma.sender.count({ where: { userId: user.id } }));
  const { smtpPass: _smtpPass, smtpUser: _smtpUser, ...safeSender } = sender;
  return safeSender;
}
