import { cookies } from 'next/headers';
import { Landing } from '../components/landing.tsx';
import { parseTheme, THEME_COOKIE } from '../lib/theme.ts';

// The landing page, the same for everyone and public (proxy.ts leaves / out). It reads only this server's own files,
// the theme cookie and ?signed-out (set by sign-out, so the next navigation drops its note), never the api, a key or
// the session.
export default async function Home({ searchParams }: { searchParams: Promise<{ 'signed-out'?: string }> }) {
  const signedOut = (await searchParams)['signed-out'] === '1';
  return <Landing theme={parseTheme((await cookies()).get(THEME_COOKIE)?.value)} signedOut={signedOut} />;
}
