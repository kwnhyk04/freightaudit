import type { ReactNode } from 'react';
import { Shell } from '../../components/shell.tsx';
import { requireSession } from '../../lib/server.ts';

// Live pages: signed in only. Each page also sends itself to its /demo twin while the backend is offline.
export default async function LiveLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <Shell base="" signedIn>
      {children}
    </Shell>
  );
}
