# ReachInbox Email Scheduler

A full-stack email scheduling system built to handle delayed execution, strict rate limiting, and concurrent processing without relying on traditional cron jobs.

## 🏗 Architecture & Implementation Details

I built this adhering strictly to the assignment constraints. Here is how the core systems work under the hood:

- **Scheduling Without Cron:** I entirely avoided `node-cron` and `agenda`. Instead, the system relies strictly on BullMQ's native delayed jobs. When an email is scheduled, the backend calculates the delay in milliseconds from `Date.now()` and passes it to Redis. 
- **Concurrency & Rate Limiting:** The worker concurrency is configurable (defaulting to 5). Thread-safety across workers is handled via atomic PostgreSQL updates and a custom Redis Lua script token bucket (`rate:{senderId}`). If a rate limit is hit, the job calculates its exact FIFO slot in the next hour and calls `job.moveToDelayed()`, preserving the send order without failing the job.
- **Restart Persistence:** Redis runs with AOF (Append Only File) persistence enabled. Additionally, the backend runs a reconciliation script (`reconcileOnStartup`) when it boots up. It cross-references the DB for any `SCHEDULED` emails missing from Redis and re-queues them, ensuring zero data loss if the server or Redis container crashes.
- **Integrations:** 
  * Ethereal SMTP accounts are dynamically provisioned for each user upon signup to accurately test multi-sender environments.
  * Real Google OAuth2 handles frontend authentication.
  * Slack API webhooks are integrated to fire real-time alerts when hourly limits are reached.
  * Elasticsearch 8 indexes all emails for fast frontend querying.

## Local Development Setup

### 1. Environment Variables
Create a `.env` file in the `backend/` directory:
```env
PORT=4000
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/reachinbox?schema=public"
REDIS_HOST="localhost"
REDIS_PORT=6379
ELASTICSEARCH_NODE="http://localhost:9200"

WORKER_CONCURRENCY=5
MAX_EMAILS_PER_HOUR_PER_SENDER=50

# OAuth & Webhook Keys
GOOGLE_CLIENT_ID="your_google_client_id"
GOOGLE_CLIENT_SECRET="your_google_client_secret"
SLACK_CLIENT_ID="your_slack_client_id"
SLACK_CLIENT_SECRET="your_slack_client_secret"

2. Start Infrastructure (Docker)
Ensure Docker is running, then spin up PostgreSQL, Redis, and Elasticsearch from the root directory:
docker compose up -d

3. Start the Backend (Port 4000)
cd backend
npm install
npx prisma db push
npm run dev
Note: The BullMQ visual dashboard runs at http://localhost:4000/admin/queues.

4. Start the Frontend (Port 3000)
Open a new terminal tab:
cd frontend
npm install
npm run dev

Access the application at http://localhost:3000.

📋 Feature Breakdown
Backend

[x] BullMQ delayed job scheduling

[x] Startup DB reconciliation for crash persistence

[x] Redis Lua script rate limiting & moveToDelayed logic

[x] Elasticsearch indexing

[x] Slack webhook alerts

Frontend (Next.js App Router)

[x] Google OAuth login

[x] Dashboard mapping exactly to Figma specs

[x] Client-side CSV parser (Papaparse)

[x] Live queue polling (Scheduled vs. Sent tabs)

⚠️ Trade-offs & Notes
Ethereal Accounts: Instead of hardcoding one generic SMTP account for the whole app, I implemented a system that generates a unique Ethereal account per sender. This allows reviewers to accurately test rate limits across multiple concurrent users.

Slack Webhooks: Slack requires HTTP callback URIs to be localhost for local testing. Moving to production would require updating these to HTTPS endpoints.