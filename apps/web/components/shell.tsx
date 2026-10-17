import Link from 'next/link';
import type { ReactNode } from 'react';
import { NavLinks } from './client.tsx';

// The frame of every page: the sidebar, an optional banner and the work. base is '' for live pages and '/demo' for the
// read-only sample.
export function Shell({ base, signedIn, banner, children }: { base: string; signedIn: boolean; banner?: string; children: ReactNode }) {
  const sample = base === '/demo';
  const links = [
    { href: `${base}/invoices`, label: 'Invoices' },
    { href: `${base}/discrepancies`, label: 'Review queue' },
    { href: `${base}/dead-letters`, label: 'Dead letters' },
    ...(sample ? [] : [{ href: '/upload', label: 'Upload' }]),
  ];
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href={`${base}/invoices`} className="wordmark">
          FreightAudit {sample && <span>sample</span>}
        </Link>
        <NavLinks links={links} />
        <div className="sidebar-foot">
          {sample && signedIn && <Link href="/invoices">Try live data</Link>}
          {signedIn ? (
            <form method="post" action="/logout">
              <button className="button small">Sign out</button>
            </form>
          ) : (
            <Link className="button small" href="/login">
              Sign in
            </Link>
          )}
        </div>
      </aside>
      <main className="main">
        {banner && (
          <p className="banner" role="status">
            {banner}
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
