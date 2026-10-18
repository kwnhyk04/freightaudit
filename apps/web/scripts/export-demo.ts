// Exports the public demo snapshot (README, Review UI): the given invoices, through the same GraphQL documents the UI
// uses, into public/demo/*.json, with each stored PDF. The demo is public, so only golden-set invoices may be exported:
// an invoice whose content hash is in no golden manifest is refused.
// Usage: pnpm --filter @freightaudit/web demo:export --ids=<id>,<id>,...
import { DeadLettersDocument, DiscrepanciesDocument, InvoiceDocument, InvoicesDocument, type TypedDocumentString } from '@freightaudit/contracts/graphql';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { ids: { type: 'string' } } });
const ids = values.ids?.split(',').filter(Boolean) ?? [];
if (ids.length === 0) throw new Error('give --ids=<invoice id>,...');
const { API_URL, API_KEY } = process.env;
if (!API_URL || !API_KEY) throw new Error('API_URL and API_KEY must be set (.env)');

async function gql<R, V>(document: TypedDocumentString<R, V>, variables: V): Promise<R> {
  const response = await fetch(new URL('/graphql', API_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY! },
    body: JSON.stringify({ query: document.toString(), variables }),
  });
  const body = (await response.json()) as { data?: R; errors?: { message: string }[] };
  if (!body.data) throw new Error(body.errors?.[0]?.message ?? `HTTP ${response.status}`);
  return body.data;
}

const golden = new URL('../../../evals/golden/v1/manifest.json', import.meta.url);
const manifest = JSON.parse(readFileSync(golden, 'utf8')) as { cases: { sha256?: string }[] } | Record<string, unknown>;
const hashes = new Set(JSON.stringify(manifest).match(/[0-9a-f]{64}/g) ?? []);

const out = new URL('../public/demo/', import.meta.url);
const details: Record<string, unknown> = {};
const pdfs = new Map<string, Buffer>();
for (const id of ids) {
  const detail = await gql(InvoiceDocument, { id });
  if (!detail.invoice) throw new Error(`invoice ${id} not found`);
  if (!hashes.has(detail.invoice.contentHash)) throw new Error(`invoice ${id} is not a golden-set invoice; the demo is public`);
  details[id] = detail;
  const pdf = await fetch(new URL(`/v1/invoices/${id}/document`, API_URL), { headers: { 'x-api-key': API_KEY } });
  if (pdf.ok) pdfs.set(id, Buffer.from(await pdf.arrayBuffer()));
}

// List pages hold exactly the exported invoices and their rows.
const keep = new Set(ids);
const invoices = await gql(InvoicesDocument, { first: 100, after: null, status: null });
invoices.invoices.edges = invoices.invoices.edges.filter(({ node }) => keep.has(node.id));
invoices.invoices.totalCount = invoices.invoices.edges.length;
invoices.invoices.pageInfo = { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null };
const discrepancies = { discrepancies: { edges: [] as unknown[], pageInfo: { hasNextPage: false, endCursor: null } } };
for (const status of ['OPEN', 'CONFIRMED', 'DISMISSED'] as const) {
  const page = await gql(DiscrepanciesDocument, { first: 100, after: null, status });
  discrepancies.discrepancies.edges.push(...page.discrepancies.edges.filter(({ node }) => keep.has(node.invoice.id)));
}
const deadLetters = { deadLetters: { edges: [] as unknown[], pageInfo: { hasNextPage: false, endCursor: null } } };
for (const status of ['OPEN', 'REPLAYED'] as const) {
  const page = await gql(DeadLettersDocument, { first: 100, after: null, status });
  deadLetters.deadLetters.edges.push(...page.deadLetters.edges.filter(({ node }) => node.invoice && keep.has(node.invoice.id)));
}

// Nothing is written until every invoice passed the check and every query answered, so a refused export leaves the
// committed sample as it was.
for (const name of readdirSync(out)) if (name.endsWith('.pdf')) rmSync(new URL(name, out));
for (const [id, bytes] of pdfs) writeFileSync(new URL(`${id}.pdf`, out), bytes);
const write = (name: string, data: unknown) => writeFileSync(new URL(name, out), `${JSON.stringify(data, null, 2)}\n`);
write('invoices.json', invoices);
write('invoice-details.json', details);
write('discrepancies.json', discrepancies);
write('dead-letters.json', deadLetters);
console.log(JSON.stringify({ msg: 'demo snapshot exported', invoices: ids.length }));
