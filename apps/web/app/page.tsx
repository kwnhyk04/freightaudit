import { Landing } from '../components/landing.tsx';

// The landing page, the same for everyone and public (proxy.ts leaves / out). It reads only this server's own files,
// never the api, a key or the session.
export default function Home() {
  return <Landing />;
}
