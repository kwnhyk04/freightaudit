import { InvoicesDocument, type InvoiceStatus } from '@freightaudit/contracts/graphql';
import Link from 'next/link';
import { InvoiceList } from '../../../components/views.tsx';
import { STATUS } from '../../../lib/labels.ts';
import { gql, livePage } from '../../../lib/server.ts';

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; after?: string }> }) {
  const { status: raw, after } = await searchParams;
  await livePage(`/invoices${raw ? `?status=${raw}` : ''}`);
  const upper = raw?.toUpperCase();
  const status = upper && upper in STATUS ? (upper as InvoiceStatus) : undefined;
  const data = await gql(InvoicesDocument, { first: 25, after: after ?? null, status: status ?? null });
  return (
    <>
      <div className="page-head">
        <h1>Invoices</h1>
        <Link className="button primary" href="/upload">
          Upload invoice
        </Link>
      </div>
      <InvoiceList data={data} status={status} after={after} base="" readOnly={false} />
    </>
  );
}
