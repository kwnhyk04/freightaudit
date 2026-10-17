import { InvoiceDocument } from '@freightaudit/contracts/graphql';
import { notFound } from 'next/navigation';
import { InvoiceDetail } from '../../../../components/views.tsx';
import { gql, livePage } from '../../../../lib/server.ts';

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await livePage(`/invoices/${id}`);
  const data = await gql(InvoiceDocument, { id });
  if (!data.invoice) notFound();
  return <InvoiceDetail data={data} base="" readOnly={false} documentSrc={`/api/invoices/${id}/document`} />;
}
