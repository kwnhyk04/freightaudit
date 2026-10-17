import pg from 'pg';
import type { Log } from './log.ts';

// The services' pg pool. The server can drop a pooled connection while it sits idle (a restart, a terminated backend);
// the pool then removes it and emits 'error', which crashes the process when nothing listens. This logs the error's
// code only, never its message or a query's bound values, and the next query opens a new connection.
export function createPool(connectionString: string, log: Log) {
  const pool = new pg.Pool({ connectionString });
  pool.on('error', (err) => log('idle database connection lost', { code: (err as { code?: unknown }).code ?? 'unknown' }));
  return pool;
}
