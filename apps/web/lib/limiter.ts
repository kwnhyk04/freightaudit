// Failed sign-ins per client: at most 5 in 15 minutes, then refused until the oldest leaves the window; a success clears
// them. ponytail: memory of one server instance, so on Vercel each instance counts alone; a hosted Redis when it must
// hold across instances (docs/memory.md).
export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60_000;

export function createLimiter(now: () => number = Date.now) {
  const failures = new Map<string, number[]>();
  const recent = (client: string) => (failures.get(client) ?? []).filter((at) => now() - at < WINDOW_MS);
  return {
    // Milliseconds until this client may try again; 0 when it may now.
    retryAfter(client: string) {
      const kept = recent(client);
      failures.set(client, kept);
      return kept.length >= MAX_FAILURES ? WINDOW_MS - (now() - kept[0]!) : 0;
    },
    fail: (client: string) => void failures.set(client, [...recent(client), now()]),
    clear: (client: string) => void failures.delete(client),
  };
}
