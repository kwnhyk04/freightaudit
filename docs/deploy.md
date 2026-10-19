# Deploy

The UI runs on Vercel (Hobby, free). The backend runs on this PC as compose project `freightaudit-prod`, and the
internet reaches only its api, through Tailscale Funnel. When the PC is off or asleep, the UI shows the committed sample
(`apps/web/public/demo`), so the public demo never shows an error page. Everything stays on free plans.

```
Browser --HTTPS--> Vercel: apps/web (sessions, the BFF) --HTTPS + X-API-Key--> https://<host>.<tailnet>.ts.net
                                                                                 Tailscale's Funnel relay (TCP only)
This PC, project freightaudit-prod:                                              |
  tailscale container (TLS ends here) --network edge--> api:4000  <--------------+
  api, worker --network data (no route out)--> postgres, redis, minio
  worker    --network outbound (no route out)--> egress-proxy:3128 --network egress--> Gemini, Groq
  tailscale --network outbound (no route out)--> egress-proxy:3129 --network egress--> Tailscale, Let's Encrypt
```

The egress proxy (squid, `infra/squid.conf`) is the only container with a route out. Docker Desktop lets any container
on a routed network reach the PC's own listeners at `host.docker.internal` (192.168.65.254), Windows file sharing
included, so the worker and the tailscale container sit on the internal network `outbound` and reach the internet only
through it. It accepts HTTPS CONNECT on port 443 alone, refuses every loopback, private, link-local and CGNAT
destination (by each address a name resolves to) before its allowlists, caches nothing and publishes no port. CI builds it
from `infra/squid/Dockerfile`: `ubuntu:24.04` by digest plus Ubuntu's newest squid from noble-security, and the build
fails below 6.14-0ubuntu0.24.04.4 (6.14-0ubuntu0.24.04.4 on 2026-10-17). Dependabot's weekly base-digest update rebuilds
it with new fixes; reviewing such an update includes the package check in the new image:
`docker run --rm --entrypoint dpkg-query ghcr.io/kwnhyk04/freightaudit-squid:<tag> -W squid`. Each client has its own port and allowlist, and each port
serves only its client's fixed address on `outbound` (subnet 10.231.231.0/28: the worker .2, tailscale .3, any other
container .8 to .15), so a compromised worker cannot borrow tailscale's way out:

| Port | Client | Allowed hosts | Evidence (squid's access log) |
| --- | --- | --- | --- |
| 3128 | worker | `generativelanguage.googleapis.com`, `api.groq.com` | 2026-10-17: a Gemini extraction tunnelled through it; Groq answered CONNECT. 2026-10-18: the public sample's Gemini and Groq calls |
| 3129 | tailscale | `controlplane.tailscale.com`, `log.tailscale.com`, `acme-v02.api.letsencrypt.org`, and the relays by the pattern `^derp[0-9]+[a-z]*[.]tailscale[.]com$` | 2026-10-17, before login: the first two only. 2026-10-18, first start with a login: all three, and 87 relay names in 28 regions, denied until the pattern was added; no bare IP |

With no UDP route out, tailscale's traffic, Funnel's included, goes through Tailscale's relays (DERP). tailscaled measures
every region's relays over HTTPS through the proxy to choose its home relay, so port 3129 allows them all by one pattern.

## Real setup, after this branch merges

1. Remove the dry run's data volumes, which were created with placeholder passwords. Exact names only; never prune, and
   touch no other project's volumes:
   ```powershell
   docker volume ls --filter name=freightaudit-prod
   docker volume rm freightaudit-prod_postgres-data freightaudit-prod_minio-data
   docker volume ls --filter name=freightaudit-prod
   ```
   The second list must still show `freightaudit-prod-tailscale-state` and nothing else of this project.
2. The one-time setup below, with `IMAGE_TAG` left at `latest` once release.yml has published this branch's images,
   the CI-built squid image `freightaudit-squid` among them (the earlier images lack `--if-empty`, the upload
   allowlist and the empty `MOCK_TMS_URL`, and no squid image existed).
3. On the first `pnpm demo:up` with a login, read the proxy's denials and confirm the tailscale allowlist:
   `docker logs freightaudit-prod-egress-proxy-1 | Select-String TCP_DENIED`. If tailscaled asks to CONNECT to a bare
   IP address, do not allow it; report it. Done on 2026-10-18: only relay names were denied, never a bare IP, so
   `infra/squid.conf` allows the relays by one pattern. After any edit of `infra/squid.conf`, run
   `docker restart freightaudit-prod-egress-proxy-1`, which reads the mounted file again and needs no `.env.prod`; on
   later starts the command above should list no new denial.

## One-time setup

Run every command in your own terminal, not through `!` in a Claude Code chat; none of them prints a secret.

### Tailscale (free Personal plan)

1. Sign up at login.tailscale.com. Do not install Tailscale on Windows: the container is the only device.
2. DNS page: keep MagicDNS on and enable HTTPS Certificates. Rename the tailnet first if you like; its name is part of
   the public URL.
3. Access controls: replace the policy file with the one below. Nothing on the tailnet can reach the demo node, the node
   can reach nothing, and only it may use Funnel.
   ```json
   {
     "tagOwners": { "tag:freightaudit": ["autogroup:admin"] },
     "grants": [{ "src": ["autogroup:member"], "dst": ["autogroup:self"], "ip": ["*"] }],
     "nodeAttrs": [{ "target": ["tag:freightaudit"], "attr": ["funnel"] }]
   }
   ```
4. Settings, Keys, Generate auth key: reusable off, ephemeral off, expiry 1 day, tag `tag:freightaudit`. It goes into
   `.env.prod` as `TS_AUTHKEY`. If an old device is already named `freightaudit`, delete it first, or the new node gets
   `freightaudit-1` and the URL changes.

### This PC

1. Docker Desktop, Settings, General: "Start Docker Desktop when you sign in to your computer", so the demo returns
   after a reboot once you sign in. Give Docker at least 4 GB of memory.
2. `pnpm demo:init` writes `.env.prod` from `.env.prod.example`, with random `API_KEYS`, `POSTGRES_PASSWORD` and
   `MINIO_ROOT_PASSWORD`. Set `GEMINI_API_KEY`, `GROQ_API_KEY` and `TS_AUTHKEY` in it with an editor.
3. `pnpm --filter @freightaudit/web hash-password --write-env` asks for the demo password twice without echoing it and
   writes only `DEMO_PASSWORD_HASH='<argon2id hash>'` into the root `.env`.
4. `pnpm demo:up` prints the Funnel URL once it answers from the internet (a new name can take 10 minutes). Delete
   `TS_AUTHKEY` from `.env.prod` afterwards: the login stays in the volume `freightaudit-prod-tailscale-state`.
5. `pnpm db:reset-demo` loads the sample invoices.

### Vercel (Hobby, free)

1. Sign up with GitHub and install the Vercel GitHub App on `kwnhyk04/freightaudit` only. Do not start a Pro trial.
2. New project from the repository: Root Directory `apps/web`, framework Next.js. Leave the build, install and output
   commands at their defaults. `apps/web/vercel.json` lets only main deploy (`git.deploymentEnabled`, see below).
3. Environment variables, Production only (the table below), before the first deploy. Mark `API_KEY`, `SESSION_SECRET`
   and `DEMO_PASSWORD_HASH` Sensitive. Clipboard commands for PowerShell, which print nothing:
   ```powershell
   ((Get-Content .env.prod | Where-Object { $_ -like 'API_KEYS=*' }) -replace '^API_KEYS=' -split ',')[0] | Set-Clipboard
   node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" | Set-Clipboard
   (Get-Content .env | Where-Object { $_ -like 'DEMO_PASSWORD_HASH=*' }) -replace "^DEMO_PASSWORD_HASH='|'$" | Set-Clipboard
   Set-Clipboard -Value ' '
   ```
4. Settings, Build and Deployment: keep "Include files outside the root directory in the Build Step" on.
5. Settings, Functions, Function Region: Hong Kong (`hkg1`).
6. Settings, Deployment Protection: keep Standard Protection, which leaves the production domain public and puts
   previews behind a Vercel login. Settings, Security: keep Git Fork Protection on. Firewall: one rate-limit rule on
   `POST /login`, about 10 a minute per IP.
7. After the first deploy, check the runtime logs for "crypto.argon2 needs Node 24.7" (see Troubleshooting).
8. Share only the domain listed as Production under Settings, Domains. Under Standard Protection the URLs Vercel
   generates redirect to its login: on 2026-10-18 the deployment's own `freightaudit-<hash>-<scope>.vercel.app` and
   `freightaudit-<scope>.vercel.app` both did. `freightaudit.vercel.app` belongs to another project.
9. Signed in on that domain, open Invoices. The web's `GET /readyz` and `POST /graphql` must then appear in
   `docker logs freightaudit-prod-api-1`; with neither, the web never reached the api (see Troubleshooting).

Only main deploys. `apps/web/vercel.json` sets `git.deploymentEnabled` to `{"**": false, "main": true}`:
- Vercel matches branch names with minimatch, and `**` also covers names with slashes (`fix/...`, `dependabot/...`).
- A branch that matches several rules deploys when one of them is `true` (Vercel's Git configuration docs).

This replaced an `ignoreCommand` of `[ "$VERCEL_ENV" != production ]`. That command canceled the pushes of #20 and #21 to
main ("Canceled by Ignored Build Step"), although the Production environment tracks main and system variables are
exposed. Why is still unknown; #21 went live only through a redeploy with "Use project's Ignore Build Step" unticked.

After a merge, confirm:
- GitHub's status for the merge commit (`https://api.github.com/repos/kwnhyk04/freightaudit/commits/<sha>/status`) shows
  the Vercel context with a completed deployment, reached without a manual redeploy.
- The pull request's head commit has no Vercel status, and Vercel lists no deployment for its branch.
- A route the change touched answers the new way on the production domain.

### GitHub

Nothing to add. The release workflow publishes the images; nothing deploys from CI, and no deploy secret exists.

## Every variable

| Variable | Where | What | Rotate |
| --- | --- | --- | --- |
| `API_KEYS` | `.env.prod` | Keys the api accepts, comma-separated, 32+ characters | Append a new key, `pnpm demo:up`, set Vercel's `API_KEY` to it and redeploy, then drop the old key and `pnpm demo:up` again |
| `API_KEY` | Vercel | The web's key, one of `API_KEYS` | As above |
| `SESSION_SECRET` | Vercel (and root `.env` for dev) | Signs session cookies, 32+ characters | New value, redeploy; everyone is signed out |
| `DEMO_PASSWORD_HASH` | Vercel (and root `.env`) | argon2id hash of the reviewer's password | `hash-password --write-env`, copy to Vercel, redeploy |
| `API_URL` | Vercel | The Funnel URL `pnpm demo:up` prints | Changes only with `TS_HOSTNAME` or the tailnet name |
| `AI_ENABLED` | Vercel `true`; `.env.prod` `true` | Web: live pages or the sample. Worker: model calls on or off | Redeploy, or `pnpm demo:up` |
| `ENABLE_EXPERIMENTAL_COREPACK` | Vercel `1` | Builds with pnpm 12.11.2 from `packageManager` | None |
| `GEMINI_API_KEY`, `GROQ_API_KEY` | `.env.prod` (demo keys); GitHub secrets (CI eval only) | Free-tier model keys | New key in the console, `pnpm demo:up`, delete the old key |
| `DAILY_AI_TOKEN_BUDGET` | `.env.prod`, default 100,000 | Tokens a UTC day across all models | Edit, `pnpm demo:up` |
| `POSTGRES_PASSWORD` | `.env.prod` | Demo database password (used once, when the volume is created) | `ALTER USER freightaudit PASSWORD '<new>'` in the container, edit `.env.prod`, `pnpm demo:up` |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | `.env.prod` | Demo object store credentials | Edit, `pnpm demo:up` |
| `TS_AUTHKEY` | `.env.prod`, first start only | One-off Tailscale auth key | Expires in a day; a new login needs a new key |
| `TS_HOSTNAME` | `.env.prod`, default `freightaudit` | First label of the public URL | Changing it changes `API_URL` |
| `IMAGE_REPO`, `IMAGE_TAG` | `.env.prod` | Which CI-built images run; `latest` or `sha-<7 hex>` | Edit, `pnpm demo:up` |
| `TENANT_ID`, `LOG_LEVEL` | `.env.prod` | The seeded tenant; log level | None |
| `UPLOAD_ALLOWLIST`, `MOCK_TMS_URL`, `OTEL_SDK_DISABLED`, `EXTRACT_CONCURRENCY` | set by `infra/docker-compose.prod.yml` | Golden-only uploads; no TMS sync; no telemetry; one document read at a time (`1`) | Change the compose file |

Never on the PC's demo or Vercel: `ANTHROPIC_API_KEY`, `LLM_CLAUDE_MODEL` (the demo runs on free tiers only), and any
`NEXT_PUBLIC_` variable.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm demo:init` | Creates `.env.prod` with random secrets; refuses if it exists |
| `pnpm demo:up` | Pulls the images, starts the stores, migrates and seeds an empty database, starts the api, worker and tailscale container, then checks the public URL (`/healthz` 200, no key 401) |
| `pnpm demo:down` | Stops and removes the containers; data and the node's login stay |
| `pnpm db:backup` | `pg_dump` of the demo database into `backups/freightaudit-<UTC>.dump` (gitignored) |
| `pnpm db:reset-demo` | Backup, then a fresh database, queues and object store, the seed, and the sample's 11 golden invoices sent through the live pipeline |

Restore a backup (stop the api and worker first):
```powershell
docker compose --env-file .env.prod -f infra/docker-compose.yml -f infra/docker-compose.prod.yml cp backups/<file>.dump postgres:/tmp/restore.dump
docker compose --env-file .env.prod -f infra/docker-compose.yml -f infra/docker-compose.prod.yml exec postgres pg_restore -U freightaudit -d freightaudit --clean --if-exists /tmp/restore.dump
```

## What is reachable

No service of `freightaudit-prod` publishes a host port, and Windows does not join the tailnet.

| Where | Port | Reachable from | Why |
| --- | --- | --- | --- |
| `https://<host>.<tailnet>.ts.net` | 443 | the internet, through Tailscale's Funnel relays | The only public entry. TLS ends in the tailscale container, which proxies to the api. Every route but `/healthz` and `/readyz` needs `X-API-Key`; a request with a browser `Origin` header gets 403. |
| Network `edge` (internal) | api 4000 | the tailscale container | Funnel's target |
| Network `data` (internal) | postgres 5432, redis 6379, minio 9000, api 4000, worker 4001 | the app containers and stores | App traffic; no route out |
| Network `outbound` (internal) | egress-proxy 3128 and 3129, worker 4001 (probes) | the worker, the tailscale container | Their only way out |
| Network `egress` | none | only egress-proxy is on it | The proxy's route to the internet |
| tailscale container | 9002 on its loopback | that container | Its health check |

Measured in the dry run (2026-10-17), on every port of 5432, 6379, 9000, 9001, 4000, 4001, 4010, 3000, 4100, 5433,
5672, 15672, 6380, 135, 445, 3389 and 443:
- From the worker and the tailscale container, `host.docker.internal` does not resolve and 192.168.65.254 is
  unreachable.
- Through the proxy, a CONNECT to either one is refused with 403 on both ports, for example `host.docker.internal:445`
  and `192.168.65.254:443`. A bare public IP, a host off the list, a plain GET and the other client's hosts are refused
  too.
- Each port serves only its own client: the worker gets 403 on 3129 (`controlplane.tailscale.com` included), tailscale
  gets 403 on 3128 (Gemini and Groq included), and another container on `outbound` gets 403 for everything on both.
- Before the proxy, the same probe reached dev and FilingLens stores and Windows RPC 135 and SMB 445.
- The proxy container itself is on `egress`, so it can reach 192.168.65.254. It takes connections only from `outbound`,
  and its rules refuse private destinations.

Uploads on the demo are limited to golden-set PDFs (`evals/golden/v1/manifest.json`), so only synthetic invoices reach
the PC and the free-tier models.

## Cost

Free plans only. What could ever bill you:
- Gemini: a key whose Google Cloud project has billing enabled runs on the paid tier.
- Groq: only after an upgrade to a paid tier with a card.
- Vercel Hobby: cannot bill; over its limits the project pauses for up to 30 days.
- Tailscale Personal: free; only add-ons bill (more than 50 tagged devices, Mullvad).
- GitHub: public repository, so Actions and public images are free.
- Anthropic: nothing from the demo, which holds no Anthropic key.

## Troubleshooting

- **The Funnel URL does not answer:** a new name takes up to 10 minutes to resolve. Check
  `docker compose --env-file .env.prod -f infra/docker-compose.yml -f infra/docker-compose.prod.yml logs tailscale`.
- **The node is logged out:** the volume `freightaudit-prod-tailscale-state` was deleted. Make a new auth key, set
  `TS_AUTHKEY`, run `pnpm demo:up`. Avoid this: each new login issues a new certificate, and Let's Encrypt limits them.
- **After editing `infra/tailscale/serve.json`:** restart the tailscale service; file changes on H: may not reach it.
- **Uploads stay Received:** the day's model budget is spent, or a provider quota is; extraction resumes at 00:00 UTC.
- **"crypto.argon2 needs Node 24.7" in Vercel's runtime log:** switch `apps/web/lib/password.ts` to `@node-rs/argon2`,
  which reads the same hashes (docs/todo.md).
- **The site shows "Live backend offline":** the PC is off or asleep, or `pnpm demo:down` ran; `pnpm demo:up` brings
  it back.
- **"Live backend offline" while the PC is up:** look for the web's `GET /readyz` in `docker logs freightaudit-prod-api-1`.
  The web asks only while its `AI_ENABLED` is `true`, at `new URL('/readyz', API_URL)`, and counts more than 2.5 s as
  offline (`apps/web/lib/server.ts`). On Vercel, check `AI_ENABLED` and that `API_URL` is exactly the Funnel URL, then
  redeploy: changed variables reach only new deployments.
