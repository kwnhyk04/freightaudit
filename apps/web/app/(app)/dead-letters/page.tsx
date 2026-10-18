import { DeadLettersDocument } from '@freightaudit/contracts/graphql';
import { DeadLetterList } from '../../../components/views.tsx';
import { firstParams } from '../../../lib/labels.ts';
import { gql, livePage } from '../../../lib/server.ts';

export default async function DeadLettersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { status, after } = await firstParams(searchParams);
  await livePage('/dead-letters');
  const replayed = status === 'replayed';
  const data = await gql(DeadLettersDocument, { first: 25, after: after ?? null, status: replayed ? 'REPLAYED' : 'OPEN' });
  return (
    <>
      <div className="page-head">
        <h1>Dead letters</h1>
      </div>
      <DeadLetterList data={data} replayed={replayed} after={after} base="" readOnly={false} />
    </>
  );
}
