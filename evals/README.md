# FreightAudit evaluation

How well the extraction reads freight invoices, measured on synthetic invoices whose ground truth is exact. Scoring is code in `harness/metrics.ts`; no model grades another. The README's headline results and the landing page's table come from the two reports this card names.

<!-- eval:start -->
## Eval results

Golden set v2 (98 synthetic invoices, ground truth from the generator), read two ways. 98 cases give wide intervals; misses are listed as misses.

- **Claude first** (Claude Haiku 5.5 reads first at every step, with the free models behind it: the demo's chain while Claude reads first): measured 2026-10-31; served: anthropic/claude-haiku-5-5 89.3% of calls, groq/qwen/qwen3.8-27b 5.7%, gemini/gemini-3.5-flash-lite 4.9%. Full report: [`evals/reports/2026-10-31-v2-full-claude-first.md`](reports/2026-10-31-v2-full-claude-first.md).
- **Free models only** (what CI checks on every change to extraction, and what reads once Claude stops at its end date, its spend cap or its credit): measured 2026-10-27 with primary gemini/gemini-3.5-flash-lite, text groq/openai/gpt-oss-120b, fallback groq/qwen/qwen3.8-27b. Full report: [`evals/reports/2026-10-27-v2.md`](reports/2026-10-27-v2.md).

| Metric | Target | Claude first | 95% CI | Met | Free models only | 95% CI | Met |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Header field accuracy (digital) | ≥ 0.980 | 1.000 | 1.000 to 1.000 | yes | 0.994 | 0.983 to 1.000 | yes |
| Header field accuracy (scanned) | ≥ 0.930 | 0.928 | 0.848 to 0.987 | no | 0.943 | 0.868 to 0.994 | yes |
| Line-item F1 (digital) | ≥ 0.950 | 1.000 | 1.000 to 1.000 | yes | 0.995 | 0.983 to 1.000 | yes |
| Line-item F1 (scanned) | ≥ 0.880 | 0.930 | 0.844 to 0.995 | yes | 0.950 | 0.896 to 0.990 | yes |
| Arithmetic consistency (after repair) | ≥ 0.990 | 0.952 | 0.905 to 0.991 | no | 0.971 | 0.927 to 1.000 | no |
| Overcharge precision | ≥ 0.950 | 1.000 | 1.000 to 1.000 | yes | 1.000 | 1.000 to 1.000 | yes |
| Overcharge recall | ≥ 0.900 | 0.974 | 0.906 to 1.000 | yes | 0.949 | 0.852 to 1.000 | yes |
| Dollar recovery | ≥ 0.900 | 0.996 | 0.978 to 1.000 | yes | 0.990 | 0.953 to 1.000 | yes |
| False flag rate | ≤ 0.030 | 0.000 | 0.000 to 0.000 | yes | 0.000 | 0.000 to 0.000 | yes |
| Escalation rate | ≤ 0.100 | 0.061 | 0.020 to 0.112 | yes | 0.020 | 0.000 to 0.051 | yes |
| Extraction latency p50 (3 pages or fewer) | ≤ 5,000 ms | 1,743 ms | 1,671 ms to 1,803 ms | yes | 2,359 ms | 2,072 ms to 2,587 ms | yes |
| Extraction latency p95 (3 pages or fewer) | ≤ 12,000 ms | 5,742 ms | 3,251 ms to 8,019 ms | yes | 10,690 ms | 7,812 ms to 15,054 ms | yes |
| Input tokens per page (text path) | ≤ 4,000 | 1,596 | 1,350 to 1,895 | yes | 803 | 717 to 902 | yes |
| Output tokens per page (text path) | ≤ 1,200 | 277 | 211 to 361 | yes | 609 | 519 to 713 | yes |
| Cost per invoice, paid-equivalent (digital) | ≤ $0.0200 | $0.0005 | $0.0003 to $0.0008 | yes | $0.0007 | $0.0006 to $0.0008 | yes |
| Cost per invoice, paid-equivalent (scanned) | ≤ $0.0500 | $0.0012 | $0.0007 to $0.0020 | yes | $0.0020 | $0.0015 to $0.0026 | yes |

Under load, from the k6 load test:

| Metric | Target | Measured | 95% CI | Met | Model | Date |
| --- | --- | --- | --- | --- | --- | --- |
| End-to-end latency at low load with real free-tier models (k6, n = 20, one every 15 s; p95 is not meaningful at this n) | p95 ≤ 30,000 ms | p50 3,108 ms, p90 4,162 ms, max 4,663 ms | n/a | yes | all roles | 2026-10-15 |
| Throughput (k6: recorded-fixture model provider at 3x the 2,000/h normal rate, 2 workers x 8) | ≥ 2,000 / h | 6,000 / h sustained for 10 min: 1,083 accepted, 0 lost, all final within 5 s of the last upload | n/a | yes | recorded fixtures | 2026-10-15 |
<!-- eval:end -->

## The set

- **Golden set v2:** 98 synthetic invoices, 48 digital and 50 scanned (`golden/v2/manifest.json`), drawn by the same generator that writes their ground truth. It adds four layouts to v1's six (`fixtures/templates-v2.ts`), scan noise such as fax, stamps, tilt, faded print and 96 dpi (`fixtures/scan-v2.ts`), and 37 adversarial cases: repeated pages, several invoices in one file, partial credits, credit memos, revised invoices, tricky invoice numbers, handwriting, upside-down pages, a missing PRO number and other currencies.
- **Splits:** a dev split of 34 cases, on which prompts and settings are chosen, and a test split of 64 that is never tuned on. A ci subset of 20 gates every pull request.
- **Golden set v1,** the first and easier set of 90 invoices, stays with its floors (`thresholds.json`), but CI no longer runs it.

## What these numbers show, and what they don't

- **The set is synthetic.** Real carrier invoices may score differently, and with 98 cases every interval is wide: a difference between the two runs whose 95% intervals overlap is within the margin of error.
- **Claude first misses two targets:** scanned header accuracy, 0.928 against 0.930, and arithmetic consistency after repair, 0.952 against 0.990. The free models alone miss arithmetic consistency, 0.971. In both cases the two runs' intervals overlap.
- **Extraction latency** counts successful calls only, from the first request to the parsed answer, repairs included. Waits for a provider's rate limit measure the free plan, not the pipeline, so the harness counts them, their time and failed calls apart, each with a floor (`thresholds-v2.json`).
- **The ci subset's floors are wide.** They come from the lower 95% bounds of 20 cases, so they catch large regressions only. Its two latency p95 rows are reported but do not gate: with 20 cases a p95 is the slowest one or two. The weekly full run gates them.
- **The k6 rows measure the system, not the models at scale:** latency is 20 invoices on the real free-tier models, one every 15 s (`../loadtest/k6.js`), and throughput is 3x the design rate of 2,000 invoices an hour with recorded replies in place of the models (`../loadtest/system-results.json`).
- **The Claude-first run cost $0.0458** for 98 invoices: 109 Claude calls, 299,247 input and 31,727 output tokens at Haiku 5.5's prices (`reports/2026-10-31-v2-full-claude-first.md`, Model use). It sets no floors; CI's floors come from the free models alone.

## Run it

```bash
pnpm eval --suite extraction --subset dev     # Claude first, on the dev split (needs Docker and the model keys in .env)
pnpm eval --suite extraction --subset full --config free   # the free models alone, as CI runs them
```

Each run writes `reports/<date>-v2[-<subset>].json` and `.md`. A full run that read every case also rewrites the table above, the README's headline results and the landing page's results (`../apps/web/lib/eval-results.json`).
