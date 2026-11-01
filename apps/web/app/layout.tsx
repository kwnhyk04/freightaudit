import localFont from 'next/font/local';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { parseTheme, THEME_COOKIE } from '../lib/theme.ts';
import './globals.css';

// One sans for the interface, a mono for identifiers, both from ./fonts (OFL), so the build never fetches from Google.
// ponytail: latin only, every character the UI and its data use; add other subsets if invoices bring other scripts.
// The sans is one variable file for 400, 500 and 600; each const's name becomes its CSS family name.
const plexSans = localFont({ src: './fonts/ibm-plex-sans-latin.woff2', weight: '400 600', variable: '--font-plex-sans' });
const plexMono = localFont({
  src: [
    { path: './fonts/ibm-plex-mono-latin-400.woff2', weight: '400' },
    { path: './fonts/ibm-plex-mono-latin-500.woff2', weight: '500' },
  ],
  variable: '--font-plex-mono',
});

// The tab and home-screen icons are app/icon.svg and app/apple-icon.png, which Next links from every page.
export const metadata = { title: 'FreightAudit', description: 'Carrier invoice review for accounts payable' };

// The theme cookie picks the tokens on the server (data-theme); without one the device's scheme does.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`} data-theme={theme === 'system' ? undefined : theme}>
      <body>{children}</body>
    </html>
  );
}
