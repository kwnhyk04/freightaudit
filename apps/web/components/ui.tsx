import type { InvoiceHold, InvoiceStatus } from '@freightaudit/contracts/graphql';
import { formatMoney } from '@freightaudit/domain';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { STATUS, statusLabel, type Tone, type Words } from '../lib/labels.ts';

export const Badge = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={`badge ${tone}`}>{children}</span>;

// A sentence from lib/labels.ts, each { invoice, text } part a link to that invoice under base ('' live, '/demo' in the sample).
export const Said = ({ words, base }: { words: Words; base: string }) =>
  words.map((part, i) =>
    typeof part === 'string' ? (
      part
    ) : (
      <Link key={i} href={`${base}/invoices/${part.invoice}`}>
        {part.text}
      </Link>
    ),
  );

// open is the invoice's open findings, which a checked invoice's pill counts; hold is what holds it back from approval,
// and a confirmed duplicate only waits to be rejected; matched is whether it has its shipment.
export const StatusBadge = ({ status, open, hold = null, matched = true }: { status: InvoiceStatus; open: number; hold?: InvoiceHold | null; matched?: boolean }) => (
  <Badge tone={hold === 'CONFIRMED_DUPLICATE' && status === 'RECONCILED' ? 'warn' : STATUS[status].tone}>{statusLabel(status, open, hold, matched)}</Badge>
);

// Amounts arrive as integer cents, or as bigint from the domain's review helpers, and are only formatted here; the UI
// never adds or subtracts them.
export const Money = ({ cents, currency }: { cents: bigint | number | null | undefined; currency?: string | null }) =>
  cents === null || cents === undefined ? <span className="faint">None</span> : <span className="num">{formatMoney(cents, currency ?? 'USD')}</span>;

// What a charge or an invoice bills above the rate card: a plus sign and the bad color, or a faint zero.
export const Difference = ({ cents, currency }: { cents: bigint; currency?: string | null }) =>
  cents > 0n ? <span className="num text-bad">+{formatMoney(cents, currency ?? 'USD')}</span> : <span className="num faint">{formatMoney(cents, currency ?? 'USD')}</span>;

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const moment = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' } as const;
const timeFormat = new Intl.DateTimeFormat('en-US', moment);
const pastYearFormat = new Intl.DateTimeFormat('en-US', { ...moment, year: 'numeric' });
// Moments of the current year leave the year out; older ones keep it, so a sorted column never reads out of order.
const formatMoment = (date: Date) => (date.getUTCFullYear() === new Date().getUTCFullYear() ? timeFormat : pastYearFormat).format(date);

// A calendar date as printed on the invoice (YYYY-MM-DD).
export const Day = ({ value }: { value: string | null | undefined }) =>
  value ? <time className="num" dateTime={value}>{dateFormat.format(new Date(`${value}T00:00:00Z`))}</time> : <span className="faint">None</span>;

// A moment, in UTC: the server renders it and knows no viewer's time zone.
export const Moment = ({ value }: { value: string | null | undefined }) =>
  value ? <time className="num" dateTime={value} title={value}>{formatMoment(new Date(value))} UTC</time> : <span className="faint">None</span>;

// Filters as links, so the filter lives in the URL; a count is followed by its unit for screen readers.
export function Tabs({ items, current, label, unit }: { items: { href: string; label: string; key: string; count?: number }[]; current: string; label: string; unit?: string }) {
  return (
    <nav className="tabs" aria-label={label}>
      {items.map((item) => (
        <Link key={item.key} href={item.href} aria-current={item.key === current ? 'page' : undefined}>
          {item.label}
          {item.count !== undefined && (
            <>
              {' '}
              <span className="count">{item.count}</span>
              {unit && <span className="visually-hidden"> {unit}</span>}
            </>
          )}
        </Link>
      ))}
    </nav>
  );
}

// The body of every not-found page: what happened and the way back.
export function NotFound({ text, href, back }: { text: string; href: string; back: string }) {
  return (
    <section className="panel not-found">
      <h1>Page not found</h1>
      <p className="muted">{text}</p>
      <Link href={href}>{back}</Link>
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

// Pages as links. One that leads nowhere stays in place without a link, marked disabled, so the other never moves.
export function Pager({ showing, previous, next, labels = ['Previous', 'Next'] }: { showing?: string; previous: string | null; next: string | null; labels?: [string, string] }) {
  if (!showing && !previous && !next) return null;
  const page = (href: string | null, text: string) =>
    href ? (
      <Link className="button" href={href}>
        {text}
      </Link>
    ) : (
      <a className="button" aria-disabled="true">
        {text}
      </a>
    );
  return (
    <nav className="pager" aria-label="Pages">
      {showing && <span className="muted">{showing}</span>}
      <span className="row">
        {page(previous, labels[0])}
        {page(next, labels[1])}
      </span>
    </nav>
  );
}

export function SkeletonRows({ columns, rows = 8 }: { columns: number; rows?: number }) {
  return (
    <div className="table-wrap" aria-busy="true" aria-label="Loading">
      <table>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row}>
              {Array.from({ length: columns }, (__, column) => (
                <td key={column}>
                  <div className="skeleton" style={{ width: `${40 + ((row * 7 + column * 13) % 50)}%` }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
