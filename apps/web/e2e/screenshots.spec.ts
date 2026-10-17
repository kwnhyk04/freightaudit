import { expect, type Page, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import pg from 'pg';

// pnpm e2e:screenshots: every main screen in light and dark at 1440x900, and list and detail on a phone, for the design
// review. Files go to docs/screenshots/ui/<screen>-<light|dark|phone>.png.
const out = new URL('../../../docs/screenshots/ui/', import.meta.url);
mkdirSync(out, { recursive: true });
const env = parseEnv(readFileSync(new URL('e2e.env', import.meta.url), 'utf8'));
const shoot = (page: Page, file: string, fullPage = false) =>
  page.screenshot({ path: new URL(file, out).pathname.slice(process.platform === 'win32' ? 1 : 0), fullPage });

async function ids() {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  const one = async (sql: string) => (await client.query(sql)).rows[0]?.id as string;
  const found = {
    uploaded: await one("SELECT id FROM invoices WHERE filename = 'digital.pdf' AND status = 'reconciled' LIMIT 1"),
    findings: await one("SELECT i.id FROM invoices i JOIN discrepancies d ON d.invoice_id = i.id WHERE i.status = 'reconciled' AND d.status = 'open' LIMIT 1"),
    review: await one("SELECT id FROM invoices WHERE status = 'needs_review' ORDER BY id DESC LIMIT 1"),
    failed: await one("SELECT id FROM invoices WHERE status = 'failed' LIMIT 1"),
  };
  await client.end();
  return found;
}

// Fonts and the PDF must be drawn before the shot; networkidle can come earlier than either.
async function settle(page: Page, name: string) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  if (['invoice-document', 'demo-invoice', 'demo-needs-review'].includes(name)) await page.getByRole('img', { name: 'Page 1 of 1' }).waitFor();
}

test.describe.configure({ mode: 'serial' });

// The seed stores no PDFs, so one recorded fixture goes through the pipeline for the document beside its lines.
test('upload the digital fixture', async ({ page }) => {
  await page.goto('/upload');
  const pdf = readFileSync(new URL('../../../packages/llm/fixtures/digital.pdf', import.meta.url));
  await page.getByLabel('Invoice file').setInputFiles({ name: 'digital.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.getByRole('button', { name: 'Upload invoice' }).click();
  await expect(page.locator('.badge', { hasText: 'Reconciled' })).toBeVisible({ timeout: 45_000 });
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
      await settle(page, name);
      await shoot(page, `${name}-${scheme}.png`);
    }
    // The sample's first invoice with an open finding, so the public detail shows one beside its document, and its
    // invoice in needs review with the read-only correction panel.
    const sample = JSON.parse(readFileSync(new URL('../public/demo/invoices.json', import.meta.url), 'utf8')) as {
      invoices: { edges: { node: { id: string; status: string; openDiscrepancyCount: number } }[] };
    };
    const demo = sample.invoices.edges.find(({ node }) => node.openDiscrepancyCount > 0)!.node.id;
    const demoReview = sample.invoices.edges.find(({ node }) => node.status === 'NEEDS_REVIEW')!.node.id;
    const visitor = await browser.newPage({ colorScheme: scheme, viewport: { width: 1440, height: 900 }, storageState: { cookies: [], origins: [] } });
    for (const [name, path] of [
      ['login', '/login'],
      ['demo-invoices', '/demo/invoices'],
      ['demo-invoice', `/demo/invoices/${demo}`],
      ['demo-needs-review', `/demo/invoices/${demoReview}`],
    ] as const) {
      await visitor.goto(path);
      await settle(visitor, name);
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
    await settle(page, name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${name} fits 390 px`).toBeLessThanOrEqual(390);
    await shoot(page, `${name}-phone.png`, true);
  }
});
