import { UploadForm } from '../../../components/client.tsx';
import { livePage } from '../../../lib/server.ts';

export default async function UploadPage() {
  // Uploads need the live backend; while it is offline the sample invoices are shown instead.
  await livePage('/invoices');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Upload an invoice</h1>
          <p className="muted">The pipeline reads it, matches it to a shipment and checks every line against the rate card.</p>
        </div>
      </div>
      <UploadForm />
    </>
  );
}
