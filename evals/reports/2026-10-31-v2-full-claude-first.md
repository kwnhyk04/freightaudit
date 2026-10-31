# Extraction eval: full (2026-10-31)

Golden set v2, 98 of 98 cases (0 run now, the rest from the cache), prompt 4e59f1910cbe, models: anthropic/claude-haiku-5-5 first at every step, then primary gemini/gemini-3.5-flash-lite, text groq/openai/gpt-oss-120b, fallback groq/qwen/qwen3.8-27b. Took 0 s.

Served: anthropic/claude-haiku-5-5 89.3% of calls, groq/qwen/qwen3.8-27b 5.7%, gemini/gemini-3.5-flash-lite 4.9%.

98 cases give wide intervals: read each measurement with its 95% interval.

| Metric | Design target | Target | Floor | Floor | Measured | 95% CI | n |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Header field accuracy (digital) | ≥ 0.980 | met | - | - | 1.000 | 1.000 to 1.000 | 48 |
| Header field accuracy (scanned) | ≥ 0.930 | missed | - | - | 0.928 | 0.848 to 0.987 | 50 |
| Line-item F1 (digital) | ≥ 0.950 | met | - | - | 1.000 | 1.000 to 1.000 | 48 |
| Line-item F1 (scanned) | ≥ 0.880 | met | - | - | 0.930 | 0.844 to 0.995 | 50 |
| Arithmetic consistency (after repair) | ≥ 0.990 | missed | - | - | 0.952 | 0.905 to 0.991 | 98 |
| Overcharge precision | ≥ 0.950 | met | - | - | 1.000 | 1.000 to 1.000 | 98 |
| Overcharge recall | ≥ 0.900 | met | - | - | 0.974 | 0.906 to 1.000 | 98 |
| Dollar recovery | ≥ 0.900 | met | - | - | 0.996 | 0.978 to 1.000 | 98 |
| False flag rate | ≤ 0.030 | met | - | - | 0.000 | 0.000 to 0.000 | 98 |
| Escalation rate | ≤ 0.100 | met | - | - | 0.061 | 0.020 to 0.112 | 98 |
| Extraction latency p50 (3 pages or fewer) | ≤ 5,000 ms | met | - | - | 1,743 ms | 1,671 ms to 1,803 ms | 94 |
| Extraction latency p95 (3 pages or fewer) | ≤ 12,000 ms | met | - | - | 5,742 ms | 3,251 ms to 8,019 ms | 94 |
| Rate-limit waits (calls that waited for their per-minute limit) | - | - | - | - | 58 | 46 to 71 | 98 |
| Rate-limit wait time (total, outside extraction latency) | - | - | - | - | 1,129,354 ms | 558,874 ms to 1,802,973 ms | 98 |
| Failed or timed-out calls (429s, timeouts, other errors) | - | - | - | - | 1 | 0 to 3 | 98 |
| End-to-end latency p95 (under eval throttling, not normal load) | ≤ 30,000 ms | missed | - | - | 86,708 ms | 37,518 ms to 124,503 ms | 98 |
| Input tokens per page (text path) | ≤ 4,000 | met | - | - | 1,596 | 1,350 to 1,895 | 48 |
| Output tokens per page (text path) | ≤ 1,200 | met | - | - | 277 | 211 to 361 | 48 |
| Tokens per invoice (digital, in + out) | - | - | - | - | 2,537 | 1,996 to 3,242 | 48 |
| Tokens per invoice (scanned, in + out) | - | - | - | - | 5,274 | 4,306 to 6,592 | 50 |
| Cost per invoice, paid-equivalent (digital) | ≤ $0.0200 | met | - | - | $0.0005 | $0.0003 to $0.0008 | 48 |
| Cost per invoice, paid-equivalent (scanned) | ≤ $0.0500 | met | - | - | $0.0012 | $0.0007 to $0.0020 | 50 |
| Cost per invoice, as billed (free tiers) | - | - | - | - | $0.0005 | $0.0004 to $0.0005 | 98 |
| Expected outcome (status and review reason) | - | - | - | - | 0.924 | 0.852 to 0.981 | 98 |
| Throughput (free-tier ceiling, not a load test) | ≥ 2,000 / h | missed | - | - | 386 / h | computed, no interval | 98 |

Extraction latency counts the calls that returned a reply (first pass, repair, fallback), each from its request to its answer, without the time spent waiting on a provider's rate limit: on free tiers those waits measure the provider plan, not the pipeline, so the rate-limit rows count them, and failed or timed-out calls, apart. End-to-end latency is measured from upload to final status under this run's own throttling and concurrency, not under normal load; throughput is the ceiling the pinned roles' free-tier per-minute limits allow at the measured calls and tokens per invoice, not a load test. The k6 load test measures both (README, Load test).

## Model use

| Model | Served as | Calls | Share of calls | Failed | Input tokens | Output tokens |
| --- | --- | --- | --- | --- | --- | --- |
| anthropic/claude-haiku-5-5 | claude-haiku-5-5 | 109 | 89.3% | 0 | 299,247 | 31,727 |
| groq/qwen/qwen3.8-27b | qwen/qwen3.8-27b | 7 | 5.7% | 1 | 15,776 | 2,845 |
| gemini/gemini-3.5-flash-lite | gemini-3.5-flash-lite | 6 | 4.9% | 0 | 32,748 | 3,125 |

## Failed calls

| Case | Provider | Model | Class | HTTP | Error |
| --- | --- | --- | --- | --- | --- |
| g2-074 | groq | qwen/qwen3.8-27b | 429 | 429 | groq HTTP 429 rate_limit_exceeded |

## By kind and trait

Each row counts the cases of one kind, or with one trait (what makes a case hard); a case has one kind and any number of traits.

| By | Name | Cases | Header fields | Carrier | Invoices read right | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| kind | clean | 32 | 190/192 | 32/32 | 32/32 | 31/32 |
| kind | overcharge | 20 | 116/120 | 19/20 | 20/20 | 19/20 |
| kind | duplicate_invoice | 5 | 30/30 | 5/5 | 5/5 | 5/5 |
| kind | repeated_page | 12 | 70/72 | 12/12 | 12/12 | 11/12 |
| kind | multi_invoice | 5 | 60/72 | 10/12 | 4/5 | 9/12 |
| kind | packet | 4 | 24/24 | 4/4 | 4/4 | 4/4 |
| kind | partial_credit | 3 | 18/18 | 3/3 | 3/3 | 3/3 |
| kind | credit_memo | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
| kind | revised_invoice | 3 | 18/18 | 3/3 | 3/3 | 3/3 |
| kind | tricky_number | 4 | 24/24 | 4/4 | 4/4 | 4/4 |
| kind | handwritten | 2 | 12/12 | 2/2 | 2/2 | 1/2 |
| kind | upside_down | 2 | 9/12 | 2/2 | 2/2 | 1/2 |
| kind | missing_pro | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
| kind | non_usd | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
| trait | carrier_wording | 16 | 108/108 | 18/18 | 16/16 | 18/18 |
| trait | continued_page | 14 | 96/96 | 16/16 | 14/14 | 15/16 |
| trait | copy_label | 4 | 24/24 | 4/4 | 4/4 | 4/4 |
| trait | early_pay_discount | 16 | 108/108 | 18/18 | 16/16 | 18/18 |
| trait | factoring_remit | 16 | 108/120 | 18/20 | 15/16 | 17/20 |
| trait | fax | 10 | 53/72 | 9/12 | 9/10 | 6/12 |
| trait | invoice_not_first | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
| trait | landscape | 16 | 107/120 | 18/20 | 15/16 | 17/20 |
| trait | low_contrast | 10 | 59/60 | 10/10 | 10/10 | 10/10 |
| trait | low_res | 10 | 63/66 | 11/11 | 10/10 | 10/11 |
| trait | multi_column | 16 | 108/120 | 18/20 | 15/16 | 17/20 |
| trait | reference_numbers | 30 | 203/216 | 34/36 | 29/30 | 32/36 |
| trait | rotated_table | 5 | 29/42 | 5/7 | 4/5 | 4/7 |
| trait | skew | 10 | 60/60 | 10/10 | 10/10 | 9/10 |
| trait | stamp | 22 | 138/138 | 23/23 | 22/22 | 23/23 |
| trait | subtotal_tax | 14 | 96/96 | 16/16 | 14/14 | 15/16 |
| trait | title_line | 78 | 490/510 | 82/85 | 77/78 | 78/85 |

## Cases with any miss

| Case | Kind | Traits | Path | Header fields | Invoices read | Lines tp/fp/fn | Findings tp/fp/fn | Outcome | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| g2-020 | clean | fax, title_line | scanned | 5/6 | 1 of 1 | 3/1/1 | 0/0/0 | 0/1 | needs_review |
| g2-024 | clean | landscape, low_res, reference_numbers, rotated_table, title_line | scanned | 5/6 | 1 of 1 | 5/0/0 | 0/0/0 | 1/1 | reconciled |
| g2-050 | overcharge | fax, title_line | scanned | 2/6 | 1 of 1 | 0/6/6 | 0/0/1 | 0/1 | needs_review |
| g2-066 | repeated_page | fax | scanned | 4/6 | 1 of 1 | 4/0/0 | 0/0/0 | 0/1 | needs_review |
| g2-074 | multi_invoice | factoring_remit, fax, landscape, multi_column, reference_numbers, rotated_table, title_line | scanned | 6/18 | 1 of 3 | 3/0/9 | 0/0/0 | 0/3 | needs_review |
| g2-092 | handwritten | continued_page, reference_numbers, skew, subtotal_tax, title_line | scanned | 6/6 | 1 of 1 | 2/2/2 | 0/0/0 | 0/1 | needs_review |
| g2-093 | upside_down | low_contrast | scanned | 5/6 | 1 of 1 | 4/0/0 | 0/0/0 | 1/1 | reconciled |
| g2-094 | upside_down | low_res, title_line | scanned | 4/6 | 1 of 1 | 3/0/0 | 0/0/0 | 0/1 | needs_review |

## Beside the official free run (2026-10-27-v2.json)

On the 98 cases both runs read, measured from each report's per-case scores.

| Metric | Free models (official) | This run |
| --- | --- | --- |
| Header field accuracy (digital) | 0.994 | 1.000 |
| Header field accuracy (scanned) | 0.943 | 0.928 |
| Line-item F1 (digital) | 0.995 | 1.000 |
| Line-item F1 (scanned) | 0.950 | 0.930 |
| Arithmetic consistency (after repair) | 0.971 | 0.952 |
| Overcharge precision | 1.000 | 1.000 |
| Overcharge recall | 0.949 | 0.974 |
| Dollar recovery | 0.990 | 0.996 |
| False flag rate | 0.000 | 0.000 |
| Escalation rate | 0.020 | 0.061 |
| Extraction latency p50 (3 pages or fewer) | 2,359 ms | 1,743 ms |
| Extraction latency p95 (3 pages or fewer) | 10,690 ms | 5,742 ms |
| Rate-limit waits (calls that waited for their per-minute limit) | 37 | 58 |
| Rate-limit wait time (total, outside extraction latency) | 2,406,515 ms | 1,129,354 ms |
| Failed or timed-out calls (429s, timeouts, other errors) | 2 | 1 |
| End-to-end latency p95 (under eval throttling, not normal load) | 176,808 ms | 86,708 ms |
| Input tokens per page (text path) | 803 | 1,596 |
| Output tokens per page (text path) | 609 | 277 |
| Tokens per invoice (digital, in + out) | 1,913 | 2,537 |
| Tokens per invoice (scanned, in + out) | 3,035 | 5,274 |
| Cost per invoice, paid-equivalent (digital) | $0.0007 | $0.0005 |
| Cost per invoice, paid-equivalent (scanned) | $0.0020 | $0.0012 |
| Cost per invoice, as billed (free tiers) | $0.0000 | $0.0005 |
| Expected outcome (status and review reason) | 0.943 | 0.924 |

## Claude against its caps

| Per | Largest in this run | Cap |
| --- | --- | --- |
| Output tokens per call | 560 | 560 |
| Input tokens per call | 6,465 | 7,100, estimated before sending |
| Claude tokens per invoice attempt | 7,377 | 8,500, with the next call reserved |
