import type { DeadLettersQuery, DiscrepanciesQuery, DiscrepancyStatus, InvoicesQuery, InvoiceSummaryQuery } from '@freightaudit/contracts/graphql';
import Link from 'next/link';
import {
  DECISION,
  decideWords,
  decisionLabel,
  type Filter,
  FILTERS,
  filterCount,
  filterKey,
  FINDING,
  findingText,
  IN_FLIGHT,
  invoiceAmounts,
  lineLabel,
  openFindingsNote,
  QUEUE,
  statusReason,
  statusTotals,
} from '../lib/labels.ts';
import { ActionForm, DecideForm, Tabs } from './client.tsx';
import { Badge, Day, Difference, Empty, Moment, Money, Pager, StatusBadge, Table, Td, Th } from './ui.tsx';

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
export function InvoiceList({ data, summary, filter, search, base, readOnly }: Where & { data: InvoicesQuery; summary: Summary; filter: Filter; search?: string }) {
  const { edges, pageInfo, totalCount, offset } = data.invoices;
  const totals = statusTotals(summary.statusCounts);
  const list = (params: Record<string, string | undefined>) => query(`${base}/invoices`, { status: filterKey(filter), q: search, ...params });
  const tabs = FILTERS.map((each) => ({
    key: each.key,
    label: each.label,
    tone: each.tone,
    count: filterCount(each, totals, summary.invoicesHeld),
    href: query(`${base}/invoices`, { status: filterKey(each) }),
  }));
  const showing = totalCount > 0 ? `Showing ${offset + 1} to ${offset + edges.length} of ${totalCount}` : undefined;
  // Back to the plain first page once within a page of it, so invoices uploaded since never leave a short first page.
  const previous = !pageInfo.hasPreviousPage || !pageInfo.startCursor ? null : offset <= PAGE_SIZE ? list({}) : list({ before: pageInfo.startCursor });
  const next = pageInfo.hasNextPage && pageInfo.endCursor ? list({ after: pageInfo.endCursor }) : null;
  const where = filter.status ? ` ${filter.label.toLowerCase()}` : '';
  const { status, note } = filter;
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
        <Tabs items={tabs} current={filter.key} label="Filter by status" unit="invoices" />
        <div className="list-tools">
          <form role="search" className="search" action={`${base}/invoices`}>
            {status && <input type="hidden" name="status" value={filter.key} />}
            <label className="visually-hidden" htmlFor="invoice-search">
              Search invoices
            </label>
            <input id="invoice-search" type="search" name="q" defaultValue={search} maxLength={100} placeholder="Invoice, PRO or carrier" />
            <button type="submit" className="button">
              Search
            </button>
          </form>
          {note && <p className="faint">{note}</p>}
        </div>
      </div>
      {edges.length === 0 ? (
        <div className="table-wrap list">
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
        // A region the keyboard can scroll; on a phone each row is a card.
        // Short columns fit their longest value (a file name, a date, this year's moment, "Open findings", "+$12,345.67");
        // carrier and status share the rest. Below 1440 px Open findings hides, as the status pill gives the count, and the
        // carrier's short names give the status pill room for its longest words.
        <Table
          label="Invoices"
          cards
          caption={`Invoices, newest first, ${showing?.toLowerCase() ?? ''}`}
          cols={['8.25rem', { width: '', narrow: '12%' }, '', '8rem', '10.25rem', { width: '8.25rem', wideOnly: true }, '7.25rem', '7.25rem', '7.75rem']}
          minWidth="67.5rem"
        >
          <thead>
            <tr>
              <Th>Invoice</Th>
              <Th>Carrier</Th>
              <Th>Status</Th>
              <Th>Issued</Th>
              <Th>Received</Th>
              <Th num className="wide-only">
                Open findings
              </Th>
              <Th num>Billed</Th>
              <Th num>Expected</Th>
              <Th num>Difference</Th>
            </tr>
          </thead>
          <tbody>
            {edges.map(({ node }) => {
              const findings = node.discrepancies.edges.map((edge) => edge.node);
              // Only a priced invoice has an expected amount.
              const money = node.rateCardVersion && node.totalCents !== null ? invoiceAmounts(node.totalCents, findings) : undefined;
              const matched = node.shipment !== null;
              const reason = statusReason({ ...node, findings: findings.length, matched });
              return (
                <tr key={node.id} className="link-row">
                  <Td card="title">
                    <Link href={`${base}/invoices/${node.id}`} className="id">
                      {node.number ?? node.filename}
                    </Link>
                  </Td>
                  <Td card="meta">{node.carrier ?? <span className="faint">{IN_FLIGHT.has(node.status) ? 'Not matched yet' : 'Not matched'}</span>}</Td>
                  <Td card="wide">
                    <StatusBadge status={node.status} open={node.openDiscrepancyCount} hold={node.hold} matched={matched} />
                    {reason && <div className="faint reason">{reason}</div>}
                  </Td>
                  <Td card="hide">
                    <Day value={node.issuedOn} />
                  </Td>
                  <Td card="hide">
                    <Moment value={node.createdAt} />
                  </Td>
                  <Td card="hide" num className="wide-only">
                    {money && (node.openDiscrepancyCount > 0 ? <strong>{node.openDiscrepancyCount}</strong> : <span className="faint">0</span>)}
                  </Td>
                  <Td card="hide" num>
                    {node.totalCents !== null && <Money cents={node.totalCents} currency={node.currency} />}
                  </Td>
                  <Td card="hide" num className="muted">
                    {money && <Money cents={money.expectedCents} currency={node.currency} />}
                  </Td>
                  {money ? (
                    <Td card="amount" num label="Over contract">
                      <Difference cents={money.standingCents} currency={node.currency} />
                    </Td>
                  ) : (
                    <Td card="amount" num />
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
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
        <div className="table-wrap list">
          <Empty title={status === 'OPEN' ? 'No open findings.' : `No findings are ${DECISION[status].label.toLowerCase()}.`}>
            <p>Overcharges found while reconciling wait here for a decision.</p>
          </Empty>
        </div>
      ) : (
        // The decision column fits its note and two buttons, on one line where the screen allows; a decided finding only
        // needs its badge. Evidence takes what is left.
        <Table cards cols={['11%', '9.5rem', '11%', '7.25rem', '7.25rem', '', edges.some(({ node }) => !readOnly && node.status === 'OPEN' && node.invoice.status === 'RECONCILED') ? 'clamp(20rem, 24vw, 33rem)' : '9rem']} minWidth="66rem">
          <thead>
            <tr>
              <Th>Finding</Th>
              <Th>Invoice</Th>
              <Th>Line</Th>
              <Th num>Expected</Th>
              <Th num>Billed</Th>
              <Th>Evidence</Th>
              <Th>Decision</Th>
            </tr>
          </thead>
          <tbody>
            {edges.map(({ node }) => (
              <tr key={node.id}>
                <Td card="title">{FINDING[node.type]}</Td>
                <Td card="meta">
                  <Link href={`${base}/invoices/${node.invoice.id}`} className="id">
                    {node.invoice.number ?? node.invoice.filename}
                  </Link>
                  <div className="faint nowrap">{node.invoice.carrier}</div>
                </Td>
                <Td card="wide">{node.lineItem ? `${node.lineItem.lineNumber}. ${lineLabel(node.lineItem.description)}` : <span className="faint">Whole invoice</span>}</Td>
                <Td card="aside" num label="Expected">
                  <Money cents={node.expectedCents} currency={node.invoice.currency} />
                </Td>
                <Td card="aside" num label="Billed">
                  <Money cents={node.billedCents} currency={node.invoice.currency} />
                </Td>
                {/* The evidence keeps the smaller size, so it wraps to fewer lines. */}
                <Td card="wide" className="muted small-cell">
                  {findingText(node, node.lineItem, undefined, node.invoice.currency)}
                </Td>
                <Td card="wide" className="decision-cell">
                  {!readOnly && node.status === 'OPEN' && node.invoice.status === 'RECONCILED' ? (
                    <DecideForm id={node.id} words={decideWords(node.type)} />
                  ) : (
                    <Badge tone={decisionLabel(node.status, node.type).tone}>{decisionLabel(node.status, node.type).label}</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
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
        <div className="table-wrap list">
          <Empty title={replayed ? 'Nothing was replayed yet.' : 'No dead letters.'}>
            <p>A job that uses up its retries lands here with its error, ready to replay once the cause is fixed.</p>
          </Empty>
        </div>
      ) : (
        // Short columns fit their longest value (a moment with its year, "Reconciliation", a file name, "Attempts", the
        // Replay button or a moment); the error takes the rest.
        <Table cards cols={['13.25rem', '8.25rem', '8.25rem', '', '6.25rem', replayed ? '13.25rem' : '6.25rem']} minWidth="57rem">
          <thead>
            <tr>
              <Th>Failed</Th>
              <Th>Step</Th>
              <Th>Invoice</Th>
              <Th>Error</Th>
              <Th num>Attempts</Th>
              <Th>{replayed ? 'Replayed' : 'Action'}</Th>
            </tr>
          </thead>
          <tbody>
            {edges.map(({ node }) => (
              <tr key={node.id}>
                <Td card="meta">
                  <Moment value={node.createdAt} />
                </Td>
                <Td card="title">{QUEUE[node.queue] ?? node.queue}</Td>
                <Td card="meta">
                  {node.invoice ? (
                    <Link href={`${base}/invoices/${node.invoice.id}`} className="id">
                      {node.invoice.number ?? node.invoice.filename}
                    </Link>
                  ) : (
                    <span className="faint">TMS sync</span>
                  )}
                </Td>
                <Td card="wide">
                  {node.error}
                </Td>
                <Td card="aside" num label="Attempts">
                  {node.attempts}
                </Td>
                <Td card="wide" label={replayed ? 'Replayed' : undefined}>
                  {replayed ? <Moment value={node.replayedAt} /> : !readOnly && <ActionForm hidden={{ intent: 'replay', id: node.id }} submit="Replay" confirm="Run this job again?" />}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pager
        labels={['First page', 'Next 25']}
        previous={after ? query(`${base}/dead-letters`, { status: replayed ? 'replayed' : undefined }) : null}
        next={pageInfo.hasNextPage && pageInfo.endCursor ? query(`${base}/dead-letters`, { status: replayed ? 'replayed' : undefined, after: pageInfo.endCursor }) : null}
      />
    </>
  );
}
