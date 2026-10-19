import type { InvoiceQuery } from '@freightaudit/contracts/graphql';
import { formatMoney } from '@freightaudit/domain';
import Link from 'next/link';
import type { MarkValues } from '../lib/marks.ts';
import {
  decideWords,
  decisionLabel,
  decisionQuestion,
  FINDING,
  findingText,
  findingTitle,
  holdOf,
  IN_FLIGHT,
  invoiceAmounts,
  lineAmounts,
  lineLabel,
  overcharge,
  plural,
  reviewReason,
  statusLabel,
  trailRows,
} from '../lib/labels.ts';
import { ActionForm, BulkDecision, DecideForm, DialogAction, StatusPoller } from './client.tsx';
import { Badge, Day, Difference, Moment, Money, StatusBadge } from './ui.tsx';
import { DocumentViewer } from './viewer.tsx';
import type { Where } from './views.tsx';

type Detail = NonNullable<InvoiceQuery['invoice']>;
type Finding = Detail['discrepancies']['edges'][number]['node'];
type Amounts = ReturnType<typeof invoiceAmounts>;
// The bulk decision sends every finding it saw; the page reads at most 100, so a longer list decides one by one.
const MAX_BULK = 100;
// A charge code may break after its underscores, so a narrow charges table keeps every column in view.
const codeBreaks = (code: string) => code.split('_').flatMap((part, i, parts) => (i < parts.length - 1 ? [`${part}_`, <wbr key={i} />] : [part]));

// One invoice: the document beside what was read from it, the findings to decide, every charge against the rate card,
// the facts and the audit trail. base prefixes every link; readOnly (the sample) hides every action; example (the seed's
// rows, which have no document) asks for no document and says so.
export function InvoiceDetail({ data, base, readOnly, documentSrc, example = false }: Where & { data: InvoiceQuery; documentSrc: string; example?: boolean }) {
  const invoice = data.invoice!;
  const extraction = invoice.extraction;
  const findings = invoice.discrepancies.edges.map(({ node }) => node);
  const lines = invoice.lineItems.length > 0 ? invoice.lineItems : (extraction?.lines ?? []);
  const byLine = new Map(findings.filter((finding) => finding.lineItem).map((finding) => [finding.lineItem!.lineNumber, finding]));
  // Only a priced invoice has expected amounts; before that, every line is as billed by definition.
  const priced = Boolean(invoice.rateCardVersion);
  const money = priced && invoice.totalCents !== null ? invoiceAmounts(invoice.totalCents, findings) : undefined;
  const open = invoice.openDiscrepancyCount;
  const hold = holdOf(invoice.status, findings);
  const carrier = invoice.carrier ?? extraction?.carrierRead;
  // Before extraction, or when it failed, the file is all there is: the facts shrink to it.
  const unread = !extraction && !invoice.number;
  const correctable = invoice.status === 'NEEDS_REVIEW' && invoice.reviewReason === 'no_shipment_match';
  // The sample shows the same fields, disabled and without a submit button.
  const correction = (
    <>
      <label>
        Carrier
        <select name="carrierId" defaultValue={data.carriers.find((each) => each.name === invoice.carrier)?.id ?? ''} disabled={readOnly}>
          <option value="">Keep as read</option>
          {data.carriers.map((each) => (
            <option key={each.id} value={each.id}>
              {each.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        PRO number
        <input name="proNumber" defaultValue={invoice.proNumber ?? ''} className="id" maxLength={64} disabled={readOnly} />
      </label>
    </>
  );
  return (
    <>
      <div className="page-head detail-head">
        <div>
          <nav aria-label="Breadcrumb" className="crumbs">
            <Link href={`${base}/invoices`}>Invoices</Link>
          </nav>
          <div className="row title">
            <h1 className="id">{invoice.number ?? invoice.filename}</h1>
            {carrier && <span className="muted">{carrier}</span>}
            <StatusBadge status={invoice.status} open={open} hold={hold} />
          </div>
          <p className="muted">
            Received <Moment value={invoice.createdAt} />
            {open > 0 && ` · ${plural(open, 'open finding')}`}
            {money && money.standingCents > 0n && (
              <>
                {' · billed '}
                <strong className="text-bad">{formatMoney(money.standingCents, invoice.currency)} over the rate card</strong>
              </>
            )}
          </p>
        </div>
        {!readOnly && <InvoiceActions invoice={invoice} findings={findings} money={money} />}
      </div>
      <StatusPoller active={IN_FLIGHT.has(invoice.status)} label={statusLabel(invoice.status, open, hold)} />
      <div className="review">
        {example ? (
          <section className="doc" aria-label="Invoice document">
            <p className="empty">Example data: the seed created this invoice without a document.</p>
          </section>
        ) : (
          <DocumentViewer key={documentSrc} src={documentSrc} filename={invoice.filename} values={markValues(invoice, lines, byLine)} />
        )}
        <div>
          {invoice.status === 'NEEDS_REVIEW' && (
            <section className="panel attention" aria-label="Reading needs a check">
              <h2>Reading needs a check</h2>
              <p>{reviewReason(invoice.reviewReason)}</p>
              {extraction && extraction.problems.length > 0 && (
                <ul className="faint">
                  {extraction.problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}
              {correctable && (
                <div id="correct" style={{ marginTop: 12 }}>
                  {readOnly ? (
                    <>
                      <div className="row">{correction}</div>
                      <p className="faint" style={{ marginTop: 8 }}>
                        In the live app a reviewer corrects the carrier or PRO number here, then re-runs matching.
                      </p>
                    </>
                  ) : (
                    <ActionForm hidden={{ intent: 'correct', id: invoice.id }} submit="Re-run matching" tone="primary">
                      {correction}
                    </ActionForm>
                  )}
                </div>
              )}
            </section>
          )}
          {invoice.status === 'FAILED' && (
            <section className="panel attention bad" aria-label="Failure">
              <h2>Why it failed</h2>
              <p>{invoice.failureReason ?? 'The step used up its retries.'}</p>
            </section>
          )}
          {findings.length > 0 && (
            <section className="panel" aria-labelledby="findings-title">
              <h2 id="findings-title">
                Findings <span className="faint-heading">{open} open</span>
              </h2>
              <div className="findings">
                {findings.map((finding) => {
                  const line = finding.lineItem && lines.find((each) => each.lineNumber === finding.lineItem!.lineNumber);
                  const title = `finding-${finding.id}`;
                  const decision = decisionLabel(finding.status, finding.type);
                  return (
                    <article key={finding.id} aria-labelledby={title}>
                      {/* Read as title, text, amount, then the decision; CSS keeps the amount in the left column. */}
                      <div className="finding-body">
                        <div className="row">
                          <h3 id={title}>{findingTitle(finding.type, line?.description)}</h3>
                          <Badge tone={decision.tone}>{decision.label}</Badge>
                        </div>
                        <p className="muted">{findingText(finding, line, invoice.rateCardVersion?.version, invoice.currency)}</p>
                        {finding.note && <p className="faint">Note: {finding.note}</p>}
                      </div>
                      <Difference cents={overcharge(finding)} currency={invoice.currency} />
                      {!readOnly && finding.status === 'OPEN' && invoice.status === 'RECONCILED' && <DecideForm id={finding.id} describedBy={title} words={decideWords(finding.type)} />}
                    </article>
                  );
                })}
              </div>
            </section>
          )}
          {unread ? (
            <section className="panel" aria-label="Invoice details">
              <dl className="facts">
                <dt>File</dt>
                <dd>
                  {invoice.filename} <span className="faint">received </span>
                  <Moment value={invoice.createdAt} />
                </dd>
              </dl>
              <p className="faint" style={{ marginTop: 8 }}>
                {example ? 'Example data: there is no file to read.' : invoice.status === 'FAILED' ? 'Nothing was read from the file.' : 'The pipeline has not read the file yet.'}
              </p>
            </section>
          ) : (
            <>
              <section className="panel" aria-labelledby="charges-title">
                <h2 id="charges-title">{priced ? 'Charges against the rate card' : 'Charges as read'}</h2>
                {lines.length === 0 ? (
                  <p className="faint">No lines were read.</p>
                ) : (
                  <div className="table-wrap" role="region" aria-labelledby="charges-title" tabIndex={0}>
                    <table className="charges">
                      <thead>
                        <tr>
                          <th scope="col" className="num">
                            #
                          </th>
                          <th scope="col">Description</th>
                          <th scope="col">Code</th>
                          <th scope="col" className="num">
                            Billed
                          </th>
                          {priced && (
                            <>
                              <th scope="col" className="num">
                                Expected
                              </th>
                              <th scope="col" className="num">
                                Difference
                              </th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line) => {
                          const finding = byLine.get(line.lineNumber);
                          const amounts = lineAmounts(line.amountCents, finding);
                          return (
                            <tr key={line.lineNumber} className={finding && finding.status !== 'DISMISSED' ? 'flagged' : undefined}>
                              <td className="num">{line.lineNumber}</td>
                              <td>
                                {lineLabel(line.description)}
                                {finding && <div className="faint nowrap">{FINDING[finding.type]}</div>}
                              </td>
                              <td className="id">{line.chargeCode ? codeBreaks(line.chargeCode) : <span className="faint">None</span>}</td>
                              <td className="num">
                                <Money cents={line.amountCents} currency={invoice.currency} />
                              </td>
                              {priced && (
                                <>
                                  <td className="num muted">
                                    <Money cents={amounts.expectedCents} currency={invoice.currency} />
                                  </td>
                                  <td className="num">
                                    <Difference cents={amounts.differenceCents} currency={invoice.currency} />
                                  </td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <th scope="row" colSpan={3}>
                            Total
                          </th>
                          <td className="num">
                            <Money cents={invoice.totalCents} currency={invoice.currency} />
                          </td>
                          {priced && money && (
                            <>
                              <td className="num">
                                <Money cents={money.expectedCents} currency={invoice.currency} />
                              </td>
                              <td className="num">
                                <Difference cents={money.standingCents} currency={invoice.currency} />
                              </td>
                            </>
                          )}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </section>
              <InvoiceFacts invoice={invoice} correct={correctable && !readOnly} example={example} />
            </>
          )}
          <section className="panel" aria-labelledby="trail-title">
            <h2 id="trail-title">Audit trail</h2>
            <ol className="trail">
              {trailRows(invoice, findings, example).map((row) => (
                <li key={row.id}>
                  <Moment value={row.at} />
                  <div>
                    <strong>{row.verb}</strong>
                    {row.rest && <span className="by"> {row.rest}</span>}
                    {row.notes.map((note) => (
                      <div key={note} className="faint">
                        {note}
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}

// The decisions an invoice offers in its state. One that needs review or is checked can be rejected with a reason; a
// checked one's open findings close with it.
function InvoiceActions({ invoice, findings, money }: { invoice: Detail; findings: Finding[]; money?: Amounts }) {
  const open = invoice.openDiscrepancyCount;
  const reject = (
    <DialogAction label="Reject" title="Reject this invoice">
      {open > 0 && <p className="faint">Its {plural(open, 'open finding')} {open === 1 ? 'is' : 'are'} closed with it.</p>}
      <ActionForm hidden={{ intent: 'reject', id: invoice.id }} submit="Reject invoice" tone="danger">
        <label style={{ width: '100%' }}>
          Reason, kept in the audit trail
          <textarea name="reason" required maxLength={1000} rows={3} />
        </label>
      </ActionForm>
    </DialogAction>
  );
  if (invoice.status === 'NEEDS_REVIEW') {
    return (
      <div className="row">
        {reject}
        <ActionForm hidden={{ intent: 'approve', id: invoice.id }} submit="Approve as billed" confirm="Approve without a matched shipment? The carrier is paid what it billed." />
      </div>
    );
  }
  if (invoice.status === 'FAILED' && invoice.deadLetter) return <ActionForm hidden={{ intent: 'replay', id: invoice.deadLetter.id }} submit="Replay" />;
  if (invoice.status !== 'RECONCILED') return null;
  return (
    <div className="row">
      {reject}
      {approval(invoice, findings, money)}
    </div>
  );
}

// How a checked invoice comes to approval. A possible duplicate is decided on its own first, and once confirmed the
// invoice can only be rejected. While every charge is open, three buttons decide them all at once; once a reviewer has
// decided any alone, "as billed" is no longer true for all, so the charges are decided one by one.
function approval(invoice: Detail, findings: Finding[], money?: Amounts) {
  const open = invoice.openDiscrepancyCount;
  const duplicate = findings.find((finding) => finding.type === 'DUPLICATE_INVOICE' && (finding.status === 'OPEN' || finding.status === 'CONFIRMED'));
  if (duplicate?.status === 'CONFIRMED') return <p className="faint">A confirmed duplicate cannot be approved; reject it.</p>;
  if (duplicate) return <p className="faint">Decide the possible duplicate first.</p>;
  const charges = findings.filter((finding) => finding.type !== 'DUPLICATE_INVOICE');
  if (money && invoice.totalCents !== null && open > 0 && charges.every((finding) => finding.status === 'OPEN') && findings.length < MAX_BULK) {
    const ask = (decision: 'APPROVE_AS_BILLED' | 'DISPUTE' | 'APPROVE_AT_RATE_CARD') => decisionQuestion(decision, open, invoice.totalCents!, money, invoice.currency);
    return (
      <BulkDecision
        id={invoice.id}
        requestId={crypto.randomUUID()}
        seen={JSON.stringify(findings.map(({ id, version }) => ({ id, version })))}
        buttons={[
          { decision: 'APPROVE_AS_BILLED', label: 'Approve as billed', question: ask('APPROVE_AS_BILLED') },
          { decision: 'DISPUTE', label: `Dispute ${formatMoney(money.openCents, invoice.currency)}`, question: ask('DISPUTE'), tone: 'danger' },
          {
            decision: 'APPROVE_AT_RATE_CARD',
            label: `Approve at rate card, ${formatMoney(money.expectedCents, invoice.currency)}`,
            question: ask('APPROVE_AT_RATE_CARD'),
            tone: 'primary',
          },
        ]}
      />
    );
  }
  if (open > 0) return <p className="faint">Decide the {plural(open, 'open finding')} to approve.</p>;
  return <ActionForm hidden={{ intent: 'approve', id: invoice.id }} submit="Approve for payment" tone="primary" />;
}

// What was read from the invoice and what it was matched to. correct links to the correction form when one applies;
// example data was written by the seed, not read.
function InvoiceFacts({ invoice, correct, example }: { invoice: Detail; correct: boolean; example: boolean }) {
  const extraction = invoice.extraction;
  return (
    <section className="panel" aria-labelledby="details-title">
      <div className="panel-head">
        <div>
          <h2 id="details-title">Invoice details</h2>
          <p className="faint">
            {example ? 'Example data written by the seed, not read from a document.' : 'Read from the document by the AI. Check them against it: a misread field means wrong findings.'}
          </p>
        </div>
        {correct && (
          <a className="button small" href="#correct">
            Correct a field
          </a>
        )}
      </div>
      <dl className="facts">
        <dt>Carrier</dt>
        <dd>
          {invoice.carrier ?? <span className="faint">Not matched</span>}
          {extraction?.carrierRead && extraction.carrierMatch !== 'EXACT' && (
            <div className="faint">
              {invoice.carrier ? 'Matched to a known carrier; the document says' : 'No known carrier matched; the document says'} “{extraction.carrierRead}”
            </div>
          )}
        </dd>
        <dt>PRO number</dt>
        <dd className="id">{invoice.proNumber ?? <span className="faint">None</span>}</dd>
        <dt>Issued</dt>
        <dd>
          <Day value={invoice.issuedOn} />
        </dd>
        <dt>Total</dt>
        <dd>
          <Money cents={invoice.totalCents} currency={invoice.currency} /> <span className="faint">{invoice.currency}</span>
        </dd>
        <dt>Shipment</dt>
        <dd>
          {invoice.shipment ? (
            <>
              <span className="id">{invoice.shipment.reference}</span> {invoice.shipment.origin} to {invoice.shipment.destination}, shipped{' '}
              <Day value={invoice.shipment.shippedOn} />
            </>
          ) : (
            <span className="faint">Not matched</span>
          )}
        </dd>
        <dt>Rate card</dt>
        <dd>
          {invoice.rateCardVersion ? (
            <>
              Version {invoice.rateCardVersion.version}
              {invoice.rateCardVersion.effectiveFrom && (
                <>
                  , from <Day value={invoice.rateCardVersion.effectiveFrom} />
                </>
              )}
            </>
          ) : (
            <span className="faint">Not priced yet</span>
          )}
        </dd>
        <dt>File</dt>
        <dd>
          {invoice.filename} <span className="faint">received </span>
          <Moment value={invoice.createdAt} />
        </dd>
      </dl>
    </section>
  );
}

// What the document marks look for: the header fields as read, the PRO unless a reviewer corrected it, and every line
// with an open or disputed finding.
function markValues(invoice: Detail, lines: { lineNumber: number; description: string; amountCents: number }[], byLine: Map<number, Finding>): MarkValues {
  const corrected = invoice.auditTrail.some((entry) => entry.changes.some((change) => change.field === 'proNumber'));
  return {
    carrier: invoice.extraction?.carrierRead ?? null,
    number: invoice.number,
    issuedOn: invoice.issuedOn,
    proNumber: corrected ? null : invoice.proNumber,
    totalCents: invoice.totalCents,
    lines: lines.map((line) => {
      const status = byLine.get(line.lineNumber)?.status;
      return { description: line.description, amountCents: line.amountCents, flagged: status === 'OPEN' || status === 'CONFIRMED' };
    }),
  };
}
