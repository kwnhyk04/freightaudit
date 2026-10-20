'use server';
import {
  ApproveInvoiceDocument,
  CorrectInvoiceDocument,
  DecideInvoiceDocument,
  InvoiceBriefDocument,
  type InvoiceBriefQuery,
  type InvoiceDecision,
  RejectInvoiceDocument,
  ReplayDeadLetterDocument,
  ResolveDiscrepancyDocument,
} from '@freightaudit/contracts/graphql';
import { checkUpload } from '@freightaudit/contracts/limits';
import { refresh } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { duplicateNote, refusal } from '../lib/labels.ts';
import { createLimiter } from '../lib/limiter.ts';
import { verifyPassword } from '../lib/password.ts';
import { SAMPLES } from '../lib/samples.ts';
import { ApiError, clientKey, currentSession, env, forgetSummary, gql, isLive, log, markOffline, requireSession, rest, REVIEWER } from '../lib/server.ts';
import { createToken, safeNext, SESSION_COOKIE, SESSION_COOKIE_ATTRIBUTES, SESSION_SECONDS } from '../lib/session.ts';

// error is the API's refusal as a sentence, with its code (CONFLICT means the page is out of date); done says what worked;
// existing is the invoice an exact duplicate upload already is.
export type ActionState = { error?: string; code?: string; done?: string; existing?: NonNullable<InvoiceBriefQuery['invoice']> };

const limiter = createLimiter();

export async function login(_: ActionState, form: FormData): Promise<ActionState> {
  const client = await clientKey();
  const wait = limiter.retryAfter(client);
  if (wait > 0) {
    log('warn', 'sign-in refused: too many attempts');
    return { error: `Too many sign-in attempts. Try again in ${Math.ceil(wait / 60_000)} minutes.` };
  }
  if (!(await verifyPassword(String(form.get('password') ?? ''), env().DEMO_PASSWORD_HASH))) {
    limiter.fail(client);
    log('warn', 'sign-in failed');
    return { error: 'Wrong password.' };
  }
  limiter.clear(client);
  (await cookies()).set(SESSION_COOKIE, createToken(REVIEWER, env().SESSION_SECRET), { ...SESSION_COOKIE_ATTRIBUTES, maxAge: SESSION_SECONDS });
  redirect(safeNext(form.get('next')));
}

// Every action needs the session and the live backend; sample data is read-only.
async function asReviewer() {
  if (!(await currentSession())) redirect('/login');
  if (!(await isLive())) throw new ApiError('Sample data is read-only.', 'READ_ONLY');
}

const text = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const DECISIONS: InvoiceDecision[] = ['APPROVE_AS_BILLED', 'DISPUTE', 'APPROVE_AT_RATE_CARD'];
// The findings a bulk decision saw, as the page sent them; the api compares them with what it holds.
function seenOf(form: FormData) {
  try {
    const seen: unknown = JSON.parse(text(form, 'seen'));
    if (Array.isArray(seen) && seen.every((each) => typeof each?.id === 'string' && typeof each?.version === 'string')) {
      return seen.map(({ id, version }: { id: string; version: string }) => ({ id, version }));
    }
  } catch {
    // Not JSON: refused below like any other malformed request.
  }
  return undefined;
}

export async function review(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await asReviewer();
    const id = text(form, 'id');
    const intent = text(form, 'intent');
    if (intent === 'approve') await gql(ApproveInvoiceDocument, { id }, REVIEWER);
    else if (intent === 'confirm' || intent === 'dismiss') {
      const decision = intent === 'confirm' ? 'CONFIRM' : 'DISMISS';
      await gql(ResolveDiscrepancyDocument, { id, decision, note: text(form, 'note') || null }, REVIEWER);
    } else if (intent === 'decide') {
      const decision = DECISIONS.find((each) => each === text(form, 'decision'));
      const seen = seenOf(form);
      if (!decision || !seen) return { error: 'Unknown action.' };
      await gql(DecideInvoiceDocument, { id, decision, seen, requestId: text(form, 'requestId') }, REVIEWER);
    } else if (intent === 'correct') {
      await gql(CorrectInvoiceDocument, { id, carrierId: text(form, 'carrierId') || null, proNumber: text(form, 'proNumber') || null, number: text(form, 'number') || null }, REVIEWER);
    } else if (intent === 'reject') await gql(RejectInvoiceDocument, { id, reason: text(form, 'reason') }, REVIEWER);
    else if (intent === 'replay') await gql(ReplayDeadLetterDocument, { id }, REVIEWER);
    else return { error: 'Unknown action.' };
  } catch (err) {
    if (err instanceof ApiError) return { error: refusal(err.message), code: err.code };
    throw err;
  }
  forgetSummary();
  refresh();
  return {};
}

// One upload, from a chosen file or a sample: the same checks the api runs, so a refused file never travels further
// than this server, then POST /v1/invoices. The page stays and refreshes, and the new invoice shows in its list.
async function send(file: File, key: string): Promise<ActionState> {
  try {
    await asReviewer();
    const checked = checkUpload(new Uint8Array(await file.arrayBuffer()), file.size);
    if (!checked.ok) return { error: refusal(`${file.name}: ${checked.detail}`) };
    const { data, error, response } = await rest().POST('/v1/invoices', {
      params: { header: { 'Idempotency-Key': key } },
      body: { file },
      bodySerializer: () => {
        const body = new FormData();
        body.append('file', file, file.name);
        return body;
      },
    });
    if (!data) {
      const wait = response.headers.get('retry-after');
      const detail = (error as { detail?: string } | undefined)?.detail ?? `the upload failed with HTTP ${response.status}`;
      return { error: refusal(detail) + (wait ? ` Try again in ${wait} seconds.` : '') };
    }
    // A 200 means these exact bytes were uploaded before and nothing new was created: say which invoice they are.
    if (response.status === 200) {
      const { invoice } = await gql(InvoiceBriefDocument, { id: data.id });
      if (invoice) return { done: duplicateNote(invoice), existing: invoice };
    }
  } catch (err) {
    if (err instanceof ApiError) return { error: refusal(err.message), code: err.code };
    if (err instanceof TypeError) {
      markOffline();
      return { error: 'The FreightAudit API did not answer. Try again in a moment.' };
    }
    throw err;
  }
  forgetSummary();
  refresh();
  return { done: `${file.name} uploaded.` };
}

export async function upload(_: ActionState, form: FormData): Promise<ActionState> {
  // The session comes first: an action also runs where proxy.ts lets requests through without one, such as /login.
  await requireSession();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a file to upload.' };
  return send(file, randomUUID());
}

// A sample by its key only, never a path: its bytes come from public/samples on this server's disk. Its Idempotency-Key
// is the content's digest, so tapping it again inserts no key row; the api's content hash finds the same invoice.
export async function uploadSample(_: ActionState, form: FormData): Promise<ActionState> {
  // The session first, as in upload.
  await requireSession();
  const sample = SAMPLES.find((each) => each.key === text(form, 'sample'));
  if (!sample) return { error: 'Unknown sample.' };
  let bytes: Buffer;
  try {
    bytes = await readFile(join(process.cwd(), 'public', 'samples', sample.file));
  } catch {
    log('error', 'sample file missing', { file: sample.file });
    return { error: `The sample ${sample.file} is missing on this server.` };
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  return send(new File([new Uint8Array(bytes)], sample.file, { type: 'application/pdf' }), `sample-${digest}`);
}
