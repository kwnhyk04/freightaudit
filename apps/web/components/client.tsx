'use client';
import type { InvoiceDecision } from '@freightaudit/contracts/graphql';
import { checkUpload, MAX_PDF_PAGES, MAX_UPLOAD_LABEL, type UploadCheck } from '@freightaudit/contracts/limits';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useActionState, useEffect, useRef, useState } from 'react';
import { type ActionState, login, review, upload, uploadSample } from '../app/actions.ts';
import { duplicateParts, STEPS, type UploadState } from '../lib/labels.ts';

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
        <h1>FreightAudit</h1>
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

const describe = (file: File, check: Exclude<UploadCheck, { ok: true }>) => {
  if (check.detail.startsWith('file is larger')) return `The file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_UPLOAD_LABEL}.`;
  if (check.detail.startsWith('file must be')) return "It isn't a PDF, PNG or JPG.";
  return `${check.detail.charAt(0).toUpperCase()}${check.detail.slice(1)}.`;
};

export type RecentRow = UploadState & { id: string; filename: string };

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

// The dropzone and the recent uploads below it. A chosen or dropped file is checked as the api would check it and then
// uploads by itself; a refused one joins the list as "Not accepted" until the page reloads, since it never reaches the
// server. The live region says what is happening; focus stays where it was.
export function UploadArea({ rows }: { rows: RecentRow[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(upload, {});
  const [refused, setRefused] = useState<{ name: string; reason: string }[]>([]);
  // The latest file refused in the browser, announced in place of any earlier upload's result.
  const [notice, setNotice] = useState<string>();
  const [sending, setSending] = useState<string>();
  const [over, setOver] = useState(false);
  // Choosing a file does nothing until React can check it, so the input waits for the page to hydrate.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  // An upload's own result comes after any refusal made while it was sending.
  useEffect(() => {
    if (!pending) setNotice(undefined);
  }, [pending]);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // A file that never reaches the server joins the list as "Not accepted" and is announced.
  function refuse(name: string, reason: string) {
    setRefused((list) => [{ name, reason }, ...list]);
    setNotice(`${name} not accepted: ${reason}`);
  }
  async function take(file: File | undefined) {
    if (!file) return;
    const result = checkUpload(new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer()), file.size);
    if (!result.ok) {
      refuse(file.name, describe(file, result));
      setSending(undefined);
      if (input.current) input.current.value = '';
      return;
    }
    setNotice(undefined);
    setSending(file.name);
    form.current?.requestSubmit();
  }
  // A refusal made while an upload sends is announced at once, in place of the upload's progress.
  const status = notice ?? (pending ? `Uploading ${sending}` : (state.error ?? state.done ?? ''));
  return (
    <div className="upload-main">
      <form
        ref={form}
        action={action}
        className={`drop${over ? ' over' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const file = event.dataTransfer.files[0];
          if (!input.current || !file) return;
          // A drop while an upload sends is refused: the disabled input would leave its file out of the form.
          if (pending) return refuse(file.name, `Dropped while ${sending} was uploading. Drop it again.`);
          input.current.files = event.dataTransfer.files;
          void take(file);
        }}
      >
        <svg className="drop-icon" aria-hidden="true" viewBox="0 0 24 24" width="24" height="24">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M12 17v-6 M9.5 13.5 12 11l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p>
          <strong>Drop an invoice here, or </strong>
          <label htmlFor="invoice-file" className="link">
            choose a file
          </label>
        </p>
        <input
          ref={input}
          id="invoice-file"
          className="visually-hidden"
          type="file"
          name="file"
          aria-label="Invoice file"
          aria-describedby="upload-hint"
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          disabled={!ready || pending}
          onChange={(event) => void take(event.target.files?.[0])}
        />
        <p id="upload-hint" className="faint">
          PDF, PNG or JPG, up to {MAX_UPLOAD_LABEL}, one invoice per file. A PDF may have up to {MAX_PDF_PAGES} pages. It uploads as soon as you choose it.
        </p>
        {/* The list below shows uploads and refused files; only a refusal from the server, or a duplicate's warning with
            its link, shows here too. */}
        <p className={state.error && !pending && !notice ? 'form-error' : 'visually-hidden'} role="status" aria-live="polite">
          {status}
        </p>
        {state.existing && !pending && !notice && <DuplicateNotice existing={state.existing} />}
      </form>
      <section className="panel recent" aria-labelledby="recent-title">
        <h2 id="recent-title">Recent uploads</h2>
        {rows.length === 0 && refused.length === 0 ? (
          <p className="faint">Nothing uploaded yet. Choose a file, or try a sample.</p>
        ) : (
          <div className="table-wrap" role="region" aria-labelledby="recent-title" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Progress</th>
                  <th scope="col" className="num">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody>
                {refused.map((file, index) => (
                  <tr key={`refused-${index}`}>
                    <td className="id">{file.name}</td>
                    <td className="text-bad">Not accepted</td>
                    <td className="num muted wrap">{file.reason}</td>
                  </tr>
                ))}
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/invoices/${row.id}`} className="id">
                        {row.filename}
                      </Link>
                    </td>
                    <td>
                      {row.step === undefined ? (
                        <span className="text-ok">{row.done}</span>
                      ) : (
                        <ol className="steps" aria-label="Progress">
                          {STEPS.map((step, index) => (
                            <li key={step} className={index < row.step! ? 'done' : index === row.step ? 'now' : undefined} aria-current={index === row.step ? 'step' : undefined}>
                              {step}
                            </li>
                          ))}
                        </ol>
                      )}
                    </td>
                    <td className={`num wrap text-${row.tone}`}>{row.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
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
