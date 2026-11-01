import { cookies } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { START_PAGE } from '../lib/session.ts';
import { parseTheme, THEME_COOKIE } from '../lib/theme.ts';
import { ThemeSwitch } from './client.tsx';
import { Icon } from './icons.tsx';
import { Sidebar, type NavLink } from './sidebar.tsx';

// The frame of every page: a skip link, the sidebar with its counts, an optional banner and the work. base is '' for
// live pages and '/demo' for the read-only sample; counts are missing while they cannot be read. The name leads to the
// start page, or in the sample to its invoices, where /demo opens.
export async function Shell({
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
  const audit: NavLink[] = [
    { href: `${base}/dashboard`, label: 'Overview', icon: 'overview' },
    { href: `${base}/invoices`, label: 'Invoices', icon: 'invoices' },
    { href: `${base}/discrepancies`, label: 'Review queue', icon: 'queue', count: counts?.openFindings, unit: 'open finding', tone: 'warn' },
  ];
  const operations: NavLink[] = [
    { href: `${base}/dead-letters`, label: 'Dead letters', icon: 'deadLetters', count: counts?.openDeadLetters, unit: 'open dead letter' },
    ...(sample ? [] : [{ href: '/upload', label: 'Upload', icon: 'upload' } as const]),
  ];
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const foot = (
    <>
      <ThemeSwitch initial={theme} />
      <p className="who">
        <span className="label">{sample ? 'Sample data' : 'Signed in as reviewer'}</span>
      </p>
      {sample && signedIn && (
        <Link className="foot-action" href={START_PAGE}>
          <Icon name="live" />
          <span className="label">Try live data</span>
        </Link>
      )}
      {signedIn ? (
        <form method="post" action="/logout">
          <button className="foot-action">
            <Icon name="signOut" />
            <span className="label">Sign out</span>
          </button>
        </form>
      ) : (
        <Link className="foot-action" href="/login">
          <Icon name="signIn" />
          <span className="label">Sign in</span>
        </Link>
      )}
    </>
  );
  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Sidebar
        home={sample ? '/demo/invoices' : START_PAGE}
        groups={[
          { label: 'Audit', links: audit },
          { label: 'Operations', links: operations },
        ]}
        foot={foot}
      />
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
