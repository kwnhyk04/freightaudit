'use client';
import { checkUpload, MAX_PDF_PAGES, MAX_UPLOAD_LABEL } from '@freightaudit/contracts/limits';
import Link from 'next/link';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionState } from '../app/actions.ts';
import { duplicateParts, plural, STEPS, type UploadState, type Words } from '../lib/labels.ts';
import { answered, type Picked, pickProblem, progressLabel, RETRYABLE, sizeLabel, uploadedToast, uploadLabel } from '../lib/uploads.ts';
import { sendUpload } from './client.tsx';
import { Said } from './ui.tsx';

// A recent upload's row, and the toast it gets once the pipeline settles it while the page is open.
export type RecentRow = UploadState & { id: string; filename: string; inFlight: boolean; finished: { text: string; tone: 'ok' | 'bad' } };
type Toast = { id: number; tone: 'ok' | 'neutral' | 'bad'; words: Words; lines?: string[]; link?: { href: string; text: string }; retry?: boolean };

// A success or a notice fades after this long; an error stays until closed.
const FADE_MS = 6_000;
// The first page's picture is drawn this many pixels wide, twice the width it shows at.
const THUMB_WIDTH = 96;
// A file that can go: read, nothing against it, and not sent yet, or sent and met an answer worth trying again.
const sendable = (pick: Picked) => pick.checked && !pick.problem && (pick.state === 'ready' || (pick.state === 'failed' && pick.retry === true));
// The file chooser, which takes the focus when the button that had it leaves the page, so it never falls to the body.
const CHOOSER = 'invoice-files';
const focusOn = (id: string) => document.getElementById(id)?.focus();
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
const duplicateWords = (existing: NonNullable<ActionState['existing']>): Words => {
  const [before, name, after] = duplicateParts(existing);
  return [before, { invoice: existing.id, text: name }, after];
};

// A PDF's page count and its first page drawn small, with pdf.js as the viewer loads it; either may stay unknown.
async function firstPage(bytes: Uint8Array): Promise<{ pages?: number; thumb?: string }> {
  let task: PDFDocumentLoadingTask | undefined;
  try {
    // @ts-expect-error -- the worker module ships no types; importing it only registers it.
    await import('pdfjs-dist/build/pdf.worker.min.mjs');
    const pdfjs = await import('pdfjs-dist');
    task = pdfjs.getDocument({ data: bytes.slice() });
    const doc = await task.promise;
    try {
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: THUMB_WIDTH / page.getViewport({ scale: 1 }).width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      return { pages: doc.numPages, thumb: canvas.toDataURL('image/png') };
    } catch {
      return { pages: doc.numPages };
    }
  } catch {
    return {};
  } finally {
    void task?.destroy();
  }
}

// What a picked file is, read in this browser before anything is sent: the api's own checks, its pages, its first page
// as a picture, and on the demo whether its digest is one of the golden set's.
async function inspect(file: File, allowlist: readonly string[] | null): Promise<Partial<Picked>> {
  const check = checkUpload(new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer()), file.size);
  if (!check.ok) return { checked: true, problem: pickProblem(check, file.size, undefined, undefined, allowlist) };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = allowlist ? hex(await crypto.subtle.digest('SHA-256', bytes)) : undefined;
  const { pages, thumb } = check.type === 'pdf' ? await firstPage(bytes) : { pages: 1, thumb: URL.createObjectURL(file) };
  return { checked: true, pages, thumb, problem: pickProblem(check, file.size, pages, digest, allowlist) };
}

// The dropzone, the files picked and their Upload, the toasts, and the recent uploads below. Choosing or dropping files
// only lists them; Upload sends them one at a time and says how far it is. The toasts sit in a polite live region.
export function UploadArea({ rows, allowlist }: { rows: RecentRow[]; allowlist: readonly string[] | null }) {
  const [picks, setPicks] = useState<Picked[]>([]);
  const [progress, setProgress] = useState<{ at: number; of: number }>();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [over, setOver] = useState(false);
  // Choosing a file does nothing until React can read it, so the input waits for the page to hydrate.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const toastId = useRef(0);
  const sending = progress !== undefined;
  const update = (id: string, change: Partial<Picked>) => setPicks((list) => list.map((each) => (each.id === id ? { ...each, ...change } : each)));
  const toast = useCallback((item: Omit<Toast, 'id'>) => setToasts((list) => [...list, { ...item, id: (toastId.current += 1) }]), []);
  const close = useCallback((id: number) => setToasts((list) => list.filter((each) => each.id !== id)), []);
  // A picture of an image file is the file itself, held by the page until its line goes.
  const release = (gone: Picked[]) => gone.forEach((pick) => pick.thumb?.startsWith('blob:') && URL.revokeObjectURL(pick.thumb));

  function add(files: FileList) {
    const added: Picked[] = [...files].map((file) => ({ id: crypto.randomUUID(), file, checked: false, state: 'ready' }));
    setPicks((list) => [...list, ...added]);
    // A file this browser cannot read goes unchecked here; the server's own checks still apply when it is sent.
    for (const pick of added) void inspect(pick.file, allowlist).then((found) => update(pick.id, found), () => update(pick.id, { checked: true }));
  }
  // The focus goes to the next file's Remove, else to the file chooser, before the pressed button leaves the page.
  function remove(id: string) {
    const next = picks[picks.findIndex((each) => each.id === id) + 1];
    focusOn(next ? `remove-${next.id}` : CHOOSER);
    release(picks.filter((each) => each.id === id));
    setPicks((list) => list.filter((each) => each.id !== id));
  }
  function clear() {
    release(picks);
    setPicks([]);
  }
  // Emptying the list, by Clear or by an upload that sent every file, takes its buttons with it: the focus they held goes
  // to the file chooser, unless the reviewer moved it elsewhere meanwhile.
  const listed = picks.length > 0;
  const wasListed = useRef(listed);
  useEffect(() => {
    if (wasListed.current && !listed && document.activeElement === document.body) focusOn(CHOOSER);
    wasListed.current = listed;
  }, [listed]);

  // Sends the files in the order listed, and answered says what each answer does to the list: an uploaded file leaves it,
  // and a busy api, its rate limit or no answer ends the batch. Files added meanwhile wait for the next Upload.
  async function send(batch: Picked[]) {
    setPicks((list) => list.map((each) => (batch.some((sent) => sent.id === each.id) ? { ...each, state: 'queued', reason: undefined } : each)));
    const uploaded: string[] = [];
    const failed: string[] = [];
    let retry = false;
    for (const [index, pick] of batch.entries()) {
      setProgress({ at: index + 1, of: batch.length });
      update(pick.id, { state: 'sending' });
      const form = new FormData();
      form.append('file', pick.file, pick.file.name);
      const result: ActionState = await sendUpload(form).catch(() => ({ error: 'The upload did not reach the server.', code: 'UNAVAILABLE' }));
      const unsent = batch.slice(index + 1).map((each) => each.id);
      setPicks((list) => answered(list, pick.id, result, unsent));
      if (result.existing) toast({ tone: 'neutral', words: duplicateWords(result.existing) });
      else if (result.error) {
        failed.push(`${pick.file.name}: ${result.error}`);
        if (RETRYABLE.has(result.code ?? '')) {
          retry = true;
          break;
        }
      } else {
        release([pick]);
        uploaded.push(result.id ?? '');
      }
    }
    setProgress(undefined);
    if (uploaded.length > 0) {
      const href = uploaded.length === 1 && uploaded[0] ? `/invoices/${uploaded[0]}` : '/invoices';
      toast({ tone: 'ok', words: [uploadedToast(uploaded.length)], link: { href, text: 'View' } });
    }
    if (failed.length > 0) toast({ tone: 'bad', words: ['Not uploaded'], lines: failed, retry });
  }

  // A recent upload that settles while the page is open gets a toast; rows already settled at first sight get none.
  const flying = useRef(new Map<string, boolean>());
  useEffect(() => {
    for (const row of rows) {
      if (flying.current.get(row.id) && !row.inFlight) toast({ tone: row.finished.tone, words: [row.finished.text], link: { href: `/invoices/${row.id}`, text: 'View' } });
      flying.current.set(row.id, row.inFlight);
    }
  }, [rows, toast]);

  const count = picks.filter(sendable).length;
  return (
    <div className="upload-main">
      <div
        className={`drop${over ? ' over' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          add(event.dataTransfer.files);
        }}
      >
        <svg className="drop-icon" aria-hidden="true" viewBox="0 0 24 24" width="24" height="24">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M12 17v-6 M9.5 13.5 12 11l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p>
          <strong>Drop invoices here, or </strong>
          <label htmlFor={CHOOSER} className="link">
            choose files
          </label>
        </p>
        <input
          id={CHOOSER}
          className="visually-hidden"
          type="file"
          multiple
          aria-label="Invoice files"
          aria-describedby="upload-hint"
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          disabled={!ready}
          onChange={(event) => {
            if (event.target.files) add(event.target.files);
            event.target.value = '';
          }}
        />
        <p id="upload-hint" className="faint">
          PDF, PNG or JPG, up to {MAX_UPLOAD_LABEL}, one invoice per file. A PDF may have up to {MAX_PDF_PAGES} pages. Files wait in the list below until you upload them.
        </p>
      </div>
      <p className="visually-hidden" role="status">
        {progress ? progressLabel(progress.at, progress.of) : ''}
      </p>
      {picks.length > 0 && (
        <section className="panel picks" aria-labelledby="picks-title">
          <div className="picks-head">
            <h2 id="picks-title">Files to upload</h2>
            <div className="row">
              <button type="button" className="button" onClick={clear} disabled={sending}>
                Clear
              </button>
              {(sending || count > 0) && (
                <button type="button" className="button primary" onClick={() => void send(picks.filter(sendable))} disabled={sending}>
                  {progress ? (
                    <>
                      <span className="spinner" aria-hidden="true" /> {progressLabel(progress.at, progress.of)}
                    </>
                  ) : (
                    uploadLabel(count)
                  )}
                </button>
              )}
            </div>
          </div>
          <ul className="picks-list" aria-label="Files to upload">
            {picks.map((pick) => (
              <li key={pick.id} className="pick">
                {pick.thumb ? <img className="thumb" src={pick.thumb} alt="" /> : <span className="thumb" aria-hidden="true" />}
                <div className="pick-body">
                  <span className="id pick-name">{pick.file.name}</span>
                  <span className="faint">{[sizeLabel(pick.file.size), pick.pages === undefined ? undefined : plural(pick.pages, 'page')].filter(Boolean).join(' · ')}</span>
                  <PickNote pick={pick} />
                </div>
                <button type="button" id={`remove-${pick.id}`} className="button small" aria-label={`Remove ${pick.file.name}`} onClick={() => remove(pick.id)} disabled={sending}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((item) => (
          <ToastCard
            key={item.id}
            toast={item}
            close={close}
            retry={
              item.retry
                ? () => {
                    close(item.id);
                    void send(picks.filter(sendable));
                  }
                : undefined
            }
          />
        ))}
      </div>
      <section className="panel recent" aria-labelledby="recent-title">
        <h2 id="recent-title">Recent uploads</h2>
        {rows.length === 0 ? (
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
                    <td className={`num wrap text-${row.tone}`}>
                      {row.result}
                      {row.rebill && (
                        <div className="muted">
                          <Said words={row.rebill} base="" />
                        </div>
                      )}
                    </td>
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

// Where a picked file stands: being read, why it would be refused, then its upload's outcome.
function PickNote({ pick }: { pick: Picked }) {
  if (!pick.checked) return <span className="faint">Checking the file…</span>;
  if (pick.problem) return <span className="text-warn">{pick.problem}</span>;
  if (pick.state === 'queued') return <span className="faint">Waiting</span>;
  if (pick.state === 'sending') return <span className="muted">Uploading…</span>;
  if (pick.state === 'existing' && pick.existing) {
    return (
      <span className="muted">
        <Said words={duplicateWords(pick.existing)} base="" />
      </span>
    );
  }
  if (pick.state === 'failed') return <span className="text-bad">Not uploaded: {pick.reason}</span>;
  return null;
}

// One toast: its words and link, the lines of an error, and Retry where sending again may work. A success or a notice
// fades by itself; an error stays until closed.
function ToastCard({ toast, close, retry }: { toast: Toast; close: (id: number) => void; retry?: () => void }) {
  const fades = toast.tone !== 'bad';
  useEffect(() => {
    if (!fades) return;
    const timer = setTimeout(() => close(toast.id), FADE_MS);
    return () => clearTimeout(timer);
  }, [fades, close, toast.id]);
  return (
    <div className={`toast ${toast.tone}${fades ? ' fades' : ''}`}>
      <p>
        <Said words={toast.words} base="" />
        {toast.link && (
          <>
            {' '}
            <Link href={toast.link.href}>{toast.link.text}</Link>
          </>
        )}
      </p>
      {toast.lines && (
        <ul>
          {toast.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {!fades && (
        <div className="row">
          {retry && (
            <button type="button" className="button small" onClick={retry}>
              Retry
            </button>
          )}
          <button type="button" className="button small" onClick={() => close(toast.id)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
