import { expect, type Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { olderBrowser, PASSWORD } from './env.ts';

const sample = JSON.parse(readFileSync(new URL('../public/demo/invoices.json', import.meta.url), 'utf8')) as {
  invoices: { edges: { node: { id: string; status: string; filename: string; openDiscrepancyCount: number } }[] };
};
const sampleId = (file: string) => sample.invoices.edges.find(({ node }) => node.filename === file)!.node.id;
type Cell = { result: string; met: boolean } | null;
type Run = { date: string } | null;
const results = JSON.parse(readFileSync(new URL('../lib/eval-results.json', import.meta.url), 'utf8')) as {
  cases: number;
  claudeFirst: Run;
  free: Run;
  rows: { label: string; target: string; claudeFirst: Cell; free: Cell }[];
};
// The hero's figures are g066's open finding, as the sample stores it.
const details = JSON.parse(readFileSync(new URL('../public/demo/invoice-details.json', import.meta.url), 'utf8')) as Record<
  string,
  { invoice: { filename: string; discrepancies: { edges: { node: { status: string; billedCents: number; expectedCents: number } }[] } } }
>;
const g066 = Object.values(details)
  .find(({ invoice }) => invoice.filename === 'g066.pdf')!
  .invoice.discrepancies.edges.find(({ node }) => node.status === 'OPEN')!.node;
const usd = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const longDate = (date: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
const offline = `http://127.0.0.1:${process.env.E2E_OFFLINE_PORT ?? 3002}`;
const unknown = '00000000-0000-4000-8000-000000000000';
const env = parseEnv(readFileSync(new URL('e2e.env', import.meta.url), 'utf8'));
const HEADLINE = 'Pay the contract rate, not the invoice.';

test("in a browser without what pdf.js's modern build needs, the sample's viewer still draws the document", async ({ page }) => {
  await olderBrowser(page);
  await page.goto(`/demo/invoices/${sampleId('g066.pdf')}`);
  // The pages settle either drawn or with the viewer's error, which takes the drawn page away.
  await expect(page.getByRole('region', { name: 'Document pages' })).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByText('The document could not be shown.')).toHaveCount(0);
  await expect(page.getByRole('img', { name: /^Page 1 of / })).toBeVisible();
});

test('the landing page at / is public and static: no redirect, no api call, no key in it, and its links lead on', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const response = await page.goto('/');
  expect([response!.status(), new URL(page.url()).pathname]).toEqual([200, '/']);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADLINE);
  expect(await response!.text()).not.toContain(env.API_KEY!);
  // The pill is true, the one figure under the buttons is the eval's overcharge recall, and no partner logos stand in for proof.
  await expect(page.locator('.hero-pill')).toHaveText('Live demo');
  const recall = results.rows.find((row) => row.label === 'Overcharge recall')!;
  await expect(page.locator('.hero-stat')).toContainText(`${(recall.claudeFirst ?? recall.free)!.result} overcharge recall on ${results.cases} synthetic test invoices`);
  await expect(page.getByText('Trusted by')).toHaveCount(0);
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', '/login');
  // The invoice card beside the headline is g066's open finding, labelled as the sample it is.
  const recon = page.locator('figure[data-seenry-signature]');
  for (const [term, cents] of [
    ['Linehaul billed', g066.billedCents],
    ['Contract, rate card v2', g066.expectedCents],
    ['Held for review', g066.billedCents - g066.expectedCents],
  ] as const) {
    await expect(recon.locator('dl > div', { has: page.locator('dt', { hasText: term }) }).locator('dd')).toHaveText(usd(cents));
  }
  await expect(recon).toContainText('Sample invoice from the demo set');
  // The results are the two official runs' from eval-results.json, each dated: each run's column shows its cell, or
  // that it is not measured yet, and every row is there.
  const table = page.getByRole('region', { name: 'Results by metric' });
  // It is the app's boxed list table, as on Invoices, not a loose ledger.
  await expect(table.locator('table')).toHaveClass(/\blist-table\b/);
  await expect(page.getByText(`${results.cases} synthetic invoices with known ground truth`)).toBeVisible();
  for (const [name, run] of [
    ['Claude first', results.claudeFirst],
    ['Free models only', results.free],
  ] as const) {
    await expect(table.getByRole('columnheader', { name: new RegExp(`^${name}`) })).toContainText(run ? longDate(run.date) : 'Not measured yet');
  }
  await expect(table.getByRole('row')).toHaveCount(results.rows.length + 1);
  for (const row of results.rows) {
    const cells = table.getByRole('row', { name: new RegExp(`^${row.label.replace(/[()/]/g, '\\$&')}`) }).getByRole('cell');
    // Metric and Target come first, then Claude first and Free models only.
    for (const [i, cell] of [row.claudeFirst, row.free].entries()) {
      const shown = cells.nth(i + 2);
      if (!cell) {
        await expect(shown).toHaveText('Not measured yet');
        continue;
      }
      await expect(shown).toContainText(cell.result);
      await expect(shown).toContainText(cell.met ? 'Met' : 'Below target');
    }
  }
  // How it works is three steps, each with its title; the header links every section, Features included.
  await expect(page.locator('#how .how-steps h3')).toHaveText(['Upload', 'Check', 'Decide']);
  await expect(page.getByRole('banner').getByRole('link', { name: 'Features', exact: true })).toHaveAttribute('href', '#features');
  // Features is seven cards in the reference's rows: one wide and one narrow, then three, then two.
  const features = page.locator('#features');
  const cards = features.locator('.bento > li');
  await expect(cards).toHaveCount(7);
  const boxes = await cards.evaluateAll((items) => items.map((item) => item.getBoundingClientRect()).map(({ y, width }) => ({ y: Math.round(y), width })));
  expect(new Set(boxes.map(({ y }) => y)).size).toBe(3);
  expect([boxes[0]!.y === boxes[1]!.y, boxes[2]!.y === boxes[4]!.y, boxes[5]!.y === boxes[6]!.y]).toEqual([true, true, true]);
  expect(boxes[0]!.width).toBeGreaterThan(boxes[1]!.width * 1.8);
  // The wide card charts g066's own trail: received, read in 3.3 s (the bar marked slow), matched and held; its line
  // says the sample predates Claude first.
  const trail = page.getByRole('list', { name: 'Audit trail of the sample invoice' });
  await expect(trail.getByRole('listitem')).toHaveCount(4);
  await expect(trail.getByRole('listitem')).toContainText(['Received', 'Read', 'Matched', 'Held']);
  await expect(trail.getByRole('listitem').nth(1)).toContainText('3.3 s');
  await expect(features).toContainText('before Claude first went live, so Gemini 3.5 Flash-Lite read it.');
  // The dead letter on a scrubber: where it failed, its error, and Replay.
  await expect(features.locator('.scrubber')).toContainText('Reconciliation failed');
  await expect(features).toContainText('shipment has no miles');
  // A real finding as the alert on top: the duplicate Linehaul and what it costs.
  const alert = features.getByRole('article', { name: 'Finding', exact: true });
  await expect(alert).toHaveCount(1);
  await expect(alert).toContainText('Linehaul billed twice');
  await expect(alert).toContainText('+$5,522.06');
  // The cost chart: each run's digital and scanned cost from eval-results.json, Claude first's scanned one highlighted.
  const costRow = results.rows.find((row) => row.label.startsWith('Cost per invoice'))!;
  const [digital, scanned] = costRow.claudeFirst!.result.split(' / ');
  await expect(features.locator('.cost-figure')).toHaveText(scanned!);
  await expect(features.locator('.cost-chart li[data-highlight]')).toContainText(scanned!);
  await expect(features.locator('.cost-chart li')).toHaveCount(4);
  await expect(features.locator('.cost-chart')).toContainText(digital!);
  // The code window: the rate-card check from its file.
  await expect(features.locator('.code-window')).toContainText('packages/domain/src/reconcile.ts');
  await expect(features.locator('.code-window')).toContainText('if (amountCents > finding.expectedCents)');
  // The decision as two keys, and the log line with its credentials masked.
  await expect(features.locator('.keycap')).toHaveText(['Approve charge', 'Dispute']);
  await expect(features).toContainText('Synthetic data only');
  await expect(features.locator('.masked')).toHaveText(['[Redacted]', '[Redacted]']);
  // The close keeps its words and leads to the demo, over the name scrolling large and faint.
  const closing = page.locator('.closing');
  await expect(closing.getByRole('heading', { level: 2 })).toHaveText('Check the next invoice against the contract.');
  await expect(closing).toContainText('Open the live demo and decide a finding yourself.');
  await expect(closing.getByRole('link', { name: 'Open the demo' })).toHaveAttribute('href', '/dashboard');
  await expect(closing.locator('.marquee')).toContainText('FreightAudit');
  // Every engineering proof links to its file on main.
  const proofs = page.locator('.evidence-links a');
  expect(await proofs.count()).toBeGreaterThan(0);
  // A claim's files stack, one per line.
  const pair = page.locator('.evidence-links').filter({ has: page.locator('a:nth-child(2)') }).first().locator('a');
  const [first, second] = [await pair.nth(0).boundingBox(), await pair.nth(1).boundingBox()];
  expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1);
  for (const href of await proofs.evaluateAll((links) => links.map((link) => link.getAttribute('href')))) {
    expect(href).toMatch(/^https:\/\/github\.com\/kwnhyk04\/freightaudit\/(blob|tree)\/main\/\S+$/);
  }
  await page.getByRole('link', { name: 'Open it in the sample' }).click();
  await expect(page).toHaveURL(`/demo/invoices/${sampleId('g066.pdf')}`);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'GitHub', exact: true })).toHaveAttribute('href', 'https://github.com/kwnhyk04/freightaudit');
  await page.getByRole('link', { name: 'See sample invoices, no sign-in' }).click();
  await expect(page).toHaveURL(/\/demo\/invoices$/);
  // Signed out, the live demo asks for the password first; the sign-in page's name leads home.
  await page.goto('/');
  await page.getByRole('link', { name: 'Try the live demo' }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  await page.getByRole('link', { name: 'FreightAudit' }).click();
  await expect(page).toHaveURL(/127[.]0[.]0[.]1:3000\/$/);
  expect(requests.filter((url) => url.includes(':4000'))).toEqual([]);
  // The web whose api is down serves the same page.
  expect((await page.goto(`${offline}/`))!.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADLINE);
});

test('the invoice list leads with the invoice, then its carrier and status', async ({ page }) => {
  await page.goto('/demo/invoices');
  await expect(page.locator('thead th')).toHaveText(['Invoice', 'Carrier', 'Status', 'Issued', 'Received', 'Open findings', 'Billed', 'Expected', 'Difference']);
});

test("the sample opens on its invoices, and Overview in its sidebar shows the sample's one week, without cost or tokens", async ({ page }) => {
  test.skip(sample.invoices.edges.length === 0, 'the sample is empty');
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/demo');
  await expect(page).toHaveURL(/\/demo\/invoices$/);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Overview' }).click();
  await expect(page).toHaveURL(/\/demo\/dashboard$/);
  await expect(page.getByRole('status')).toHaveText('Sample data, read-only');
  await expect(page.getByText('The sample covers one week: its 11 invoices arrived on Oct 17, 2026.')).toBeVisible();
  await expect(page.locator('.hero-card .hero-figure')).toHaveText('$8,279.22');
  await expect(page.locator('.hero-card')).toContainText('Across 4 invoices');
  await expect(page.locator('.stats dt:text-is("Invoices received") + dd')).toHaveText('11');
  await expect(page.locator('.stats dt:text-is("Model cost per invoice")')).toHaveCount(0);
  await expect(page.locator('.health dt:text-is("AI tokens today")')).toHaveCount(0);
  await expect(page.locator('.health dt:text-is("Dead letters") + dd')).toHaveText('1');
  // The carriers that bill most above the rate card, largest first.
  await expect(page.locator('.carrier-bars li')).toHaveText([/^Tern & Tide Carriers.*\$7,314\.56$/, /^Bramblewood Express.*\$904\.77$/, /^Quarry Lane Transport.*\$59\.89$/]);
  // A range stays in the sample.
  await page.getByRole('navigation', { name: 'Time range' }).getByRole('link', { name: '8 weeks' }).click();
  await expect(page).toHaveURL(/\/demo\/dashboard[?]range=8w$/);
  await expect(page.locator('.hero-card dt')).toHaveText('Overbilling found, last 8 weeks');
  expect(requests.filter((url) => url.includes(':4000'))).toEqual([]);
});

test('signed out, the sample is public and read-only, and live pages still need a session', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/login');
  await page.getByRole('link', { name: 'View sample data without signing in' }).click();
  await expect(page).toHaveURL(/\/demo\/invoices$/);
  await expect(page.getByRole('status')).toHaveText('Sample data, read-only');
  // Under the tabs, one line says what the current filter holds.
  await expect(page.getByText('Every invoice, newest first.')).toBeVisible();
  if (sample.invoices.edges.length > 0) {
    // The cards, tabs and sidebar count what the sample holds.
    const open = sample.invoices.edges.reduce((sum, { node }) => sum + node.openDiscrepancyCount, 0);
    await expect(page.locator('.stats dt:text-is("Open findings") + dd')).toHaveText(String(open));
    await expect(page.getByRole('navigation', { name: 'Filter by status' }).getByRole('link', { name: `All ${sample.invoices.edges.length} invoices` })).toBeVisible();
    await expect(page.getByRole('link', { name: `Review queue, ${open} open findings` })).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(sample.invoices.edges.length);
    await page.locator('tbody a').first().click();
    await expect(page.getByRole('img', { name: /^Page 1 of/ })).toBeVisible();
  } else {
    await expect(page.getByText('The sample is empty.')).toBeVisible();
  }
  for (const name of ['Approve charge', 'Dispute', 'Reject', 'Replay', 'Re-run matching', 'Approve for payment', 'Approve at rate card', 'Upload invoice']) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  if (sample.invoices.edges.length > 0) {
    // One sample invoice stays in needs review, so visitors see its correction panel, read-only.
    const review = sample.invoices.edges.find(({ node }) => node.status === 'NEEDS_REVIEW');
    expect(review, 'the sample holds an invoice in needs review').toBeDefined();
    await page.goto(`/demo/invoices/${review!.node.id}`);
    await expect(page.getByRole('region', { name: 'Reading needs a check' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Carrier' })).toBeDisabled();
    await expect(page.getByRole('textbox', { name: 'PRO number' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Re-run matching' })).toHaveCount(0);
  }
  await page.goto('/demo/discrepancies');
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
  await page.goto('/demo/dead-letters');
  await expect(page.getByRole('heading', { name: 'Dead letters' })).toBeVisible();
  for (const path of ['/invoices', '/discrepancies', '/dead-letters', '/upload']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
  await page.goto('/dashboard?range=7d');
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard%3Frange%3D7d$/);
  expect((await page.request.get('/api/invoices/00000000-0000-0000-0000-000000000000/document')).status()).toBe(401);
  expect(requests.filter((url) => url.includes(':4000'))).toEqual([]);
});

test('a sample id the sample lacks shows the not-found page under the banner', async ({ page }) => {
  await page.goto(`/demo/invoices/${unknown}`);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Sample data, read-only');
});

test('a digital sample shows its marks to the eye only; a scan shows none, and its legend says why', async ({ page }) => {
  test.skip(sample.invoices.edges.length === 0, 'the sample is empty');
  await page.goto(`/demo/invoices/${sampleId('g069.pdf')}`);
  const pages = page.getByRole('region', { name: 'Document pages' });
  await expect(pages).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.marks').first()).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.mark:not(.line)')).not.toHaveCount(0);
  // g069 bills its shipment a second time, so every one of its three lines is a finding.
  await expect(page.locator('.mark.line')).toHaveCount(3);
  await expect(page.getByText("Found by matching the AI's values in the PDF text")).toBeVisible();
  await page.goto(`/demo/invoices/${sampleId('g066.pdf')}`);
  await expect(pages).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByText('Marks need a digital PDF; this one is a scan.')).toBeVisible();
  await expect(page.locator('.mark')).toHaveCount(0);
});

test('signed in while the backend is down, the app shows the same sample under the offline banner', async ({ page }) => {
  await page.goto(`${offline}/login`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(`${offline}/demo/dashboard`);
  await expect(page.getByRole('status')).toHaveText('Live backend offline, showing sample data');
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
  // The overview's range goes with it.
  await page.goto(`${offline}/dashboard?range=8w`);
  await expect(page).toHaveURL(`${offline}/demo/dashboard?range=8w`);
  await page.goto(`${offline}/demo/invoices`);
  await expect(page.getByRole('link', { name: 'Upload invoice' })).toHaveCount(0);
  // A live invoice the sample holds opens its twin; any other lands on the sample's list instead of a bare 404.
  if (sample.invoices.edges.length > 0) {
    const known = sample.invoices.edges[0]!.node.id;
    await page.goto(`${offline}/invoices/${known}`);
    await expect(page).toHaveURL(`${offline}/demo/invoices/${known}`);
  }
  await page.goto(`${offline}/invoices/${unknown}`);
  await expect(page).toHaveURL(`${offline}/demo/invoices`);
  await expect(page.getByRole('status')).toHaveText('Live backend offline, showing sample data');
});

test('a repeated q or status in a pasted link still shows the sample list', async ({ page }) => {
  await page.goto('/demo/invoices?q=a&q=b&status=billing_issues&status=approved');
  await expect(page.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Filter by status' }).getByRole('link', { name: /^Billing issues/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Checked against the rate card, with findings to decide or a confirmed duplicate to reject.')).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search invoices' })).toHaveValue('a');
});

test("the sample's checked invoices split into billing issues and ready to approve", async ({ page }) => {
  test.skip(sample.invoices.edges.length === 0, 'the sample is empty');
  const checked = sample.invoices.edges.filter(({ node }) => node.status === 'RECONCILED');
  const issues = checked.filter(({ node }) => node.openDiscrepancyCount > 0).length;
  const tabs = page.getByRole('navigation', { name: 'Filter by status' });
  await page.goto('/demo/invoices');
  await tabs.getByRole('link', { name: `Billing issues ${issues} invoices` }).click();
  await expect(page).toHaveURL(/\/demo\/invoices[?]status=billing_issues$/);
  await expect(page.locator('tbody tr')).toHaveCount(issues);
  await tabs.getByRole('link', { name: `Ready to approve ${checked.length - issues} invoices` }).click();
  await expect(page.locator('tbody tr')).toHaveCount(checked.length - issues);
});

test('leaving an invoice while its viewer loads fetches no PDF', async ({ page }) => {
  test.skip(sample.invoices.edges.length === 0, 'the sample is empty');
  const id = sampleId('g069.pdf');
  // pdf.js arrives in chunks that name its WorkerMessageHandler; they wait until the page has been left.
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let hold!: () => void;
  const held = new Promise<void>((resolve) => (hold = resolve));
  await page.route('**/_next/static/chunks/**', async (route) => {
    const response = await route.fetch();
    const body = await response.body();
    if (body.includes('WorkerMessageHandler')) {
      hold();
      await released;
    }
    await route.fulfill({ response, body });
  });
  const fetched: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === `/demo/${id}.pdf`) fetched.push(request.url());
  });
  try {
    await page.goto(`/demo/invoices/${id}`, { waitUntil: 'commit' });
    await held;
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Invoices', exact: true }).click();
    await expect(page).toHaveURL(/\/demo\/invoices$/);
  } finally {
    release();
  }
  // Another invoice's viewer loads after the held chunks resolve; by its PDF request the left page would have asked too.
  const other = sampleId('g056.pdf');
  const next = page.waitForRequest((request) => new URL(request.url()).pathname === `/demo/${other}.pdf`);
  await page.locator(`a[href="/demo/invoices/${other}"]`).click();
  await next;
  expect(fetched).toEqual([]);
});

test('a finding reads its title before its amount, and the amount still sits left of it', async ({ page }) => {
  test.skip(sample.invoices.edges.length === 0, 'the sample is empty');
  await page.goto(`/demo/invoices/${sampleId('g056.pdf')}`);
  const finding = page.locator('.findings article').first();
  const titleFirst = await finding.evaluate((article) =>
    Boolean(article.querySelector('h3')!.compareDocumentPosition(article.querySelector(':scope > .num')!) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
  expect(titleFirst).toBe(true);
  const [title, amount] = await Promise.all([finding.getByRole('heading', { level: 3 }).boundingBox(), finding.locator(':scope > .num').boundingBox()]);
  expect(amount!.x).toBeLessThan(title!.x);
});

test('a finding names its charge as the invoice prints it, not by its code in capitals', async ({ page }) => {
  test.skip(sample.invoices.edges.length === 0, 'the sample is empty');
  const code = /\b[A-Z][A-Z_]{3,}\b/;
  await page.goto(`/demo/invoices/${sampleId('g069.pdf')}`);
  const texts = await page.locator('.findings .finding-body > p.muted').allTextContents();
  expect(texts).toHaveLength(3);
  for (const text of texts) expect(text).not.toMatch(code);
  // The review queue names each finding's line the same way.
  await page.goto('/demo/discrepancies');
  const cells = await page.locator('tbody td:nth-child(3), tbody td.muted').allTextContents();
  expect(cells.length).toBeGreaterThan(0);
  for (const text of cells) expect(text).not.toMatch(code);
});

test('the sidebar folds to its icons, every link keeps its name, and the fold is remembered', async ({ page }) => {
  await page.goto('/demo/invoices');
  const nav = page.getByRole('navigation', { name: 'Main' });
  const links = { Audit: ['Overview', 'Invoices', /^Review queue, \d+ open findings?$/], Operations: [/^Dead letters, \d+ open dead letters?$/] };
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
  expect(Math.round((await page.locator('aside.sidebar').boundingBox())!.width)).toBe(64);
  for (const [group, names] of Object.entries(links)) {
    for (const name of names) await expect(nav.getByRole('group', { name: group }).getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole('link', { name: 'Invoices', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.sidebar-foot')).toContainText('Sample data');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  expect(Math.round((await page.locator('aside.sidebar').boundingBox())!.width)).toBe(232);
});

test('the list tabs stay links with their counts, one underline slides to the current one, and still motion holds it', async ({ page }) => {
  const underline = (nav: ReturnType<typeof page.getByRole>) =>
    nav.evaluate((element: HTMLElement) => {
      const tab = element.querySelector<HTMLElement>('[aria-current="page"]')!;
      return { slide: element.dataset.slide, x: element.style.getPropertyValue('--x'), left: `${tab.offsetLeft}px`, w: element.style.getPropertyValue('--w'), width: String(tab.offsetWidth) };
    });
  await page.goto('/demo/invoices');
  const tabs = page.getByRole('navigation', { name: 'Filter by status' });
  await expect(tabs.getByRole('link', { name: /^All \d+ invoices$/ })).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('link', { name: /^Billing issues \d+ invoices$/ }).click();
  await expect(page).toHaveURL(/status=billing_issues/);
  await expect(tabs.getByRole('link', { name: /^Billing issues/ })).toHaveAttribute('aria-current', 'page');
  const placed = await underline(tabs);
  expect(placed.slide).toBe('true');
  expect([placed.x, placed.w]).toEqual([placed.left, placed.width]);
  expect(await tabs.evaluate((element) => getComputedStyle(element, '::after').transitionDuration)).not.toBe('0s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await tabs.evaluate((element) => getComputedStyle(element, '::after').transitionDuration)).toBe('0s');
  // The table keeps every column from 1440 px; below it Open findings hides, as the status pill gives the count. The card
  // labels are for the phone, where no header shows.
  const headers = () => page.getByRole('region', { name: 'Invoices' }).getByRole('columnheader').allTextContents();
  expect(await headers()).toEqual(['Invoice', 'Carrier', 'Status', 'Issued', 'Received', 'Billed', 'Expected', 'Difference']);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(headers).toEqual(['Invoice', 'Carrier', 'Status', 'Issued', 'Received', 'Open findings', 'Billed', 'Expected', 'Difference']);
  await expect(page.locator('.card-label').first()).toBeHidden();
  // The review queue's decision tabs work the same way, and its evidence keeps the smaller size.
  await page.goto('/demo/discrepancies');
  const decisions = page.getByRole('navigation', { name: 'Filter by decision' });
  await expect(decisions.getByRole('link', { name: 'Open' })).toHaveAttribute('aria-current', 'page');
  expect((await underline(decisions)).slide).toBe('true');
  expect(await page.locator('tbody td:nth-child(6)').first().evaluate((cell) => getComputedStyle(cell).fontSize)).toBe('13px');
});

// The page's canvas, light or dark, as the browser computes it.
const LIGHT = 'rgb(246, 247, 249)';
const DARK = 'rgb(18, 20, 23)';
const canvas = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('the theme follows the device until a reviewer picks Light or Dark, which the server applies from then on, landing and sign-in included', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/demo/invoices');
  const themes = page.getByRole('group', { name: 'Theme' });
  await expect(themes.getByRole('radio', { name: 'System' })).toBeChecked();
  expect(await page.locator('html').getAttribute('data-theme')).toBeNull();
  expect(await canvas(page)).toBe(DARK);
  // Light wins over a dark device at once, and from the next page on the server renders it: the HTML carries it.
  await themes.getByRole('radio', { name: 'Light' }).check();
  expect(await canvas(page)).toBe(LIGHT);
  for (const path of ['/demo/invoices', '/', '/login']) {
    const response = await page.goto(path);
    expect(await response!.text(), path).toMatch(/<html[^>]* data-theme="light"/);
    expect(await canvas(page), path).toBe(LIGHT);
  }
  // Dark wins over a light device, remembered after a reload.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/demo/invoices');
  await themes.getByRole('radio', { name: 'Dark' }).check();
  expect(await canvas(page)).toBe(DARK);
  await page.reload();
  await expect(themes.getByRole('radio', { name: 'Dark' })).toBeChecked();
  expect(await canvas(page)).toBe(DARK);
  // System forgets the choice: no cookie, and the device decides again.
  await themes.getByRole('radio', { name: 'System' }).check();
  expect(await canvas(page)).toBe(LIGHT);
  expect((await page.context().cookies()).some((cookie) => cookie.name === 'fa-theme')).toBe(false);
  await page.reload();
  expect(await page.locator('html').getAttribute('data-theme')).toBeNull();
});

test('on a phone the landing header has one theme button, which steps System, Light, Dark and back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const banner = page.getByRole('banner');
  await expect(banner.getByRole('group', { name: 'Theme' })).toBeHidden();
  for (const [now, next, theme] of [
    ['System', 'Light', 'light'],
    ['Light', 'Dark', 'dark'],
    ['Dark', 'System', null],
  ] as const) {
    await banner.getByRole('button', { name: `Theme: ${now}. Switch to ${next}` }).click();
    expect(await page.locator('html').getAttribute('data-theme')).toBe(theme);
  }
  expect(await canvas(page)).toBe(LIGHT);
});

test('no flash: a page in a chosen theme paints in it before any script runs', async ({ page, context }) => {
  await context.addCookies([{ name: 'fa-theme', value: 'dark', url: 'http://127.0.0.1' }]);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.route('**/*.js', (route) => route.abort());
  await page.goto('/demo/invoices');
  expect(await canvas(page)).toBe(DARK);
});

test('every table in the app is the shared one, a list table or the landing page ledger', async ({ page }) => {
  test.skip(sample.invoices.edges.length === 0, 'the sample is empty');
  for (const path of ['/demo/invoices', '/demo/discrepancies', '/demo/dead-letters', '/demo/dashboard', `/demo/invoices/${sampleId('g066.pdf')}`, '/']) {
    await page.goto(path);
    await page.locator('details.table-view summary').evaluateAll((summaries) => summaries.forEach((summary) => (summary.parentElement as HTMLDetailsElement).open = true));
    const tables = await page.locator('table').evaluateAll((all) => all.map((table) => table.className));
    expect(tables.length, path).toBeGreaterThan(0);
    for (const name of tables) expect(name, path).toMatch(/\b(list-table|ledger)\b/);
  }
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the phone drawer holds the theme switch too', async ({ page }) => {
    await page.goto('/demo/invoices');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const themes = page.getByRole('group', { name: 'Theme' });
    await expect(themes).toBeVisible();
    await themes.getByRole('radio', { name: 'Dark' }).check();
    expect(await canvas(page)).toBe(DARK);
  });

  test('each invoice is a card with its number, carrier, status and amount over contract, and the whole card opens it', async ({ page }) => {
    test.skip(sample.invoices.edges.length === 0, 'the sample is empty');
    const id = sampleId('g066.pdf');
    await page.goto('/demo/invoices');
    const row = page.getByRole('row').filter({ has: page.locator(`a[href="/demo/invoices/${id}"]`) });
    await expect(row.getByRole('link', { name: '76644482' })).toBeVisible();
    await expect(row.getByText('Bramblewood Express')).toBeVisible();
    await expect(row.locator('.badge')).toBeVisible();
    // The label is text in the page, so a screen reader reads it with the amount.
    await expect(row.getByText('Over contract', { exact: true })).toBeVisible();
    await expect(row.getByText('+$801.54')).toBeVisible();
    for (const column of [4, 5, 6, 7, 8]) await expect(row.locator(`td:nth-child(${column})`)).toBeHidden();
    // A tap on the card, away from the number, opens the invoice.
    await row.scrollIntoViewIfNeeded();
    const card = (await row.boundingBox())!;
    await page.mouse.click(card.x + card.width / 2, card.y + card.height - 8);
    await expect(page).toHaveURL(new RegExp(`/demo/invoices/${id}$`));
  });

  test('the status tabs scroll sideways with a fade at the edge, and the page never does', async ({ page }) => {
    await page.goto('/demo/invoices?status=approved');
    const tabs = page.getByRole('navigation', { name: 'Filter by status' });
    const strip = await tabs.evaluate((element) => ({ scrolls: element.scrollWidth > element.clientWidth, mask: getComputedStyle(element).maskImage }));
    expect(strip.scrolls).toBe(true);
    expect(strip.mask).toContain('linear-gradient');
    // The current tab is scrolled into the strip.
    const [box, current] = await Promise.all([tabs.boundingBox(), tabs.locator('[aria-current="page"]').boundingBox()]);
    expect(current!.x + current!.width).toBeLessThanOrEqual(box!.x + box!.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test('each finding is a card with its amounts labelled in text', async ({ page }) => {
    await page.goto('/demo/discrepancies');
    const row = page.locator('tbody tr').first();
    await expect(row.getByText('Billed', { exact: true })).toBeVisible();
    await expect(row.getByText('Expected', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test('the menu opens the sidebar as a drawer that keeps focus until Escape, and a link closes it', async ({ page }) => {
    await page.goto('/demo/invoices');
    const nav = page.getByRole('navigation', { name: 'Main' });
    const menu = page.getByRole('button', { name: 'Open menu' });
    await expect(nav).toBeHidden();
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(nav).toBeVisible();
    // Tabbing past the drawer's last control leaves the page, never for the work behind the drawer.
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement === document.body || Boolean(document.activeElement?.closest('aside.sidebar'))), `tab ${i + 1}`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(menu).toBeFocused();
    await menu.click();
    await nav.getByRole('link', { name: 'Overview' }).click();
    await expect(page).toHaveURL(/\/demo\/dashboard$/);
    await expect(nav).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test('a charge keeps its finding type on one line, and only the table scrolls sideways', async ({ page }) => {
    test.skip(sample.invoices.edges.length === 0, 'the sample is empty');
    await page.goto(`/demo/invoices/${sampleId('g069.pdf')}`);
    const types = page.locator('table.charges tbody td:nth-child(2) > div.faint');
    await expect(types).toHaveCount(3);
    // A range over the text has one box per line the text fills.
    const lines = await types.evaluateAll((elements) =>
      elements.map((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getClientRects().length;
      }),
    );
    expect(lines).toEqual([1, 1, 1]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test('the document bar shows the whole file name, with its controls on one row', async ({ page }) => {
    test.skip(sample.invoices.edges.length === 0, 'the sample is empty');
    await page.goto(`/demo/invoices/${sampleId('g069.pdf')}`);
    await expect(page.getByRole('region', { name: 'Document pages' })).toHaveAttribute('aria-busy', 'false');
    expect(await page.locator('.doc-name').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const controls = [page.getByRole('button', { name: 'Zoom out' }), page.getByRole('button', { name: 'Zoom in' }), page.getByRole('link', { name: 'Open PDF' })];
    const tops = await Promise.all(controls.map(async (control) => Math.round((await control.boundingBox())!.y)));
    expect(new Set(tops).size).toBe(1);
  });
});
