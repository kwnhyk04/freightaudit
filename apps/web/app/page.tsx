import { cookies } from 'next/headers';
import { Landing } from '../components/landing.tsx';
import { parseTheme, THEME_COOKIE } from '../lib/theme.ts';

// The landing page, the same for everyone and public (proxy.ts leaves / out). It reads only this server's own files and
// the theme cookie, never the api, a key or the session.
export default async function Home() {
  return <Landing theme={parseTheme((await cookies()).get(THEME_COOKIE)?.value)} />;
}
