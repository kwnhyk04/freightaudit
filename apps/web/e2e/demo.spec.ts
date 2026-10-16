import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PASSWORD } from './env.ts';

const sample = JSON.parse(readFileSync(new URL('../public/demo/invoices.json', import.meta.url), 'utf8')) as { invoices: { edges: unknown[] } };
const offline = `http://127.0.0.1:${process.env.E2E_OFFLINE_PORT ?? 3002}`;

test('signed out, the sample is public and read-only, and live pages still need a session', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/login');
  await page.getByRole('link', { name: 'View sample data without signing in' }).click();
  await expect(page).toHaveURL(/\/demo\/invoices$/);
  await expect(page.getByRole('status')).toHaveText('Sample data, read-only');
  if (sample.invoices.edges.length > 0) {
    await expect(page.locator('tbody tr')).toHaveCount(sample.invoices.edges.length);
    await page.locator('tbody a').first().click();
    await expect(page.getByRole('img', { name: /^Page 1 of/ })).toBeVisible();
  } else {
    await expect(page.getByText('The sample is empty.')).toBeVisible();
  }
  for (const name of ['Approve charge', 'Dispute', 'Replay', 'Re-run matching', 'Approve for payment', 'Upload invoice']) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
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

test('signed in while the backend is down, the app shows the same sample under the offline banner', async ({ page }) => {
  await page.goto(`${offline}/login`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(`${offline}/demo/invoices`);
  await expect(page.getByRole('status')).toHaveText('Live backend offline, showing sample data');
  await expect(page.getByRole('link', { name: 'Upload invoice' })).toHaveCount(0);
});
