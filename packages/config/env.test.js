/* global expect, test -- Jest's. */
import { settings } from './src/env.ts';

test("Claude's spend cap takes whole dollars or dollars and cents, and keeps it as dollars and cents", () => {
  const cap = settings.LLM_CLAUDE_SPEND_CAP_USD;
  expect(['15', '15.5', '15.00', '0.75', ''].map((value) => cap.parse(value))).toEqual(['15.00', '15.50', '15.00', '0.75', '']);
  expect(cap.parse(undefined)).toBe('');
  for (const bad of ['15.', '15.001', '-1', '1e3', '$15', ' 15']) expect(cap.safeParse(bad).success).toBe(false);
});
