import Link from 'next/link';
import type { ReactNode } from 'react';
import { NavLinks } from './client.tsx';

// The frame of every page: a skip link, the sidebar with its counts, an optional banner and the work. base is '' for
// live pages and '/demo' for the read-only sample; counts are missing while they cannot be read.
export function Shell({
  base,
  signedIn,
  banner,
  counts,
  children,
}: {
  base: string;
  signedIn: boolean;
  banner?: string;
  counts?: { openFindings: number; openDeadLetters: number };
  children: ReactNode;
}) {
  const sample = base === '/demo';
  const links = [
    { href: `${base}/invoices`, label: 'Invoices' },
    { href: `${base}/discrepancies`, label: 'Review queue', count: counts?.openFindings, unit: 'open finding', tone: 'warn' as const },
    { href: `${base}/dead-letters`, label: 'Dead letters', count: counts?.openDeadLetters, unit: 'open dead letter' },
    ...(sample ? [] : [{ href: '/upload', label: 'Upload' }]),
  ];
  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
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
      <main className="main" id="main">
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
