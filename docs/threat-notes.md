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
| Missing authorization | `proxy.ts` sends requests without a valid cookie to `/login` (or 401 for `/api/`) as a first pass; every live page, server action and route handler checks the session again. | The proxy is optimistic by design; the per-handler checks are the control. A server action runs even when its request gets past the proxy without a session (shown on 2026-10-18), so each action checks the session before reading anything (`upload` and `uploadSample` since PR C1). How it gets past (2026-10-22, re-bills PR 3): the proxy's 307 sends the action's POST to `/login`, which runs any action its page carries, and `components/client.tsx` calls every action, so every page carries them all. |
| CSRF | SameSite=Lax cookie, and every state change is a server action: Next.js aborts a server action whose Origin does not match the Host. | None known. |
| Password guessing | argon2id (m=19456, t=2, p=1) from `node:crypto`; 5 failed attempts per 15 minutes per client lock sign-in, and a success clears the count. | The count is in memory per server instance: on Vercel each instance counts on its own (user decision; a hosted Redis such as Upstash closes it). The client is the first `x-forwarded-for` entry on Vercel and one shared bucket elsewhere, where the server binds 127.0.0.1. |
| Open redirect after sign-in | `next` must be a path that starts with one `/` (not `//` or `/\`); anything else goes to `/invoices`. e2e covers `//evil.example`. | None known. |
| Clickjacking | `Content-Security-Policy: frame-ancestors 'none'` on every response. | None known. |
| MIME sniffing, referrer leaks | `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`. | None known. |
| Data leak through the public sample | `/demo` serves static JSON and PDFs only. Visitors never cause an api call: the demo layout probes the api only for a signed-in user. There are no actions or upload there, and server actions refuse while the backend is offline. `demo:export` refuses an invoice whose content hash is in no golden manifest, so only synthetic invoices can be published. | Whoever runs the export decides which golden invoices are public. |
| Error and log leaks | GraphQL errors are masked (`maskError` logs only name and code; Yoga's own logging is off). The api and worker log database errors by code, never Drizzle's message with its bound values. The web logs JSON lines without passwords, cookies, keys or document values. | None known. |
| Upload abuse | Size (4 MiB), type by magic bytes (PDF, PNG, JPEG) and image size (10,000 px a side, 25 megapixels) are checked in the browser, again in the server action and again in the api; the api also counts PDF pages (20 at most). Per-key rate limits (10 uploads a minute) and the extract backlog's 503 still apply. Since re-bills PR 3 the upload page also counts a PDF's pages and, on the demo, compares the file's SHA-256 with `uploadAllowlist`, and sends only files with nothing against them, one at a time; these only warn, and the server action and the api still decide. | All UI users share one key's limits. |
| Audit tampering | `audit_events` is append-only: a trigger refuses UPDATE and DELETE. A reviewer action writes its row in the same transaction as the change. | A database owner can still drop the trigger. Invoices processed before migration 0013 have only their Received entry. |
| Document access | The document route needs the session, checks the id as a UUID and streams the PDF through the api with the server's key, so the tenant scope applies. Responses are `Cache-Control: private, no-store` (since PR #21), and sign-out sends `Clear-Site-Data: "cache"`. | None known. |
| One-tap sample abuse (UI round 1) | `uploadSample` takes only a sample key from a fixed list, never a path or URL, and reads the file from the server's own `public/samples/`. It checks the session before it looks the key up or reads the file (PR C1; before, a sessionless request could make it read and hash a sample), then needs the live backend; Next's origin check guards server actions; the file passes the same `checkUpload` as a chosen file, and the demo api still accepts only golden-set files. The Idempotency-Key is `sample-<sha256>`, so a repeat inserts no key row, and the content hash finds the same invoice, so each sample runs the model once per database. The api's 10 uploads a minute per key answer 429 with Retry-After, shown under the button. | A repeat tap costs one MinIO write of identical bytes and one of the 10 shared upload slots a minute. |
| A bulk decision on a stale or forged page (UI round 1) | `decideInvoice` runs in one transaction that locks the invoice first, compares every finding's id and version with the `seen` list the page sent, and refuses any difference with CONFLICT, writing nothing; the page then offers a reload. The action parses `seen` and the decision and passes only well-formed values; the api checks them against the database, so a forged list can only be refused. The `requestId` is a UUID made when the page rendered, stored as `decide:<DECISION>:<requestId>`, so a retry writes nothing and the same id on another invoice is refused. Each button asks first through a native confirm. | None known. |
| A paid Anthropic key on the demo PC (Claude-first, 2026-10-21) | The key lives only in `.env.prod` (and the root `.env` for the local eval), and compose hands it to the worker alone; `evals/harness/no-claude-in-ci.test.ts` fails if another service, a workflow or turbo gets a Claude setting. Logs carry the reason and status only. Only the worker reaches `api.anthropic.com`, through squid. Spend is capped per call (560 out, 7,100 in, never 100,000), per invoice (8,500) and per UTC day (`DAILY_CLAUDE_TOKEN_BUDGET`, reserved before each call), ends with 2026-11-10, and the console's monthly limit stops it beyond that. A key leaked from the PC is bound only by that console limit: rotate it (docs/deploy.md). |
| PDF parsing in the browser (UI round 1) | pdf.js is pinned to exactly 6.4.299, which has no `isEvalSupported` option. `apps/web/lib/pdfjs.test.ts` fails if the pin and the installed version differ, if `build/pdf.mjs`, `build/pdf.min.mjs` or `build/pdf.worker.min.mjs` holds `eval(` or `new Function(`, or if any app file imports the scripting sandbox (`pdf.sandbox`, whose build holds one `eval(`) or the viewer (`pdfjs-dist/web`), or mentions `enableScripting`. Documents come only from the web's own document route, the sample, or since re-bills PR 3 a file the reviewer picks on the upload page, which pdf.js reads in their own tab to count its pages and draw its first page before anything is sent. A Dependabot bump fails the pin test until someone re-checks the new build and moves the pin. | A parser bug in pdf.js itself could still affect the viewer's tab, or the upload page's with a file the reviewer chose. |

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
| Egress to arbitrary hosts | egress-proxy (`infra/squid.conf`): a port and an allowlist per client, each port served only to its client's fixed address on `outbound` (the worker 10.231.231.2 on 3128, tailscale 10.231.231.3 on 3129), so a compromised worker cannot use tailscale's way out to Tailscale's servers and a tunnel through someone else's tailnet; no IP literals (`-n` on every host rule), no plain HTTP, no cache. | The tailscale allowlist was confirmed on the first real start (2026-10-18). Tailscale's relays are allowed by one pattern (`^derp[0-9]+[a-z]*[.]tailscale[.]com$`). A compromised tailscale container could send data to any Tailscale node through a relay; allowing fewer relay names would not prevent that, since any relay forwards to any node connected to it. |

Accepted risks:
- Squid itself can reach the PC, because it has to sit on a routed network. It is the only container there, publishes no
  host port, takes connections only from `outbound`, and refuses private destinations.
- An allowlist of large API services cannot stop a determined attacker from sending data out through those same
  services. The proxy's goal is protecting the PC and the other projects, which the reachability probe proves.
| Unauthenticated api use | Every route but `/healthz` and `/readyz` needs a 256-bit `X-API-Key`, checked before the body is read. | The probes are public; they return check names and ok/fail only. |
| Probe floods | `/readyz` answers from a 2 s cache, so a flood opens no backend connections; Funnel's bandwidth limits apply. | Neither probe is rate limited. A scanner's burst on 2026-10-21 (1,275 requests for paths such as `/.env` in 3 minutes, each answered 401 in under 1 ms) slowed the node's one relay path enough to fail `pnpm demo:up`'s 10 s public check twice. |
| A browser calling the api | A request carrying an `Origin` header gets 403; Yoga sends no CORS headers; every response carries `default-src 'none'`, `frame-ancestors 'none'`, nosniff, CORP same-origin, no referrer, HSTS. | None known. |
| Real documents reaching the PC or the free-tier models | The api accepts only files whose SHA-256 is in the golden-set manifest (`UPLOAD_ALLOWLIST`), checked before parsing or storing, whoever holds the key. | None known. GraphQL's `uploadAllowlist` (re-bills PR 1) shows a key holder those digests so the web can warn before sending; knowing them lets no other file pass, since a match needs the same bytes, and the golden PDFs are in the repository anyway. |
| Draining quotas or credit | `DAILY_AI_TOKEN_BUDGET` 100,000 tokens a day; 10 uploads a minute per key; each golden PDF is extracted once (content hash). Since #40 (live 2026-10-21) Claude Haiku reads first on its own `DAILY_CLAUDE_TOKEN_BUDGET` (1,400,000), reserved before each call (the paid-key row above). | A key holder can spend the day's budget; uploads then wait until 00:00 UTC. |
| A compromised api or worker container | Runs as `node` with a read-only root filesystem, all capabilities dropped and `no-new-privileges`; the api has no internet route; each service gets only its own settings. | The worker reaches only the Gemini and Groq hosts, through the proxy. |
| Secrets in git, images or logs | `.env.prod` and `backups/` are gitignored, `.env*` and `backups` are out of the Docker build context, gitleaks runs before commits; `scripts/demo.ts` prints no secret. | A user can still paste a secret elsewhere. |
| Losing the node's login | The state volume is external, so `down -v` cannot delete it. | A deleted volume needs a new auth key and a new certificate. |
