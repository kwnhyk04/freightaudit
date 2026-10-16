import type { InvoiceStatus } from '@freightaudit/contracts/graphql';
import { formatMoney } from '@freightaudit/domain';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { STATUS, type Tone } from '../lib/labels.ts';

export const Badge = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={`badge ${tone}`}>{children}</span>;

export const StatusBadge = ({ status }: { status: InvoiceStatus }) => <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;

// Amounts arrive as integer cents and are only formatted here; the UI never adds or subtracts them.
export const Money = ({ cents, currency }: { cents: number | null | undefined; currency?: string | null }) =>
  cents === null || cents === undefined ? <span className="faint">None</span> : <span className="num">{formatMoney(cents, currency ?? 'USD')}</span>;

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

export function Tabs({ items, current }: { items: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <nav className="tabs" aria-label="Filter">
      {items.map((item) => (
        <Link key={item.key} href={item.href} aria-current={item.key === current ? 'page' : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
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

// Keyset pages only go forward; the browser's back button returns to the page before.
export function Pager({ next, first }: { next: string | null; first: string | null }) {
  if (!next && !first) return null;
  return (
    <div className="pager">
      {first && (
        <Link className="button" href={first}>
          First page
        </Link>
      )}
      {next && (
        <Link className="button" href={next}>
          Next 25
        </Link>
      )}
    </div>
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
