import type { DashboardQuery } from '@freightaudit/contracts/graphql';
import { formatMoney } from '@freightaudit/domain';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { capital, duration, plural } from '../lib/labels.ts';
import { changeNote, costText, moneyTick, RANGES, type Range, rangeKey, ticksFor, tokensText, weekLabel, wholeDollars } from '../lib/overview.ts';
import { Badge, Day, Money } from './ui.tsx';
import { query } from './views.tsx';

type Data = DashboardQuery['dashboard'];
type Week = Data['weeks'][number];
// A weekly series: its count in a week, its words, and its fill (components share the chart colors in globals.css).
type Series = { key: 'overbilledCents' | 'matchedRateCard' | 'neededReviewer' | 'failed'; label: string; fill: string };
// How a chart writes its values: in full on hover and in its table, on its gridlines, and on the columns it labels.
type Format = { text: (value: number) => string; tick: (value: number) => string; mark: (value: number) => string };
const MONEY: Format = { text: (cents) => formatMoney(cents), tick: moneyTick, mark: wholeDollars };
const COUNT: Format = { text: String, tick: String, mark: String };
const OVERBILLED: Series[] = [{ key: 'overbilledCents', label: 'Overbilling found', fill: 'fill' }];
const OUTCOMES: Series[] = [
  { key: 'matchedRateCard', label: 'Matched the rate card', fill: 'fill' },
  { key: 'neededReviewer', label: 'Needed a reviewer', fill: 'fill warn' },
  { key: 'failed', label: 'Failed', fill: 'fill bad' },
];

// The overview: what the audit found over a range of days, and how the pipeline is doing. base is '' live and '/demo'
// for the sample, which made no model calls, so its cost and tokens are left out; note says what the sample covers.
export function Overview({ data, range, base, note }: { data: Data; range: Range; base: string; note?: string }) {
  const { window, previous, weeks, carriers, pipeline } = data;
  const live = base === '';
  const last = `last ${range.label}`;
  const tiles = live ? 4 : 3;
  // The highest week and the latest carry their amounts, the highest only when it is not beside the latest.
  const highest = weeks.reduce((top, week, i) => (week.overbilledCents > weeks[top]!.overbilledCents ? i : top), 0);
  const end = weeks.length - 1;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="muted">What the audit found and how the pipeline is doing.</p>
          {note && <p className="faint">{note}</p>}
        </div>
        <nav className="segmented" aria-label="Time range">
          {RANGES.map((each) => (
            <Link key={each.key} href={query(`${base}/dashboard`, { range: rangeKey(each) })} aria-current={each === range ? 'page' : undefined}>
              {each.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="overview-top">
        <dl className="panel hero-card">
          <dt>Overbilling found, {last}</dt>
          <dd className="hero-figure">
            <Money cents={window.overbilledCents} />
          </dd>
          <dd className="muted">
            Across {plural(window.overbilledInvoices, 'invoice')} · {changeNote(window.overbilledCents, previous.overbilledCents, range)}
          </dd>
        </dl>
        <dl className="stats" style={{ '--tiles': tiles } as CSSProperties}>
          <Tile label="Invoices received" value={window.received} note={capital(changeNote(window.received, previous.received, range))} />
          <Tile
            label="Matched the rate card"
            value={window.received > 0 ? `${Math.round((window.matchedRateCard / window.received) * 100)}%` : undefined}
            note={window.received > 0 ? `${window.matchedRateCard} of ${window.received} with nothing for a reviewer` : `No invoices in the ${last}`}
          />
          <Tile
            label="Processing time"
            value={window.processingP50Ms === null ? undefined : duration(window.processingP50Ms)}
            note={window.processingP95Ms === null ? `Nothing timed in the ${last}` : `Median · 95% within ${duration(window.processingP95Ms)}`}
          />
          {live && (
            <Tile
              label="Model cost per invoice"
              value={window.modelCostPerInvoiceMicroUsd === null ? undefined : costText(window.modelCostPerInvoiceMicroUsd)}
              note="As billed: Claude's calls, the free models at $0"
            />
          )}
        </dl>
      </div>
      <div className="overview-grid">
        <Card id="overbilling-weeks" title="Overbilling found per week" note="Billed above the rate card, by the week the invoice arrived">
          <WeekChart
            name="Overbilling found per week"
            weeks={weeks}
            series={OVERBILLED}
            format={MONEY}
            marked={highest >= end - 1 ? [end] : [highest, end]}
            empty="No overbilling found in these 8 weeks."
          />
        </Card>
        <Card id="outcome-weeks" title="Invoices per week, by outcome">
          <WeekChart name="Invoices per week, by outcome" weeks={weeks} series={OUTCOMES} format={COUNT} marked={[end]} empty="No invoice was checked in these 8 weeks." />
        </Card>
        <Card id="carriers" title={`Overbilling by carrier, ${last}`} note="Where the money goes back to">
          {carriers.length === 0 ? (
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
          )}
        </Card>
        <Card id="pipeline-health" title={live ? 'Pipeline health, right now' : 'Pipeline health, in the sample'}>
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
          <p className="faint">Traces are in Jaeger and alerts in Grafana; this page is the reviewer&apos;s view.</p>
        </Card>
      </div>
    </>
  );
}

// One figure of a stats card: its label, its value or None, and the line under it.
const Tile = ({ label, value, note }: { label: string; value: ReactNode | undefined; note: string }) => (
  <div>
    <dt>{label}</dt>
    <dd className={value === undefined ? 'stat faint' : 'stat'}>{value ?? 'None'}</dd>
    <dd className="faint">{note}</dd>
  </div>
);

// A card whose heading names its region.
const Card = ({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) => (
  <section className="panel" aria-labelledby={id}>
    <h2 id={id}>{title}</h2>
    {note && <p className="faint">{note}</p>}
    {children}
  </section>
);

// Eight weekly columns from one baseline, stacked by series with a legend when there are several, under gridlines at
// clean values. The marked columns carry their total; every column's values show on hover and in the table under it.
function WeekChart({ name, weeks, series, format, marked, empty }: { name: string; weeks: Week[]; series: Series[]; format: Format; marked: number[]; empty: string }) {
  const totals = weeks.map((week) => series.reduce((sum, each) => sum + week[each.key], 0));
  const ticks = ticksFor(Math.max(0, ...totals));
  const top = ticks.at(-1)!;
  if (top === 0) return <p className="muted chart-empty">{empty}</p>;
  const share = (value: number) => `${(value / top) * 100}%`;
  const say = (week: Week) => series.map((each) => (series.length === 1 ? format.text(week[each.key]) : `${format.text(week[each.key])} ${each.label.toLowerCase()}`)).join(', ');
  const span = `${weeks.length} weeks, from the week of ${weekLabel(weeks[0]!.start)} to the week of ${weekLabel(weeks.at(-1)!.start)}`;
  return (
    <>
      {series.length > 1 && (
        <ul className="legend">
          {series.map((each) => (
            <li key={each.key}>
              <span className={`swatch ${each.fill}`} />
              {each.label}
            </li>
          ))}
        </ul>
      )}
      <div className="week-chart" role="img" aria-label={`${name}, ${span}. Show as a table lists every value.`}>
        <div className="plot">
          {ticks.map((value) => (
            <div key={value} className="gridline" style={{ bottom: share(value) }}>
              <span>{format.tick(value)}</span>
            </div>
          ))}
          <div className="columns">
            {weeks.map((week, i) => (
              <div key={week.start} className="column">
                {marked.includes(i) && totals[i]! > 0 && (
                  <span className="column-label" style={{ bottom: share(totals[i]!) }}>
                    {format.mark(totals[i]!)}
                  </span>
                )}
                <div className="stack" style={{ height: share(totals[i]!) }} title={`Week of ${weekLabel(week.start)}: ${say(week)}`}>
                  {series.map((each) => week[each.key] > 0 && <span key={each.key} className={each.fill} style={{ flexGrow: week[each.key] }} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="weeks">
          {weeks.map((week) => (
            <span key={week.start}>{weekLabel(week.start)}</span>
          ))}
        </div>
      </div>
      <details className="table-view">
        <summary>Show as a table</summary>
        {/* A region the keyboard can scroll, as the invoice list's: on a phone the table scrolls inside it. */}
        <div className="table-wrap" role="region" aria-label={`${name}, as a table`} tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Week of</th>
                {series.map((each) => (
                  <th key={each.key} scope="col" className="num">
                    {each.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week.start}>
                  <td>
                    <Day value={week.start} />
                  </td>
                  {series.map((each) => (
                    <td key={each.key} className="num">
                      {format.text(week[each.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
