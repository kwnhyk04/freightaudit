# Activity Log

Chronological record of development activity, newest first, with small events and mistakes included (AGENTS.md, Documentation Rules). Do not auto-commit this file. Entries before 2026-10-18 use the older format (Changes, Files, Validation, Outstanding) and stay as written.

## Entry Format

```
### YYYY-MM-DD: <task performed>

- <One item per event, small ones included: a failed command, a skipped check, a tool or prompt that behaved
  unexpectedly, a setting changed, a mistake.>
  - What happened: <...>
  - Why: <the cause, or "not confirmed" when it is a guess>
  - What we did: <the exact steps in order (commands, buttons, where each setting lives)>, and why that was the best option
- Files: <relevant files>
- Validation: <tests or checks run and results>
- Outstanding: <open issues, or "None">
```

## Entries

### 2026-10-18: UI round 1, the plan and phase A, the api (branch ui-round-1, not committed)

- **Plan:**
  - What happened:
    - The user asked for a plan first. The agent read AGENTS.md, context, memory, todo, the nine approved pictures and the web, contracts and api code, and a Plan agent reviewed the draft.
    - Two rounds of questions settled the scope: summary, search and backward paging; a new atomic `decideInvoice` with five conditions; marks on digital PDFs only under a one-place rule; no auto-approval.
    - They also settled pdf.js (an exact pin plus guard tests, since `isEvalSupported` is gone in 6.4.299), the ordinal and carrier-case rules for marks, and DISPUTE's audit rows (per finding only).
    - The user asked for five changes before approving: the legend wording; phase B from main once PR A is live; a README sample with a real overcharge; the scaling notes in Known Limitations; and to stop and give the command if deleting `duplicate-invoice-g071.pdf` is refused.
  - Why: two PRs, because Vercel deploys main on merge while the demo api changes only with `pnpm demo:up`.
  - What we did:
    1. Saved the plan as `C:\Users\kwonhyuk\.claude\plans\pasted-content-id-aa61-start-ui-melodic-scroll.md`.
    2. Created branch `ui-round-1` from main `5fb695e`.
    3. Wrote the "UI round 1" section in docs/todo.md first, moving the two Pending items into it.
- **Domain:** `packages/domain/src/findings.ts` (`overchargeCents`, `reviewAmounts`, `lineExpectedCents`), with examples and fast-check properties.
- **Contract:** additive changes in `schema.graphql`, then `pnpm --filter @freightaudit/contracts codegen`.
  - What happened: codegen left `openapi.ts`, `graphql-client/gql.ts` and `graphql-client/graphql.ts` marked modified with no content change.
  - Why: it writes LF where checkout had written CRLF (`core.autocrlf=true`).
  - What we did: restored them with `git checkout --`; GateGuard asked for the facts first. That made the first `contracts:check` fail later (see memory's pitfall), and the files are LF again now.
- **Api:**
  - `keyset.ts` gains `before()` and page flags.
  - `invoices` gains `last`, `before`, `search`, `totalCount` and `offset`.
  - New: `invoiceSummary`, `Discrepancy.version` and `decideInvoice`.
  - `resolveDiscrepancy` now locks the invoice first.
  - Small event: before relying on it, a read-only query on the dev database confirmed that Postgres accepts a correlated `NOT EXISTS` inside `FILTER`.
- **Tests:**
  - What happened: the first run passed 16 of 18.
  - Why: two decide tests counted the seed's upload keys too, which about 70 % of seeded invoices have.
  - What we did:
    1. `keysOf` now counts only `decide:%` keys; then 18 of 18 passed.
    2. Two mutation checks, each failing its test as it should: the old lock order failed the deadlock test, and a removed version check failed the "changed" test.
- **Agent mistake:**
  - What happened: a `sed -i` ran by accident and removed the version check.
  - Why: see memory, Lessons Learned.
  - What we did: used it once as the version mutation above, restored the line with Edit, and the decide tests passed 9/9 again.
- **Lint:**
  - What happened: `pnpm lint` fails only on `strict-id-in-types` for `InvoiceSummary` and `InvoiceStatusCount`. An earlier run also caught four unused names in the test's `shape` helper, now rewritten.
  - Why: the config-protection hook blocks agent edits to ESLint configs.
  - What we did: handed the user the exact lines for `packages/contracts/eslint.config.js` (line 28, and the comment on line 19).
- Files:
  - docs/{todo,context,memory,activity-log}.md
  - packages/domain/src/{findings.ts,findings.test.ts,index.ts}
  - packages/contracts/schema.graphql, packages/contracts/src/generated/graphql-resolvers.ts
  - apps/api/src/{keyset,loaders,graphql,review}.ts
  - apps/api/src/{graphql,decide}.int.test.ts
- Validation:
  - Domain unit tests 36, coverage 100%.
  - `pnpm typecheck` 21/21; `pnpm turbo run test --force` 18 tasks.
  - `pnpm test:int` 115/115 in 23 suites.
  - `pnpm contracts:check` passed on its second run; `OASDIFF_BASE_REF=main pnpm contracts:breaking` found no changes.
  - `pnpm e2e` 9/9; `pnpm lint` 11 of 12 (contracts waits for the ESLint line).
  - Skipped: the plan's GraphQL call against a running dev api, since the integration tests send the same queries through the real api app and Postgres.
- Outstanding:
  1. The user applies the ESLint lines and reruns `pnpm lint`.
  2. The user commits phase A and opens PR A.
  3. After merge, Release and `pnpm demo:up`, the agent checks the demo api's revision label (read-only).
  4. Phase B.

### 2026-10-18: Vercel deploys main by branch rule, not by VERCEL_ENV (branch fix/vercel-production-builds, not committed)

- **Branch:**
  - What happened: `git switch -c fix/vercel-production-builds` from main `dc6703b`. It carries the doc updates made since #21 (activity log, context, memory, todo).
  - Why: the user asked for those updates to go in this change set.
  - What we did: created the branch on top of the working tree.
- **What the user found in Vercel (setting checked):**
  - What happened: the Production environment tracks main, and "Automatically expose System Environment Variables" is on. Settings, Build and Deployment, Ignored Build Step reads "Overridden" by the vercel.json command, with the dashboard on Automatic. The canceled deployments' build logs cannot be opened.
  - Why: the canceled #20 and #21 builds.
  - What we did: kept the cause as unknown, and made the fix independent of `VERCEL_ENV`.
- **Docs checked before the change:**
  - What happened: Vercel's Git configuration page (updated 2026-08-25) gives `git.deploymentEnabled` as branch-pattern-to-boolean or a boolean, default `true` for unlisted branches, with minimatch patterns. It also says: "If a branch matches multiple rules and at least one rule is `true`, a deployment will occur."
  - Why: the user asked for the matching to be confirmed before relying on it, since branch names here contain slashes.
  - What we did: fetched the page. It agrees with `{"**": false, "main": true}`, so we went ahead.
- **Change:**
  - What happened: `apps/web/vercel.json` lost `ignoreCommand` and gained `git.deploymentEnabled` `{"**": false, "main": true}`. `node -e` parsed it. No test or workflow reads the file (searched).
  - Why: a rule by branch name cannot be affected by what `VERCEL_ENV` held during the ignore step.
  - What we did: updated docs/deploy.md (Vercel step 2, a section on why, the checks after merge), docs/context.md, docs/memory.md (decision) and docs/todo.md (In Progress). GateGuard asked for facts before the first edit of `vercel.json`, as before.
- Files: apps/web/vercel.json, docs/{activity-log,context,deploy,memory,todo}.md
- Validation: the JSON parses. Nothing else applies before merge; the checks after merge are in docs/deploy.md.
- Outstanding: the pull request, merge, and the checks after merge. Nothing committed.

### 2026-10-18: Phone test closed (not committed)

Times are UTC.

- **The user's answers:**
  - What happened: the user confirmed uploading g001 from the Upload page during the second try, and said that sign-out landed on the login page.
  - Why: the reply in the previous entry had left both as placeholders.
  - What we did: recorded both. The `POST /v1/invoices` (200) at 19:31:59 was therefore the user's own upload of an existing file, and production's sign-out answered with its redirect to `/login`. We closed the phone test in docs/todo.md: one document request for the view, none for the three zooms.
- **Scanner probe:**
  - What happened: at 19:38:18 the api answered `GET /wp-content/plugins/translatepress-multilingual/readme.txt` with 401 in 1 ms.
  - Why: the Funnel's certificate puts its hostname in public certificate logs, which scanners read. Every route but the probes needs `X-API-Key`.
  - What we did: nothing; it was the expected answer.
- Files: docs/{activity-log,todo}.md
- Outstanding: the cause of the skipped Vercel builds (docs/todo.md, Pending). Nothing committed.

### 2026-10-18: Phone test, second try: one document request, no refetch on zoom (not committed)

Times are UTC.

- **Answers left as placeholders:**
  - What happened: the user's pasted reply kept "[the login page / something else]" and "[did / did not]" unfilled.
  - Why: not confirmed; probably pasted before being filled in.
  - What we did: answered both cases from the log and the code. Where sign-out landed stays not reported.
- **The POST /v1/invoices at 19:31:59:**
  - What happened, in order:
    - 19:31:46: a live page loaded (`/readyz`, `/graphql`).
    - 19:31:49: a `/readyz` alone, as the upload page renders without GraphQL.
    - 19:31:58.678: `/readyz`, the upload action's liveness probe.
    - 19:31:59.171: `POST /v1/invoices` answered 200 in 219 ms.
    - 19:31:59.931: `/graphql` for the invoice page.
    - 19:32:02.431: `GET /v1/invoices/01a14b05-…/document` answered 200 in 7 ms.
  - Why: only the web's `upload` server action (`apps/web/app/actions.ts:79`) sends that request. It needs a session and a file chosen in the upload page's form, and its redirect opens the invoice. The upload page's samples are download links (`<a href="/samples/<file>" download>`) and send nothing. The file matched g001 by content hash, so the api answered 200. Per `apps/api/src/service.ts:76-109` that inserts no invoice, queues nothing (g001 is reconciled) and records one `idempotency_keys` row. The rows confirm it: 1 key, 0 invoices, 0 model calls, 0 audit events, and g001 unchanged since 17:59:50.
  - What we did: read the api log from 19:31:30 with statuses, counted the rows written since 19:31 with `psql` (counts only), and read the upload page and the api's upload code.
- **Result:**
  - What happened: between 19:31:58 and the end of the log (19:35:14), the api saw exactly one document request, for the view. None came for the three zooms. After the view, three `/readyz` and `/graphql` pairs (19:32:26 to 19:32:41) were page loads or Next's link prefetches (not confirmed), with no document request.
  - Why: the viewer now fetches once per mount. The first try's 0 came from the phone's old copy, which was gone by the second try for the same URL. That is consistent with the first try's sign-out sending `Clear-Site-Data: "cache"`.
  - What we did: closed the cache item in docs/todo.md. The open Vercel question moved to Pending, out of the cache item's sub-items, where the previous update had put it by mistake.
- Files: docs/{activity-log,context,todo}.md
- Outstanding: the cause of the skipped Vercel builds (docs/todo.md, Pending). Nothing committed.

### 2026-10-18: #21 live on both sides; the phone's first view came from its old copy (not committed)

Times are UTC.

- **Forced redeploy (setting changed):**
  - What happened: the user found that Vercel's Production environment tracks main and that system environment variables are exposed. The user then redeployed the canceled `dc6703b` deployment with "Use project's Ignore Build Step" unticked, and it showed Ready.
  - Why: the merge's build had been canceled by the Ignored Build Step, as #20's was. The cause is still open (memory, Unresolved Questions).
  - What we did: added a todo to read the canceled build's log.
- **Check 1, production web:**
  - What happened: `GET /logout` on `freightaudit-bay.vercel.app` answered 405 at 19:25:39, with `x-vercel-id: sin1::hkg1::…`.
  - Why: the merged route accepts only POST, and the proxy no longer catches `/logout`.
  - What we did: `curl.exe -s -o NUL -D -`, printing the status line and two headers.
- **Check 2, api image:**
  - What happened: `freightaudit-prod-api-1` was started at 19:25:11 by the user's `pnpm demo:up`, with image `sha256:2ea34661…` and revision label `dc6703b12cbc…`. GHCR's `sha-dc6703b` and `latest` both point to that digest.
  - Why: Release run `39061034495` had finished its publish jobs by 19:10:46 (user).
  - What we did: `docker inspect --format` (image fields only), the image's labels, and HEAD requests on GHCR's manifests.
- **Phone test, first try:**
  - What happened: the user signed in, opened g001's PDF, zoomed in three times and signed out. From 19:25 to 19:30:24 the api logged 0 document requests, only page loads: `/readyz` 6 times and `/graphql` 2 times, all 200.
  - Why: not confirmed. The likely cause is that the phone's browser served the view from its copy of that PDF, stored under the old `immutable` header during the 17:56 to 17:59 tests, without asking. The zero for zooms is expected either way.
  - What we did: read the api log since 19:25 in full, beside the live watch. The test ended with a sign-out on the new web, whose `Clear-Site-Data: "cache"` should have cleared that copy, so the next step is a second try (docs/todo.md).
- Files: docs/{activity-log,memory,todo}.md
- Outstanding: the second phone try, then the cause of the skipped Vercel builds. Nothing committed.

### 2026-10-18: After #21 merged: neither the web nor the api runs it yet (not committed)

Times are UTC.

- **Api image:**
  - What happened: the running `freightaudit-prod-api-1` uses `ghcr.io/kwnhyk04/freightaudit-api@sha256:66e8b1b9…` (revision label `ae68611`) and was started at 18:22:27. GHCR had no `sha-dc6703b`, and its `latest` is the #20 build (revision `1493832`). The local `latest` tag is still the `ae68611` build.
  - Why: Release run `39061034495` for `dc6703b` had passed every check, integration and e2e included, but its four publish jobs were still running at 19:10. The `pnpm demo:up` the user mentioned pulled nothing new: whether it ran after #20 published is not confirmed.
  - What we did: read the container with `docker inspect --format` (image fields only), the image's labels, GHCR's tags and the `latest` config through the anonymous registry API, and the run's jobs through the GitHub API.
- **Web on Vercel:**
  - What happened: `GET /logout` on `freightaudit-bay.vercel.app` answered 307 to `/login?next=%2Flogout`, the old proxy's answer; the merged route would answer 405 to a GET. GitHub's status for `dc6703b` reads "Canceled by Ignored Build Step", as does #20's `1493832`. `ae68611`'s reads "Deployment has completed" (17:55, the user's redeploy).
  - Why: not confirmed. `vercel.json` cancels only when `VERCEL_ENV` is not `production`.
  - What we did: read the commit statuses (public GitHub API) and listed the Vercel settings to check in docs/todo.md.
- **Still 401:**
  - What happened: the production document URL without a session answered 401, with no `age` and no `x-vercel-cache`, and `x-vercel-id: sin1::…`.
  - What we did: `curl.exe -s -o NUL -D -`, printing only those headers.
- **Phone test held:**
  - What happened: the api log watch started at 19:10:36, but the test cannot tell old code from new yet.
  - Why: on the old web, zooms re-read the phone's year-long cached copy, so they send no request either.
  - What we did: asked the user to wait until production runs `dc6703b`.
- Files: docs/{activity-log,memory,todo}.md
- Outstanding: a production deployment of `dc6703b`, Release's publish then `pnpm demo:up`, then the phone test. Nothing committed.

### 2026-10-18: Documents never cached; sign-out clears the browser cache (branch fix/document-no-store, not committed)

- **Branch:**
  - What happened: the user asked for the document cache fix as its own small pull request.
  - Why: user decision, after `deploy/relay-allowlist` merged (PR #20, main `1493832`).
  - What we did: `git switch -c fix/document-no-store` on a clean main.
- **Headers:**
  - What happened: the web's `/api/invoices/[id]/document` and the api's `/v1/invoices/{id}/document` now answer `cache-control: private, no-store`.
  - Why: the year-long `immutable` header let a browser keep each viewed PDF after sign-out and show it while the backend was offline.
  - What we did: changed `route.ts:19` and `apps/api/src/service.ts:156`. No test pinned the old value.
- **Sign-out as a route handler:**
  - What happened: sign-out had to answer `Clear-Site-Data: "cache"`, and it was a server action.
  - Why: a server action cannot set response headers. Next 16.4's bundled `headers.md` calls `headers()` read-only, and `cookies()` writes only Set-Cookie.
  - What we did:
    1. Read Next's own check in `next/dist/server/app-render/action-handler.js` (lines 426-456): a request without an Origin passes; otherwise the Origin's host must equal the first `x-forwarded-host`, or Host.
    2. Wrote that rule as `sameOrigin` in `lib/session.ts`, and moved the cookie attributes there as `SESSION_COOKIE_ATTRIBUTES`, now shared by sign-in and sign-out.
    3. Added `app/logout/route.ts`. Its `POST` refuses another site with 403, expires the cookie, sets `Clear-Site-Data: "cache"` and answers 303 to `/login`.
    4. Pointed the shell's form at it (`method="post" action="/logout"`), removed `logout()` from `actions.ts`, and excluded `logout` in `proxy.ts`'s matcher so an expired session can still sign out.
    - Best because it is the smallest change that sends the header while keeping the action's protection and the `__Host-` cookie's attributes.
- **Viewer refetched on zoom:**
  - What happened: `DocumentViewer`'s effect depended on `[src, zoom]`, so every zoom click called `pdfjs.getDocument` and downloaded the whole PDF again.
  - Why: until now the year-long cache answered those fetches. With `no-store`, each zoom would cross Vercel and Funnel to the PC: one function invocation, one api request against the key's 60 a minute, and the whole file (uploads up to 4 MiB; the golden set's median is 45 KB), at about 0.5 to 1.7 s from this PC.
  - What we did: split the effect into a load per `src`, which destroys the loading task on unmount, and a redraw per zoom. `InvoiceDetail` keys the viewer by `src`. The e2e checks that zooming sends no request. A small, contained change, so it is made here rather than listed.
- **Tests:**
  - What happened:
    - Unit: a `sameOrigin` test in `lib/auth.test.ts`, covering same host, no Origin, x-forwarded-host, another host, another port, `null`, a malformed Origin, a missing Host, and a forwarded host that differs.
    - e2e, `main.spec.ts`: the viewer's own document response and the api's response carry `private, no-store`; a sign-out posted with `Origin: https://evil.example` gets 403 and the session stays; sign-out answers 303 with `Clear-Site-Data: "cache"` and leaves no `__Host-session`; zooming redraws without a request.
  - Why: user request.
  - What we did: wrote them beside the existing tests of the same code.
- **First e2e run, 2 of 9 failed (agent mistakes in the new tests):**
  - What happened: (1) the sign-out check found no `clear-site-data`; (2) the zoom check timed out waiting for the canvas to grow.
  - Why:
    - (1) Playwright's `response.headers()` leaves out headers it counts as security-related. This is confirmed by the fix: only the header source changed, and the 303 held.
    - (2) `.doc-pages canvas { max-width: 100% }` (`globals.css:482`) caps the shown width, so `clientWidth` cannot grow.
  - What we did: used `allHeaders()` for (1), and the canvas bitmap's `width` for (2). The second run passed 9 of 9.
- **Zoom in shows nothing (found):**
  - What happened: the same CSS rule means zoom in only sharpens a page; only zoom out is visible.
  - Why: it predates this change.
  - What we did: added it to docs/todo.md. There is no UI round 1 section there.
- **AGENTS.md showed as modified:**
  - What happened: `git status` listed AGENTS.md, which this change does not touch.
  - Why: turbo rewrites its managed block when an agent runs it, here with LF line endings. `git diff -- AGENTS.md` is empty, so nothing would be committed.
  - What we did: left it alone.
- **GateGuard:**
  - What happened: the hook blocked the first touch of each of the 11 files.
  - Why: its fact-forcing gate.
  - What we did: listed references, affected functions, data and the user's words, then retried each call.
- Files: apps/api/src/service.ts, apps/web/{app/actions.ts, app/api/invoices/[id]/document/route.ts, app/logout/route.ts (new), components/client.tsx, components/shell.tsx, components/views.tsx, e2e/main.spec.ts, lib/auth.test.ts, lib/session.ts, proxy.ts}, docs/{activity-log,context,memory,todo}.md
- Validation: lint 12/12, typecheck 21/21 (web lint and typecheck again after the spec fixes), `pnpm turbo run test --force` 18 tasks (web 7, api 7), `pnpm e2e` 9/9 in 28.0 s on the dev stack.
- Outstanding: the pull request and merge, then the deploy steps (docs/todo.md, In Progress); clearing the phone's old copies. Nothing committed.

### 2026-10-18: Production domain checks; step 10 done (not committed)

Times are UTC.

- **Production domain:**
  - What happened: the user sent `https://freightaudit-bay.vercel.app/invoices`, which gives the production domain `freightaudit-bay.vercel.app`.
  - Why: the two waiting checks needed it.
  - What we did: ran them with it.
- **Shared-cache check:**
  - What happened: two requests without a session for `/api/invoices/01a14b05-1cee-75c3-89b7-72b9d2ea3a18/document` at 18:26:57 both got 401. They carried `cache-control: public, max-age=0, must-revalidate`, no `age`, no `x-vercel-cache` and `x-vercel-id: sin1::<id>`.
  - Why: `proxy.ts` refuses `/api/` without a session cookie, and the edge-only id shows it answered before any function.
  - What we did: `curl.exe -s -o NUL -D -`, printing only the status line and those headers. This was the user's method, in place of the private-window and DevTools steps. It shows that a request without a session cannot get a stored copy. That none is stored rests on the code: the `private` header and a route rendered per request.
- **Region:**
  - What happened: `/login` (200) and `/healthz` (200) carried `x-vercel-id: sin1::hkg1::…` and `x-vercel-cache: MISS`.
  - Why: the functions run in `hkg1`. The 401s above came from the edge, which names no region.
  - What we did: read the region from function responses, and noted the difference in docs/memory.md.
- **Protection and `crypto.argon2`:**
  - What happened: the production domain answered without Vercel's login, while the generated URLs had redirected to it. `/login` answered 200 from a function.
  - Why: Standard Protection. The web's startup check exits without `crypto.argon2`, so a function that answers has it.
  - What we did: closed the argon2 todo item on that evidence. The runtime log itself was not read.
- **Live again:**
  - What happened: the Funnel answered `/healthz` 200, and the api logged the web's `GET /readyz` and `POST /graphql` (200) at 18:26:30 and 18:26:31.
  - Why: a signed-in page load after `pnpm demo:up`.
  - What we did: marked step 10 done in docs/todo.md and docs/context.md, as the user asked once these held. Its two offline gaps stay Pending.
- **Not tested:**
  - What happened: the `POST /login` rate-limit rule was not checked.
  - Why: tripping it would block the IP it is tested from.
  - What we did: added an optional check to docs/todo.md.
- Files: docs/{activity-log,context,memory,todo}.md
- Validation: the responses above.
- Outstanding:
  - The document cache fix (its own pull request after `deploy/relay-allowlist` merges).
  - The offline 404.
  - The relay-probe measurement.
  - The optional `POST /login` check.
  - The address bar and banner answers, not reported.
  - Nothing committed.

### 2026-10-18: Back online after the offline test; two checks wait for the production domain (not committed)

Times are UTC.

- **Answers left as placeholders:**
  - What happened: the user's pasted reply kept its three answers as template placeholders: the address bar, the pages with the banner, and the production domain.
  - Why: not confirmed; probably pasted before being filled in.
  - What we did: ran every check that needs no domain and asked for the domain again. The address bar and banner answers stay "not reported".
- **Back online:**
  - What happened: after the user's `pnpm demo:up` (finished 18:23), all seven containers were healthy and the Funnel answered `/healthz` 200 and `/v1/invoices` 401 without a key. The new squid container denied nothing, and tailscaled's relay probes succeeded.
  - Why: as designed. The relay pattern held on a later start, which is the check docs/deploy.md asks for.
  - What we did: `docker ps`, `curl.exe` on the Funnel, and `docker logs` of the api and squid.
- **No web request yet:**
  - What happened: since its start, the api had logged only `demo:up`'s own `GET /v1/invoices` (18:23:30) and the agent's (18:23:47), both 401.
  - Why: the web asks the api only for a signed-in visitor, and nobody had loaded a page since the restart.
  - What we did: kept step 10 open. The user's condition is one web request in the api log.
- **Skipped, waiting for the domain:**
  - What happened: two checks did not run: the two requests without a session for `/api/invoices/01a14b05-1cee-75c3-89b7-72b9d2ea3a18/document`, and the `hkg1` check from `x-vercel-id`.
  - Why: no production domain.
  - What we did: listed both under step 10 in docs/todo.md.
- **Wrong count (mistake):**
  - What happened: the agent's first squid summary reported 0 relay tunnels; there were 168.
  - Why: its pattern expected `TCP_TUNNEL/200 CONNECT`, but squid writes the byte count between the two.
  - What we did: listed the tunnels, matched `TCP_TUNNEL/200 \d+ CONNECT derp`, corrected it in the report, and added the format to docs/memory.md.
- **Relay probes (observation):**
  - What happened: squid logged 168 relay tunnels in the first 116 s after the start, one relay in each of 28 regions about every 26 s, 906,367 bytes in all. At that rate that is about 5,200 log lines and 27 MB an hour.
  - Why: with UDP blocked, tailscaled's netcheck measures every region over HTTPS. Whether the rate stays that high is not confirmed.
  - What we did: added a check to docs/todo.md.
- **Cache fix scope (user decision):**
  - What happened: the user decided that the document cache fix goes in its own small pull request after `deploy/relay-allowlist` merges, and that the api's `/v1/invoices/{id}/document` switches to `no-store` too.
  - Why: user decision.
  - What we did: updated the todo item and recorded the decision in docs/memory.md. No code changed.
- **Refused edit (failed command):**
  - What happened: an edit of docs/memory.md was refused with "No changes to make", because its old and new text were the same.
  - Why: the agent sent a placeholder edit by mistake. The intended text was the decision entry, written right after.
  - What we did: wrote the decision entry with a real edit.
- Files: docs/{activity-log,memory,todo}.md
- Validation: the container, Funnel and log readings above.
- Outstanding:
  - The production domain, then the two requests without a session and the `hkg1` check.
  - One signed-in page load, then marking step 10 done.
  - Nothing committed.

### 2026-10-18: Offline reload of a live invoice ends at a 404 (not committed)

- **Offline 404:**
  - What happened: with the backend stopped (`docker ps -a` listed no `freightaudit-prod` container), the user reported that the phone "went back to error 404".
  - Why:
    - Read as the reloaded invoice page. `livePage` redirects an offline live page to its `/demo` twin, and `demoInvoice(id)` knows only the snapshot's 11 ids, so a live id gets `notFound()`.
    - With no `not-found.tsx` in `apps/web/app`, Next shows its default 404 page outside the demo shell, without the banner.
    - It also fits the previous entry: the PDF shown earlier came from the browser's copy, not from a page reload.
    - Which page the user reloaded is not confirmed. If it was the document URL from the private-window check, a 404 there means a malformed id, since a stopped api gives 502.
  - What we did: read `app/demo/[[...path]]/page.tsx` and `app/demo/layout.tsx`, searched for `not-found.tsx` (none), and checked the containers. We added the fix to docs/todo.md and changed no code. Best because the fix touches the sample's routing and an e2e spec, which deserve their own change.
- Files: docs/{activity-log,context,memory,todo}.md
- Validation: none beyond the reads above.
- Outstanding: the checks listed in the previous entry, and whether the invoice list showed the sample under the banner.

### 2026-10-18: Phone test against the live api, and a PDF shown while offline (not committed)

Times are UTC.

- **Watching the api log:**
  - What happened: the user asked the agent to watch the api's requests during a phone test.
  - Why: the previous check had found no request from the web at all.
  - What we did:
    - Wrote `watch-api.mjs` in the session scratchpad. It groups completed requests per 15 s and skips the Docker healthcheck.
    - Ran it under Claude Code's Monitor on `docker logs -f --tail 0 freightaudit-prod-api-1`, in a loop that reattaches after a restart.
    - GateGuard asked for facts before the file was created, as for every new file.
- **Key refused (setting wrong):**
  - What happened: at 17:52:56 the web's `GET /readyz` answered 200 but its `POST /graphql` 401.
  - Why: Vercel's `API_KEY` matched none of `API_KEYS`; how is not confirmed. It may have been the session secret, also 64 hex characters, or a stray character.
  - What we did: told the user during the test. The user copied the first key again with the clipboard command from docs/deploy.md, edited `API_KEY` (Production) under Settings, Environment Variables, and redeployed. From 17:55:53, `/graphql` answered 200.
- **Live path confirmed:**
  - What happened:
    - From 17:55:53 the phone loaded live pages (`/readyz` and `/graphql`, 200) and two invoices' PDFs (`/v1/invoices/{id}/document`, 200).
    - At 17:59:48 it uploaded `clean-digital-g001.pdf` (`POST /v1/invoices`, 202).
    - The invoice reconciled at 17:59:50 on one valid Groq first pass (`openai/gpt-oss-120b`, 1,298 ms), with no finding.
  - Why: the redeploy with the checked variables and the corrected key.
  - What we did: read the invoice's row, extraction and `llm_calls` with `psql` in `freightaudit-prod-postgres-1`.
- **Backend stopped; a PDF still shown (investigated read-only):**
  - What happened: at about 18:00 the api container stopped for the user's offline test. Reloading an invoice's PDF view on the phone still showed the PDF.
  - Why:
    - Live PDFs come from the web's `/api/invoices/[id]/document`. It streams the api's copy behind the session check and answers `cache-control: private, max-age=31536000, immutable`, so the phone's browser keeps each viewed PDF for a year and may show it without asking the server.
    - Which view it was is not confirmed. It could be a reload of the viewer's raw-PDF tab (the link beside the zoom buttons; Safari skips revalidation for `immutable`), a zoom that re-runs pdf.js's fetch, or the sample's static `/demo/<id>.pdf`.
    - A full reload of a live invoice page cannot show it. Offline, the page redirects to `/demo/invoices/<id>`, which knows only the snapshot's 11 ids and answers 404 for live ones.
  - What we did:
    1. Read the route, `proxy.ts`, `lib/server.ts`, the invoice and demo pages, `components/client.tsx`, `next.config.ts` and `apps/api/src/service.ts`.
    2. Found no shared storage:
       - `private` keeps Vercel's CDN from storing the response.
       - The route reads cookies, so it is rendered per request, and its fetch is uncached.
       - `apps/web/public` has no service worker, and Funnel passes TCP through.
       - The api's own copy carries the same header but goes only to servers.
       - The proxy answers 401 to any `/api/` request without a session cookie.
    3. Assessed the local copy. The year-long browser copy outlives sign-out, since `logout()` only clears the cookie, so on a shared device the next person could reopen a viewed PDF from history. The demo accepts only golden-set PDFs, so no real document is exposed.
    4. Added the fix to docs/todo.md and changed no code. Best because the copy stays in the browser that viewed it, and the fix (a header, a sign-out header, a test) deserves its own change.
  - Not done yet:
    - One real response with the backend up: its `cache-control`, `x-vercel-cache`, `x-vercel-id` and `age`.
    - An unauthenticated request for the same URL.
    - A signed-in request from a fresh private window while the backend is down. A 502 would confirm that Vercel holds no copy.
    - These need the production domain, which has not been shared, and the user's session.
- **Wrong statement (mistake):**
  - What happened: the agent told the user that no view links to the raw PDF. `DocumentViewer` in `components/client.tsx` has such a link (`<a href={src} target="_blank">` beside the zoom buttons).
  - Why: the agent had searched `views.tsx` for links but not `client.tsx`, where the viewer lives.
  - What we did: read the viewer, corrected it in the next report, and counted the raw-PDF tab among the likely views.
- **Tools behaving unexpectedly:**
  - What happened:
    - Three Grep calls with brace globs that include directories (such as `{components/views.tsx,lib/demo.ts}`) returned no matches, although those files contain them.
    - The GitHub API listed no deployments for the repository, so it gave no production domain.
  - Why: not confirmed. It may be the tool's handling of braced globs with a directory part, and Vercel not creating GitHub deployments here.
  - What we did: searched one path or file type at a time, and asked the user for the domain.
- Files: docs/{activity-log,context,memory,todo}.md
- Validation: the api and database readings above. No code changed and no tests ran.
- Outstanding:
  - The three checks under "Not done yet".
  - The offline pages under the banner (not reported yet).
  - Confirming `hkg1` from a response, the protection setting, the `POST /login` rule and the runtime log.
  - Nothing committed.

### 2026-10-18: Vercel setup and phone check reported; the web has not reached the api (not committed)

Times are UTC, as in the entry below.

- **Vercel project (user):**
  - What happened: the user reported the Vercel steps done. Step 8 covered the account, the project from the repository and the Production variables. Step 9 covered the settings: region `hkg1`, protection, and the `POST /login` rate-limit rule.
  - Why: docs/deploy.md, Vercel 1 to 6.
  - What we did: nothing beyond the checks below; the agent has no Vercel access.
- **Protected link (tool behaving as designed):**
  - What happened: the first link shared, `freightaudit-<hash>-<scope>.vercel.app`, answered `/healthz`, `/login`, `/demo/invoices` and `/invoices` with 302 to `vercel.com/sso-api`, and so did `freightaudit-<scope>.vercel.app`. `freightaudit.vercel.app` served another project (Clerk and Supabase headers, 404).
  - Why: Standard Protection puts the URLs Vercel generates behind its login and leaves only the production domain public. Whether `freightaudit-<scope>.vercel.app` is this project's production domain is not confirmed.
  - What we did: probed each with `curl.exe -s -D -` for status, `Location` and `x-vercel-id`; asked for the domain marked Production under Settings, Domains, and for Standard Protection under Settings, Deployment Protection; added both to docs/deploy.md (Vercel 8).
- **Skipped checks:**
  - What happened: the agent did not verify the production domain, the `hkg1` region, the protection setting, the rate-limit rule or the runtime log line for `crypto.argon2`.
  - Why: the production domain was not shared, and the user asked to finish the docs and stop. `x-vercel-id` shows the function region only on a public URL that runs a function, and the rule could be tested only by tripping it from the user's own IP.
  - What we did: recorded them as unconfirmed in docs/todo.md.
- **Phone check reported, live path not seen (open problem):**
  - What happened: the user reported the phone check done, but this stack showed no trace of it:
    - No invoice, model call or reviewer action followed the sample.
    - The containers had run unstopped since the reset at 17:05:52, so neither a live upload nor the backend-stopped case happened here.
    - The api's log from 17:05:59 to 17:34:36 held no request from the web. It had 60 Docker healthchecks (`GET /healthz`), the reset's `GET /v1/invoices` and sample batch, and the agent's curl. It also had browser loads of the Funnel root at 17:08, 17:11, 17:20 and 17:24 (`GET /` and `/favicon.ico`, 401), probably the phone's 401 check; scanners are not ruled out.
  - Why: not confirmed. The web probes the api only while `AI_ENABLED` is true and sends `new URL('/readyz', API_URL)` with a 2.5 s timeout (`apps/web/lib/server.ts`). So `AI_ENABLED` not true, a wrong `API_URL`, variables changed without a redeploy, or a probe failing before it reaches the PC would each keep the web on the sample under "Live backend offline".
  - What we did:
    1. Queried the last six hours of invoices, `audit_events` and `llm_calls` with `psql` inside `freightaudit-prod-postgres-1`.
    2. Read the containers' start times with `docker ps`.
    3. Parsed `docker logs --since 2026-10-17T17:05:00Z freightaudit-prod-api-1` as JSON and grouped it by method, path and status.
    4. Read the probe in `apps/web/lib/server.ts`.
    5. Kept step 10 open in docs/todo.md and docs/context.md instead of marking it done, and asked the user what the phone showed and which values Vercel holds. Best because the done-when needs an upload processed end to end, and the logs show none.
- **Rule requested again:**
  - What happened: the user's message asked again to add the documentation rule to AGENTS.md.
  - Why: not confirmed; probably the earlier request repeated.
  - What we did: compared it with the rule added earlier today, which says the same and also names prompts, and added nothing, so AGENTS.md keeps one copy.
- **Setup docs:**
  - What happened: the setup docs were finished for this stage, before the user commits `infra/squid.conf` and the docs.
  - Why: user request.
  - What we did:
    - docs/deploy.md: Vercel 8 (share only the production domain) and 9 (look for the web's `/readyz` and `/graphql` in the api's log), and a troubleshooting entry for "Live backend offline" while the PC is up.
    - docs/context.md: the deployment status.
    - docs/memory.md: the generated-URL pitfall and the open question.
    - docs/todo.md: the Vercel steps as reported, the live path open.
- Files: docs/{activity-log,context,deploy,memory,todo}.md
- Validation: at 17:34 the Funnel answered `/healthz` with 200 and `/v1/invoices` without a key with 401. Squid had denied nothing since the 17:00:38 restart.
- Outstanding:
  - The web reaching the api.
  - Then the phone check with a live upload, and with the backend stopped.
  - The unconfirmed Vercel settings above.
  - Nothing committed.

### 2026-10-18: Real setup of the public demo, steps 1 to 7 (main at `ae68611`, not committed)

Times are UTC; on this PC (UTC+8) the work ran past midnight into 2026-10-18. The user ran every command that touches a secret, and the agent never read `.env`, `.env.prod` or a key.

- **Documentation rule (setting changed):**
  - What happened: the user asked that activity-log entries, and memory entries about problems or decisions, include small events and state what happened, why, and what we did.
  - Why: user request.
  - What we did: added the rule to AGENTS.md, Documentation Rules; narrowed "Do not log trivial modifications" to typo and formatting fixes so the two rules agree; changed this file's header and entry format, and memory.md's entry format, to match. Older entries stay as written.
- **Preflight:**
  - What happened: release.yml had published the merge's images. `latest` and `sha-ae68611` share one digest for api (`sha256:66e8b1b91cb2…`), worker (`de304d095879…`), web (`cfa6ea1eca8c…`) and squid (`8359447599dd…`), and GHCR serves them without a login. No `freightaudit-prod` container or network existed, the three volumes were the dry run's, and `.env.prod` did not exist.
  - Why: expected after the merge.
  - What we did: `docker ps -a`, `docker volume ls` and `docker network ls` filtered on the project; `Test-Path .env.prod`; then GHCR's registry API for each image: an anonymous token from `https://ghcr.io/token?scope=repository:kwnhyk04/freightaudit-<image>:pull`, then `HEAD /v2/kwnhyk04/freightaudit-<image>/manifests/<tag>` for both tags.
- **`gh` missing (failed command):**
  - What happened: `gh run list --workflow release.yml` failed with "The term 'gh' is not recognized".
  - Why: the GitHub CLI is not on PowerShell's PATH here; whether it is installed elsewhere is not confirmed.
  - What we did: the registry check above instead. It is the stronger check: it proves the push and that `docker pull` works without credentials, which a green run does not.
- **GateGuard hook (tool blocking by design):**
  - What happened: the ecc GateGuard hook blocked the first PowerShell command and the first edit of each file (docs/todo.md, infra/squid.conf, and the six files of this update) until the agent listed facts: files referencing it, affected functions, data formats and the user's words. In one parallel batch of two edits to docs/todo.md, the second applied while the first was blocked.
  - Why: the hook's fact-forcing gate fires on the first touch of a file or tool.
  - What we did: listed the facts (with a `git grep -l` reference search), then retried the same call.
- **Step 1, data volumes (tool refused):**
  - What happened: Claude Code's auto mode refused the agent's `docker volume rm freightaudit-prod_postgres-data freightaudit-prod_minio-data`, without a reason.
  - Why: not confirmed; its classifier treats deleting volumes as dangerous.
  - What we did: no retry. The agent inspected the targets read-only: both were created at 14:27:55 on 2026-10-17 by compose project `freightaudit-prod`, and no container used them. The user ran the two commands from docs/deploy.md in their terminal, and `docker volume ls --filter name=freightaudit-prod` then listed only `freightaudit-prod-tailscale-state`. Best because the deletion is irreversible and the refusal handed the decision back to the user.
- **PowerShell quoting (failed command):**
  - What happened: `docker volume inspect --format '{{.Name}} ... {{index .Labels "com.docker.compose.project"}}'` failed three times with `template: :1: function "com" not defined`.
  - Why: Windows PowerShell 5.1 strips the inner double quotes from a native program's argument.
  - What we did: printed `{{json .Labels}}`, which needs no quotes. Later, SQL went to `psql` on stdin for the same reason.
- **Step 2, Tailscale (user, browser):**
  - What happened: the user created the account on the free Personal plan. On the DNS page MagicDNS stayed on and HTTPS Certificates were enabled. Under Access controls, the JSON editor's policy was replaced with the one in docs/deploy.md. The agent cannot see the console, so this rests on the user's word.
  - Why: docs/deploy.md, One-time setup, Tailscale 1 to 3.
  - What we did: moved the auth key (Tailscale 4) to just before `.env.prod` was filled, since it expires in a day and nothing needed it earlier.
- **Step 3, Docker Desktop and `pnpm demo:init`:**
  - What happened: the user ticked Settings, General, "Start Docker Desktop when you sign in to your computer", and ran `pnpm demo:init`. Memory needed no change.
  - Why: Docker runs on WSL 2 (engine 29.8.2; `docker info`: 15.6 GiB, 16 CPUs). WSL sets that memory, so Docker Desktop shows no slider, and 15.6 GiB is well over deploy.md's 4 GB.
  - What we did: read only the `AutoStart` value of `%APPDATA%\Docker\settings-store.json` (True), and checked that `.env.prod` exists and that `git check-ignore -v .env.prod` names `.gitignore:9`.
- **Step 4, keys (user):**
  - What happened: the user generated the auth key (Settings, Keys: reusable off, ephemeral off, expiry 1 day, tag `tag:freightaudit`) and set `GEMINI_API_KEY`, `GROQ_API_KEY` and `TS_AUTHKEY` in `.env.prod` with an editor.
  - Why: docs/deploy.md, Tailscale 4 and This PC 2.
  - What we did: skipped the agent's own check, since it would mean reading `.env.prod`. `pnpm demo:up` checked it instead: the node logged in under the name `freightaudit`, without a `-1` suffix.
- **Step 5, demo password (user):**
  - What happened: `pnpm --filter @freightaudit/web hash-password --write-env` wrote `DEMO_PASSWORD_HASH` into the root `.env`. Side effect: the dev web reads the same line, so the dev sign-in password is now the demo password.
  - Why: docs/deploy.md, This PC 3.
  - What we did: confirmed it by the file's modified time only (16:49:06, 18 s before the check).
- **Step 6, first `pnpm demo:up` with a login: relays denied, then allowed by a pattern:**
  - What happened: all seven containers became healthy and the node logged in. While the script waited for the public URL, squid had denied 4,100 CONNECTs in about 3 minutes (16:53:28 to 16:56:39), all from tailscale (10.231.231.3) to 87 relay names (`derp<region><node>.tailscale.com:443`) in 28 regions. None went to a bare IP or another host.
  - Why: with no UDP route out, tailscaled measures each region's relays over HTTPS through the proxy to choose a home relay, and Funnel's traffic needs one. The relays were not allowed yet, as deploy.md expected.
  - What we did:
    1. Summarized `docker logs freightaudit-prod-egress-proxy-1` by client, result and target, and counted bare-IP targets (0) and hosts outside the expected set (0).
    2. Asked the user to choose between one pattern, the 87 names, and a few nearby regions. The user chose the pattern. Best because Tailscale adds and renames relays, so a list would break Funnel quietly, and nearby regions alone would leave netcheck's denials flooding the log with no failover.
    3. Added to `infra/squid.conf`: `acl tailscale_derp dstdom_regex -n ^derp[0-9]+[a-z]*[.]tailscale[.]com$` and `http_access allow from_tailscale tailscale_ip tailscale_derp`.
    4. Ran `docker run --rm --read-only --tmpfs ... -v "H:\Projects\projects\freight-audit\infra\squid.conf:/etc/squid/squid.conf:ro" ghcr.io/kwnhyk04/freightaudit-squid:latest -k parse`: exit 0, no warning.
    5. Ran `docker restart freightaudit-prod-egress-proxy-1` at 17:00:38. deploy.md's `docker compose ... restart egress-proxy` would need `--env-file .env.prod`, and a restart mounts the edited file again.
    6. Checked that `docker exec freightaudit-prod-egress-proxy-1 grep -c tailscale_derp /etc/squid/squid.conf` gives 2. In the next 20 s squid logged 28 relay tunnels and tunnels to `controlplane` and `log.tailscale.com`, with no denial.
  - Result: from this PC, Funnel's `/healthz` answered 200 and `/v1/invoices` without a key 401. The user did not report whether their `demo:up` printed `Live at` or timed out first.
- **Imprecise option text (mistake):**
  - What happened: the recommended option in step 6 told the user the relays "are the same Tailscale servers controlplane already reaches". They are other servers of the same operator, and allowing them adds a path: a compromised tailscale container could send data to any Tailscale node through a relay.
  - Why: the agent shortened "same operator" to "same servers" and left out that path.
  - What we did: wrote the residual risk into docs/threat-notes.md and docs/memory.md, and told the user. The choice stands, because fewer relay names would not close that path: any relay forwards to any node connected to it.
- **Let's Encrypt at startup, and a wrong report (mistake):**
  - What happened: the agent told the user that `log.tailscale.com` and Let's Encrypt did not appear in squid's log yet, and that the certificate would come with the first request through Funnel. In fact the `acme-v02.api.letsencrypt.org` tunnel had already run from about 16:53:35 to 16:55:43 (128 s, 16,994 bytes), before any relay was allowed. The certificate (issuer `YE1`, Let's Encrypt) came at startup: its not-before of 15:55:41 is Let's Encrypt's one-hour backdate, and it is valid until 2027-01-15.
  - Why: the agent read a `sort | uniq -c` summary of the whole log in which that line did not show (why is not confirmed; possibly the shell's output condensing) and assumed the fetch waits for a request. The `log.tailscale.com` part was right: that tunnel was still open, and squid logs a tunnel only when it closes.
  - What we did: read the certificate over TLS (`System.Net.Security.SslStream` in PowerShell), saw that its date preceded the relays, listed every non-relay CONNECT with its time, found the tunnel, and corrected the report in the next message. A direct `Select-String acme` would have caught it first.
- **Funnel timing:**
  - What happened: from this PC, `/healthz` took 1.7 s on a new TLS connection (TLS done at 1.23 s) and 0.46 to 0.48 s on a reused one. The node's home relay is `sin`.
  - Why: every request crosses Funnel's ingress and the Singapore relay, since the node has no UDP path.
  - What we did: ran `curl.exe` with five URLs on one connection and `-w` timings, and read the home relay from `tailscale status --json`, printing only `Self.Relay`.
- **Step 7, `pnpm db:reset-demo` (user):**
  - What happened: the 11 sample PDFs were accepted. Within about a minute 8 invoices reconciled with 7 findings (1, 1, 1, 3, 1), 3 went to needs review (2 `no_shipment_match`, the missing-PRO ones; 1 `unsupported_currency: CAD`), and none failed. There were 12 model calls and none failed: Gemini made 2 first passes (the scans), and Groq made 8 first passes plus one invalid first pass that its repair fixed (the CAD invoice). Squid logged 9 worker tunnels to Gemini and Groq on 3128 and no denial. The user confirmed `TS_AUTHKEY` is gone from `.env.prod`.
  - Why: as designed. Two differences from the committed offline sample: g003 reconciles here, since its shipment keeps its miles, and reviewer actions are not replayed. The 19 dead letters are the seed's 19 failed invoices (2025-01-13 to 2026-09-18); none came from the sample.
  - What we did: read statuses, steps, review reasons, finding counts and `llm_calls` with `psql` inside `freightaudit-prod-postgres-1` (local socket, no password; counts and codes only), and squid's lines since the restart.
- **Waiting (tool refused):**
  - What happened: the harness blocked a `Start-Sleep -Seconds 60` before the status query ("To wait for a condition, use Monitor with an until-loop"). An earlier 20 s sleep had passed.
  - Why: Claude Code blocks long foreground sleeps; the threshold is not confirmed.
  - What we did: a background Bash loop polled Postgres every 10 s, for at most 10 minutes, until no sample invoice was received, extracting, extracted or reconciling. It ended after about 20 s.
- **Stale step-10 lines (setting changed):**
  - What happened: context.md still described release.yml's migrate and deploy jobs, the dev-only credentials in the production override, PR #14's fixes as uncommitted, step 10 as unmerged, and three Dockerfiles under Dependabot. todo.md still listed five "before step 10" items that step 10 had settled.
  - Why: those lines predate the step-10 decisions and the merge.
  - What we did: checked each against the source. release.yml has no `migrate`, `deploy` or `DEPLOY_ENABLED`. `createPool` is in `packages/db/src/pool.ts`, and the `e2e` script builds pipeline, api, worker and web. The production override requires `POSTGRES_PASSWORD` and `MINIO_ROOT_PASSWORD` from `.env.prod` and gives the worker `stop_grace_period: 90s`. `.github/dependabot.yml` lists four Dockerfile directories and `/infra` for docker-compose. Then we corrected context.md, moved the settled todo items to Completed, and updated deploy.md and threat-notes.md for the relay pattern. The Funnel URL stays out of the docs, since the repository is public; it lives in Vercel's `API_URL`.
- Files: AGENTS.md, infra/squid.conf, docs/{activity-log,memory,context,deploy,threat-notes,todo}.md
- Validation: per event above. No test suite ran, since only squid.conf and docs changed: squid.conf passed `-k parse` and carried live traffic.
- Outstanding:
  - Vercel: account, project with root `apps/web`, Production variables, region `hkg1`, protection, the `POST /login` rate-limit rule, and the runtime-log check for `crypto.argon2`.
  - Then the phone check.
  - docs/threat-notes.md has its "Accepted risks" list inside the threats table, which splits the table (found, not fixed).
  - Nothing committed.

### 2026-10-17: Own squid image for the egress proxy (branch step-10-deploy, not committed)

- Changes:
  - **Image:** `infra/squid/Dockerfile` installs Ubuntu's newest squid from noble-security on `ubuntu:24.04` (by digest), with no recommends, prints the version and fails below 6.14-0ubuntu0.24.04.4. It runs as `proxy`. Reason: ubuntu/squid's 24.04 images carried 6.13 (beta) and 6.14-0ubuntu0.24.04.2 (edge, the newest), both missing 2026 ICP, FTP gateway and cache digest fixes.
  - **CI:** ci.yml's docker job and release.yml's publish job build it as `freightaudit-squid` (matrix `include` with a `dockerfile` field), with Trivy like the rest. The compose file and `pnpm demo:up` pull it.
  - **squid.conf:** `icp_port 0`, `htcp_port 0` and `snmp_port 0` restate defaults, and no `cache_peer` line exists. `digest_generation off` is new: this build enables cache digests.
  - **Dependabot:** the docker entry covers `/infra/squid`; a new docker-compose entry covers `/infra` with the same weekly schedule, cooldown, major-ignore and grouping.
  - **docs/deploy.md:** reviewing a squid update includes `dpkg-query -W squid` in the new image, and the first real start uses the CI-built squid.
- Files: `infra/squid/Dockerfile` (new), `infra/squid.conf`, `infra/docker-compose.prod.yml`, `scripts/demo.ts`, `.github/workflows/{ci,release}.yml`, `.github/dependabot.yml`, docs.
- Validation:
  - **Build:** local build shows `squid 6.14-0ubuntu0.24.04.4`, user `proxy`, `--enable-cache-digests`. `squid -k parse` is clean. actionlint passes.
  - **Probes:** the full table matches the previous run. From the worker (.2), tailscale (.3) and another `outbound` container (.10), every `host.docker.internal` and 192.168.65.254 target gets 403 on both ports. Each port allows only its client's hosts, and the other container gets 403 for everything.
  - **Gemini:** scanned golden g085 went received, extracting, reconciled in 4 s (gemini-3.5-flash-lite, valid, 2,454 ms). Squid logged the tunnel from 10.231.231.2.
- Outstanding: unchanged (first real start: Funnel and the tailscale allowlist after login; the user's setup and the phone check).

### 2026-10-17: Egress proxy on squid's beta channel, each port tied to its client (branch step-10-deploy, not committed)

- Changes:
  - **Image:** `ubuntu/squid:6.6-24.04_beta` by digest (Squid 6.13, was the edge build with 6.14). User decision: beta is the more tested channel for 24.04.
  - **Fixed addresses:** `outbound` is 10.231.231.0/28, with dynamic addresses only in .8 to .15. The worker is fixed at 10.231.231.2 and tailscale at 10.231.231.3.
  - **Port binding:** squid serves 3128 only to the worker's address and 3129 only to tailscale's. On a shared port, a compromised worker could reach Tailscale's servers and tunnel out through another tailnet.
  - **Threat notes:** two accepted risks. Squid itself can reach the PC; an allowlist of large API services cannot stop data leaving through those services.
- Files: `infra/docker-compose.prod.yml`, `infra/squid.conf`, docs (threat notes, deploy, context, memory, todo).
- Validation (dry run, Squid 6.13; `squid -k parse` clean):
  - **From the worker (.2):** every `host.docker.internal` and 192.168.65.254 target gets 403 on both ports (the 17 listed ports). Gemini and Groq get 200 on 3128. On 3129 everything gets 403, `controlplane.tailscale.com` included (it got 200 before the binding).
  - **From tailscale (.3):** the same host targets get 403 on both ports. On 3129 `controlplane.tailscale.com` and `log.tailscale.com` get 200 and the rest 403. On 3128 everything gets 403, Gemini and Groq included.
  - **From another container on `outbound` (.10):** 403 for everything on both ports.
  - **Gemini:** scanned golden g076 went received, extracting, reconciled in 4 s (gemini-3.5-flash-lite, first pass, valid, 2,986 ms). Squid logged `TCP_TUNNEL/200 CONNECT generativelanguage.googleapis.com:443` from 10.231.231.2 (7.0 s, 6,279 bytes).
- Outstanding: unchanged. The Funnel check and timing, and the tailscale allowlist after login (stop at any bare-IP CONNECT), on the first real start; then the user's setup and the phone check.

### 2026-10-17: Step 10 egress proxy (branch step-10-deploy, not committed)

- Changes:
  - **Proxy:** `egress-proxy` (squid 6.14, `ubuntu/squid:6.6-24.04_edge` by digest, `infra/squid.conf`) is the only container on `egress`. The worker and tailscale moved to the internal network `outbound`.
  - **Rules:** a port per client by port name (3128 worker, 3129 tailscale); CONNECT to 443 only; private, loopback, link-local and CGNAT ranges refused by resolved address before the allowlists; `dstdomain -n`, so no bare IP matches; no cache; no published port.
  - **Clients:** the worker has `NODE_USE_ENV_PROXY=1`, `HTTPS_PROXY` and `NO_PROXY` (postgres, redis, minio, api, otel-collector, loopback); its Node is 24.22.0. tailscaled has `HTTPS_PROXY`.
  - **Allowlists from the access log:**
    - Worker: `generativelanguage.googleapis.com`, `api.groq.com`.
    - Tailscale: `controlplane.tailscale.com` and `log.tailscale.com` (what tailscaled asked for before login), plus `acme-v02.api.letsencrypt.org`, still to confirm. `login.tailscale.com` was never asked for and was dropped.
  - **Squid ACL:** `::ffff:0:0/96` was removed from the private ranges: squid read it as all of IPv4.
  - **Runbook:** `docs/deploy.md` makes deleting the dry run's two data volumes, by exact name, the first step of the real setup.
- Files: `infra/squid.conf` (new), `infra/docker-compose.prod.yml`, docs (deploy, context, threat notes, memory, todo).
- Validation, in the requested order:
  1. **Reachability:**
     - From the worker, `host.docker.internal` does not resolve and 192.168.65.254 answers ENETUNREACH on every listed port.
     - From the tailscale container, 192.168.65.254 refuses every port, and the name gets SERVFAIL.
     - Through both proxy ports, every CONNECT to either one is refused with 403 (`host.docker.internal:445`, `192.168.65.254:443` and the rest). So are `1.1.1.1:443`, `example.com:443`, a plain GET, and each client's hosts on the other port. The allowed hosts get 200.
  2. **Gemini:** scanned golden g068 went received, extracting, reconciled in 4 s. `llm_calls` has gemini-3.5-flash-lite, first pass, valid, 3,609 ms. Squid logged `TCP_TUNNEL/200 CONNECT generativelanguage.googleapis.com:443` (7.6 s, 6,218 bytes). The dry run used the dev `.env`'s keys, never printed.
  3. **Funnel:** not run. There is no Tailscale login yet (`.env.prod` does not exist), so no public URL and no timing to compare.
  4. **Checks:** lint 12/12, typecheck 21/21, unit 18 tasks, `test:int` 103/103 in 22 suites, `e2e` 9/9.
- Outstanding:
  - **Funnel:** the public check with its timing, and the tailscale allowlist after login (Let's Encrypt, relays; report any bare-IP CONNECT), on the first real start.
  - **Unblocked by the proxy:** the proxy container can still reach the PC.
  - **Then:** the user's setup and the phone check.

### 2026-10-17: Step 10 deploy, built up to the dry run (branch step-10-deploy, not committed)

- Changes:
  - **Compose:** `infra/docker-compose.prod.yml` is now its own project, `freightaudit-prod`. Networks `data` and `edge` are internal, `egress` is not. Services: migrate (migrations, then `seed.ts --if-empty`), api, worker and a tailscale sidecar (userspace, external state volume, `infra/tailscale/serve.json`). No host port. api, worker, migrate and tailscale run read-only with all capabilities dropped. Each service gets only its own settings from `.env.prod`. No Claude backup; `DAILY_AI_TOKEN_BUDGET` is 100,000.
  - **Scripts:** `scripts/demo.ts` behind `pnpm demo:init`, `demo:up`, `demo:down`, `db:backup` and `db:reset-demo`.
  - **api:** six security headers in the first hook; a request with an `Origin` header gets 403; Yoga `cors: false`; `UPLOAD_ALLOWLIST` refuses files outside the golden manifest with 403; `/readyz` answers from a 2 s cache.
  - **Worker and db:** an empty `MOCK_TMS_URL` removes the TMS sync schedule. faker and domain are dependencies of `packages/db`, and `seed.ts` takes `--if-empty`.
  - **Web:** `hash-password` asks twice without echo and `--write-env` writes only the hash (`lib/env-file.ts`). The upload page offers g001, g067 and g071 from `public/samples/`. A failed api call marks the backend offline at once, the error page links to the sample, and `vercel.json` skips non-production builds.
  - **CI:** release.yml's migrate and deploy jobs are deleted.
  - **Docs:** `docs/deploy.md` (new), README Live demo section, threat notes for the public api, `.env.example`, `.env.prod.example`, memory, AGENTS.md (compose name).
- Files: `infra/docker-compose.prod.yml`, `infra/tailscale/serve.json`, `.env.prod.example`, `scripts/demo.ts`, `package.json`, `apps/api/src/{app,main,uploads,graphql}.ts` with `app.test.ts`, `uploads.test.ts` and `openapi.contract.test.ts`, `apps/worker/src/{main,workers}.ts`, `packages/config/src/env.ts`, `packages/db/{package.json,scripts/seed.ts}`, `apps/web/{scripts/hash-password.ts,lib/{env-file,samples,server}.ts,lib/deploy.test.ts,app/actions.ts,app/(app)/{upload/page,error}.tsx,app/api/invoices/[id]/document/route.ts,app/globals.css,vercel.json,public/samples/}`, `.github/workflows/release.yml`, `.gitignore`, `.dockerignore`, docs.
- Validation:
  - **Checks:** lint 12/12, typecheck 21/21, `scripts/demo.ts` passes eslint and strict tsc, `pnpm turbo run test --force` 18 tasks. `test:int` passed 102 of 103: the readyz contract test met the new cache, now waits it out, and the contract project passed 12/12. `e2e` 9/9.
  - **Dry run** (images built from this tree, placeholder settings, AI off, no tailscale login): all five services healthy with read-only filesystems; no published port; migrate seeded once, then skipped; the api cannot reach the internet; the worker reaches Gemini's host and logs no TMS sync; golden g001 gets 202, a changed copy 403, an `Origin` header 403, no key 401.
  - **Host reachability** (user request): from the worker and from a container on `egress` alone (the tailscale container's outbound network), `host.docker.internal` (192.168.65.254) answers on dev Postgres 5432, Redis 6379, MinIO 9000 and 9001, FilingLens 4100, 5433, 5672, 15672 and 6380, Windows RPC 135 and SMB 445. 3389 and the dev apps' ports refuse. The bridge gateway (172.22.0.1) refuses every port, and the api (internal networks only) reaches nothing. Docker Desktop forwards that address to the PC's loopback, so an `extra_hosts` override would not block it: the IP itself answers.
- Outstanding:
  - **Block (waiting on the user):** an allowlisting egress proxy as the only container on `egress`. The worker and tailscale move to an internal network shared only with it. The proxy allows CONNECT on 443 to the Gemini and Groq API hosts (worker) and to Tailscale's control, relay and Let's Encrypt hosts (tailscale). The worker uses `HTTPS_PROXY` with `NODE_USE_ENV_PROXY=1`, tailscaled `HTTPS_PROXY`. Direct UDP paths stop, so Funnel traffic goes through Tailscale's relays.
  - **Not done yet:** the dry run's volumes must go before the real setup (placeholder passwords). `pnpm demo:up` needs images released after this branch merges. context.md is still to update. The user's manual steps (Tailscale, Vercel, `.env.prod`) and the phone check remain.

### 2026-10-17: Claude Haiku 5.5 as a paid backup (branch claude-provider)

- Changes:
  - **Chain:** `LLM_CLAUDE_MODEL` (empty by default, so the chain stays free-only) puts Claude between each role's main model and the free fallback.
    - **Invalid output:** a still-invalid repair gets one pass on Claude, then one on the free fallback.
    - **Rate limit:** a rate-limited first pass goes to Claude (first pass and repair), else to the free fallback as before.
    - **Recording:** Claude's calls are recorded under the fallback role, told apart by provider `anthropic`, so no migration was needed.
  - **Provider** (`packages/llm/src/claude.ts`, `@anthropic-ai/sdk` 0.132): structured output to the extraction schema; thinking disabled; `max_tokens` 65,536; no temperature, since Haiku 5.5 refuses a non-default one; SDK retries off; scans as base64 JPEG.
    - **Facts checked against the providers:** the Models API reports Haiku 5.5 with `image_input`, `structured_outputs` and `thinking.types.disabled`. Gemini 3.5 Flash-Lite and gpt-oss-120b report 65,536 output tokens, and qwen3.8-27b 16,384.
  - **Credits gone:** a 402 billing_error, a 400 invalid_request_error about the credit balance or a spend limit, or a 429 without retry-after raises `ClaudeUnavailableError`.
    - The provider stays skipped for the rest of the process and logs `claude_unavailable` once, with the reason and status only.
    - A 429 with retry-after is a `RateLimitError`, as with any provider.
  - **Config:** `anthropic` is a provider any role may name (for a pinned eval run). New settings `ANTHROPIC_API_KEY`, `LLM_CLAUDE_MODEL`, `LLM_CLAUDE_RPM` (50) and `LLM_CLAUDE_TPM` (50,000), with their own limits bucket. The worker refuses to start when the model is set without the key, or has no price. `prices.json` lists `anthropic/claude-haiku-5-5` (paid, 0.10 / 0.50 USD per million).
  - **CI:** evals never attach the backup. `no-claude-in-ci.test.ts` reads every workflow and action, turbo's env lists and the defaults.
- Files: packages/llm/{package.json,prices.json,src/claude.ts,src/claude.test.ts,src/errors.ts,src/extract.ts,src/limits.ts,src/models.ts,src/index.ts}, packages/config/src/env.ts, apps/worker/src/main.ts, evals/harness/no-claude-in-ci.test.ts, .env.example, pnpm-lock.yaml, docs/{context,memory,todo,activity-log}.md
- Validation:
  - `claude.test.ts`, 9 tests on a fake fetch: the request (thinking off, 65,536, no temperature, schema, JPEG); the order main, repair, Claude, free fallback; the four unavailable cases, each logging once with no key or message, and the next invoice skipping Claude; a 429 with retry-after giving a `RateLimitError` with Claude kept; a rate-limited first pass to Claude, and with Claude spent to the free fallback; and the free-only chain without the setting.
  - **Guard test:** it failed with `ANTHROPIC_API_KEY` added to the eval task's turbo passthrough, and passed once that was reverted.
  - `pnpm lint` 12/12, `pnpm typecheck` 21/21, `pnpm turbo run test --force` 18 tasks with 93 tests, `pnpm test:int` 103/103.
- Comparison run (same day, after the user's go on an estimate of about $0.05):
  - **Limit:** the Models API gives Haiku 5.5 a 128,000-token output limit, so `max_tokens` stays 65,536.
  - **Live check:** g002 (digital) was valid on the first pass, 1,540 / 213 tokens in 3.6 s, every field matching except the carrier string, which g002's ledger layout prints in capitals and matching normalizes. g066 (scanned) was valid on the first pass, 2,971 / 193 tokens in 1.9 s, every field matching.
  - **Harness:** gains `--subset test` (the 70 test-split cases).
  - **Run:** outside turbo, so the shell's pins reach it: primary and text on `anthropic/claude-haiku-5-5` at 25 requests and 25,000 tokens a minute each, fallback Groq qwen, no rate-limit fallback, no backup. 70 of 70 cases, 73 calls, 0 failed, 38 rate-limit waits from those caps, $0.026 paid. Report `evals/reports/2026-10-17-test-haiku.{md,json}` (renamed from `-test`); no floors.
  - **Results on the same 70 cases**, the free run first (from its per-case scores, with the harness's `measure`):
    - Header accuracy: 0.994 / 1.000 (digital / scanned) for the free run, 1.000 / 1.000 for Haiku.
    - Line F1: 1.000 / 0.982 against 1.000 / 0.917; Haiku's scanned interval runs 0.757 to 1.000.
    - Overcharge precision: 0.933 against 0.875. False flag rate: 0.009 against 0.018.
    - Outcome accuracy: 0.972 against 1.000.
    - Latency p50 / p95: 2,400 / 4,698 ms against 1,880 / 2,720 ms.
    - Neither reached the qwen fallback.
  - **README:** a comparison table after the generated eval table, which full runs rewrite.
- Outstanding: none for the backup. Not committed.

### 2026-10-17: PR #14 CI fixes: the e2e build and the integration teardown race

- Changes:
  - **end-to-end tests job:**
    - **Cause:** `pnpm e2e` ran `turbo run build --filter=@freightaudit/web...`, which builds the web and its dependencies (config, contracts, domain) only. `e2e/prepare.ts` runs `packages/pipeline/scripts/reset.ts`, whose imports reach telemetry, db and llm through their `dist/`, and the api and worker servers need those too. A clean runner had no `dist/`; this PC had them from earlier builds.
    - **Reproduced:** with every package's `dist/` deleted, `TURBO_FORCE=true pnpm e2e` built 4 tasks and failed in prepare with CI's error: `Cannot find module '...packages\pipeline\node_modules\@freightaudit\telemetry\dist\index.js' imported from ...packages\pipeline\src\queues.ts`.
    - **Fix:** `pnpm e2e` and `pnpm e2e:screenshots` now build `@freightaudit/pipeline...`, `api...`, `worker...` and `web...`, so the CI job, which runs `pnpm e2e`, needs no change. From the same clean state: 11 tasks, 0 cached, 9/9 passed.
  - **integration tests job:**
    - **Cause:** pg-pool's `end()` resolves before its connections have closed, and each closing idle client keeps its error listener. Every test helper ran `await pool.end()` and then `DROP DATABASE ... WITH (FORCE)`. When the drop caught a connection still closing, the server sent it 57P01, the pool re-emitted that as `'error'` with no listener, and the process threw during whichever test ran next: in CI, extract's 401 test.
    - Nothing else terminates backends: no `pg_terminate_backend` in the code, the reset (`DROP SCHEMA`) terminates nothing, and the migrations test's drop follows `client.end()`, which does wait for the socket.
    - **Reproduced** with a scratch script (`pool.end()`, then an immediate FORCE drop, 20 idle clients, two processes at once): 269 and 244 pool errors, all 57P01, in 80 runs each. Waiting for `pg_stat_activity` to empty first gave 0 in the same runs.
    - **Fix, tests:** `createTestDatabase().drop()` waits until the database has no session left, then drops without FORCE. A pool left open makes it fail after 5 s, naming the database: short enough to beat pg's 10 s idle timeout, which would otherwise close a forgotten pool unseen. `waitFor` moved to `@freightaudit/db/testing` to serve both. The db:reset test now does what `pnpm db:reset` requires: `env.offline()` stops its worker and ends its pool, the reset runs on the test's own throwaway database, and new workers start on a new pool. The api process test now waits for the server to exit before dropping its database.
    - **Fix, services:** `createPool` in `packages/db` builds the pool with an `'error'` handler that logs `idle database connection lost` with the error code only. The api, the worker and the eval harness use it.
    - **Test:** the api process test tags the server's connections (`application_name`), terminates them, and checks a warn line with `code: 57P01` and no message or error object. The process is still running, and the next request answers 200. With the handler removed, the server crashed with "terminating connection due to administrator command" and the test failed.
  - **README:** `pnpm e2e` builds every package the run needs.
- Files: package.json, packages/db/src/{pool.ts,index.ts,testing.ts}, apps/api/src/{main.ts,main.int.test.ts}, apps/worker/src/{main.ts,testing.ts,extract.int.test.ts}, evals/harness/run.ts, README.md, docs/{context,memory,todo,activity-log}.md
- Validation:
  - `extract.int.test.ts` 5 runs in a row, 13/13 each, about 12 s; `main.int.test.ts` (api) 3 runs, 4/4.
  - **drop():** with a pool still open, it refused after 5,050 ms naming the database. After `pool.end()` it dropped 50 ms later: the closing session was still there at the first check, the window the FORCE drop used to hit.
  - `pnpm lint` 12/12, `pnpm typecheck` 21/21, `pnpm turbo run test --force` 18 tasks with 81 tests, `pnpm test:int` 103/103 three runs in a row (21 to 24 s), `pnpm e2e` 9/9.
- Outstanding: push and watch PR #14's CI. Not committed.

### 2026-10-17: Step 9 polish: minus sign, README screenshots, an invoice left in needs review, sign-in autocomplete; step 7 closed

- Changes:
  - **Minus sign:** `formatMoney` maps Intl's `minusSign` part to U+2212, so a credit reads −$2,130.76. `formatUsd`, which writes the evidence text stored with each finding, keeps its hyphen. The test's property runs over USD, CAD and EUR: only a negative amount carries a sign, U+2212 in front and never a hyphen, and the digits read back to the cents.
  - **README:** the Review UI opens with the sample's detail in light and dark, a scanned golden invoice with its rate mismatch, in place of the e2e fixture's "LOADTEST-DIGITAL" shipment.
  - **Sample:**
    - It adds golden g088 (scanned remit layout without a PRO number). Uploaded with AI on, Gemini `gemini-3.5-flash-lite` read it on the first pass in 2,348 ms; the carrier matched exactly, and with no PRO number the invoice went to needs review (`no_shipment_match`) by itself. Nothing else touched it.
    - The sample's needs-review panel now shows the carrier and PRO number fields, disabled, with "In the live app a reviewer corrects the carrier or PRO number here, then re-runs matching." and no submit button. Disabled fields get their own colors (`globals.css`), since the author color outranks the browser's disabled gray.
    - `demo:export` used to delete the sample's PDFs before it checked any id, so an export refused by the golden check left the committed sample without them. It now writes nothing until every invoice passed and every query answered.
    - The re-export holds 11 invoices, 7 findings, 1 dead letter and 11 PDFs.
  - **Sign-in:** a hidden username field (`type="text"`, `autocomplete="username"`, value `reviewer`, read-only, unnamed) sits beside the `current-password` field, so password managers save and fill the password. The posted form is unchanged: `next` and `password` only.
  - **Api startup warnings:** fastify-openapi-glue 4.11.5, the latest release, checks every media type in the spec for a request parser, responses included. `application/pdf` and `application/problem+json` appear only in responses. A parser for either would make the api accept request bodies it now refuses with 415, so the warnings stay; docs/todo.md holds the item.
  - **Step 7:** done, confirmed by the user: the repository github.com/kwnhyk04/freightaudit runs ci.yml, release.yml and Dependabot, and PRs #12 and #13 are green.
- Files: packages/domain/src/{money.ts,money.test.ts}, apps/web/{components/views.tsx,components/client.tsx,app/globals.css,scripts/export-demo.ts,e2e/demo.spec.ts,e2e/screenshots.spec.ts}, apps/web/public/demo/* (4 JSON, 11 PDF), docs/screenshots/ui/* (2 new), README.md, docs/{context,memory,todo,activity-log}.md
- Validation:
  - **Minus sign:** the domain suite passes 31 tests at 100 % coverage. A hyphen mutant fails the example; run alone against it, the property fails and shrinks to -1 cents in USD.
  - **Export:** every sample PDF's sha256 is its golden file's, and the only actors are `reviewer` and the pipeline. An export of the 11 ids plus a seeded invoice stopped with "is not a golden-set invoice; the demo is public" and left the sample's 15 files byte-identical; the export of the 11 ids rewrote them identically.
  - **Sign-in:** on the built web, `/login` logs nothing to the console, neither Chrome's username hint nor a favicon 404. `FormData` of the form holds Next's action fields, `next` and `password`.
  - **Checks:** `pnpm lint` 12/12, `pnpm typecheck` 21/21, `pnpm turbo run test --force` 18 tasks with 81 tests, `pnpm test:int` 102/102 in 22 suites. `pnpm e2e` 9/9: sign-in and lockout pass with the new field, and the demo spec finds the sample's needs-review invoice with both fields disabled and no "Re-run matching". `pnpm e2e:screenshots` 5/5, 29 files. gitleaks 8.30.1 finds nothing in the sample, the export script, the components or `money.ts`.
  - **Screenshots:** the sample list shows g088 in needs review and the credit memo at −$2,130.76. The needs-review detail shows the read-only fields in both themes.
- Outstanding: the two openapi-glue warnings (docs/todo.md). Not committed.

### 2026-10-17: Step 9 finished: sample snapshot on real models, done-when check, e2e and screenshots

- Changes:
  - **Sample snapshot** (`apps/web/public/demo`), after the Gemini reset:
    - Setup: `pnpm db:reset`, then the dev stack with `AI_ENABLED=true` and the real keys: api, worker, mock-tms, and the web on its production build, telemetry off.
    - Uploads: g002 in the UI; g054, g055, g056, g069, g066, g081, g087, g089 and g003 through `POST /v1/invoices`. g003 went last, after its shipment's miles were cleared in the dev database.
    - Reviewer actions in the UI: g054's finding disputed with a note; g055's uncontracted charge approved, then g055 approved; g087's PRO number corrected to its shipment's and matching re-run; g089 rejected with a reason.
    - `demo:export` wrote 10 invoices, 7 findings (5 open, 1 disputed, 1 approved), 1 dead letter and 10 PDFs. Each PDF's sha256 is its golden file's, and the only actors are `reviewer` and the pipeline.
  - **Model calls:** 11, none failed.
    - 10 on Groq `openai/gpt-oss-120b`: first passes of 1.2 to 2.5 s, plus g089's repair after an invalid first pass.
    - 1 on Gemini `gemini-3.5-flash-lite`: g066's scan, valid first pass in 3,069 ms.
    - Nine uploads at once queued on the text role's bucket (8,000 tokens a minute, 5,200 estimated a page), so their calls waited up to 101 s.
  - **Readings against the ground truth:** every one matched. Findings by type and cents; g087 and g089 at needs_review (`no_shipment_match`, `unsupported_currency: CAD`); g003 failed with "shipment has no miles".
  - **Favicon:** browsers asked for a `/favicon.ico` that does not exist, a 404 in the console on every page. The root layout now declares a data-URI icon (`apps/web/app/layout.tsx`); the web image's login page makes no such request.
  - **Screenshots:** the spec also shoots the public sample's detail (`demo-invoice-<light|dark>.png`), as the plan listed. It uses the sample's first invoice with an open finding, g066's scan.
  - **README:** regenerating the sample ends with a web build, since the pages import the snapshot when the web is built.
- Files: apps/web/public/demo/* (4 JSON, 10 PDF), apps/web/app/layout.tsx, apps/web/e2e/screenshots.spec.ts, docs/screenshots/ui/* (2 new, 8 updated), README.md, docs/{context,memory,todo,activity-log}.md
- Validation:
  - **Done when, real models:** sign-in; g002 uploaded in the UI reached Reconciled, its trail showing every move; a finding disputed, a charge approved and that invoice approved; g087 out of needs_review to Reconciled, its trail naming the reviewer and the PRO change; g089 rejected. With the api stopped, `/invoices` went to `/demo/invoices` under "Live backend offline, showing sample data", with no upload. Signed out, the login page's link opened "Sample data, read-only"; the detail showed g066's PDF from `/demo/`, no form and no action button, and the browser made no request to the api.
  - **Checks:** `pnpm lint` 12/12, `pnpm typecheck` 21/21, `pnpm turbo run test --force` 18 tasks with 81 tests, `pnpm test:int` 102/102 in 22 suites, `pnpm contracts:check` current, and `OASDIFF_BASE_REF=main pnpm contracts:breaking` clean with the ignore file. `pnpm e2e` 9/9; its demo spec now walks the 10 sample rows and a rendered sample PDF. `pnpm e2e:screenshots` 5/5. gitleaks 8.30.1 finds nothing in the sample or the layout. The web image (308 MB) serves `/healthz`, `/demo/invoices` with all 10 invoices and the sample PDFs without a session, redirects `/invoices` to `/login` and answers 401 on the document route.
  - **Screenshot review:** the sample list and detail read as the live pages do in both themes: banner, status colors with words, the scan beside its flagged line, the finding with its evidence, and the trail. The other files differ from 2026-10-16 only in upload times.
- Outstanding: noticed, not changed: a credit memo's total prints a hyphen-minus (`-$2,130.76`), and Chrome's verbose log notes that the sign-in form has no username field. The sample has no invoice left in needs_review, since the plan corrected g087 and rejected g089. Not committed.

### 2026-10-16: Step 9: review UI, GraphQL resolvers, sign-in, public sample data

- Changes:
  - **Contracts:** GraphQL gains the final status REJECTED, `deadLetters`, `carriers`, `correctInvoice`, `rejectInvoice`, `replayDeadLetter`, and on Invoice the PRO number, review reason, open finding count, extraction (carrier as read and its match rule), audit trail and open dead letter. The client preset emits string documents for a fetch-only BFF. `@freightaudit/contracts/limits` holds one set of upload checks for browser, web and api: 4 MiB, type by magic bytes, image size from the header, 20 pages. OpenAPI 0.7.0: `rejected`, PNG and JPEG uploads, `GET /v1/invoices/{id}/document`; `oasdiff-ignore.txt` accepts the reviewed breaking lines.
  - **Database:** 0013 adds `rejected`, the append-only `audit_events` table, a status trigger that records pipeline moves unless a reviewer action set `app.actor`, and the moves needs_review to extracted and to rejected.
  - **Api:** resolvers for every query and mutation with keyset connections and per-request DataLoaders, the `Cents` scalar, masked errors with codes, reviewer mutations in one transaction each with their audit row (actor from `X-Actor` or the key digest), correct then re-queue reconcile, the document endpoint, and PNG/JPEG wrapped into a one-page PDF at intake.
  - **Web:** backend for frontend with a server-only key; argon2id sign-in with a signed `__Host-` cookie and a 5-per-15-minutes limit; invoices, an invoice with the PDF beside its lines, findings with evidence, the needs_review way out and the audit trail, the review queue, dead letters, upload with client checks; a public read-only `/demo` that signed-in users also see while the backend is offline; `demo:export` limited to golden-manifest invoices; design per the brief (IBM Plex, one ink-blue accent, status colors with words, tabular money right-aligned, dark mode, phone layout).
  - **Screenshot review (three rounds):**
    - Round 1 (invoice detail): fixed the h1 size, a plural, a redundant "Read as" line, a cut-off placeholder and "Open PDF" shown without a document.
    - Round 2 (all screens): years were missing on dates from earlier years, so a sorted column read out of order. The invoice page overflowed a 390 px phone, since a `1fr` grid track kept the table's min-content width. Sign-out was hidden on phones. "Contract" became "Expected", as the brief says. Unpriced invoices showed "As billed" for every line. A failed invoice listed six "None" rows and "Carrier not read" against "Not matched". The failure callout used the warning color. The queue's decision wrapped onto two lines. "Re-run matching" was 4 px shorter than its inputs. The upload page showed the browser's file button at full width. The sample's empty state asked visitors to upload. Raw queue names showed on the dead-letter page.
    - Round 3: the finding type got its own line under the line's description. The trail shows status labels and "Carrier read as …, matched … as printed". Findings got dividers. The phone list shows status, invoice with its carrier, and total. The spec waits for fonts and the PDF, uploads the fixture so a stored document is on screen, and fails a phone page that scrolls sideways.
  - **README:** Part 1 of the load test showed spare capacity, not backpressure (step 4's tests prove that path); a Review UI section, setup keys, `pnpm e2e`, the sample data and its export. `docs/threat-notes.md` is new.
- Files: packages/contracts/{schema.graphql,operations/*,codegen.ts,openapi.yaml,oasdiff-ignore.txt,scripts/breaking.ts,src/limits.ts,src/generated/*}, packages/db/{migrations/0013_audit_and_rejection.sql,src/schema.ts,src/index.ts,scripts/seed.ts,src/migrations.int.test.ts}, packages/pipeline/src/dead-letters.ts, packages/llm/src/pdf.ts, packages/domain/src/money.ts, apps/api/src/{app,graphql,keyset,loaders,review,actor,service,uploads,main,testing}.ts with tests, apps/worker/src/workers.ts, apps/web/** (app, components, lib, e2e, scripts, proxy.ts, instrumentation.ts, playwright.config.ts), .github/workflows/ci.yml, .env.example, README.md, loadtest/k6.js, docs/{context,memory,migrations,todo,activity-log,threat-notes}.md, docs/screenshots/ui/*.png (25)
- Validation: `pnpm lint` 12/12, `pnpm typecheck` 21/21, `pnpm turbo run test --force` 18 tasks (api 3 with the Cents test, web 4), `pnpm test:int` 102/102 in 22 suites, `pnpm contracts:check` current, `OASDIFF_BASE_REF=main pnpm contracts:breaking` clean with the ignore file, `pnpm e2e` 9/9, `pnpm e2e:screenshots` 5/5, actionlint. The web image (306 MB) serves `/healthz` and `/demo/invoices` without a session, redirects `/invoices` to `/login` and answers 401 on the document route.
- Outstanding: the sample export and the manual real-model check wait for the Gemini quota reset (2026-10-17 07:00 UTC); then rerun `pnpm e2e` and the demo screenshots. Nothing committed (user instruction).

### 2026-10-16: PR #13 eval smoke: failed calls made diagnosable

- Changes:
  - **What CI showed:** on d230b19 the smoke broke the failed-calls floor (6 against 1, 95% CI 1 to 13). All 6 failures were Gemini calls: 14 Gemini calls for 8 scans, with Gemini input tokens equal to 8 replies, while Groq made its usual 14. The job log could not say why, since the harness discarded the worker's warnings and printed no call error; so the absence of "429" in it proved nothing.
  - **Failure records:** `failureOf` in packages/llm classifies each failed call (timeout, 429, 5xx, network, parse_or_schema, other) and keeps the HTTP status and the first line of the message: at most 200 characters, key-shaped tokens masked, and a JSON parse error reduced to fixed text. Errors carry `status` from `httpError`, and timeouts and lost connections carry `kind` from `classify`.
    - A Gemini 429 now names its quota (`quotaId`), and a Groq 429 names its limit (TPM, TPD, RPM or RPD), nothing else of either message.
    - The worker stores the class, status and message in `llm_calls` (migration 0012).
  - **Eval harness:** it masks every configured key once more and logs a `call failed` line (case, provider, model, class, status, message) as each case ends. The report gains a Failed calls section in the .md and `failures` in the .json, and the eval-smoke artifact uploads the .json beside the .md (output `json`, as in nightly-eval.yml).
  - **Stalls:** the quota stop now also watches a split case's part jobs. A case past its 30-minute deadline stops with its calls and its last failure instead of throwing: a 429 makes it a quota stop (exit 2, report written), and any other stall fails the run after its failed calls are logged. This came from the local run below, which died at g084 with no report.
  - **CI against local:** the same models, limits, base URLs (defaults on both sides), concurrency 4, timeouts, retries and lock. They differ in Node (local 24.21.0, CI the latest 24.x for "24"), network and region, and possibly the keys, which cannot be read here. Turbo passes the eval task only `DOCKER_*`, `TESTCONTAINERS_*`, `HOME`, `USERPROFILE` and the two keys. No local run overlapped that CI run. Other compose projects' services (filinglens api, embed and ingest) were up on this PC; if they share these provider accounts, they share the per-minute and daily quotas, which no one process's bucket sees.
- Files: packages/llm/src/{errors.ts,extract.ts,gemini.ts,openai.ts,extract.test.ts,gemini.int.test.ts,openai.int.test.ts}, packages/db/{migrations/0012_llm_call_errors.sql,src/schema.ts,src/migrations.int.test.ts}, apps/worker/src/extract.int.test.ts, evals/harness/{metrics.ts,metrics.test.ts,run.ts,report.ts}, evals/reports/2026-10-16-ci.{json,md}, .github/workflows/ci.yml, docs/{context,memory,migrations,todo,activity-log}.md
- Validation:
  - Typecheck 21 of 21, `pnpm lint` 12 of 12, and actionlint 1.7.12 on the workflows pass. `pnpm turbo run test --force`: 16 of 16 tasks, 0 cached, 70 tests in 7 packages. `pnpm test:int` 94 of 94, covering 0012, the worker's recorded 429 (class, status, message), the Gemini quota id and status, and a Groq 429 naming TPD.
  - **The ci subset once** (`--fresh`): it hit Groq's daily token cap. 19 cases finished, logging their failed calls; g010, g011 and g058 had 4 Groq 429s between them. g084 (split) then sat in 429 retries until the old 30-minute deadline threw, with no report. Groq probes then showed that a small request passes (888 of 1,000 daily requests left), while a part-sized one gets 429 naming TPD with "try again in 5m41s".
  - Rerun from the cache (all 20 cached, g084 from the 06:22 run), the report lists the 4 failures by case, provider, model, class, status and message. It exits 1 on failed calls (4 against 1) and end-to-end p95 (211,118 ms against 174,600 ms), both from the cap. The other floors held, and no floor was changed.
- Outstanding: read the breakdown on PR #13's next smoke for the class of the Gemini failures (docs/todo.md). Groq's daily cap, about 20,000 tokens per ci run, limits how many eval runs a day can share the key. Not committed.

### 2026-10-16: PR #13 eval smoke: ci extraction latency p95 gated on the design target

- Changes:
  - **Diagnosis:** PR #13's smoke on 4fbb550 broke only the extraction latency p95 floor: 10,191 ms (95% CI 7,478 to 31,380 ms) against 8,900 ms, with p50 2,625 ms. Every other check on that commit passed, docker (api) and docker (worker) included.
    - The PR comment, read through the public API, has no per-case latency: the artifact is the `.md` only, and job logs need authentication.
    - Its totals show no repair: Groq made 14 calls, as in every ci run (12 cases plus g084's two split parts), with arithmetic consistency 1.000 and escalation 0. Its one failed call was a Gemini call, which latency excludes. The slow cases were therefore slow single replies.
    - With n = 20, p95 is the 19th value plus 5% of the gap to the 20th, so the result fits one case near 9 s and one near 31 s.
    - A fresh local rerun on the same code passed (p95 7,732 ms, 6,400 to 8,026 ms, 0 failed calls, no repair). Its slowest case was g050: one Gemini first pass of 8,026 ms for the same 1,325 input tokens that took 2.3 to 4.4 s on 2026-10-15. No code in the measured path changed, so this is provider variance, not a regression.
  - **Gate:** the ci floor for extraction latency p95 is now its design target (`"max": 12000, "from": "design target"`), by the user's written reason. The report never proposes tightening a floor whose `from` is "design target". ci p50 keeps 4,400 ms, and the full run keeps its derived p95 floor of 9,900 ms. The floor rules text in `evals/thresholds.json` and `report.ts` states the exception.
- Files: evals/harness/report.ts, evals/thresholds.json, evals/reports/2026-10-16-ci.{json,md}, README.md, docs/{context,memory,todo,activity-log}.md
- Validation:
  - `pnpm lint` 12 of 12, typecheck 21 of 21, and `pnpm turbo run test --force` 16 of 16 tasks, 0 cached, 60 tests in 7 packages.
  - **ci subset once on the final code** (`--fresh`, 168 s): exit 0, every floor kept. Extraction latency p95 6,079 ms (5,340 to 7,249 ms) against 12,000 ms, and p50 4,058 ms (2,717 to 5,235 ms) against 4,400 ms. 10 rate-limit waits totalling 373,362 ms, and 0 failed calls.
    - g010 needed a repair (an invalid first pass of 1,541 ms, then a valid repair of 2,657 ms); outcome accuracy 1.000.
    - Every scan was one Gemini call of 3.9 to 6.0 s, so p50, which falls between the digital and scanned cases, sat 342 ms under its floor.
- Outstanding: ci p50 is the next floor that a slow day on Gemini could break, since its interval reached 5,235 ms. Not committed.

### 2026-10-16: PR #13 docker (api) and docker (worker) checks: offline production install

- Changes:
  - **Cause:** the eval fix commit (7ebcee7) changed no manifest, lockfile, workspace file or Dockerfile; between it and b208980 only sources differ. Its push hit CI's gha layer cache for the full install, whose store lived in a BuildKit cache mount, which the gha cache does not keep. The fresh builder's mount was therefore empty when the build step, a cache miss, was followed by `pnpm install --frozen-lockfile --prod --offline`.
  - **Fix:** in `apps/api/Dockerfile` and `apps/worker/Dockerfile`, the build stage copies the pruned root `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml`, runs `pnpm fetch --store-dir /pnpm/store` into the layer, then runs the full install `--offline` and the production install `--frozen-lockfile --offline` from that store. The cache mounts on these installs are gone. The web Dockerfile keeps its mount, since no step after its install reads the store.
- Files: apps/api/Dockerfile, apps/worker/Dockerfile, docs/{context,memory,todo,activity-log}.md
- Validation:
  - **Reproduced** with a fresh docker-container builder per run, like each CI job. Run 1 built b208980 and exported a `type=local` cache (`mode=max`), then passed. Run 2 used a new builder, built 7ebcee7 with that cache imported, and failed for both apps: install `CACHED`, build run, then `ERR_PNPM_NO_OFFLINE_TARBALL`, "Failed to fetch tarball for @whatwg-node/promise-helpers@1.3.2 ... in offline mode: snapshot not present in local store" (api; worker: `color-convert@2.0.1`).
  - **Control:** 7ebcee7 built on a fresh builder without the imported cache passed, so the commit itself was sound.
  - **Fixed Dockerfiles, same two-run sequence:** both apps pass. In run 2 the fetch and full-install layers are `CACHED`, the build runs, and the offline production install succeeds (13 to 16 s).
  - **Local builds:** `docker build -f apps/{api,worker}/Dockerfile .` from the working tree passes for both.
  - **Same runtime contents:** against images from the old Dockerfiles at the same commit, `node_modules/.pnpm` lists the same packages, holds the same 17,766 files (api), and every file's md5 matches for both apps. The fixed images hardlink identical files (6,637 in api, 7,351 in worker), which the old cross-mount install copied: api 515 MB against 543 MB, worker 502 MB against 534 MB.
  - **Checks:** `pnpm lint` 12 of 12 (7 replayed from cache), and `pnpm turbo run test --force` 16 of 16 tasks, 0 cached, 60 tests in 7 packages.
  - **Cleanup:** the repro builder, the four check images and the scratch caches were removed.
- Outstanding: the docker checks on PR #13's next push (docs/todo.md). Not committed.

### 2026-10-16: PR #13 eval smoke: latency without rate-limit waits (A) and carrier matching in code (C)

- Changes:
  - **A, extraction latency:** it now sums only the calls that returned a reply (first pass, repairs, fallback), each the provider's time, so rate-limit waits and failed calls are out of it.
    - The report table gains three rows with their own floors: rate-limit waits, their total time, and failed or timed-out calls.
    - `take` returns how long it waited, `metered` hands that to the call through `GenerateInput.onWait`, and each `llm_calls` row records it in `wait_ms` (migration 0011). A failed call's `latency_ms` no longer includes the wait.
    - The floor rule's text covers the new rows: failed calls take the accuracy rule (one call above a run without any), waits the efficiency rule (upper bound times 1.5).
  - **C, carrier matching:** `matchCarrier` in packages/domain, called by the extract job against the tenant's carriers.
    - Order: equal after normalizing case and spacing, then the one known name the reading holds as whole tokens. No match, or more than one, leaves the invoice without a carrier, so reconcile still ends it at needs_review.
    - The rule (`exact`, `normalized` or `contained`) is kept in `extractions.carrier_match` (0011) as the audit record of a normalized name.
    - Change log: found through a CI miss on a test case (g010, test split and ci subset, a remit title line read as the carrier). The fix is general: any carrier name printed with other text around it. No prompt was changed, and nothing was tuned on the test split.
  - **E:** queued in docs/todo.md (a golden v2 dev case for title-line carrier names, then a prompt change tuned on dev only). B and D were rejected by the user.
  - Docs: context.md had no word on migration 0010 and still named `linesMatchTotal`, which 6a replaced with `checkArithmetic`; both fixed with this change.
- Files: packages/llm/src/{extract.ts,limits.ts,extract.test.ts,limits.int.test.ts}, packages/domain/src/{carrier.ts,carrier.test.ts,index.ts}, packages/db/{migrations/0011_call_wait_and_carrier_match.sql,src/schema.ts,src/migrations.int.test.ts}, apps/worker/src/{extract.ts,extract.int.test.ts}, evals/harness/{metrics.ts,metrics.test.ts,report.ts,run.ts}, evals/thresholds.json, evals/reports/2026-10-16-{dev,ci}.{json,md}, README.md, docs/{context,memory,migrations,todo,activity-log}.md
- Validation:
  - **Floors from the main baseline** (the cached `2026-10-15-ci` and `2026-10-15` runs, read by a scratch script through the harness's own `evaluate`, `scoreCase`, `measure` and `floorFrom`, no model calls):
    - All 22 ci calls and 98 full calls had returned a reply (96 valid, 2 invalid), and a reply's latency never held its bucket wait. So the latency floors are unchanged under the new definition: ci p50 4,400 ms and p95 8,900 ms (p95 measured 5,341 ms, interval 3,147 to 5,872 ms), full 4,000 and 9,900 ms.
    - Failed calls: 0 in both, so a floor of 1 for ci and full.
    - Rate-limit waits: the baseline recorded none (n/a), so their ci floors come from this ci run, and full has none yet.
  - **Unit tests:** the matcher has unit tests for a title-line suffix like g010's, two carriers sharing words (no match), and no match. The first version dropped punctuation, and its own test matched "Halcyon Ridge — Freight Bill" to Halcyon Ridge Freight; punctuation marks now stay tokens. Two mutations each fail one test: taking the first of several matches, and containment without token boundaries.
  - **Checks:** typecheck 21 of 21. `pnpm lint` 12 of 12. `pnpm turbo run test --force`: 16 of 16 tasks, 0 cached, 60 tests in 7 packages (domain 100 % coverage). `pnpm test:int` 93 of 93; it first failed only on the migrations test's list and count of migrations, which now include 0011.
  - **Dev split once** (`--fresh`, real models, 186 s): 20 of 20 cases with no miss, every accuracy metric and outcome accuracy 1.000, as on 2026-10-15. Extraction latency p50 2,024 ms and p95 4,035 ms. 13 rate-limit waits totalling 512,517 ms, and 0 failed calls.
  - **ci subset once** (`--fresh --set-floors`, real models, 146 s): exit 0, every floor kept (`evals/reports/2026-10-16-ci.md`).
    - Extraction latency p50 2,374 ms and p95 6,868 ms, against floors of 4,400 and 8,900 ms.
    - 8 rate-limit waits totalling 359,011 ms (intervals 3 to 14 and 83,843 to 703,426 ms), which set their ci floors at 21 waits and 1,055,200 ms. The report prints those two rows without a floor, since `--set-floors` adds a floor after measuring.
    - 0 failed calls, against a floor of 1.
    - g010 again read its title line as the carrier ("Quarry Lane Transport — Freight Bill", 5 of 6 header fields) and now reconciled through the `contained` match. In the baseline the same reading ended needs_review (`no_shipment_match`). Outcome accuracy 1.000; g010's carrier field is the run's only miss.
- Outstanding: full-subset floors for the two wait rows (docs/todo.md). The ci report suggests tightening three floors (tokens per invoice to 3,400 digital and 3,650 scanned, outcome accuracy to 0.98); not applied. The baseline cache was copied to `evals/.cache/baseline-2026-10-15` before the fresh runs overwrote the 40 dev and ci cases. Not committed.

### 2026-10-16: PR #13 eval smoke failure investigated (no change made)

- Changes: none to code or floors; the decision waits on the user.
- Files: docs only (activity log, memory, todo).
- Validation:
  - **The broken floor is not g010.** The PR comment's floors table shows only one broken floor: extraction latency p95 (3 pages or fewer) measured 90,028 ms against a floor of ≤ 8,900 ms. Its 95% interval runs from 6,864 to 273,545 ms, and p50 was a normal 2,122 ms.
  - **g010 broke nothing:**
    - It read 5 of 6 header fields and ended needs_review.
    - Digital header accuracy kept its floor: 0.987 against ≥ 0.950.
    - Expected outcome kept its floor: 0.952 against ≥ 0.830.
  - **The model path is unchanged.** `git diff main origin/step-8-instrumentation -- packages/llm`:
    - It adds an optional `GenerateInput.step`; both clients destructure only prompt, parts and schema, so it is never sent.
    - It reads `finishReason` for spans only.
    - `traced()` passes input and reply through untouched.
    - Request parameters, prompt (hash 19f0c19627c4 on both), schema, temperature 0, retries and parsing are unchanged.
  - **g010 alone, 3 runs per branch**, through the harness's `runCase` in fresh containers, with no eval cache and `fallbackOnRateLimit` false, all on Groq `openai/gpt-oss-120b`:
    - main: run 1 reconciled after a repair; run 2 needs_review, with carrier read as "Quarry Lane Transport — Freight Bill" against "Quarry Lane Transport" (`no_shipment_match`); run 3 reconciled.
    - Branch: 3 of 3 reconciled, one after a repair.
    - Both branches sent 767 input tokens on the first pass and 950 on the repair. Call latencies were 1.5 to 2.2 s on both.
  - The CI job log and the report artifact need authentication (HTTP 403), and gh is not installed here, so CI's per-case latencies are not visible.
- Outstanding: the user chooses how to handle the remit title misread and the noisy free-tier latency floor (options in docs/todo.md). No floor changes and no retries until then.

### 2026-10-16: Step 8 instrumentation and k6 load test

- Changes:
  - **OpenTelemetry:** OpenTelemetry through `packages/telemetry`.
    - Each app loads `node --import ./src/telemetry.ts`, which runs NodeSDK with OTLP/JSON to the collector. The import-in-the-middle hook covers only the hooked modules.
    - Instrumentations: http, @fastify/otel, pg (placeholders only), and ioredis (command names only).
    - `service.instance.id` is set per process.
  - **Trace context through BullMQ** (`packages/pipeline/src/tracing.ts`):
    - `send()` stores the W3C traceparent in job data inside a producer span, and `consume()` runs each attempt as a consumer span under it.
    - A split's flow shares one send span; a replay continues the replay request's trace.
  - **GenAI model-call spans** (`packages/llm/src/trace.ts`): semconv v1.41.1 names inlined and the schema URL pinned. Each records the model, tokens, finish reason, role and step, never content. `finishReason` is now read from both clients.
  - **Metrics** (`packages/telemetry/src/metrics.ts`):
    - queue and dead-letter gauges, and the circuit breaker
    - job duration and wait, and retries by error class
    - tokens, paid-equivalent cost and 429s
    - escalations, fallbacks, needs_review by reason, and intake 503s
  - **Dashboard and alerts:**
    - The Grafana dashboard `infra/grafana/freightaudit.json`, provisioned, on datasources with fixed uids.
    - The Prometheus rule file `infra/prometheus-alerts.yml` with a promtool test, which CI's lint job runs.
    - Prometheus now scrapes with `honor_labels`.
  - **Rate limits:** the per-key limits became `RATE_LIMIT_PER_MIN` and `UPLOAD_RATE_LIMIT_PER_MIN`. `OTEL_SDK_DISABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_METRIC_EXPORT_INTERVAL` are validated.
  - **Span-scan test:** `apps/worker/src/telemetry.int.test.ts`.
  - **k6 load test:**
    - `loadtest/k6.js`, run as the compose service `k6`, profile `loadtest`, image `grafana/k6:2.3.0` by digest.
    - The env files for both parts, and `fixture-shipments.sql`.
    - The recorded-fixture model server: `pnpm --filter @freightaudit/llm fixture-models`, with `fakeModels` now taking async replies and a port.
  - **README:** `evals/harness/report.ts` renders the README's end-to-end latency and throughput rows from the k6 results. The README gained Observability and Load test sections.
- Files:
  - packages: `packages/telemetry/**`, `packages/pipeline/src/{tracing,queues,dead-letters,index}.ts`, `packages/llm/{src/{trace,extract,gemini,openai,models,testing}.ts,scripts/fixture-models.ts,tsconfig*.json}`, `packages/config/src/env.ts`
  - apps: `apps/{api,worker}/{src/telemetry.ts,package.json,Dockerfile}`, `apps/api/src/{main,app,service}.ts`, `apps/worker/src/{main,workers,extract,reconcile,telemetry.int.test}.ts`
  - infra: `infra/{docker-compose.yml,prometheus.yml,prometheus-alerts.yml,prometheus-alerts.test.yml,grafana-datasources.yml,grafana/*}`
  - load test and evals: `loadtest/*`, `evals/harness/report.ts`
  - root: `.github/workflows/ci.yml`, `.dockerignore`, `.env.example`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `README.md`
  - docs and screenshots: `docs/*`, `docs/screenshots/{jaeger-trace,grafana-load-test}.png`
- Validation:
  - `pnpm turbo run build typecheck lint` passes; `pnpm turbo run test --force`: 16 tasks, 0 cached, passed.
  - `pnpm test:int`: 93 of 93 (21.1 s).
  - The span-scan test passes in 4.8 s. It fails with the default ioredis serializer (an `evalsha` statement with keys) and with a `send` that drops the context (6 traces instead of 1).
  - promtool: rules check (4 rules) and tests pass. actionlint exits 0.
  - In Jaeger: one upload is one trace with 2 services and about 50 spans. It runs from `POST /v1/invoices` through `process extract`, the model call and `process reconcile` (screenshot from a real Gemini call).
  - The api and worker images build, start healthy with the `--import` CMD, and the worker's metrics reach Prometheus through the collector.
  - k6 Part 1 (2026-10-15 20:19 UTC), on the recorded fixtures with 2 workers:
    - 1,083 uploads at up to 6,000/h: 1,083 reconciled, 0 lost, 0 refused.
    - Upload p50 30 ms, p95 86 ms, p99 155 ms.
    - The extract queue held about 4 active and 0 waiting at 3x.
    - Everything was final within 5 s of the last upload.
  - k6 Part 2 (2026-10-15 20:41 UTC), on the real models:
    - 20 single-page golden cases, one every 15 s, all reconciled, no 429.
    - End-to-end p50 3,108 ms, p90 4,162 ms, max 4,663 ms.
    - A first run had 21 invoices: the 300 s arrival window started one at its end, so the window became 290 s.
- Outstanding:
  - No run measures real models at the design rate; that needs paid tiers.
  - Web and mock-tms are not instrumented, and logs carry no trace ids.
  - A batch upload is one trace.
  - Step 7's test PR still waits for the repository.

### 2026-10-15: Step 7 CI/CD written and checked locally

- Changes: GitHub Actions. `ci.yml` (pull requests, and `workflow_call`): lint, typecheck and actionlint; unit tests with `--force`; `test:int` with the Playwright Chromium; contracts check and oasdiff against the base commit; migrations on a fresh database and on a small-seeded snapshot built from the base, with schemas compared; golden and comparison PDF checksums; the eval smoke (`pnpm eval --suite extraction --subset ci`, exit 2 warns, one PR comment updated in place); a Docker build and Trivy scan per image; gitleaks; `pnpm audit`. `release.yml` (push to main): the same checks, then build, scan and push to GHCR as `sha-<short>` and `latest` with provenance and the GHA cache; migrate and deploy jobs gated by `DEPLOY_ENABLED`. `nightly-eval.yml`: the full eval weekly with a cache kept per workflow run, the report as an artifact, an issue on a broken floor. `dependabot.yml` and a composite setup action. Multi-stage Dockerfiles for api, worker and web (turbo prune, Node 24 alpine by digest, non-root, HEALTHCHECK), `.dockerignore`, Next standalone output. `@freightaudit/config` tooling moved to devDependencies. The Toxiproxy test's fake TMS binds `TOXIPROXY_UPSTREAM_HOST` (the bridge gateway on a Linux engine). turbo.json passes `GEMINI_API_KEY` and `GROQ_API_KEY` to `eval` and `OASDIFF_BASE_REF` to `contracts:breaking`. `pnpm audit` accepts two dev-only advisories.
- Files: .github/{workflows/ci.yml,workflows/release.yml,workflows/nightly-eval.yml,dependabot.yml,actions/setup/action.yml}, .dockerignore, apps/{api,worker,web}/Dockerfile, apps/web/next.config.ts, apps/worker/src/tms-chaos.int.test.ts, packages/config/{jest-containers.js,package.json}, pnpm-lock.yaml, pnpm-workspace.yaml, turbo.json, README.md, docs/*
- Validation: actionlint 1.7.12 (with shellcheck 0.11.0) exit 0. On this PC: lint 12/12, typecheck 21/21, `pnpm test --force` 54 tests (0 of 16 tasks cached), `test:int` 92/92, `contracts:check`, oasdiff through `OASDIFF_BASE_REF` against HEAD and d6e2b2a, `pnpm audit --audit-level high` exit 0 with 2 ignored (exit 1 at moderate), gitleaks clean over 10 commits and the changed files, all 105 committed PDF blobs match their manifests. Images built (api 486 MB, worker 476 MB, web 298 MB), run as `node` and report healthy (the worker once Redis is reachable); the worker image renders a golden scan to JPEG with musl canvas; Trivy finds no fixable critical (api: 4 HIGH). On a docker:29-dind engine with a Debian runner in its network namespace: install, golden checksums, actionlint, Playwright `--with-deps`, `test:int` 92/92, and the old 127.0.0.1 binding fails the chaos test; migrations: d6e2b2a's code migrated (0001 to 0006) and seeded a snapshot (500 invoices), 0007 to 0010 applied on it, schema identical to fresh, and an added column breaks the comparison; gitleaks scans a clone owned by uid 1001 and finds a planted token (exit 1); the report lookup lists new and modified reports. turbo and pnpm pass a task's exit code through (3 stays 3); empty `TURBO_TOKEN` and `TURBO_TEAM` only disable remote caching.
- Outstanding: the GitHub repository, its secrets and the test PR (manual). Unverified until then: PR comments, issues, the GHA cache, the GHCR push and provenance. release.yml's migrate and deploy wait for step 10. The two audit ignores go once fixes reach their dependents.

### 2026-10-15: Step 6b golden set v1, eval harness and full eval

- Changes: `evals/fixtures/out` regenerated. Golden set v1 and comparison v1 built by `evals/golden/build.ts` (templates gained credit memos, an optional PRO, CAD and EUR, packet pages and a handwriting overlay; `billShipment` takes an overcharge type). Harness `evals/harness` (metrics with bootstrap intervals, the real worker on Testcontainers seeded small, per-case cache keyed on set version, pins, prompt hash and PDF sha256, quota stops, reports, README table, floors in `evals/thresholds.json`). Worker: `Deps.fallbackOnRateLimit`; reconcile ends non-USD or currency-less invoices in needs_review via `currencyReview` (packages/domain) and records `review_reason` (migration 0010, also `no_shipment_match`). llm exports `EXTRACTION_PROMPT` and `paidCost`. Floors set from each subset's own run, then recomputed once under the user's looser-of-bound-and-target rule (17 ci and 15 full floors moved; docs/memory.md).
- Files: evals/{package.json,tsconfig.json,jest.config.js,thresholds.json,fixtures/*,golden/build.ts,golden/v1/*,comparison/v1/*,harness/*,reports/*}, packages/domain/src/{reconcile.ts,index.ts,reconcile.test.ts}, packages/db/{migrations/0010_review_reason.sql,src/schema.ts,src/migrations.int.test.ts,scripts/seed.ts}, packages/llm/src/{extract.ts,prices.ts,index.ts}, apps/worker/{package.json,src/workers.ts,src/extract.ts,src/reconcile.ts,src/reconcile.int.test.ts}, package.json, turbo.json, .gitignore, pnpm-lock.yaml, README.md, docs/*
- Validation: dev 20/20 right (no prompt change); ci cold run 155 s; full run 90/90 (header 0.995 digital, 1.000 scanned; line F1 1.000 and 0.985; arithmetic 1.000; precision 0.944, recall 1.000, recovery 1.000, false flags 0.007, escalation 0; extraction latency p50 2.3 s, p95 4.7 s; paid-equivalent $0.0005 digital, $0.0015 scanned); comparison 14 common scans tie on accuracy, 3.5-flash-lite faster and cheaper. Typecheck 21/21, lint 12/12. `pnpm turbo run test --force` three runs: 54 tests in 7 packages, 0 of 16 tasks cached, 18.2, 18.8 and 15.8 s. `test:int` three runs after a forced build (7 tasks, 0 cached): 92 of 92 in 21.9, 22.2 and 20.5 s (30 to 34 s wall).
- Outstanding: the comparison's 15th `gemini-3.8-flash` case waits for its daily quota (resume with the same command). Misses on the test split (remit title read as carrier in g010 and g046; repeated page read as two invoices in g080) wait for v2 dev cases. End-to-end latency and throughput under normal load wait for step 8's k6 test. Multi-currency support is a later step.

### 2026-10-15: Fallback moved from Mistral to Groq qwen

- Changes: `LLM_FALLBACK_*` defaults are now Groq `qwen/qwen3.8-27b`, 30 requests and 8,000 tokens a minute (user decision, after Mistral answered every chat call with 429 code 1300 and a 0 request limit with two keys); going back to Mistral is configuration only. Groq's page cap is 3 (`maxImages`), its documented image limit, which a 4-image request confirmed (400 "Too many images provided. This model supports up to 3 images"). `prices.json` prices the model ($0.80 and $4.00 per million tokens paid, preview). `mistral-scanned` became `fallback-scanned`, which resolves the fallback through `llmRoles` (environment over `.env` over defaults) and is recorded against Groq. The Mistral adapter stays, covered by `mistral.test.ts` (hand-written reply in Mistral's documented shape, its 429 and 401 bodies, the 8-image cap). Worker tests use a Groq fallback like the defaults. The Mistral recording item moved under "Mistral, if the account ever works" in docs/todo.md; 6a is complete.
- Files: packages/config/src/env.ts, .env.example, README.md, packages/llm/{prices.json,src/models.ts,src/mistral.test.ts,src/recorded.int.test.ts,fixtures/recorded/fallback-scanned.json}, apps/worker/src/{testing.ts,extract.int.test.ts,crash.int.test.ts}, docs/{context,memory,todo,activity-log}.md
- Validation: Typecheck 20 of 20 and lint 12 of 12 pass. Groq probes: the headers give 8,000 tokens a minute and 1,000 requests a day; one scanned page used 2,022 prompt and 175 output tokens (about 2,280 of the minute's budget by Groq's count); a synthetic 3-page scan read right on the first pass with 5,618 and 442 (about 6,560); the same page three times got an empty invoice list. `fallback-scanned` recorded: one call, first pass, every field right. `pnpm turbo run test --force`, three runs: 50 tests in 6 packages pass, 0 of 14 tasks cached, 9.25, 9.68 and 8.03 s. `test:int` three runs, each after `turbo run build --filter=./packages/* --force` (7 tasks, 0 cached, 4.7 to 5.1 s): 89 of 89 pass in 20.4, 19.9 and 19.1 s (28 to 30 s wall).
- Outstanding: The text path and the fallback share Groq, so one Groq outage disables both. The fallback reads about three one-page scans a minute and at most 3 pages a request. `qwen/qwen3.8-27b` is a preview model.

### 2026-10-15: Large scans: JPEG pages and the fallback page cap

- Changes: Scanned pages go to the models as JPEG at quality 80 instead of PNG. A provider may cap page images per request (`maxImages`; Mistral 8): a scan with more page images than the fallback takes never reaches it, and where the ladder would call it (a primary 429, or output still invalid after the repair) the invoice ends needs_review with the problem `fallback_page_cap`, never a dead letter (user's option 1). `LLM_FALLBACK_TPM` defaults to 20,000 instead of 500,000, from the Mistral console's Limits page (user). Cassettes keep each recorded request's size (`body_bytes`), and the cassette server reports the sizes it received. Re-recorded `gemini-scanned` (now JPEG) and recorded `gemini-long-scan` (a 20-page scan drawn at test time). Checked the new Mistral key: it lists models, and every chat call still gets 429 with `x-ratelimit-limit-req-minute=0`.
- Files: packages/llm/src/{pages.ts,extract.ts,openai.ts,gemini.ts,models.ts,testing.ts,extract.test.ts,pages.test.ts,gemini.int.test.ts,openai.int.test.ts,recorded.int.test.ts}, packages/llm/fixtures/recorded/{gemini-scanned.json,gemini-long-scan.json}, apps/worker/src/extract.int.test.ts, packages/config/src/env.ts, .env.example, docs/{context,memory,todo,activity-log}.md
- Validation: Typecheck 20 of 20 and lint 12 of 12 pass. `pnpm turbo run test --force`, three runs: 46 tests in 6 packages pass, 0 of 14 tasks cached, 8.99, 8.29 and 7.83 s. `test:int` three runs, each after `turbo run build --filter=./packages/* --force` (7 tasks, 0 cached, about 4.3 s): 88 of 89 pass in 18.8, 17.8 and 18.2 s (26 to 28 s wall); the failure is `mistral-scanned`, whose cassette does not exist (ENOENT). The 20-page recording: one call of 6,547,940 bytes, 22,350 input tokens (22,040 of them image) and 3,329 output, first pass, every field right; the first recording read the PRO `2000000020` as `200000020` while getting all 60 amounts right, so the test now prints realistic identifiers. Accuracy check: the scanned smoke invoice as JPEG equals a fresh PNG run and the PNG result the smoke run stored, in the header and all 5 lines (dev Postgres started for the read, then stopped).
- Outstanding: Mistral is still blocked (docs/todo.md, Blocked). Scans over 8 pages have no fallback; batch and merge is the upgrade path. The api's 10 MiB upload limit takes a 20-page scan only below about 0.5 MB a page.

### 2026-10-15: Step 6a provider layer and extraction pipeline

- Changes: Keys checked first: the Gemini `AQ.` key lists models and answers a tiny call through `x-goog-api-key` (no 401; no `GOOGLE_API_KEY` or `GEMINI_API_KEY` in the Windows environment), the Groq key lists its models. Model roles from env, validated by `llmRoles` in packages/config (user choices: primary `gemini-3.5-flash-lite`, text `openai/gpt-oss-120b`, fallback `mistral-small-2603`; `gemini-3.8-flash` rejected for its free-tier daily cap, see docs/memory.md); `GEMINI_MODEL`, `GEMINI_BASE_URL` and `LLM_TOKENS_PER_MINUTE` replaced. packages/llm: Gemini on `@google/genai` and one OpenAI-compatible client, `RateLimitError` and `ProviderConfigError` within the existing taxonomy, per-page routing and 1,000 px PNG renders with pdfjs-dist and @napi-rs/canvas, the schema with `subtotal_cents` and `tax_cents`, the ladder (first pass, one repair, one fallback pass, needs_review; a first-pass 429 falls back), per-role requests and tokens per minute in the Redis bucket, `prices.json` and call costs, test helpers (`fakeModels`, cassette record and replay). packages/domain: `checkArithmetic` (replaces `linesMatchTotal`), `microUsd` and `tokenCost`. Migration 0009 (`llm_calls`, extraction step and fallback reason, extracting to needs_review). Worker: per-role models, a call row per call, needs_review on output that stays invalid, a circuit breaker that pauses the extract queue on 401, 403 or 404 with `pnpm extract:resume`, case-insensitive carrier match (found by the smoke run). The prompt states the YYYY-MM-DD date, after the first real recordings showed both models copying printed dates and needing a repair. turbo passes `PLAYWRIGHT_BROWSERS_PATH` to `pnpm fixtures`, which otherwise looked for its browser on C:.
- Files: packages/config/src/env.ts, packages/domain/src/{index.ts,money.ts,money.test.ts}, packages/llm/{package.json,prices.json,fixtures/*,src/errors.ts,src/extract.ts,src/gemini.ts,src/openai.ts,src/pages.ts,src/limits.ts,src/models.ts,src/prices.ts,src/testing.ts,src/index.ts,src/*.test.ts,src/*.int.test.ts}, packages/db/{migrations/0009_llm_calls.sql,src/schema.ts,src/migrations.int.test.ts,scripts/seed.ts}, packages/pipeline/{package.json,scripts/resume-extract.ts}, apps/worker/src/{main.ts,workers.ts,extract.ts,testing.ts,extract.int.test.ts,crash.int.test.ts,main.int.test.ts}, package.json, turbo.json, pnpm-workspace.yaml, pnpm-lock.yaml, .env.example, docs/*
- Validation: `pnpm turbo run typecheck` 20 of 20 and `pnpm lint` 12 of 12 pass. `pnpm test --force` passed three runs in a row (45 tests in 6 packages); `pnpm test:int` passed 86 of 87 three runs in a row (about 18 s), the one failure being `mistral-scanned`, which has no recording yet. Recorded real responses: Gemini on the scanned fixture and Groq on the digital one, both read every header field and line amount right on the first pass; real rejections of a made-up key and an unknown model from Gemini (400 `API_KEY_INVALID`, 404) and Groq (401, 404), and Mistral's 401 and 429. Live smoke run on the dev stack (0009 applied to the dev database in 39 ms, worker with `AI_ENABLED=true`): a digital fixture went to Groq (802 input and 892 output tokens, 2,335 ms) and a scanned one to Gemini (1,325 and 297, 2,528 ms), both first pass at $0, both reconciled, and the digital one's planted duplicate charge (11,635 cents) is its one finding. The first smoke pair ended needs_review: `evals/fixtures/out` predates the 5b seed, and the carrier match was case-sensitive (fixed).
- Outstanding: The Mistral workspace allows 0 requests a minute (429 code 1300), so the fallback cannot be called or recorded until its free plan is active (docs/todo.md, Blocked). The Ollama test mode is unverified (Ollama is not installed). `evals/fixtures/out` must be regenerated before 6b. Scanned PDFs over about 8 pages exceed Mistral's image limit and Gemini's inline size.

### 2026-10-15: db:reset clears the queues; rule for file edits

- Changes: `pnpm db:reset` moved to `packages/pipeline/scripts/reset.ts` (`resetDev`), which already depends on BullMQ. After the database guard and a new Redis guard (the host ioredis resolves must be localhost or 127.0.0.1), it refuses while any job runs. It then obliterates the extract, reconcile and tms-sync queues and their dead-letter queues, and resets the database through `packages/db/scripts/reset.ts`. That file now exports the guard (`assertDevDatabase`) and no longer has its own command. packages/db gained no dependency. The pipeline package exports `./scripts/*`, and its tsconfig now typechecks `scripts` while the build still emits `src` only. AGENTS.md (General Principles) gained the rule to write and edit files with the file editing tools, never through shell echo, heredocs or redirects.
- Files: packages/pipeline/{scripts/reset.ts,package.json,tsconfig.json,tsconfig.build.json}, packages/db/{scripts/reset.ts,package.json}, apps/worker/src/extract.int.test.ts, AGENTS.md, README.md, docs/*
- Validation: `turbo run build typecheck lint test contracts:check --force` passes 42 of 42 tasks. `pnpm test:int` passed three runs in a row (55 tests). The new test uploads and extracts a PDF, runs `resetDev`, and uploads the same bytes again. They are extracted again (a second model call); without the obliterate, the second upload never extracts and the test fails. `NODE_ENV=production pnpm db:reset` and a `REDIS_URL` of `cache.example.com` both exit 1 with their refusal, leaving the dev database (501 invoices) and Redis (23 keys) as they were. On the dev stack, after a `pg_dump` copied out of the container into the job's temporary directory, `pnpm db:reset` cleared 6 queues, leaving no BullMQ keys (only the AI day counter), and reseeded small. A scratch database reset by the same code matched the dev database in all 13 seeded tables (rows and content hashes) and in its 9 migrations, whose apply times differ; the scratch database was dropped.
- Outstanding: Not committed.

### 2026-10-15: Failure reasons for unpriceable reconciles, and pnpm db:reset

- Changes: Answering the question first: through the worker, a reconcile job that meets data it cannot price already ended the invoice failed, because the dead-letter handler moves it from reconciling. The earlier direct-call test stopped before that handler and named the intermediate reconciling state, and the reason lived only on the dead letter. The api now returns `failure_reason` on invoices: the error of a failed invoice's open dead letter, found through the open-job index by content hash, and null otherwise or once a replay closes it. Contracts updated (`openapi.yaml` 0.6.0, GraphQL `Invoice.failureReason`, the `Invoice` operation) and regenerated. Worker tests replace the direct-call one: no version in force, a version without linehaul terms and a shipment without miles each dead-letter the job and end the invoice failed with its reason, and a replay once the miles arrive reconciles it. New `pnpm db:reset` (`packages/db/scripts/reset.ts`): it drops schema `public`, recreates it as a new database has it, migrates and seeds small. It refuses unless pg's resolved host is localhost or 127.0.0.1 and `NODE_ENV` is not production, and waits at most 5 s for locks. `NODE_ENV` was added to the env schema and `.env.example`, the Turborepo task passes it through, and the README documents the command.
- Files: apps/api/src/{service.ts,openapi.contract.test.ts}, apps/worker/src/reconcile.int.test.ts, packages/contracts/{openapi.yaml,schema.graphql,operations/invoice.graphql,src/generated/*}, packages/db/{scripts/reset.ts,src/migrations.int.test.ts,package.json}, packages/config/src/env.ts, package.json, turbo.json, .env.example, README.md, docs/*
- Validation: `turbo run build typecheck lint test contracts:check --force` passes 42 of 42 tasks. `pnpm test:int` passed three runs in a row (54 tests). Removing the dead-letter move to failed fails 4 of the new tests. `NODE_ENV=production pnpm db:reset` and a run against `db.example.com` both exit 1 with their refusal and no password in the output, leaving the dev database untouched. The integration test also covers a `?host=` override. On the dev database, after a `pg_dump` to the job's temporary directory, `pnpm db:reset` took 3 s: 9 migrations, the small seed, 36 bands, 5,000 shipments with miles. End to end on the dev stack (api, worker, mock-tms, MinIO, Redis, Postgres), fixture `invoice-0001` (a duplicate LIFTGATE planted on a seeded Nimbus Road Lines shipment) was uploaded through the api (202). It was extracted by the worker through a local fake Gemini that answered with the fixture's ground truth, since no key is set, in one model call. It reconciled on rate card version 2 against shipment SHP-004996, with 6 lines and exactly the planted `duplicate_charge` open on line 6, which the api listed. The TMS sync added mock-tms's 1,000 shipments.
- Outstanding: The extract step has not met a real model. `db:reset` leaves Redis, so a PDF uploaded before a reset is not extracted again until its completed job expires (7 days). Not committed.

### 2026-10-15: Step 5b: the real reconcile job

- Changes: Migration `0007_reconcile_terms` (expand): `rate_card_versions.minimum_cents` and `fuel_bp`, the `rate_card_bands` table (version, from_mile, cents_per_mile), `shipments.miles`, `NOT VALID` checks, and `check_invoice_transition` replaced to also reject approval while a discrepancy is open; `0008_invoices_shipment_index` builds `invoices_shipment_id_idx` concurrently. `apps/worker/src/reconcile.ts` replaces the stub: it commits the move to reconciling, then in one transaction locks the invoice and its shipment, lets `versionInForce` pick among the carrier's versions, loads bands, accessorials and the charges other reconciled invoices billed for the shipment, calls `reconcileInvoice`, writes the lines (by position, with their version) and one discrepancy per finding, and sets reconciled. An unmatched carrier or PRO number sets needs_review; unpriceable data is a PermanentError. Status meaning (user decision): findings leave invoices reconciled with open discrepancies, and needs_review is reserved for extractions that could not be trusted; `InvoiceStatus` descriptions in `openapi.yaml` (0.5.0) and `schema.graphql` say so, clients regenerated. `packages/domain`: `reconcileInvoice` no longer returns a status, and `RateCardVersion.from` may be null. Seed: `buildSeed` builds data and ground truth in memory, and `seed()` returns the truth (each line's contracted and billed cents, every planted overcharge with its explanation); versions get three graduated bands, a minimum and a fuel percentage, shipments get miles, and lines are priced by `rateShipment`; every extracted invoice gets an extraction row; reconciled invoices carry open findings and approved ones decided findings; extracted and reconciling invoices carry planted overcharges for the job; needs_review invoices carry a misread PRO number; every row has a faker id; the flat mode writes shipments with their 0001 columns. Fixture generator: invoices bill shipments the small seed leaves unbilled, and the ground truth adds `expected_cents` per line and an `overcharges` list. mock-tms and the TMS sync carry miles. New workspace dependencies: worker on domain, db (dev) on domain.
- Files: packages/db/{migrations/0007_reconcile_terms.sql,migrations/0008_invoices_shipment_index.sql,src/schema.ts,src/migrations.int.test.ts,scripts/seed.ts,package.json}, packages/domain/src/{reconcile.ts,reconcile.test.ts}, apps/worker/{package.json,src/reconcile.ts,src/reconcile.int.test.ts,src/tms-sync.ts,src/tms-sync.int.test.ts,src/extract.int.test.ts}, apps/mock-tms/src/app.ts, evals/fixtures/{generate-invoices.ts,templates.ts}, packages/contracts/{openapi.yaml,schema.graphql,src/generated/*}, pnpm-lock.yaml, README.md, docs/*
- Review: a code-review agent approved with four items, all addressed. No test priced a shipment under version 2, so a version range that never closed went unnoticed; the clean case now runs before and after the increase. The permanent failures had no test; one now covers a shipment without miles and one shipped before every version. `rate_cards` rows took random `uuidv7()` ids, so two seeds differed in that table; they get faker ids. Shipments synced before 0007 never get miles from a sync that resumes at its cursor; `docs/migrations.md` now gives the cursor reset as the migrate step.
- Validation: `turbo run build typecheck lint test contracts:check --force` passes 42 of 42 tasks (unit 35 tests; domain 23 at 100 % coverage). `pnpm test:int` passed three runs in a row: 51 tests in 16 suites, about 15 s each. Eleven mutations each fail the new reconcile suite: no status guard, no invoice lock, no shipment lock, findings ending at needs_review, no earlier billed lines, the first version instead of the one in force, a version range that never closes, no miles guard, an unmatched invoice that errors, an inclusive version end in the domain, and a planted rate mismatch the seed records at the contract amount. The first concurrency test passed even without the invoice lock: two runs on a fresh pool never overlapped. A third session now holds a row lock until both runs wait, and it polls `pg_stat_activity` outside its own transaction, whose snapshot never changes. In scratch databases on the dev server, since dropped, two small seeds hashed identical over every table, at about 0.9 s each (500 invoices, 1,268 lines, 454 extractions, 111 discrepancies, 79 open). The large seed took 17.4 s (51,065 lines, 4,842 discrepancies). `pnpm fixtures --count=6` wrote 24 files with the new ground truth. A 6-line invoice with long names still fits the scanned page (its content ends at 646 of 1,056 px).
- Outstanding: The dev database is neither migrated to 0007 and 0008 nor reseeded. Its versions have no linehaul terms, and reseeding needs an empty database. needs_review has no way back to reconciliation (step 9). The 0007 contract step and the production cursor reset are in `docs/todo.md`. Not committed.

### 2026-10-14: Pre-commit checks: reconcile rules, container sweep label filter, deterministic token bucket

- Changes: `packages/domain` gained `reconcile.ts`: `versionInForce` (the rate card version whose half-open UTC days contain the ship date; overlaps throw) and `reconcileInvoice`, which checks every billed line against that version's linehaul (graduated bands, minimum), fuel surcharge and contracted accessorials and flags duplicates (a charge code billed before on the invoice or, through `billedBefore`, on an earlier invoice for the shipment). Only overcharges count, at most one discrepancy per line, with an evidence text through the new `formatUsd`; the result is reconciled or needs_review. Step 5 had built only the rating math; the reconcile job is still a stub. The stale-container sweep moved into `packages/config/jest-orphans.js` (`staleTestContainers`, which needs the `freightaudit.test-run` label holding a dead pid), behind Docker's label filter in `jest-containers.js`; `packages/config` gained a Jest config, a `test` script and `jest-orphans.test.js`. `createLimits` takes an optional clock that the bucket script uses instead of Redis `TIME`; the bucket test runs on a fake one. Two worker tests now check a job's state before reading it, after a `pnpm test:int` run read a job between its last attempt and its completion (`attemptsMade` 2, not 3).
- Files: packages/domain/src/{reconcile.ts,reconcile.test.ts,money.ts,money.test.ts,index.ts}, packages/config/{jest-orphans.js,jest-orphans.test.js,jest-containers.js,jest.config.js,package.json}, packages/llm/src/{limits.ts,limits.int.test.ts}, apps/worker/src/{reconcile.ts,extract.int.test.ts,crash.int.test.ts}, pnpm-lock.yaml, docs/*
- Validation: domain 23 tests at 100 % coverage; 5 rule mutations (version end inclusive, no in-invoice duplicate tracking, flagging undercharges, fuel or accessorials left out of the contract) each failed the tests. The sweep's unit test passes, and a dry run over all 16 containers on this host (filinglens 5, freightaudit compose 8, triagecopilot 3) found 0 with the label and selected none. The bucket test passed three times; with the Redis clock instead of the fake one it fails (863 recorded waits). Build, typecheck, lint and `contracts:check` pass; `pnpm test --force` passed three runs in a row (35 tests in 6 packages, 8 to 9 s); `pnpm test:int` failed once on the job-read race above, then passed three runs in a row after the fix (41 tests, 14 to 15 s), and the worker extract and crash suites passed five more times.
- Outstanding: The reconcile job does not apply the rules yet: rate card versions need per-mile bands, a minimum and a fuel percentage, and shipments need miles (step 6).

### 2026-10-14: Step 5 tests: three Jest projects, Testcontainers, property, migration and chaos tests

- Changes: `@freightaudit/config/jest` defines three Jest projects: `unit` (the default, with `jest-no-io.js`, which makes socket connects, server listens and process spawns throw), `integration` and `contract`. The root `jest.config.js` lists all three, with `testTimeout` 60 s. `pnpm test` still runs `unit` per package through Turborepo; `pnpm test:int` builds the packages, then runs `integration` and `contract` in one Jest process. Its `globalSetup` (`jest-containers.js`) starts Postgres 18, Redis, MinIO and Toxiproxy with Testcontainers from the compose images, binds them to 127.0.0.1 through a `GenericContainer` subclass, turns Ryuk off, and removes containers left by runs that died (pid label). The six per-package `jest.int.config.js` files, their `test:int` scripts and the Turborepo `test:int` task are gone; `jest` moved from worker, db and evals to the root. `@freightaudit/db/testing` gained `testEnv` (no fallback to dev services) and `createTestDatabase({ to })`; db exports `./scripts/*` and mock-tms exports `./app` as TypeScript source (mock-tms is a worker devDependency). Domain: `money.ts` (`divRound`, halves away from zero; `percentOf` in basis points) and `rating.ts` (graduated per-mile bands, a minimum linehaul, a fuel surcharge in basis points of the linehaul after the minimum), with fast-check property tests (seed 42, 1,000 runs each) and a 90 % coverage threshold. New integration tests: keyset pagination under concurrent inserts, a 50-file batch with 5 corrupt files, expand/backfill/contract under the api's own queries (moved from the db package; the flat seed now writes 0001 columns and is seeded at 0001), and the TMS sync through Toxiproxy (20 % `reset_peer`, 300 ms latency, the real mock-tms closing every connection). `gemini.test.ts` and the api's config-error test moved to integration (they open a server or a process); `contract.int.test.ts` is now `openapi.contract.test.ts`. The budget-guard test runs on a fake `Date` pinned at noon UTC. The TMS sync now retries any transient page failure in place (up to 10 times, Retry-After floor), because the chaos test showed resets used up the job's 5 attempts. New dependencies: testcontainers 12.2 (config), fast-check 4.10 (domain), jest at the root; `allowBuilds` denies ssh2, cpu-features and protobufjs.
- Files: package.json, jest.config.js, turbo.json, pnpm-workspace.yaml, pnpm-lock.yaml, .env.example, README.md, packages/config/{jest.js,jest-no-io.js,jest-containers.js,jest-containers-stop.js,package.json}, packages/domain/{jest.config.js,package.json,src/index.ts,src/money.ts,src/money.test.ts,src/rating.ts,src/rating.test.ts}, packages/db/{package.json,scripts/seed.ts,src/testing.ts,src/migrations.int.test.ts}, packages/llm/{package.json,src/gemini.int.test.ts,src/limits.int.test.ts}, packages/pipeline/{package.json,src/storage.int.test.ts}, apps/api/{package.json,src/testing.ts,src/main.int.test.ts,src/openapi.contract.test.ts,src/pagination.int.test.ts,src/batch.int.test.ts,src/expand-contract.int.test.ts}, apps/worker/{package.json,src/testing.ts,src/tms-sync.ts,src/tms-sync.int.test.ts,src/tms-chaos.int.test.ts,src/extract.int.test.ts,src/crash.int.test.ts}, apps/mock-tms/package.json, evals/package.json, docs/*; deleted the six `jest.int.config.js` files and `apps/api/src/main.test.ts`.
- Validation: On the final code, `pnpm test --force` and `pnpm test:int` each passed three runs in a row: unit 25 tests in 5 packages, 7 to 8 s wall with forced builds, domain coverage 100 %; integration 15 suites and 41 tests, Jest 8.5 to 8.9 s, 13 to 14 s wall. Before the last cleanup edits to three tests they had passed three and four runs in a row. All three projects in one root run pass 66 tests, so the guard is restored between files. typecheck (20 tasks), lint (12), build (11) and `contracts:check` pass. Mutation checks, each caught: rounding halves to even, a whole-trip band rate, fuel on the mileage before the minimum; a cursor without the id tiebreaker (59 rows skipped), `<=` (380 rows seen, 326 distinct), a millisecond cursor (292 skipped); storing rejected uploads; a backfill without the carrier join (1,112 lines with another carrier's version); a fake clock started 300 ms before UTC midnight. Before the TMS sync change, 1 of 5 chaos runs dead-lettered the sync; after it, 10 of 10 passed with 11 to 14 fetches for 10 pages. Test containers publish on 127.0.0.1 only and no Ryuk runs; a killed run's 4 containers were removed by the next run; the other projects' containers and the dev Postgres and Redis were untouched (no test databases or keys). A probe showed the unit guard refusing fetch, listen and spawn.
- Outstanding: The Toxiproxy test reaches its fake TMS through Docker Desktop's `host.docker.internal` forwarding; on a Linux engine (CI, step 7) the fake must bind to a non-loopback address. Database rate cards have no bands, minimum or fuel percentage, so reconcile cannot use `rateShipment` yet (step 6). The llm token bucket test still asserts wall-clock bounds on Redis time (under 200 ms for an immediate take); it passed every run. A run killed before teardown leaves its containers until the next run.

### 2026-10-14: Step 4 workers: BullMQ pipeline, dead letters, API protection

- Changes: New `packages/pipeline` (queues and job options with a jittered backoff, final-failure move to `<queue>-dlq` plus `dead_letters`, replay, SigV4 MinIO client). `packages/llm`: TransientError / PermanentError taxonomy, PDF read and split (pdf-lib), zod extraction schema with one repair call, Gemini `generateContent` provider over `fetch`, Redis token bucket and daily AI budget. `packages/domain`: `linesMatchTotal`. `apps/worker`: extract (jobId = content hash, 5 attempts, budget guard, multi-invoice flow with a `collect` parent), stub reconcile, TMS sync every 5 minutes with a saved cursor and 429 backoff, graceful shutdown. `apps/api`: Postgres and MinIO handlers with keyset cursors replace the stubs; Redis rate limits per key (60/min, 10/min uploads), 503 above `EXTRACT_HIGH_WATER`, 10 MiB / 20 pages / `%PDF-` checks, 30 s request timeout, real replay. `apps/mock-tms`: pagination, 10 req/s limit, `FAULT_RATE` and `LATENCY_MS`. Migration `0006`: `extractions`, `invoices.parent_invoice_id`, lifecycle trigger. `openapi.yaml` 0.4.0 states the new limits. New settings in `config/env` and `.env.example`; `TENANT_ID` appended to the local `.env`. `stub-service.ts` and `contract.test.ts` removed (replaced by `service.ts` and `contract.int.test.ts`).
- Files: packages/pipeline/*, packages/llm/*, packages/domain/src/index.ts, packages/db/{migrations/0006_extraction_pipeline.sql,src/schema.ts,src/testing.ts,src/migrations.int.test.ts,scripts/seed.ts,package.json}, packages/config/{src/env.ts,package.json}, packages/contracts/{openapi.yaml,src/generated/openapi.ts}, apps/worker/*, apps/api/*, apps/mock-tms/*, pnpm-workspace.yaml, pnpm-lock.yaml, .env.example, README.md, docs/*
- Review: a code-review agent found six issues that were fixed. Dead-letter moves were fire-and-forget; now the DLQ copy is written last and a sweep redoes unfinished moves. drizzle query errors carried bound values (line items) into logs and dead letters; they are now reduced to the driver code. A replayed `collect` stranded its upload. Backpressure ignored delayed jobs. Two lookups scanned for `parent_invoice_id`; they now use part ids and the unique extraction row. A TMS page that does not advance looped forever.
- Validation: `turbo run build typecheck lint test contracts:check --force` passes 41 of 41 tasks. `pnpm test:int` passed three runs in a row after the review fixes (13 tasks, 33 tests; the worker suite takes about 6 s). They show: two 429s then success give `attemptsMade` 3 and one extraction row, and re-adding the job is a no-op; a real worker process SIGKILLed mid-call is recovered (`stalledCounter` 1) with one extraction row; schema-invalid output after the repair lands in `extract-dlq` and `dead_letters` (attempts 1, invoice failed) and replays to extracted, and a second replay is 404; the budget guard delays the job to the next UTC midnight with no model call; a three-page PDF splits into two parts whose failed part does not fail the parent; the TMS sync retries a 429 on the same page and resumes from the saved cursor after a 500; the 11th upload gets 429 with RateLimit headers while reads and another key keep their budgets; uploads get 503 above the high-water mark; oversized, too-long and non-PDF files get 413 or 415; the trigger rejects illegal moves (23514). Mutation checks: never dead-lettering, skipping the budget guard and dropping the upload bucket each made the matching test fail. `pnpm db:migrate` applied 0006 to the dev database in 25 ms.
- Outstanding: reconcile is a stub (step 6), as are the Groq path and fallback model; the Gemini provider has not met the real API (no key); one tenant per deployment; provider 401/403/404 dead-letter every job until fixed; CI needs Redis and MinIO for `test:int`; the worker needs a stop grace period above its slowest job in production.

### 2026-10-14: One invoice lifecycle; byte-identical eval fixtures

- Changes: Migration `0005_invoice_lifecycle` adds `reconciling` and `approved` to `invoice_status`, and the Drizzle enum lists the user's lifecycle. `openapi.yaml` and `schema.graphql` use the same 8 statuses, with a lifecycle description and GraphQL value descriptions; clients regenerated. The state machine is recorded in `docs/context.md`. The seed covers all 8 statuses consistently with the lifecycle; resolved findings now sit on approved invoices, and the flat-rate seed for the backfill test keeps to the statuses that existed at 0002. The drift test also compares enum labels, and the seed test checks lines and findings against each status. The fixture generator exports `generateInvoices`, takes `--seed`, draws scan noise from an AES-CTR keystream keyed by the seed, and pins `/CreationDate` and `/ModDate` to the invoice date. The new `evals/fixtures/generate-invoices.int.test.ts` renders the 6 templates twice and compares the digests of all 24 files. The integration Jest config moved to the shared `integration` export of `@freightaudit/config/jest`.
- Files: packages/db/migrations/0005_invoice_lifecycle.sql, packages/db/src/schema.ts, packages/db/scripts/seed.ts, packages/db/src/migrations.int.test.ts, packages/db/jest.int.config.js, packages/contracts/openapi.yaml, packages/contracts/schema.graphql, packages/contracts/src/generated/*, packages/config/jest.js, evals/fixtures/generate-invoices.ts, evals/fixtures/generate-invoices.int.test.ts, evals/jest.int.config.js, evals/package.json, evals/tsconfig.json, pnpm-lock.yaml, README.md, docs/*
- Validation: `turbo run build typecheck lint test contracts:check --force` passes 35 of 35 tasks, including graphql-eslint and `Generated files are up to date`. `pnpm test:int` passes three runs in a row (db 4 tests, evals 1 test of about 6 s). `pnpm db:migrate` applied 0005 to the dev database, which held 0004 and the earlier seed. Breaking the Drizzle enum labels or letting reconciled invoices carry findings failed the matching tests; disabling date pinning failed the fixture test on every digital PDF, and unseeded noise failed it on every scan. The new small seed has all 8 statuses (1,488 lines, 137 discrepancies); large has 58,192 lines in 19.7 s. Running oasdiff against HEAD reports the two new response enum values as ERR.
- Outstanding: Transitions are documented, not enforced (step 4). Fixtures repeat byte for byte only on the same machine and Chromium build. The dev database keeps the earlier seed, in which resolved findings sit on reconciled invoices; reseeding needs an empty database.

### 2026-10-14: Step 3 data: schema, rate card versioning series, seed, eval fixtures

- Changes: Added `packages/db`: SQL migrations `0001_initial` (10 tables, enums, `uuidv7()` ids, `updated_at` triggers, keyset indexes) and the expand/contract series for rate card versioning (`0002` expand with a `btree_gist` exclusion constraint and nullable `NOT VALID` foreign keys, `0003a` check `NOT VALID`, then `VALIDATE`, then `SET NOT NULL`, `0003b` concurrent indexes, `0004` drop of `rate_cards.carrier_id`), a migration runner with no-transaction files and `--to`, the Drizzle query schema, `scripts/backfill-rate-card-versions.ts` (batches of 2,000, `lock_timeout` 3 s, retry, resumable, JSON progress) and `scripts/seed.ts` (`--scale=small|large`, `faker.seed(42)`, two rate card versions per carrier, seeded findings). Added `evals/fixtures/generate-invoices.ts` with 6 HTML templates, Playwright PDFs, ground-truth JSON and sharp scanned variants. Root `db:migrate`, `db:seed` and the new `fixtures` script pass arguments through Turborepo; `db:migrate`, `db:seed` and `fixtures` depend on `^build`. New dependencies: drizzle-orm, pg, @faker-js/faker (catalog), playwright, sharp. Wrote `docs/migrations.md`.
- Files: packages/db/*, evals/package.json, evals/tsconfig.json, evals/fixtures/*, package.json, turbo.json, pnpm-workspace.yaml, pnpm-lock.yaml, .gitignore, .env.example, README.md, docs/*
- Validation: `pnpm test:int` passes 4 of 4 tests, three runs in a row (about 9 s each). The tests cover migrations from empty with a no-op rerun and Drizzle drift, rejection of overlapping versions (23P01), the backfill on the small seed with a crash after the first batch and a resume before 0003a, 0003b and 0004 apply, and the small seed on the final schema. Breaking the exclusion constraint, a Drizzle column's nullability and the backfill's carrier join each made the matching test fail. `turbo run build typecheck lint test --force` passes 34 of 34 tasks. On the dev database, `pnpm db:migrate` applied 5 files and a rerun applied none; `pnpm db:seed --scale=small` took 1.1 s, refuses a second run and rejects `--scale=huge`; `--scale=large` in a scratch database took 18.5 s (50,000 shipments, 20,000 invoices, 58,233 lines). Two small seeds gave identical data hashes. Postgres 18.6 confirmed: `SET NOT NULL` skips the scan after a validated check (DEBUG1 message), `ADD CONSTRAINT ... NOT NULL ... NOT VALID` works, and `ON CONFLICT DO NOTHING` skips exclusion conflicts. `pnpm fixtures --count=6` rendered all 6 templates (checked visually); the scans are image-only, tilted and grainy; removing the PRO from a template made the generator fail.
- Outstanding: The invoice status values differ between the DB and the contracts (user decision). CI needs a Postgres and a `DATABASE_URL` passthrough for `test:int` (step 7). The production deploy must run migrations (step 10). Scan noise is unseeded.

### 2026-10-14: Lint exception applied and production foundations committed

- Changes: The user added the graphql-eslint `strict-id-in-types` exception (`PageInfo`, `*Connection`, `*Edge`) to `packages/contracts/eslint.config.js` and committed the production-foundations work as `2cb0a6c`, with `.githooks/pre-commit` at mode 100755. Docs now record both; the Blocked section is empty.
- Files: packages/contracts/eslint.config.js, docs/todo.md, docs/context.md, docs/memory.md, docs/activity-log.md
- Validation: `turbo run build typecheck lint test contracts:check --force` passes 33 of 33 tasks with no cache (api 16 tests, domain 2). `git ls-tree HEAD .githooks/pre-commit` shows 100755.
- Outstanding: The production override still uses the dev-only Postgres and MinIO credentials. `contracts:breaking` needs an `origin/main` remote; none is configured. The web port is not read from `.env`, and web logs are not JSON yet (step 9). Readiness is TCP-only until steps 3 and 4. 403 and 429 are documented, not emitted.

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
