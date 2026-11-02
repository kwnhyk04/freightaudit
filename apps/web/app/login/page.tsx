import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LoginForm } from '../../components/client.tsx';
import { LogoMark } from '../../components/logo.tsx';
import { currentSession, sessionLimits } from '../../lib/server.ts';
import { endedMessage, safeNext } from '../../lib/session.ts';

// ended says why a timed-out session was sent here (proxy.ts); after sign-in, next is the page it was on. The landing
// header's mark and name, and a link under the form, always lead home.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; ended?: string }> }) {
  const { next, ended } = await searchParams;
  if (await currentSession()) redirect(safeNext(next));
  return (
    <div className="login-page">
      <header className="landing-top">
        <div className="landing-wrap">
          <Link href="/" className="landing-name">
            <LogoMark />
            FreightAudit
          </Link>
        </div>
      </header>
      <main className="login">
        <LoginForm next={next} notice={endedMessage(ended, sessionLimits())} />
        <Link href="/" className="login-home">
          Back to home
        </Link>
      </main>
    </div>
  );
}
