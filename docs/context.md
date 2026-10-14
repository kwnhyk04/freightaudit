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

TypeScript (strict, ESM, current Node LTS), pnpm + Turborepo, Fastify, GraphQL Yoga, BullMQ, Redis, Postgres, Drizzle, MinIO, Next.js, Jest, Testcontainers, OpenTelemetry, Docker, GitHub Actions.

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

Installed versions (2026-10-14): Node 24, pnpm 12.11, Turborepo 2.11, TypeScript 6.0, Fastify 5.12 with fastify-openapi-glue 4.11 and @fastify/multipart 10, GraphQL Yoga 5.24 with graphql 16, Next.js 16.4 with React 19.3, Jest 30 with swc, ESLint 10 with typescript-eslint 8 and graphql-eslint 4.4, openapi-typescript 7.13, openapi-fetch 0.17, graphql-codegen 7 (client preset 6), zod 4.6, gitleaks 8.30.1 (Docker image). BullMQ, Drizzle, a Postgres driver, a Redis client, OpenTelemetry SDK and the LLM client are not installed yet.

## Architecture and System Design

Workspaces exist as skeletons (step 1). Behavior below is planned unless listed under Implemented Functionality.

1. `apps/api`: Fastify REST + GraphQL. Stores PDFs, writes invoice rows keyed by content hash, enqueues `extract`. Returns 503 with Retry-After when the queue passes 5,000 waiting jobs.
2. `apps/worker`: BullMQ queues `extract`, `reconcile`, `tms-sync`, each with a dead-letter queue.
3. `apps/mock-tms`: fake TMS with cursor pagination, 10 req/s rate limit, fault injection.
4. `apps/web`: Next.js review UI over GraphQL.
5. `packages/domain`: money, rate-card math, reconciliation. Pure functions.
6. `packages/llm`, `packages/db`, `packages/contracts`, `packages/telemetry`, `evals/`.

Tooling: `packages/config` holds the shared tsconfig, ESLint and Jest presets plus the runtime env loader (`@freightaudit/config/env`). `packages/telemetry` holds the shared Fastify logging options and readiness checks. Packages build to `dist/` with `tsc`; apps run TypeScript directly in dev through Node type stripping. Local infrastructure lives in `infra/docker-compose.yml`; `infra/docker-compose.prod.yml` overrides it for the backend on the PC.

## Important Components

Not built yet. Planned: extract worker, reconcile worker, TMS sync, rate-card versioning, eval harness.

## Implemented Functionality

- Monorepo: root scripts `dev`, `build`, `test`, `test:int`, `lint`, `typecheck`, `db:migrate`, `db:seed`, `codegen`, `eval` run through Turborepo.
- `GET /healthz` returns `{"status":"ok"}` on api (:4000), worker (:4001), mock-tms (:4010) and web (:3000). `GET /readyz` returns `{status, checks}`: 200 when every dependency is reachable, 503 naming the failed one. api checks Postgres and Redis by TCP connect and MinIO through `/minio/health/live`; worker checks Postgres and Redis; mock-tms and web have no dependencies. Each check times out after 2 s.
- Config: api, worker and mock-tms load their settings through `loadEnv` (zod). A missing or invalid value prints every problem to stderr, naming the variable but never its value, and exits with code 1. Defaults: `HOST=localhost`, `LOG_LEVEL=info`, ports 4000, 4001 and 4010.
- Auth: every api route except `/healthz` and `/readyz`, including `/graphql` and unknown paths, requires `X-API-Key` matching one of `API_KEYS` (comma-separated, at least 32 characters each). The check runs in `onRequest`, before body parsing, and answers 401 Problem Details.
- Logs: api, worker and mock-tms write pino JSON lines at `LOG_LEVEL` with a UUID `reqId` per request; `authorization`, `cookie` and `x-api-key` headers and `apiKey` fields are redacted at the top level and one object deep.
- Secrets: `.githooks/pre-commit` runs gitleaks on staged changes (local binary, otherwise the pinned Docker image); `pnpm install` sets `core.hooksPath` through the root `prepare` script.
- Web dev server binds 127.0.0.1 only.
- Contracts (spec-first, `packages/contracts`): `openapi.yaml` (OpenAPI 3.1) defines `POST /v1/invoices` (multipart PDF, required `Idempotency-Key`, 202 new or 200 existing by content hash), `POST /v1/invoice-batches` (up to 500 files, per-file `accepted | duplicate | rejected` results), `GET /v1/invoices` and `GET /v1/discrepancies` (`limit` 1 to 100, default 25, opaque `cursor`, `{items, next_cursor}`), `GET /v1/invoices/{id}`, `POST /v1/dead-letters/{id}/replay`, `/healthz` and `/readyz`. An `ApiKey` scheme (`X-API-Key` header) applies to every operation except the two probes; the secured operations document 401 and 403. Errors are RFC 9457 Problem Details; 429 documents `RateLimit-Limit`, `RateLimit-Remaining` and `Retry-After`, and 503 documents `Retry-After`. `schema.graphql` defines the review UI types (Invoice, LineItem, Shipment, RateCardVersion, Discrepancy), Relay connections for invoices and discrepancies, and the `resolveDiscrepancy` and `approveInvoice` mutations; `operations/` holds the UI operations.
- Codegen: openapi-typescript types plus an openapi-fetch client (`createApiClient`), graphql-codegen resolver types (exported from `@freightaudit/contracts`) and client-preset typed documents (`@freightaudit/contracts/graphql`). `pnpm contracts:check` fails on stale generated code; `pnpm contracts:breaking` runs oasdiff against `origin/main`.
- api: fastify-openapi-glue registers every REST route from `openapi.yaml` and validates requests against it (multipart files are streamed, hashed and validated as their SHA-256 digest); handlers are in-memory stubs. GraphQL Yoga serves the full schema at `/graphql`, but only the `health` query has a resolver. `contract.test.ts` calls every REST operation through the typed client and validates each response against the spec, and checks that each operation the spec secures returns 401 without a valid key.
- GraphQL operations pass graphql-eslint (operations-recommended). The schema fails 5 `strict-id-in-types` errors on Relay types until the exception in `docs/todo.md` (Blocked) is applied.
- `packages/domain` ESLint config allows relative imports only and bans dynamic `import()`; `purity.test.ts` checks it.
- Infra: Postgres, Redis, MinIO, OpenTelemetry Collector, Jaeger, Prometheus, Grafana and Toxiproxy with pinned images and healthchecks. The collector sends traces to Jaeger and exposes metrics that Prometheus scrapes; Grafana provisions both datasources; Toxiproxy proxies Postgres, Redis and the host mock-tms. The default `up` starts Postgres, Redis, MinIO and Toxiproxy.
- Production override (`infra/docker-compose.prod.yml`): no host ports for Postgres, Redis and MinIO, `restart: unless-stopped` and memory limits on every service, Redis capped at 200 MB with `noeviction`, Toxiproxy only with `--profile chaos`.

## Current Development Status

Steps 1 (scaffolding) and 2 (contracts) complete on 2026-10-14, including the production-foundation catch-up and parallel-run setup. Next step: data.

## Known Limitations

- All targets are design goals and have not been measured.
- `test:int`, `db:migrate`, `db:seed` and `eval` are no-ops until later steps add package scripts.
- REST handlers are in-memory stubs with offset-based cursors; 429 (with RateLimit headers) and 503 are documented but not emitted yet, and 403 is documented but no key has restricted permissions.
- GraphQL resolvers exist only for `health`; the `Cents` scalar has no runtime implementation yet.
- `contracts:breaking` fails until the repository has an `origin/main` remote branch (none is configured yet).
- Readiness proves TCP reachability only, not credentials; it switches to queries on the real clients when steps 3 and 4 add them.
- The web port is fixed at 3000 unless `--port` or `PORT` is passed to its dev script; Next.js does not read the root `.env`, and its own logs are not JSON.
- The production override still uses the dev-only Postgres and MinIO credentials from the base file.
- mock-tms only serves `/healthz` and `/readyz`; pagination, rate limit and fault injection are not built. `infra/toxiproxy.json` proxies mock-tms on port 4010 regardless of `MOCK_TMS_PORT`.
- MinIO runs the community fork image `pgsty/minio` because upstream images were withdrawn.

## Planned Features

See `docs/todo.md` for the 10-step build plan (8 build steps, review UI, deploy).
