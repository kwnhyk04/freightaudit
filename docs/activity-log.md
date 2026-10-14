# Activity Log

Chronological record of significant development activity, newest first. Skip trivial changes. Do not auto-commit this file.

## Entry Format

```
### YYYY-MM-DD: <task performed>

- Changes: <important changes>
- Files: <relevant files>
- Validation: <tests or checks run and results>
- Outstanding: <open issues, or "None">
```

## Entries

### 2026-10-14: Production foundations catch-up and parallel-run setup

- Changes: Added `@freightaudit/config/env` (zod 4): `loadEnv(keys)` validates the settings each service reads and exits 1 with every problem listed, never echoing values; per-service ports `API_PORT`, `WORKER_PORT`, `MOCK_TMS_PORT`. `packages/telemetry` now exports Fastify logging options (pino JSON lines, UUID `reqId`, redacted `authorization`, `cookie`, `x-api-key` headers and `apiKey` fields) and readiness checks (TCP for Postgres and Redis, MinIO health endpoint, 2 s timeout). `/readyz` added to api, worker, mock-tms and web. `openapi.yaml` 0.3.0: `ApiKey` scheme (`X-API-Key`) on every operation except `/healthz` and `/readyz`, 401 and 403 responses, `RateLimit-Limit` and `RateLimit-Remaining` next to `Retry-After` on 429, `/readyz` with a `Readiness` schema; clients regenerated. The api enforces the key in an `onRequest` hook, before body parsing, for REST, GraphQL and unknown paths. gitleaks pre-commit hook (`.githooks/pre-commit`, enabled by a root `prepare` script; `.gitattributes` keeps it LF). Compose: monitoring services behind the `observability` profile, host ports from `.env` via `--env-file .env`, new `infra/docker-compose.prod.yml`. The web dev server binds 127.0.0.1. The local `.env` gained a generated `API_KEYS` value.
- Files: packages/config/package.json, packages/config/tsconfig.json, packages/config/src/env.ts, packages/telemetry/src/index.ts, packages/contracts/openapi.yaml, packages/contracts/src/generated/openapi.ts, apps/api/package.json, apps/api/src/*, apps/worker/package.json, apps/worker/src/main.ts, apps/mock-tms/package.json, apps/mock-tms/src/main.ts, apps/web/package.json, apps/web/app/readyz/route.ts, infra/docker-compose.yml, infra/docker-compose.prod.yml, .githooks/pre-commit, .gitattributes, package.json, pnpm-lock.yaml, .env.example, README.md, docs/*
- Validation: `pnpm build` and `pnpm typecheck` pass; `pnpm test` passes (api 16, domain 2); `pnpm contracts:check` passes. `pnpm lint` fails only on the 5 known `strict-id-in-types` errors; through the ESLint API the Blocked exception gives 0 problems and still flags an object type without `id`. Moving the auth hook to `preHandler` makes the contract test fail (400 instead of 401). `main.test.ts` starts the api without `DATABASE_URL` and with a short `API_KEYS`: exit code 1, both variables named, the value not echoed. Live with `pnpm dev` and the default infra: all four services answer `/healthz` and `/readyz` with 200; api and worker `/readyz` return 503 naming Redis while it is stopped and 200 after restart; the api returns 401 without a key or with a wrong one and 200 with a valid one, and `/graphql` returns 401 without a key; logs are JSON with a UUID `reqId` and never contain the key; app listeners are on 127.0.0.1 only. Compose: the default profile starts postgres, redis, minio and toxiproxy; port overrides apply and defaults are unchanged. The prod override applied live gives no host ports, `unless-stopped`, 512m/256m/512m limits and Redis `maxmemory` 200 MB with `noeviction`; the dev config was restored and infra left stopped as found. gitleaks in a scratch repo blocks a fake GitHub token (exit 1, redacted) through the Docker fallback and passes a clean commit; git history and all 94 commit candidates scan clean. `pnpm install` set `core.hooksPath` to `.githooks`.
- Outstanding: The user applies the Blocked ESLint exception. On the first commit, stage the hook with `git add --chmod=+x`. The production override still uses the dev-only Postgres and MinIO credentials. The web port is not read from `.env`, and web logs are not JSON yet (step 9). Readiness is TCP-only until steps 3 and 4. `contracts:breaking` needs an `origin/main` remote. 403 and 429 are documented, not emitted.

### 2026-10-14: Plan updated for free-tier models, production readiness, and deployment

- Changes: Switched to free-tier LLMs behind a provider switch, added production-readiness requirements and a catch-up task for steps 1 and 2, added steps 9 (review UI) and 10 (deploy).
- Files: AGENTS.md, docs/context.md, docs/memory.md, docs/todo.md
- Validation: Documentation only. No code changed.
- Outstanding: See docs/todo.md.

### 2026-10-14: Step 2 review follow-ups

- Changes: Recorded the approved decisions in `docs/memory.md`. Removed the five Relay wrapper inline disables from `schema.graphql`; the replacement `strict-id-in-types` exceptions for the ESLint config were handed to the user because the config-protection hook blocks agent edits. Restored `Invoice.discrepancies` as a Relay connection (first, after, status), kept the root `discrepancies` query for cross-invoice review, and dropped its `invoiceId` filter. `Invoice.lineItems` keeps one field-scoped disable whose reason is the requested one-line comment. Added `apps/api/src/main.test.ts`, which boots `src/main.ts` in a separate Node process and checks the missing Idempotency-Key 400 Problem Details response, with a 202 control.
- Files: packages/contracts/schema.graphql, packages/contracts/operations/invoice.graphql, packages/contracts/src/generated/*, apps/api/src/main.test.ts, docs/memory.md, docs/todo.md, docs/activity-log.md
- Validation: `pnpm codegen` and `pnpm contracts:check` pass; `pnpm build`, `pnpm typecheck` and `pnpm test` (api 11, domain 2) pass. `pnpm lint` fails only on the 5 expected `strict-id-in-types` errors in `schema.graphql`; linting with the proposed exceptions through the ESLint API reports 0 problems, and an object type without `id` is still flagged. `jest-realm.js` is referenced only by the Jest preset's `setupFiles`.
- Outstanding: The user applies the `strict-id-in-types` exceptions to `packages/contracts/eslint.config.js`.

### 2026-10-14: Step 2 contracts

- Changes: Wrote `openapi.yaml` (OpenAPI 3.1: invoice upload with Idempotency-Key and content-hash dedupe, 500-file batches with per-file results, cursor-paginated invoice and discrepancy lists, invoice detail, dead-letter replay, RFC 9457 Problem Details, 429 and 503 with Retry-After) and `schema.graphql` (review UI types, Relay connections, resolveDiscrepancy and approveInvoice) plus UI operations. Added codegen (openapi-typescript types with PDF fields as Blob, openapi-fetch client, graphql-codegen resolver types and client-preset documents), `contracts:check`, `contracts:breaking` (oasdiff), graphql-eslint. api now registers routes through fastify-openapi-glue with streamed multipart validation, Problem Details errors and in-memory stubs. graphql moved from 17 to 16.
- Files: packages/contracts/*, apps/api/src/*, apps/api/package.json, packages/config/eslint.js, packages/config/jest.js, packages/config/jest-realm.js, package.json, turbo.json, pnpm-workspace.yaml, README.md, docs/*
- Validation: `pnpm codegen` clean; `pnpm contracts:check` passes, fails on a stale file and recovers; `pnpm build`, `pnpm typecheck`, `pnpm lint` (incl. graphql-eslint on the schema and 5 operations) and `pnpm test` (api 10, domain 2) pass. The contract test covers all 7 REST operations and fails on an undocumented status (red-green checked). `contracts:breaking` checked in a scratch git repo: removed endpoint fails, identical spec passes, missing base ref fails, no git skips.
- Outstanding: Stubs are in memory with offset cursors. Only the GraphQL `health` resolver exists. 429 and 503 are documented, not emitted. Six inline graphql-eslint disables remain because the config-protection hook blocks ESLint config edits.

### 2026-10-14: Step 1 scaffolding

- Changes: Created the pnpm + Turborepo monorepo (TypeScript 6 strict, ESM, Node 24) with root scripts dev, build, test, test:int, lint, typecheck, db:migrate, db:seed, codegen, eval. Added `packages/config` presets (tsconfig, ESLint, Jest via swc), skeletons for contracts, db, domain, llm, telemetry and `evals/`. Apps api (Fastify + GraphQL Yoga), worker, mock-tms and web (Next.js 16) each serve GET /healthz. The domain ESLint config allows relative imports only. Added `infra/docker-compose.yml` with eight pinned, health-checked services plus collector, Prometheus, Grafana and Toxiproxy config.
- Files: package.json, pnpm-workspace.yaml, turbo.json, eslint.config.js, .env.example, .gitignore, .nvmrc, apps/*, packages/*, evals/*, infra/*, README.md, docs/*
- Validation: `pnpm install`, `pnpm build`, `pnpm typecheck`, `pnpm lint` and `pnpm test` (api 2 tests, domain 2 tests) pass. `docker compose -f infra/docker-compose.yml up -d --wait` reports all 8 services healthy. Every app answers /healthz with 200 in dev and from built output, on localhost and 127.0.0.1. A probe trace reached Jaeger through the collector; Prometheus scrapes the collector; Toxiproxy reaches Postgres and the host mock-tms.
- Outstanding: test:int, db:migrate, db:seed, codegen and eval are no-ops until their steps. mock-tms pagination, rate limit and fault injection are deferred. MinIO uses the `pgsty/minio` fork.

### 2026-10-13: Project created from template

- Changes: Copied `_project-template`, filled project-specific rules in `AGENTS.md`, added `CLAUDE.md` importing `AGENTS.md`, recorded design in `docs/context.md`, decisions in `docs/memory.md`, build plan in `docs/todo.md`.
- Files: AGENTS.md, CLAUDE.md, README.md, docs/*
- Validation: Documentation only. No code to test.
- Outstanding: None.
