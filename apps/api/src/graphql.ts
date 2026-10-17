import type { AuditAction, AuditEntry, InvoiceStatus, Resolvers } from '@freightaudit/contracts';
import { typeDefs } from '@freightaudit/contracts';
import { carriers, deadLetters, discrepancies, invoices, invoiceStatus } from '@freightaudit/db';
import { matchCarrier, overchargeCents } from '@freightaudit/domain';
import type { Queues } from '@freightaudit/pipeline';
import { and, asc, count, countDistinct, desc, eq, ilike, isNotNull, isNull, min, or, sql, sum } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import { GraphQLError, GraphQLScalarType, Kind } from 'graphql';
import { createSchema, createYoga } from 'graphql-yoga';
import { actorOf } from './actor.ts';
import { after, before, connection, cursorAt, pageSize, UUID } from './keyset.ts';
import { createLoaders, discrepancyColumns, graphqlInvoiceColumns, type Loaders } from './loaders.ts';
import { fail } from './problem.ts';
import * as review from './review.ts';

export type GraphqlDeps = { db: NodePgDatabase; queues: Queues; tenantId: string };
type Server = { req: FastifyRequest; reply: FastifyReply };
type Context = Server & { loaders: Loaders };
type Change = { field: string; from: string | null; to: string | null };

// Money crosses the wire as integer cents in a JSON number; a bigint beyond the safe range is refused, never rounded.
export const Cents = new GraphQLScalarType<bigint, number>({
  name: 'Cents',
  serialize(value) {
    const cents = typeof value === 'bigint' ? Number(value) : value;
    if (typeof cents !== 'number' || !Number.isSafeInteger(cents)) throw new TypeError('Cents must be an integer in the safe range');
    return cents;
  },
  parseValue(value) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('Cents must be an integer in the safe range');
    return BigInt(value);
  },
  parseLiteral(ast) {
    if (ast.kind !== Kind.INT || !Number.isSafeInteger(Number(ast.value))) throw new TypeError('Cents must be an integer in the safe range');
    return BigInt(ast.value);
  },
});
// Dates and times leave the resolvers as ISO 8601 strings already.
const isoString = (name: string) =>
  new GraphQLScalarType<string, string>({
    name,
    serialize: (value) => String(value),
    parseValue: (value) => String(value),
    parseLiteral: (ast) => (ast.kind === Kind.STRING ? ast.value : undefined) as string,
  });

const upper = <T extends string>(value: string) => value.toUpperCase() as T;
const iso = (at: Date | null) => at?.toISOString() ?? null;

type InvoiceRow = Omit<NonNullable<Awaited<ReturnType<Loaders['invoice']['load']>>>, 'key'>;
const toInvoice = (row: InvoiceRow) => ({
  id: row.id,
  status: upper<InvoiceStatus>(row.status),
  failureReason: row.failureReason,
  filename: row.filename,
  contentHash: row.contentSha256,
  carrier: row.carrier,
  number: row.invoiceNumber,
  proNumber: row.proNumber,
  issuedOn: row.invoiceDate,
  currency: row.currency,
  totalCents: row.totalCents,
  createdAt: row.createdAt.toISOString(),
});
type DiscrepancyRow = {
  id: string;
  type: string;
  status: string;
  expectedCents: bigint;
  billedCents: bigint;
  evidence: string;
  note: string | null;
  resolvedAt: Date | null;
  version: string;
};
const toDiscrepancy = (row: DiscrepancyRow) => ({
  id: row.id,
  type: upper<'RATE_MISMATCH'>(row.type),
  status: upper<'OPEN'>(row.status),
  expectedCents: row.expectedCents,
  billedCents: row.billedCents,
  evidence: row.evidence,
  note: row.note,
  resolvedAt: iso(row.resolvedAt),
  version: row.version,
});
type DeadLetterRow = typeof deadLetters.$inferSelect;
const toDeadLetter = (row: DeadLetterRow) => ({
  id: row.id,
  queue: row.queue,
  jobId: row.jobId,
  error: row.error,
  attempts: row.attempts,
  createdAt: row.createdAt.toISOString(),
  replayedAt: iso(row.replayedAt),
});

// What the model read. Only a valid result has lines; an invalid one keeps { problems, output } and a split upload
// { parts }, so every field is read defensively.
type ExtractionRow = NonNullable<Awaited<ReturnType<Loaders['extraction']['load']>>>;
type ReadLine = { description: string; charge_code?: string | null; amount_cents: number };
const isLine = (line: unknown): line is ReadLine =>
  typeof line === 'object' && line !== null && typeof (line as ReadLine).description === 'string' && Number.isSafeInteger((line as ReadLine).amount_cents);
function toExtraction(row: ExtractionRow) {
  const result = (typeof row.result === 'object' && row.result !== null ? row.result : {}) as Record<string, unknown>;
  const failed = row.step === 'needs_review';
  const lines = !failed && Array.isArray(result.line_items) ? result.line_items.filter(isLine) : [];
  const problems = failed && Array.isArray(result.problems) ? result.problems.filter((problem): problem is string => typeof problem === 'string') : [];
  return {
    id: row.id,
    model: row.model,
    step: row.step,
    carrierRead: typeof result.carrier === 'string' ? result.carrier : null,
    carrierMatch: row.carrierMatch ? upper<'EXACT'>(row.carrierMatch) : null,
    problems,
    lines: lines.map((line, i) => ({ lineNumber: i + 1, description: line.description, chargeCode: line.charge_code ?? null, amountCents: BigInt(line.amount_cents) })),
    extractedAt: row.createdAt.toISOString(),
  };
}

const ACTIONS: Record<string, AuditAction> = {
  status: 'STATUS_CHANGED',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  corrected: 'CORRECTED',
  discrepancy_confirmed: 'DISCREPANCY_CONFIRMED',
  discrepancy_dismissed: 'DISCREPANCY_DISMISSED',
  replayed: 'REPLAYED',
};

// An invoice's history: the upload, then every audit row. A pipeline move carries the facts behind it: how the carrier
// reading matched (rule, reading and matched name), why it was sent to review, or the failed step's error.
async function auditTrail(id: string, loaders: Loaders): Promise<AuditEntry[]> {
  const [invoice, events, extraction, letters, known] = await Promise.all([
    loaders.invoice.load(id),
    loaders.auditEvents.load(id),
    loaders.extraction.load(id),
    loaders.deadLetters.load(id),
    loaders.carriers(),
  ]);
  if (!invoice) return [];
  const read = extraction ? toExtraction(extraction) : undefined;
  const entries: AuditEntry[] = [
    { id: `received-${id}`, at: invoice.createdAt.toISOString(), actor: null, action: 'RECEIVED', detail: invoice.filename, changes: [] },
  ];
  for (const event of events) {
    const changes = (Array.isArray(event.changes) ? event.changes : []) as Change[];
    const move = event.action === 'status' ? changes.find((change) => change.field === 'status') : undefined;
    let detail = event.reason;
    if (move?.from === 'extracting' && move.to === 'extracted' && read?.carrierRead) {
      changes.push({ field: 'carrier', from: read.carrierRead, to: matchCarrier(read.carrierRead, known)?.carrier.name ?? null });
      detail = extraction?.carrierMatch ?? 'no_match';
    } else if (move?.to === 'needs_review') {
      detail = move.from === 'reconciling' ? (extraction?.reviewReason ?? null) : (read?.problems[0] ?? null);
    } else if (move?.to === 'failed') {
      const queue = move.from === 'extracting' ? 'extract' : 'reconcile';
      detail = letters.find((letter) => letter.queue === queue && letter.createdAt <= event.createdAt)?.error ?? null;
    }
    entries.push({ id: event.id, at: event.createdAt.toISOString(), actor: event.actor, action: ACTIONS[event.action] ?? 'STATUS_CHANGED', detail, changes });
  }
  return entries;
}

// The invoice list's search: invoice number, PRO number or carrier name, ignoring case, with LIKE's wildcards taken
// literally. ponytail: a sequential scan of the tenant's invoices; a trigram index on the three columns past about 100k.
function searchFor(raw: string | null | undefined) {
  const term = raw?.trim();
  if (!term) return undefined;
  if (term.length > 100) throw fail(400, 'search is longer than 100 characters');
  const pattern = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  return or(ilike(invoices.invoiceNumber, pattern), ilike(invoices.proNumber, pattern), ilike(carriers.name, pattern));
}

function createResolvers({ db, queues, tenantId }: GraphqlDeps): Resolvers<Context> {
  const deps = { db, queues, tenantId };
  const invoiceById = async (loaders: Loaders, id: string) => {
    const row = UUID.test(id) ? await loaders.invoice.load(id) : null;
    return row && toInvoice(row);
  };
  const discrepancyById = async (id: string) => {
    const [row] = await db.select(discrepancyColumns).from(discrepancies).where(and(eq(discrepancies.tenantId, tenantId), eq(discrepancies.id, id)));
    return toDiscrepancy(row!);
  };
  return {
    Query: {
      health: () => 'ok',
      async invoices(_, args) {
        if (args.after && args.before) throw fail(400, 'give after or before, not both');
        // A page goes back with last or before; first defaults to 25, so it cannot say.
        const last = args.last ?? undefined;
        const back = last !== undefined || Boolean(args.before);
        const size = last !== undefined ? pageSize(last, 'last') : pageSize(args.first);
        const matching = and(
          eq(invoices.tenantId, tenantId),
          args.status ? eq(invoices.status, args.status.toLowerCase() as typeof invoices.$inferSelect.status) : undefined,
          searchFor(args.search),
        );
        const rows = await db
          .select(graphqlInvoiceColumns)
          .from(invoices)
          .leftJoin(carriers, eq(carriers.id, invoices.carrierId))
          .where(and(matching, back ? before(invoices.createdAt, invoices.id, args.before) : after(invoices.createdAt, invoices.id, args.after)))
          .orderBy(...(back ? [asc(invoices.createdAt), asc(invoices.id)] : [desc(invoices.createdAt), desc(invoices.id)]))
          .limit(size + 1);
        const page = back ? rows.slice(0, size).reverse() : rows.slice(0, size);
        const head = page[0];
        // ponytail: exact counts read every matching invoice of the tenant; estimates past about 100k of them.
        const newer = head
          ? sql<number>`count(*) FILTER (WHERE (${invoices.createdAt}, ${invoices.id}) > (${head.cursorAt}::timestamptz, ${head.id}::uuid))`
          : sql<number>`0`;
        const [counts] = await db
          .select({ total: count(), newer: newer.mapWith(Number) })
          .from(invoices)
          .leftJoin(carriers, eq(carriers.id, invoices.carrierId))
          .where(matching);
        const totalCount = counts!.total;
        // An empty page after a cursor sits past every match; any other empty page comes before them all.
        const offset = head ? counts!.newer : args.after ? totalCount : 0;
        const flags = back
          ? { hasPreviousPage: rows.length > size, hasNextPage: offset + page.length < totalCount }
          : { hasNextPage: rows.length > size, hasPreviousPage: offset > 0 };
        return { ...connection(page, page.length, toInvoice, flags), totalCount, offset };
      },
      async invoiceSummary() {
        const reconciledClean = sql`${invoices.status} = 'reconciled' AND NOT EXISTS (SELECT 1 FROM ${discrepancies} WHERE ${discrepancies.invoiceId} = ${invoices.id})`;
        const [statuses, [open], [letters]] = await Promise.all([
          db
            .select({
              status: invoices.status,
              count: count(),
              recent: sql<number>`count(*) FILTER (WHERE ${invoices.createdAt} > now() - interval '7 days')`.mapWith(Number),
              clean: sql<number>`count(*) FILTER (WHERE ${reconciledClean})`.mapWith(Number),
            })
            .from(invoices)
            .where(eq(invoices.tenantId, tenantId))
            .groupBy(invoices.status),
          db
            .select({
              count: count(),
              invoices: countDistinct(discrepancies.invoiceId),
              oldest: min(discrepancies.createdAt),
              billed: sum(discrepancies.billedCents),
              expected: sum(discrepancies.expectedCents),
            })
            .from(discrepancies)
            .where(and(eq(discrepancies.tenantId, tenantId), eq(discrepancies.status, 'open'))),
          db.select({ count: count() }).from(deadLetters).where(and(eq(deadLetters.tenantId, tenantId), isNull(deadLetters.replayedAt))),
        ]);
        const byStatus = new Map(statuses.map((row) => [row.status, row.count]));
        const added = (field: 'recent' | 'clean') => statuses.reduce((total, row) => total + row[field], 0);
        return {
          statusCounts: invoiceStatus.enumValues.map((status) => ({ status: upper<InvoiceStatus>(status), count: byStatus.get(status) ?? 0 })),
          receivedLast7Days: added('recent'),
          openFindings: open!.count,
          invoicesWithOpenFindings: open!.invoices,
          oldestOpenFindingAt: iso(open!.oldest),
          openOverchargeCents: overchargeCents({ billedCents: BigInt(open!.billed ?? 0), expectedCents: BigInt(open!.expected ?? 0) }),
          matchedRateCard: added('clean'),
          openDeadLetters: letters!.count,
        };
      },
      invoice: (_, { id }, { loaders }) => invoiceById(loaders, id),
      async discrepancies(_, args) {
        const first = pageSize(args.first);
        const rows = await db
          .select({ ...discrepancyColumns, cursorAt: cursorAt(discrepancies.createdAt) })
          .from(discrepancies)
          .where(
            and(
              eq(discrepancies.tenantId, tenantId),
              args.status ? eq(discrepancies.status, args.status.toLowerCase() as 'open') : undefined,
              after(discrepancies.createdAt, discrepancies.id, args.after),
            ),
          )
          .orderBy(desc(discrepancies.createdAt), desc(discrepancies.id))
          .limit(first + 1);
        return connection(rows, first, toDiscrepancy);
      },
      async deadLetters(_, args) {
        const first = pageSize(args.first);
        const replayed = args.status === 'OPEN' ? isNull(deadLetters.replayedAt) : args.status === 'REPLAYED' ? isNotNull(deadLetters.replayedAt) : undefined;
        const rows = await db
          .select({ row: deadLetters, id: deadLetters.id, cursorAt: cursorAt(deadLetters.createdAt) })
          .from(deadLetters)
          .where(and(eq(deadLetters.tenantId, tenantId), replayed, after(deadLetters.createdAt, deadLetters.id, args.after)))
          .orderBy(desc(deadLetters.createdAt), desc(deadLetters.id))
          .limit(first + 1);
        return connection(rows, first, ({ row }) => toDeadLetter(row));
      },
      carriers: async (_, __, { loaders }) => loaders.carriers(),
    },

    Mutation: {
      async resolveDiscrepancy(_, { id, decision, note }, { req }) {
        await review.resolveDiscrepancy(deps, actorOf(req), id, decision === 'CONFIRM' ? 'confirmed' : 'dismissed', note);
        return discrepancyById(id);
      },
      async approveInvoice(_, { id }, { req, loaders }) {
        await review.approveInvoice(deps, actorOf(req), id);
        return (await invoiceById(loaders, id))!;
      },
      async decideInvoice(_, { id, decision, seen, requestId }, { req, loaders }) {
        await review.decideInvoice(deps, actorOf(req), id, decision, seen, requestId);
        return (await invoiceById(loaders, id))!;
      },
      async correctInvoice(_, { id, carrierId, proNumber }, { req, loaders }) {
        await review.correctInvoice(deps, actorOf(req), id, carrierId, proNumber);
        return (await invoiceById(loaders, id))!;
      },
      async rejectInvoice(_, { id, reason }, { req, loaders }) {
        await review.rejectInvoice(deps, actorOf(req), id, reason);
        return (await invoiceById(loaders, id))!;
      },
      async replayDeadLetter(_, { id }, { req }) {
        const replayed = await review.replay(deps, actorOf(req), id);
        const [row] = await db.select().from(deadLetters).where(eq(deadLetters.id, replayed.id));
        return toDeadLetter(row!);
      },
    },

    Invoice: {
      lineItems: async (parent, _, { loaders }) =>
        (await loaders.lineItems.load(parent.id!)).map((line) => ({
          id: line.id,
          lineNumber: line.lineNumber,
          description: line.description,
          chargeCode: line.chargeCode,
          amountCents: line.amountCents,
        })),
      shipment: (parent, _, { loaders }) => loaders.shipment.load(parent.id!),
      rateCardVersion: (parent, _, { loaders }) => loaders.rateCardVersion.load(parent.id!),
      async discrepancies(parent, args, { loaders }) {
        const first = pageSize(args.first);
        const status = args.status ? (args.status.toLowerCase() as 'open') : undefined;
        const rows = await loaders.discrepancies.load({ invoiceId: parent.id!, status, first, after: args.after });
        return connection(rows, first, toDiscrepancy);
      },
      openDiscrepancyCount: (parent, _, { loaders }) => loaders.openDiscrepancyCount.load(parent.id!),
      extraction: async (parent, _, { loaders }) => {
        const row = await loaders.extraction.load(parent.id!);
        return row && toExtraction(row);
      },
      async reviewReason(parent, _, { loaders }) {
        if (parent.status !== 'NEEDS_REVIEW') return null;
        const row = await loaders.extraction.load(parent.id!);
        if (!row) return null;
        if (row.reviewReason) return row.reviewReason;
        return toExtraction(row).problems.some((problem) => problem.startsWith('fallback_page_cap')) ? 'fallback_page_cap' : 'invalid_output';
      },
      auditTrail: (parent, _, { loaders }) => auditTrail(parent.id!, loaders),
      async deadLetter(parent, _, { loaders }) {
        if (parent.status !== 'FAILED') return null;
        const open = (await loaders.deadLetters.load(parent.id!)).find((letter) => letter.replayedAt === null);
        return open ? toDeadLetter(open) : null;
      },
    },

    Discrepancy: {
      invoice: async (parent, _, { loaders }) => toInvoice((await loaders.discrepancyInvoice.load(parent.id!))!),
      lineItem: async (parent, _, { loaders }) => {
        const line = await loaders.discrepancyLine.load(parent.id!);
        return line && { id: line.id, lineNumber: line.lineNumber, description: line.description, chargeCode: line.chargeCode, amountCents: line.amountCents };
      },
      shipment: (parent, _, { loaders }) => loaders.discrepancyShipment.load(parent.id!),
      rateCardVersion: (parent, _, { loaders }) => loaders.discrepancyVersion.load(parent.id!),
    },

    DeadLetter: {
      invoice: async (parent, _, { loaders }) => {
        const row = await loaders.deadLetterInvoice.load(parent.id!);
        return row && toInvoice(row);
      },
    },
  };
}

// Expected refusals (a GraphQLError with a code) and client errors (a status below 500, such as a bad cursor or X-Actor)
// reach the client. Anything else becomes "Unexpected error." and is logged by name and SQLSTATE only, since a Drizzle
// error's message lists every bound value.
function maskError(log: FastifyBaseLogger, error: unknown, message: string) {
  const original = error instanceof GraphQLError ? (error.originalError ?? error) : error;
  if (original instanceof GraphQLError) return error as GraphQLError;
  const status = (original as { statusCode?: unknown } | undefined)?.statusCode;
  if (typeof status === 'number' && status < 500) return new GraphQLError((original as Error).message, { extensions: { code: 'BAD_USER_INPUT' } });
  const code = (original as { cause?: { code?: unknown } } | undefined)?.cause?.code;
  log.error({ err: { type: (original as Error | undefined)?.name, code: typeof code === 'string' ? code : undefined } }, 'graphql resolver failed');
  return new GraphQLError(message, { extensions: { code: 'INTERNAL_SERVER_ERROR' } });
}

// GraphQL over Fastify. Without deps only health resolves (unit tests build the app without a database).
export function createGraphql(log: FastifyBaseLogger, deps?: GraphqlDeps) {
  const resolvers = deps ? createResolvers(deps) : { Query: { health: () => 'ok' } };
  const scalars = { Cents, Date: isoString('Date'), DateTime: isoString('DateTime') };
  return createYoga<Server>({
    // Resolvers<Context> types every resolver already; graphql-tools only wants an index signature, hence the cast.
    schema: createSchema<Context>({ typeDefs, resolvers: [scalars, resolvers] as never }),
    context: () => (deps ? { loaders: createLoaders(deps.db, deps.tenantId) } : {}),
    // Yoga's own logger would print the original error, bound values included; maskError logs instead.
    logging: false,
    graphiql: false,
    landingPage: false,
    // No browser calls the api, so it sends no CORS headers.
    cors: false,
    maskedErrors: { maskError: (error, message) => maskError(log, error, message) },
  });
}
