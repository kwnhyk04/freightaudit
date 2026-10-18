import { InvoicesDocument } from '@freightaudit/contracts/graphql';
import { InvoiceList, PAGE_SIZE, query } from '../../../components/views.tsx';
import { statusParam } from '../../../lib/labels.ts';
import { gql, livePage, summary } from '../../../lib/server.ts';

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; after?: string; before?: string; q?: string }> }) {
  const { status: raw, after, before, q } = await searchParams;
  const status = statusParam(raw);
  const search = q?.trim().slice(0, 100) || undefined;
  // Offline, the sample shows the same filter and search.
  await livePage(query('/invoices', { status: status?.toLowerCase(), q: search }));
  const page = before ? { last: PAGE_SIZE, before } : { first: PAGE_SIZE, after: after ?? null };
  const [data, counts] = await Promise.all([gql(InvoicesDocument, { ...page, status: status ?? null, search: search ?? null }), summary()]);
  return <InvoiceList data={data} summary={counts} status={status} search={search} base="" readOnly={false} />;
}
