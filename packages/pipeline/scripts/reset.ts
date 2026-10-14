import { loadEnv } from '@freightaudit/config/env';
import { assertDevDatabase, LOCAL_HOSTS, type Log, logJson, resetDatabase } from '@freightaudit/db/scripts/reset';
import { Redis } from 'ioredis';
import { createQueues, QUEUE_NAMES } from '../src/queues.ts';

// Dev only (pnpm db:reset): empties this deployment's BullMQ queues, job ids included, then drops, migrates and seeds
// the database. A completed job keeps its id (the PDF's hash) for a week, so without this a PDF uploaded before the
// reset would never be extracted again.
export async function resetDev(options: { databaseUrl: string; redisUrl: string; prefix: string; nodeEnv?: string; log?: Log }) {
  const { databaseUrl, redisUrl, prefix, nodeEnv, log = logJson } = options;
  // Every guard runs before anything is deleted.
  assertDevDatabase(databaseUrl, nodeEnv);
  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    const host = redis.options.host ?? '';
    if (!LOCAL_HOSTS.includes(host)) throw new Error(`db:reset clears Redis only on localhost or 127.0.0.1, not ${host}`);
    const queues = createQueues(redis, prefix);
    try {
      const all = QUEUE_NAMES.flatMap((name) => [queues.queue(name), queues.dlq(name)]);
      const active = await Promise.all(all.map((queue) => queue.getActiveCount()));
      if (active.some((count) => count > 0)) throw new Error('db:reset found running jobs: stop the worker first');
      for (const queue of all) await queue.obliterate({ force: true });
      log('queues cleared', { queues: all.length });
    } finally {
      await queues.close();
    }
  } finally {
    redis.disconnect();
  }
  await resetDatabase(databaseUrl, { nodeEnv, log });
}

if (import.meta.main) {
  const { DATABASE_URL, REDIS_URL, REDIS_PREFIX, NODE_ENV } = loadEnv(['DATABASE_URL', 'REDIS_URL', 'REDIS_PREFIX', 'NODE_ENV']);
  await resetDev({ databaseUrl: DATABASE_URL, redisUrl: REDIS_URL, prefix: REDIS_PREFIX, nodeEnv: NODE_ENV });
}
