# Context

Current state of the project. Document only confirmed information. Update after meaningful technical or functional changes.

Source: design doc "Three AI-Native Portfolio Projects" (2026-10-13).

## Overview and Objectives

AI-native portfolio project showing document extraction plus deterministic reconciliation for freight invoice audit (logistics / accounts payable domain).

## Scope and Requirements

- Upload single invoices or batches of up to 500 PDFs (digital and scanned).
- LLM extraction of header fields and line items, with validation, one repair attempt, and escalation to the fallback model.
- Deterministic reconciliation against versioned rate cards and shipments synced from a mock TMS.
- Review UI for discrepancies.
- Must demonstrate: backpressure, retries, pagination, partial failures, schema migrations.

Targets (design goals, not yet measured):

| Metric | Target |
| --- | --- |
| Header field accuracy | 0.98 digital, 0.93 scanned |
| Line-item F1 | 0.95 digital, 0.88 scanned |
| Arithmetic consistency | 0.99 after repair |
| Overcharge precision / recall | 0.95 / 0.90 |
| Dollar recovery | 0.90 |
| False flag rate | 3% or lower |
| Escalation rate | 10% or lower |
| Extraction latency (3 pages or fewer) | p50 5 s, p95 12 s |
| End-to-end latency | p95 30 s |
| Throughput | 2,000 invoices/hour on 2 workers x concurrency 8 |
| Tokens per page (text path) | 4,000 input / 1,200 output |
| Cost per invoice | $0.02 digital, $0.05 scanned |

## Technical Stack

TypeScript (strict, ESM, current Node LTS), pnpm + Turborepo, Fastify, GraphQL Yoga, BullMQ, Redis, Postgres, Drizzle, MinIO, Next.js, Jest (projects unit, integration and contract; fast-check for property tests; Testcontainers for integration), OpenTelemetry, Docker, GitHub Actions.

LLM providers (switchable by env vars): Gemini Flash (free tier) primary, Groq for the digital-text path, Ollama for local runs. Deployment: UI on Vercel, backend on the PC via Tailscale Funnel.

Local ports (bound to 127.0.0.1; chosen so all three projects can run at once; compose project name `freightaudit`). Confirmed from `infra/docker-compose.yml` on 2026-10-14. Defaults shown; infra host ports come from the root `.env` (passed with `--env-file .env`), and api, worker and mock-tms read `API_PORT`, `WORKER_PORT` and `MOCK_TMS_PORT`. Collector, Jaeger, Prometheus and Grafana run only with the `observability` profile.

| Service | Host port |
| --- | --- |
| Postgres | 5432 |
| Redis | 6379 |
| MinIO API / console | 9000 / 9001 |
| api / worker / mock-tms | 4000 / 4001 / 4010 |
| web (Next.js) | 3000 |
| Grafana | 3001 |
| Jaeger UI | 16686 |
| Prometheus | 9090 |
| OTel Collector (gRPC / HTTP) | 4317 / 4318 |
| Toxiproxy API | 8474 (proxies 15432, 16379, 14010) |

Installed versions (2026-10-14): Node 24, pnpm 12.11, Turborepo 2.11, TypeScript 6.0, Fastify 5.12 with fastify-openapi-glue 4.11 and @fastify/multipart 10, GraphQL Yoga 5.24 with graphql 16, Next.js 16.4 with React 19.3, Jest 30 with swc, Testcontainers 12.2, fast-check 4.10, ESLint 10 with typescript-eslint 8 and graphql-eslint 4.4, openapi-typescript 7.13, openapi-fetch 0.17, graphql-codegen 7 (client preset 6), zod 4.6, gitleaks 8.30.1 (Docker image), drizzle-orm 0.45 with pg 8.23, @faker-js/faker 10.6, Playwright 1.64 (Chromium headless shell), sharp 0.35, BullMQ 6.3 with ioredis 5.11, @fastify/rate-limit 11.2, pdf-lib 1.17. The Gemini client is plain `fetch` and the S3 client is a small SigV4 signer, with no SDKs. The OpenTelemetry SDK is not installed yet.

## Architecture and System Design

Workspaces exist as skeletons (step 1). Behavior below is planned unless listed under Implemented Functionality.

1. `apps/api`: Fastify REST + GraphQL. Stores PDFs in MinIO by content hash, writes invoice rows, enqueues `extract`. Returns 503 with Retry-After while more than `EXTRACT_HIGH_WATER` (5,000) extract jobs wait.
2. `apps/worker`: BullMQ queues `extract`, `reconcile`, `tms-sync`, each with a `<name>-dlq` dead-letter queue.
3. `apps/mock-tms`: fake TMS with cursor pagination, 10 req/s rate limit, fault injection.
4. `apps/web`: Next.js review UI over GraphQL.
5. `packages/domain`: money, rate-card math, reconciliation. Pure functions.
6. `packages/llm` (provider layer, error taxonomy, PDF handling, AI limits), `packages/pipeline` (queues and job options, dead letters and replay, PDF object store; shared by api and worker), `packages/db`, `packages/contracts`, `packages/telemetry`, `evals/`.

Tooling: `packages/config` holds the shared tsconfig, ESLint and Jest presets plus the runtime env loader (`@freightaudit/config/env`). `packages/telemetry` holds the shared Fastify logging options and readiness checks. Packages build to `dist/` with `tsc`; apps run TypeScript directly in dev through Node type stripping. Local infrastructure lives in `infra/docker-compose.yml`; `infra/docker-compose.prod.yml` overrides it for the backend on the PC.

## Invoice Lifecycle

One status set in Postgres (`invoice_status`), REST (`InvoiceStatus`, lowercase) and GraphQL (`InvoiceStatus`, uppercase): received, extracting, extracted, reconciling, reconciled, needs_review, approved, failed (user decision, 2026-10-14). An invoice starts as received when the api stores a new PDF. The table lists every allowed move; the `check_invoice_transition` trigger (migration 0006) rejects any other update of `status`, whichever code writes it. Repeating the current status is allowed.

| From | To | When |
| --- | --- | --- |
| received | extracting | The extract worker starts the job. |
| extracting | extracted | Extraction passes validation, after at most one repair. |
| extracting | failed | Extraction used up its retries; the job moves to `dead_letters`. |
| extracted | reconciling | The reconcile worker starts the job. |
| reconciling | reconciled | The shipment matched and every line agrees with its rate card version. |
| reconciling | needs_review | At least one discrepancy is open. |
| reconciling | failed | Reconciliation used up its retries; the job moves to `dead_letters`. |
| reconciled | approved | `approveInvoice`. |
| needs_review | approved | `approveInvoice`, once every discrepancy is confirmed or dismissed. |
| failed | received | Replay of an `extract` dead letter. |
| failed | extracted | Replay of a `reconcile` dead letter. |

`approved` is final. A retried job keeps the current status, because jobs are idempotent (job id = content hash). Never sort by status: Postgres orders the enum `received, extracting, extracted, reconciling, needs_review, reconciled, approved, failed`, since values added by 0005 cannot move existing ones.

## Important Components

Built: the Postgres schema with versioned rate cards (`packages/db`), the seed, the eval fixture generator (`evals/fixtures`), the extract pipeline and TMS sync (`apps/worker`), the Postgres-backed REST api, the money and rate-card math (`packages/domain`), and the three Jest projects. Planned: reconciliation rules (the reconcile job is a stub), the Groq text path and fallback model, the eval harness.

## Implemented Functionality

- Monorepo: root scripts `dev`, `build`, `test`, `lint`, `typecheck`, `db:migrate`, `db:seed`, `fixtures`, `codegen`, `eval` run through Turborepo; `db:migrate`, `db:seed` and `fixtures` pass their arguments through (`turbo run <task> --`). `test:int` builds the packages through Turborepo, then runs the root Jest config.
- Database (`packages/db`): plain SQL migrations `0001_initial` (tenants, carriers, flat rate_cards, shipments, invoices, invoice_lines, discrepancies, idempotency_keys, dead_letters, tms_sync_state), then the rate card versioning series `0002` expand, `0003a` contract, `0003b` concurrent indexes and `0004` drop of `rate_cards.carrier_id`, then `0005`, which adds `reconciling` and `approved` to `invoice_status`, and `0006` (`extractions`, `invoices.parent_invoice_id`, the status-transition trigger); `docs/migrations.md` explains each step. Ids default to `uuidv7()`, money is `bigint` cents, a trigger maintains `updated_at`, and list tables have `(tenant_id, created_at DESC, id DESC)` keyset indexes. `rate_card_versions` has an exclusion constraint against overlapping `effective` ranges per carrier, and every invoice line references the version that priced it. `src/migrate.ts` applies the files (advisory lock, `lock_timeout` 5 s, no-transaction files, `--to`); `src/schema.ts` is the Drizzle query mirror of the final state.
- Seed (`pnpm db:seed --scale=small|large`): deterministic (`faker.seed(42)`) data for an empty, migrated database, in one transaction. Small is 1 tenant, 6 fictional carriers, 5,000 shipments and 500 invoices (1,488 lines, 137 discrepancies, about 1 s); large is 50,000 shipments and 20,000 invoices (58,192 lines, 5,345 discrepancies, about 20 s). Each carrier gets two rate card versions with a rate increase on 2026-01-01, and lines bill the version in force on the ship date. Invoices cover all 8 statuses and follow the lifecycle: needs_review invoices carry an open rate mismatch, uncontracted or duplicate charge, and some approved ones carry a finding a reviewer confirmed or dismissed.
- Backfill (`pnpm --filter @freightaudit/db backfill:rate-card-versions`): between 0002 and 0003a it creates version 1 per carrier from the flat rates and fills `rate_card_version_id` in batches of 2,000 with `lock_timeout` 3 s, retries, JSON progress logs and an exit code of 1 while rows remain.
- Tests: three Jest projects from `@freightaudit/config/jest`, all listed in the root `jest.config.js`.
  - `unit` (`*.test.ts`) runs per package through `pnpm test`, cached by Turborepo. `jest-no-io.js` makes a socket connect, server listen or process spawn throw, so unit tests do no I/O. `packages/domain` collects coverage and fails below 90 % on branches, functions, lines and statements (100 % now). Its fast-check properties run 1,000 cases each from seed 42: rounding stays within half a unit, rounds halves away from zero, is symmetric, never decreases and is exact on multiples; each extra mile costs its band's rate, splitting a band changes no price, the linehaul is the mileage charge or the minimum whichever is higher, the fuel surcharge is within half a cent of its percentage, and charges never fall as distance grows. For reconciliation: the version in force contains the ship date, an invoice billing exactly the contract reconciles, each overbilled line is one rate mismatch while underbilled lines pass, an uncontracted charge and a repeated or earlier-billed code are flagged once each.
  - `integration` (`*.int.test.ts`) and `contract` (`*.contract.test.ts`) run together through `pnpm test:int`. A `globalSetup` (`jest-containers.js`) starts Postgres 18, Redis, MinIO and Toxiproxy with Testcontainers, from the images the compose file pins, published on 127.0.0.1 only, and sets `DATABASE_URL`, `REDIS_URL`, `S3_*` and `TOXIPROXY_*` for the run; `globalTeardown` removes them. Ryuk is off; each container carries the pid of its run in the `freightaudit.test-run` label, and a run first removes containers whose run died, chosen by that label alone: Docker's label filter, then `staleTestContainers` (`jest-orphans.js`), whose unit test feeds it other projects' containers. Tests read settings through `testEnv` (`@freightaudit/db/testing`), which fails instead of falling back to dev services, and isolate themselves with a throwaway database, a random Redis key prefix and their own bucket. Models are a local fake Gemini server, never a real provider.
  - Integration suites: db migrations from empty with Drizzle drift (columns and enum labels), the exclusion constraint, the status trigger and the small seed on the final schema; the expand/backfill/contract path under the api's own handlers (`apps/api/src/expand-contract.int.test.ts`, see `docs/migrations.md`); keyset pagination of `/v1/invoices` over 300 rows within 100 µs, with ties, while uploads and late rows are inserted concurrently (no duplicates, no gaps, strict order); a 50-file batch with 5 corrupt files (45 accepted, each with its row, object and extract job; 5 rejected with 415 Problem Details and none of them); rate limits, backpressure and input limits; the real api process, including its config error exit; the worker's retries, dead letters and replay, sweep, budget guard (a fake `Date` pinned at noon UTC, so the day cannot roll over mid-test), multi-invoice split, a SIGKILLed worker process, the TMS sync, and the TMS sync through Toxiproxy with 20 % `reset_peer` and 300 ms latency against the real mock-tms, which closes every connection so each page meets the resets; the Gemini provider against a local server; the token bucket on a fake clock, and the daily budget; MinIO storage; and fixture determinism (renders the 6 templates twice and compares SHA-256 digests of all 24 files; needs the Playwright Chromium).
  - The `contract` suite (`apps/api/src/openapi.contract.test.ts`) is described under api below.
  - On this PC, `pnpm test` takes 8 to 9 s with forced builds (35 tests); `pnpm test:int` takes 14 to 16 s (41 tests, Jest about 10 s).
- Eval fixtures (`pnpm fixtures [--count=60] [--seed=42]`): synthetic invoices rendered through 6 HTML templates (classic, ledger, modern, remit, compact, boxed) to PDF with Playwright, each with ground-truth JSON beside it, plus scanned variants (192 dpi raster, up to 2 degrees of tilt, noise and blur with sharp, as image-only PDFs). The same seed gives byte-identical files: scan noise comes from an AES-CTR keystream keyed by the seed, and each PDF's `/CreationDate` and `/ModDate` are pinned to the invoice date. The generator fails if a template does not print the carrier, invoice number, PRO, line amounts or total.
- `GET /healthz` returns `{"status":"ok"}` on api (:4000), worker (:4001), mock-tms (:4010) and web (:3000). `GET /readyz` returns `{status, checks}`: 200 when every dependency is reachable, 503 naming the failed one. api checks Postgres and Redis by TCP connect and MinIO through `/minio/health/live`; worker checks Postgres and Redis; mock-tms and web have no dependencies. Each check times out after 2 s.
- Config: api, worker and mock-tms load their settings through `loadEnv` (zod). A missing or invalid value prints every problem to stderr, naming the variable but never its value, and exits with code 1. Defaults: `HOST=localhost`, `LOG_LEVEL=info`, ports 4000, 4001 and 4010.
- Auth: every api route except `/healthz` and `/readyz`, including `/graphql` and unknown paths, requires `X-API-Key` matching one of `API_KEYS` (comma-separated, at least 32 characters each). The check runs in `onRequest`, before body parsing, and answers 401 Problem Details.
- Logs: api, worker and mock-tms write pino JSON lines at `LOG_LEVEL` with a UUID `reqId` per request; `authorization`, `cookie` and `x-api-key` headers and `apiKey` fields are redacted at the top level and one object deep.
- Secrets: `.githooks/pre-commit` runs gitleaks on staged changes (local binary, otherwise the pinned Docker image); `pnpm install` sets `core.hooksPath` through the root `prepare` script.
- Web dev server binds 127.0.0.1 only.
- Contracts (spec-first, `packages/contracts`): `openapi.yaml` (OpenAPI 3.1) defines `POST /v1/invoices` (multipart PDF, required `Idempotency-Key`, 202 new or 200 existing by content hash), `POST /v1/invoice-batches` (up to 500 files, per-file `accepted | duplicate | rejected` results), `GET /v1/invoices` and `GET /v1/discrepancies` (`limit` 1 to 100, default 25, opaque `cursor`, `{items, next_cursor}`), `GET /v1/invoices/{id}`, `POST /v1/dead-letters/{id}/replay`, `/healthz` and `/readyz`. An `ApiKey` scheme (`X-API-Key` header) applies to every operation except the two probes; the secured operations document 401 and 403. Errors are RFC 9457 Problem Details; 429 documents `RateLimit-Limit`, `RateLimit-Remaining` and `Retry-After`, and 503 documents `Retry-After`. `schema.graphql` defines the review UI types (Invoice, LineItem, Shipment, RateCardVersion, Discrepancy), Relay connections for invoices and discrepancies, and the `resolveDiscrepancy` and `approveInvoice` mutations; `operations/` holds the UI operations.
- Codegen: openapi-typescript types plus an openapi-fetch client (`createApiClient`), graphql-codegen resolver types (exported from `@freightaudit/contracts`) and client-preset typed documents (`@freightaudit/contracts/graphql`). `pnpm contracts:check` fails on stale generated code; `pnpm contracts:breaking` runs oasdiff against `origin/main`.
- api: fastify-openapi-glue registers every REST route from `openapi.yaml` and validates requests against it; each multipart file is read (at most 10 MiB), checked (`%PDF-` magic, readable by pdf-lib, at most 20 pages; else 413 or 415, per file in a batch), stored in MinIO under its SHA-256 and validated as that digest. Handlers use Postgres: an upload inserts the invoice (unique per tenant and hash), records the Idempotency-Key and adds an `extract` job whose id is the hash; lists use keyset cursors (`created_at` to the microsecond plus `id`, base64url JSON); replay calls `replayDeadLetter`. Before the body is read, an `onRequest` chain checks the API key, then sheds uploads with 503 and `Retry-After: 30` while the extract backlog (waiting plus delayed jobs, since the budget guard parks jobs in delayed) is above `EXTRACT_HIGH_WATER`, then rate-limits per key digest in Redis (@fastify/rate-limit, draft RateLimit headers): 60 requests a minute, and a separate 10 a minute for the two upload routes. `requestTimeout` is 30 s. GraphQL Yoga serves the full schema at `/graphql`, but only the `health` query has a resolver. `openapi.contract.test.ts` (the contract project) calls every REST operation through the typed client against a throwaway database and validates each response against the spec, including 401 for every secured operation.
- Worker (`apps/worker`): `extract` (concurrency 8), `reconcile` (8) and `tms-sync` (1) workers share one Redis connection, a 60 s lock (`JOB_LOCK_MS`), stalled checks every half lock, `maxStalledCount` 1 and the `jittered` backoff (exponential from 2 s, capped at 60 s, full jitter, never below an error's Retry-After); jobs have 5 attempts. An extract job loads the invoice, delays itself with `moveToDelayed` until the next UTC midnight once the day's token budget is spent (5 minutes while `AI_ENABLED=false`), moves it to extracting, reads the PDF from MinIO, calls the model through the token bucket, validates with one repair, then saves one `extractions` row and the header fields in one transaction and queues `reconcile`. Rerunning it at any point writes nothing twice (status guards, unique `invoice_id`). A PDF holding several invoices is split by `first_page` into per-invoice PDFs and invoice rows (`parent_invoice_id`); a FlowProducer adds a `collect` parent with one child extract job per part (`ignoreDependencyOnFailure`), and the parent records each part's outcome in the upload's extraction row and marks it extracted. `reconcile` is a stub: extracted to reconciling, plus the shipment link by carrier and PRO. `tms-sync` runs every 5 minutes (one job scheduler), pages mock-tms from the saved cursor, upserts carriers and shipments and saves the cursor in the same transaction per page, and retries a page in place on any transient failure (429, 5xx, timeouts, dropped connections) up to 10 times with the jittered backoff and a Retry-After floor; after that the attempt fails and the next resumes from the saved cursor. SIGTERM closes the workers after their running jobs.
- Error taxonomy (`packages/llm`): TransientError (timeouts, 408/425/429/5xx, dropped connections; carries Retry-After) is retried; PermanentError (unreadable or empty PDF, more than 20 pages, missing PDF, provider 4xx, output still invalid after the repair) becomes BullMQ `UnrecoverableError`. Validation messages name fields, never document values.
- Dead letters (`packages/pipeline`): one `failed` handler per worker; on a final failure it inserts a `dead_letters` row and marks the invoice failed, then copies the job to `<queue>-dlq`, all idempotent. The copy comes last and marks a finished move: every worker sweeps its queues' failed sets at start and every 5 minutes and redoes moves without a copy (a handler that failed, or a worker that died first). A failed query is rethrown as `database query failed: <code>`, because drizzle puts every bound value, extracted line items included, in its message. `POST /v1/dead-letters/{id}/replay` re-adds the job first (same id, the DLQ copy's name and data), then marks the row replayed and resets the invoice (extract to received, reconcile to extracted); a worker that still sees failed retries until that commits.
- AI limits: a Lua token bucket in Redis (`LLM_TOKENS_PER_MINUTE`, shared by all workers, estimate 5,200 tokens per page, trued up after each call), and per-UTC-day counters of calls and tokens checked against `DAILY_AI_TOKEN_BUDGET`. `AI_ENABLED=false` (the default) means no provider is built and extract jobs wait. `createLimits` takes an optional clock for tests; without one the bucket runs on the Redis clock and waits in real time. The provider is Gemini `generateContent` over `fetch` with the PDF inline and the key in a header.
- mock-tms: 1,000 generated shipments (`TMS-000001` on), `GET /shipments?after=<cursor>&limit=<1-100>` returning `{ items, next_cursor, has_more }`, 10 requests per second (429 with `Retry-After: 1`), and `FAULT_RATE` / `LATENCY_MS` fault injection.
- GraphQL schema and operations pass graphql-eslint (schema-recommended, schema-relay, operations-recommended); `strict-id-in-types` exempts only `PageInfo` and `*Connection`/`*Edge` types.
- Domain math (`packages/domain`, money as bigint cents): `divRound` rounds halves away from zero; `percentOf` takes basis points (10,000 is 100 %) to the nearest cent; `rateShipment` prices one shipment from a rate card of graduated per-mile bands (each whole mile at its band's rate), a minimum linehaul and a fuel surcharge in basis points of the linehaul after the minimum, rounding only the fuel; `linesMatchTotal` checks that lines add up to the total. `reconcileInvoice` picks the version in force on the ship date (`versionInForce`: half-open UTC days, overlaps rejected) and checks every billed line: a charge code billed before on this invoice or, through `billedBefore`, on an earlier invoice for the shipment is a `duplicate_charge`; a code the version does not contract is an `uncontracted_charge`; more than the linehaul, fuel surcharge or accessorial rate is a `rate_mismatch`. Only overcharges count, at most one per line, each with a `formatUsd` explanation; no discrepancy means reconciled, any means needs_review. The reconcile job does not use them yet.
- `packages/domain` ESLint config allows relative imports only and bans dynamic `import()`; `purity.test.ts` checks it.
- Infra: Postgres, Redis, MinIO, OpenTelemetry Collector, Jaeger, Prometheus, Grafana and Toxiproxy with pinned images and healthchecks. The collector sends traces to Jaeger and exposes metrics that Prometheus scrapes; Grafana provisions both datasources; Toxiproxy proxies Postgres, Redis and the host mock-tms. The default `up` starts Postgres, Redis, MinIO and Toxiproxy.
- Production override (`infra/docker-compose.prod.yml`): no host ports for Postgres, Redis and MinIO, `restart: unless-stopped` and memory limits on every service, Redis capped at 200 MB with `noeviction`, Toxiproxy only with `--profile chaos`.

## Current Development Status

Steps 1 (scaffolding), 2 (contracts), 3 (data), 4 (workers) and 5 (tests) complete on 2026-10-14, including the production-foundation catch-up and parallel-run setup. Next step: AI pipeline and evals (step 6).

## Known Limitations

- All targets are design goals and have not been measured.
- `eval` is a no-op until step 6.
- Reconciliation is a stub: invoices stop at reconciling until the reconcile rules arrive (step 6). `packages/domain` has the rating math, but the database's rate cards hold one flat amount per charge code, with no per-mile bands, minimum or fuel percentage, and shipments carry no miles. Upload invoices that were split stay extracted with no lines of their own.
- One tenant per deployment (`TENANT_ID`); API keys do not carry a tenant yet, and job ids are content hashes without the tenant.
- The Gemini provider is tested against a local fake only; no real key has been used yet. The Groq text path and the fallback model are not built.
- A split part whose bytes match an earlier upload reuses that invoice and job id; BullMQ then makes the old job a child of the split.
- Provider 401, 403 and 404 (bad key, retired model) are permanent, so every extract job dead-letters until the setting is fixed; replay them afterwards. A circuit breaker that pauses the queue instead is planned for step 6.
- `pnpm test:int` needs Docker and the Playwright Chromium (`pnpm --filter @freightaudit/evals exec playwright install --only-shell chromium`). `db:seed` refuses a database that already has data and has no reset option.
- The Toxiproxy test reaches its fake TMS on the host as `host.docker.internal`. Docker Desktop forwards that to the host's loopback; on a Linux Docker engine `host-gateway` reaches only non-loopback addresses, so the fake TMS, bound to 127.0.0.1, is unreachable there (step 7 must solve this for CI).
- A test run killed before its teardown leaves its containers running until the next `pnpm test:int` removes them.
- The migration runner records names only, so an edited applied migration goes unnoticed.
- `backfill-rate-card-versions.ts` only works between 0002 and 0004; after 0004 `rate_cards.carrier_id` no longer exists.
- Fixture bytes repeat only on the same machine and Chromium build; other fonts or browser versions render differently. Fixture invoices are single-page and not tied to seeded shipments or rates yet.
- oasdiff reports the two new `InvoiceStatus` values as breaking (`response-property-enum-value-added`, ERR) against a base without them. `contracts:breaking` cannot run yet (no `origin/main`); once this spec is on main, later diffs start from it.
- 403 is documented but no key has restricted permissions. A request's 30 s `requestTimeout` covers receiving it, not the handler's work.
- GraphQL resolvers exist only for `health`; the `Cents` scalar has no runtime implementation yet.
- `contracts:breaking` fails until the repository has an `origin/main` remote branch (none is configured yet).
- Readiness proves TCP reachability only, not credentials; it switches to queries on the real clients when steps 3 and 4 add them.
- The web port is fixed at 3000 unless `--port` or `PORT` is passed to its dev script; Next.js does not read the root `.env`, and its own logs are not JSON.
- The production override still uses the dev-only Postgres and MinIO credentials from the base file.
- mock-tms serves a fixed set of shipments; new ones never appear, so later syncs read one empty page. `infra/toxiproxy.json` proxies mock-tms on port 4010 regardless of `MOCK_TMS_PORT`.
- MinIO runs the community fork image `pgsty/minio` because upstream images were withdrawn.

## Planned Features

See `docs/todo.md` for the 10-step build plan (8 build steps, review UI, deploy).
