import { DiscrepanciesDocument } from '@freightaudit/contracts/graphql';
import { DiscrepancyList } from '../../../components/views.tsx';
import { gql, livePage } from '../../../lib/server.ts';

export default async function DiscrepanciesPage({ searchParams }: { searchParams: Promise<{ status?: string; after?: string }> }) {
  const { status: raw, after } = await searchParams;
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
