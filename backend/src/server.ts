import { app } from './app';
import { config } from './config';
import { prisma } from './db/prisma';
import { emailWorker, reconcileOnStartup, redis } from './queues/emailQueue';
import { initializeEmailIndex } from './services/elasticsearch';

async function start(): Promise<void> {
  await prisma.$connect();
  await initializeEmailIndex();
  await reconcileOnStartup();
  const server = app.listen(config.port, () => process.stdout.write(`Backend listening on port ${config.port}\n`));
  const shutdown = async (signal: string): Promise<void> => {
    process.stdout.write(`Received ${signal}; shutting down\n`);
    server.close();
    await emailWorker.close();
    await redis.quit();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

start().catch(async (error: unknown) => {
  process.stderr.write(`Backend startup failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  await emailWorker.close().catch(() => undefined);
  await redis.quit().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
