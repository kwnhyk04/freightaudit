import { loadEnv } from '@freightaudit/config/env';
import { logJson } from '@freightaudit/db/scripts/reset';
import { Redis } from 'ioredis';
import { backlog, createQueues } from '../src/queues.ts';

// pnpm extract:resume: restarts the extract queue after the circuit breaker paused it on a provider's 401, 403 or 404.
// Fix the setting and restart the worker first; otherwise the next job pauses the queue again.
export async function resumeExtract({ redisUrl, prefix }: { redisUrl: string; prefix: string }) {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  const queues = createQueues(redis, prefix);
  try {
    const queue = queues.queue('extract');
    const paused = await queue.isPaused();
    await queue.resume();
    return { paused, waiting: await backlog(queue) };
  } finally {
    await queues.close();
    redis.disconnect();
  }
}

if (import.meta.main) {
  const { REDIS_URL, REDIS_PREFIX } = loadEnv(['REDIS_URL', 'REDIS_PREFIX']);
  const result = await resumeExtract({ redisUrl: REDIS_URL, prefix: REDIS_PREFIX });
  logJson(result.paused ? 'extract queue resumed' : 'extract queue was not paused', result);
}
