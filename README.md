# FreightAudit

Ingests carrier invoice PDFs, extracts line items with an LLM, and reconciles each charge against contracted rate cards and shipment records with deterministic code. Flags overcharges for human review.

## Setup

Requires Node 24 (LTS), pnpm 12 and Docker.

```bash
pnpm install          # also sets git core.hooksPath to .githooks
cp .env.example .env  # then set API_KEYS; the comment above it shows how to generate a key
docker compose --env-file .env -f infra/docker-compose.yml up -d --wait
pnpm db:migrate
pnpm --filter @freightaudit/evals exec playwright install --only-shell chromium  # once, for pnpm fixtures
```

Add `--profile observability` to also start the OpenTelemetry Collector, Jaeger, Prometheus and Grafana. Stop infra with `docker compose -f infra/docker-compose.yml --profile observability down` (add `-v` to drop data).

The api, worker and mock-tms validate their settings at startup and exit with a list of missing or invalid variables. The pre-commit hook blocks commits whose staged changes contain a secret; it runs a local `gitleaks` when installed, otherwise the pinned Docker image.

Backend on this PC (production): `docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d --wait`. The override publishes no Postgres, Redis or MinIO ports, restarts services unless stopped, and sets memory limits.

## Usage

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run all apps in watch mode |
| `pnpm build` | Build every package and app |
| `pnpm typecheck`, `pnpm lint`, `pnpm test` | Checks (lint includes graphql-eslint; test includes the REST contract test) |
| `pnpm codegen` | Regenerate types and clients from `packages/contracts/openapi.yaml` and `schema.graphql` |
| `pnpm contracts:check` | Fail if committed generated code is stale (regenerates it) |
| `pnpm contracts:breaking` | Fail on breaking OpenAPI changes against `origin/main` (needs git, a fetched base branch and Docker; override the base with `OASDIFF_BASE_REF`) |
| `pnpm db:migrate [--to=0002]` | Apply pending SQL migrations from `packages/db/migrations`; `--to` stops after the files with that prefix (see `docs/migrations.md`) |
| `pnpm db:seed --scale=small\|large` | Seed an empty, migrated database with deterministic demo data: small is 1 tenant, 6 carriers, 5,000 shipments and 500 invoices; large is 50,000 shipments and 20,000 invoices |
| `pnpm test:int` | Integration tests: database tests against the Postgres in `DATABASE_URL` (start infra first; each test uses a throwaway database) and the fixture determinism test (needs the Playwright Chromium) |
| `pnpm fixtures [--count=60] [--seed=42]` | Render synthetic invoice PDFs from 6 templates, plus scanned variants, each with ground-truth JSON, into `evals/fixtures/out`; the same seed gives byte-identical files on one machine |
| `pnpm eval` | Wired to Turborepo; a no-op until step 6 |

Apps (each answers `GET /healthz` and `GET /readyz`, bound to loopback): web `:3000`, api `:4000` (GraphQL at `/graphql`), worker `:4001`, mock-tms `:4010`. Every api route except the two probes requires the `X-API-Key` header. Node services log JSON lines (pino) with a request id, at `LOG_LEVEL`, with credentials redacted.

Infra (bound to 127.0.0.1; host ports set in `.env`): Postgres `:5432`, Redis `:6379`, MinIO `:9000` (console `:9001`), Toxiproxy API `:8474` with proxies postgres `:15432`, redis `:16379`, mock-tms `:14010`. With `--profile observability`: OTLP `:4317`/`:4318`, Jaeger UI `:16686`, Prometheus `:9090`, Grafana `:3001`.

See `docs/context.md` for the design and `docs/todo.md` for the build plan.
