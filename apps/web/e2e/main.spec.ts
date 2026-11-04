import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { createToken } from '../lib/session.ts';
import { e2eEnv, olderBrowser, PASSWORD } from './env.ts';

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
// A file in the upload page's list, by its name.
const pick = (page: Page, name: string) => page.getByRole('list', { name: 'Files to upload' }).getByRole('listitem').filter({ hasText: name });
// The upload page's posts to its own server, which carry the files; choosing a file must send none.
function countUploads(page: Page) {
  const posts = { count: 0 };
  page.on('request', (sent) => {
    if (sent.method() === 'POST' && new URL(sent.url()).pathname === '/upload') posts.count += 1;
  });
  return posts;
}
const digital = readFileSync(new URL('../../../packages/llm/fixtures/digital.pdf', import.meta.url));
// Reconciled invoices whose findings are all open charges, so the bulk decisions show; first and last by id, one per
// test, and further in for the tests that add a possible duplicate.
const allOpen = (order: 'ASC' | 'DESC', offset = 0) =>
  db<{ id: string; open: number }>(
    `SELECT i.id, count(*)::int AS open FROM invoices i JOIN discrepancies d ON d.invoice_id = i.id WHERE i.status = 'reconciled'
     GROUP BY i.id HAVING bool_and(d.status = 'open' AND d.type <> 'duplicate_invoice') ORDER BY i.id ${order} OFFSET ${offset} LIMIT 1`,
  );
// Such an invoice with a possible duplicate added, as reconcile writes one.
async function withDuplicate() {
  const [row] = await allOpen('ASC', 1);
  await db(
    `INSERT INTO discrepancies (tenant_id, invoice_id, shipment_id, type, expected_cents, billed_cents, evidence)
     SELECT tenant_id, id, shipment_id, 'duplicate_invoice', 0, 0, 'Possible duplicate: invoice ' || invoice_number || ' from this carrier was also received on 2026-10-01 as first-scan.pdf.'
     FROM invoices WHERE id = '${row!.id}'`,
  );
  return row!;
}
const day = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
// The warning an exact duplicate gets, from the invoice it already is: its number, or else its file name, and its day.
async function duplicateOf(filename: string) {
  const [invoice] = await db<{ id: string; number: string | null; created_at: Date }>(
    `SELECT id, invoice_number AS number, created_at FROM invoices WHERE filename = '${filename}'`,
  );
  const name = invoice!.number ? `invoice ${invoice!.number}` : filename;
  return { id: invoice!.id, name, text: `Already uploaded as ${name} on ${day.format(invoice!.created_at)}. Nothing new was created.` };
}
const documentHead = (request: APIRequestContext, id: string) =>
  request.head(`http://127.0.0.1:${env.API_PORT}/v1/invoices/${id}/document`, { headers: { 'x-api-key': env.API_KEY! } });
// Approves every open charge on the page, one at a time.
async function approveCharges(page: Page) {
  const approve = page.getByRole('button', { name: 'Approve charge', exact: true });
  while ((await approve.count()) > 0) {
    const left = await approve.count();
    await approve.first().click();
    await expect(approve).toHaveCount(left - 1);
  }
}

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
    await expect(page).toHaveURL(/127[.]0[.]0[.]1:3000\/dashboard$/);
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
    // It lands on the landing page with a short note, which the next navigation drops.
    await expect(page).toHaveURL(/127[.]0[.]0[.]1:3000\/[?]signed-out=1$/);
    await expect(page.locator('.landing-notice')).toHaveText("You're signed out. Thanks for stopping by.");
    expect((await context.cookies()).some((each) => each.name === '__Host-session')).toBe(false);
    await page.getByRole('banner').getByRole('link', { name: 'FreightAudit' }).click();
    await expect(page).toHaveURL(/127[.]0[.]0[.]1:3000\/$/);
    await expect(page.locator('.landing-notice')).toHaveCount(0);
    await context.close();
  });

  test('signed in, the logo, the landing page and the sign-in page never show the sign-in form', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const password = page.getByLabel('Password');
    // Signed out, the landing page's Sign in opens the form; signed in, going back to it does not show it again.
    await page.goto('/');
    await page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true }).click();
    await password.fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(password).toHaveCount(0);
    // The app's logo stays in the app.
    await page.locator('.sidebar .wordmark').click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(password).toHaveCount(0);
    // The landing page's logo and Sign in: the landing page, then the start page, never the form.
    await page.goto('/');
    await page.getByRole('banner').getByRole('link', { name: 'FreightAudit' }).click();
    await expect(page).toHaveURL(/127[.]0[.]0[.]1:3000\/$/);
    await expect(password).toHaveCount(0);
    await page.getByRole('banner').getByRole('link', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(password).toHaveCount(0);
    await page.goto('/login');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(password).toHaveCount(0);
    await context.close();
  });

  test('an expired session never shows Sign out: the sample offers Sign in, and live pages ask for sign-in', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    // The cookie is re-signed as last active 31 minutes ago, past the 30-minute idle limit.
    const cookie = (await context.cookies()).find((each) => each.name === '__Host-session')!;
    await context.addCookies([{ ...cookie, value: createToken('reviewer', e2eEnv.SESSION_SECRET!, Date.now() - 31 * 60_000) }]);
    await page.goto('/demo/invoices');
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    await expect(page.locator('.sidebar').getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    await page.goto('/');
    await expect(page.getByText('Sign out')).toHaveCount(0);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard&ended=idle$/);
    await expect(page.getByLabel('Password')).toBeVisible();
    await context.close();
  });

  test('30 minutes without activity end the session: the next page asks for sign-in, says why, and returns there after', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    // Fast-forward 31 minutes: the server's clock cannot move from here, so the cookie is re-signed as the server issued
    // it then, signed in and last active 31 minutes ago.
    const cookie = (await context.cookies()).find((each) => each.name === '__Host-session')!;
    await context.addCookies([{ ...cookie, value: createToken('reviewer', e2eEnv.SESSION_SECRET!, Date.now() - 31 * 60_000) }]);
    await page.goto('/invoices?status=open');
    await expect(page).toHaveURL(/\/login\?next=%2Finvoices%3Fstatus%3Dopen&ended=idle$/);
    await expect(page.locator('.form-notice')).toHaveText('You were signed out after 30 minutes without activity.');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/invoices\?status=open$/);
    await context.close();
  });
});

test.describe('landing page', () => {
  test('signed in, / is the same landing page; its demo button and a sign-in back to / both open the start page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/127[.]0[.]0[.]1:3000\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pay the contract rate, not the invoice.');
    await page.getByRole('link', { name: 'Try the live demo' }).click();
    await expect(page).toHaveURL(/127[.]0[.]0[.]1:3000\/dashboard$/);
    await page.goto('/login?next=%2F');
    await expect(page).toHaveURL(/127[.]0[.]0[.]1:3000\/dashboard$/);
  });
});

test.describe('overview', () => {
  test("the overview counts what SQL counts here, its ranges are links, and each chart's table holds the chart's values", async ({ page }) => {
    // This run's uploads settle first, so nothing moves between the query and the page; the seed's in-flight invoices,
    // all received before October 2026, never move.
    const moving = async () =>
      (await db<{ n: number }>("SELECT count(*)::int AS n FROM invoices WHERE status IN ('received', 'extracting', 'extracted', 'reconciling') AND created_at > now() - interval '1 day'"))[0]!.n;
    await expect.poll(moving, { timeout: 60_000 }).toBe(0);
    // The default 4 weeks: today and the 27 UTC days before, a split upload counted as its parts; overbilling is what
    // every finding not dismissed bills above the rate card.
    const [counted] = await db<{ received: number; overbilled: string; invoices: number; waiting: number; letters: number }>(
      `WITH midnight AS (SELECT date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS at),
       kept AS (SELECT i.id FROM invoices i, midnight WHERE i.created_at >= midnight.at - interval '27 days' AND i.created_at < midnight.at + interval '1 day'
         AND NOT EXISTS (SELECT 1 FROM invoices part WHERE part.parent_invoice_id = i.id)),
       standing AS (SELECT d.invoice_id, sum(d.billed_cents - d.expected_cents) AS cents FROM discrepancies d JOIN kept ON kept.id = d.invoice_id
         WHERE d.status <> 'dismissed' GROUP BY d.invoice_id)
       SELECT (SELECT count(*)::int FROM kept) AS received, (SELECT coalesce(sum(cents), 0)::text FROM standing) AS overbilled,
         (SELECT count(*)::int FROM standing WHERE cents > 0) AS invoices, (SELECT count(*)::int FROM invoices WHERE status IN ('received', 'extracting')) AS waiting,
         (SELECT count(*)::int FROM dead_letters WHERE replayed_at IS NULL) AS letters`,
    );
    const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
    await page.goto('/dashboard');
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    const hero = page.locator('.t-hero');
    const heading = hero.getByRole('heading', { level: 2 });
    await expect(heading).toHaveText('Overbilling found, last 4 weeks');
    // A figure's final text; its counting copy is hidden from assistive technology.
    await expect(hero.locator('.hero-figure .final')).toHaveText(money(Number(counted!.overbilled)));
    await expect(hero).toContainText(`Across ${counted!.invoices} invoice${counted!.invoices === 1 ? '' : 's'}`);
    await expect(page.getByRole('region', { name: 'Invoices received', exact: true }).locator('.tile-figure .final')).toHaveText(counted!.received.toLocaleString('en-US'));
    await expect(page.locator('.health dt:text-is("Waiting to be read") + dd')).toHaveText(String(counted!.waiting));
    await expect(page.locator('.health dt:text-is("Dead letters") + dd')).toHaveText(String(counted!.letters));
    // The live overview shows the model cost and today's tokens, which the sample leaves out.
    await expect(page.getByRole('region', { name: 'Model cost per invoice', exact: true })).toBeVisible();
    await expect(page.locator('.health dt:text-is("AI tokens today")')).toBeVisible();
    // Each chart is one keyboard stop: Home and End pick the first and the last of the 28 days, whose note holds the values
    // of that day's row in the chart's table (the hero's amount, the line chart's four counts), and is read out.
    // This test runs before the upload tests and the seed is older than four weeks, so a window with nothing finished in it
    // shows each chart's empty state instead.
    const processedCard = page.getByRole('region', { name: 'Invoices processed per day', exact: true });
    const [row] = await db<{ finished: number }>(
      `SELECT count(*)::int AS finished FROM invoices WHERE status IN ('reconciled', 'approved', 'needs_review', 'rejected', 'failed')
       AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '27 days'`,
    );
    const finished = row!.finished;
    if (finished === 0) await expect(processedCard).toContainText('No invoice was checked in the last 4 weeks.');
    if (Number(counted!.overbilled) === 0) await expect(hero).toContainText('No overbilling found in the last 4 weeks.');
    const charts = finished > 0 ? [processedCard] : [];
    if (Number(counted!.overbilled) > 0) charts.push(hero);
    for (const card of charts) {
      await card.getByText('Show as a table').click();
      const rows = await card.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td.num')].map((td) => td.textContent)));
      expect(rows).toHaveLength(28);
      const chart = card.getByRole('group');
      await chart.focus();
      for (const [key, row] of [['Home', rows[0]], ['End', rows.at(-1)]] as const) {
        await page.keyboard.press(key);
        await expect(card.locator('.tip strong')).toHaveText(row!);
        await expect(card.locator('[aria-live]')).not.toHaveText('');
      }
      await chart.blur();
      await expect(card.locator('.tip')).toHaveCount(0);
    }
    // The latest invoices are the list's newest five, in its order.
    const latest = await page.getByRole('region', { name: 'Latest invoices' }).locator('.latest a').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    await page.goto('/invoices');
    const newest = await page.locator('tbody tr a.id').evaluateAll((links) => links.slice(0, 5).map((link) => link.getAttribute('href')));
    expect(latest).toEqual(newest);
    await page.goto('/dashboard');
    // The range is a link that the address keeps; 4 weeks needs none.
    const ranges = page.getByRole('navigation', { name: 'Time range' });
    await expect(ranges.getByRole('link', { name: '4 weeks' })).toHaveAttribute('aria-current', 'page');
    await ranges.getByRole('link', { name: '7 days' }).click();
    await expect(page).toHaveURL(/\/dashboard[?]range=7d$/);
    await expect(heading).toHaveText('Overbilling found, last 7 days');
    await expect(ranges.getByRole('link', { name: '7 days' })).toHaveAttribute('aria-current', 'page');
    await ranges.getByRole('link', { name: '4 weeks' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(heading).toHaveText('Overbilling found, last 4 weeks');
  });
});

test.describe('upload', () => {
  test('choosing files only lists them, with size and pages and why one would be refused; Upload sends the rest, which leave the list, and toasts say what follows; the Upload button goes with nothing left to send, its focus to the file chooser', async ({ page, request }) => {
    await page.goto('/upload');
    const file = page.getByLabel('Invoice files');
    // The input waits for the page to hydrate, since only then is a chosen file checked and listed.
    await expect(file).toBeEnabled();
    const posts = countUploads(page);
    const big = Buffer.alloc(4 * 1024 * 1024 + 1);
    big.write('%PDF-1.7');
    await file.setInputFiles([
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
      { name: 'big.pdf', mimeType: 'application/pdf', buffer: big },
      { name: 'digital.pdf', mimeType: 'application/pdf', buffer: digital },
    ]);
    await expect(pick(page, 'notes.txt')).toContainText("It isn't a PDF, PNG or JPG.");
    await expect(pick(page, 'big.pdf')).toContainText('The file is 4.0 MB; the limit is 4 MB.');
    await expect(pick(page, 'digital.pdf')).toContainText(/[0-9]+ KB · 1 page/);
    // The line shows the PDF's first page as a picture. A soft check, so a browser that cannot draw it still uploads the
    // invoice the tests after this one need.
    await expect.soft(pick(page, 'digital.pdf').locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    // Choosing sent nothing, and only the file that can go is counted.
    expect(posts.count).toBe(0);
    const toasts = page.locator('.toasts');
    await expect(toasts).toHaveAttribute('aria-live', 'polite');
    await page.getByRole('button', { name: 'Upload 1 invoice' }).click();
    // The uploaded file leaves the list for Recent uploads; the two not sent stay with their reasons.
    await expect(pick(page, 'digital.pdf')).toHaveCount(0);
    await expect(pick(page, 'notes.txt')).toContainText("It isn't a PDF, PNG or JPG.");
    await expect(pick(page, 'big.pdf')).toContainText('The file is 4.0 MB; the limit is 4 MB.');
    // Nothing is left to send, so the Upload button goes, and the focus it held goes to the file chooser.
    await expect(page.getByRole('button', { name: /^Upload / })).toHaveCount(0);
    await expect(file).toBeFocused();
    await expect(toasts).toContainText('1 invoice uploaded. Reading now.');
    await expect(page).toHaveURL(/\/upload$/);
    expect(posts.count).toBe(1);
    // Recent uploads read live, and a toast says what was read once the page sees it settle.
    const row = page.getByRole('row', { name: /digital[.]pdf/ });
    await expect(row).toContainText('Reading…');
    await expect(row).toContainText(/Done in [0-9.]+ s/, { timeout: 45_000 });
    await expect(toasts).toContainText('Invoice 98211354 read: 3 findings to review');
    // Neither the web nor the api lets anyone keep a copy of the document.
    const viewed = page.waitForResponse((response) => /\/api\/invoices\/[0-9a-f-]{36}\/document$/.test(response.url()));
    await row.getByRole('link', { name: 'digital.pdf' }).click();
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/);
    expect((await viewed).headers()['cache-control']).toBe('private, no-store');
    const stored = await request.get(`http://127.0.0.1:${env.API_PORT}/v1/invoices/${page.url().split('/').at(-1)}/document`, {
      headers: { 'x-api-key': env.API_KEY! },
    });
    expect([stored.status(), stored.headers()['cache-control']]).toEqual([200, 'private, no-store']);
    // The recorded fixture bills three charges above the rate card, all open.
    await expect(badge(page, 'Billing issues (3)')).toBeVisible();
    await expect(page.getByRole('img', { name: 'Page 1 of 1' })).toBeVisible();
  });

  test('a file uploaded before says which invoice it already is, on its line and in a toast, with a link to it', async ({ page }) => {
    const again = await duplicateOf('digital.pdf');
    await page.goto('/upload');
    const file = page.getByLabel('Invoice files');
    await expect(file).toBeEnabled();
    await file.setInputFiles({ name: 'digital.pdf', mimeType: 'application/pdf', buffer: digital });
    await page.getByRole('button', { name: 'Upload 1 invoice' }).click();
    await expect(pick(page, 'digital.pdf')).toContainText(again.text);
    await expect(page.locator('.toasts')).toContainText(again.text);
    await pick(page, 'digital.pdf').getByRole('link', { name: again.name }).click();
    await expect(page).toHaveURL(new RegExp(`/invoices/${again.id}$`));
  });

  test('each listed file says where it stands: refused with its reason, ready to send, a duplicate with its invoice, failed with its reason and Retry', async ({ page }) => {
    const again = await duplicateOf('digital.pdf');
    await page.goto('/upload');
    const file = page.getByLabel('Invoice files');
    await expect(file).toBeEnabled();
    const state = (name: string) => pick(page, name).locator('.badge');
    await file.setInputFiles([
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
      { name: 'digital.pdf', mimeType: 'application/pdf', buffer: digital },
    ]);
    await expect(state('notes.txt')).toHaveText('Refused');
    await expect(pick(page, 'notes.txt')).toContainText("It isn't a PDF, PNG or JPG.");
    await expect(state('digital.pdf')).toHaveText('Ready to send');
    await page.getByRole('button', { name: 'Upload 1 invoice' }).click();
    await expect(state('digital.pdf')).toHaveText('Duplicate');
    await expect(pick(page, 'digital.pdf').getByRole('link', { name: again.name })).toHaveAttribute('href', `/invoices/${again.id}`);
    // No answer: the file fails with its reason, and its toast offers Retry.
    await page.route('**/upload', (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
    await file.setInputFiles({ name: 'lost.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([digital, Buffer.from('\n%lost\n')]) });
    await expect(state('lost.pdf')).toHaveText('Ready to send');
    await page.getByRole('button', { name: 'Upload 1 invoice' }).click();
    await expect(state('lost.pdf')).toHaveText('Failed');
    await expect(pick(page, 'lost.pdf')).toContainText('Not uploaded: The upload did not reach the server.');
    await expect(page.locator('.toast', { hasText: 'Not uploaded' }).getByRole('button', { name: 'Retry' })).toBeVisible();
    // The hint states the real rules.
    await expect(page.locator('#upload-hint')).toHaveText('PDF, PNG or JPG, one invoice per file, up to 4 MB each; a PDF may have up to 20 pages. A batch takes up to 500 files.');
  });

  test('a PNG is listed with its picture and one page, then kept as a one-page PDF', async ({ page }) => {
    await page.setContent('<p style="font: 32px serif; padding: 40px">Invoice 4242 from a phone</p>');
    const png = await page.screenshot();
    await page.goto('/upload');
    const file = page.getByLabel('Invoice files');
    await expect(file).toBeEnabled();
    await file.setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
    await expect(pick(page, 'photo.png')).toContainText(/[0-9]+ KB · 1 page/);
    await expect(pick(page, 'photo.png').locator('img')).toHaveAttribute('src', /^blob:/);
    await page.getByRole('button', { name: 'Upload 1 invoice' }).click();
    await expect(pick(page, 'photo.png')).toHaveCount(0);
    await page.getByRole('row', { name: /photo[.]png/ }).getByRole('link', { name: 'photo.png' }).click();
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('img', { name: 'Page 1 of 1' })).toBeVisible();
  });

  test("in a browser without what pdf.js's modern build needs, a picked PDF still shows its first page", async ({ page }) => {
    await olderBrowser(page);
    await page.goto('/upload');
    const file = page.getByLabel('Invoice files');
    await expect(file).toBeEnabled();
    await file.setInputFiles({ name: 'older.pdf', mimeType: 'application/pdf', buffer: digital });
    await expect(pick(page, 'older.pdf')).toContainText(/[0-9]+ KB · 1 page/);
    await expect(pick(page, 'older.pdf').locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  });

  test('a sample uploads in one tap; a second tap adds no invoice, extraction or key', async ({ page }) => {
    await page.goto('/upload');
    const sample = page.getByRole('button', { name: 'Clean digital invoice' });
    const tap = async () => {
      const done = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/upload');
      await sample.click();
      await done;
    };
    await tap();
    await expect(page.getByRole('row', { name: /clean-digital-g001[.]pdf/ })).toContainText(/Done in/, { timeout: 45_000 });
    await tap();
    await expect(sample).toBeEnabled();
    // The second tap says, under its button, which invoice the sample already is, with a link to it.
    const again = await duplicateOf('clean-digital-g001.pdf');
    const notice = page.locator('form.sample', { has: sample }).getByRole('status');
    await expect(notice).toHaveText(again.text);
    await expect(notice.getByRole('link', { name: again.name })).toHaveAttribute('href', `/invoices/${again.id}`);
    const rows = await db<{ extractions: number; keys: number }>(
      `SELECT (SELECT count(*) FROM extractions e WHERE e.invoice_id = i.id)::int AS extractions,
              (SELECT count(*) FROM idempotency_keys k WHERE k.invoice_id = i.id AND k.key LIKE 'sample-%')::int AS keys
       FROM invoices i WHERE i.filename = 'clean-digital-g001.pdf'`,
    );
    expect(rows).toEqual([{ extractions: 1, keys: 1 }]);
  });

  test('a listed file can be removed, and Clear empties the list; nothing is sent; the focus goes to the next Remove, else the file chooser', async ({ page }) => {
    await page.goto('/upload');
    const file = page.getByLabel('Invoice files');
    await expect(file).toBeEnabled();
    const posts = countUploads(page);
    await file.setInputFiles(['one.pdf', 'two.pdf', 'three.pdf'].map((name) => ({ name, mimeType: 'application/pdf', buffer: digital })));
    await expect(page.getByRole('button', { name: 'Upload 3 invoices' })).toBeVisible();
    // A pressed Remove leaves the page, so the focus moves on instead of falling to the page's body.
    await page.getByRole('button', { name: 'Remove two.pdf' }).press('Enter');
    await expect(page.getByRole('list', { name: 'Files to upload' }).getByRole('listitem')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Remove three.pdf' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Upload 2 invoices' })).toBeVisible();
    // The last file has no next one, and Clear takes every Remove with it: both leave the focus on the file chooser.
    await page.getByRole('button', { name: 'Remove three.pdf' }).press('Enter');
    await expect(file).toBeFocused();
    await page.getByRole('button', { name: 'Clear' }).press('Enter');
    await expect(page.getByRole('list', { name: 'Files to upload' })).toHaveCount(0);
    await expect(file).toBeFocused();
    expect(posts.count).toBe(0);
  });

  test('a file dropped while others upload waits in the list for the next Upload, and goes with its bytes', async ({ page }) => {
    await page.goto('/upload');
    const file = page.getByLabel('Invoice files');
    await expect(file).toBeEnabled();
    // The first upload is held, so the drop lands while it is still sending.
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let posts = 0;
    await page.route('**/upload', async (route) => {
      if (route.request().method() === 'POST') {
        posts += 1;
        if (posts === 1) await released;
      }
      await route.continue();
    });
    try {
      await file.setInputFiles({ name: 'digital.pdf', mimeType: 'application/pdf', buffer: digital });
      await page.getByRole('button', { name: 'Upload 1 invoice' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Uploading 1 of 1…' })).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Uploading 1 of 1…' })).toBeDisabled();
      const second = await page.evaluateHandle((bytes) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(bytes)], 'second.pdf', { type: 'application/pdf' }));
        return transfer;
      }, [...digital]);
      await page.locator('.drop').dispatchEvent('drop', { dataTransfer: second });
      await expect(pick(page, 'second.pdf')).toBeVisible();
    } finally {
      release();
    }
    // The first upload ends as before: digital.pdf was uploaded before. The dropped file waits for its own Upload.
    const again = (await duplicateOf('digital.pdf')).text;
    await expect(pick(page, 'digital.pdf')).toContainText(again);
    expect(posts).toBe(1);
    await page.getByRole('button', { name: 'Upload 1 invoice' }).click();
    // Its bytes went with it: the api knows them as digital.pdf's.
    await expect(pick(page, 'second.pdf')).toContainText(again);
    expect(posts).toBe(2);
  });

  test('an upload that gets no answer ends the batch, and the file not sent stays listed; its toast stays until closed; Retry and Upload send it again; Retry, Close and the upload that empties the list each leave the focus on the file chooser', async ({ page }) => {
    await page.goto('/upload');
    const file = page.getByLabel('Invoice files');
    await expect(file).toBeEnabled();
    const posts = countUploads(page);
    await page.route('**/upload', (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
    await file.setInputFiles([
      { name: 'digital-copy.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([digital, Buffer.from('\n%copy\n')]) },
      { name: 'digital-next.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([digital, Buffer.from('\n%next\n')]) },
    ]);
    await page.getByRole('button', { name: 'Upload 2 invoices' }).click();
    const failed = page.locator('.toast', { hasText: 'Not uploaded' });
    await expect(failed).toContainText('digital-copy.pdf: The upload did not reach the server.');
    await expect(pick(page, 'digital-copy.pdf')).toContainText('Not uploaded: The upload did not reach the server.');
    // No answer ends the batch: the second file was never sent, and both wait in the list, counted.
    expect(posts.count).toBe(1);
    await expect(pick(page, 'digital-next.pdf')).not.toContainText('Not uploaded');
    await expect(page.getByRole('button', { name: 'Upload 2 invoices' })).toBeVisible();
    // A success fades after a few seconds; an error stays.
    await page.waitForTimeout(7_000);
    await expect(failed).toBeVisible();
    await failed.getByRole('button', { name: 'Retry' }).click();
    await expect.poll(() => posts.count).toBe(2);
    await expect(failed).toHaveCount(1);
    // Retry closed its toast with the focus, and the toast after it came without; Close does the same.
    await expect(file).toBeFocused();
    await failed.getByRole('button', { name: 'Close' }).click();
    await expect(failed).toHaveCount(0);
    await expect(file).toBeFocused();
    // The file stays in the list, counted again, until it uploads and leaves. The second goes unsent, so this run adds
    // only the one invoice the tests after this one count on.
    await page.getByRole('button', { name: 'Remove digital-next.pdf' }).click();
    await page.unroute('**/upload');
    await page.getByRole('button', { name: 'Upload 1 invoice' }).click();
    await expect(pick(page, 'digital-copy.pdf')).toHaveCount(0);
    // The upload took the list and its buttons away, so the focus goes to the file chooser, as after Clear.
    await expect(file).toBeFocused();
    await expect(page.locator('.toasts')).toContainText('1 invoice uploaded. Reading now.');
  });

  test('on a phone the list of files fits the screen, with every button inside it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/upload');
    const file = page.getByLabel('Invoice files');
    await expect(file).toBeEnabled();
    await file.setInputFiles([
      { name: 'a-rather-long-file-name-for-a-phone-screen.pdf', mimeType: 'application/pdf', buffer: digital },
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
    ]);
    await expect(pick(page, 'notes.txt')).toContainText("It isn't a PDF, PNG or JPG.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    for (const name of ['Remove notes.txt', 'Upload 1 invoice', 'Clear']) {
      const box = await page.getByRole('button', { name }).boundingBox();
      expect(box!.x + box!.width, name).toBeLessThanOrEqual(390);
    }
  });

  test('on a phone Recent uploads is a list of cards, as the invoices list is, and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/upload');
    // The table's wrapper, which shares its name with the section around it.
    const recent = page.locator('.table-wrap[aria-labelledby="recent-title"]');
    const card = recent.locator('tbody tr').first();
    await expect(card).toBeVisible();
    expect(await card.evaluate((row) => getComputedStyle(row).display)).toBe('grid');
    expect(await recent.evaluate((box) => box.scrollWidth - box.clientWidth)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test('an upload sent after the session ended goes to sign-in, and nothing is uploaded', async ({ page }) => {
    await page.goto('/upload');
    const file = page.getByLabel('Invoice files');
    await expect(file).toBeEnabled();
    await file.setInputFiles({ name: 'late.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([digital, Buffer.from('\n%late\n')]) });
    await page.context().clearCookies();
    await page.getByRole('button', { name: 'Upload 1 invoice' }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await db("SELECT id FROM invoices WHERE filename = 'late.pdf'")).toEqual([]);
  });

  test('a sample tapped after the session ended goes to sign-in before the server looks the sample up', async ({ page }) => {
    await page.goto('/upload');
    await expect(page.getByLabel('Invoice files')).toBeEnabled();
    const sample = page.getByRole('button', { name: 'Clean digital invoice' });
    // A key the server refuses by name, were it looked up before the session check.
    await page.locator('form.sample', { has: sample }).locator('input[name="sample"]').evaluate((input: HTMLInputElement) => {
      input.value = 'no-such-sample';
    });
    await page.context().clearCookies();
    await sample.click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('Unknown sample.')).toHaveCount(0);
  });
});

test.describe('re-bills', () => {
  // The sample tapped above, g001, reads as digital.pdf's invoice in this run (the recorded fixture), so it bills that
  // shipment again: each of its lines was already billed on digital.pdf's invoice.
  test('a re-bill names the invoice that billed its charges first: on its upload row, in its header, findings and charges', async ({ page }) => {
    const [rebill] = await db<{ id: string; reference: string; lines: number }>(
      `SELECT i.id, s.reference, (SELECT count(*) FROM invoice_lines l WHERE l.invoice_id = i.id)::int AS lines
       FROM invoices i JOIN shipments s ON s.id = i.shipment_id WHERE i.filename = 'clean-digital-g001.pdf'`,
    );
    const [first] = await db<{ id: string; number: string; issued: string }>(
      "SELECT id, invoice_number AS number, to_char(invoice_date, 'YYYY-MM-DD') AS issued FROM invoices WHERE filename = 'digital.pdf'",
    );
    const name = `invoice ${first!.number}`;
    const printed = day.format(new Date(`${first!.issued}T00:00:00Z`));
    const lines = rebill!.lines;
    await page.goto('/upload');
    const row = page.getByRole('row', { name: /clean-digital-g001[.]pdf/ });
    await expect(row).toContainText(`Re-bills ${rebill!.reference}: ${lines} of ${lines} lines already billed on ${name}`);
    await expect(row.getByRole('link', { name })).toHaveAttribute('href', `/invoices/${first!.id}`);
    // At 1100 px, the narrowest width where the charges table keeps every column, its Expected column holds words.
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(`/invoices/${rebill!.id}`);
    const header = page.locator('.detail-head');
    await expect(header).toContainText(`Re-bills shipment ${rebill!.reference}: ${lines} of ${lines} lines were already billed on ${name} (${printed}).`);
    const texts = await page.locator('.findings .finding-body > p.muted').allTextContents();
    expect(texts.filter((text) => text.endsWith(` was already billed on ${name} (${printed}) for the same shipment.`))).toHaveLength(lines);
    const charges = page.locator('table.charges');
    await expect(page.getByText('Expected is $0 for a charge already billed, on an earlier invoice for this shipment or on an earlier line, so it is not paid twice.')).toBeVisible();
    // In short, with the number a link, and the whole sentence as the cell's name.
    await expect(charges.getByRole('cell', { name: `Already billed on ${name}`, exact: true })).toHaveCount(lines);
    await expect(charges.locator('tbody td', { hasText: `Billed on ${first!.number}` })).toHaveCount(lines);
    await expect(charges.locator('tbody').getByRole('link', { name: first!.number, exact: true })).toHaveCount(lines);
    // Every column fits from 1100 px, whatever font has loaded: the description takes what is left.
    for (const width of [1100, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.locator('.table-wrap', { has: charges }).evaluate((box) => box.scrollWidth - box.clientWidth), `${width} px`).toBe(0);
    }
    // Each names the first invoice by a link that opens it.
    await header.getByRole('link', { name }).click();
    await expect(page).toHaveURL(new RegExp(`/invoices/${first!.id}$`));
  });
});

test.describe('review', () => {
  test('an open finding reads its title and text, then its amount, then the decision', async ({ page }) => {
    const [open] = await db<{ id: string }>(
      `SELECT i.id FROM invoices i JOIN discrepancies d ON d.invoice_id = i.id WHERE i.status = 'reconciled' AND d.status = 'open' ORDER BY i.id LIMIT 1`,
    );
    await page.goto(`/invoices/${open!.id}`);
    const order = await page
      .locator('.findings article', { has: page.getByRole('button', { name: 'Dispute', exact: true }) })
      .first()
      .evaluate((article) => ['h3', ':scope > p, .finding-body > p', ':scope > .num', 'button'].map((selector) => [...article.querySelectorAll('*')].indexOf(article.querySelector(selector)!)));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test('a reviewer disputes one finding, approves the other charges, then approves the invoice', async ({ page }) => {
    // Charges only: a possible duplicate takes a decision of its own words.
    const [row] = await db<{ id: string }>(
      `SELECT i.id FROM invoices i JOIN discrepancies d ON d.invoice_id = i.id WHERE i.status = 'reconciled' AND d.status = 'open'
       AND NOT EXISTS (SELECT 1 FROM discrepancies x WHERE x.invoice_id = i.id AND x.type = 'duplicate_invoice') LIMIT 1`,
    );
    await page.goto(`/invoices/${row!.id}`);
    await page.getByLabel('Note', { exact: true }).first().fill('Contract rate applies');
    await page.getByRole('button', { name: 'Dispute', exact: true }).first().click();
    await expect(page.getByText('Note: Contract rate applies')).toBeVisible();
    await approveCharges(page);
    await page.getByRole('button', { name: 'Approve for payment' }).click();
    await expect(badge(page, 'Approved')).toBeVisible();
  });

  test('approve at rate card decides every open finding in one step, with a trail row for each, and approves the invoice', async ({ page }) => {
    const [row] = await allOpen('ASC');
    await page.goto(`/invoices/${row!.id}`);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: /^Approve at rate card, / }).click();
    await expect(badge(page, 'Approved')).toBeVisible();
    const trail = page.getByRole('region', { name: 'Audit trail' });
    await expect(trail.getByText('Overcharge disputed')).toHaveCount(row!.open);
    await expect(trail.getByText('At rate card')).toBeVisible();
  });

  test('a bulk decision on findings that changed since the page loaded is refused, with a way to reload', async ({ page, context }) => {
    const [row] = await allOpen('DESC');
    await page.goto(`/invoices/${row!.id}`);
    const other = await context.newPage();
    await other.goto(`/invoices/${row!.id}`);
    const approve = other.getByRole('button', { name: 'Approve charge', exact: true });
    await approve.first().click();
    await expect(approve).toHaveCount(row!.open - 1);
    await other.close();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: /^Dispute / }).click();
    const alert = page.locator('.form-error');
    await expect(alert).toContainText('This invoice changed since you opened it. Reload it to see what changed.');
    await alert.getByRole('link', { name: 'Reload' }).click();
    await expect(page.getByRole('button', { name: /^Dispute / })).toHaveCount(0);
  });

  test('while a possible duplicate is open, no decision on every finding is offered; once it is no duplicate, one is', async ({ page }) => {
    const row = await withDuplicate();
    await page.goto(`/invoices/${row.id}`);
    const bulk = page.getByRole('button', { name: /^Approve at rate card, / });
    await expect(page.getByText('Decide the possible duplicate first.')).toBeVisible();
    for (const button of [bulk, page.getByRole('button', { name: 'Approve as billed' }), page.getByRole('button', { name: /^Dispute \$/ })]) await expect(button).toHaveCount(0);
    // The duplicate is decided in its own words, here and in the review queue; the charges keep theirs.
    const duplicate = page.locator('.findings article', { hasText: 'Possible duplicate invoice' });
    await expect(duplicate.getByRole('button', { name: 'Approve charge' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Approve charge', exact: true })).toHaveCount(row.open);
    await page.goto('/discrepancies');
    const queued = page.getByRole('row').filter({ has: page.locator(`a[href="/invoices/${row.id}"]`) }).filter({ hasText: 'Possible duplicate invoice' });
    await expect(queued.getByRole('button', { name: 'Confirm duplicate' })).toBeVisible();
    await page.goto(`/invoices/${row.id}`);
    await duplicate.getByRole('button', { name: 'Not a duplicate' }).click();
    await expect(duplicate.locator('.badge')).toHaveText('Not a duplicate');
    await expect(bulk).toBeVisible();
    await expect(page.getByRole('region', { name: 'Audit trail' }).getByText('Marked not a duplicate')).toBeVisible();
  });

  test('a checked invoice is rejected with a reason; its open findings close with it and leave the review queue', async ({ page }) => {
    const [row] = await allOpen('DESC', 1);
    await page.goto(`/invoices/${row!.id}`);
    const queue = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Review queue/ });
    const before = Number((await queue.getAttribute('aria-label'))?.match(/(\d+) open finding/)?.[1]);
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Reject this invoice' });
    await expect(dialog).toContainText(`Its ${row!.open} open finding${row!.open === 1 ? ' is' : 's are'} closed with it.`);
    await dialog.getByLabel('Reason, kept in the audit trail').fill('Billed to the wrong customer');
    await dialog.getByRole('button', { name: 'Reject invoice' }).click();
    await expect(badge(page, 'Rejected')).toBeVisible();
    await expect(page.locator('.findings .badge', { hasText: 'Closed with the invoice' })).toHaveCount(row!.open);
    const trail = page.getByRole('region', { name: 'Audit trail' });
    await expect(trail.getByText('Finding closed', { exact: true })).toHaveCount(row!.open);
    await expect(trail.getByText('The invoice was rejected')).toHaveCount(row!.open);
    await expect(trail.getByText('Billed to the wrong customer')).toBeVisible();
    await expect(queue).toHaveAccessibleName(`Review queue, ${before - row!.open} open findings`);
  });

  test('a confirmed duplicate offers only rejection, in its own words from the buttons to the trail', async ({ page }) => {
    const row = await withDuplicate();
    await page.goto(`/invoices/${row.id}`);
    const duplicate = page.locator('.findings article', { hasText: 'Possible duplicate invoice' });
    await duplicate.getByRole('button', { name: 'Confirm duplicate' }).click();
    await expect(duplicate.locator('.badge')).toHaveText('Duplicate confirmed');
    await expect(badge(page, 'Confirmed duplicate')).toBeVisible();
    await expect(page.getByText('A confirmed duplicate cannot be approved; reject it.')).toBeVisible();
    for (const name of [/^Approve at rate card, /, 'Approve as billed', 'Approve for payment']) await expect(page.getByRole('button', { name })).toHaveCount(0);
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Reject this invoice' });
    await dialog.getByLabel('Reason, kept in the audit trail').fill('Same invoice as first-scan.pdf');
    await dialog.getByRole('button', { name: 'Reject invoice' }).click();
    await expect(badge(page, 'Rejected')).toBeVisible();
    await expect(duplicate.locator('.badge')).toHaveText('Duplicate confirmed');
    const trail = page.getByRole('region', { name: 'Audit trail' });
    await expect(trail.getByText('Duplicate confirmed', { exact: true })).toBeVisible();
    await expect(trail.getByText('Overcharge disputed')).toHaveCount(0);
    await expect(trail.getByText('Finding closed', { exact: true })).toHaveCount(row.open);
  });

  test('in the review queue ticked findings are decided together, each recorded as one decision with the shared note', async ({ page }) => {
    const row = await withDuplicate();
    const [duplicate] = await db<{ id: string }>(`SELECT id FROM discrepancies WHERE invoice_id = '${row.id}' AND type = 'duplicate_invoice'`);
    await page.goto('/discrepancies');
    const bar = page.getByRole('form', { name: 'Selected findings' });
    const dispute = bar.getByRole('button', { name: 'Dispute selected' });
    await expect(dispute).toBeDisabled();
    const findings = page.locator('input[type="checkbox"][name="finding"]');
    const chosen = [(await findings.nth(0).getAttribute('value'))!, (await findings.nth(1).getAttribute('value'))!];
    for (const id of chosen) await page.locator(`input[type="checkbox"][value="${id}"]`).check();
    const tick = page.locator(`input[type="checkbox"][name="duplicate"][value="${duplicate!.id}"]`);
    await tick.check();
    await expect(bar).toContainText('3 selected: 2 findings, 1 possible duplicate');
    await bar.getByLabel('Note for each decision').fill('Checked against contract C-7');
    page.once('dialog', (dialog) => void dialog.accept());
    await dispute.click();
    await expect(bar.getByRole('status')).toHaveText('2 findings disputed.');
    // Each went through the one-finding decision: its status and note, and one trail row with the note.
    const recorded = await db<{ status: string; note: string | null; events: number }>(
      `SELECT d.status, d.note, (SELECT count(*)::int FROM audit_events a WHERE a.discrepancy_id = d.id AND a.action = 'discrepancy_confirmed' AND a.reason = d.note) AS events
       FROM discrepancies d WHERE d.id IN ('${chosen.join("', '")}')`,
    );
    expect(recorded).toEqual(chosen.map(() => ({ status: 'confirmed', note: 'Checked against contract C-7', events: 1 })));
    // The possible duplicate was not part of a decision on findings; it takes its own.
    await tick.check();
    await expect(bar).toContainText('1 selected');
    page.once('dialog', (dialog) => void dialog.accept());
    await bar.getByRole('button', { name: 'Not a duplicate' }).click();
    await expect(bar.getByRole('status')).toHaveText('1 possible duplicate marked not a duplicate.');
    const [decided] = await db<{ status: string; events: number }>(
      `SELECT status, (SELECT count(*)::int FROM audit_events a WHERE a.discrepancy_id = d.id AND a.action = 'discrepancy_dismissed') AS events FROM discrepancies d WHERE id = '${duplicate!.id}'`,
    );
    expect(decided).toEqual({ status: 'dismissed', events: 1 });
  });

  test('ticked dead letters replay together through the one-row replay, with a count and what happened to each', async ({ page }) => {
    const letters = await db<{ id: string }>(
      `INSERT INTO dead_letters (tenant_id, queue, job_id, payload, error, attempts)
       SELECT tenant_id, 'tms-sync', 'e2e-bulk-' || n, '{}', 'The TMS answered 503', 3 FROM (SELECT tenant_id FROM invoices LIMIT 1) t, generate_series(1, 3) n
       RETURNING id`,
    );
    await page.goto('/dead-letters');
    const bar = page.getByRole('form', { name: 'Selected dead letters' });
    const replay = bar.getByRole('button', { name: 'Replay selected' });
    await expect(replay).toBeDisabled();
    const [first, second, third] = letters.map(({ id }) => page.locator(`input[type="checkbox"][value="${id}"]`));
    await first!.check();
    await second!.check();
    await expect(bar).toContainText('2 selected');
    // One is replayed meanwhile, as from another tab, so it is refused and the other still goes.
    await db(`UPDATE dead_letters SET replayed_at = now() WHERE id = '${letters[1]!.id}'`);
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toBe('Replay 2 dead letters?');
      void dialog.accept();
    });
    await replay.click();
    await expect(bar.getByRole('alert')).toHaveText('1 of 2 dead letters replayed. 1 refused: It was replayed already.');
    const after = await db<{ id: string; replayed: boolean; events: number }>(
      `SELECT id, replayed_at IS NOT NULL AS replayed, (SELECT count(*)::int FROM audit_events a WHERE a.dead_letter_id = l.id AND a.action = 'replayed') AS events
       FROM dead_letters l WHERE id IN ('${letters.map(({ id }) => id).join("', '")}') ORDER BY id`,
    );
    const by = Object.fromEntries(after.map(({ id, ...rest }) => [id, rest]));
    expect(by[letters[0]!.id]).toEqual({ replayed: true, events: 1 });
    expect(by[letters[1]!.id]).toEqual({ replayed: true, events: 0 });
    expect(by[letters[2]!.id]).toEqual({ replayed: false, events: 0 });
    await expect(first!).toHaveCount(0);
    await expect(third!).not.toBeChecked();
  });
});

test.describe('list', () => {
  test('a search finds an invoice by its PRO number, and the pages step forward and back', async ({ page }) => {
    const [invoice] = await db<{ id: string; pro_number: string }>('SELECT id, pro_number FROM invoices WHERE pro_number IS NOT NULL ORDER BY id LIMIT 1');
    await page.goto('/invoices');
    await page.getByRole('searchbox', { name: 'Search invoices' }).fill(invoice!.pro_number);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`[?]q=${invoice!.pro_number}$`));
    await expect(page.locator(`a[href="/invoices/${invoice!.id}"]`)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Pages' })).toContainText('Page 1 of 1');
    const [{ total }] = (await db<{ total: number }>('SELECT count(*)::int AS total FROM invoices')) as [{ total: number }];
    const last = Math.ceil(total / 20);
    await page.goto('/invoices');
    const pages = page.getByRole('navigation', { name: 'Pages' });
    const status = pages.locator('.pager-status');
    await expect(status).toHaveText(`Page 1 of ${last}`);
    await expect(page.locator('tbody tr')).toHaveCount(20);
    await expect(pages.getByRole('button', { name: 'Go to previous page' })).toBeDisabled();
    await expect(pages.getByRole('button', { name: 'Page 1', exact: true })).toHaveAttribute('aria-current', 'page');
    await pages.getByRole('button', { name: 'Go to next page' }).click();
    await expect(page).toHaveURL(/[?]page=2&size=20$/);
    await expect(pages.getByRole('button', { name: 'Page 2', exact: true })).toHaveAttribute('aria-current', 'page');
    await pages.getByRole('button', { name: `Page ${last}`, exact: true }).click();
    await expect(pages.getByRole('button', { name: 'Go to next page' })).toBeDisabled();
    // Back and a reload keep the page.
    await page.goBack();
    await expect(status).toHaveText(`Page 2 of ${last}`);
    await page.reload();
    await expect(status).toHaveText(`Page 2 of ${last}`);
    // At 10 a page, row 21 (the first on page 2 at 20) is on page 3, and on screen.
    const first = await page.locator('tbody tr').first().locator('a.id').getAttribute('href');
    await pages.getByRole('combobox', { name: 'Results per page' }).selectOption('10');
    await expect(page).toHaveURL(/[?]page=3&size=10$/);
    await expect(page.locator('tbody tr').first().locator('a.id')).toHaveAttribute('href', first!);
    await expect(page.locator('tbody tr').first()).toBeInViewport();
    // A filter starts at page 1 and keeps the size; a later visit with no size in the address opens at 10 a page.
    await page.getByRole('navigation', { name: 'Filter by status' }).getByRole('link', { name: /^Approved/ }).click();
    await expect(page).toHaveURL(/[?]status=approved&size=10$/);
    await page.goto('/invoices');
    await expect(page).toHaveURL(/[?]size=10$/);
    await expect(page.locator('tbody tr')).toHaveCount(10);
    // A page past the end goes to the last one.
    await page.goto('/invoices?page=999&size=100');
    await expect(status).toHaveText(`Page ${Math.ceil(total / 100)} of ${Math.ceil(total / 100)}`);
  });

  test('on a phone the pager shows the page, Previous, Next and the size, without the numbers', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/invoices?page=2&size=20');
    const pages = page.getByRole('navigation', { name: 'Pages' });
    await expect(pages.locator('.pager-status')).toContainText('Page 2 of');
    await expect(pages.getByRole('button', { name: 'Go to previous page' })).toBeVisible();
    await expect(pages.getByRole('button', { name: 'Go to next page' })).toBeVisible();
    await expect(pages.getByRole('combobox', { name: 'Results per page' })).toBeVisible();
    await expect(pages.getByRole('button', { name: 'Page 2', exact: true })).toBeHidden();
  });

  test('an invoice id the api does not hold shows the not-found page inside the app', async ({ page }) => {
    await page.goto('/invoices/00000000-0000-4000-8000-000000000000');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  test('a repeated q or status in the address still shows the list', async ({ page }) => {
    await page.goto('/invoices?q=a&q=b&status=billing_issues&status=approved');
    await expect(page.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Filter by status' }).getByRole('link', { name: /^Billing issues/ })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('searchbox', { name: 'Search invoices' })).toHaveValue('a');
  });

  // Windows draws a scrollbar on a box that scrolls by a single pixel, and headless Chromium draws none, so the test
  // compares sizes. On a phone the tab strip scrolls sideways by design.
  test('the toolbar never scrolls: its tab strip fits from 1280 px, and has no vertical scroll at any width', async ({ page }) => {
    for (const width of [1440, 1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/invoices');
      // The list streams in; measured before it shows, every size reads 0.
      await expect(page.getByRole('navigation', { name: 'Filter by status' })).toBeVisible();
      const overflow = (css: string) => page.locator(css).evaluate((box) => ({ x: box.scrollWidth - box.clientWidth, y: box.scrollHeight - box.clientHeight }));
      expect(await overflow('.list-bar'), `the toolbar at ${width} px`).toEqual({ x: 0, y: 0 });
      const tabs = await overflow('.list-bar .tabs');
      expect(tabs.y, `the tab strip's height at ${width} px`).toBe(0);
      if (width >= 1280) expect(tabs.x, `the tab strip fits at ${width} px`).toBe(0);
    }
  });

  test('checked invoices split into billing issues and ready to approve, each tab with its count and only its invoices, a held one saying why', async ({ page }) => {
    // A confirmed duplicate with every charge decided has nothing open, and still waits to be rejected. Decided on its
    // page, so the web's cached counts are forgotten as after any decision.
    const held = await withDuplicate();
    await page.goto(`/invoices/${held.id}`);
    const duplicate = page.locator('.findings article', { hasText: 'Possible duplicate invoice' });
    await duplicate.getByRole('button', { name: 'Confirm duplicate' }).click();
    await expect(duplicate.locator('.badge')).toHaveText('Duplicate confirmed');
    await approveCharges(page);
    // A reviewer holds a checked invoice while a finding is open or its possible duplicate is confirmed.
    const [split] = await db<{ issues: number; ready: number }>(
      `SELECT count(*) FILTER (WHERE held)::int AS issues, count(*) FILTER (WHERE NOT held)::int AS ready FROM (SELECT EXISTS (
         SELECT 1 FROM discrepancies d WHERE d.invoice_id = i.id AND (d.status = 'open' OR (d.type = 'duplicate_invoice' AND d.status = 'confirmed'))) AS held
       FROM invoices i WHERE i.status = 'reconciled') checked`,
    );
    const tabs = page.getByRole('navigation', { name: 'Filter by status' });
    for (const [label, key, count, words] of [
      ['Billing issues', 'billing_issues', split!.issues, /^(Billing issues \(\d+\)|Confirmed duplicate)$/],
      ['Ready to approve', 'ready_to_approve', split!.ready, /^Ready to approve$/],
    ] as const) {
      await page.goto('/invoices');
      const tab = tabs.getByRole('link', { name: `${label} ${count} invoices` });
      await expect(tab).toBeVisible();
      await tab.click();
      await expect(page).toHaveURL(new RegExp(`[?]status=${key}$`));
      await expect(tabs.getByRole('link', { name: new RegExp(`^${label}`) })).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('caption')).toContainText(`of ${count}`);
      // Each row's status pill, in the third column since the invoice and carrier lead (UI round 2).
      const badges = page.locator('tbody td:nth-child(3) .badge');
      await expect(badges.first()).toBeVisible();
      for (const text of await badges.allTextContents()) expect(text).toMatch(words);
    }
    // The held duplicate's row says what it is and why it waits; Ready to approve never lists it.
    const [invoice] = await db<{ number: string }>(`SELECT invoice_number AS number FROM invoices WHERE id = '${held.id}'`);
    const row = page.getByRole('row').filter({ has: page.locator(`a[href="/invoices/${held.id}"]`) });
    await page.goto(`/invoices?status=billing_issues&q=${invoice!.number}`);
    await expect(row.locator('.badge')).toHaveText('Confirmed duplicate');
    await expect(row.locator('.reason')).toHaveText('Waits to be rejected');
    await page.goto(`/invoices?status=ready_to_approve&q=${invoice!.number}`);
    await expect(page.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();
    await expect(row).toHaveCount(0);
  });

  test('the Search button runs the same search as Enter, keeps the tab, and shows its focus', async ({ page }) => {
    const [invoice] = await db<{ id: string; pro_number: string; status: string }>(
      'SELECT id, pro_number, status FROM invoices WHERE pro_number IS NOT NULL ORDER BY id DESC LIMIT 1',
    );
    await page.goto(`/invoices?status=${invoice!.status}`);
    const box = page.getByRole('searchbox', { name: 'Search invoices' });
    await box.fill(invoice!.pro_number);
    await box.press('Tab');
    const button = page.getByRole('button', { name: 'Search', exact: true });
    await expect(button).toBeFocused();
    expect(await button.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none');
    await button.click();
    await expect(page).toHaveURL(new RegExp(`[?]status=${invoice!.status}&q=${invoice!.pro_number}$`));
    await expect(page.locator(`a[href="/invoices/${invoice!.id}"]`)).toBeVisible();
    await expect(box).toHaveValue(invoice!.pro_number);
  });
});

test.describe('document', () => {
  test('the charges table shows every column, Difference included, from 1280 px; on a phone only the table scrolls sideways', async ({ page }) => {
    // The recorded fixture's charges are among the widest: INSIDE_DELIVERY, an uncontracted charge and a four-digit total.
    const [invoice] = await db<{ id: string }>("SELECT id FROM invoices WHERE filename = 'digital.pdf' LIMIT 1");
    const charges = page.locator('.table-wrap', { has: page.locator('table.charges') });
    for (const width of [1440, 1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/invoices/${invoice!.id}`);
      await expect(charges).toBeVisible();
      if (width >= 1280) expect(await charges.evaluate((box) => box.scrollWidth - box.clientWidth), `the charges table's overflow at ${width} px`).toBe(0);
      else expect(await page.evaluate(() => document.documentElement.scrollWidth), `the page's width at ${width} px`).toBeLessThanOrEqual(width);
    }
  });

  test('zoom widens the page past the panel, which scrolls from its left edge, without fetching the document again', async ({ page }) => {
    const [invoice] = await db<{ id: string }>("SELECT id FROM invoices WHERE filename = 'digital.pdf' LIMIT 1");
    await page.goto(`/invoices/${invoice!.id}`);
    const pages = page.getByRole('region', { name: 'Document pages' });
    await expect(pages).toHaveAttribute('aria-busy', 'false');
    const fetched: string[] = [];
    page.on('request', (sent) => {
      if (sent.url().includes('/document')) fetched.push(sent.url());
    });
    for (let step = 0; step < 4; step++) await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(page.locator('.doc-bar')).toContainText('200%');
    await expect(pages).toHaveAttribute('aria-busy', 'false');
    expect(await pages.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0);
    // The drawn page starts inside the panel, so scrolling reaches its left edge.
    const [canvas, panel] = await Promise.all([page.getByRole('img', { name: 'Page 1 of 1' }).boundingBox(), pages.boundingBox()]);
    expect(canvas!.x).toBeGreaterThanOrEqual(panel!.x);
    expect(fetched).toEqual([]);
  });

  test('a page that fails to draw at one zoom draws again at another, and the page keeps working', async ({ page }) => {
    // A draw that throws, as one past a device's canvas limit does (an iPad at 300%): measuring a mark's text fails while
    // the flag is set.
    type Flagged = { failDraw?: boolean };
    await page.addInitScript(() => {
      const measureText = CanvasRenderingContext2D.prototype.measureText;
      CanvasRenderingContext2D.prototype.measureText = function (this: CanvasRenderingContext2D, text: string) {
        if ((window as unknown as Flagged).failDraw) throw new Error('draw failed');
        return measureText.call(this, text);
      };
    });
    const [invoice] = await db<{ id: string }>("SELECT id FROM invoices WHERE filename = 'digital.pdf' LIMIT 1");
    await page.goto(`/invoices/${invoice!.id}`);
    const pages = page.getByRole('region', { name: 'Document pages' });
    await expect(pages).toHaveAttribute('aria-busy', 'false');
    await page.evaluate(() => void ((window as unknown as Flagged).failDraw = true));
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(page.getByText('The document could not be shown.')).toBeVisible();
    await page.evaluate(() => void ((window as unknown as Flagged).failDraw = false));
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect(pages).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('img', { name: 'Page 1 of 1' })).toBeVisible();
    await expect(page.getByText('This page could not load.')).toHaveCount(0);
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
    // The seed bills needs-review invoices at the contract rates, so the corrected one matches the rate card.
    await expect(badge(page, 'Ready to approve')).toBeVisible({ timeout: 30_000 });
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

  // Seeded invoices in review, from the end, so the test above keeps its two; the seed's numbers are 8 random digits.
  const inReview = (offset: number) =>
    db<{ id: string; number: string }>(`SELECT id, invoice_number AS number FROM invoices WHERE status = 'needs_review' ORDER BY id DESC OFFSET ${offset} LIMIT 1`);
  // With no shipment the approval was as billed: the pill and the trail's last row say so, and no status change from a
  // checked invoice shows.
  async function approvedAsBilled(page: Page) {
    await expect(page.locator('.detail-head .badge')).toHaveText('Approved as billed');
    const last = page.getByRole('region', { name: 'Audit trail' }).locator('li').last();
    await expect(last).toContainText('Approved as billed');
    await expect(last).toContainText('Not checked against the rate card');
    await expect(page.getByText(/Status: .* to Approved/)).toHaveCount(0);
  }

  test('approved as billed from review with no earlier invoice of its carrier under its number, it is approved', async ({ page }) => {
    const [invoice] = await inReview(1);
    await page.goto(`/invoices/${invoice!.id}`);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Approve as billed' }).click();
    await approvedAsBilled(page);
  });

  test('approved as billed from review, one its carrier billed before under its number is held, says why and what next, and once no duplicate reads and approves as billed', async ({ page }) => {
    const [invoice] = await inReview(0);
    await db(
      `INSERT INTO invoices (tenant_id, status, filename, content_sha256, carrier_id, invoice_number, created_at, updated_at)
       SELECT tenant_id, 'approved', 'first-scan.pdf', md5(id::text) || md5(reverse(id::text)), carrier_id, invoice_number, '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z'
       FROM invoices WHERE id = '${invoice!.id}'`,
    );
    await page.goto(`/invoices/${invoice!.id}`);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Approve as billed' }).click();
    const held = page.getByRole('region', { name: 'Not approved: possible duplicate' });
    await expect(held).toContainText('Decide the possible duplicate below: Not a duplicate, then approve it as billed; Confirm duplicate, then reject it.');
    const duplicate = page.locator('.findings article', { hasText: 'Possible duplicate invoice' });
    await expect(duplicate).toContainText(`Possible duplicate: invoice ${invoice!.number} from this carrier was also received on 2026-10-01 as first-scan.pdf.`);
    await expect(page.getByRole('region', { name: 'Audit trail' }).getByText('Held for a possible duplicate')).toBeVisible();
    await duplicate.getByRole('button', { name: 'Not a duplicate' }).click();
    // No shipment matched, so nothing was checked against the rate card: it reads, lists and approves as billed.
    await expect(badge(page, 'Ready to approve as billed')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Not checked against the rate card' })).toContainText('Approve it as billed, or reject it.');
    await expect(page.getByRole('button', { name: 'Approve for payment' })).toHaveCount(0);
    await page.goto(`/invoices?status=ready_to_approve&q=${invoice!.number}`);
    const row = page.getByRole('row').filter({ has: page.locator(`a[href="/invoices/${invoice!.id}"]`) });
    await expect(row.locator('.badge')).toHaveText('Ready to approve as billed');
    await expect(row.locator('.reason')).toHaveText('Not checked against the rate card');
    await page.goto(`/invoices/${invoice!.id}`);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Approve as billed' }).click();
    await approvedAsBilled(page);
  });

  test('held for a possible duplicate, its misread invoice number corrected and checked again, the duplicate closes and it approves as billed', async ({ page }) => {
    const [invoice] = await inReview(2);
    await db(
      `INSERT INTO invoices (tenant_id, status, filename, content_sha256, carrier_id, invoice_number, created_at, updated_at)
       SELECT tenant_id, 'approved', 'first-scan.pdf', md5(id::text) || md5(reverse(id::text)), carrier_id, invoice_number, '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z'
       FROM invoices WHERE id = '${invoice!.id}'`,
    );
    await page.goto(`/invoices/${invoice!.id}`);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Approve as billed' }).click();
    // Held, the panel names the invoice it matches and takes the reading to check again.
    const held = page.getByRole('region', { name: 'Not approved: possible duplicate' });
    await expect(held).toContainText(`Possible duplicate: invoice ${invoice!.number} from this carrier was also received on 2026-10-01 as first-scan.pdf.`);
    const number = `${invoice!.number}9`;
    await held.getByLabel('Invoice number').fill(number);
    await held.getByRole('button', { name: 'Check again' }).click();
    // No other invoice from its carrier has the corrected number: the duplicate closes, and the trail says why.
    await expect(page.locator('.findings article', { hasText: 'Possible duplicate invoice' }).locator('.badge')).toHaveText('Closed: reading corrected');
    await expect(page.locator('.detail-head .badge')).toHaveText('Ready to approve as billed');
    await expect(page.getByRole('button', { name: 'Check again' })).toHaveCount(0);
    const trail = page.getByRole('region', { name: 'Audit trail' });
    await expect(trail.getByText(`Invoice number: ${invoice!.number} to ${number}`)).toBeVisible();
    await expect(trail.getByText('The corrected reading matches no other invoice')).toBeVisible();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Approve as billed' }).click();
    await approvedAsBilled(page);
  });
});

test.describe('example data', () => {
  test('a seeded approved invoice says it is example data for its document, details and approval, and asks for no document', async ({ page, request }) => {
    const [seeded] = await db<{ id: string }>(
      "SELECT i.id FROM invoices i WHERE i.status = 'approved' AND NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.invoice_id = i.id) ORDER BY i.id LIMIT 1",
    );
    // The api answers HEAD on the document route; the seed stores no PDF, so 404.
    expect((await documentHead(request, seeded!.id)).status()).toBe(404);
    const asked: string[] = [];
    page.on('request', (sent) => {
      if (new URL(sent.url()).pathname === `/api/invoices/${seeded!.id}/document`) asked.push(sent.url());
    });
    await page.goto(`/invoices/${seeded!.id}`);
    await expect(page.getByRole('region', { name: 'Invoice document' })).toHaveText('Example data: the seed created this invoice without a document.');
    await expect(page.getByText('Example data written by the seed, not read from a document.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Audit trail' }).getByText('Approved in the example data; no reviewer decision is recorded.')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(asked).toEqual([]);
  });

  test('an uploaded invoice, with its PDF stored and a trail past Received, shows no example data', async ({ page, request }) => {
    const [uploaded] = await db<{ id: string }>("SELECT id FROM invoices WHERE filename = 'digital.pdf'");
    // HEAD finds the stored PDF, so a real upload still waiting would not be taken for example data.
    expect((await documentHead(request, uploaded!.id)).status()).toBe(200);
    await page.goto(`/invoices/${uploaded!.id}`);
    await expect(page.getByRole('img', { name: 'Page 1 of 1' })).toBeVisible();
    await expect(page.getByText('Example data')).toHaveCount(0);
  });
});
