# FreightAudit

Ingests carrier invoice PDFs, extracts line items with an LLM, and reconciles each charge against contracted rate cards and shipment records with deterministic code. Flags overcharges for human review.

## Setup

Requires Node 24 (LTS), pnpm 12 and Docker.

```bash
pnpm install
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d --wait
```

Stop infra with `docker compose -f infra/docker-compose.yml down` (add `-v` to drop data).

## Usage

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run all apps in watch mode |
| `pnpm build` | Build every package and app |
| `pnpm typecheck`, `pnpm lint`, `pnpm test` | Checks (lint includes graphql-eslint; test includes the REST contract test) |
| `pnpm codegen` | Regenerate types and clients from `packages/contracts/openapi.yaml` and `schema.graphql` |
| `pnpm contracts:check` | Fail if committed generated code is stale (regenerates it) |
| `pnpm contracts:breaking` | Fail on breaking OpenAPI changes against `origin/main` (needs git, a fetched base branch and Docker; override the base with `OASDIFF_BASE_REF`) |
| `pnpm test:int`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm eval` | Wired to Turborepo; no-ops until their build step adds package scripts |

Apps (each answers `GET /healthz`): web `:3000`, api `:4000` (GraphQL at `/graphql`), worker `:4001`, mock-tms `:4010`.

Infra (bound to 127.0.0.1): Postgres `:5432`, Redis `:6379`, MinIO `:9000` (console `:9001`), OTLP `:4317`/`:4318`, Jaeger UI `:16686`, Prometheus `:9090`, Grafana `:3001`, Toxiproxy API `:8474` with proxies postgres `:15432`, redis `:16379`, mock-tms `:14010`.

See `docs/context.md` for the design and `docs/todo.md` for the build plan.
