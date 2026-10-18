import type { ReactNode } from 'react';
import { Shell } from '../../components/shell.tsx';
import { demoSummary } from '../../lib/demo.ts';
import { currentSession, isLive } from '../../lib/server.ts';

// The public sample, read-only. A signed-in reviewer lands here when the backend is offline; only then is the api
// probed, so anonymous visitors never reach it.
export default async function DemoLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  const offline = session ? !(await isLive()) : false;
  return (
    <Shell base="/demo" signedIn={Boolean(session)} banner={offline ? 'Live backend offline, showing sample data' : 'Sample data, read-only'} counts={demoSummary()}>
      {children}
    </Shell>
  );
}
