'use server';
import {
  ApproveInvoiceDocument,
  CorrectInvoiceDocument,
  RejectInvoiceDocument,
  ReplayDeadLetterDocument,
  ResolveDiscrepancyDocument,
} from '@freightaudit/contracts/graphql';
import { checkUpload } from '@freightaudit/contracts/limits';
import { refresh } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { createLimiter } from '../lib/limiter.ts';
import { verifyPassword } from '../lib/password.ts';
import { ApiError, clientKey, currentSession, env, gql, isLive, log, markOffline, rest, REVIEWER } from '../lib/server.ts';
import { createToken, safeNext, SESSION_COOKIE, SESSION_COOKIE_ATTRIBUTES, SESSION_SECONDS } from '../lib/session.ts';

export type ActionState = { error?: string };

const limiter = createLimiter();
// The API's messages start lower case and stop without a period; the UI shows them as sentences.
const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`;

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

export async function review(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await asReviewer();
    const id = text(form, 'id');
    const intent = text(form, 'intent');
    if (intent === 'approve') await gql(ApproveInvoiceDocument, { id }, REVIEWER);
    else if (intent === 'confirm' || intent === 'dismiss') {
      const decision = intent === 'confirm' ? 'CONFIRM' : 'DISMISS';
      await gql(ResolveDiscrepancyDocument, { id, decision, note: text(form, 'note') || null }, REVIEWER);
    } else if (intent === 'correct') {
      await gql(CorrectInvoiceDocument, { id, carrierId: text(form, 'carrierId') || null, proNumber: text(form, 'proNumber') || null }, REVIEWER);
    } else if (intent === 'reject') await gql(RejectInvoiceDocument, { id, reason: text(form, 'reason') }, REVIEWER);
    else if (intent === 'replay') await gql(ReplayDeadLetterDocument, { id }, REVIEWER);
    else return { error: 'Unknown action.' };
  } catch (err) {
    if (err instanceof ApiError) return { error: sentence(err.message) };
    throw err;
  }
  refresh();
  return {};
}

export async function upload(_: ActionState, form: FormData): Promise<ActionState> {
  let id: string;
  try {
    await asReviewer();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return { error: 'Choose a file to upload.' };
    // The same checks the api runs, so a refused file never travels further than this server.
    const checked = checkUpload(new Uint8Array(await file.arrayBuffer()), file.size);
    if (!checked.ok) return { error: sentence(`${file.name}: ${checked.detail}`) };
    const { data, error, response } = await rest().POST('/v1/invoices', {
      params: { header: { 'Idempotency-Key': randomUUID() } },
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
      return { error: sentence(detail) + (wait ? ` Try again in ${wait} seconds.` : '') };
    }
    id = data.id;
  } catch (err) {
    if (err instanceof ApiError) return { error: sentence(err.message) };
    if (err instanceof TypeError) {
      markOffline();
      return { error: 'The FreightAudit API did not answer. Try again in a moment.' };
    }
    throw err;
  }
  redirect(`/invoices/${id}`);
}
