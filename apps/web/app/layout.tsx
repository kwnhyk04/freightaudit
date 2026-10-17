import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// One sans for the interface, a mono for identifiers; next/font serves both from this site, no third-party request.
const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex-sans' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono' });

// The icon is a data URI, so browsers stop asking for a /favicon.ico that does not exist.
const icon = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='%232b4c7e'/><path d='M10 8h13v4h-8.5v3.5H21v4h-6.5V24H10z' fill='white'/></svg>";
export const metadata = { title: 'FreightAudit', description: 'Carrier invoice review for accounts payable', icons: { icon } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
