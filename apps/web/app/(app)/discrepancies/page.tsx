import { DiscrepanciesDocument } from '@freightaudit/contracts/graphql';
import { DiscrepancyList } from '../../../components/views.tsx';
import { firstParams } from '../../../lib/labels.ts';
import { gql, livePage } from '../../../lib/server.ts';

export default async function DiscrepanciesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { status: raw, after } = await firstParams(searchParams);
  await livePage('/discrepancies');
  const status = (['OPEN', 'CONFIRMED', 'DISMISSED'] as const).find((value) => value.toLowerCase() === raw) ?? 'OPEN';
  const data = await gql(DiscrepanciesDocument, { first: 25, after: after ?? null, status });
  return (
    <>
      <div className="page-head">
        <h1>Review queue</h1>
      </div>
      <DiscrepancyList data={data} status={status} after={after} base="" readOnly={false} />
    </>
  );
}
