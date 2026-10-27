import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// The run's settings and the reviewer's test password, shared by the config and the specs. No test is declared here:
// Playwright refuses a test file imported by the config or by another test file.
export const e2eEnv = parseEnv(readFileSync(new URL('e2e.env', import.meta.url), 'utf8')) as Record<string, string>;
export const PASSWORD = e2eEnv.E2E_PASSWORD!;

// A browser older than pdf.js's modern build: no Map.prototype.getOrInsertComputed (Chrome 145, Firefox 144, Safari
// 26.2) and no Math.sumPrecise, both removed before any page script runs.
export const olderBrowser = (page: Page) =>
  page.addInitScript(() => {
    delete (Map.prototype as { getOrInsertComputed?: unknown }).getOrInsertComputed;
    delete (Math as { sumPrecise?: unknown }).sumPrecise;
  });
