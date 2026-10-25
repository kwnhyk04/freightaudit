'use client';
import type { InvoiceDecision } from '@freightaudit/contracts/graphql';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useActionState, useEffect, useRef } from 'react';
import { type ActionState, login, review, upload, uploadSample } from '../app/actions.ts';
import { duplicateParts } from '../lib/labels.ts';

// One file through the upload action, for components/upload.tsx. Called here, the action ships with every page that loads
// this file: proxy.ts sends a sessionless upload to /login, which runs only actions it carries, and the session check
// there sends the browser to sign-in.
export const sendUpload = (form: FormData) => upload({}, form);

// The sidebar's links, marking the section the reader is in, with a count where one waits; screen readers hear the
// count as words.
export function NavLinks({ links }: { links: { href: string; label: string; count?: number; unit?: string; tone?: 'warn' }[] }) {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={path.startsWith(link.href) ? 'page' : undefined}
          aria-label={link.count ? `${link.label}, ${link.count} ${link.unit}${link.count === 1 ? '' : 's'}` : undefined}
        >
          {link.label}
          {link.count !== undefined && link.count > 0 && <span className={`count${link.tone ? ` ${link.tone}` : ''}`}>{link.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function LoginForm({ next }: { next?: string }) {
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

// Refreshes the page while the pipeline still moves an invoice, and stops once it settles: every 5 s, then every 60 s
// after 2 minutes, since an upload waiting for the next day's model budget waits until 00:00 UTC. The live region tells
// screen readers each new status.
export function StatusPoller({ active, label }: { active: boolean; label: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh();
      timer = setTimeout(tick, Date.now() - started < 120_000 ? 5_000 : 60_000);
    };
    timer = setTimeout(tick, 5_000);
    return () => clearTimeout(timer);
  }, [active, router]);
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
