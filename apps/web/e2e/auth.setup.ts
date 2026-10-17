import { expect, test as setup } from '@playwright/test';
import { PASSWORD } from './env.ts';

setup('sign in once and keep the session for the other projects', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/invoices$/);
  await page.context().storageState({ path: 'e2e/.auth/reviewer.json' });
});
