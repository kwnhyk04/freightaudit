// Ready whenever it is up: the UI must keep serving when the API is unreachable.
export function GET() {
  return Response.json({ status: 'ok', checks: {} });
}
