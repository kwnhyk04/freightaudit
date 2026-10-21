import { loadEnv } from '@freightaudit/config/env';
import { Redis } from 'ioredis';
import { resumeClaude } from '../src/limits.ts';

// pnpm claude:resume: Claude reads again after it was switched off for good (no credit, a spend limit, a bad key or
// model). Fix the cause first, such as a top-up or the key; otherwise the next call switches it off again.
if (import.meta.main) {
  const { REDIS_URL, REDIS_PREFIX } = loadEnv(['REDIS_URL', 'REDIS_PREFIX']);
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
  try {
    console.log(JSON.stringify({ msg: (await resumeClaude(redis, REDIS_PREFIX)) ? 'claude resumed' : 'claude was not switched off' }));
  } finally {
    redis.disconnect();
  }
}
