import type { DashboardQuery } from '@freightaudit/contracts/graphql';
import { formatMoney } from '@freightaudit/domain';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { capital, duration, IN_FLIGHT, plural } from '../lib/labels.ts';
import { type Bucket, changeNote, costText, path, processed, RANGES, type Range, rangeKey, sampled, tokensText, weekLabel, weekPoints } from '../lib/overview.ts';
import { query } from '../lib/paging.ts';
import { Icon } from './icons.tsx';
import { CountUp, DayBars, LineChart } from './overview-motion.tsx';
import { Badge, Day, Moment, Money, StatusBadge, Table, Td, Th } from './ui.tsx';

type Latest = DashboardQuery['invoices']['edges'][number]['node'];
// A column of a chart's table: its heading and each day's value in words.
type Column = { label: string; value: (day: Bucket) => string };
const sum = (days: readonly Bucket[], value: (day: Bucket) => number) => days.reduce((total, day) => total + value(day), 0);

// The overview as a bento grid, after 21st.dev's Web3Bento (MIT, docs/third-party.md): what the audit found over a range
// of days and how the pipeline is doing. base is '' live and '/demo' for the sample, which made no model calls, so its
// cost and tokens are left out; note says what the sample covers. Cards rise in once, in reading order (--i).
export function Overview({ data, range, base, note }: { data: DashboardQuery; range: Range; base: string; note?: string }) {
  const { window, previous, weeks, days, carriers, pipeline } = data.dashboard;
  const live = base === '';
  const last = `last ${range.label}`;
  const share = window.received > 0 ? window.matchedRateCard / window.received : null;
  let order = 0;
  const tile = (area: string, title: string, children: ReactNode, extra: { note?: string; action?: ReactNode } = {}) => (
    <Tile id={area} area={area} index={order++} title={title} {...extra}>
      {children}
    </Tile>
  );
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="muted">What the audit found and how the pipeline is doing.</p>
          {note && <p className="faint">{note}</p>}
        </div>
      </div>
      <div className={live ? 'overview' : 'overview without-cost'}>
        {tile(
          'hero',
          `Overbilling found, ${last}`,
          <>
            <p className="hero-figure">
              <CountUp value={window.overbilledCents} as="money" />
            </p>
            <p className="muted">
              Across {plural(window.overbilledInvoices, 'invoice')} · {changeNote(window.overbilledCents, previous.overbilledCents, range)}
            </p>
            {days.some((day) => day.overbilledCents > 0) ? (
              <>
                <DayBars days={days} name="Overbilling found per day" />
                <DayTable name="Overbilling found per day" days={days} columns={[{ label: 'Overbilling found', value: (day) => formatMoney(day.overbilledCents) }]} />
              </>
            ) : (
              <p className="muted chart-empty">No overbilling found in the {last}.</p>
            )}
          </>,
        )}
        {tile(
          'received',
          'Invoices received',
          <>
            <p className="tile-figure">
              <CountUp value={window.received} as="count" />
            </p>
            <p className="faint">{capital(changeNote(window.received, previous.received, range))}</p>
            <Sparkline weeks={weeks} />
          </>,
        )}
        {tile(
          'matched',
          'Matched the rate card',
          <>
            <Gauge share={share} />
            <div className="stat-figure">
              <p className={share === null ? 'tile-figure faint' : 'tile-figure'}>{share === null ? 'None' : <CountUp value={share * 100} as="percent" />}</p>
              <p className="faint">{share === null ? `No invoices in the ${last}` : `${window.matchedRateCard.toLocaleString('en-US')} of ${window.received.toLocaleString('en-US')} with nothing for a reviewer`}</p>
            </div>
          </>,
        )}
        {tile('chart', 'Invoices processed per day', <Processed days={days} last={last} />, {
          note: 'By the day the invoice arrived',
          action: <RangePills range={range} base={base} />,
        })}
        {tile(
          'processing',
          'Processing time',
          <Figure
            value={window.processingP50Ms === null ? undefined : <CountUp value={window.processingP50Ms} as="duration" />}
            note={window.processingP95Ms === null ? `Nothing timed in the ${last}` : `Median · 95% within ${duration(window.processingP95Ms)}`}
          />,
        )}
        {live &&
          tile(
            'cost',
            'Model cost per invoice',
            <Figure value={window.modelCostPerInvoiceMicroUsd === null ? undefined : costText(window.modelCostPerInvoiceMicroUsd)} note="As billed: Claude's calls, the free models at $0" />,
          )}
        {tile('latest', 'Latest invoices', <LatestList invoices={data.invoices.edges.map(({ node }) => node)} base={base} />, {
          action: <Link href={`${base}/invoices`}>All invoices</Link>,
        })}
        {tile(
          'carriers',
          `Overbilling by carrier, ${last}`,
          carriers.length === 0 ? (
            <p className="muted chart-empty">No overbilling found in the {last}.</p>
          ) : (
            <ol className="carrier-bars">
              {carriers.map((row) => (
                <li key={row.carrier} title={`On ${plural(row.invoices, 'invoice')}`}>
                  <span>{row.carrier}</span>
                  <span className="carrier-bar">
                    <span className="fill" style={{ '--share': row.overbilledCents / carriers[0]!.overbilledCents } as CSSProperties} />
                    <Money cents={row.overbilledCents} />
                  </span>
                </li>
              ))}
            </ol>
          ),
          { note: 'Where the money goes back to' },
        )}
        {tile(
          'health',
          live ? 'Pipeline health, right now' : 'Pipeline health, in the sample',
          <>
            <dl className="health">
              <div>
                <dt>Waiting to be read</dt>
                <dd className="stat">{pipeline.waitingToBeRead}</dd>
                <dd>{pipeline.waitingToBeRead === 0 ? <Badge tone="ok">Clear</Badge> : <Badge tone="busy">Being read</Badge>}</dd>
              </div>
              <div>
                <dt>Dead letters</dt>
                <dd className="stat">{pipeline.openDeadLetters}</dd>
                <dd>{pipeline.openDeadLetters === 0 ? <Badge tone="ok">Clear</Badge> : <Badge tone="warn">Needs a look</Badge>}</dd>
              </div>
              {live && (
                <div>
                  <dt>AI tokens today</dt>
                  <dd className="stat">{tokensText(pipeline.claudeTokensToday + pipeline.freeModelTokensToday)}</dd>
                  <dd className="faint">
                    Since 00:00 UTC: Claude {tokensText(pipeline.claudeTokensToday)}, free models {tokensText(pipeline.freeModelTokensToday)}
                  </dd>
                </div>
              )}
            </dl>
            <p className="faint foot">Traces are in Jaeger and alerts in Grafana; this page is the reviewer&apos;s view.</p>
          </>,
        )}
      </div>
    </>
  );
}

// A card of the grid, placed by its area (globals.css .overview); its heading names its region.
function Tile({ id, area, index, title, note, action, children }: { id: string; area: string; index: number; title: string; note?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={`tile t-${area}`} aria-labelledby={id} style={{ '--i': index } as CSSProperties}>
      <header>
        <h2 id={id}>{title}</h2>
        {action}
      </header>
      {note && <p className="faint">{note}</p>}
      {children}
    </section>
  );
}

// The range as a small segmented pill in the chart's card, the page's one range control. Its links keep the scroll, so
// the charts ease to the new range in place.
function RangePills({ range, base }: { range: Range; base: string }) {
  return (
    <nav className="range-pills" aria-label="Time range">
      {RANGES.map((each) => (
        <Link key={each.key} href={query(`${base}/dashboard`, { range: rangeKey(each) })} scroll={false} aria-label={each.label} aria-current={each === range ? 'page' : undefined}>
          {each.short}
        </Link>
      ))}
    </nav>
  );
}

// A stat card's figure, or None, and the line under it, at the card's foot so the cards of a row line up.
const Figure = ({ value, note }: { value: ReactNode | undefined; note: string }) => (
  <div className="stat-figure">
    <p className={value === undefined ? 'tile-figure faint' : 'tile-figure'}>{value ?? 'None'}</p>
    <p className="faint">{note}</p>
  </div>
);

// Invoices received per week over the 8 weeks, as a small line with its latest week marked; it draws in once.
function Sparkline({ weeks }: { weeks: readonly { start: string; received: number }[] }) {
  const top = Math.max(1, ...weeks.map((week) => week.received));
  const points = weekPoints(
    weeks.map((week) => week.received),
    top,
  ).map(([x, y]) => [x, 8 + y * 0.84] as const);
  const line = path(sampled(points, 48));
  const [xn, yn] = points.at(-1)!;
  return (
    <figure className="sparkline">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path className="area" d={`${line} L ${xn} 100 L ${points[0]![0]} 100 Z`} />
        <path className="line drawn" d={line} />
      </svg>
      <span className="glow" style={{ left: `${xn}%`, top: `${yn}%` }} />
      <figcaption className="visually-hidden">
        Per week, {weeks.length} weeks to the week of {weekLabel(weeks.at(-1)!.start)}: {weeks.map((week) => week.received).join(', ')}
      </figcaption>
    </figure>
  );
}

// The share that matched as a meter with a needle: the arc drawn as far as the share over a lighter track of the same
// blue, the needle turned to it; both ease in once and to a new share.
function Gauge({ share }: { share: number | null }) {
  const arc = 'M 10 60 A 50 50 0 0 1 110 60';
  const value = share ?? 0;
  return (
    <svg className="gauge" viewBox="0 0 120 68" aria-hidden="true" style={{ '--s': value * 100, '--angle': `${-90 + value * 180}deg` } as CSSProperties}>
      <path className="track" d={arc} />
      {value > 0 && <path className="meter" d={arc} pathLength={100} />}
      {share !== null && (
        <g className="needle">
          <line x1="60" y1="60" x2="60" y2="20" />
        </g>
      )}
      <circle className="hub" cx="60" cy="60" r="4.5" />
    </svg>
  );
}

// The line chart's card: the range's totals keyed to their lines, the outcomes beside them, then the chart and its table.
function Processed({ days, last }: { days: Bucket[]; last: string }) {
  if (!days.some((day) => processed(day) > 0)) return <p className="muted chart-empty">No invoice was checked in the {last}.</p>;
  const name = 'Invoices processed per day';
  const reviewer = sum(days, (day) => day.neededReviewer);
  const failed = sum(days, (day) => day.failed);
  return (
    <>
      <div className="line-figures">
        <div>
          <p className="key">
            <span className="line-key" />
            Processed, {last}
          </p>
          <p className="tile-figure">
            <CountUp value={sum(days, processed)} as="count" />
          </p>
        </div>
        <div>
          <p className="key">
            <span className="line-key dashed" />
            Matched the rate card
          </p>
          <p className="tile-figure muted">
            <CountUp value={sum(days, (day) => day.matchedRateCard)} as="count" />
          </p>
        </div>
        <p className="line-states">
          <Badge tone={reviewer > 0 ? 'warn' : 'neutral'}>{reviewer} needed a reviewer</Badge>
          <Badge tone={failed > 0 ? 'bad' : 'neutral'}>{failed} failed</Badge>
        </p>
      </div>
      <LineChart days={days} name={name} />
      <DayTable
        name={name}
        days={days}
        columns={[
          { label: 'Processed', value: (day) => String(processed(day)) },
          { label: 'Matched the rate card', value: (day) => String(day.matchedRateCard) },
          { label: 'Needed a reviewer', value: (day) => String(day.neededReviewer) },
          { label: 'Failed', value: (day) => String(day.failed) },
        ]}
      />
    </>
  );
}

// A chart's values as a table, for the keyboard and screen readers: a region the keyboard can scroll, so on a phone the
// table scrolls inside it. The day and each value share the width evenly.
function DayTable({ name, days, columns }: { name: string; days: Bucket[]; columns: Column[] }) {
  return (
    <details className="table-view">
      <summary>Show as a table</summary>
      <Table label={`${name}, as a table`} cols={['', ...columns.map(() => '')]}>
        <thead>
          <tr>
            <Th>Day</Th>
            {columns.map((column) => (
              <Th key={column.label} num>
                {column.label}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.day}>
              <Td>
                <Day value={day.day} />
              </Td>
              {columns.map((column) => (
                <Td key={column.label} num>
                  {column.value(day)}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </details>
  );
}

// The newest invoices, newest first, each a row that opens it: a round icon, its number over its carrier and arrival,
// and what it bills over its status.
function LatestList({ invoices, base }: { invoices: Latest[]; base: string }) {
  if (invoices.length === 0) return <p className="muted chart-empty">No invoice has arrived yet.</p>;
  return (
    <ol className="latest">
      {invoices.map((node) => (
        <li key={node.id}>
          <Link href={`${base}/invoices/${node.id}`} className="latest-row">
            <span className="latest-icon">
              <Icon name="invoices" size={18} />
            </span>
            <span className="latest-main">
              <span className="latest-title id">{node.number ?? node.filename}</span>
              <span className="faint">
                {node.carrier ?? (IN_FLIGHT.has(node.status) ? 'Not matched yet' : 'Not matched')} · <Moment value={node.createdAt} />
              </span>
            </span>
            <span className="latest-side">
              {node.totalCents !== null && <Money cents={node.totalCents} currency={node.currency} />}
              <StatusBadge status={node.status} open={node.openDiscrepancyCount} hold={node.hold} matched={node.shipment !== null} />
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
