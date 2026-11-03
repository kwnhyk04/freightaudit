import { InvoicesDocument } from '@freightaudit/contracts/graphql';
import { InvoiceList } from '../../../components/views.tsx';
import { filterKey, firstParams, listFilter } from '../../../lib/labels.ts';
import { pageParams, query } from '../../../lib/paging.ts';
import { gql, livePage, summary } from '../../../lib/server.ts';

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await firstParams(searchParams);
  const filter = listFilter(params.status);
  const search = params.q?.trim().slice(0, 100) || undefined;
  // Offline, the sample shows the same filter, search and page.
  await livePage(query('/invoices', { status: filterKey(filter), q: search, page: params.page, size: params.size }));
  const { page, size, offset } = pageParams(params);
  const variables = { first: size, offset, status: filter.status ?? null, hasOpenFindings: filter.open ?? null, search: search ?? null };
  const [data, counts] = await Promise.all([gql(InvoicesDocument, variables), summary()]);
  return <InvoiceList data={data} summary={counts} filter={filter} search={search} paging={{ page, size, sized: params.size !== undefined }} base="" readOnly={false} />;
}
