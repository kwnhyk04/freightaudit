import { discrepancies, extractions, invoiceLines, invoices, rateCardBands, rateCards, rateCardVersions, shipments } from '@freightaudit/db';
import { currencyReview, reconcileInvoice, versionInForce } from '@freightaudit/domain';
import { type ExtractedInvoice, PermanentError, TransientError } from '@freightaudit/llm';
import type { InvoiceJob } from '@freightaudit/pipeline';
import type { Job } from 'bullmq';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { Deps, Tx } from './workers.ts';

// The domain throws RangeError for terms it cannot price, such as bands that do not start at mile 0; retries cannot help.
function priced<T>(run: () => T) {
  try {
    return run();
  } catch (err) {
    if (err instanceof RangeError) throw new PermanentError(err.message);
    throw err;
  }
}

// Checks an extracted invoice against its shipment and the rate card version in force on the ship date, by the rules in
// packages/domain, and saves its lines and findings. Safe to rerun: they are written in one transaction with the final
// status, under a lock on the invoice, so a second run waits, finds the invoice done and writes nothing.
export async function reconcile({ db }: Pick<Deps, 'db'>, { data }: Pick<Job<InvoiceJob>, 'data'>) {
  const { invoiceId } = data;
  const [invoice] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice) throw new PermanentError(`invoice ${invoiceId} not found`);
  if (invoice.status === 'failed') throw new TransientError('invoice is still failed; waiting for its replay to commit');
  // A split upload has no lines of its own (its extraction lists parts); the parts are reconciled one by one.
  const [split] = await db
    .select({ id: extractions.id })
    .from(extractions)
    .where(and(eq(extractions.invoiceId, invoiceId), sql`${extractions.result} ? 'parts'`));
  if (split || (invoice.status !== 'extracted' && invoice.status !== 'reconciling')) return { invoiceId, skipped: invoice.status };
  // Committed on its own, so that a final failure finds the invoice reconciling and marks it failed.
  await db.update(invoices).set({ status: 'reconciling' }).where(and(eq(invoices.id, invoiceId), eq(invoices.status, 'extracted')));
  return db.transaction((tx) => check(tx, invoiceId));
}

// Sends the invoice to needs_review with the reason kept on its extraction, and writes nothing else.
async function review(tx: Tx, invoiceId: string, reason: string) {
  await tx.update(extractions).set({ reviewReason: reason }).where(eq(extractions.invoiceId, invoiceId));
  await tx.update(invoices).set({ status: 'needs_review' }).where(eq(invoices.id, invoiceId));
  return { invoiceId, status: 'needs_review' as const, reason };
}

async function check(tx: Tx, invoiceId: string) {
  const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for('update');
  if (invoice?.status !== 'reconciling') return { invoiceId, skipped: invoice?.status };
  const { tenantId, carrierId, proNumber, currency } = invoice;
  const [extraction] = await tx.select({ result: extractions.result }).from(extractions).where(eq(extractions.invoiceId, invoiceId));
  if (!extraction) throw new PermanentError('invoice has no extraction');
  // Rate cards are in USD, so an invoice in any other currency, or in none, cannot be priced.
  const unsupported = currencyReview(currency);
  if (unsupported) return review(tx, invoiceId, unsupported);
  // Locked, so reconciles of one shipment run one at a time and each sees the lines the others billed.
  const [shipment] =
    carrierId && proNumber
      ? await tx
          .select()
          .from(shipments)
          .where(and(eq(shipments.tenantId, tenantId), eq(shipments.carrierId, carrierId), eq(shipments.proNumber, proNumber)))
          .for('update')
      : [];
  // The carrier or PRO number read from the document matches no shipment, so the extraction cannot be trusted.
  if (!shipment) return review(tx, invoiceId, 'no_shipment_match');
  const { miles, shippedOn } = shipment;
  if (miles === null) throw new PermanentError('shipment has no miles');

  // Every version of the carrier, its effective range as UTC days (null where open); the domain picks the one in force.
  const versions = await tx
    .select({
      id: rateCardVersions.id,
      version: rateCardVersions.version,
      from: sql<string | null>`to_char(lower(${rateCardVersions.effective}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      to: sql<string | null>`to_char(upper(${rateCardVersions.effective}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      minimumCents: rateCardVersions.minimumCents,
      fuelBp: rateCardVersions.fuelBp,
    })
    .from(rateCardVersions)
    .where(and(eq(rateCardVersions.tenantId, tenantId), eq(rateCardVersions.carrierId, shipment.carrierId)));
  const version = priced(() => versionInForce(versions, shippedOn));
  if (!version) throw new PermanentError(`no rate card version in force on ${shippedOn}`);
  const bands = await tx
    .select({ fromMile: rateCardBands.fromMile, centsPerMile: rateCardBands.centsPerMile })
    .from(rateCardBands)
    .where(eq(rateCardBands.rateCardVersionId, version.id))
    .orderBy(asc(rateCardBands.fromMile));
  const { minimumCents, fuelBp } = version;
  if (minimumCents === null || fuelBp === null || bands.length === 0) throw new PermanentError(`rate card version ${version.version} has no linehaul terms`);
  const accessorials = await tx
    .select({ chargeCode: rateCards.chargeCode, rateCents: rateCards.rateCents })
    .from(rateCards)
    .where(eq(rateCards.rateCardVersionId, version.id));
  // Charges on the other invoices already reconciled against this shipment.
  const earlier = await tx
    .select({ chargeCode: invoiceLines.chargeCode })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(and(eq(invoices.shipmentId, shipment.id), ne(invoices.id, invoiceId)));

  // Numbered by position, as the contracts define a line number, whatever numbers the document printed.
  const items = (extraction.result as ExtractedInvoice).line_items;
  const lines = items.map((item, i) => ({ lineNumber: i + 1, chargeCode: item.charge_code, amountCents: BigInt(item.amount_cents) }));
  const terms = {
    ...version,
    rates: { bands, minimumCents, fuelBp: BigInt(fuelBp) },
    accessorials: Object.fromEntries(accessorials.map((rate) => [rate.chargeCode, rate.rateCents])),
  };
  const { discrepancies: found } = priced(() =>
    reconcileInvoice([terms], { shippedOn, miles, lines, billedBefore: earlier.map((line) => line.chargeCode) }),
  );

  const saved = await tx
    .insert(invoiceLines)
    .values(lines.map((line, i) => ({ tenantId, invoiceId, ...line, description: items[i]!.description, rateCardVersionId: version.id })))
    .returning({ id: invoiceLines.id, lineNumber: invoiceLines.lineNumber });
  const lineIds = new Map(saved.map((line) => [line.lineNumber, line.id]));
  if (found.length > 0) {
    await tx.insert(discrepancies).values(
      found.map(({ lineNumber, type, expectedCents, billedCents, evidence }) => ({
        tenantId,
        invoiceId,
        invoiceLineId: lineIds.get(lineNumber),
        shipmentId: shipment.id,
        type,
        expectedCents,
        billedCents,
        evidence,
      })),
    );
  }
  // Findings leave the invoice reconciled; they wait as open discrepancies in the review queue.
  await tx.update(invoices).set({ status: 'reconciled', shipmentId: shipment.id }).where(eq(invoices.id, invoiceId));
  return { invoiceId, status: 'reconciled' as const, discrepancies: found.length };
}
