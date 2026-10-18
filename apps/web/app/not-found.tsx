import { Shell } from '../components/shell.tsx';
import { NotFound } from '../components/ui.tsx';
import { currentSession } from '../lib/server.ts';

// A URL that matches no route. A signed-in reviewer keeps the app's frame; anyone else gets the way to the sample.
export default async function RootNotFound() {
  if (await currentSession()) {
    return (
      <Shell base="" signedIn>
        <NotFound text="Nothing lives at this address in FreightAudit." href="/invoices" back="Back to the invoices" />
      </Shell>
    );
  }
  return (
    <main className="login">
      <NotFound text="Nothing lives at this address in FreightAudit." href="/demo/invoices" back="View the sample data" />
    </main>
  );
}
