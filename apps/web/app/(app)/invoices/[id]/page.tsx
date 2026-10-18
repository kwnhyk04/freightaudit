import { InvoiceDocument } from '@freightaudit/contracts/graphql';
import { notFound } from 'next/navigation';
import { InvoiceDetail } from '../../../../components/detail.tsx';
import { demoInvoice } from '../../../../lib/demo.ts';
import { gql, livePage } from '../../../../lib/server.ts';

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Offline, the sample's twin when the sample holds this invoice; it knows only its own, so any other goes to its list.
  await livePage(demoInvoice(id) ? `/invoices/${id}` : '/invoices');
  const data = await gql(InvoiceDocument, { id });
  if (!data.invoice) notFound();
  return <InvoiceDetail data={data} base="" readOnly={false} documentSrc={`/api/invoices/${id}/document`} />;
}
