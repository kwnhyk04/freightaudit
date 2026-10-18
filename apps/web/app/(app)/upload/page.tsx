import { RecentUploadsDocument } from '@freightaudit/contracts/graphql';
import { SampleButton, StatusPoller, UploadArea } from '../../../components/client.tsx';
import { IN_FLIGHT, plural, uploadState } from '../../../lib/labels.ts';
import { GOLDEN_SET_URL, SAMPLES } from '../../../lib/samples.ts';
import { gql, livePage } from '../../../lib/server.ts';

export default async function UploadPage() {
  // Uploads need the live backend; while it is offline the sample invoices are shown instead.
  await livePage('/invoices');
  // The latest invoices, whoever uploaded them: one tenant and one reviewer, so everyone signed in sees the same list.
  const { invoices } = await gql(RecentUploadsDocument, {});
  const now = Date.now();
  const rows = invoices.edges.map(({ node }) => ({ id: node.id, filename: node.filename, ...uploadState(node, now) }));
  const working = invoices.edges.filter(({ node }) => IN_FLIGHT.has(node.status)).length;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Upload an invoice</h1>
          <p className="muted">The pipeline reads it, matches it to a shipment and checks every line against the rate card.</p>
        </div>
      </div>
      <StatusPoller active={working > 0} label={working > 0 ? `${plural(working, 'upload')} in progress` : 'Every upload is done'} />
      <div className="upload">
        <UploadArea rows={rows} />
        <aside className="panel samples" aria-labelledby="samples-title">
          <div className="samples-head">
            <h2 id="samples-title">Try a sample invoice</h2>
            <p className="faint">No file needed. Each sample is synthetic and shows a different case.</p>
          </div>
          {SAMPLES.map((sample) => (
            <SampleButton key={sample.key} sample={sample.key} label={sample.label} note={sample.note} />
          ))}
          <div className="notice">
            <p>Demo mode uses synthetic data. Please don&apos;t upload real invoices.</p>
            <p className="note">
              The demo accepts only files from the <a href={GOLDEN_SET_URL}>golden set</a>. Once the day&apos;s model budget is spent, an upload waits until 00:00 UTC.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
