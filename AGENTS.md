# Engineering Standards
- Write clean, production-grade TypeScript.
- NEVER write tutorial comments, step-by-step comments (e.g., "// Step 1:", "// Here we initialize"), or emojis in code/logs.
- Use modular architecture, strict TypeScript interfaces, and Zod validation.
- Never use cron libraries (`node-cron`, `agenda`, etc.). All scheduling must use BullMQ delayed jobs (`delay` and `job.moveToDelayed`).
