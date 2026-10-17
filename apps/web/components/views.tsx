import type { DeadLettersQuery, DiscrepanciesQuery, DiscrepancyStatus, InvoiceQuery, InvoicesQuery, InvoiceStatus } from '@freightaudit/contracts/graphql';
import Link from 'next/link';
import { ACTION, CARRIER_MATCH, DECISION, FIELD, FILTERS, FINDING, IN_FLIGHT, QUEUE, reviewReason, STATUS } from '../lib/labels.ts';
import { ActionForm, DecideForm, DialogAction, DocumentViewer, StatusPoller } from './client.tsx';
import { Badge, Day, Empty, Moment, Money, Pager, StatusBadge, Tabs } from './ui.tsx';

// Views shared by the live pages and the public /demo pages: base prefixes every link, readOnly hides every action.
type Where = { base: string; readOnly: boolean };
const query = (path: string, params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  return search.size > 0 ? `${path}?${search}` : path;
};

export function InvoiceList({ data, status, after, base, readOnly }: Where & { data: InvoicesQuery; status?: InvoiceStatus; after?: string }) {
  const { edges, pageInfo } = data.invoices;
  const tabs = FILTERS.map((filter) => ({ key: filter.status ?? 'ALL', label: filter.label, href: query(`${base}/invoices`, { status: filter.status?.toLowerCase() }) }));
  const hint = readOnly
    ? status
      ? 'The sample holds a few invoices from the golden set, frozen after review.'
      : 'The sample files have not been exported yet (README, Review UI).'
    : status === 'NEEDS_REVIEW'
      ? 'Invoices whose reading matches no shipment wait here for a reviewer.'
      : 'Uploaded invoices appear here as the pipeline reads them.';
  return (
    <>
      <Tabs items={tabs} current={status ?? 'ALL'} />
      {edges.length === 0 ? (
        <div className="table-wrap">
          <Empty title={status ? `No ${readOnly ? 'sample ' : ''}invoices are ${STATUS[status].label.toLowerCase()}.` : readOnly ? 'The sample is empty.' : 'No invoices yet.'}>
            <p>{hint}</p>
          </Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Invoice</th>
                <th scope="col" className="hide-narrow">Carrier</th>
                <th scope="col" className="hide-narrow">Issued</th>
                <th scope="col" className="hide-narrow">Received</th>
                <th scope="col" className="num hide-narrow">Open findings</th>
                <th scope="col" className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {edges.map(({ node }) => (
                <tr key={node.id} className="link-row">
                  <td>
                    <StatusBadge status={node.status} />
                  </td>
                  <td>
                    <Link href={`${base}/invoices/${node.id}`} className="id">
                      {node.number ?? node.filename}
                    </Link>
                    <div className="faint show-narrow">{node.carrier ?? 'Not matched'}</div>
                  </td>
                  <td className="hide-narrow">{node.carrier ?? <span className="faint">Not matched</span>}</td>
                  <td className="hide-narrow">
                    <Day value={node.issuedOn} />
                  </td>
                  <td className="hide-narrow">
                    <Moment value={node.createdAt} />
                  </td>
                  <td className="num hide-narrow">{node.openDiscrepancyCount > 0 ? node.openDiscrepancyCount : <span className="faint">0</span>}</td>
                  <td className="num">
                    <Money cents={node.totalCents} currency={node.currency} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager
        first={after ? query(`${base}/invoices`, { status: status?.toLowerCase() }) : null}
        next={pageInfo.hasNextPage && pageInfo.endCursor ? query(`${base}/invoices`, { status: status?.toLowerCase(), after: pageInfo.endCursor }) : null}
      />
    </>
  );
}

type Detail = NonNullable<InvoiceQuery['invoice']>;

function InvoiceActions({ invoice }: { invoice: Detail }) {
  if (invoice.status === 'NEEDS_REVIEW') {
    return (
      <div className="row">
        <DialogAction label="Reject" title="Reject this invoice">
          <ActionForm hidden={{ intent: 'reject', id: invoice.id }} submit="Reject invoice" tone="danger">
            <label style={{ width: '100%' }}>
              Reason, kept in the audit trail
              <textarea name="reason" required maxLength={1000} rows={3} />
            </label>
          </ActionForm>
        </DialogAction>
        <ActionForm
          hidden={{ intent: 'approve', id: invoice.id }}
          submit="Approve as billed"
          confirm="Approve without a matched shipment? The carrier is paid what it billed."
        />
      </div>
    );
  }
  if (invoice.status === 'RECONCILED') {
    return invoice.openDiscrepancyCount > 0 ? (
      <p className="faint">
        Decide the {invoice.openDiscrepancyCount} open finding{invoice.openDiscrepancyCount === 1 ? '' : 's'} to approve.
      </p>
    ) : (
      <ActionForm hidden={{ intent: 'approve', id: invoice.id }} submit="Approve for payment" tone="primary" />
    );
  }
  if (invoice.status === 'FAILED' && invoice.deadLetter) return <ActionForm hidden={{ intent: 'replay', id: invoice.deadLetter.id }} submit="Replay" />;
  return null;
}

export function InvoiceDetail({ data, base, readOnly, documentSrc }: Where & { data: InvoiceQuery; documentSrc: string }) {
  const invoice = data.invoice!;
  const extraction = invoice.extraction;
  const findings = invoice.discrepancies.edges.map(({ node }) => node);
  const flagged = new Map(findings.filter((finding) => finding.lineItem).map((finding) => [finding.lineItem!.lineNumber, finding]));
  const lines = invoice.lineItems.length > 0 ? invoice.lineItems : (extraction?.lines ?? []);
  const correctable = invoice.status === 'NEEDS_REVIEW' && invoice.reviewReason === 'no_shipment_match';
  // The sample shows the same fields, disabled and without a submit button.
  const correction = (
    <>
      <label>
        Carrier
        <select name="carrierId" defaultValue={data.carriers.find((carrier) => carrier.name === invoice.carrier)?.id ?? ''} disabled={readOnly}>
          <option value="">Keep as read</option>
          {data.carriers.map((carrier) => (
            <option key={carrier.id} value={carrier.id}>
              {carrier.name}
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
  // Before extraction, or when it failed, the file is all there is: the facts shrink to it.
  const unread = !extraction && !invoice.number;
  // Only a priced invoice has expected amounts; before that, every line is as billed by definition.
  const priced = Boolean(invoice.rateCardVersion);
  const carrier = invoice.carrier ?? extraction?.carrierRead;
  return (
    <>
      <div className="page-head">
        <div>
          <p className="faint">
            <Link href={`${base}/invoices`}>Invoices</Link>
          </p>
          <div className="row" style={{ alignItems: 'center' }}>
            <h1 className="id">{invoice.number ?? invoice.filename}</h1>
            {carrier && <span className="muted">{carrier}</span>}
            <StatusBadge status={invoice.status} />
          </div>
        </div>
        {!readOnly && <InvoiceActions invoice={invoice} />}
      </div>
      <StatusPoller active={IN_FLIGHT.has(invoice.status)} label={STATUS[invoice.status].label} />
      <div className="review">
        <DocumentViewer key={documentSrc} src={documentSrc} />
        <div>
          {invoice.status === 'NEEDS_REVIEW' && (
            <section className="panel attention" aria-label="Needs review">
              <h2>Why it needs review</h2>
              <p>{reviewReason(invoice.reviewReason)}</p>
              {extraction && extraction.problems.length > 0 && (
                <ul className="faint">
                  {extraction.problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}
              {correctable && (
                <div style={{ marginTop: 12 }}>
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
          {unread ? (
            <section className="panel" aria-label="Invoice facts">
              <dl className="facts">
                <dt>File</dt>
                <dd>
                  {invoice.filename} <span className="faint">received </span>
                  <Moment value={invoice.createdAt} />
                </dd>
              </dl>
              <p className="faint" style={{ marginTop: 8 }}>
                {invoice.status === 'FAILED' ? 'Nothing was read from the file.' : 'The pipeline has not read the file yet.'}
              </p>
            </section>
          ) : (
            <InvoiceFacts invoice={invoice} />
          )}
          {!unread && (
            <section className="panel" aria-label="Lines">
              <h2>Lines</h2>
              {lines.length === 0 ? (
                <p className="faint">No lines were read.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col" className="num">#</th>
                        <th scope="col">Description</th>
                        <th scope="col" className="hide-narrow">Code</th>
                        {priced && <th scope="col" className="num">Expected</th>}
                        <th scope="col" className="num">Billed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => {
                        const finding = flagged.get(line.lineNumber);
                        return (
                          <tr key={line.lineNumber} className={finding ? 'flagged' : undefined}>
                            <td className="num">{line.lineNumber}</td>
                            <td>
                              {line.description}
                              {finding && <div className="faint">{FINDING[finding.type]}</div>}
                            </td>
                            <td className="id hide-narrow">{line.chargeCode ?? <span className="faint">None</span>}</td>
                            {priced && <td className="num">{finding ? <Money cents={finding.expectedCents} currency={invoice.currency} /> : <span className="faint">As billed</span>}</td>}
                            <td className="num">
                              <Money cents={line.amountCents} currency={invoice.currency} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
          {findings.length > 0 && (
            <section className="panel" aria-label="Findings">
              <h2>Findings</h2>
              <div className="findings">
                {findings.map((finding) => (
                  <article key={finding.id}>
                    <div className="row" style={{ alignItems: 'center' }}>
                      <strong>{FINDING[finding.type]}</strong>
                      {finding.lineItem && <span className="faint">line {finding.lineItem.lineNumber}</span>}
                      <Badge tone={DECISION[finding.status].tone}>{DECISION[finding.status].label}</Badge>
                    </div>
                    <p>
                      Expected <Money cents={finding.expectedCents} currency={invoice.currency} />, billed{' '}
                      <Money cents={finding.billedCents} currency={invoice.currency} />
                    </p>
                    <p className="muted">{finding.evidence}</p>
                    {finding.note && <p className="faint">Note: {finding.note}</p>}
                    {!readOnly && finding.status === 'OPEN' && invoice.status === 'RECONCILED' && <DecideForm id={finding.id} />}
                  </article>
                ))}
              </div>
            </section>
          )}
          <section className="panel" aria-label="Audit trail">
            <h2>Audit trail</h2>
            <ol className="trail">
              {invoice.auditTrail.map((entry) => (
                <li key={entry.id}>
                  <Moment value={entry.at} />
                  <div>
                    <strong>{ACTION[entry.action]}</strong> <span className="faint">by {entry.actor ?? 'the pipeline'}</span>
                    {entry.changes.map((change) => (
                      <div key={change.field} className="muted">
                        {changeText(entry, change)}
                      </div>
                    ))}
                    {entry.detail && !entry.changes.some((change) => change.field === 'carrier') && <div className="faint">{entry.action === 'RECEIVED' ? entry.detail : reasonText(entry.detail)}</div>}
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

// What was read from the invoice and what it was matched to.
function InvoiceFacts({ invoice }: { invoice: Detail }) {
  const extraction = invoice.extraction;
  return (
    <section className="panel" aria-label="Invoice facts">
      <dl className="facts">
        <dt>Carrier</dt>
        <dd>
          {invoice.carrier ?? <span className="faint">Not matched</span>}
          {extraction?.carrierRead && extraction.carrierMatch !== 'EXACT' && (
            <span className="faint">
              {' '}
              Read as “{extraction.carrierRead}”, {CARRIER_MATCH[extraction.carrierMatch?.toLowerCase() ?? 'no_match']}
            </span>
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

// An audit detail in words: a review reason code, or free text such as a failure or a note.
const reasonText = (detail: string) => (/^[a-z_]+(:|$)/.test(detail) ? reviewReason(detail) : detail);

type Entry = Detail['auditTrail'][number];
const statusLabel = (status: string | null) => (status ? (STATUS[status.toUpperCase() as InvoiceStatus]?.label ?? status) : 'none');

// A field change in words: statuses by their labels, and on extraction the carrier as read and how it matched.
function changeText(entry: Entry, { field, from, to }: Entry['changes'][number]) {
  if (field === 'status') return `${entry.action === 'STATUS_CHANGED' ? '' : 'Status: '}${statusLabel(from)} to ${statusLabel(to)}`;
  if (field === 'carrier' && entry.action === 'STATUS_CHANGED') {
    return `Carrier read as “${from}”, ${to ? `matched ${to} ${CARRIER_MATCH[entry.detail ?? 'exact'] ?? ''}` : CARRIER_MATCH.no_match}`;
  }
  return `${FIELD[field] ?? field}: ${from ?? 'none'} to ${to ?? 'none'}`;
}

export function DiscrepancyList({ data, status, after, base, readOnly }: Where & { data: DiscrepanciesQuery; status: DiscrepancyStatus; after?: string }) {
  const { edges, pageInfo } = data.discrepancies;
  const tabs = (['OPEN', 'CONFIRMED', 'DISMISSED'] as const).map((key) => ({ key, label: DECISION[key].label, href: query(`${base}/discrepancies`, { status: key.toLowerCase() }) }));
  return (
    <>
      <Tabs items={tabs} current={status} />
      {edges.length === 0 ? (
        <div className="table-wrap">
          <Empty title={status === 'OPEN' ? 'No open findings.' : `No findings are ${DECISION[status].label.toLowerCase()}.`}>
            <p>Overcharges found while reconciling wait here for a decision.</p>
          </Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Finding</th>
                <th scope="col">Invoice</th>
                <th scope="col">Line</th>
                <th scope="col" className="num">Expected</th>
                <th scope="col" className="num">Billed</th>
                <th scope="col">Evidence</th>
                <th scope="col">Decision</th>
              </tr>
            </thead>
            <tbody>
              {edges.map(({ node }) => (
                <tr key={node.id}>
                  <td>{FINDING[node.type]}</td>
                  <td>
                    <Link href={`${base}/invoices/${node.invoice.id}`} className="id">
                      {node.invoice.number ?? node.invoice.filename}
                    </Link>
                    <div className="faint nowrap">{node.invoice.carrier}</div>
                  </td>
                  <td>{node.lineItem ? `${node.lineItem.lineNumber}. ${node.lineItem.description}` : <span className="faint">Whole invoice</span>}</td>
                  <td className="num">
                    <Money cents={node.expectedCents} currency={node.invoice.currency} />
                  </td>
                  <td className="num">
                    <Money cents={node.billedCents} currency={node.invoice.currency} />
                  </td>
                  <td className="muted" style={{ maxWidth: 360 }}>
                    {node.evidence}
                  </td>
                  <td>{!readOnly && node.status === 'OPEN' && node.invoice.status === 'RECONCILED' ? <DecideForm id={node.id} /> : <Badge tone={DECISION[node.status].tone}>{DECISION[node.status].label}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager
        first={after ? query(`${base}/discrepancies`, { status: status.toLowerCase() }) : null}
        next={pageInfo.hasNextPage && pageInfo.endCursor ? query(`${base}/discrepancies`, { status: status.toLowerCase(), after: pageInfo.endCursor }) : null}
      />
    </>
  );
}

export function DeadLetterList({ data, replayed, after, base, readOnly }: Where & { data: DeadLettersQuery; replayed: boolean; after?: string }) {
  const { edges, pageInfo } = data.deadLetters;
  const status = replayed ? 'replayed' : 'open';
  const tabs = [
    { key: 'open', label: 'Open', href: `${base}/dead-letters` },
    { key: 'replayed', label: 'Replayed', href: `${base}/dead-letters?status=replayed` },
  ];
  return (
    <>
      <Tabs items={tabs} current={status} />
      {edges.length === 0 ? (
        <div className="table-wrap">
          <Empty title={replayed ? 'Nothing was replayed yet.' : 'No dead letters.'}>
            <p>A job that uses up its retries lands here with its error, ready to replay once the cause is fixed.</p>
          </Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Failed</th>
                <th scope="col">Step</th>
                <th scope="col">Invoice</th>
                <th scope="col">Error</th>
                <th scope="col" className="num">Attempts</th>
                <th scope="col">{replayed ? 'Replayed' : 'Action'}</th>
              </tr>
            </thead>
            <tbody>
              {edges.map(({ node }) => (
                <tr key={node.id}>
                  <td>
                    <Moment value={node.createdAt} />
                  </td>
                  <td>{QUEUE[node.queue] ?? node.queue}</td>
                  <td>
                    {node.invoice ? (
                      <Link href={`${base}/invoices/${node.invoice.id}`} className="id">
                        {node.invoice.number ?? node.invoice.filename}
                      </Link>
                    ) : (
                      <span className="faint">TMS sync</span>
                    )}
                  </td>
                  <td style={{ maxWidth: 420 }}>{node.error}</td>
                  <td className="num">{node.attempts}</td>
                  <td>{replayed ? <Moment value={node.replayedAt} /> : !readOnly && <ActionForm hidden={{ intent: 'replay', id: node.id }} submit="Replay" confirm="Run this job again?" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager
        first={after ? query(`${base}/dead-letters`, { status: replayed ? 'replayed' : undefined }) : null}
        next={pageInfo.hasNextPage && pageInfo.endCursor ? query(`${base}/dead-letters`, { status: replayed ? 'replayed' : undefined, after: pageInfo.endCursor }) : null}
      />
    </>
  );
}
