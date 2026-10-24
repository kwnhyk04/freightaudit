// Whether the backend counts as live, from its /readyz answer, which is kept a while so most pages skip the probe. The
// public path often takes 2 to 6 s (docs/context.md, Known Limitations), so the probe waits 8 s and a live answer is
// kept 30 s; a failed one is kept 5 s, so the site comes back soon after the backend does.
export const READYZ_TIMEOUT_MS = 8_000;
export const LIVE_FOR_MS = 30_000;
export const OFFLINE_FOR_MS = 5_000;

// ready asks /readyz, waiting at most timeoutMs, and resolves false on any failure; now is the clock, for tests.
export function createLiveCheck(ready: (timeoutMs: number) => Promise<boolean>, now: () => number = Date.now) {
  let seen: { at: number; live: boolean } | undefined;
  return {
    // A failed api call counts as offline at once, so the next page goes to the sample instead of waiting out the cache.
    markOffline: () => void (seen = { at: now(), live: false }),
    async check() {
      if (seen && now() - seen.at < (seen.live ? LIVE_FOR_MS : OFFLINE_FOR_MS)) return seen.live;
      const asked = now();
      const live = await ready(READYZ_TIMEOUT_MS);
      // Whatever was seen while this probe waited, such as a failed api call, is newer than its answer and stays.
      if (!seen || seen.at < asked) seen = { at: now(), live };
      return seen.live;
    },
  };
}
