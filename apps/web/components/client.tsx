'use client';
import type { InvoiceDecision } from '@freightaudit/contracts/graphql';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useActionState, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type ActionState, login, review, upload, uploadSample } from '../app/actions.ts';
import { duplicateParts, type Tone } from '../lib/labels.ts';
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
// next page in it. In the folded sidebar only the icons show; each radio keeps its name.
export function ThemeSwitch({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState(initial);
  const choose = (next: Theme) => {
    setTheme(next);
    document.cookie = themeCookie(next);
    if (next === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
  };
  return (
    <fieldset className="segmented theme-switch">
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
}

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(login, {});
  return (
    <form action={action}>
      <div>
        <h1>
          <Link href="/" className="home">
            FreightAudit
          </Link>
        </h1>
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

// One sample, one tap: the server reads the file by its key and uploads it through the same checks as a chosen file.
export function SampleButton({ sample, label, note }: { sample: string; label: string; note: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(uploadSample, {});
  const id = `sample-${sample}`;
  return (
    <form action={action} className="sample">
      <input type="hidden" name="sample" value={sample} />
      <button className="link" aria-describedby={`${id}-note`} disabled={pending}>
        {pending ? 'Uploading…' : label}
      </button>
      <p id={`${id}-note`} className="faint">
        {note}
      </p>
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
