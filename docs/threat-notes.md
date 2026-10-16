# Threat notes: review UI and backend for frontend

Scope: `apps/web` (Next.js), its calls to the api, and the public sample under `/demo`. Written for step 9
(2026-10-16); the api's own controls (API keys, rate limits, upload checks) are in `docs/context.md`.

## Assets

- `API_KEY`: full read and write access to the api for the tenant. Lives only in the web server's environment.
- `SESSION_SECRET`: signs session cookies; whoever holds it can sign in as the reviewer.
- `DEMO_PASSWORD_HASH`: the reviewer's argon2id password hash.
- Invoice data and PDFs in the api: carrier billing, amounts, PRO numbers.
- The public sample in `apps/web/public/demo/`: published to anyone.
- The audit trail: who did what to an invoice and when.

## Trust boundaries

1. Browser to Next.js server: untrusted input (forms, cookies, query strings, uploaded files).
2. Next.js server to api: server to server, authenticated with `API_KEY`.
3. Visitor to `/demo`: anonymous, static files only.
4. Probes (`/healthz`, `/readyz`): anonymous, no data.

## Threats and mitigations

| Threat | Mitigation | Gap or residual risk |
| --- | --- | --- |
| API key reaches the browser | Backend for frontend: only `lib/server.ts` (marked `server-only`) reads `API_KEY`; pages, actions and the document route call the api from the server. e2e asserts the browser sends no request to the api's port. | A client component that imports a server module fails the build instead of leaking. |
| Session forgery | The cookie is `{ sub, exp }` with an HMAC-SHA256 under `SESSION_SECRET` (32+ characters), compared in constant time; the expiry is inside the signed payload. | Stateless: a stolen cookie stays valid until it expires (8 hours). Rotating the secret signs everyone out. |
| Session theft | `__Host-` prefix (this host only, Secure, path `/`), httpOnly, Secure, SameSite=Lax. | None beyond a compromised browser. |
| Missing authorization | `proxy.ts` sends requests without a valid cookie to `/login` (or 401 for `/api/`) as a first pass; every live page, server action and route handler checks the session again. | The proxy is optimistic by design; the per-handler checks are the control. |
| CSRF | SameSite=Lax cookie, and every state change is a server action: Next.js aborts a server action whose Origin does not match the Host. | None known. |
| Password guessing | argon2id (m=19456, t=2, p=1) from `node:crypto`; 5 failed attempts per 15 minutes per client lock sign-in, and a success clears the count. | The count is in memory per server instance: on Vercel each instance counts on its own (user decision; a hosted Redis such as Upstash closes it). The client is the first `x-forwarded-for` entry on Vercel and one shared bucket elsewhere, where the server binds 127.0.0.1. |
| Open redirect after sign-in | `next` must be a path that starts with one `/` (not `//` or `/\`); anything else goes to `/invoices`. e2e covers `//evil.example`. | None known. |
| Clickjacking | `Content-Security-Policy: frame-ancestors 'none'` on every response. | None known. |
| MIME sniffing, referrer leaks | `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`. | None known. |
| Data leak through the public sample | `/demo` serves static JSON and PDFs only. Visitors never cause an api call: the demo layout probes the api only for a signed-in user. There are no actions or upload there, and server actions refuse while the backend is offline. `demo:export` refuses an invoice whose content hash is in no golden manifest, so only synthetic invoices can be published. | Whoever runs the export decides which golden invoices are public. |
| Error and log leaks | GraphQL errors are masked (`maskError` logs only name and code; Yoga's own logging is off). The api and worker log database errors by code, never Drizzle's message with its bound values. The web logs JSON lines without passwords, cookies, keys or document values. | None known. |
| Upload abuse | Size (4 MiB), type by magic bytes (PDF, PNG, JPEG) and image size (10,000 px a side, 25 megapixels) are checked in the browser, again in the server action and again in the api; the api also counts PDF pages (20 at most). Per-key rate limits (10 uploads a minute) and the extract backlog's 503 still apply. | All UI users share one key's limits. |
| Audit tampering | `audit_events` is append-only: a trigger refuses UPDATE and DELETE. A reviewer action writes its row in the same transaction as the change. | A database owner can still drop the trigger. Invoices processed before migration 0013 have only their Received entry. |
| Document access | The document route needs the session, checks the id as a UUID and streams the PDF through the api with the server's key, so the tenant scope applies. Responses are `Cache-Control: private`. | None known. |
