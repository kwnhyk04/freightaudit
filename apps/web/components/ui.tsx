import type { InvoiceHold, InvoiceStatus } from '@freightaudit/contracts/graphql';
import { formatMoney } from '@freightaudit/domain';
import Link from 'next/link';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { statusLabel, statusTone, type Tone, type Words } from '../lib/labels.ts';
import { Icon, type IconName } from './icons.tsx';

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
  <Badge tone={statusTone(status, open, hold)}>{statusLabel(status, open, hold, matched)}</Badge>
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

// Pages as links, each an arrow named in words for screen readers and in a tooltip. One that leads nowhere stays in
// place without a link, marked disabled, so the other never moves.
export function Pager({ showing, previous, next, labels = ['Previous', 'Next'] }: { showing?: string; previous: string | null; next: string | null; labels?: [string, string] }) {
  if (!showing && !previous && !next) return null;
  const page = (href: string | null, text: string, icon: IconName) => {
    const inside = (
      <>
        <Icon name={icon} size={18} />
        <span className="visually-hidden">{text}</span>
      </>
    );
    return href ? (
      <Link className="button page-button" href={href} title={text}>
        {inside}
      </Link>
    ) : (
      <a className="button page-button" aria-disabled="true" title={text}>
        {inside}
      </a>
    );
  };
  return (
    <nav className="pager" aria-label="Pages">
      {showing && <span className="muted">{showing}</span>}
      <span className="row">
        {page(previous, labels[0], labels[0] === 'Previous' ? 'previous' : 'first')}
        {page(next, labels[1], 'next')}
      </span>
    </nav>
  );
}

const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ') || undefined;

// Every table in the app: a wrapper that scrolls sideways when the table is wider, and the table, composed from Th and
// Td. A label (or labelledBy) makes the wrapper a named region the keyboard can scroll. look 'list' is the app's table;
// 'ledger' is the landing page's. With cards, below 720 px each row becomes a card laid out by its cells' card roles.
// cols, one per column, lays a list table out fixed above 720 px, so its spare width is spread instead of going to the
// longest text: a percentage gives a text column its share, and '' splits what is left evenly. When every column shown
// has a length (rem, or a clamp of them), that length is its base and each column gets the same share of the rest:
// base + (table width - all bases) / columns, the table width being the wrapper's 100cqw (a 100% there makes Chrome
// treat the whole calc as a percentage). minWidth keeps the shares from collapsing; below it the wrapper scrolls. A
// column given as an object can take another width below 1440 px (narrow), or, with wideOnly and its Th and Td classed
// 'wide-only', show only from 1440 px (never on a phone).
export function Table({
  label,
  labelledBy,
  caption,
  cards,
  cols,
  minWidth,
  look = 'list',
  busy,
  wrapClassName,
  className,
  children,
}: {
  label?: string;
  labelledBy?: string;
  caption?: ReactNode;
  cards?: boolean;
  cols?: (string | { width: string; narrow?: string; wideOnly?: true })[];
  minWidth?: string;
  look?: 'list' | 'ledger';
  busy?: boolean;
  wrapClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  const region = label || labelledBy ? ({ role: 'region', 'aria-label': label, 'aria-labelledby': labelledBy, tabIndex: 0 } as const) : {};
  const fixed = Boolean(cols) && look === 'list';
  const entries = (cols ?? []).map((col) => (typeof col === 'string' ? { width: col } : col));
  // Each column's width in a set of columns: base plus an equal share when every base is a length, else as given.
  const shared = (widths: string[]) => {
    const all = widths.every((width) => width !== '' && width !== 'auto' && !width.includes('%'));
    return (width: string) => (all ? `calc(${width} + (100cqw - (${widths.join(' + ')})) / ${widths.length})` : width);
  };
  const wide = shared(entries.map((entry) => entry.width));
  const narrow = shared(entries.filter((entry) => !entry.wideOnly).map((entry) => entry.narrow ?? entry.width));
  return (
    <div className={classes('table-wrap', look === 'list' && 'list', cards && 'card-list', wrapClassName)} {...region} {...(busy && { 'aria-busy': true, 'aria-label': 'Loading' })}>
      <table className={classes(look === 'list' ? 'list-table' : 'ledger', cards && 'cards', fixed && 'fixed', className)} style={fixed && minWidth ? ({ '--table-min': minWidth } as CSSProperties) : undefined}>
        {caption && <caption className="visually-hidden">{caption}</caption>}
        {fixed && (
          <colgroup>
            {entries.map(({ width, narrow: below, wideOnly }, index) => {
              const [atWide, atNarrow] = [wide(width), wideOnly ? '' : narrow(below ?? width)];
              const style = { ...(atWide && { '--col': atWide }), ...(atNarrow && atNarrow !== atWide && { '--col-narrow': atNarrow }) } as CSSProperties;
              return <col key={index} className={wideOnly ? 'wide-only' : undefined} style={style} />;
            })}
          </colgroup>
        )}
        {children}
      </table>
    </div>
  );
}

// A column header; num right-aligns it over its figures, center centres it over a count or a column of amounts.
export const Th = ({ num, center, scope = 'col', className, ...rest }: ComponentProps<'th'> & { num?: boolean; center?: boolean }) => (
  <th scope={scope} className={classes(num && 'num', center && 'center', className)} {...rest} />
);

// The length of a column's longest amount in characters, for Td's figure block, which CSS sizes in ch (the width of a
// tabular 0 in whatever font the browser has) plus half a ch: a figure, $, + or minus counts 1, a comma, point or space
// half and a hyphen 0.7 (in IBM Plex 0.453 and 0.665), and a letter (a currency's) 1.15 (the widest capital there is
// 1.13), so with the half ch on top the block is never narrower.
const CHARS: Record<string, number> = { ',': 0.5, '.': 0.5, ' ': 0.5, '-': 0.7 };
export const figureWidth = (values: (string | null | undefined)[]) =>
  Math.max(0, ...values.map((value) => [...(value ?? '')].reduce((sum, c) => sum + (CHARS[c] ?? (/[\d$+−]/.test(c) ? 1 : 1.15)), 0)));

// Where a cell sits in a phone card: title and meta stack on the left, amount (two lines tall) or aside on the right,
// wide takes a line of its own, hide leaves the card, select (a row's box) sits at the card's left edge beside the rest.
// label names the cell inside a card, where no header shows; it is text in the page, so a screen reader reads it with
// the value. figure (a figureWidth) centres the value in its column above 720 px, as a block that wide with the value
// right-aligned in it, so a column of amounts sits centred under its header with its points in line.
export type CardRole = 'title' | 'meta' | 'amount' | 'aside' | 'wide' | 'hide' | 'select';
export function Td({ num, card, label, figure, className, children, style, ...rest }: ComponentProps<'td'> & { num?: boolean; card?: CardRole; label?: string; figure?: number }) {
  return (
    <td className={classes(num && 'num', figure !== undefined && 'figure', className)} data-card={card} style={figure !== undefined ? ({ ...style, '--figure': figure } as CSSProperties) : style} {...rest}>
      {label && <span className="card-label">{label}</span>}
      {figure !== undefined ? <span className="figure-block">{children}</span> : children}
    </td>
  );
}

export function SkeletonRows({ columns, rows = 8 }: { columns: number; rows?: number }) {
  return (
    <Table busy>
      <tbody>
        {Array.from({ length: rows }, (_, row) => (
          <tr key={row}>
            {Array.from({ length: columns }, (__, column) => (
              <Td key={column}>
                <div className="skeleton" style={{ width: `${40 + ((row * 7 + column * 13) % 50)}%` }} />
              </Td>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
