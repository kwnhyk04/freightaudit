# Memory

Persistent project knowledge for future sessions. Keep entries concise and accurate. Never invent history or decisions. Do not duplicate what is already in `context.md`.

Entry format: `- YYYY-MM-DD: <fact or decision>. Reason: <why>.`

## Decisions and Reasoning

From the approved design doc:

- 2026-10-13: The LLM never computes money. Reason: keeps financial results deterministic and auditable.
- 2026-10-13: Contracts are spec-first (openapi.yaml, schema.graphql). Reason: the spec is the source of truth for typed clients.
- 2026-10-13: BullMQ on Redis for queues. Reason: common in TypeScript teams; supports retries, flows, rate limiting. It has no native DLQ, so final failures move to a dead-letter queue in code.
- 2026-10-13: Golden eval set is generated from JSON, so ground truth is exact and no hand labels are needed.
- 2026-10-13: Jest for tests. Reason: user requested Jest.
- 2026-10-14: TypeScript pinned to ~6.0 in the pnpm catalog. Reason: typescript-eslint 8.71 supports TypeScript <6.1, and the TypeScript 7 package ships without the classic JS API.
- 2026-10-14: MinIO image is `pgsty/minio` at a pinned release. Reason: upstream `minio/minio` images were deleted from Docker Hub, Quay requires auth, and the upstream repo is archived.
- 2026-10-14: Apps run `.ts` directly in dev via Node type stripping; relative imports use `.ts` extensions and `tsc` rewrites them (`rewriteRelativeImportExtensions`). Reason: no tsx or ts-node dependency. Only erasable syntax is allowed (no enums, namespaces, parameter properties).
- 2026-10-14: Each package declares the tools it uses; shared versions live in the `catalog:` of `pnpm-workspace.yaml`. Reason: correct Turborepo cache hashing with one version source.
- 2026-10-14: Compose ports bind to 127.0.0.1, and Grafana uses host port 3001. Reason: least privilege; web owns port 3000.
- 2026-10-14: graphql is pinned to 16.x (approved by the user). Reason: graphql-eslint 4.4 (latest stable) supports graphql ^16 only.
- 2026-10-14: REST JSON uses snake_case and lowercase enum values; GraphQL uses camelCase fields and UPPER_CASE enum values (approved by the user). Reason: each follows its ecosystem; graphql-eslint naming-convention enforces the GraphQL side.
- 2026-10-14: Money crosses the wire as integer cents in JSON numbers (OpenAPI int64, GraphQL `Cents` scalar). Server resolver types map `Cents` to bigint; client types map it to number. Reason: bigint cannot be JSON-serialized, and cents stay within the safe integer range.
- 2026-10-14: Multipart uploads use @fastify/multipart `keyValues` with a streaming `onFile` that hashes each file and sniffs `%PDF-`, then replaces the bytes with the SHA-256 digest. Reason: openapi-glue validates multipart bodies against the spec; the schema checks structure only, so one bad file never fails a batch.
- 2026-10-14: Batch responses wrap per-file results as `{ results: [...] }` (approved by the user). Reason: an object body can grow new fields without breaking clients.
- 2026-10-14: Discrepancy `evidence` is a text explanation; the line item, shipment and rate card version are separate reference fields (REST `line_item_id`, `shipment_id`, `rate_card_version_id`). Approved by the user.
- 2026-10-14: `Invoice.discrepancies` is a Relay connection (first, after, status); the root `discrepancies` query stays for cross-invoice review. `Invoice.lineItems` is a plain list because line items are bounded per invoice. Reason: user direction; the schema follows the domain, not lint rules.
- 2026-10-14: `contracts:check` regenerates and compares file contents instead of using git diff; `contracts:breaking` diffs against `git show origin/main` with the pinned `tufin/oasdiff:v1.33.0` image. Reason: works before git exists; Docker is already required.
- 2026-10-14: Default to free-tier LLMs behind a provider switch: Gemini Flash primary, Groq for text, a different provider as fallback (user decision). Reason: no paid API budget; free tiers are enough for synthetic data. Free tiers may train on prompts, so only synthetic data goes through them.
- 2026-10-14: Production foundations are built from the start (env config validation, secrets hygiene, /readyz, structured logs, rate limiting, AI budget guard, security scans). Reason: the same images run locally and deployed.
- 2026-10-14: Deploy as a hybrid: UI on Vercel, backend on the user's PC via Tailscale Funnel; the browser reaches the API only through Next.js server routes. Reason: about $0 hosting, and the API key never reaches the browser.
- 2026-10-14: Env validation is `loadEnv(keys)` in `@freightaudit/config/env` (zod 4, built to `dist/`); each service lists the keys it reads, and only settings that code reads are in the schema. Reason: one catalog, no dead validation; settings for later steps stay in `.env.example` only.
- 2026-10-14: Each Node service has its own port variable (`API_PORT`, `WORKER_PORT`, `MOCK_TMS_PORT`). Reason: one root `.env` feeds every app, so a shared `PORT` would collide.
- 2026-10-14: The API key check is a Fastify `onRequest` hook with a public allowlist (`/healthz`, `/readyz`), not openapi-glue `securityHandlers`. Reason: openapi-glue runs security as a `preHandler`, after multipart parsing and validation, so uploads without a key would be streamed and bad requests would get 400 before 401. The contract test keeps the allowlist in line with the spec's `security`.
- 2026-10-14: `API_KEYS` is a comma-separated list of keys of at least 32 characters, compared as SHA-256 digests with `timingSafeEqual`. Reason: rotation without downtime and constant-time comparison.
- 2026-10-14: Readiness uses TCP connects for Postgres and Redis and MinIO's `/minio/health/live`, with a 2 s timeout. Reason: no database or Redis client exists before steps 3 and 4; Postgres 18 logs nothing for probe connections that send no data (checked).
- 2026-10-14: The gitleaks hook is a plain `.githooks/pre-commit` enabled by `core.hooksPath` from the root `prepare` script; it prefers a local gitleaks and falls back to `ghcr.io/gitleaks/gitleaks:v8.30.1`. Reason: no hook-manager dependency, and Docker is already required.
- 2026-10-14: In production Toxiproxy runs only with `--profile chaos`. Reason: its proxies would publish Postgres and Redis ports.

## Preferences and Instructions

- 2026-10-14: The three portfolio projects run in parallel Claude Code sessions on one PC, sharing Docker. Each project has its own port range and compose project name; never prune or remove another project's Docker resources (user setup).
- 2026-10-13: General coding rules live in `AGENTS.md`. `CLAUDE.md` imports it so Claude Code loads the rules.
- 2026-10-13: Markdown filenames use kebab-case (for example `docs/migrations.md`).
- 2026-10-14: Do not shape the schema around a lint rule; configure the rule narrowly instead (user instruction).
- 2026-10-14: The ecc config-protection hook blocks agent edits to ESLint config files. Show the exact lines; the user applies them.

## Solved Problems

- 2026-10-14: Worker `/healthz` refused connections on 127.0.0.1 because `node:http` `listen(port, 'localhost')` bound only `::1`. Fixed by using Fastify, which binds every localhost address.

## Known Issues and Pitfalls

- 2026-10-14: pnpm 12 fails `install` when a dependency has build scripts not listed in `allowBuilds` (`pnpm-workspace.yaml`). Current entries deny @parcel/watcher, @swc/core and unrs-resolver; their prebuilt binaries suffice.
- 2026-10-14: pnpm's release-age gate silently adds `minimumReleaseAgeExclude` entries when a spec needs a version published in the last day. Prefer an older version instead (fastify is `^5.12.5` for this reason).
- 2026-10-14: pnpm 12 writes task-run state with long file names under `node_modules/`; very deep checkout paths hit the Windows path limit ("os error 3").
- 2026-10-14: Jest runs ESM through `node --experimental-vm-modules node_modules/jest/bin/jest.js`, so every tested package needs `jest` as a devDependency.
- 2026-10-14: Write regexes inside config strings with character classes (`[.]`), not backslash escapes. A lost escape once loosened the domain import rule; lint caught it.
- 2026-10-14: Under Jest, `structuredClone` comes from the host realm, and Fastify lowercases header schemas only when their prototype is the realm's `Object.prototype`, so mixed-case required headers failed only in tests. `packages/config/jest-realm.js` rebuilds clone results in the test realm.
- 2026-10-14: Fastify response serialization (fast-json-stringify) writes schema `const` values regardless of handler output, so the contract test cannot catch `const` mismatches.
- 2026-10-14: graphql-eslint `schema-recommended` (strict-id-in-types) conflicts with Relay types. The fix exempts only `PageInfo` and `*Connection`/`*Edge` types in `packages/contracts/eslint.config.js`; the user applies it (still pending on 2026-10-14). `relay-edge-types` has no per-field exception, so `Invoice.lineItems` keeps one inline disable whose reason is its schema comment.
- 2026-10-14: The npm package named `oasdiff` is a security placeholder. Never install it; use the Docker image.
- 2026-10-14: Compose reads `.env` from the project directory (`infra/`), not the working directory, so the root `.env` reaches the compose files only with `--env-file .env`.
- 2026-10-14: `next dev` copies the parent's Node flags into `NODE_OPTIONS` for its child process, and `--env-file-if-exists` is not allowed there (exit 9). The web app cannot load the root `.env` through Node flags.
- 2026-10-14: Fastify's `req` log serializer rewrites any logged `req` key, so redaction tests must log credentials under other keys.
- 2026-10-14: Git for Windows sets `core.autocrlf=true` system-wide; `.gitattributes` keeps `.githooks/*` at LF so the hook runs under sh. Files added on Windows get mode 644: stage the hook with `git add --chmod=+x` so it runs on Linux and macOS.
- 2026-10-14: Turborepo runs tasks in strict env mode: only declared variables reach a task, so tests pass every setting explicitly and apps read `.env` themselves.

## Rejected Approaches

None yet.

## Lessons Learned

None yet.

## Constraints

None yet.

## Unresolved Questions

- 2026-10-14: Free-tier rate limits (requests and tokens per minute and day) will cap throughput and slow full eval runs. Check each provider's console before a big run.
- 2026-10-14: Dollar cost targets apply only on a paid tier.
