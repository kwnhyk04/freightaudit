'use client';

import { formatMoney } from '@freightaudit/domain';
import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { duration } from '../lib/labels.ts';
import { type Bucket as Day, path, processed, sampled, ticksFor, weekLabel, weekPoints } from '../lib/overview.ts';

// The overview's moving parts, after 21st.dev's Web3Bento (MIT, docs/third-party.md): figures that count up once, the
// hero's daily bars and the line chart. Each chart is one keyboard stop: arrows, Home and End move between days, a
// pointer or a tap picks the day under it, and the day's values show in a note and are read out.
const SAMPLES = 96;
const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const style = (values: Record<string, string | number>) => values as CSSProperties;

const FORMATS = {
  money: (value: number) => formatMoney(Math.round(value)),
  count: (value: number) => Math.round(value).toLocaleString('en-US'),
  percent: (value: number) => `${Math.round(value)}%`,
  duration: (value: number) => duration(Math.round(value)),
};

// A figure that counts up from 0 once, when the page loads; a new value later (another range) shows at once. The final
// text keeps the width and is what assistive technology reads, so nothing moves while the digits count.
export function CountUp({ value, as }: { value: number; as: keyof typeof FORMATS }) {
  const format = FORMATS[as];
  const [shown, setShown] = useState(value);
  const first = useRef(true);
  useEffect(() => {
    if (!first.current || still()) return setShown(value);
    first.current = false;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 900);
      setShown(value * (1 - (1 - progress) ** 4));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <span className="count">
      <span className="final">{format(value)}</span>
      <span className="counting" aria-hidden="true">
        {format(shown)}
      </span>
    </span>
  );
}

// The day a chart points at: none until a pointer, a tap or the keyboard picks one.
function useActive(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const shown = active === null ? null : Math.min(active, count - 1);
  const pick = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setActive(Math.min(count - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * count))));
  };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    const at = shown ?? count - 1;
    const next = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: count - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(Math.min(count - 1, Math.max(0, next)));
  };
  return {
    active: shown,
    handlers: {
      tabIndex: 0,
      onPointerMove: pick,
      onPointerDown: pick,
      onPointerLeave: (event: PointerEvent<HTMLElement>) => event.pointerType === 'mouse' && setActive(null),
      onFocus: () => setActive((current) => current ?? count - 1),
      onBlur: () => setActive(null),
      onKeyDown: keys,
    },
  };
}

// A note over the picked day: anchored at its share of the width and shifted by the same share of its own (or, beside,
// opening beside the guide toward the middle), so it never leaves the chart; the same words are read out.
function Tip({ at, top, children, words, beside }: { at: number; top: string; children: ReactNode; words: string; beside?: boolean }) {
  return (
    <>
      <span className={beside ? `tip beside${at > 0.5 ? ' flip' : ''}` : 'tip'} style={style({ '--at': at, left: `${at * 100}%`, top })} aria-hidden="true">
        {children}
      </span>
      <span className="visually-hidden" aria-live="polite">
        {words}
      </span>
    </>
  );
}

// Weeks alternate between two tones of the accent, so the days read in their weeks; Monday starts a week.
const weekTone = (day: string) => Math.floor((Date.parse(`${day}T00:00:00Z`) / 86_400_000 + 3) / 7) % 2 === 0;

// The hero's bars: one per day of the range, thin with rounded tops, grown from the baseline once and eased to new
// heights when the range changes. A day with nothing shows a 2 px stub.
export function DayBars({ days, name }: { days: Day[]; name: string }) {
  const top = Math.max(0, ...days.map((day) => day.overbilledCents));
  const { active, handlers } = useActive(days.length);
  const share = (day: Day) => (top === 0 ? 0 : (day.overbilledCents / top) * 100);
  const picked = active === null ? null : days[active]!;
  return (
    <div className="day-chart">
      <div className="day-bars" role="group" aria-label={`${name}, a bar a day. Arrow keys move between days.`} data-active={active !== null || undefined} style={style({ '--n': days.length })} {...handlers}>
        {days.map((day, i) => (
          <span key={i} className={`day${weekTone(day.day) ? '' : ' soft'}${i === active ? ' on' : ''}`} style={style({ '--h': `${share(day)}%`, '--i': i })}>
            <span className="bar" />
          </span>
        ))}
        {picked && (
          <Tip at={(active! + 0.5) / days.length} top={`calc(${100 - share(picked)}% - 46px)`} words={`${weekLabel(picked.day)}: ${formatMoney(picked.overbilledCents)}`}>
            <strong>{formatMoney(picked.overbilledCents)}</strong>
            {weekLabel(picked.day)}
          </Tip>
        )}
      </div>
      <div className="axis">
        <span>{weekLabel(days[0]!.day)}</span>
        <span>Daily overbilling</span>
        <span>{weekLabel(days.at(-1)!.day)}</span>
      </div>
    </div>
  );
}

// Invoices processed a day as a smooth line over a soft fade of the accent, and those that matched the rate card as a
// dashed line under it, on gridlines at clean values. The line draws in once; a new range morphs it, since both lines
// always have the same number of samples. The latest day carries a glowing marker.
export function LineChart({ days, name }: { days: Day[]; name: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const { active, handlers } = useActive(days.length);
  const ticks = ticksFor(Math.max(0, ...days.map(processed)));
  const top = ticks.at(-1)!;
  const all = weekPoints(days.map(processed), top);
  const matched = weekPoints(
    days.map((day) => day.matchedRateCard),
    top,
  );
  const line = path(sampled(all, SAMPLES));
  const dashed = path(sampled(matched, SAMPLES));
  const [x0] = all[0]!;
  const [xn, yn] = all.at(-1)!;
  const area = `${line} L ${xn} 100 L ${x0} 100 Z`;
  const morph = (d: string) => style({ d: `path("${d}")` });
  const picked = active === null ? null : days[active]!;
  return (
    <div className="line-chart">
      <div className="plot" role="group" aria-label={`${name}, a point a day. Arrow keys move between days.`} {...handlers}>
        {ticks.map((value) => (
          <div key={value} className="gridline" style={{ bottom: `${(value / top) * 100}%` }}>
            <span>{value}</span>
          </div>
        ))}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-fade`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" className="fade-top" />
              <stop offset="1" className="fade-bottom" />
            </linearGradient>
          </defs>
          <path className="area" d={area} fill={`url(#${id}-fade)`} style={morph(area)} />
          <path className="line matched" d={dashed} style={morph(dashed)} />
          <path className="line drawn" d={line} style={morph(line)} />
        </svg>
        <span className="glow" style={{ left: `${xn}%`, top: `${yn}%` }} />
        {picked && (
          <>
            <span className="guide" style={{ left: `${all[active!]![0]}%` }} />
            <span className="dot matched" style={{ left: `${matched[active!]![0]}%`, top: `${matched[active!]![1]}%` }} />
            <span className="dot" style={{ left: `${all[active!]![0]}%`, top: `${all[active!]![1]}%` }} />
            <Tip
              at={(active! + 0.5) / days.length}
              top="0px"
              beside
              words={`${weekLabel(picked.day)}: ${processed(picked)} processed, ${picked.matchedRateCard} matched the rate card, ${picked.neededReviewer} needed a reviewer, ${picked.failed} failed`}
            >
              {weekLabel(picked.day)}
              <span>
                <strong>{processed(picked)}</strong> processed
              </span>
              <span>
                <strong>{picked.matchedRateCard}</strong> matched the rate card
              </span>
              <span>
                <strong>{picked.neededReviewer}</strong> needed a reviewer
              </span>
              <span>
                <strong>{picked.failed}</strong> failed
              </span>
            </Tip>
          </>
        )}
      </div>
      <div className="axis gutter">
        <span>{weekLabel(days[0]!.day)}</span>
        <span>{weekLabel(days.at(-1)!.day)}</span>
      </div>
    </div>
  );
}
