import { readFileSync } from 'node:fs';
import { parseTheme, themeCookie } from './theme.ts';

test('a theme cookie reads as Light or Dark, and anything else as System', () => {
  expect(['light', 'dark', 'system', 'blue', undefined].map(parseTheme)).toEqual(['light', 'dark', 'system', 'system', 'system']);
  expect(themeCookie('dark')).toBe('fa-theme=dark; path=/; max-age=31536000; samesite=lax');
  expect(themeCookie('system')).toBe('fa-theme=; path=/; max-age=0; samesite=lax');
});

// The device's dark scheme and a chosen Dark must draw the same tokens.
test("globals.css's two dark token blocks hold the same values", () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return css
      .slice(start, css.indexOf('}', start))
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean);
  };
  const device = block(":root:not([data-theme='light'])");
  expect(device.length).toBeGreaterThan(20);
  expect(block(":root[data-theme='dark']")).toEqual(device);
});
