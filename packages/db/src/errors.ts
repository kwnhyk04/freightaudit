// A failed Drizzle query's message lists every bound value (PRO numbers, extracted line items), so it must never reach a
// log, a job's failed reason or a response. This keeps only the driver's SQLSTATE code; undefined for any other error.
export function queryError(err: unknown): Error | undefined {
  if (!(err instanceof Error && 'query' in err && 'params' in err)) return undefined;
  const code = (err.cause as { code?: unknown } | undefined)?.code;
  return new Error(`database query failed${typeof code === 'string' ? `: ${code}` : ''}`);
}
