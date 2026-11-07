import { Client } from '@elastic/elasticsearch';
import { EmailJob, EmailJobStatus } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../db/prisma';

const client = new Client({ node: config.elasticsearchUrl, requestTimeout: 1500, maxRetries: 1 });
const indexName = 'emails';

export async function initializeEmailIndex(): Promise<void> {
  try {
    const exists = await client.indices.exists({ index: indexName });
    if (!exists) {
      await client.indices.create({
        index: indexName,
        mappings: {
          properties: {
            id: { type: 'keyword' }, userId: { type: 'keyword' }, senderEmail: { type: 'keyword' },
            recipientEmail: { type: 'keyword' }, subject: { type: 'text' }, body: { type: 'text' },
            status: { type: 'keyword' }, scheduledAt: { type: 'date' }, sentAt: { type: 'date' },
            etherealPreviewUrl: { type: 'keyword', index: false }, isStarred: { type: 'boolean' },
          },
        },
      });
    }
  } catch (error) {
    process.stderr.write(`Elasticsearch index initialization deferred: ${String(error)}\n`);
  }
}

export async function bulkIndexEmails(emailJobs: EmailJob[]): Promise<void> {
  if (emailJobs.length === 0) return;
  try {
    const operations = emailJobs.flatMap((emailJob) => [{ index: { _index: indexName, _id: emailJob.id } }, emailJob]);
    const result = await client.bulk({ operations, refresh: false });
    if (result.errors) process.stderr.write('Elasticsearch bulk indexing reported item errors\n');
  } catch (error) {
    process.stderr.write(`Elasticsearch bulk indexing failed: ${String(error)}\n`);
  }
}

export async function updateIndexedEmail(emailJob: EmailJob): Promise<void> {
  try {
    await client.index({ index: indexName, id: emailJob.id, document: emailJob, refresh: false });
  } catch (error) {
    process.stderr.write(`Elasticsearch update failed: ${String(error)}\n`);
  }
}

export async function searchEmails(args: {
  userId: string;
  status?: EmailJobStatus;
  query?: string;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, args.page ?? 1);
  const limit = Math.min(100, Math.max(1, args.limit ?? 50));
  const from = (page - 1) * limit;
  const filters = [{ term: { userId: args.userId } }, ...(args.status ? [{ term: { status: args.status } }] : [])];
  try {
    const response = await client.search<{ id: string }>({
      index: indexName,
      from,
      size: limit,
      track_total_hits: true,
      query: {
        bool: {
          filter: filters,
          ...(args.query?.trim() ? { must: [{ multi_match: { query: args.query.trim(), fields: ['subject', 'body', 'recipientEmail', 'senderEmail'] } }] } : {}),
        },
      },
      sort: [{ scheduledAt: { order: 'desc' } }, { id: { order: 'desc' } }],
    });
    const ids = response.hits.hits.map((hit) => hit._id).filter((id): id is string => Boolean(id));
    const byId = await prisma.emailJob.findMany({ where: { id: { in: ids }, userId: args.userId } });
    const lookup = new Map(byId.map((row) => [row.id, row]));
    return { items: ids.map((id) => lookup.get(id)).filter((row): row is EmailJob => Boolean(row)), total: typeof response.hits.total === 'number' ? response.hits.total : response.hits.total?.value ?? 0, page, limit };
  } catch {
    const where = {
      userId: args.userId,
      ...(args.status ? { status: args.status } : {}),
      ...(args.query?.trim() ? { OR: [
        { subject: { contains: args.query.trim(), mode: 'insensitive' as const } },
        { body: { contains: args.query.trim(), mode: 'insensitive' as const } },
        { recipientEmail: { contains: args.query.trim(), mode: 'insensitive' as const } },
        { senderEmail: { contains: args.query.trim(), mode: 'insensitive' as const } },
      ] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.emailJob.findMany({ where, orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }], skip: from, take: limit }),
      prisma.emailJob.count({ where }),
    ]);
    return { items, total, page, limit };
  }
}
