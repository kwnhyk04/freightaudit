import { UploadForm } from '../../../components/client.tsx';
import { GOLDEN_SET_URL, SAMPLES } from '../../../lib/samples.ts';
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
      <section className="panel samples" aria-labelledby="samples-title">
        <h2 id="samples-title">Try a sample</h2>
        <ul>
          {SAMPLES.map((sample) => (
            <li key={sample.file}>
              <a href={`/samples/${sample.file}`} download>
                {sample.label}
              </a>{' '}
              <span className="muted">{sample.note}</span>
            </li>
          ))}
        </ul>
        <p className="faint">
          More synthetic invoices are in the repository&apos;s <a href={GOLDEN_SET_URL}>golden set</a>. The public demo accepts
          only golden-set files; anything else is refused. Once its daily model budget is spent, an upload waits as Received
          and continues by itself after 00:00 UTC.
        </p>
      </section>
    </>
  );
}
