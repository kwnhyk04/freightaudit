import { expect, type Page, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';

// pnpm e2e:screenshots: the round-1 screens at the sizes of the approved pictures, into docs/screenshots/ui/round-1/,
// then every main screen in light and dark at 1440x900 and list and detail on a phone, into docs/screenshots/ui/, for
// the design review. A phone page that scrolls sideways fails the run.
const out = new URL('../../../docs/screenshots/ui/', import.meta.url);
mkdirSync(new URL('round-1/', out), { recursive: true });
const env = parseEnv(readFileSync(new URL('e2e.env', import.meta.url), 'utf8'));
const shoot = (page: Page, file: string, fullPage = false) => page.screenshot({ path: fileURLToPath(new URL(file, out)), fullPage });
const digital = readFileSync(new URL('../../../packages/llm/fixtures/digital.pdf', import.meta.url));

async function ids() {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  const one = async (sql: string) => (await client.query(sql)).rows[0]?.id as string;
  const found = {
    uploaded: await one("SELECT id FROM invoices WHERE filename = 'digital.pdf' AND status = 'reconciled' LIMIT 1"),
    copy: await one("SELECT id FROM invoices WHERE filename = 'digital-copy.pdf' AND status = 'reconciled' LIMIT 1"),
    findings: await one("SELECT i.id FROM invoices i JOIN discrepancies d ON d.invoice_id = i.id WHERE i.status = 'reconciled' AND d.status = 'open' LIMIT 1"),
    review: await one("SELECT id FROM invoices WHERE status = 'needs_review' ORDER BY id DESC LIMIT 1"),
    failed: await one("SELECT id FROM invoices WHERE status = 'failed' LIMIT 1"),
  };
  await client.end();
  return found;
}

// Fonts and the PDF must be drawn before the shot; networkidle can come earlier than either.
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  const pages = page.getByRole('region', { name: 'Document pages' });
  if ((await pages.count()) > 0) await expect(pages).toHaveAttribute('aria-busy', 'false');
}

// The upload page as the picture shows it, with a file the browser refused, kept in the list until the page reloads.
async function refuse(page: Page) {
  const big = Buffer.alloc(Math.round(6.2 * 1024 * 1024));
  big.set([0xff, 0xd8, 0xff]);
  const file = page.getByLabel('Invoice file');
  await expect(file).toBeEnabled();
  await file.setInputFiles({ name: 'photo-of-invoice.jpg', mimeType: 'image/jpeg', buffer: big });
  await expect(page.getByRole('row', { name: /photo-of-invoice/ })).toContainText('Not accepted');
}

const sample = JSON.parse(readFileSync(new URL('../public/demo/invoices.json', import.meta.url), 'utf8')) as {
  invoices: { edges: { node: { id: string; status: string; filename: string } }[] };
};
const sampleId = (filter: (node: { status: string; filename: string }) => boolean) => sample.invoices.edges.find(({ node }) => filter(node))!.node.id;

test.describe.configure({ mode: 'serial' });

// The seed stores no PDFs, so one recorded fixture goes through the pipeline for the document beside its lines, then a
// byte variant of it (a trailing comment, as the load test makes them): a new file whose every line bills again a charge
// the first one billed, so the detail shows marks, open findings and the bulk decisions.
test('upload the digital fixture and a byte variant of it', async ({ page }) => {
  await page.goto('/upload');
  const file = page.getByLabel('Invoice file');
  await expect(file).toBeEnabled();
  await file.setInputFiles({ name: 'digital.pdf', mimeType: 'application/pdf', buffer: digital });
  await expect(page.getByRole('row', { name: /^digital[.]pdf/ })).toContainText('Done in', { timeout: 45_000 });
  await expect(file).toBeEnabled();
  await file.setInputFiles({ name: 'digital-copy.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([digital, Buffer.from('\n%copy\n')]) });
  await expect(page.getByRole('row', { name: /^digital-copy[.]pdf/ })).toContainText('Done in', { timeout: 45_000 });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`round 1, ${scheme}`, async ({ page }) => {
    const { copy } = await ids();
    const suffix = scheme === 'dark' ? '-dark' : '';
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1440, height: 904 });
    await page.goto('/invoices');
    await settle(page);
    await shoot(page, `round-1/1-invoice-list${suffix}.png`);
    await page.setViewportSize({ width: 1440, height: 1277 });
    await page.goto(`/invoices/${copy}`);
    await settle(page);
    await shoot(page, `round-1/2-invoice-detail${suffix}.png`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/upload');
    await settle(page);
    await refuse(page);
    await shoot(page, `round-1/3-upload${suffix}.png`);
  });
}

test('round 1, phone, without sideways scrolling', async ({ page }) => {
  const { copy } = await ids();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, path] of [
    ['1-invoice-list', '/invoices'],
    ['2-invoice-detail', `/invoices/${copy}`],
    ['3-upload', '/upload'],
  ] as const) {
    await page.goto(path);
    await settle(page);
    if (name === '3-upload') await refuse(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${name} fits 390 px`).toBeLessThanOrEqual(390);
    await shoot(page, `round-1/${name}-phone.png`, true);
  }
});

for (const scheme of ['light', 'dark'] as const) {
  test(`main screens, ${scheme}`, async ({ page, browser }) => {
    const { uploaded, findings, review, failed } = await ids();
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1440, height: 900 });
    const screens: [string, string][] = [
      ['invoices', '/invoices'],
      ['needs-review-list', '/invoices?status=needs_review'],
      ['invoice-document', `/invoices/${uploaded}`],
      ['invoice-findings', `/invoices/${findings}`],
      ['invoice-needs-review', `/invoices/${review}`],
      ['invoice-failed', `/invoices/${failed}`],
      ['review-queue', '/discrepancies'],
      ['dead-letters', '/dead-letters'],
      ['upload', '/upload'],
    ];
    for (const [name, path] of screens) {
      await page.goto(path);
      await settle(page);
      await shoot(page, `${name}-${scheme}.png`);
    }
    // The README's sample detail is g056: a digital invoice with one real overcharge, a charge billed twice, so it shows
    // the marks and the tinted line. Beside it, the sample's invoice in needs review with the read-only correction panel.
    const demo = sampleId((node) => node.filename === 'g056.pdf');
    const demoReview = sampleId((node) => node.status === 'NEEDS_REVIEW');
    const visitor = await browser.newPage({ colorScheme: scheme, viewport: { width: 1440, height: 900 }, storageState: { cookies: [], origins: [] } });
    for (const [name, path] of [
      ['login', '/login'],
      ['demo-invoices', '/demo/invoices'],
      ['demo-invoice', `/demo/invoices/${demo}`],
      ['demo-needs-review', `/demo/invoices/${demoReview}`],
    ] as const) {
      await visitor.goto(path);
      await settle(visitor);
      await shoot(visitor, `${name}-${scheme}.png`);
    }
    await visitor.close();
  });
}

test('list and detail on a phone, without sideways scrolling', async ({ page }) => {
  const { uploaded, findings } = await ids();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [name, path] of [
    ['invoices', '/invoices'],
    ['invoice-document', `/invoices/${uploaded}`],
    ['invoice-findings', `/invoices/${findings}`],
  ] as const) {
    await page.goto(path);
    await settle(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${name} fits 390 px`).toBeLessThanOrEqual(390);
    await shoot(page, `${name}-phone.png`, true);
  }
});
