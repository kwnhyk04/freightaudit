import { redirect } from 'next/navigation';
import { LoginForm } from '../../components/client.tsx';
import { currentSession } from '../../lib/server.ts';
import { safeNext } from '../../lib/session.ts';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await currentSession()) redirect(safeNext(next));
  return (
    <main className="login">
      <LoginForm next={next} />
    </main>
  );
}
