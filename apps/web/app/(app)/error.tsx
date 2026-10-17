'use client';
import Link from 'next/link';
import { Empty } from '../../components/ui.tsx';

// A page whose data could not load: what happened and what to do, never a blank screen.
export default function PageError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="table-wrap">
      <Empty title="This page could not load.">
        <p>The FreightAudit API did not answer or refused the request. If it stays down, the sample data opens instead.</p>
        <div className="row">
          <button type="button" className="button" onClick={reset}>
            Try again
          </button>
          <Link href="/demo/invoices">View the sample data</Link>
        </div>
      </Empty>
    </div>
  );
}
