import type { DeadLettersQuery, DiscrepanciesQuery, DiscrepancyStatus, InvoicesQuery, InvoiceSummaryQuery } from '@freightaudit/contracts/graphql';
import { formatMoney } from '@freightaudit/domain';
import Link from 'next/link';
import { redirect } from 'next/navigation';
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
import { pageCount, query } from '../lib/paging.ts';
import { ActionForm, BulkBar, DecideForm, Pager, Tabs } from './client.tsx';
import { Badge, Day, Difference, Empty, figureWidth, Moment, Money, StatusBadge, Table, Td, Th } from './ui.tsx';

// Views shared by the live pages and the public /demo pages: base prefixes every link, readOnly hides every action.
// paging is the page and size from the address; sized says the address named the size, so filters keep it.
export type Where = { base: string; readOnly: boolean };
export type Paging = { page: number; size: number; sized: boolean };
const sizeParam = ({ size, sized }: Paging) => (sized ? String(size) : undefined);

// A page past the last one, as after rows were decided or replayed away, goes to the last page.
function keepInRange(path: string, params: Record<string, string | undefined>, paging: Paging, total: number) {
  const pages = pageCount(total, paging.size);
  if (paging.page > pages) redirect(query(path, { ...params, page: pages > 1 ? String(pages) : undefined, size: sizeParam(paging) }));
}

type Summary = InvoiceSummaryQuery['invoiceSummary'];

// The invoices page: what waits for a decision in four cards, the status tabs with their counts, a search, and the
// list, newest first, each row with why it has its status and what it bills against the rate card.
export function InvoiceList({ data, summary, filter, search, paging, base, readOnly }: Where & { data: InvoicesQuery; summary: Summary; filter: Filter; search?: string; paging: Paging }) {
  const { edges, totalCount, offset } = data.invoices;
  const totals = statusTotals(summary.statusCounts);
  const params = { status: filterKey(filter), q: search };
  keepInRange(`${base}/invoices`, params, paging, totalCount);
  // A filter starts again at page 1 and keeps the size.
  const tabs = FILTERS.map((each) => ({
    key: each.key,
    label: each.label,
    tone: each.tone,
    count: filterCount(each, totals, summary.invoicesHeld),
    href: query(`${base}/invoices`, { status: filterKey(each), size: sizeParam(paging) }),
  }));
  // Each row's findings and amounts; only a priced invoice has an expected amount.
  const rows = edges.map(({ node }) => {
    const findings = node.discrepancies.edges.map((edge) => edge.node);
    return { node, findings, money: node.rateCardVersion && node.totalCents !== null ? invoiceAmounts(node.totalCents, findings) : undefined };
  });
  // The amount columns' blocks, each as wide as the column's widest amount as Money and Difference print it.
  const figures = {
    billed: figureWidth(rows.map(({ node }) => (node.totalCents === null ? null : formatMoney(node.totalCents, node.currency ?? 'USD')))),
    expected: figureWidth(rows.map(({ node, money }) => money && formatMoney(money.expectedCents, node.currency ?? 'USD'))),
    difference: figureWidth(rows.map(({ node, money }) => money && `${money.standingCents > 0n ? '+' : ''}${formatMoney(money.standingCents, node.currency ?? 'USD')}`)),
  };
  const showing = `${offset + 1} to ${offset + edges.length} of ${totalCount}`;
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
            {paging.sized && <input type="hidden" name="size" value={paging.size} />}
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
        // Each column's base fits its longest value on one line (a file name, "Halcyon Ridge Freight", the pill "Ready to
        // approve as billed" over its note "Not checked against the rate card", a date, this year's moment, a count under
        // its two-line header, "CA$5,291.50", "+$12,345.67"), and every column gets the same share of the rest. Below
        // 1440 px Open findings hides, as the status pill gives the count, and those bases do not fit: there a long carrier
        // or pill wraps and the amounts keep 7.25 rem, so the dates stay on one line at 1280 px.
        <Table
          label="Invoices"
          cards
          caption={`Invoices, newest first, ${showing}`}
          cols={[
            '8.25rem',
            { width: '11.8rem', narrow: '8.7rem' },
            { width: '15rem', narrow: '13.25rem' },
            '8rem',
            '10.25rem',
            { width: '6rem', wideOnly: true },
            { width: '7.75rem', narrow: '7.25rem' },
            { width: '7.75rem', narrow: '7.25rem' },
            '7.75rem',
          ]}
          minWidth="67.5rem"
        >
          <thead>
            <tr>
              <Th>Invoice</Th>
              <Th>Carrier</Th>
              <Th>Status</Th>
              <Th>Issued</Th>
              <Th>Received</Th>
              <Th center className="wide-only">
                Open findings
              </Th>
              <Th center>Billed</Th>
              <Th center>Expected</Th>
              <Th center>Difference</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ node, findings, money }) => {
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
                  <Td card="hide" num className="wide-only center">
                    {money && (node.openDiscrepancyCount > 0 ? <strong>{node.openDiscrepancyCount}</strong> : <span className="faint">0</span>)}
                  </Td>
                  <Td card="hide" num figure={figures.billed}>
                    {node.totalCents !== null && <Money cents={node.totalCents} currency={node.currency} />}
                  </Td>
                  <Td card="hide" num figure={figures.expected} className="muted">
                    {money && <Money cents={money.expectedCents} currency={node.currency} />}
                  </Td>
                  {money ? (
                    <Td card="amount" num figure={figures.difference} label="Over contract">
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
      <Pager path={`${base}/invoices`} params={params} {...paging} total={totalCount} table="invoices" />
    </>
  );
}

export function DiscrepancyList({ data, status, paging, base, readOnly }: Where & { data: DiscrepanciesQuery; status: DiscrepancyStatus; paging: Paging }) {
  const { edges, totalCount } = data.discrepancies;
  const params = { status: status.toLowerCase() };
  keepInRange(`${base}/discrepancies`, params, paging, totalCount);
  // The amount columns' blocks, as wide as each column's widest amount as Money prints it ("None" with none).
  const amount = (cents: number | null | undefined, currency: string | null | undefined) => (cents === null || cents === undefined ? 'None' : formatMoney(cents, currency ?? 'USD'));
  const figures = {
    expected: figureWidth(edges.map(({ node }) => amount(node.expectedCents, node.invoice.currency))),
    billed: figureWidth(edges.map(({ node }) => amount(node.billedCents, node.invoice.currency))),
  };
  const tabs = (['OPEN', 'CONFIRMED', 'DISMISSED'] as const).map((key) => ({ key, label: DECISION[key].label, href: query(`${base}/discrepancies`, { status: key.toLowerCase(), size: sizeParam(paging) }) }));
  // A finding takes a decision while it is open on a checked invoice; a possible duplicate is ticked as its own kind.
  const decidable = (node: (typeof edges)[number]['node']) => !readOnly && node.status === 'OPEN' && node.invoice.status === 'RECONCILED';
  const kindOf = (node: (typeof edges)[number]['node']) => (node.type === 'DUPLICATE_INVOICE' ? 'duplicate' : 'finding');
  const kinds = new Set(edges.filter(({ node }) => decidable(node)).map(({ node }) => kindOf(node)));
  const actions = [...(kinds.has('finding') ? (['approve', 'dispute'] as const) : []), ...(kinds.has('duplicate') ? (['confirm', 'not-duplicate'] as const) : [])];
  const select = actions.length > 0;
  return (
    <>
      <Tabs items={tabs} current={status} label="Filter by decision" />
      {select && <BulkBar id="bulk" label="Selected findings" actions={actions} note />}
      {edges.length === 0 ? (
        <div className="table-wrap list">
          <Empty title={status === 'OPEN' ? 'No open findings.' : `No findings are ${DECISION[status].label.toLowerCase()}.`}>
            <p>Overcharges found while reconciling wait here for a decision.</p>
          </Empty>
        </div>
      ) : (
        // The decision column fits its note and two buttons, on one line where the screen allows; a decided finding only
        // needs its badge. Each column's base fits its longest value on one line (the evidence a short sentence, shorter
        // below 1440 px so the table fits at 1280 px), and every column gets the same share of the rest. With the select boxes the decision column is too wide for that
        // below 1440 px, so there the finding and line take a share and the evidence what is left.
        <Table
          cards
          cols={
            select
              ? ['3rem', { width: '9.25rem', narrow: '11%' }, '10.5rem', { width: '9rem', narrow: '11%' }, '7.25rem', '7.25rem', { width: '12rem', narrow: 'auto' }, 'clamp(20rem, 24vw, 33rem)']
              : ['9.25rem', '10.5rem', '12.5rem', '7.25rem', '7.25rem', { width: '20rem', narrow: '15rem' }, '9rem']
          }
          minWidth={select ? '69rem' : '66rem'}
        >
          <thead>
            <tr>
              {select && (
                <Th>
                  <span className="visually-hidden">Select</span>
                </Th>
              )}
              <Th>Finding</Th>
              <Th>Invoice</Th>
              <Th>Line</Th>
              <Th center>Expected</Th>
              <Th center>Billed</Th>
              <Th>Evidence</Th>
              <Th>Decision</Th>
            </tr>
          </thead>
          <tbody>
            {edges.map(({ node }) => (
              <tr key={node.id}>
                {select && (
                  <Td card="select">
                    {decidable(node) && (
                      <input
                        type="checkbox"
                        form="bulk"
                        name={kindOf(node)}
                        value={node.id}
                        aria-label={`Select ${FINDING[node.type]} on invoice ${node.invoice.number ?? node.invoice.filename}${node.lineItem ? `, line ${node.lineItem.lineNumber}` : ''}`}
                      />
                    )}
                  </Td>
                )}
                <Td card="title">{FINDING[node.type]}</Td>
                <Td card="meta">
                  <Link href={`${base}/invoices/${node.invoice.id}`} className="id">
                    {node.invoice.number ?? node.invoice.filename}
                  </Link>
                  <div className="faint nowrap">{node.invoice.carrier}</div>
                </Td>
                <Td card="wide">{node.lineItem ? `${node.lineItem.lineNumber}. ${lineLabel(node.lineItem.description)}` : <span className="faint">Whole invoice</span>}</Td>
                <Td card="aside" num figure={figures.expected} label="Expected">
                  <Money cents={node.expectedCents} currency={node.invoice.currency} />
                </Td>
                <Td card="aside" num figure={figures.billed} label="Billed">
                  <Money cents={node.billedCents} currency={node.invoice.currency} />
                </Td>
                {/* The evidence keeps the smaller size, so it wraps to fewer lines. */}
                <Td card="wide" className="muted small-cell">
                  {findingText(node, node.lineItem, undefined, node.invoice.currency)}
                </Td>
                <Td card="wide" className="decision-cell">
                  {decidable(node) ? (
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
      <Pager path={`${base}/discrepancies`} params={params} {...paging} total={totalCount} table="discrepancies" />
    </>
  );
}

export function DeadLetterList({ data, replayed, paging, base, readOnly }: Where & { data: DeadLettersQuery; replayed: boolean; paging: Paging }) {
  const { edges, totalCount } = data.deadLetters;
  const status = replayed ? 'replayed' : 'open';
  const params = { status: replayed ? 'replayed' : undefined };
  keepInRange(`${base}/dead-letters`, params, paging, totalCount);
  const tabs = [
    { key: 'open', label: 'Open', href: query(`${base}/dead-letters`, { size: sizeParam(paging) }) },
    { key: 'replayed', label: 'Replayed', href: query(`${base}/dead-letters`, { status: 'replayed', size: sizeParam(paging) }) },
  ];
  const select = !readOnly && !replayed && edges.length > 0;
  return (
    <>
      <Tabs items={tabs} current={status} label="Filter by state" />
      {select && <BulkBar id="bulk" label="Selected dead letters" actions={['replay']} />}
      {edges.length === 0 ? (
        <div className="table-wrap list">
          <Empty title={replayed ? 'Nothing was replayed yet.' : 'No dead letters.'}>
            <p>A job that uses up its retries lands here with its error, ready to replay once the cause is fixed.</p>
          </Empty>
        </div>
      ) : (
        // Short columns fit their longest value (a box, a moment with its year, "Reconciliation", a file name, "Attempts",
        // the Replay button or a moment) as their base, the error a short sentence; every column gets the same share of the rest.
        <Table cards cols={[...(select ? ['3rem'] : []), '13.25rem', '8.25rem', '8.25rem', '20rem', '6.25rem', replayed ? '13.25rem' : '6.25rem']} minWidth={select ? '60rem' : '57rem'}>
          <thead>
            <tr>
              {select && (
                <Th>
                  <span className="visually-hidden">Select</span>
                </Th>
              )}
              <Th>Failed</Th>
              <Th>Step</Th>
              <Th>Invoice</Th>
              <Th>Error</Th>
              <Th center>Attempts</Th>
              <Th>{replayed ? 'Replayed' : 'Action'}</Th>
            </tr>
          </thead>
          <tbody>
            {edges.map(({ node }) => (
              <tr key={node.id}>
                {select && (
                  <Td card="select">
                    <input
                      type="checkbox"
                      form="bulk"
                      name="letter"
                      value={node.id}
                      aria-label={`Select ${QUEUE[node.queue] ?? node.queue} for ${node.invoice ? `invoice ${node.invoice.number ?? node.invoice.filename}` : 'TMS sync'}`}
                    />
                  </Td>
                )}
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
                <Td card="aside" num className="center" label="Attempts">
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
      <Pager path={`${base}/dead-letters`} params={params} {...paging} total={totalCount} table="dead-letters" />
    </>
  );
}
