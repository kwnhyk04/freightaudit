import { DeadLettersDocument } from '@freightaudit/contracts/graphql';
import { DeadLetterList } from '../../../components/views.tsx';
import { firstParams } from '../../../lib/labels.ts';
import { pageParams } from '../../../lib/paging.ts';
import { gql, livePage } from '../../../lib/server.ts';

export default async function DeadLettersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await firstParams(searchParams);
  await livePage('/dead-letters');
  const replayed = params.status === 'replayed';
  const { page, size, offset } = pageParams(params);
  const data = await gql(DeadLettersDocument, { first: size, offset, status: replayed ? 'REPLAYED' : 'OPEN' });
  return (
    <>
      <div className="page-head">
        <h1>Dead letters</h1>
      </div>
      <DeadLetterList data={data} replayed={replayed} paging={{ page, size, sized: params.size !== undefined }} base="" readOnly={false} />
    </>
  );
}
