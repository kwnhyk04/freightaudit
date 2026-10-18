import { InvoiceDocument } from '@freightaudit/contracts/graphql';
import { notFound } from 'next/navigation';
import { InvoiceDetail } from '../../../../components/detail.tsx';
import { demoInvoice } from '../../../../lib/demo.ts';
import { isExampleData } from '../../../../lib/labels.ts';
import { documentStored, gql, livePage } from '../../../../lib/server.ts';

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Offline, the sample's twin when the sample holds this invoice; it knows only its own, so any other goes to its list.
  await livePage(demoInvoice(id) ? `/invoices/${id}` : '/invoices');
  const data = await gql(InvoiceDocument, { id });
  if (!data.invoice) notFound();
  // Only a trail of just the Received entry can be example data, so only then is the document looked up.
  const trail = data.invoice.auditTrail;
  const example = isExampleData({ stored: false, trail }) && !(await documentStored(data.invoice.id));
  return <InvoiceDetail data={data} base="" readOnly={false} documentSrc={`/api/invoices/${id}/document`} example={example} />;
}
