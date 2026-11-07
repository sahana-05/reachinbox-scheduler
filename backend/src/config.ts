import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL ?? 'http://localhost:4000/api/auth/google/callback',
  slackClientId: process.env.SLACK_CLIENT_ID ?? '',
  slackClientSecret: process.env.SLACK_CLIENT_SECRET ?? '',
  slackRedirectUri: process.env.SLACK_REDIRECT_URI ?? 'http://localhost:4000/api/slack/callback',
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
  minDelaySeconds: Number(process.env.MIN_DELAY_SECONDS ?? 2),
  maxEmailsPerHourPerSender: Number(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER ?? 200),
  etherealFallbackUser: process.env.ETHEREAL_FALLBACK_USER ?? '',
  etherealFallbackPass: process.env.ETHEREAL_FALLBACK_PASS ?? '',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  elasticsearchUrl: process.env.ELASTICSEARCH_URL ?? 'http://localhost:9200',
  nodeEnv: process.env.NODE_ENV ?? 'development',
};
