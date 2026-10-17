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

# The public api on this PC (step 10)

Scope: the backend as compose project `freightaudit-prod` (`infra/docker-compose.prod.yml`), reached from the internet
only through Tailscale Funnel; written 2026-10-17. Setup and every setting: `docs/deploy.md`.

## Assets

- The PC itself and everything else on it, other compose projects included.
- `API_KEYS`, the provider keys (`GEMINI_API_KEY`, `GROQ_API_KEY`), `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, all in
  `.env.prod`; the node's Tailscale login in the volume `freightaudit-prod-tailscale-state`.
- The free-tier quotas, shared with other projects and CI.

## Trust boundaries

1. Internet to Tailscale's Funnel relay to the tailscale container: anyone, HTTPS on 443 only.
2. Tailscale container to api: network `edge`, nothing else on it.
3. Api and worker to the stores: network `data`, internal, with no route out.
4. Worker and tailscale container to egress-proxy: network `outbound`, internal.
5. egress-proxy to the internet: network `egress`, the only routed one.

## Threats and mitigations

| Threat | Mitigation | Gap or residual risk |
| --- | --- | --- |
| Reaching anything on the PC but the api | No service publishes a host port. Windows does not join the tailnet; the tailnet node is the container, and the policy grants nothing to `tag:freightaudit`. The tailscale container is not on `data`. | Docker Desktop lets a container on a routed network reach the PC's own listeners at `host.docker.internal` (192.168.65.254): before the proxy, the worker reached the dev and FilingLens stores and Windows RPC 135 and SMB 445. Now only egress-proxy is on a routed network. It allows CONNECT on 443 to each client's hosts and refuses private destinations; from the worker and the tailscale container nothing on the PC answers, directly or through it (2026-10-17). The proxy container itself can still reach the PC. |
| Egress to arbitrary hosts | egress-proxy (`infra/squid.conf`): a port and an allowlist per client, each port served only to its client's fixed address on `outbound` (the worker 10.231.231.2 on 3128, tailscale 10.231.231.3 on 3129), so a compromised worker cannot use tailscale's way out to Tailscale's servers and a tunnel through someone else's tailnet; no IP literals (`dstdomain -n`), no plain HTTP, no cache. | The tailscale allowlist is confirmed only up to login; Let's Encrypt and the relays are checked on the first real start (`docs/deploy.md`). |

Accepted risks:
- Squid itself can reach the PC, because it has to sit on a routed network. It is the only container there, publishes no
  host port, takes connections only from `outbound`, and refuses private destinations.
- An allowlist of large API services cannot stop a determined attacker from sending data out through those same
  services. The proxy's goal is protecting the PC and the other projects, which the reachability probe proves.
| Unauthenticated api use | Every route but `/healthz` and `/readyz` needs a 256-bit `X-API-Key`, checked before the body is read. | The probes are public; they return check names and ok/fail only. |
| Probe floods | `/readyz` answers from a 2 s cache, so a flood opens no backend connections; Funnel's bandwidth limits apply. | Neither probe is rate limited. |
| A browser calling the api | A request carrying an `Origin` header gets 403; Yoga sends no CORS headers; every response carries `default-src 'none'`, `frame-ancestors 'none'`, nosniff, CORP same-origin, no referrer, HSTS. | None known. |
| Real documents reaching the PC or the free-tier models | The api accepts only files whose SHA-256 is in the golden-set manifest (`UPLOAD_ALLOWLIST`), checked before parsing or storing, whoever holds the key. | None known. |
| Draining quotas or credit | `DAILY_AI_TOKEN_BUDGET` 100,000 tokens a day; 10 uploads a minute per key; each golden PDF is extracted once (content hash). No paid model or key on the demo. | A key holder can spend the day's budget; uploads then wait until 00:00 UTC. |
| A compromised api or worker container | Runs as `node` with a read-only root filesystem, all capabilities dropped and `no-new-privileges`; the api has no internet route; each service gets only its own settings. | The worker reaches only the Gemini and Groq hosts, through the proxy. |
| Secrets in git, images or logs | `.env.prod` and `backups/` are gitignored, `.env*` and `backups` are out of the Docker build context, gitleaks runs before commits; `scripts/demo.ts` prints no secret. | A user can still paste a secret elsewhere. |
| Losing the node's login | The state volume is external, so `down -v` cannot delete it. | A deleted volume needs a new auth key and a new certificate. |
