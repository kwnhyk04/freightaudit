# To-Do

Concise, verifiable tasks. Move items between sections as status changes. Trim old completed items when the list grows large; the activity log keeps the history.

Each step maps to a Claude Code prompt in the design doc. Done when the check after the colon passes.

## Pending

- [ ] (manual) Get free API keys: Google AI Studio (Gemini) and Groq. Put them in `.env`, never in the repo.
- [ ] (manual, before step 7) GitHub repo created; provider keys added as Actions secrets.
- [ ] (manual, before step 10) Vercel and Tailscale accounts created.
- [ ] Before step 10: move the Postgres and MinIO credentials that the production override inherits into `.env`: the prod stack starts without the dev-only `freightaudit` values in the compose files.
- [ ] Before step 7: CI runs `pnpm test:int` on a Docker host (Testcontainers) with the Playwright Chromium installed. Make the Toxiproxy test's fake TMS reachable from its container on a Linux engine, where `host-gateway` does not reach the host's 127.0.0.1 (for example, bind it to the Docker bridge address there).
- [ ] Before step 10: run migrations in the production deploy (`node packages/db/dist/migrate.js`) before api and worker start.
- [ ] Before step 10: run the worker with a stop grace period longer than its slowest job (60 s model timeout), so SIGTERM lets running jobs finish.
- [ ] With step 6: the reconcile job applies `reconcileInvoice` (`packages/domain`): it saves the discrepancies and ends at reconciled or needs_review, passing the charge codes of the shipment's earlier invoices as `billedBefore`. Needs an expand/contract change for per-mile bands, a minimum and a fuel percentage on rate card versions (today one flat amount per charge code) and miles on shipments. Today the job is a stub that leaves invoices at reconciling.
- [ ] With step 6: the Groq text path and fallback escalation.
- [ ] With step 6: circuit breaker for provider auth and config errors (401, 403, 404 model not found): pause the extract queue and raise an alert instead of dead-lettering every job. Test: one such error pauses the queue, no job is dead-lettered, and resuming processes the waiting jobs.
- [ ] 6. AI: pipeline built, golden dataset v1 created, eval report lists every target with pass or fail
- [ ] 7. CI/CD: GitHub Actions for test, build, docker push; actionlint passes; test PR green
- [ ] 8. Instrumentation: OpenTelemetry traces span services end to end; dashboard and alerts committed; screenshots saved
- [ ] 9. Review UI and demo mode: resolvers, login, backend-for-frontend, demo snapshot shown when the backend is offline; Playwright tests pass
- [ ] 10. Deploy: UI on Vercel, backend on the PC via Tailscale Funnel; phone test passes; 401 without API key; demo mode when the PC is off
- [ ] GraphQL resolvers for the review UI, including a runtime `Cents` scalar (bigint to JSON number)

## In Progress

None.

## Completed

- [x] Reconcile rules in `packages/domain` with fast-check properties: rate card version by ship date, linehaul (tiered per-mile, minimum), fuel surcharge, accessorials, duplicates on the invoice or earlier ones, discrepancies and reconciled or needs_review; 5 rule mutations each fail the tests (2026-10-14).
- [x] Stale test containers are chosen by the `freightaudit.test-run` label only (Docker filter plus `staleTestContainers`), with a unit test over other projects' containers; a dry run over the 16 containers on this host selected none (2026-10-14).
- [x] Token bucket test runs on an injected clock; with the Redis clock instead it fails (2026-10-14).

- [x] 5. Tests: Jest projects unit (no I/O, enforced), integration (Testcontainers on 127.0.0.1) and contract; domain property tests with fast-check at 100 % coverage (threshold 90 %); keyset pagination under concurrent inserts; expand/backfill/contract under the api's queries; a 50-file batch with 5 corrupt files; worker retry and DLQ tests in the integration project; TMS sync through Toxiproxy (20 % resets, 300 ms latency). `pnpm test` (7 to 8 s) and `pnpm test:int` (13 to 14 s, 41 tests) passed three runs in a row (2026-10-14).
- [x] 4. Workers: extract (jobId = content hash, 5 attempts, jittered backoff with a Retry-After floor, budget guard, multi-invoice flow), stub reconcile, TMS sync every 5 minutes with a saved cursor; dead letters in `<queue>-dlq` and `dead_letters` with replay; Redis rate limits, 503 backpressure and input limits in the api; migration `0006`. `pnpm test:int` passed three runs in a row: 429 twice then success gives one extraction row, a SIGKILLed worker's job is recovered without duplicate rows, a poisoned job lands in both dead-letter stores and replays, the 11th upload gets 429, the budget guard delays jobs (2026-10-14).
- [x] Postgres and MinIO back the REST handlers, with keyset cursors; 429 and 503 carry Retry-After (2026-10-14).
- [x] The invoice lifecycle is enforced for every writer by the `0006` trigger (2026-10-14).
- [x] mock-tms: cursor pagination, 10 req/s limit with 429 and Retry-After, `FAULT_RATE` and `LATENCY_MS` (2026-10-14).
- [x] One invoice lifecycle in Postgres (`0005`), `openapi.yaml` and `schema.graphql`; clients regenerated and `contracts:check` passes; state machine recorded in `docs/context.md` (2026-10-14).
- [x] Byte-identical fixtures: seeded scan noise and pinned PDF dates; `generate-invoices.int.test.ts` renders the 6 templates twice and all 24 files match (2026-10-14).
- [x] 3. Data: the 5 migrations apply from empty; the backfill test passes on the small seed, including a crash and resume; a test shows the exclusion constraint rejects overlapping versions; `pnpm db:seed --scale=small|large` and `pnpm fixtures` run (2026-10-14).
- [x] Hook committed executable: `git ls-tree HEAD .githooks/pre-commit` shows mode 100755 in commit `2cb0a6c` (2026-10-14).
- [x] graphql-eslint `strict-id-in-types` exceptions (`PageInfo`, `*Connection`, `*Edge`) added to `packages/contracts/eslint.config.js` by the user: `pnpm lint` passes (2026-10-14).
- [x] Catch-up from the updated Prompts 1 and 2: env config validation at startup, gitleaks pre-commit, /readyz on every service, structured JSON logs, infra/docker-compose.prod.yml override, API key scheme plus 401/403 and RateLimit headers in openapi.yaml. Typecheck, lint and tests pass; every service answers /healthz and /readyz; the api exits with a clear error when a required env var is missing (2026-10-14).
- [x] Parallel-run setup: `name: freightaudit` (already present), monitoring services behind the `observability` profile, host ports configurable through `.env` with unchanged defaults (2026-10-14).
- [x] 2. Contracts: OpenAPI and GraphQL contracts, typed clients generated, contracts-check and breaking-change check pass (2026-10-14).
- [x] 1. Scaffolding: monorepo layout, docker-compose infra healthy, every service answers /healthz (2026-10-14).
- [x] Project created from template (2026-10-13).

## Blocked

None.
