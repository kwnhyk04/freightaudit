import localFont from 'next/font/local';
import type { ReactNode } from 'react';
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

// The icon is a data URI, so browsers stop asking for a /favicon.ico that does not exist.
const icon = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='%232b4c7e'/><path d='M10 8h13v4h-8.5v3.5H21v4h-6.5V24H10z' fill='white'/></svg>";
export const metadata = { title: 'FreightAudit', description: 'Carrier invoice review for accounts payable', icons: { icon } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
