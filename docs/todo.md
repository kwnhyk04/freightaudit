# To-Do

Concise, verifiable tasks. Move items between sections as status changes. Trim old completed items when the list grows large; the activity log keeps the history.

Each step maps to a Claude Code prompt in the design doc. Done when the check after the colon passes.

## Pending

- [ ] (manual) Get free API keys: Google AI Studio (Gemini) and Groq. Put them in `.env`, never in the repo.
- [ ] (manual, before step 7) GitHub repo created; provider keys added as Actions secrets.
- [ ] (manual, before step 10) Vercel and Tailscale accounts created.
- [ ] Before step 10: move the Postgres and MinIO credentials that the production override inherits into `.env`: the prod stack starts without the dev-only `freightaudit` values in the compose files.
- [ ] 3. Data: schema and migrations apply from empty, expand/contract series tested, seed scripts run
- [ ] 4. Workers: queue job with retries and dead-letter handling, backpressure and crash-recovery tests pass
- [ ] 5. Tests: unit and integration suites green three runs in a row
- [ ] 6. AI: pipeline built, golden dataset v1 created, eval report lists every target with pass or fail
- [ ] 7. CI/CD: GitHub Actions for test, build, docker push; actionlint passes; test PR green
- [ ] 8. Instrumentation: OpenTelemetry traces span services end to end; dashboard and alerts committed; screenshots saved
- [ ] 9. Review UI and demo mode: resolvers, login, backend-for-frontend, demo snapshot shown when the backend is offline; Playwright tests pass
- [ ] 10. Deploy: UI on Vercel, backend on the PC via Tailscale Funnel; phone test passes; 401 without API key; demo mode when the PC is off
- [ ] mock-tms behavior deferred from step 1: cursor pagination, 10 req/s rate limit, fault injection via `FAULT_RATE` and `LATENCY_MS`
- [ ] GraphQL resolvers for the review UI, including a runtime `Cents` scalar (bigint to JSON number)
- [ ] Replace in-memory REST stubs with Postgres-backed handlers and keyset cursors; emit 429 and 503 with Retry-After

## In Progress

None.

## Completed

- [x] Hook committed executable: `git ls-tree HEAD .githooks/pre-commit` shows mode 100755 in commit `2cb0a6c` (2026-10-14).
- [x] graphql-eslint `strict-id-in-types` exceptions (`PageInfo`, `*Connection`, `*Edge`) added to `packages/contracts/eslint.config.js` by the user: `pnpm lint` passes (2026-10-14).
- [x] Catch-up from the updated Prompts 1 and 2: env config validation at startup, gitleaks pre-commit, /readyz on every service, structured JSON logs, infra/docker-compose.prod.yml override, API key scheme plus 401/403 and RateLimit headers in openapi.yaml. Typecheck, lint and tests pass; every service answers /healthz and /readyz; the api exits with a clear error when a required env var is missing (2026-10-14).
- [x] Parallel-run setup: `name: freightaudit` (already present), monitoring services behind the `observability` profile, host ports configurable through `.env` with unchanged defaults (2026-10-14).
- [x] 2. Contracts: OpenAPI and GraphQL contracts, typed clients generated, contracts-check and breaking-change check pass (2026-10-14).
- [x] 1. Scaffolding: monorepo layout, docker-compose infra healthy, every service answers /healthz (2026-10-14).
- [x] Project created from template (2026-10-13).

## Blocked

None.
