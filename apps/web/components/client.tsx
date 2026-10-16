'use client';
import { checkUpload, MAX_PDF_PAGES, MAX_UPLOAD_LABEL, type UploadCheck } from '@freightaudit/contracts/limits';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useActionState, useEffect, useRef, useState } from 'react';
import { type ActionState, login, review, upload } from '../app/actions.ts';

// The sidebar's links, marking the section the reader is in.
export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {links.map((link) => (
        <Link key={link.href} href={link.href} aria-current={path.startsWith(link.href) ? 'page' : undefined}>
          {link.label}
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

// Refreshes the page while the pipeline still moves the invoice, and stops once it settles. The live region tells
// screen readers each new status.
export function StatusPoller({ active, label }: { active: boolean; label: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => document.visibilityState === 'visible' && router.refresh(), 5_000);
    return () => clearInterval(timer);
  }, [active, router]);
  return (
    <p className="visually-hidden" aria-live="polite">
      Status: {label}
    </p>
  );
}

// The document, drawn with pdf.js page by page at the panel's width. Headless browsers and phones show it the same way,
// which a browser's own PDF viewer does not.
export function DocumentViewer({ src }: { src: string }) {
  const pages = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [state, setState] = useState<{ count?: number; error?: string }>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The worker module runs on this thread, so no worker file has to be served.
        // @ts-expect-error -- the worker module ships no types; importing it only registers it.
        await import('pdfjs-dist/build/pdf.worker.min.mjs');
        const pdfjs = await import('pdfjs-dist');
        const doc = await pdfjs.getDocument({ url: src }).promise;
        const host = pages.current;
        if (cancelled || !host) return;
        host.replaceChildren();
        const width = Math.max(host.clientWidth - 32, 240);
        for (let number = 1; number <= doc.numPages && !cancelled; number++) {
          const page = await doc.getPage(number);
          const scale = (width / page.getViewport({ scale: 1 }).width) * zoom;
          const viewport = page.getViewport({ scale: scale * window.devicePixelRatio });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${viewport.width / window.devicePixelRatio}px`;
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', `Page ${number} of ${doc.numPages}`);
          host.append(canvas);
          await page.render({ canvas, viewport }).promise;
        }
        if (!cancelled) setState({ count: doc.numPages });
      } catch (err) {
        const missing = (err as { status?: number }).status === 404;
        if (!cancelled) setState({ error: missing ? 'No document is stored for this invoice.' : 'The document could not be shown.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, zoom]);
  return (
    <section className="doc" aria-label="Invoice document">
      <div className="doc-bar">
        <span>{state.count ? `${state.count} page${state.count === 1 ? '' : 's'}` : state.error ? 'Document' : 'Loading document'}</span>
        <span className="row">
          <button type="button" className="button small" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
            −
          </button>
          <span className="num" style={{ minWidth: 40 }}>
            {Math.round(zoom * 100)}%
          </span>
          <button type="button" className="button small" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
            +
          </button>
          {!state.error && (
            <a className="button small" href={src} target="_blank" rel="noreferrer">
              Open PDF
            </a>
          )}
        </span>
      </div>
      <div className="doc-pages" ref={pages}>
        {state.error && <p className="empty">{state.error}</p>}
      </div>
    </section>
  );
}

const describe = (file: File, check: Exclude<UploadCheck, { ok: true }>) => {
  if (check.detail.startsWith('file is larger')) return `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_UPLOAD_LABEL}.`;
  if (check.detail.startsWith('file must be')) return `${file.name} isn't a PDF, PNG or JPG.`;
  return `${file.name}: ${check.detail}.`;
};

// The same checks the api runs, before a byte leaves the browser.
export function UploadForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(upload, {});
  const [problem, setProblem] = useState<string>();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function check(file: File | undefined) {
    if (!file) return setProblem(undefined);
    const result = checkUpload(new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer()), file.size);
    setProblem(result.ok ? undefined : describe(file, result));
  }
  return (
    <form
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
        if (input.current && event.dataTransfer.files.length > 0) {
          input.current.files = event.dataTransfer.files;
          void check(event.dataTransfer.files[0]);
        }
      }}
    >
      <label>
        Invoice file
        <input ref={input} type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" required onChange={(event) => void check(event.target.files?.[0])} />
      </label>
      <p className="faint">
        PDF, PNG or JPG, up to {MAX_UPLOAD_LABEL}. Drop a file here or choose one. A PDF may have up to {MAX_PDF_PAGES} pages; the server counts them.
      </p>
      {(problem ?? state.error) && (
        <p className="form-error" role="alert">
          {problem ?? state.error}
        </p>
      )}
      <button className="button primary" disabled={pending || Boolean(problem)}>
        {pending ? 'Uploading' : 'Upload invoice'}
      </button>
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

// A finding's decision in one row: an optional note, then approve the charge or dispute it. The pressed button sends
// its intent.
export function DecideForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(review, {});
  return (
    <form action={action} className="row decide">
      <input type="hidden" name="id" value={id} />
      <input name="note" placeholder="Note (optional)" aria-label="Note" maxLength={1000} />
      <button className="button" name="intent" value="dismiss" disabled={pending}>
        Approve charge
      </button>
      <button className="button danger" name="intent" value="confirm" disabled={pending}>
        Dispute
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
