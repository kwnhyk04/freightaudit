import { RecentUploadsDocument } from '@freightaudit/contracts/graphql';
import { currentSession, gql, markOffline, rest } from '../../../lib/server.ts';
import { progressKey } from '../../../lib/uploads.ts';

// StatusPoller's check: the progress key of one invoice (?invoice=<id>) or of the upload page's recent uploads
// (?recent=1), one api call each. The poller sends it as a background request, which proxy.ts never counts as activity.
export async function GET(request: Request) {
  if (!(await currentSession())) return Response.json({ detail: 'sign in first' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const id = params.get('invoice');
  const headers = { 'cache-control': 'private, no-store' };
  try {
    if (id) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return Response.json({ detail: 'no such invoice' }, { status: 404 });
      // openapi-fetch hands back a refusal instead of throwing. The api's rate limit (429) or a failure (5xx) counts as no
      // answer, so the poller keeps asking; any other answer stands, an empty key when there is no such invoice.
      const { data, response } = await rest('status').GET('/v1/invoices/{id}', { params: { path: { id } } });
      if (response.status === 429 || response.status >= 500) throw new Error(`the api answered ${response.status}`);
      return Response.json({ key: data ? progressKey([data]) : '' }, { headers });
    }
    if (params.get('recent') !== null) {
      const { invoices } = await gql(RecentUploadsDocument, {});
      return Response.json({ key: progressKey(invoices.edges.map(({ node }) => node)) }, { headers });
    }
  } catch {
    markOffline();
    return Response.json({ detail: 'the FreightAudit API did not answer' }, { status: 502 });
  }
  return Response.json({ detail: 'say what to watch' }, { status: 400 });
}
