# ReachInbox Email Scheduler

A full-stack email scheduling system built to handle delayed execution, sender rate limits, and concurrent processing without a cron service.

## Architecture

- **Scheduling without cron:** Email delivery uses BullMQ delayed jobs stored in Redis. The API calculates each job's delay from its scheduled time.
- **Concurrency and rate limiting:** Worker concurrency is configurable and defaults to `5`. A Redis Lua script atomically enforces per-sender hourly limits and minimum spacing between sends. Jobs that reach the hourly limit are delayed into ordered slots in the next hour; they are not dropped.
- **Restart recovery:** Redis uses AOF persistence. At startup, `reconcileOnStartup` reads scheduled and processing jobs from PostgreSQL, resets interrupted processing jobs, and re-enqueues jobs that are missing from BullMQ.
- **Integrations:** Google OAuth2 authenticates users. On first login, the backend provisions two Ethereal sender accounts when available; users can add more senders. Slack OAuth and incoming webhooks can send rate-limit alerts. Email jobs are indexed in Elasticsearch, with PostgreSQL search as a fallback.

## Local development

### 1. Configure the backend

Create `backend/.env` with these values. Replace the OAuth credentials and `JWT_SECRET` with your own values. The Google and Slack credentials are needed only when you use those integrations.

```env
PORT=4000
FRONTEND_URL=http://localhost:3000
JWT_SECRET=replace-with-a-long-random-secret
JWT_EXPIRES_IN=7d

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/reachinbox?schema=public
REDIS_URL=redis://localhost:6379
ELASTICSEARCH_URL=http://localhost:9200

WORKER_CONCURRENCY=5
MIN_DELAY_SECONDS=2
MAX_EMAILS_PER_HOUR_PER_SENDER=50

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:4000/api/auth/google/callback

SLACK_CLIENT_ID=your_slack_client_id
SLACK_CLIENT_SECRET=your_slack_client_secret
SLACK_REDIRECT_URI=http://localhost:4000/api/slack/callback

ETHEREAL_FALLBACK_USER=
ETHEREAL_FALLBACK_PASS=
```

The PostgreSQL port is `5432`, matching `docker-compose.yml`. The backend reads `REDIS_URL` and `ELASTICSEARCH_URL` (not separate Redis host/port variables).

### 2. Start infrastructure

From the repository root, start PostgreSQL, Redis, and Elasticsearch:

```bash
docker compose up -d
```

### 3. Initialize and start the backend

In a terminal from the repository root:

```bash
cd backend
npm install
npx prisma generate
npx prisma db push
npm run dev
```

The API runs at [http://localhost:4000](http://localhost:4000). The Bull Board queue monitor is at [http://localhost:4000/admin/queues](http://localhost:4000/admin/queues).

### 4. Start the frontend

Open another terminal from the repository root:

```bash
cd frontend
npm install
npm run dev
```

The Next.js app runs at [http://localhost:3000](http://localhost:3000) and uses `http://localhost:4000` as its API by default. To change that address, set `NEXT_PUBLIC_API_URL` in `frontend/.env.local`.

### OAuth callback URLs

Configure these exact callback URLs in the Google and Slack developer consoles:

- Google: `http://localhost:4000/api/auth/google/callback`
- Slack: `http://localhost:4000/api/slack/callback`

## Features

### Backend

- BullMQ delayed delivery without cron
- PostgreSQL persistence and startup job reconciliation
- Atomic Redis Lua rate limiting and delayed FIFO overflow slots
- Elasticsearch indexing and PostgreSQL search fallback
- Google OAuth2 and email/password authentication
- Ethereal SMTP sender provisioning
- Slack OAuth, incoming webhook tests, and rate-limit alerts
- Email listing, search, detail, and star endpoints

### Frontend

- Next.js App Router login and dashboard
- Scheduled and sent email views with live polling
- Debounced email search
- CSV recipient import with Papa Parse
- Rich-text email composition, attachments, and send-time selection
- Sender selection and per-campaign rate-limit settings

## Notes

- If Ethereal account creation is unavailable, the backend creates fallback sender records. Set `ETHEREAL_FALLBACK_USER` and `ETHEREAL_FALLBACK_PASS` if you have fallback SMTP credentials.
- Slack and Google OAuth require valid developer app credentials and matching local callback URLs. Production deployments need HTTPS callback URLs.
