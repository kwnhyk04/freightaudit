import { carriers, shipments, tmsSyncState } from '@freightaudit/db';
import { classify, httpError, parseRetryAfter, PermanentError, TransientError } from '@freightaudit/llm';
import type { TmsSyncJob } from '@freightaudit/pipeline';
import type { Job } from 'bullmq';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import type { Deps, Tx } from './workers.ts';

const PAGE_SIZE = 100;
// Transient failures in a row on one page (429, 5xx, timeouts, dropped connections) before the attempt fails and
// BullMQ backs off instead. Retrying the page in place keeps a flaky link from using up the job's attempts.
const MAX_TRIES = 10;

// The TMS is outside the trust boundary, so every page is validated.
const pageSchema = z.object({
  items: z.array(
    z.object({
      reference: z.string().min(1),
      pro_number: z.string().min(1),
      carrier: z.string().min(1),
      origin: z.string().min(1),
      destination: z.string().min(1),
      shipped_on: z.iso.date(),
      weight_lb: z.int().positive().nullable(),
      miles: z.int().nonnegative().nullable(),
    }),
  ),
  next_cursor: z.string().min(1).nullable(),
  has_more: z.boolean(),
});
type Page = z.infer<typeof pageSchema>;
type Backoff = (attemptsMade: number, type?: string, err?: Error) => number;

// Pages through the TMS from the saved cursor. Each page's upserts commit together with the cursor that follows them,
// so a crash resumes mid-stream and a rerun re-reads at most one page.
export async function syncShipments({ db, tmsUrl }: Deps, job: Job<TmsSyncJob>, backoff: Backoff) {
  const { tenantId } = job.data;
  const [state] = await db.select({ cursor: tmsSyncState.cursor }).from(tmsSyncState).where(eq(tmsSyncState.tenantId, tenantId));
  let cursor = state?.cursor ?? null;
  let pages = 0;
  let upserted = 0;
  for (let more = true; more; pages++) {
    const page = await fetchPage(tmsUrl, cursor, backoff);
    // An empty page has no cursor of its own; keep the one it was read from.
    const next = page.next_cursor ?? cursor;
    if (page.has_more && next === cursor) throw new PermanentError('TMS page claims more items but did not move the cursor');
    await db.transaction(async (tx) => {
      upserted += await upsertShipments(tx, tenantId, page.items);
      const saved = { cursor: next, lastSyncedAt: sql`now()` };
      await tx.insert(tmsSyncState).values({ tenantId, ...saved }).onConflictDoUpdate({ target: tmsSyncState.tenantId, set: saved });
    });
    cursor = next;
    more = page.has_more;
  }
  return { pages, upserted };
}

async function fetchPage(baseUrl: string, cursor: string | null, backoff: Backoff): Promise<Page> {
  const url = new URL('/shipments', baseUrl);
  url.searchParams.set('limit', String(PAGE_SIZE));
  if (cursor) url.searchParams.set('after', cursor);
  for (let tries = 1; ; tries++) {
    try {
      return await requestPage(url);
    } catch (err) {
      if (!(err instanceof TransientError) || tries >= MAX_TRIES) throw err;
      // Wait at least Retry-After, then ask for the same page again.
      await setTimeout(backoff(tries, undefined, err));
    }
  }
}

async function requestPage(url: URL): Promise<Page> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw httpError(response.status, `TMS HTTP ${response.status}`, parseRetryAfter(response.headers.get('retry-after')));
    }
    const parsed = pageSchema.safeParse(await response.json());
    if (!parsed.success) throw new PermanentError(`TMS page failed validation (${parsed.error.issues.length} issues)`);
    return parsed.data;
  } catch (err) {
    // A connection that drops before or during the body is transient too.
    throw classify(err);
  }
}

async function upsertShipments(tx: Tx, tenantId: string, items: Page['items']) {
  // One row per carrier and PRO number: Postgres rejects an upsert that touches the same row twice.
  const unique = [...new Map(items.map((item) => [`${item.carrier}\n${item.pro_number}`, item])).values()];
  if (unique.length === 0) return 0;
  const names = [...new Set(unique.map((item) => item.carrier))];
  await tx.insert(carriers).values(names.map((name) => ({ tenantId, name }))).onConflictDoNothing();
  const known = await tx
    .select({ id: carriers.id, name: carriers.name })
    .from(carriers)
    .where(and(eq(carriers.tenantId, tenantId), inArray(carriers.name, names)));
  const carrierIds = new Map(known.map((carrier) => [carrier.name, carrier.id]));
  const rows = unique.map((item) => ({
    tenantId,
    carrierId: carrierIds.get(item.carrier)!,
    proNumber: item.pro_number,
    reference: item.reference,
    origin: item.origin,
    destination: item.destination,
    shippedOn: item.shipped_on,
    weightLb: item.weight_lb,
    miles: item.miles,
  }));
  await tx
    .insert(shipments)
    .values(rows)
    .onConflictDoUpdate({
      target: [shipments.tenantId, shipments.carrierId, shipments.proNumber],
      set: {
        reference: sql`excluded.reference`,
        origin: sql`excluded.origin`,
        destination: sql`excluded.destination`,
        shippedOn: sql`excluded.shipped_on`,
        weightLb: sql`excluded.weight_lb`,
        miles: sql`excluded.miles`,
      },
    });
  return rows.length;
}
