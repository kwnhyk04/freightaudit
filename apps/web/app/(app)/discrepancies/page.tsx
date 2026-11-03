import { DiscrepanciesDocument } from '@freightaudit/contracts/graphql';
import { DiscrepancyList } from '../../../components/views.tsx';
import { firstParams } from '../../../lib/labels.ts';
import { pageParams } from '../../../lib/paging.ts';
import { gql, livePage } from '../../../lib/server.ts';

export default async function DiscrepanciesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await firstParams(searchParams);
  await livePage('/discrepancies');
  const status = (['OPEN', 'CONFIRMED', 'DISMISSED'] as const).find((value) => value.toLowerCase() === params.status) ?? 'OPEN';
  const { page, size, offset } = pageParams(params);
  const data = await gql(DiscrepanciesDocument, { first: size, offset, status });
  return (
    <>
      <div className="page-head">
        <h1>Review queue</h1>
      </div>
      <DiscrepancyList data={data} status={status} paging={{ page, size, sized: params.size !== undefined }} base="" readOnly={false} />
    </>
  );
}
