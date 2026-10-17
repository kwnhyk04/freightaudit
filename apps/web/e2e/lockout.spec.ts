import { expect, test } from '@playwright/test';
import { PASSWORD } from './env.ts';

// Runs last: the limit then holds for 15 minutes on this server.
test('five wrong passwords lock sign-in for 15 minutes, even with the right one', async ({ page }) => {
  await page.goto('/login');
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.getByLabel('Password').fill('not the password');
    // Each attempt must reach the server before the next; the error text of the last one is already on the page.
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === 'POST'),
      page.getByRole('button', { name: 'Sign in' }).click(),
    ]);
    await expect(page.locator('.form-error')).toHaveText('Wrong password.');
  }
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.form-error')).toHaveText('Too many sign-in attempts. Try again in 15 minutes.');
  await expect(page).toHaveURL(/\/login$/);
});
