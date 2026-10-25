import { auditEvents, carriers, deadLetters, discrepancies, invoices, llmCalls } from '@freightaudit/db';
import { type DashboardInvoice, dashboardOf, dashboardSpan, divRound, type FindingAmounts } from '@freightaudit/domain';
import { and, count, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

const DAY = 86_400_000;
const day = (value: string) => Date.parse(`${value}T00:00:00Z`);

// Query.dashboard, from a window the resolver checked: one row of facts per invoice the figures read, counted by
// dashboardOf as the web's sample is, then what only the database knows: model cost and the pipeline now. A split upload
// counts as its parts. ponytail: reads every invoice of up to 112 days and sums today's model calls with no index on
// llm_calls.created_at; count in SQL and add the index past about 100k invoices in that span.
export async function dashboardFigures({ db, tenantId }: { db: NodePgDatabase; tenantId: string }, from: string, to: string) {
  const span = dashboardSpan(from, to);
  const start = day(from);
  const end = day(to) + DAY;
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const read = and(eq(invoices.tenantId, tenantId), gte(invoices.createdAt, span.start), lt(invoices.createdAt, span.end));
  const costOf = (first: number, last: number) =>
    sql`coalesce(sum(${llmCalls.costMicroUsd}) FILTER (WHERE ${invoices.createdAt} >= ${new Date(first)} AND ${invoices.createdAt} < ${new Date(last)}), 0)`.mapWith(BigInt);
  const tokensOf = (claude: boolean) =>
    sql`coalesce(sum(${llmCalls.inputTokens} + ${llmCalls.outputTokens}) FILTER (WHERE (${llmCalls.provider} = 'anthropic') = ${claude}), 0)`.mapWith(Number);
  const [rows, findings, [cost], [waiting], [letters], [tokens]] = await Promise.all([
    db
      .select({
        id: invoices.id,
        receivedAt: invoices.createdAt,
        status: invoices.status,
        carrier: carriers.name,
        shipment: sql<boolean>`${invoices.shipmentId} IS NOT NULL`,
        corrected: sql<boolean>`EXISTS (SELECT 1 FROM ${auditEvents} WHERE ${auditEvents.invoiceId} = ${invoices.id} AND ${auditEvents.action} = 'corrected')`,
        // The pipeline's first move to a status it stops at; a reviewer's moves name their actor.
        settledAt: sql`(SELECT min(${auditEvents.createdAt}) FROM ${auditEvents} WHERE ${auditEvents.invoiceId} = ${invoices.id} AND ${auditEvents.action} = 'status'
          AND ${auditEvents.actor} IS NULL AND ${auditEvents.changes} -> 0 ->> 'to' IN ('reconciled', 'needs_review', 'failed'))`.mapWith(auditEvents.createdAt),
      })
      .from(invoices)
      .leftJoin(carriers, eq(carriers.id, invoices.carrierId))
      .where(and(read, sql`NOT EXISTS (SELECT 1 FROM invoices part WHERE part.parent_invoice_id = ${invoices.id})`)),
    db
      .select({ invoiceId: discrepancies.invoiceId, status: discrepancies.status, billedCents: discrepancies.billedCents, expectedCents: discrepancies.expectedCents })
      .from(discrepancies)
      .innerJoin(invoices, eq(invoices.id, discrepancies.invoiceId))
      .where(read),
    db
      .select({ window: costOf(start, end), previous: costOf(start - (end - start), start) })
      .from(llmCalls)
      .innerJoin(invoices, eq(invoices.id, llmCalls.invoiceId))
      .where(and(eq(llmCalls.tenantId, tenantId), gte(invoices.createdAt, new Date(start - (end - start))), lt(invoices.createdAt, new Date(end)))),
    db
      .select({ count: count() })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), inArray(invoices.status, ['received', 'extracting']))),
    db
      .select({ count: count() })
      .from(deadLetters)
      .where(and(eq(deadLetters.tenantId, tenantId), isNull(deadLetters.replayedAt))),
    db
      .select({ claude: tokensOf(true), free: tokensOf(false) })
      .from(llmCalls)
      .where(and(eq(llmCalls.tenantId, tenantId), gte(llmCalls.createdAt, midnight))),
  ]);
  const byInvoice = new Map<string, FindingAmounts[]>();
  for (const { invoiceId, ...finding } of findings) byInvoice.set(invoiceId, [...(byInvoice.get(invoiceId) ?? []), finding]);
  const facts: DashboardInvoice[] = rows.map(({ id, settledAt, ...row }) => ({ ...row, settledAt: (settledAt as Date | null) ?? null, findings: byInvoice.get(id) ?? [] }));
  const { window, previous, weeks, carriers: top } = dashboardOf(facts, from, to);
  const perInvoice = (micro: bigint, received: number) => (received > 0 ? Number(divRound(micro, BigInt(received))) : null);
  return {
    window: { ...window, modelCostPerInvoiceMicroUsd: perInvoice(cost!.window, window.received) },
    previous: { ...previous, modelCostPerInvoiceMicroUsd: perInvoice(cost!.previous, previous.received) },
    weeks,
    carriers: top,
    pipeline: { waitingToBeRead: waiting!.count, openDeadLetters: letters!.count, claudeTokensToday: tokens!.claude, freeModelTokensToday: tokens!.free },
  };
}
