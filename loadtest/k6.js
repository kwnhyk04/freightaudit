// The k6 load test in two parts (README, Load test), run through compose against the api on the host:
//   docker compose --env-file .env -f infra/docker-compose.yml run --rm k6 run -e SCENARIO=system /loadtest/k6.js
// SCENARIO=system: 2 minutes at the normal rate, then 10 at 3x, with the recorded-fixture model provider; then a drain
//   that waits for every accepted invoice to reach a final status. Throughput evidence: the backlog never reaches its
//   high-water mark, so backpressure is proven by apps/api/src/limits.int.test.ts instead.
// SCENARIO=e2e: end-to-end latency at low load with real free-tier models: 20 single-page golden v1 invoices, one every
//   15 s, below the free tiers' ceiling, so the run measures latency rather than throttling.
// The results go to /loadtest/<scenario>-results.json, which evals/harness/report.ts puts in the README table.
import exec from 'k6/execution';
import http from 'k6/http';
import { sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const SCENARIO = __ENV.SCENARIO;
if (SCENARIO !== 'system' && SCENARIO !== 'e2e') throw new Error('run with -e SCENARIO=system or -e SCENARIO=e2e');
const API = __ENV.API_URL;
const KEY = (__ENV.API_KEYS || '').split(',')[0].trim();
const TERMINAL = ['reconciled', 'needs_review', 'approved', 'failed'];

// The normal rate is the design's throughput target, 2,000 invoices an hour: 20 every 36 s.
const NORMAL = 20;

// Part 1 sends the PDFs the recorded replies were read from, 4 digital to 1 scanned like the golden set; part 2 sends
// single-page golden v1 cases, digital and scanned in turn, none of them adversarial.
const DIGITAL = ['g001', 'g002', 'g003', 'g004', 'g005', 'g006', 'g007', 'g008', 'g009', 'g010'];
const SCANNED = ['g047', 'g048', 'g049', 'g050', 'g051', 'g052', 'g053', 'g066', 'g067', 'g068'];
const CASES = SCENARIO === 'system' ? ['digital', 'digital', 'digital', 'digital', 'scanned'] : DIGITAL.flatMap((id, i) => [id, SCANNED[i]]);
const PDFS = Object.fromEntries(CASES.map((name) => [name, open(SCENARIO === 'system' ? `/fixtures/${name}.pdf` : `/golden/cases/${name}.pdf`, 'b')]));

const accepted = new Counter('uploads_accepted');
const refused = new Counter('uploads_refused');
const finished = Object.fromEntries(TERMINAL.map((status) => [status, new Counter(`finished_${status}`)]));
const pending = new Counter('invoices_pending');
const drainSeconds = new Trend('drain_s');
const e2eMs = new Trend('e2e_ms', true);

export const options = {
  summaryTrendStats: ['med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  scenarios:
    SCENARIO === 'system'
      ? {
          load: {
            executor: 'ramping-arrival-rate',
            exec: 'load',
            startRate: NORMAL,
            timeUnit: '36s',
            preAllocatedVUs: 20,
            maxVUs: 100,
            stages: [
              { target: NORMAL, duration: '2m' },
              { target: 3 * NORMAL, duration: '15s' },
              { target: 3 * NORMAL, duration: '10m' },
            ],
          },
          drain: { executor: 'shared-iterations', exec: 'drain', vus: 1, iterations: 1, startTime: '12m20s', maxDuration: '10m' },
        }
      : // One start every 15 s from 0 to 285 s: 20 invoices. A 300 s duration would start a 21st at its end.
        { e2e: { executor: 'constant-arrival-rate', exec: 'e2e', rate: 1, timeUnit: '15s', duration: '290s', preAllocatedVUs: 5, maxVUs: 20 } },
  thresholds:
    SCENARIO === 'system'
      ? { 'http_req_duration{name:upload}': ['p(99)<1000'], invoices_pending: ['count==0'] }
      : { 'http_req_duration{name:upload}': ['p(99)<5000'] },
};

const headers = { 'X-API-Key': KEY };

// The same PDF with a trailing comment, which PDF readers skip: a new content hash, so a new invoice and extract job.
function variant(bytes) {
  const tail = `\n%k6 ${Date.now()} ${exec.scenario.iterationInTest}\n`;
  const out = new Uint8Array(bytes.byteLength + tail.length);
  out.set(new Uint8Array(bytes));
  for (let i = 0; i < tail.length; i++) out[bytes.byteLength + i] = tail.charCodeAt(i);
  return out.buffer;
}

function upload(name) {
  const body = { file: http.file(variant(PDFS[name]), `${name}.pdf`, 'application/pdf') };
  const res = http.post(`${API}/v1/invoices`, body, {
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    tags: { name: 'upload' },
  });
  // 503 (backlog full) or 429 (rate limit) is a refusal the client retries later, never a lost invoice.
  if (res.status !== 202) {
    refused.add(1, { status: String(res.status) });
    return undefined;
  }
  accepted.add(1);
  return res.json('id');
}

export function setup() {
  if (!KEY) throw new Error('API_KEYS is empty: compose passes it from .env');
  return { start: new Date().toISOString() };
}

export function load() {
  upload(CASES[exec.scenario.iterationInTest % CASES.length]);
}

// Pages through the invoices created since the start until all are final, or 9 minutes pass.
export function drain({ start }) {
  const begun = Date.now();
  for (;;) {
    const counts = {};
    let total = 0;
    let cursor = '';
    do {
      const page = http.get(`${API}/v1/invoices?limit=100${cursor && `&cursor=${encodeURIComponent(cursor)}`}`, { headers, tags: { name: 'list' } }).json();
      const recent = page.items.filter((invoice) => invoice.created_at >= start);
      for (const { status } of recent) counts[status] = (counts[status] ?? 0) + 1;
      total += recent.length;
      cursor = recent.length === page.items.length ? page.next_cursor : '';
    } while (cursor);
    const open = total - TERMINAL.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
    if (open === 0 || Date.now() - begun > 9 * 60_000) {
      for (const status of TERMINAL) finished[status].add(counts[status] ?? 0);
      pending.add(open);
      drainSeconds.add((Date.now() - begun) / 1_000);
      return;
    }
    sleep(5);
  }
}

// From the upload request to a final status, polled every 500 ms for at most 5 minutes.
export function e2e() {
  const started = Date.now();
  const id = upload(CASES[exec.scenario.iterationInTest % CASES.length]);
  if (!id) return;
  while (Date.now() - started < 5 * 60_000) {
    const { status } = http.get(`${API}/v1/invoices/${id}`, { headers, tags: { name: 'poll' } }).json();
    if (TERMINAL.includes(status)) {
      e2eMs.add(Date.now() - started);
      finished[status].add(1);
      return;
    }
    sleep(0.5);
  }
  pending.add(1);
}

export function handleSummary(data) {
  const value = (metric, stat = 'count') => data.metrics[metric]?.values[stat] ?? 0;
  const statuses = Object.fromEntries(TERMINAL.map((status) => [status, value(`finished_${status}`)]));
  const done = Object.values(statuses).reduce((sum, count) => sum + count, 0);
  const upload = (stat) => Math.round(value('http_req_duration{name:upload}', stat));
  const common = { scenario: SCENARIO, date: new Date().toISOString().slice(0, 10), accepted: value('uploads_accepted'), refused: value('uploads_refused'), statuses, pending: value('invoices_pending') };
  const result =
    SCENARIO === 'system'
      ? {
          ...common,
          provider: 'recorded-fixture',
          normal_per_hour: 2_000,
          offered_per_hour: 6_000,
          lost: value('uploads_accepted') - done,
          upload_ms: { p50: upload('med'), p95: upload('p(95)'), p99: upload('p(99)'), max: upload('max') },
          drain_s: Math.round(value('drain_s', 'max')),
        }
      : {
          ...common,
          provider: 'real free-tier models',
          n: value('e2e_ms', 'count'),
          e2e_ms: { p50: Math.round(value('e2e_ms', 'med')), p90: Math.round(value('e2e_ms', 'p(90)')), max: Math.round(value('e2e_ms', 'max')) },
          note: `n = ${value('e2e_ms', 'count')}: p95 is not meaningful; p90 and max are reported instead.`,
        };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  return { [`/loadtest/${SCENARIO}-results.json`]: json, stdout: json };
}
