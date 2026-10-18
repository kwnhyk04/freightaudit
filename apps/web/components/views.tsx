import type { DeadLettersQuery, DiscrepanciesQuery, DiscrepancyStatus, InvoicesQuery, InvoiceStatus, InvoiceSummaryQuery } from '@freightaudit/contracts/graphql';
import Link from 'next/link';
import { DECISION, FILTERS, FINDING, findingText, IN_FLIGHT, invoiceAmounts, lineLabel, openFindingsNote, QUEUE, STATUS, statusReason, statusTotals } from '../lib/labels.ts';
import { ActionForm, DecideForm } from './client.tsx';
import { Badge, Day, Difference, Empty, Moment, Money, Pager, StatusBadge, Tabs } from './ui.tsx';

// Views shared by the live pages and the public /demo pages: base prefixes every link, readOnly hides every action.
export type Where = { base: string; readOnly: boolean };
export const query = (path: string, params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  return search.size > 0 ? `${path}?${search}` : path;
};
export const PAGE_SIZE = 25;

type Summary = InvoiceSummaryQuery['invoiceSummary'];

// The invoices page: what waits for a decision in four cards, the status tabs with their counts, a search, and the
// list, 25 a page newest first, each row with why it has its status and what it bills against the rate card.
export function InvoiceList({ data, summary, status, search, base, readOnly }: Where & { data: InvoicesQuery; summary: Summary; status?: InvoiceStatus; search?: string }) {
  const { edges, pageInfo, totalCount, offset } = data.invoices;
  const totals = statusTotals(summary.statusCounts);
  const list = (params: Record<string, string | undefined>) => query(`${base}/invoices`, { status: status?.toLowerCase(), q: search, ...params });
  const tabs = FILTERS.map((filter) => ({
    key: filter.status ?? 'ALL',
    label: filter.label,
    count: filter.status ? totals.count(filter.status) : totals.all,
    href: query(`${base}/invoices`, { status: filter.status?.toLowerCase() }),
  }));
  const showing = totalCount > 0 ? `Showing ${offset + 1} to ${offset + edges.length} of ${totalCount}` : undefined;
  // Back to the plain first page once within a page of it, so invoices uploaded since never leave a short first page.
  const previous = !pageInfo.hasPreviousPage || !pageInfo.startCursor ? null : offset <= PAGE_SIZE ? list({}) : list({ before: pageInfo.startCursor });
  const next = pageInfo.hasNextPage && pageInfo.endCursor ? list({ after: pageInfo.endCursor }) : null;
  const where = status ? ` ${STATUS[status].label.toLowerCase()}` : '';
  const note = FILTERS.find((filter) => filter.status === status)?.note;
  const hint = readOnly
    ? 'The sample holds a few invoices from the golden set, frozen after review.'
    : status === 'NEEDS_REVIEW'
      ? 'Invoices whose reading matches no shipment wait here for a reviewer.'
      : 'Uploaded invoices appear here as the pipeline reads them.';
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Invoices</h1>
          <p className="muted">
            {readOnly ? `The sample: ${totals.all} invoices` : `Last 7 days: ${summary.receivedLast7Days} received`}, {totals.waiting} waiting for a decision
          </p>
        </div>
        {!readOnly && (
          <Link className="button primary" href="/upload">
            Upload invoice
          </Link>
        )}
      </div>
      <dl className="stats">
        <div>
          <dt>Open findings</dt>
          <dd className="stat">{summary.openFindings}</dd>
          <dd className={summary.openFindings > 0 ? 'text-warn' : 'faint'}>{openFindingsNote(summary, Date.now())}</dd>
        </div>
        <div>
          <dt>Overbilling found</dt>
          <dd className={`stat${summary.openOverchargeCents > 0 ? ' text-bad' : ''}`}>
            <Money cents={summary.openOverchargeCents} />
          </dd>
          <dd className="faint">Billed above the rate card, open findings only</dd>
        </div>
        <div>
          <dt>Matched the rate card</dt>
          <dd className="stat">{summary.matchedRateCard}</dd>
          <dd className="faint">Checked with no findings, ready to approve</dd>
        </div>
        <div>
          <dt>Still processing</dt>
          <dd className="stat">{totals.processing}</dd>
          <dd className="faint">Received, being read or checked</dd>
        </div>
      </dl>
      <div className="list-bar">
        <Tabs items={tabs} current={status ?? 'ALL'} label="Filter by status" unit="invoices" />
        <form role="search" className="search" action={`${base}/invoices`}>
          {status && <input type="hidden" name="status" value={status.toLowerCase()} />}
          <label className="visually-hidden" htmlFor="invoice-search">
            Search invoices
          </label>
          <input id="invoice-search" type="search" name="q" defaultValue={search} maxLength={100} placeholder="Invoice, PRO or carrier" />
        </form>
      </div>
      {note && (
        <p className="faint" style={{ marginBottom: 12 }}>
          {note}
        </p>
      )}
      {edges.length === 0 ? (
        <div className="table-wrap">
          {search ? (
            <Empty title={`No${where} invoices match “${search}”.`}>
              <p>The search looks at invoice numbers, PRO numbers and carrier names.</p>
            </Empty>
          ) : (
            <Empty title={status ? `No ${readOnly ? 'sample ' : ''}invoices are${where}.` : readOnly ? 'The sample is empty.' : 'No invoices yet.'}>
              <p>{hint}</p>
            </Empty>
          )}
        </div>
      ) : (
        // A region the keyboard can scroll: on a phone every column stays and the table scrolls inside it.
        <div className="table-wrap" role="region" aria-label="Invoices" tabIndex={0}>
          <table>
            <caption className="visually-hidden">
              Invoices, newest first, {showing?.toLowerCase()}
            </caption>
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Invoice</th>
                <th scope="col">Carrier</th>
                <th scope="col">Issued</th>
                <th scope="col">Received</th>
                <th scope="col" className="num">
                  Open findings
                </th>
                <th scope="col" className="num">
                  Billed
                </th>
                <th scope="col" className="num">
                  Expected
                </th>
                <th scope="col" className="num">
                  Difference
                </th>
              </tr>
            </thead>
            <tbody>
              {edges.map(({ node }) => {
                const findings = node.discrepancies.edges.map((edge) => edge.node);
                // Only a priced invoice has an expected amount.
                const money = node.rateCardVersion && node.totalCents !== null ? invoiceAmounts(node.totalCents, findings) : undefined;
                const reason = statusReason({ ...node, findings: findings.length });
                return (
                  <tr key={node.id} className="link-row">
                    <td>
                      <StatusBadge status={node.status} open={node.openDiscrepancyCount} />
                      {reason && <div className="faint reason">{reason}</div>}
                    </td>
                    <td>
                      <Link href={`${base}/invoices/${node.id}`} className="id">
                        {node.number ?? node.filename}
                      </Link>
                    </td>
                    <td>{node.carrier ?? <span className="faint">{IN_FLIGHT.has(node.status) ? 'Not matched yet' : 'Not matched'}</span>}</td>
                    <td>
                      <Day value={node.issuedOn} />
                    </td>
                    <td>
                      <Moment value={node.createdAt} />
                    </td>
                    <td className="num">{money && (node.openDiscrepancyCount > 0 ? <strong>{node.openDiscrepancyCount}</strong> : <span className="faint">0</span>)}</td>
                    <td className="num">{node.totalCents !== null && <Money cents={node.totalCents} currency={node.currency} />}</td>
                    <td className="num muted">{money && <Money cents={money.expectedCents} currency={node.currency} />}</td>
                    <td className="num">{money && <Difference cents={money.standingCents} currency={node.currency} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager showing={showing} previous={previous} next={next} />
    </>
  );
}

export function DiscrepancyList({ data, status, after, base, readOnly }: Where & { data: DiscrepanciesQuery; status: DiscrepancyStatus; after?: string }) {
  const { edges, pageInfo } = data.discrepancies;
  const tabs = (['OPEN', 'CONFIRMED', 'DISMISSED'] as const).map((key) => ({ key, label: DECISION[key].label, href: query(`${base}/discrepancies`, { status: key.toLowerCase() }) }));
  return (
    <>
      <Tabs items={tabs} current={status} label="Filter by decision" />
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
                  <td>{node.lineItem ? `${node.lineItem.lineNumber}. ${lineLabel(node.lineItem.description)}` : <span className="faint">Whole invoice</span>}</td>
                  <td className="num">
                    <Money cents={node.expectedCents} currency={node.invoice.currency} />
                  </td>
                  <td className="num">
                    <Money cents={node.billedCents} currency={node.invoice.currency} />
                  </td>
                  <td className="muted" style={{ maxWidth: 360 }}>
                    {findingText(node, node.lineItem, undefined, node.invoice.currency)}
                  </td>
                  <td>{!readOnly && node.status === 'OPEN' && node.invoice.status === 'RECONCILED' ? <DecideForm id={node.id} /> : <Badge tone={DECISION[node.status].tone}>{DECISION[node.status].label}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager
        labels={['First page', 'Next 25']}
        previous={after ? query(`${base}/discrepancies`, { status: status.toLowerCase() }) : null}
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
      <Tabs items={tabs} current={status} label="Filter by state" />
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
        labels={['First page', 'Next 25']}
        previous={after ? query(`${base}/dead-letters`, { status: replayed ? 'replayed' : undefined }) : null}
        next={pageInfo.hasNextPage && pageInfo.endCursor ? query(`${base}/dead-letters`, { status: replayed ? 'replayed' : undefined, after: pageInfo.endCursor }) : null}
      />
    </>
  );
}
