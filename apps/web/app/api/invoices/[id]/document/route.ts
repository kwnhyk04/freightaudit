import { currentSession, rest } from '../../../../../lib/server.ts';

// The stored PDF of an invoice, streamed from the api with the server's key. An id's bytes never change.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentSession())) return Response.json({ detail: 'sign in first' }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return Response.json({ detail: 'no such invoice' }, { status: 404 });
  const { response } = await rest().GET('/v1/invoices/{id}/document', { params: { path: { id } }, parseAs: 'stream' });
  if (!response.ok || !response.body) {
    return Response.json({ detail: 'no document stored for this invoice' }, { status: response.status === 404 ? 404 : 502 });
  }
  return new Response(response.body, { headers: { 'content-type': 'application/pdf', 'cache-control': 'private, max-age=31536000, immutable' } });
}
