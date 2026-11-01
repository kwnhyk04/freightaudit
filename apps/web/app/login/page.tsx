import { redirect } from 'next/navigation';
import { LoginForm } from '../../components/client.tsx';
import { currentSession, sessionLimits } from '../../lib/server.ts';
import { endedMessage, safeNext } from '../../lib/session.ts';

// ended says why a timed-out session was sent here (proxy.ts); after sign-in, next is the page it was on.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; ended?: string }> }) {
  const { next, ended } = await searchParams;
  if (await currentSession()) redirect(safeNext(next));
  return (
    <main className="login">
      <LoginForm next={next} notice={endedMessage(ended, sessionLimits())} />
    </main>
  );
}
