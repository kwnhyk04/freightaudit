# Extraction eval: full (2026-11-02)

Golden set v2, 98 of 98 cases (64 run now, the rest from the cache), prompt 4e59f1910cbe, models: anthropic/claude-sonnet-5-5 first at every step, then primary gemini/gemini-3.5-flash-lite, text groq/openai/gpt-oss-120b, fallback groq/qwen/qwen3.8-27b. Took 209 s.

Served: anthropic/claude-sonnet-5-5 93.9% of calls, gemini/gemini-3.5-flash-lite 3.5%, groq/qwen/qwen3.8-27b 2.6%.

98 cases give wide intervals: read each measurement with its 95% interval.

| Metric | Design target | Target | Floor | Floor | Measured | 95% CI | n |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Header field accuracy (digital) | ≥ 0.980 | met | - | - | 1.000 | 1.000 to 1.000 | 48 |
| Header field accuracy (scanned) | ≥ 0.930 | met | - | - | 0.934 | 0.825 to 1.000 | 50 |
| Line-item F1 (digital) | ≥ 0.950 | met | - | - | 1.000 | 1.000 to 1.000 | 48 |
| Line-item F1 (scanned) | ≥ 0.880 | met | - | - | 0.968 | 0.903 to 1.000 | 50 |
| Arithmetic consistency (after repair) | ≥ 0.990 | missed | - | - | 0.971 | 0.915 to 1.000 | 98 |
| Overcharge precision | ≥ 0.950 | met | - | - | 1.000 | 1.000 to 1.000 | 98 |
| Overcharge recall | ≥ 0.900 | met | - | - | 0.974 | 0.906 to 1.000 | 98 |
| Dollar recovery | ≥ 0.900 | met | - | - | 0.996 | 0.978 to 1.000 | 98 |
| False flag rate | ≤ 0.030 | met | - | - | 0.000 | 0.000 to 0.000 | 98 |
| Escalation rate | ≤ 0.100 | met | - | - | 0.031 | 0.000 to 0.071 | 98 |
| Extraction latency p50 (3 pages or fewer) | ≤ 5,000 ms | met | - | - | 2,897 ms | 2,750 ms to 3,080 ms | 94 |
| Extraction latency p95 (3 pages or fewer) | ≤ 12,000 ms | met | - | - | 7,133 ms | 4,507 ms to 9,516 ms | 94 |
| Rate-limit waits (calls that waited for their per-minute limit) | - | - | - | - | 32 | 23 to 42 | 98 |
| Rate-limit wait time (total, outside extraction latency) | - | - | - | - | 687,402 ms | 357,603 ms to 1,079,066 ms | 98 |
| Failed or timed-out calls (429s, timeouts, other errors) | - | - | - | - | 1 | 0 to 3 | 98 |
| End-to-end latency p95 (under eval throttling, not normal load) | ≤ 30,000 ms | missed | - | - | 54,595 ms | 18,829 ms to 77,584 ms | 98 |
| Input tokens per page (text path) | ≤ 4,000 | met | - | - | 1,596 | 1,350 to 1,895 | 48 |
| Output tokens per page (text path) | ≤ 1,200 | met | - | - | 277 | 211 to 361 | 48 |
| Tokens per invoice (digital, in + out) | - | - | - | - | 2,537 | 1,997 to 3,242 | 48 |
| Tokens per invoice (scanned, in + out) | - | - | - | - | 4,584 | 4,034 to 5,191 | 50 |
| Cost per invoice, paid-equivalent (digital) | ≤ $0.0200 | met | - | - | $0.0079 | $0.0062 to $0.0100 | 48 |
| Cost per invoice, paid-equivalent (scanned) | ≤ $0.0500 | met | - | - | $0.0105 | $0.0094 to $0.0120 | 50 |
| Cost per invoice, as billed (free tiers) | - | - | - | - | $0.0090 | $0.0080 to $0.0103 | 98 |
| Expected outcome (status and review reason) | - | - | - | - | 0.962 | 0.902 to 1.000 | 98 |
| Throughput (free-tier ceiling, not a load test) | ≥ 2,000 / h | missed | - | - | 386 / h | computed, no interval | 98 |

Extraction latency counts the calls that returned a reply (first pass, repair, fallback), each from its request to its answer, without the time spent waiting on a provider's rate limit: on free tiers those waits measure the provider plan, not the pipeline, so the rate-limit rows count them, and failed or timed-out calls, apart. End-to-end latency is measured from upload to final status under this run's own throttling and concurrency, not under normal load; throughput is the ceiling the pinned roles' free-tier per-minute limits allow at the measured calls and tokens per invoice, not a load test. The k6 load test measures both (README, Load test).

## Model use

| Model | Served as | Calls | Share of calls | Failed | Input tokens | Output tokens |
| --- | --- | --- | --- | --- | --- | --- |
| anthropic/claude-sonnet-5-5 | claude-sonnet-5-5 | 107 | 93.9% | 0 | 289,246 | 30,770 |
| gemini/gemini-3.5-flash-lite | gemini-3.5-flash-lite | 4 | 3.5% | 0 | 25,915 | 1,760 |
| groq/qwen/qwen3.8-27b | qwen/qwen3.8-27b | 3 | 2.6% | 1 | 2,030 | 1,226 |

## Failed calls

| Case | Provider | Model | Class | HTTP | Error |
| --- | --- | --- | --- | --- | --- |
| g2-074 | groq | qwen/qwen3.8-27b | parse_or_schema | 400 | groq HTTP 400 json_validate_failed |

## By kind and trait

Each row counts the cases of one kind, or with one trait (what makes a case hard); a case has one kind and any number of traits.

| By | Name | Cases | Header fields | Carrier | Invoices read right | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| kind | clean | 32 | 191/192 | 32/32 | 32/32 | 32/32 |
| kind | overcharge | 20 | 118/120 | 20/20 | 20/20 | 19/20 |
| kind | duplicate_invoice | 5 | 30/30 | 5/5 | 5/5 | 5/5 |
| kind | repeated_page | 12 | 72/72 | 12/12 | 12/12 | 12/12 |
| kind | multi_invoice | 5 | 54/72 | 9/12 | 4/5 | 9/12 |
| kind | packet | 4 | 24/24 | 4/4 | 4/4 | 4/4 |
| kind | partial_credit | 3 | 18/18 | 3/3 | 3/3 | 3/3 |
| kind | credit_memo | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
| kind | revised_invoice | 3 | 18/18 | 3/3 | 3/3 | 3/3 |
| kind | tricky_number | 4 | 24/24 | 4/4 | 4/4 | 4/4 |
| kind | handwritten | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
| kind | upside_down | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
| kind | missing_pro | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
| kind | non_usd | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
| trait | carrier_wording | 16 | 108/108 | 18/18 | 16/16 | 18/18 |
| trait | continued_page | 14 | 96/96 | 16/16 | 14/14 | 16/16 |
| trait | copy_label | 4 | 24/24 | 4/4 | 4/4 | 4/4 |
| trait | early_pay_discount | 16 | 108/108 | 18/18 | 16/16 | 18/18 |
| trait | factoring_remit | 16 | 102/120 | 17/20 | 15/16 | 17/20 |
| trait | fax | 10 | 52/72 | 9/12 | 9/10 | 8/12 |
| trait | invoice_not_first | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
| trait | landscape | 16 | 101/120 | 17/20 | 15/16 | 17/20 |
| trait | low_contrast | 10 | 60/60 | 10/10 | 10/10 | 10/10 |
| trait | low_res | 10 | 65/66 | 11/11 | 10/10 | 11/11 |
| trait | multi_column | 16 | 102/120 | 17/20 | 15/16 | 17/20 |
| trait | reference_numbers | 30 | 197/216 | 33/36 | 29/30 | 33/36 |
| trait | rotated_table | 5 | 23/42 | 4/7 | 4/5 | 4/7 |
| trait | skew | 10 | 60/60 | 10/10 | 10/10 | 10/10 |
| trait | stamp | 22 | 138/138 | 23/23 | 22/22 | 23/23 |
| trait | subtotal_tax | 14 | 96/96 | 16/16 | 14/14 | 16/16 |
| trait | title_line | 78 | 489/510 | 82/85 | 77/78 | 81/85 |

## Cases with any miss

| Case | Kind | Traits | Path | Header fields | Invoices read | Lines tp/fp/fn | Findings tp/fp/fn | Outcome | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| g2-024 | clean | landscape, low_res, reference_numbers, rotated_table, title_line | scanned | 5/6 | 1 of 1 | 5/0/0 | 0/0/0 | 1/1 | reconciled |
| g2-050 | overcharge | fax, title_line | scanned | 4/6 | 1 of 1 | 6/0/0 | 0/0/1 | 0/1 | needs_review |
| g2-074 | multi_invoice | factoring_remit, fax, landscape, multi_column, reference_numbers, rotated_table, title_line | scanned | 0/18 | 1 of 3 | 0/0/12 | 0/0/0 | 0/3 | failed (groq HTTP 400 json_validate_failed) |

## Beside the official free run (2026-10-27-v2.json)

On the 98 cases both runs read, measured from each report's per-case scores.

| Metric | Free models (official) | This run |
| --- | --- | --- |
| Header field accuracy (digital) | 0.994 | 1.000 |
| Header field accuracy (scanned) | 0.943 | 0.934 |
| Line-item F1 (digital) | 0.995 | 1.000 |
| Line-item F1 (scanned) | 0.950 | 0.968 |
| Arithmetic consistency (after repair) | 0.971 | 0.971 |
| Overcharge precision | 1.000 | 1.000 |
| Overcharge recall | 0.949 | 0.974 |
| Dollar recovery | 0.990 | 0.996 |
| False flag rate | 0.000 | 0.000 |
| Escalation rate | 0.020 | 0.031 |
| Extraction latency p50 (3 pages or fewer) | 2,359 ms | 2,897 ms |
| Extraction latency p95 (3 pages or fewer) | 10,690 ms | 7,133 ms |
| Rate-limit waits (calls that waited for their per-minute limit) | 37 | 32 |
| Rate-limit wait time (total, outside extraction latency) | 2,406,515 ms | 687,402 ms |
| Failed or timed-out calls (429s, timeouts, other errors) | 2 | 1 |
| End-to-end latency p95 (under eval throttling, not normal load) | 176,808 ms | 54,595 ms |
| Input tokens per page (text path) | 803 | 1,596 |
| Output tokens per page (text path) | 609 | 277 |
| Tokens per invoice (digital, in + out) | 1,913 | 2,537 |
| Tokens per invoice (scanned, in + out) | 3,035 | 4,584 |
| Cost per invoice, paid-equivalent (digital) | $0.0007 | $0.0079 |
| Cost per invoice, paid-equivalent (scanned) | $0.0020 | $0.0105 |
| Cost per invoice, as billed (free tiers) | $0.0000 | $0.0090 |
| Expected outcome (status and review reason) | 0.943 | 0.962 |

## Claude against its caps

| Per | Largest in this run | Cap |
| --- | --- | --- |
| Output tokens per call | 560 | 560 |
| Input tokens per call | 6,465 | 7,100, estimated before sending |
| Claude tokens per invoice attempt | 7,041 | 8,500, with the next call reserved |
