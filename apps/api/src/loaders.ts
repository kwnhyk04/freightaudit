import {
  auditEvents,
  carriers,
  deadLetters,
  discrepancies,
  extractions,
  invoiceLines,
  invoices,
  rateCardVersions,
  shipments,
} from '@freightaudit/db';
import DataLoader from 'dataloader';
import { and, asc, count, desc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { after, cursorAt } from './keyset.ts';
import { invoiceColumns } from './service.ts';

export type DiscrepancyArgs = { invoiceId: string; status?: 'open' | 'confirmed' | 'dismissed'; first: number; after?: string | null };

// Invoices as GraphQL shows them: the REST columns plus the PRO number matching uses.
export const graphqlInvoiceColumns = { ...invoiceColumns, proNumber: invoices.proNumber };
export const discrepancyColumns = {
  id: discrepancies.id,
  invoiceId: discrepancies.invoiceId,
  type: discrepancies.type,
  status: discrepancies.status,
  expectedCents: discrepancies.expectedCents,
  billedCents: discrepancies.billedCents,
  evidence: discrepancies.evidence,
  note: discrepancies.note,
  resolvedAt: discrepancies.resolvedAt,
  createdAt: discrepancies.createdAt,
  // updated_at to the microsecond: every update moves it, so it tells whether a finding changed since it was read.
  version: cursorAt(discrepancies.updatedAt).as('version'),
};
const shipmentColumns = {
  id: shipments.id,
  reference: shipments.reference,
  carrier: carriers.name,
  origin: shipments.origin,
  destination: shipments.destination,
  shippedOn: shipments.shippedOn,
  weightLb: shipments.weightLb,
};
// A version's effective range as UTC dates; an open bound is null.
const lowerDay = sql<string | null>`to_char(lower(${rateCardVersions.effective}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
const upperDay = sql<string | null>`to_char(upper(${rateCardVersions.effective}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
const versionColumns = { id: rateCardVersions.id, carrier: carriers.name, version: rateCardVersions.version, effectiveFrom: lowerDay, effectiveTo: upperDay };

// Rows grouped under the keys DataLoader asked for, in its order.
function grouped<Row, Key>(keys: readonly Key[], rows: Row[], keyOf: (row: Row) => Key) {
  const groups = new Map<Key, Row[]>();
  for (const row of rows) groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
  return keys.map((key) => groups.get(key) ?? []);
}
const single = <Row, Key>(keys: readonly Key[], rows: Row[], keyOf: (row: Row) => Key) =>
  grouped(keys, rows, keyOf).map((group) => group[0] ?? null);

// One query per loader and request, whatever the page size: a list of 25 invoices that selects their shipments costs one
// shipment query, not 25. Relations are keyed by the parent's own id, so resolvers need nothing but the GraphQL fields.
export function createLoaders(db: NodePgDatabase, tenantId: string) {
  const tenantInvoices = (ids: readonly string[]) => and(eq(invoices.tenantId, tenantId), inArray(invoices.id, [...ids]));
  const ofDiscrepancies = (ids: readonly string[]) => and(eq(discrepancies.tenantId, tenantId), inArray(discrepancies.id, [...ids]));

  // Every invoice's first + 1 discrepancies under one set of arguments, ranked per invoice in keyset order.
  function rankedDiscrepancies(args: DiscrepancyArgs, ids: string[]) {
    const ranked = db
      .select({
        ...discrepancyColumns,
        cursorAt: cursorAt(discrepancies.createdAt).as('cursor_at'),
        rank: sql<number>`row_number() OVER (PARTITION BY ${discrepancies.invoiceId} ORDER BY ${discrepancies.createdAt} DESC, ${discrepancies.id} DESC)`.as('rank'),
      })
      .from(discrepancies)
      .where(
        and(
          eq(discrepancies.tenantId, tenantId),
          inArray(discrepancies.invoiceId, ids),
          args.status ? eq(discrepancies.status, args.status) : undefined,
          after(discrepancies.createdAt, discrepancies.id, args.after),
        ),
      )
      .as('ranked');
    return db.select().from(ranked).where(lte(ranked.rank, args.first + 1)).orderBy(asc(ranked.rank));
  }
  type RankedRow = Awaited<ReturnType<typeof rankedDiscrepancies>>[number];

  let carrierList: Promise<{ id: string; name: string }[]> | undefined;

  return {
    // The tenant's carriers by name, read once per request.
    carriers: () =>
      (carrierList ??= db.select({ id: carriers.id, name: carriers.name }).from(carriers).where(eq(carriers.tenantId, tenantId)).orderBy(asc(carriers.name))),

    invoice: new DataLoader(async (ids: readonly string[]) =>
      single(
        ids,
        await db
          .select({ key: invoices.id, ...graphqlInvoiceColumns })
          .from(invoices)
          .leftJoin(carriers, eq(carriers.id, invoices.carrierId))
          .where(tenantInvoices(ids)),
        (row) => row.key,
      ),
    ),

    lineItems: new DataLoader(async (ids: readonly string[]) =>
      grouped(
        ids,
        await db
          .select()
          .from(invoiceLines)
          .where(and(eq(invoiceLines.tenantId, tenantId), inArray(invoiceLines.invoiceId, [...ids])))
          .orderBy(asc(invoiceLines.lineNumber)),
        (row) => row.invoiceId,
      ),
    ),

    extraction: new DataLoader(async (ids: readonly string[]) =>
      single(
        ids,
        await db.select().from(extractions).where(and(eq(extractions.tenantId, tenantId), inArray(extractions.invoiceId, [...ids]))),
        (row) => row.invoiceId,
      ),
    ),

    shipment: new DataLoader(async (ids: readonly string[]) =>
      single(
        ids,
        await db
          .select({ key: invoices.id, ...shipmentColumns })
          .from(invoices)
          .innerJoin(shipments, eq(shipments.id, invoices.shipmentId))
          .innerJoin(carriers, eq(carriers.id, shipments.carrierId))
          .where(tenantInvoices(ids)),
        (row) => row.key,
      ),
    ),

    // The version that priced the invoice's lines; every line of one invoice has the same one.
    rateCardVersion: new DataLoader(async (ids: readonly string[]) =>
      single(
        ids,
        await db
          .selectDistinctOn([invoiceLines.invoiceId], { key: invoiceLines.invoiceId, ...versionColumns })
          .from(invoiceLines)
          .innerJoin(rateCardVersions, eq(rateCardVersions.id, invoiceLines.rateCardVersionId))
          .innerJoin(carriers, eq(carriers.id, rateCardVersions.carrierId))
          .where(and(eq(invoiceLines.tenantId, tenantId), inArray(invoiceLines.invoiceId, [...ids])))
          .orderBy(invoiceLines.invoiceId),
        (row) => row.key,
      ),
    ),

    openDiscrepancyCount: new DataLoader(async (ids: readonly string[]) => {
      const rows = await db
        .select({ key: discrepancies.invoiceId, open: count() })
        .from(discrepancies)
        .where(and(eq(discrepancies.tenantId, tenantId), inArray(discrepancies.invoiceId, [...ids]), eq(discrepancies.status, 'open')))
        .groupBy(discrepancies.invoiceId);
      return single(ids, rows, (row) => row.key).map((row) => row?.open ?? 0);
    }),

    // An invoice's discrepancy connection. Keys of one list page share their arguments, so each distinct set of
    // arguments costs one query for all the invoices that asked.
    discrepancies: new DataLoader(
      async (keys: readonly DiscrepancyArgs[]) => {
        const groups = new Map<string, DiscrepancyArgs[]>();
        for (const key of keys) {
          const group = JSON.stringify([key.status, key.first, key.after]);
          groups.set(group, [...(groups.get(group) ?? []), key]);
        }
        const results = new Map<DiscrepancyArgs, RankedRow[]>();
        for (const group of groups.values()) {
          const rows = await rankedDiscrepancies(group[0]!, group.map((key) => key.invoiceId));
          for (const key of group) results.set(key, rows.filter((row) => row.invoiceId === key.invoiceId));
        }
        return keys.map((key) => results.get(key) ?? []);
      },
      { cacheKeyFn: (key) => JSON.stringify([key.invoiceId, key.status, key.first, key.after]) },
    ),

    auditEvents: new DataLoader(async (ids: readonly string[]) =>
      grouped(
        ids,
        await db
          .select()
          .from(auditEvents)
          .where(and(eq(auditEvents.tenantId, tenantId), inArray(auditEvents.invoiceId, [...ids])))
          .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id)),
        (row) => row.invoiceId!,
      ),
    ),

    // Every dead letter of an invoice's jobs, newest first. Jobs take the content hash as their id (a split's collect
    // job prefixes it), so the open-job index finds them.
    deadLetters: new DataLoader(async (ids: readonly string[]) =>
      grouped(
        ids,
        await db
          .select({ key: invoices.id, row: deadLetters })
          .from(invoices)
          .innerJoin(
            deadLetters,
            and(
              eq(deadLetters.tenantId, invoices.tenantId),
              or(eq(deadLetters.jobId, invoices.contentSha256), eq(deadLetters.jobId, sql`'split-' || ${invoices.contentSha256}`)),
            ),
          )
          .where(tenantInvoices(ids))
          .orderBy(desc(deadLetters.createdAt)),
        (row) => row.key,
      ).map((group) => group.map(({ row }) => row)),
    ),

    // A discrepancy's relations, by the discrepancy's id.
    discrepancyInvoice: new DataLoader(async (ids: readonly string[]) =>
      single(
        ids,
        await db
          .select({ key: discrepancies.id, ...graphqlInvoiceColumns })
          .from(discrepancies)
          .innerJoin(invoices, eq(invoices.id, discrepancies.invoiceId))
          .leftJoin(carriers, eq(carriers.id, invoices.carrierId))
          .where(ofDiscrepancies(ids)),
        (row) => row.key,
      ),
    ),
    discrepancyLine: new DataLoader(async (ids: readonly string[]) =>
      single(
        ids,
        await db
          .select({ key: discrepancies.id, line: invoiceLines })
          .from(discrepancies)
          .innerJoin(invoiceLines, eq(invoiceLines.id, discrepancies.invoiceLineId))
          .where(ofDiscrepancies(ids)),
        (row) => row.key,
      ).map((row) => row?.line ?? null),
    ),
    discrepancyShipment: new DataLoader(async (ids: readonly string[]) =>
      single(
        ids,
        await db
          .select({ key: discrepancies.id, ...shipmentColumns })
          .from(discrepancies)
          .innerJoin(shipments, eq(shipments.id, discrepancies.shipmentId))
          .innerJoin(carriers, eq(carriers.id, shipments.carrierId))
          .where(ofDiscrepancies(ids)),
        (row) => row.key,
      ),
    ),
    discrepancyVersion: new DataLoader(async (ids: readonly string[]) =>
      single(
        ids,
        await db
          .select({ key: discrepancies.id, ...versionColumns })
          .from(discrepancies)
          .innerJoin(invoiceLines, eq(invoiceLines.id, discrepancies.invoiceLineId))
          .innerJoin(rateCardVersions, eq(rateCardVersions.id, invoiceLines.rateCardVersionId))
          .innerJoin(carriers, eq(carriers.id, rateCardVersions.carrierId))
          .where(ofDiscrepancies(ids)),
        (row) => row.key,
      ),
    ),

    // The invoice a dead letter's job worked on; TMS sync jobs have none.
    deadLetterInvoice: new DataLoader(async (ids: readonly string[]) =>
      single(
        ids,
        await db
          .select({ key: deadLetters.id, ...graphqlInvoiceColumns })
          .from(deadLetters)
          .innerJoin(invoices, sql`${invoices.id}::text = ${deadLetters.payload} ->> 'invoiceId'`)
          .leftJoin(carriers, eq(carriers.id, invoices.carrierId))
          .where(and(eq(deadLetters.tenantId, tenantId), inArray(deadLetters.id, [...ids]))),
        (row) => row.key,
      ),
    ),
  };
}

export type Loaders = ReturnType<typeof createLoaders>;
