import { DashboardDocument } from '@freightaudit/contracts/graphql';
import { Overview } from '../../../components/overview.tsx';
import { query } from '../../../components/views.tsx';
import { firstParams } from '../../../lib/labels.ts';
import { rangeKey, rangeOf, rangeWindow } from '../../../lib/overview.ts';
import { gql, livePage } from '../../../lib/server.ts';

// The start page after sign-in: the overview of the range in ?range=, ending today (UTC).
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const range = rangeOf((await firstParams(searchParams)).range);
  // Offline, the sample shows the same range.
  await livePage(query('/dashboard', { range: rangeKey(range) }));
  const { dashboard } = await gql(DashboardDocument, rangeWindow(range, new Date()));
  return <Overview data={dashboard} range={range} base="" />;
}
