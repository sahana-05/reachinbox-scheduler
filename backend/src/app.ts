import express, { ErrorRequestHandler } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { authRouter } from './routes/auth';
import { slackRouter } from './routes/slack';
import { emailsRouter } from './routes/emails';
import { sendersRouter } from './routes/senders';
import { bullBoardRouter } from './queues/emailQueue';
import { config } from './config';

export const app = express();

app.disable('x-powered-by');
app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRouter);
app.use('/api/senders', sendersRouter);
app.use('/api/slack', slackRouter);
app.use('/api/emails', emailsRouter);
app.use('/admin/queues', bullBoardRouter);

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error' });
};
app.use(errorHandler);
