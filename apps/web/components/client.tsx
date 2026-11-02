'use client';
import type { InvoiceDecision } from '@freightaudit/contracts/graphql';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useActionState, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type ActionState, login, review, reviewMany, upload, uploadSample } from '../app/actions.ts';
import { BULK, type BulkAction, type BulkKind, BULK_KINDS, bulkQuestion, duplicateParts, plural, type Tone } from '../lib/labels.ts';
import { type Theme, THEME_LABEL, themeCookie, THEMES } from '../lib/theme.ts';
import { BACKGROUND_HEADER } from '../lib/uploads.ts';
import { Icon } from './icons.tsx';

// One file through the upload action, for components/upload.tsx. Called here, the action ships with every page that loads
// this file: proxy.ts sends a sessionless upload to /login, which runs only actions it carries, and the session check
// there sends the browser to sign-in.
export const sendUpload = (form: FormData) => upload({}, form);

// Filters as links, so the filter lives in the URL; a count is followed by its unit for screen readers. One underline
// slides to the current tab: measured here and drawn by CSS, which shows a still underline until this has run.
// A count's tone is its status's colour, as on the status pill; the tab's words still name it.
export function Tabs({ items, current, label, unit }: { items: { href: string; label: string; key: string; count?: number; tone?: Tone }[]; current: string; label: string; unit?: string }) {
  const nav = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const box = nav.current;
    const active = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!box || !active) return;
    const place = () => {
      box.style.setProperty('--x', `${active.offsetLeft}px`);
      box.style.setProperty('--w', String(active.offsetWidth));
      box.dataset.slide = 'true';
    };
    place();
    // On a phone the strip scrolls: the current tab is brought into it.
    if (active.offsetLeft + active.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = active.offsetLeft - 16;
    const sizes = new ResizeObserver(place);
    sizes.observe(active);
    return () => sizes.disconnect();
  }, [current]);
  return (
    <nav ref={nav} className="tabs" aria-label={label}>
      {items.map((item) => (
        <Link key={item.key} href={item.href} aria-current={item.key === current ? 'page' : undefined}>
          {item.label}
          {item.count !== undefined && (
            <>
              {' '}
              <span className={item.tone ? `count ${item.tone}` : 'count'}>{item.count}</span>
              {unit && <span className="visually-hidden"> {unit}</span>}
            </>
          )}
        </Link>
      ))}
    </nav>
  );
}

// System, Light or Dark as one radio group: a choice applies at once and its cookie keeps it, so the server renders the
// next page in it. In the folded sidebar and compact (the landing header) only the icons show; each radio keeps its name.
export function ThemeSwitch({ initial, compact }: { initial: Theme; compact?: boolean }) {
  const [theme, setTheme] = useState(initial);
  const choose = (next: Theme) => {
    setTheme(next);
    document.cookie = themeCookie(next);
    if (next === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
  };
  const segmented = (
    <fieldset className={`segmented theme-switch${compact ? ' compact' : ''}`}>
      <legend className="visually-hidden">Theme</legend>
      {THEMES.map((each) => (
        <label key={each} title={THEME_LABEL[each]}>
          <input type="radio" name="theme" value={each} checked={theme === each} onChange={() => choose(each)} />
          <Icon name={each} size={16} />
          <span className="label">{THEME_LABEL[each]}</span>
        </label>
      ))}
    </fieldset>
  );
  if (!compact) return segmented;
  // On a phone the compact switch is one button that steps System, Light, Dark, so it does not take half the header.
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;
  return (
    <>
      {segmented}
      <button type="button" className="theme-cycle" onClick={() => choose(next)} aria-label={`Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[next]}`}>
        <Icon name={theme} size={18} />
      </button>
    </>
  );
}

// The landing header's phone menu: a native disclosure, closed again once one of its links is followed.
export function LandingMenu({ children }: { children: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);
  return (
    <details ref={menu} className="landing-menu" onClick={(event) => (event.target as HTMLElement).closest('a') && menu.current?.removeAttribute('open')}>
      <summary aria-label="Menu">
        <Icon name="menu" />
      </summary>
      <div className="landing-menu-panel">{children}</div>
    </details>
  );
}

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(login, {});
  return (
    <form action={action}>
      <div>
        <h1>FreightAudit</h1>
        <p className="muted">Sign in to review carrier invoices.</p>
      </div>
      {notice && !state.error && (
        <p className="form-notice" role="status">
          {notice}
        </p>
      )}
      <input type="hidden" name="next" value={next ?? ''} />
      {/* The one reviewer's name, so password managers save and fill the password; unnamed, so nothing more is sent. */}
      <input type="text" autoComplete="username" value="reviewer" readOnly hidden />
      <label>
        Password
        <input type="password" name="password" autoComplete="current-password" required autoFocus />
      </label>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      <button className="button primary" disabled={pending}>
        {pending ? 'Signing in' : 'Sign in'}
      </button>
      <Link href="/demo/invoices">View sample data without signing in</Link>
    </form>
  );
}

// While the pipeline still moves an invoice, asks /api/progress (watch: 'invoice=<id>' or 'recent=1') whether a status
// moved, and refreshes the page only when its answer differs from now, the key the page was rendered with. It asks every
// 5 s, then every 60 s after 2 minutes, since an upload waiting for the next day's model budget waits until 00:00 UTC,
// and stops once nothing is in flight. The checks are background requests, which never renew the session, so a page
// left open cannot keep it alive; a refresh after a real change does. The live region tells screen readers each status.
export function StatusPoller({ active, label, watch, now }: { active: boolean; label: string; watch: string; now: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        const answer = await fetch(`/api/progress?${watch}`, { headers: { [BACKGROUND_HEADER]: '1' }, cache: 'no-store' }).catch(() => undefined);
        // Signed out or timed out: a refresh lets the proxy send the page to sign-in.
        if (answer?.status === 401) return router.refresh();
        const { key } = answer?.ok ? ((await answer.json()) as { key: string }) : { key: now };
        if (key !== now) return router.refresh();
      }
      timer = setTimeout(tick, Date.now() - started < 120_000 ? 5_000 : 60_000);
    };
    timer = setTimeout(tick, 5_000);
    return () => clearTimeout(timer);
  }, [active, router, watch, now]);
  return (
    <p className="visually-hidden" aria-live="polite">
      Status: {label}
    </p>
  );
}

// An exact duplicate's warning, with the invoice it already is as a link. The span keeps the sentence on its lines,
// since a notice lays out its children as a grid.
function DuplicateNotice({ existing, role }: { existing: NonNullable<ActionState['existing']>; role?: 'status' }) {
  const [before, name, after] = duplicateParts(existing);
  return (
    <p className="notice" role={role}>
      <span>
        {before}
        <Link href={`/invoices/${existing.id}`}>{name}</Link>
        {after}
      </span>
    </p>
  );
}

// A sample's small drawing: a page of lines, drawn, never its data. A clean digital invoice has a tick; a scan sits
// tilted and grainy with its overcharged line marked; a duplicate has the same line marked twice.
export type SampleArt = 'clean' | 'scanned' | 'duplicate';
function SamplePicture({ art }: { art: SampleArt }) {
  const lines = [22, 30, 38, 46, 54];
  const marked = art === 'scanned' ? [38] : art === 'duplicate' ? [30, 46] : [];
  return (
    <svg viewBox="0 0 120 84" className={`sample-picture ${art}`} aria-hidden="true">
      <g transform={art === 'scanned' ? 'rotate(-3 60 42)' : undefined}>
        <rect className="sheet" x="30" y="6" width="60" height="74" rx="3" />
        <rect className="ink" x="36" y="12" width="22" height="4" rx="1" />
        {lines.map((y) => (
          <g key={y}>
            {marked.includes(y) && <rect className="mark" x="33" y={y - 2} width="54" height="7" rx="1.5" />}
            <rect className="ink faint-ink" x="36" y={y} width="30" height="3" rx="1" />
            <rect className="ink faint-ink" x="72" y={y} width="12" height="3" rx="1" />
          </g>
        ))}
        <rect className="ink" x="64" y="66" width="20" height="4" rx="1" />
        {art === 'scanned' && [14, 44, 60, 72].map((y, i) => <circle key={y} className="grain" cx={40 + i * 13} cy={y} r="0.9" />)}
      </g>
      {art === 'clean' && <path className="tick" d="M88 60 l5 5 l10 -11" />}
    </svg>
  );
}

// One sample, one tap: the whole card is the button. The server reads the file by its key and uploads it through the
// same checks as a chosen file. The card's name is its title alone, and its line describes it.
export function SampleButton({ sample, art, label, note }: { sample: string; art: SampleArt; label: string; note: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(uploadSample, {});
  const id = `sample-${sample}`;
  return (
    <form action={action} className="sample">
      <input type="hidden" name="sample" value={sample} />
      <button className="sample-card" aria-labelledby={`${id}-title`} aria-describedby={`${id}-note`} disabled={pending}>
        <span className="sample-visual">
          <SamplePicture art={art} />
        </span>
        <span className="sample-text">
          <span id={`${id}-title`} className="sample-title">
            {pending ? 'Uploading…' : label}
          </span>
          <span id={`${id}-note`} className="sample-note">
            {note}
          </span>
        </span>
      </button>
      {state.existing && !pending && <DuplicateNotice existing={state.existing} role="status" />}
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

// One reviewer action: hidden fields say what and on which record, children add inputs, and an optional question
// confirms it first. The API's refusal shows beside the button.
export function ActionForm({
  hidden,
  submit,
  tone,
  confirm,
  children,
}: {
  hidden: Record<string, string>;
  submit: string;
  tone?: 'primary' | 'danger';
  confirm?: string;
  children?: ReactNode;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(review, {});
  return (
    <form action={action} className="row" onSubmit={(event) => confirm && !window.confirm(confirm) && event.preventDefault()}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      {/* Beside inputs the button takes their height; alone it stays small. */}
      <button className={`button${children ? '' : ' small'}${tone ? ` ${tone}` : ''}`} disabled={pending}>
        {pending ? 'Saving' : submit}
      </button>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

// Every open finding of an invoice decided at once. The pressed button sends its decision, after its question; the form
// carries the findings and versions this page showed and a request id made when it rendered, so a retry changes nothing
// twice and a change made meanwhile is refused with a way to reload.
export function BulkDecision({
  id,
  requestId,
  seen,
  buttons,
}: {
  id: string;
  requestId: string;
  seen: string;
  buttons: { decision: InvoiceDecision; label: string; question: string; tone?: 'primary' | 'danger' }[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(review, {});
  const path = usePathname();
  return (
    <form
      action={action}
      className="bulk"
      onSubmit={(event) => {
        const question = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.dataset.question;
        if (question && !window.confirm(question)) event.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value="decide" />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="seen" value={seen} />
      <div className="row">
        {buttons.map((button) => (
          <button key={button.decision} className={`button${button.tone ? ` ${button.tone}` : ''}`} name="decision" value={button.decision} data-question={button.question} disabled={pending}>
            {button.label}
          </button>
        ))}
      </div>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
          {state.code === 'CONFLICT' && (
            <>
              {' '}
              <a href={path}>Reload</a>
            </>
          )}
        </p>
      )}
    </form>
  );
}

// A decision or replay on the rows ticked on this page. Each row's box belongs to this form by its form attribute, so the
// table stays rendered on the server; a box's name is its kind (BULK_KINDS). A button acts on the ticked rows of its kind,
// after a question, with the shared note when there is one. The count is read out as it changes, then the result.
export function BulkBar({ id, label, actions, note }: { id: string; label: string; actions: BulkAction[]; note?: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reviewMany, {});
  const form = useRef<HTMLFormElement>(null);
  const all = useRef<HTMLInputElement>(null);
  const [ticked, setTicked] = useState<Partial<Record<BulkKind, number>>>({});
  useEffect(() => {
    const box = form.current!;
    const rows = () => [...box.elements].filter((each): each is HTMLInputElement => each instanceof HTMLInputElement && each.name in BULK_KINDS);
    const count = () => {
      const on = rows().filter((row) => row.checked);
      setTicked(Object.fromEntries(Object.keys(BULK_KINDS).map((kind) => [kind, on.filter((row) => row.name === kind).length])));
      all.current!.checked = on.length > 0 && on.length === rows().length;
      all.current!.indeterminate = on.length > 0 && on.length < rows().length;
    };
    const changed = ({ target }: Event) => {
      if (target === all.current) for (const row of rows()) row.checked = all.current!.checked;
      if (target === all.current || (target instanceof HTMLInputElement && target.form === box)) count();
    };
    // A reset (after a decision went through) clears the boxes without a change event, and runs before they clear.
    const reset = () => setTimeout(count);
    count();
    document.addEventListener('change', changed);
    box.addEventListener('reset', reset);
    return () => {
      document.removeEventListener('change', changed);
      box.removeEventListener('reset', reset);
    };
  }, [state]);
  const kinds = (Object.entries(ticked) as [BulkKind, number][]).filter(([, each]) => each > 0);
  const total = kinds.reduce((sum, [, each]) => sum + each, 0);
  const summary = total === 0 ? 'None selected' : `${total} selected${kinds.length > 1 ? `: ${kinds.map(([kind, each]) => plural(each, BULK_KINDS[kind])).join(', ')}` : ''}`;
  return (
    <form
      ref={form}
      id={id}
      action={action}
      aria-label={label}
      className="bulk-bar"
      onSubmit={(event) => {
        const chosen = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value as BulkAction | undefined;
        if (chosen && !window.confirm(bulkQuestion(chosen, ticked[BULK[chosen].kind] ?? 0))) event.preventDefault();
      }}
    >
      <label className="check">
        <input ref={all} type="checkbox" />
        Select all
      </label>
      <span className="muted" aria-live="polite">
        {summary}
      </span>
      {note && <input name="note" placeholder="Note for each decision (optional)" aria-label="Note for each decision" maxLength={1000} />}
      <span className="row">
        {actions.map((each) => (
          <button key={each} className={`button small${'danger' in BULK[each] ? ' danger' : ''}`} name="action" value={each} disabled={pending || !ticked[BULK[each].kind]}>
            {BULK[each].label}
          </button>
        ))}
      </span>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state.done && (
        <p className="form-done" role="status">
          {state.done}
        </p>
      )}
    </form>
  );
}

// A finding's decision in one row: an optional note, then let it go or uphold it, in the words of its kind (decideWords).
// The pressed button sends its intent; describedBy names the finding the buttons act on.
export function DecideForm({ id, describedBy, words }: { id: string; describedBy?: string; words: { dismiss: string; confirm: string } }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(review, {});
  return (
    <form action={action} className="row decide">
      <input type="hidden" name="id" value={id} />
      <input name="note" placeholder="Note (optional)" aria-label="Note" maxLength={1000} />
      <button className="button" name="intent" value="dismiss" disabled={pending} aria-describedby={describedBy}>
        {words.dismiss}
      </button>
      <button className="button danger" name="intent" value="confirm" disabled={pending} aria-describedby={describedBy}>
        {words.confirm}
      </button>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

// An action that needs a few words first, such as a rejection's reason, in a native modal dialog.
export function DialogAction({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className="button small danger" onClick={() => dialog.current?.showModal()}>
        {label}
      </button>
      <dialog ref={dialog} aria-label={title}>
        <h2>{title}</h2>
        {children}
        <p style={{ marginTop: 12 }}>
          <button type="button" className="button small" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
        </p>
      </dialog>
    </>
  );
}
