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
| Input tokens per page (text path) | ≤ 4,000 | 828 | 786 to 880 | yes | groq/openai/gpt-oss-120b | 2026-10-15 |
| Output tokens per page (text path) | ≤ 1,200 | 674 | 624 to 727 | yes | groq/openai/gpt-oss-120b | 2026-10-15 |
| Cost per invoice, paid-equivalent (digital) | ≤ $0.0200 | $0.0005 | $0.0005 to $0.0006 | yes | groq/openai/gpt-oss-120b | 2026-10-15 |
| Cost per invoice, paid-equivalent (scanned) | ≤ $0.0500 | $0.0015 | $0.0011 to $0.0021 | yes | gemini/gemini-3.5-flash-lite | 2026-10-15 |
| End-to-end latency at low load with real free-tier models (k6, n = 20, one every 15 s; p95 is not meaningful at this n) | p95 ≤ 30,000 ms | p50 3,108 ms, p90 4,162 ms, max 4,663 ms | n/a | yes | all roles | 2026-10-15 |
| Throughput (k6: recorded-fixture model provider at 3x the 2,000/h normal rate, 2 workers x 8) | ≥ 2,000 / h | 6,000 / h sustained for 10 min: 1,083 accepted, 0 lost, all final within 5 s of the last upload | n/a | yes | recorded fixtures | 2026-10-15 |
<!-- eval:end -->

**What these numbers do and don't show.** The golden set is 90 synthetic invoices drawn from the same 6 HTML templates the generator uses, with ground truth from that generator, so scores near 1.0 mean the set is easy for these models, not that real carrier invoices would score the same. The cases are few, so every interval is wide. Extraction latency counts successful calls only, from the first request to the final parsed answer with repairs included, and leaves out time spent waiting on a provider's rate limit: free-tier rate-limit waits measure the provider plan, not the pipeline. The eval report counts those waits, their total time and failed or timed-out calls apart, each with its own regression floor. On the 20-case ci subset that gates pull requests, extraction latency p95 is held to its 12,000 ms design target rather than a floor derived from a run: with n = 20, p95 is effectively the slowest single case, and its interval (7.5 to 31 s on one PR run) is too wide for a tighter floor to separate regressions from noise. p50 keeps its derived floor there, and the full run keeps its derived p95 floor. The last two rows come from the k6 load test (see Load test), and they measure different things. End-to-end latency is what one invoice sees from the real free-tier models at low load: 20 invoices, paced below the free tiers' ceiling of about 394 an hour, so it shows latency, not throttling. Throughput is the system's at 3x the design rate, with the models replaced by recorded replies. Neither measures real models at the design rate, which would need paid tiers. The eval's own end-to-end latency (143 s p95 under its free-tier throttling) and free-tier ceiling stay in its report. Golden set v2 should add harder layouts (multi-column, rotated tables, carrier-specific forms), real-world noise (fax artifacts, stamps, skew beyond 2 degrees, low resolution) and more adversarial cases (a title line beside the carrier, repeated pages, partial credits).

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

Apps (each answers `GET /healthz` and `GET /readyz`, bound to loopback): web `:3000`, api `:4000` (GraphQL at `/graphql`), worker `:4001`, mock-tms `:4010`. Every api route except the two probes requires the `X-API-Key` header and is rate limited per key (60 requests a minute and 10 uploads a minute by default: `RATE_LIMIT_PER_MIN`, `UPLOAD_RATE_LIMIT_PER_MIN`). Uploads go to MinIO and the `extract` queue; the worker extracts only when `AI_ENABLED=true` (pages with a text layer to the text model, others as images to the primary, one repair, then the fallback, then needs_review), records every model call in `llm_calls`, and otherwise holds extract jobs back. Node services log JSON lines (pino) with a request id, at `LOG_LEVEL`, with credentials redacted.

Infra (bound to 127.0.0.1; host ports set in `.env`): Postgres `:5432`, Redis `:6379`, MinIO `:9000` (console `:9001`), Toxiproxy API `:8474` with proxies postgres `:15432`, redis `:16379`, mock-tms `:14010`. With `--profile observability`: OTLP `:4317`/`:4318`, Jaeger UI `:16686`, Prometheus `:9090`, Grafana `:3001`.

## Observability

Start the monitoring stack with `docker compose --env-file .env -f infra/docker-compose.yml --profile observability up -d --wait`.
- **How it starts:** the api and worker load OpenTelemetry through `node --import ./src/telemetry.ts` (their dev scripts and Docker images do this). They send traces and metrics as OTLP/JSON to the collector at `OTEL_EXPORTER_OTLP_ENDPOINT`.
- **Where data goes:** the collector passes traces to Jaeger (UI `:16686`) and exposes metrics for Prometheus (`:9090`). Grafana (`:3001`, admin/admin on a fresh volume) opens the provisioned **FreightAudit** dashboard.
- **Turning it off:** without the profile, exports fail quietly. `OTEL_SDK_DISABLED=true` skips the SDK.

![One upload as one trace in Jaeger](docs/screenshots/jaeger-trace.png)

**Traces.** One upload is one trace, from the api's `POST /v1/invoices` through the worker's extract, each model call and reconcile.
- The trace crosses BullMQ as a W3C `traceparent` in job data (`data.otel`). A producer span wraps each add, and a consumer span wraps each job attempt.
- A multi-invoice upload's parts are children of the span that added their flow.
- Auto-instrumentation covers http, Fastify, pg and ioredis:
  - SQL is recorded with `$n` placeholders.
  - Redis spans name the command only, since BullMQ passes job data as script arguments.
  - Health probes are left out.
- Model calls follow the OpenTelemetry GenAI semantic conventions. Those conventions are still in development, so the attribute names are pinned to **semconv v1.41.1**, the last core release that defines them (v1.42.0 moved them to the separate GenAI conventions repository). The names are inlined in `packages/llm/src/trace.ts`, and the tracers declare schema URL 1.41.1.
- Each model call is `generate_content <model>` (Gemini) or `chat <model>`. It records the provider, request and response model, input and output tokens, finish reason, role and ladder step.
- Spans and logs never carry PDF text, line items or keys. `apps/worker/src/telemetry.int.test.ts` runs the real processes and fails on a forbidden attribute key, or on a planted canary in any exported span or log line.

**Metrics** (`packages/telemetry/src/metrics.ts`):
- queue depth per queue and state, and dead letters waiting
- job duration and wait (histograms), and retries by error class
- model tokens, paid-equivalent cost (paid prices from `packages/llm/prices.json`, even on free tiers) and provider 429s
- extraction escalations and fallbacks, the extract circuit breaker, needs_review by reason, and intake 503s

![The FreightAudit dashboard during the k6 load test](docs/screenshots/grafana-load-test.png)

**Alerts** (`infra/prometheus-alerts.yml`, evaluated by Prometheus and listed in Grafana's Alerting page):
- dead letters waiting for 10 minutes
- extract wait p95 above 60 s for 5 minutes
- paid-equivalent cost per invoice above $0.05 over the last hour
- the circuit breaker open

`docker run --rm -v "$PWD/infra:/infra:ro" --entrypoint promtool prom/prometheus:v3.15.0-busybox test rules /infra/prometheus-alerts.test.yml` checks that each rule fires and stays quiet at the right times; CI runs it.

## Load test

Two k6 runs (`loadtest/k6.js`, run by the compose service `k6` from the pinned `grafana/k6` image) measure different things. Each writes `loadtest/<scenario>-results.json`, and those files fill the last two rows of the eval table.

Run k6 from PowerShell. Git Bash rewrites `/loadtest/k6.js` into a Windows path unless `MSYS_NO_PATHCONV=1` is set.

### Part 1: system load at 3x the normal rate, on the recorded-fixture model provider

This part does not use real models.
- **Load:** the normal rate is the design's throughput target, 2,000 invoices an hour. The run sends 2 minutes at 2,000/h, then 10 minutes at 6,000/h, to 2 workers x concurrency 8.
- **Model calls:** `pnpm --filter @freightaudit/llm fixture-models` answers every call with the real Groq or Gemini response recorded for `packages/llm/fixtures/{digital,scanned}.pdf`, after 2,300 ms (the eval's measured extraction p50).
- **Uploads:** byte-variants of those two PDFs, 4 digital to 1 scanned.

**Result (2026-10-15 UTC):**
- 1,083 uploads: all accepted, all reconciled, none lost or refused.
- Upload latency p50 30 ms, p95 86 ms, p99 155 ms.
- Throughout the 3x phase the extract queue held about 4 active jobs and none waiting, so its depth plateaued (dashboard above).
- Every invoice was final within 5 s of the last upload.

```powershell
pnpm db:reset
Get-Content loadtest/fixture-shipments.sql -Raw | docker exec -i freightaudit-postgres-1 psql -U freightaudit -d freightaudit
pnpm --filter @freightaudit/llm fixture-models   # :4011
# In apps/api, then twice in apps/worker (the second with $env:WORKER_PORT=4002), each in its own terminal:
node --env-file=../../.env --env-file=../../loadtest/system.env --import ./src/telemetry.ts src/main.ts
docker compose --env-file .env -f infra/docker-compose.yml run --rm k6 run -e SCENARIO=system /loadtest/k6.js
```

### Part 2: end-to-end latency at low load with real free-tier models

- **Cases:** 20 single-page golden v1 invoices, 10 digital and 10 scanned.
- **Pace:** one every 15 s, below the free tiers' ceiling of about 394 an hour, so the run measures latency, not throttling. The worker logged no 429.
- **Timing:** each invoice is timed from its upload request to its final status.

**Result (2026-10-15 UTC):**
- All 20 reconciled.
- p50 3,108 ms, p90 4,162 ms, max 4,663 ms. n = 20 gives no meaningful p95, but even the max is under the 30 s target.
- The run used about 32K tokens of the daily free quotas.

```powershell
# In apps/api: the api, with rate limits raised for k6's 500 ms polls.
node --env-file=../../.env --env-file=../../loadtest/e2e.env --import ./src/telemetry.ts src/main.ts
$env:AI_ENABLED='true'; pnpm --filter @freightaudit/worker dev   # the real models from .env
pnpm --filter @freightaudit/mock-tms dev
docker compose --env-file .env -f infra/docker-compose.yml run --rm k6 run -e SCENARIO=e2e /loadtest/k6.js
```

## CI/CD

GitHub Actions, with every action pinned to a commit SHA, every tool image to a digest, and per-job token permissions.

- `ci.yml` (pull requests, and the checks of `release.yml`): lint and typecheck (plus actionlint and the promtool alert rule tests), unit tests (`pnpm test --force`, so a cached pass never counts), integration tests (Testcontainers and the Playwright Chromium), contracts (`contracts:check` and oasdiff against the base), migrations (all of them on a fresh database, and this change's on a seeded snapshot built from the base, which must end in the same schema), golden set checksums, the eval smoke (`pnpm eval --suite extraction --subset ci` on same-repository PRs, report posted as a PR comment; a broken floor fails, a quota stop only warns), a Docker build and Trivy scan per image, gitleaks and `pnpm audit`.
- `release.yml` (push to main): the same checks, then `ghcr.io/<owner>/freightaudit-{api,worker,web}` tagged `sha-<short>` and `latest` with provenance, then migrate and deploy jobs that stay off until step 10.
- `nightly-eval.yml`: the full eval weekly (Mondays 03:23 UTC) or on demand, report as an artifact, an issue when a floor breaks; re-running that workflow run resumes from its cached cases.

Repository secrets: `GEMINI_API_KEY` and `GROQ_API_KEY`; optionally `TURBO_TOKEN` with the variable `TURBO_TEAM` for Turborepo Remote Cache. Images build from the repository root: `docker build -f apps/api/Dockerfile .` (or `apps/worker`, `apps/web`).

See `docs/context.md` for the design and `docs/todo.md` for the build plan.
