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

Local ports (bound to 127.0.0.1; chosen so all three projects can run at once; compose project name `freightaudit`). Confirmed from `infra/docker-compose.yml` on 2026-10-14.

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

Installed versions (2026-10-14): Node 24, pnpm 12.11, Turborepo 2.11, TypeScript 6.0, Fastify 5.12 with fastify-openapi-glue 4.11 and @fastify/multipart 10, GraphQL Yoga 5.24 with graphql 16, Next.js 16.4 with React 19.3, Jest 30 with swc, ESLint 10 with typescript-eslint 8 and graphql-eslint 4.4, openapi-typescript 7.13, openapi-fetch 0.17, graphql-codegen 7 (client preset 6). BullMQ, Drizzle, OpenTelemetry SDK and the LLM client are not installed yet.

## Architecture and System Design

Workspaces exist as skeletons (step 1). Behavior below is planned unless listed under Implemented Functionality.

1. `apps/api`: Fastify REST + GraphQL. Stores PDFs, writes invoice rows keyed by content hash, enqueues `extract`. Returns 503 with Retry-After when the queue passes 5,000 waiting jobs.
2. `apps/worker`: BullMQ queues `extract`, `reconcile`, `tms-sync`, each with a dead-letter queue.
3. `apps/mock-tms`: fake TMS with cursor pagination, 10 req/s rate limit, fault injection.
4. `apps/web`: Next.js review UI over GraphQL.
5. `packages/domain`: money, rate-card math, reconciliation. Pure functions.
6. `packages/llm`, `packages/db`, `packages/contracts`, `packages/telemetry`, `evals/`.

Tooling: `packages/config` holds the shared tsconfig, ESLint and Jest presets. Packages build to `dist/` with `tsc`; apps run TypeScript directly in dev through Node type stripping. Local infrastructure lives in `infra/docker-compose.yml`.

## Important Components

Not built yet. Planned: extract worker, reconcile worker, TMS sync, rate-card versioning, eval harness.

## Implemented Functionality

- Monorepo: root scripts `dev`, `build`, `test`, `test:int`, `lint`, `typecheck`, `db:migrate`, `db:seed`, `codegen`, `eval` run through Turborepo.
- `GET /healthz` returns `{"status":"ok"}` on api (:4000), worker (:4001), mock-tms (:4010) and web (:3000).
- Contracts (spec-first, `packages/contracts`): `openapi.yaml` (OpenAPI 3.1) defines `POST /v1/invoices` (multipart PDF, required `Idempotency-Key`, 202 new or 200 existing by content hash), `POST /v1/invoice-batches` (up to 500 files, per-file `accepted | duplicate | rejected` results), `GET /v1/invoices` and `GET /v1/discrepancies` (`limit` 1 to 100, default 25, opaque `cursor`, `{items, next_cursor}`), `GET /v1/invoices/{id}`, `POST /v1/dead-letters/{id}/replay` and `/healthz`. Errors are RFC 9457 Problem Details; 429 and 503 document `Retry-After`. `schema.graphql` defines the review UI types (Invoice, LineItem, Shipment, RateCardVersion, Discrepancy), Relay connections for invoices and discrepancies, and the `resolveDiscrepancy` and `approveInvoice` mutations; `operations/` holds the UI operations.
- Codegen: openapi-typescript types plus an openapi-fetch client (`createApiClient`), graphql-codegen resolver types (exported from `@freightaudit/contracts`) and client-preset typed documents (`@freightaudit/contracts/graphql`). `pnpm contracts:check` fails on stale generated code; `pnpm contracts:breaking` runs oasdiff against `origin/main`.
- api: fastify-openapi-glue registers every REST route from `openapi.yaml` and validates requests against it (multipart files are streamed, hashed and validated as their SHA-256 digest); handlers are in-memory stubs. GraphQL Yoga serves the full schema at `/graphql`, but only the `health` query has a resolver. `contract.test.ts` calls every REST operation through the typed client and validates each response against the spec.
- GraphQL schema and operations pass graphql-eslint (schema-recommended, schema-relay, operations-recommended).
- `packages/domain` ESLint config allows relative imports only and bans dynamic `import()`; `purity.test.ts` checks it.
- Infra: Postgres, Redis, MinIO, OpenTelemetry Collector, Jaeger, Prometheus, Grafana and Toxiproxy with pinned images and healthchecks. The collector sends traces to Jaeger and exposes metrics that Prometheus scrapes; Grafana provisions both datasources; Toxiproxy proxies Postgres, Redis and the host mock-tms.

## Current Development Status

Steps 1 (scaffolding) and 2 (contracts) complete on 2026-10-14. Next step: data.

## Known Limitations

- All targets are design goals and have not been measured.
- `test:int`, `db:migrate`, `db:seed` and `eval` are no-ops until later steps add package scripts.
- REST handlers are in-memory stubs with offset-based cursors; 429 and 503 are documented but not emitted yet.
- GraphQL resolvers exist only for `health`; the `Cents` scalar has no runtime implementation yet.
- `contracts:breaking` skips outside a git repository; the project is not a git repository yet.
- mock-tms only serves `/healthz`; pagination, rate limit and fault injection are not built.
- MinIO runs the community fork image `pgsty/minio` because upstream images were withdrawn.

## Planned Features

See `docs/todo.md` for the 10-step build plan (8 build steps, review UI, deploy).
