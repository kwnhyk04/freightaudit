import type { ReactNode } from 'react';
import { Shell } from '../../components/shell.tsx';
import { isLive, requireSession, summary } from '../../lib/server.ts';

// Live pages: signed in only. Each page also sends itself to its /demo twin while the backend is offline. The counts
// never fail the page: offline they are not asked for, and an error leaves the nav without them, since an error thrown
// in a layout escapes the segment's error.tsx.
export default async function LiveLayout({ children }: { children: ReactNode }) {
  await requireSession();
  const counts = (await isLive()) ? await summary().catch(() => undefined) : undefined;
  return (
    <Shell base="" signedIn counts={counts}>
      {children}
    </Shell>
  );
}
