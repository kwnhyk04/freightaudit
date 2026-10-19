import { InvoicesDocument } from '@freightaudit/contracts/graphql';
import { InvoiceList, PAGE_SIZE, query } from '../../../components/views.tsx';
import { filterKey, firstParams, listFilter } from '../../../lib/labels.ts';
import { gql, livePage, summary } from '../../../lib/server.ts';

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { status: raw, after, before, q } = await firstParams(searchParams);
  const filter = listFilter(raw);
  const search = q?.trim().slice(0, 100) || undefined;
  // Offline, the sample shows the same filter and search.
  await livePage(query('/invoices', { status: filterKey(filter), q: search }));
  const page = before ? { last: PAGE_SIZE, before } : { first: PAGE_SIZE, after: after ?? null };
  const variables = { ...page, status: filter.status ?? null, hasOpenFindings: filter.open ?? null, search: search ?? null };
  const [data, counts] = await Promise.all([gql(InvoicesDocument, variables), summary()]);
  return <InvoiceList data={data} summary={counts} filter={filter} search={search} base="" readOnly={false} />;
}
