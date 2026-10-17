# Extraction eval: test (2026-10-17)

Golden set v1, 70 of 70 cases (70 run now, the rest from the cache), prompt 19f0c19627c4, models: primary anthropic/claude-haiku-5-5, text anthropic/claude-haiku-5-5, fallback groq/qwen/qwen3.8-27b. Took 240 s.

70 cases give very wide intervals; this subset guards against regressions, it does not measure the targets.

| Metric | Design target | Target | Floor | Floor | Measured | 95% CI | n |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Header field accuracy (digital) | ≥ 0.980 | met | - | - | 1.000 | 1.000 to 1.000 | 55 |
| Header field accuracy (scanned) | ≥ 0.930 | met | - | - | 1.000 | 1.000 to 1.000 | 15 |
| Line-item F1 (digital) | ≥ 0.950 | met | - | - | 1.000 | 1.000 to 1.000 | 55 |
| Line-item F1 (scanned) | ≥ 0.880 | met | - | - | 0.917 | 0.757 to 1.000 | 15 |
| Arithmetic consistency (after repair) | ≥ 0.990 | met | - | - | 1.000 | 1.000 to 1.000 | 70 |
| Overcharge precision | ≥ 0.950 | missed | - | - | 0.875 | 0.619 to 1.000 | 70 |
| Overcharge recall | ≥ 0.900 | met | - | - | 1.000 | 1.000 to 1.000 | 70 |
| Dollar recovery | ≥ 0.900 | met | - | - | 1.000 | 1.000 to 1.000 | 70 |
| False flag rate | ≤ 0.030 | met | - | - | 0.018 | 0.000 to 0.056 | 70 |
| Escalation rate | ≤ 0.100 | met | - | - | 0.000 | 0.000 to 0.000 | 70 |
| Extraction latency p50 (3 pages or fewer) | ≤ 5,000 ms | met | - | - | 1,880 ms | 1,759 ms to 2,052 ms | 69 |
| Extraction latency p95 (3 pages or fewer) | ≤ 12,000 ms | met | - | - | 2,720 ms | 2,360 ms to 4,630 ms | 69 |
| Rate-limit waits (calls that waited for their per-minute limit) | - | - | - | - | 38 | 29 to 46 | 70 |
| Rate-limit wait time (total, outside extraction latency) | - | - | - | - | 655,835 ms | 263,362 ms to 1,132,711 ms | 70 |
| Failed or timed-out calls (429s, timeouts, other errors) | - | - | - | - | 0 | 0 to 0 | 70 |
| End-to-end latency p95 (under eval throttling, not normal load) | ≤ 30,000 ms | missed | - | - | 68,440 ms | 17,573 ms to 141,667 ms | 70 |
| Input tokens per page (text path) | ≤ 4,000 | met | - | - | 1,563 | 1,520 to 1,633 | 55 |
| Output tokens per page (text path) | ≤ 1,200 | met | - | - | 272 | 255 to 294 | 55 |
| Tokens per invoice (digital, in + out) | - | - | - | - | 1,868 | 1,779 to 2,034 | 55 |
| Tokens per invoice (scanned, in + out) | - | - | - | - | 5,304 | 3,460 to 8,377 | 15 |
| Cost per invoice, paid-equivalent (digital) | ≤ $0.0200 | met | - | - | $0.0003 | $0.0003 to $0.0003 | 55 |
| Cost per invoice, paid-equivalent (scanned) | ≤ $0.0500 | met | - | - | $0.0006 | $0.0005 to $0.0010 | 15 |
| Cost per invoice, as billed (free tiers) | - | - | - | - | $0.0004 | $0.0003 to $0.0005 | 70 |
| Expected outcome (status and review reason) | - | - | - | - | 1.000 | 1.000 to 1.000 | 70 |
| Throughput (free-tier ceiling, not a load test) | ≥ 2,000 / h | missed | - | - | 1,022 / h | computed, no interval | 70 |

Extraction latency counts the calls that returned a reply (first pass, repair, fallback), each from its request to its answer, without the time spent waiting on a provider's rate limit: on free tiers those waits measure the provider plan, not the pipeline, so the rate-limit rows count them, and failed or timed-out calls, apart. End-to-end latency is measured from upload to final status under this run's own throttling and concurrency, not under normal load; throughput is the ceiling the pinned roles' free-tier per-minute limits allow at the measured calls and tokens per invoice, not a load test. The k6 load test measures both (README, Load test).

## Model use

| Model | Served as | Calls | Input tokens | Output tokens |
| --- | --- | --- | --- | --- |
| anthropic/claude-haiku-5-5 | claude-haiku-5-5 | 73 | 162,666 | 19,649 |

## Failed calls

None.

## Cases with any miss

| Case | Kind | Path | Header fields | Lines tp/fp/fn | Findings tp/fp/fn | Outcome | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| g053 | clean | scanned | 6/6 | 1/5/4 | 0/4/0 | 1/1 | reconciled |
