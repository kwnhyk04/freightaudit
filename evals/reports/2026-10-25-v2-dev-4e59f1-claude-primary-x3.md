# Extraction eval: dev (2026-10-25)

Golden set v2, 102 of 102 cases (102 run now, the rest from the cache), prompt 4e59f1910cbe, models: primary gemini/gemini-3.5-flash-lite, text groq/openai/gpt-oss-120b, fallback groq/qwen/qwen3.8-27b. Took 329 s. Each case read 3 times, each read in its own environment; the tables count reads.

102 reads give very wide intervals; this subset guards against regressions, it does not measure the targets.

| Metric | Design target | Target | Floor | Floor | Measured | 95% CI | n |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Header field accuracy (digital) | ≥ 0.980 | met | - | - | 1.000 | 1.000 to 1.000 | 51 |
| Header field accuracy (scanned) | ≥ 0.930 | met | - | - | 0.981 | 0.966 to 0.994 | 51 |
| Line-item F1 (digital) | ≥ 0.950 | met | - | - | 1.000 | 1.000 to 1.000 | 51 |
| Line-item F1 (scanned) | ≥ 0.880 | met | - | - | 0.986 | 0.968 to 1.000 | 51 |
| Arithmetic consistency (after repair) | ≥ 0.990 | missed | - | - | 0.972 | 0.935 to 1.000 | 102 |
| Overcharge precision | ≥ 0.950 | met | - | - | 1.000 | 1.000 to 1.000 | 102 |
| Overcharge recall | ≥ 0.900 | met | - | - | 1.000 | 1.000 to 1.000 | 102 |
| Dollar recovery | ≥ 0.900 | met | - | - | 1.000 | 1.000 to 1.000 | 102 |
| False flag rate | ≤ 0.030 | met | - | - | 0.000 | 0.000 to 0.000 | 102 |
| Escalation rate | ≤ 0.100 | met | - | - | 0.029 | 0.000 to 0.069 | 102 |
| Extraction latency p50 (3 pages or fewer) | ≤ 5,000 ms | met | - | - | 2,056 ms | 1,951 ms to 2,099 ms | 99 |
| Extraction latency p95 (3 pages or fewer) | ≤ 12,000 ms | met | - | - | 6,457 ms | 3,760 ms to 6,904 ms | 99 |
| Rate-limit waits (calls that waited for their per-minute limit) | - | - | - | - | 24 | 14 to 34 | 102 |
| Rate-limit wait time (total, outside extraction latency) | - | - | - | - | 761,428 ms | 374,376 ms to 1,242,879 ms | 102 |
| Failed or timed-out calls (429s, timeouts, other errors) | - | - | - | - | 0 | 0 to 0 | 102 |
| End-to-end latency p95 (under eval throttling, not normal load) | ≤ 30,000 ms | missed | - | - | 66,748 ms | 25,912 ms to 94,290 ms | 102 |
| Input tokens per page (text path) | ≤ 4,000 | met | - | - | 1,351 | 1,210 to 1,520 | 51 |
| Output tokens per page (text path) | ≤ 1,200 | met | - | - | 211 | 180 to 246 | 51 |
| Tokens per invoice (digital, in + out) | - | - | - | - | 2,297 | 2,056 to 2,622 | 51 |
| Tokens per invoice (scanned, in + out) | - | - | - | - | 5,237 | 4,565 to 5,950 | 51 |
| Cost per invoice, paid-equivalent (digital) | ≤ $0.0200 | met | - | - | $0.0004 | $0.0003 to $0.0004 | 51 |
| Cost per invoice, paid-equivalent (scanned) | ≤ $0.0500 | met | - | - | $0.0009 | $0.0007 to $0.0012 | 51 |
| Cost per invoice, as billed (free tiers) | - | - | - | - | $0.0005 | $0.0004 to $0.0005 | 102 |
| Expected outcome (status and review reason) | - | - | - | - | 0.972 | 0.935 to 1.000 | 102 |
| Throughput (free-tier ceiling, not a load test) | ≥ 2,000 / h | missed | - | - | 418 / h | computed, no interval | 102 |

Extraction latency counts the calls that returned a reply (first pass, repair, fallback), each from its request to its answer, without the time spent waiting on a provider's rate limit: on free tiers those waits measure the provider plan, not the pipeline, so the rate-limit rows count them, and failed or timed-out calls, apart. End-to-end latency is measured from upload to final status under this run's own throttling and concurrency, not under normal load; throughput is the ceiling the pinned roles' free-tier per-minute limits allow at the measured calls and tokens per invoice, not a load test. The k6 load test measures both (README, Load test).

## Model use

| Model | Served as | Calls | Input tokens | Output tokens |
| --- | --- | --- | --- | --- |
| anthropic/claude-haiku-5-5 | claude-haiku-5-5 | 114 | 322,905 | 32,346 |
| groq/qwen/qwen3.8-27b | qwen/qwen3.8-27b | 3 | 6,264 | 762 |
| gemini/gemini-3.5-flash-lite | gemini-3.5-flash-lite | 3 | 20,760 | 1,185 |

## Failed calls

None.

## By kind and trait

Each row counts the cases of one kind, or with one trait (what makes a case hard); a case has one kind and any number of traits.

| By | Name | Cases | Header fields | Carrier | Invoices read right | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| kind | clean | 24 | 141/144 | 24/24 | 24/24 | 21/24 |
| kind | overcharge | 15 | 90/90 | 15/15 | 15/15 | 15/15 |
| kind | duplicate_invoice | 6 | 36/36 | 6/6 | 6/6 | 6/6 |
| kind | repeated_page | 18 | 108/108 | 18/18 | 18/18 | 18/18 |
| kind | multi_invoice | 6 | 72/72 | 12/12 | 6/6 | 12/12 |
| kind | packet | 6 | 36/36 | 6/6 | 6/6 | 6/6 |
| kind | partial_credit | 3 | 18/18 | 3/3 | 3/3 | 3/3 |
| kind | credit_memo | 3 | 18/18 | 3/3 | 3/3 | 3/3 |
| kind | revised_invoice | 3 | 18/18 | 3/3 | 3/3 | 3/3 |
| kind | tricky_number | 6 | 36/36 | 6/6 | 6/6 | 6/6 |
| kind | handwritten | 3 | 18/18 | 3/3 | 3/3 | 3/3 |
| kind | upside_down | 3 | 15/18 | 3/3 | 3/3 | 3/3 |
| kind | missing_pro | 3 | 18/18 | 3/3 | 3/3 | 3/3 |
| kind | non_usd | 3 | 18/18 | 3/3 | 3/3 | 3/3 |
| trait | carrier_wording | 21 | 144/144 | 24/24 | 21/21 | 24/24 |
| trait | continued_page | 18 | 108/108 | 18/18 | 18/18 | 18/18 |
| trait | copy_label | 6 | 36/36 | 6/6 | 6/6 | 6/6 |
| trait | early_pay_discount | 21 | 144/144 | 24/24 | 21/21 | 24/24 |
| trait | factoring_remit | 18 | 108/108 | 18/18 | 18/18 | 18/18 |
| trait | fax | 9 | 51/54 | 9/9 | 9/9 | 6/9 |
| trait | invoice_not_first | 3 | 18/18 | 3/3 | 3/3 | 3/3 |
| trait | landscape | 24 | 162/162 | 27/27 | 24/24 | 27/27 |
| trait | low_contrast | 12 | 69/72 | 12/12 | 12/12 | 12/12 |
| trait | low_res | 12 | 90/90 | 15/15 | 12/12 | 15/15 |
| trait | multi_column | 18 | 108/108 | 18/18 | 18/18 | 18/18 |
| trait | reference_numbers | 42 | 270/270 | 45/45 | 42/42 | 45/45 |
| trait | rotated_table | 6 | 36/36 | 6/6 | 6/6 | 6/6 |
| trait | skew | 9 | 54/54 | 9/9 | 9/9 | 9/9 |
| trait | stamp | 21 | 144/144 | 24/24 | 21/21 | 24/24 |
| trait | subtotal_tax | 18 | 108/108 | 18/18 | 18/18 | 18/18 |
| trait | title_line | 87 | 555/558 | 93/93 | 87/87 | 90/93 |

## Cases with any miss

| Case | Kind | Traits | Path | Header fields | Invoices read | Lines tp/fp/fn | Findings tp/fp/fn | Outcome | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| g2-020 | clean | fax, title_line | scanned | 5/6 | 1 of 1 | 3/1/1 | 0/0/0 | 0/1 | needs_review |
| g2-093 | upside_down | low_contrast | scanned | 5/6 | 1 of 1 | 4/0/0 | 0/0/0 | 1/1 | reconciled |
| g2-020#2 | clean | fax, title_line | scanned | 5/6 | 1 of 1 | 3/1/1 | 0/0/0 | 0/1 | needs_review |
| g2-093#2 | upside_down | low_contrast | scanned | 5/6 | 1 of 1 | 4/0/0 | 0/0/0 | 1/1 | reconciled |
| g2-020#3 | clean | fax, title_line | scanned | 5/6 | 1 of 1 | 3/1/1 | 0/0/0 | 0/1 | needs_review |
| g2-093#3 | upside_down | low_contrast | scanned | 5/6 | 1 of 1 | 4/0/0 | 0/0/0 | 1/1 | reconciled |

## Beside the official free run (none found)


## Claude against its caps

| Per | Largest in this run | Cap |
| --- | --- | --- |
| Output tokens per call | 549 | 560 |
| Input tokens per call | 6,465 | 7,100, estimated before sending |
| Claude tokens per invoice | 7,042 | 8,500, with the next call reserved |
