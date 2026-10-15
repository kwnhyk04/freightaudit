# FreightAudit

<!-- eval:start -->
## Eval results

Golden set v1 (90 synthetic invoices, ground truth from the generator), measured 2026-10-15 with primary gemini/gemini-3.5-flash-lite (served as gemini-3.5-flash-lite), text groq/openai/gpt-oss-120b (served as openai/gpt-oss-120b), fallback groq/qwen/qwen3.8-27b (not called). 90 cases give wide intervals; misses are listed as misses. Full report: `evals/reports/2026-10-15.md`.

| Metric | Target | Measured | 95% CI | Met | Model | Date |
| --- | --- | --- | --- | --- | --- | --- |
| Header field accuracy (digital) | ≥ 0.980 | 0.995 | 0.988 to 1.000 | yes | groq/openai/gpt-oss-120b | 2026-10-15 |
| Header field accuracy (scanned) | ≥ 0.930 | 1.000 | 1.000 to 1.000 | yes | gemini/gemini-3.5-flash-lite | 2026-10-15 |
| Line-item F1 (digital) | ≥ 0.950 | 1.000 | 1.000 to 1.000 | yes | groq/openai/gpt-oss-120b | 2026-10-15 |
| Line-item F1 (scanned) | ≥ 0.880 | 0.985 | 0.952 to 1.000 | yes | gemini/gemini-3.5-flash-lite | 2026-10-15 |
| Arithmetic consistency (after repair) | ≥ 0.990 | 1.000 | 1.000 to 1.000 | yes | all roles | 2026-10-15 |
| Overcharge precision | ≥ 0.950 | 0.944 | 0.805 to 1.000 | no | all roles | 2026-10-15 |
| Overcharge recall | ≥ 0.900 | 1.000 | 1.000 to 1.000 | yes | all roles | 2026-10-15 |
| Dollar recovery | ≥ 0.900 | 1.000 | 1.000 to 1.000 | yes | all roles | 2026-10-15 |
| False flag rate | ≤ 0.030 | 0.007 | 0.000 to 0.023 | yes | all roles | 2026-10-15 |
| Escalation rate | ≤ 0.100 | 0.000 | 0.000 to 0.000 | yes | all roles | 2026-10-15 |
| Extraction latency p50 (3 pages or fewer) | ≤ 5,000 ms | 2,333 ms | 2,102 ms to 2,620 ms | yes | all roles | 2026-10-15 |
| Extraction latency p95 (3 pages or fewer) | ≤ 12,000 ms | 4,698 ms | 3,989 ms to 6,574 ms | yes | all roles | 2026-10-15 |
| End-to-end latency p95 (under eval throttling, not normal load) | ≤ 30,000 ms | 143,403 ms | 83,863 ms to 319,548 ms | no | all roles | 2026-10-15 |
| Input tokens per page (text path) | ≤ 4,000 | 828 | 786 to 880 | yes | groq/openai/gpt-oss-120b | 2026-10-15 |
| Output tokens per page (text path) | ≤ 1,200 | 674 | 624 to 727 | yes | groq/openai/gpt-oss-120b | 2026-10-15 |
| Cost per invoice, paid-equivalent (digital) | ≤ $0.0200 | $0.0005 | $0.0005 to $0.0006 | yes | groq/openai/gpt-oss-120b | 2026-10-15 |
| Cost per invoice, paid-equivalent (scanned) | ≤ $0.0500 | $0.0015 | $0.0011 to $0.0021 | yes | gemini/gemini-3.5-flash-lite | 2026-10-15 |
| Throughput (free-tier ceiling, not a load test) | ≥ 2,000 / h | 394 / h | computed | no | all roles | 2026-10-15 |
<!-- eval:end -->

**What these numbers do and don't show.** The golden set is 90 synthetic invoices drawn from the same 6 HTML templates the generator uses, with ground truth from that generator, so scores near 1.0 mean the set is easy for these models, not that real carrier invoices would score the same. The cases are few, so every interval is wide. End-to-end latency here is measured under the eval's own free-tier throttling, not normal load, and throughput is the ceiling the free tiers allow, not a load test; step 8's k6 load test measures both. Golden set v2 should add harder layouts (multi-column, rotated tables, carrier-specific forms), real-world noise (fax artifacts, stamps, skew beyond 2 degrees, low resolution) and more adversarial cases (a title line beside the carrier, repeated pages, partial credits).

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

Models run only with `AI_ENABLED=true` in `.env` (default false: no key needed, extract jobs wait). It then needs `GEMINI_API_KEY` (primary, reads scanned pages) and `GROQ_API_KEY` (text model and fallback), both free tiers; roles, models and per-minute limits are the `LLM_*` settings in `.env.example`. Free tiers may train on prompts, so send only synthetic invoices.

The api, worker and mock-tms validate their settings at startup and exit with a list of missing or invalid variables. The pre-commit hook blocks commits whose staged changes contain a secret; it runs a local `gitleaks` when installed, otherwise the pinned Docker image.

Backend on this PC (production): `docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d --wait`. The override publishes no Postgres, Redis or MinIO ports, restarts services unless stopped, and sets memory limits.

## Usage

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run all apps in watch mode |
| `pnpm build` | Build every package and app |
| `pnpm typecheck`, `pnpm lint`, `pnpm test` | Checks (lint includes graphql-eslint). `pnpm test` runs the Jest `unit` project per package through Turborepo, cached: no infrastructure, and a guard fails any unit test that opens a socket or starts a process. `packages/domain` fails below 90 % coverage |
| `pnpm codegen` | Regenerate types and clients from `packages/contracts/openapi.yaml` and `schema.graphql` |
| `pnpm contracts:check` | Fail if committed generated code is stale (regenerates it) |
| `pnpm contracts:breaking` | Fail on breaking OpenAPI changes against `origin/main` (needs git, a fetched base branch and Docker; override the base with `OASDIFF_BASE_REF`) |
| `pnpm db:migrate [--to=0002]` | Apply pending SQL migrations from `packages/db/migrations`; `--to` stops after the files with that prefix (see `docs/migrations.md`) |
| `pnpm db:seed --scale=small\|large` | Seed an empty, migrated database with deterministic demo data: small is 1 tenant, 6 carriers, 5,000 shipments and 500 invoices; large is 50,000 shipments and 20,000 invoices. Rate card versions carry per-mile bands, a minimum and a fuel percentage, shipments carry miles, and some invoices carry a planted overcharge, open on reconciled invoices and waiting for the reconcile job on extracted ones |
| `pnpm db:reset` | Dev only: empty this deployment's BullMQ queues at `REDIS_URL` (jobs and their ids, so a PDF uploaded before the reset is extracted again), drop every app table and its data in the database at `DATABASE_URL`, migrate from empty and seed `--scale=small`. It refuses before deleting anything unless Postgres and Redis are on `localhost` or `127.0.0.1` and `NODE_ENV` is not `production`; set `NODE_ENV=production` in `.env` on a machine whose data must survive. Stop the api and worker first. Stored PDFs stay |
| `pnpm test:int` | The Jest `integration` and `contract` projects in one root run (`jest.config.js`), against Postgres, Redis, MinIO and Toxiproxy containers that Testcontainers starts for the run on 127.0.0.1 and removes afterwards. Needs Docker, not the compose infra; each test uses a throwaway database, its own Redis key prefix and bucket. Covers migrations including expand, backfill and contract under the api's queries, the REST contract, keyset pagination under concurrent inserts, batch partial failure, rate limits and backpressure, the worker pipeline (retries, dead letters and replay, crash recovery, budget guard, multi-invoice split, TMS sync through 20 % connection resets and 300 ms latency), reconciliation against the small seed's planted overcharges, and the fixture determinism test (needs the Playwright Chromium) |
| `pnpm fixtures [--count=60] [--seed=42]` | Render synthetic invoice PDFs from 6 templates, plus scanned variants, each with ground-truth JSON, into `evals/fixtures/out`; the same seed gives byte-identical files on one machine. Each invoice bills a shipment the small seed leaves unbilled, so it reconciles against `pnpm db:seed --scale=small`; the ground truth gives each line's expected cents and every planted overcharge |
| `pnpm extract:resume` | Restart the extract queue after the worker paused it because a provider rejected its key or model (401, 403, 404; the worker logs `alert: "extract_paused"`). Fix the setting and restart the worker first |
| `pnpm eval --suite extraction --subset ci\|dev\|full\|compare [--fresh] [--set-floors]` | Runs golden set v1 (`evals/golden/v1`: 90 invoices, dev split 20, ci subset 20) through the real worker against the small seed in throwaway Postgres and Redis containers, with the pinned roles from `.env` (real model calls; needs Docker and the keys). Each case's result is cached in `evals/.cache`, so a run stopped by a spent quota (exit 2) resumes; `--fresh` ignores the cache. Writes `evals/reports/<date>[-<subset>].json` and `.md` with every target met or missed and the regression floors of `evals/thresholds.json` (exit 1 when one breaks); a full run rewrites the table above. `compare` runs `gemini-3.8-flash` beside the configured primary on `evals/comparison/v1`. Rebuild a set with `node evals/golden/build.ts --set golden\|comparison` only as a new version |

One project or file: `node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects contract`, or `--selectProjects integration -- apps/worker/src/tms-chaos` (build the packages first with `pnpm build`).

Tests never call a real model provider: they replay responses recorded in `packages/llm/fixtures/recorded`. To re-record after changing a prompt or schema, run the affected integration tests with `LLM_RECORD=1` (keys come from `.env`); `LLM_PROVIDER=ollama` sends the recorded tests' requests to a local Ollama instead (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`).

Apps (each answers `GET /healthz` and `GET /readyz`, bound to loopback): web `:3000`, api `:4000` (GraphQL at `/graphql`), worker `:4001`, mock-tms `:4010`. Every api route except the two probes requires the `X-API-Key` header and is rate limited per key (60 requests a minute, 10 uploads a minute). Uploads go to MinIO and the `extract` queue; the worker extracts only when `AI_ENABLED=true` (pages with a text layer to the text model, others as images to the primary, one repair, then the fallback, then needs_review), records every model call in `llm_calls`, and otherwise holds extract jobs back. Node services log JSON lines (pino) with a request id, at `LOG_LEVEL`, with credentials redacted.

Infra (bound to 127.0.0.1; host ports set in `.env`): Postgres `:5432`, Redis `:6379`, MinIO `:9000` (console `:9001`), Toxiproxy API `:8474` with proxies postgres `:15432`, redis `:16379`, mock-tms `:14010`. With `--profile observability`: OTLP `:4317`/`:4318`, Jaeger UI `:16686`, Prometheus `:9090`, Grafana `:3001`.

See `docs/context.md` for the design and `docs/todo.md` for the build plan.
