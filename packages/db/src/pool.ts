import pg from 'pg';
import type { Log } from './log.ts';

// The services' pg pool. The server can drop a pooled connection while it sits idle (a restart, a terminated backend);
// the pool then removes it and emits 'error', which crashes the process when nothing listens. This logs the error's
// code only, never its message or a query's bound values, and the next query opens a new connection. A read-only pool's
// sessions refuse every write, so a dry run cannot change the database, whatever its code does.
export function createPool(connectionString: string, log: Log, { readOnly = false } = {}) {
  const pool = new pg.Pool({ connectionString, ...(readOnly ? { options: '-c default_transaction_read_only=on' } : {}) });
  pool.on('error', (err) => log('idle database connection lost', { code: (err as { code?: unknown }).code ?? 'unknown' }));
  return pool;
}
