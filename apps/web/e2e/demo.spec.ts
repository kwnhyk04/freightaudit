import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PASSWORD } from './env.ts';

const sample = JSON.parse(readFileSync(new URL('../public/demo/invoices.json', import.meta.url), 'utf8')) as {
  invoices: { edges: { node: { id: string; status: string; filename: string; openDiscrepancyCount: number } }[] };
};
const sampleId = (file: string) => sample.invoices.edges.find(({ node }) => node.filename === file)!.node.id;
const offline = `http://127.0.0.1:${process.env.E2E_OFFLINE_PORT ?? 3002}`;
const unknown = '00000000-0000-4000-8000-000000000000';

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
  for (const name of ['Approve charge', 'Dispute', 'Replay', 'Re-run matching', 'Approve for payment', 'Approve at rate card', 'Upload invoice']) {
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
  await expect(page).toHaveURL(`${offline}/demo/invoices`);
  await expect(page.getByRole('status')).toHaveText('Live backend offline, showing sample data');
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
  await page.goto('/demo/invoices?q=a&q=b&status=reconciled&status=approved');
  await expect(page.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Filter by status' }).getByRole('link', { name: /^Checked/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Checked against the rate card: ready to approve, or billing issues to decide.')).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search invoices' })).toHaveValue('a');
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

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

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
