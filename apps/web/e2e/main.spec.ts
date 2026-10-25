import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
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
    await expect(page).toHaveURL(/\/login$/);
    expect((await context.cookies()).some((each) => each.name === '__Host-session')).toBe(false);
    await context.close();
  });
});

test.describe('landing page', () => {
  test('signed in, / is the same landing page; its demo button and a sign-in back to / both open the start page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/127[.]0[.]0[.]1:3000\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Catch freight overbilling before you pay it.');
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
    const hero = page.locator('.hero-card');
    await expect(hero.locator('dt')).toHaveText('Overbilling found, last 4 weeks');
    await expect(hero.locator('.hero-figure')).toHaveText(money(Number(counted!.overbilled)));
    await expect(hero).toContainText(`Across ${counted!.invoices} invoice${counted!.invoices === 1 ? '' : 's'}`);
    await expect(page.locator('.stats dt:text-is("Invoices received") + dd')).toHaveText(String(counted!.received));
    await expect(page.locator('.health dt:text-is("Waiting to be read") + dd')).toHaveText(String(counted!.waiting));
    await expect(page.locator('.health dt:text-is("Dead letters") + dd')).toHaveText(String(counted!.letters));
    // The live overview shows the model cost and today's tokens, which the sample leaves out.
    await expect(page.locator('.stats dt:text-is("Model cost per invoice")')).toBeVisible();
    await expect(page.locator('.health dt:text-is("AI tokens today")')).toBeVisible();
    // Each column's hover text holds the values of its row in the chart's table.
    for (const name of ['Overbilling found per week', 'Invoices per week, by outcome']) {
      const card = page.getByRole('region', { name, exact: true });
      await card.getByText('Show as a table').click();
      const rows = await card.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td.num')].map((td) => td.textContent)));
      const titles = await card.locator('.stack').evaluateAll((stacks) => stacks.map((stack) => stack.getAttribute('title')!.split(': ')[1]!));
      expect(rows).toHaveLength(8);
      expect(titles.map((title) => (title.startsWith('$') ? [title] : title.match(/[0-9]+/g)))).toEqual(rows);
    }
    // The range is a link that the address keeps; 4 weeks needs none.
    const ranges = page.getByRole('navigation', { name: 'Time range' });
    await expect(ranges.getByRole('link', { name: '4 weeks' })).toHaveAttribute('aria-current', 'page');
    await ranges.getByRole('link', { name: '7 days' }).click();
    await expect(page).toHaveURL(/\/dashboard[?]range=7d$/);
    await expect(hero.locator('dt')).toHaveText('Overbilling found, last 7 days');
    await expect(ranges.getByRole('link', { name: '7 days' })).toHaveAttribute('aria-current', 'page');
    await ranges.getByRole('link', { name: '4 weeks' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(hero.locator('dt')).toHaveText('Overbilling found, last 4 weeks');
  });
});

test.describe('upload', () => {
  test('choosing files only lists them, with size and pages and why one would be refused; Upload sends the rest, which leave the list, and toasts say what follows', async ({ page, request }) => {
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

  test('a listed file can be removed, and Clear empties the list; nothing is sent', async ({ page }) => {
    await page.goto('/upload');
    const file = page.getByLabel('Invoice files');
    await expect(file).toBeEnabled();
    const posts = countUploads(page);
    await file.setInputFiles(['one.pdf', 'two.pdf', 'three.pdf'].map((name) => ({ name, mimeType: 'application/pdf', buffer: digital })));
    await expect(page.getByRole('button', { name: 'Upload 3 invoices' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove two.pdf' }).click();
    await expect(page.getByRole('list', { name: 'Files to upload' }).getByRole('listitem')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Upload 2 invoices' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByRole('list', { name: 'Files to upload' })).toHaveCount(0);
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

  test('an upload that gets no answer ends the batch, and the file not sent stays listed; its toast stays until closed; Retry and Upload send it again', async ({ page }) => {
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
    await failed.getByRole('button', { name: 'Close' }).click();
    await expect(failed).toHaveCount(0);
    // The file stays in the list, counted again, until it uploads and leaves. The second goes unsent, so this run adds
    // only the one invoice the tests after this one count on.
    await page.getByRole('button', { name: 'Remove digital-next.pdf' }).click();
    await page.unroute('**/upload');
    await page.getByRole('button', { name: 'Upload 1 invoice' }).click();
    await expect(pick(page, 'digital-copy.pdf')).toHaveCount(0);
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
    // At 1280 px, where the charges table only just fits, its Expected column now holds words.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/invoices/${rebill!.id}`);
    const header = page.locator('.detail-head');
    await expect(header).toContainText(`Re-bills shipment ${rebill!.reference}: ${lines} of ${lines} lines were already billed on ${name} (${printed}).`);
    const texts = await page.locator('.findings .finding-body > p.muted').allTextContents();
    expect(texts.filter((text) => text.endsWith(` was already billed on ${name} (${printed}) for the same shipment.`))).toHaveLength(lines);
    const charges = page.locator('table.charges');
    await expect(page.getByText('Expected is $0 for a charge already billed, on an earlier invoice for this shipment or on an earlier line, so it is not paid twice.')).toBeVisible();
    await expect(charges.locator('tbody td', { hasText: `Already billed on ${name}` })).toHaveCount(lines);
    await expect(charges.locator('tbody').getByRole('link', { name })).toHaveCount(lines);
    expect(await page.locator('.table-wrap', { has: charges }).evaluate((box) => box.scrollWidth - box.clientWidth)).toBe(0);
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
});

test.describe('list', () => {
  test('a search finds an invoice by its PRO number, and the pages step forward and back', async ({ page }) => {
    const [invoice] = await db<{ id: string; pro_number: string }>('SELECT id, pro_number FROM invoices WHERE pro_number IS NOT NULL ORDER BY id LIMIT 1');
    await page.goto('/invoices');
    await page.getByRole('searchbox', { name: 'Search invoices' }).fill(invoice!.pro_number);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`[?]q=${invoice!.pro_number}$`));
    await expect(page.locator(`a[href="/invoices/${invoice!.id}"]`)).toBeVisible();
    const found = await page.locator('tbody tr').count();
    await expect(page.getByRole('navigation', { name: 'Pages' })).toContainText(`Showing 1 to ${found} of ${found}`);
    await page.goto('/invoices');
    const pages = page.getByRole('navigation', { name: 'Pages' });
    await expect(pages).toContainText(/Showing 1 to 25 of \d+/);
    await pages.getByRole('link', { name: 'Next' }).click();
    await expect(pages).toContainText(/Showing 26 to 50 of \d+/);
    // Within a page of the start, Previous is the plain first page.
    await pages.getByRole('link', { name: 'Previous' }).click();
    await expect(pages).toContainText(/Showing 1 to 25 of \d+/);
    await expect(page).toHaveURL(/\/invoices$/);
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
      await expect(page.getByRole('navigation', { name: 'Pages' })).toContainText(`of ${count}`);
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
