import { expect, type Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { PASSWORD } from './env.ts';

const env = parseEnv(readFileSync(new URL('e2e.env', import.meta.url), 'utf8'));
async function db<Row>(sql: string) {
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql)).rows as Row[];
  } finally {
    await client.end();
  }
}
const badge = (page: Page, text: string) => page.locator('.badge', { hasText: text }).first();

test.describe('login', () => {
  test('pages need a session; the cookie is httpOnly, Secure and SameSite=Lax; the browser never calls the API; sign-out drops the cookie and the cache and refuses another site', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto('/invoices');
    await expect(page).toHaveURL(/\/login\?next=%2Finvoices$/);
    // A next pointing at another site is ignored.
    await page.goto('/login?next=//evil.example');
    await page.getByLabel('Password').fill('not the password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.form-error')).toHaveText('Wrong password.');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/127[.]0[.]0[.]1:3000\/invoices$/);
    const cookie = (await context.cookies()).find((each) => each.name === '__Host-session');
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    expect(requests.filter((url) => url.includes(':4000'))).toEqual([]);
    // A sign-out posted from another site is refused, and the session stays.
    const forged = await page.request.post('/logout', { headers: { origin: 'https://evil.example' } });
    expect(forged.status()).toBe(403);
    expect((await context.cookies()).some((each) => each.name === '__Host-session')).toBe(true);
    // Sign-out expires the cookie and asks the browser to drop this site's cache, viewed PDFs included.
    const [signOut] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/logout') && response.request().method() === 'POST'),
      page.getByRole('button', { name: 'Sign out' }).click(),
    ]);
    // allHeaders(): headers() leaves out the ones Playwright counts as security-related.
    expect([signOut.status(), (await signOut.allHeaders())['clear-site-data']]).toEqual([303, '"cache"']);
    await expect(page).toHaveURL(/\/login$/);
    expect((await context.cookies()).some((each) => each.name === '__Host-session')).toBe(false);
    await context.close();
  });
});

test.describe('upload', () => {
  test('refuses before sending what the api refuses, and a fixture PDF moves from received to reconciled', async ({ page, request }) => {
    await page.goto('/upload');
    const file = page.getByLabel('Invoice file');
    await file.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.locator('.form-error')).toHaveText("notes.txt isn't a PDF, PNG or JPG.");
    const big = Buffer.alloc(4 * 1024 * 1024 + 1);
    big.write('%PDF-1.7');
    await file.setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: big });
    await expect(page.locator('.form-error')).toHaveText('big.pdf is 4.0 MB; the limit is 4 MB.');
    const digital = readFileSync(new URL('../../../packages/llm/fixtures/digital.pdf', import.meta.url));
    await file.setInputFiles({ name: 'digital.pdf', mimeType: 'application/pdf', buffer: digital });
    const viewed = page.waitForResponse((response) => /\/api\/invoices\/[0-9a-f-]{36}\/document$/.test(response.url()));
    await page.getByRole('button', { name: 'Upload invoice' }).click();
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/);
    // Neither the web nor the api lets anyone keep a copy of the document.
    expect((await viewed).headers()['cache-control']).toBe('private, no-store');
    const stored = await request.get(`http://127.0.0.1:${env.API_PORT}/v1/invoices/${page.url().split('/').at(-1)}/document`, {
      headers: { 'x-api-key': env.API_KEY! },
    });
    expect([stored.status(), stored.headers()['cache-control']]).toEqual([200, 'private, no-store']);
    await expect(badge(page, 'Reconciled')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('img', { name: 'Page 1 of 1' })).toBeVisible();
    // Zoom redraws the document the viewer holds; a refetch would cross Vercel and Funnel to the PC each time.
    const fetched: string[] = [];
    page.on('request', (sent) => {
      if (sent.url().includes('/document')) fetched.push(sent.url());
    });
    // The drawn bitmap's width, since CSS caps the shown width at the panel's (max-width: 100%).
    const width = () => page.getByRole('img', { name: 'Page 1 of 1' }).evaluate((canvas) => (canvas as HTMLCanvasElement).width);
    const before = await width();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(width).toBeGreaterThan(before);
    expect(fetched).toEqual([]);
  });

  test('a PNG is accepted and kept as a one-page PDF', async ({ page }) => {
    await page.setContent('<p style="font: 32px serif; padding: 40px">Invoice 4242 from a phone</p>');
    const png = await page.screenshot();
    await page.goto('/upload');
    await page.getByLabel('Invoice file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
    await page.getByRole('button', { name: 'Upload invoice' }).click();
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('img', { name: 'Page 1 of 1' })).toBeVisible();
  });
});

test.describe('review', () => {
  test('a reviewer disputes one finding, approves the other charges, then approves the invoice', async ({ page }) => {
    const [row] = await db<{ id: string }>(
      "SELECT i.id FROM invoices i JOIN discrepancies d ON d.invoice_id = i.id WHERE i.status = 'reconciled' AND d.status = 'open' LIMIT 1",
    );
    await page.goto(`/invoices/${row!.id}`);
    await page.getByLabel('Note', { exact: true }).first().fill('Contract rate applies');
    await page.getByRole('button', { name: 'Dispute' }).first().click();
    await expect(page.getByText('Note: Contract rate applies')).toBeVisible();
    while ((await page.getByRole('button', { name: 'Approve charge' }).count()) > 0) {
      const left = await page.getByRole('button', { name: 'Approve charge' }).count();
      await page.getByRole('button', { name: 'Approve charge' }).first().click();
      await expect(page.getByRole('button', { name: 'Approve charge' })).toHaveCount(left - 1);
    }
    await page.getByRole('button', { name: 'Approve for payment' }).click();
    await expect(badge(page, 'Approved')).toBeVisible();
  });
});

test.describe('needs review', () => {
  test('a reviewer corrects the misread PRO number and the invoice reconciles; another is rejected with a reason', async ({ page }) => {
    const [fix, reject] = await db<{ id: string; pro_number: string }>("SELECT id, pro_number FROM invoices WHERE status = 'needs_review' ORDER BY id LIMIT 2");
    // The seed misreads a PRO number's last digit as one more (packages/db/scripts/seed.ts).
    const pro = `${fix!.pro_number.slice(0, -1)}${(Number(fix!.pro_number.at(-1)) + 9) % 10}`;
    await page.goto(`/invoices/${fix!.id}`);
    await expect(page.getByText('No shipment matches this carrier and PRO number.')).toBeVisible();
    await page.getByLabel('PRO number').fill(pro);
    await page.getByRole('button', { name: 'Re-run matching' }).click();
    await expect(badge(page, 'Reconciled')).toBeVisible({ timeout: 30_000 });
    const trail = page.getByRole('region', { name: 'Audit trail' });
    await expect(trail.getByText(`PRO number: ${fix!.pro_number} to ${pro}`)).toBeVisible();
    await expect(trail.getByText('by reviewer')).toBeVisible();

    await page.goto(`/invoices/${reject!.id}`);
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    await page.getByLabel('Reason, kept in the audit trail').fill('Billed twice for this shipment');
    await page.getByRole('button', { name: 'Reject invoice' }).click();
    await expect(badge(page, 'Rejected')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Audit trail' }).getByText('Billed twice for this shipment')).toBeVisible();
  });
});
