# Extraction eval: test (2026-10-25)

Golden set v2, 64 of 64 cases (64 run now, the rest from the cache), prompt 19f0c19627c4, models: primary gemini/gemini-3.5-flash-lite, text groq/openai/gpt-oss-120b, fallback groq/qwen/qwen3.8-27b. Took 401 s.

64 cases give very wide intervals; this subset guards against regressions, it does not measure the targets.

| Metric | Design target | Target | Floor | Floor | Measured | 95% CI | n |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Header field accuracy (digital) | ≥ 0.980 | met | - | - | 1.000 | 1.000 to 1.000 | 31 |
| Header field accuracy (scanned) | ≥ 0.930 | missed | - | - | 0.895 | 0.786 to 0.980 | 33 |
| Line-item F1 (digital) | ≥ 0.950 | met | - | - | 1.000 | 1.000 to 1.000 | 31 |
| Line-item F1 (scanned) | ≥ 0.880 | met | - | - | 0.897 | 0.776 to 1.000 | 33 |
| Arithmetic consistency (after repair) | ≥ 0.990 | missed | - | - | 0.942 | 0.873 to 1.000 | 64 |
| Overcharge precision | ≥ 0.950 | met | - | - | 1.000 | 1.000 to 1.000 | 64 |
| Overcharge recall | ≥ 0.900 | met | - | - | 0.960 | 0.850 to 1.000 | 64 |
| Dollar recovery | ≥ 0.900 | met | - | - | 0.993 | 0.938 to 1.000 | 64 |
| False flag rate | ≤ 0.030 | met | - | - | 0.000 | 0.000 to 0.000 | 64 |
| Escalation rate | ≤ 0.100 | missed | - | - | 0.125 | 0.047 to 0.219 | 64 |
| Extraction latency p50 (3 pages or fewer) | ≤ 5,000 ms | met | - | - | 2,106 ms | 1,957 ms to 2,301 ms | 61 |
| Extraction latency p95 (3 pages or fewer) | ≤ 12,000 ms | met | - | - | 6,204 ms | 3,852 ms to 9,027 ms | 61 |
| Rate-limit waits (calls that waited for their per-minute limit) | - | - | - | - | 22 | 14 to 31 | 64 |
| Rate-limit wait time (total, outside extraction latency) | - | - | - | - | 999,667 ms | 394,476 ms to 1,799,853 ms | 64 |
| Failed or timed-out calls (429s, timeouts, other errors) | - | - | - | - | 1 | 0 to 3 | 64 |
| End-to-end latency p95 (under eval throttling, not normal load) | ≤ 30,000 ms | missed | - | - | 81,877 ms | 29,449 ms to 186,024 ms | 64 |
| Input tokens per page (text path) | ≤ 4,000 | met | - | - | 1,659 | 1,329 to 2,041 | 31 |
| Output tokens per page (text path) | ≤ 1,200 | met | - | - | 319 | 222 to 438 | 31 |
| Tokens per invoice (digital, in + out) | - | - | - | - | 2,552 | 1,864 to 3,613 | 31 |
| Tokens per invoice (scanned, in + out) | - | - | - | - | 5,599 | 4,226 to 7,170 | 33 |
| Cost per invoice, paid-equivalent (digital) | ≤ $0.0200 | met | - | - | $0.0006 | $0.0003 to $0.0011 | 31 |
| Cost per invoice, paid-equivalent (scanned) | ≤ $0.0500 | met | - | - | $0.0017 | $0.0009 to $0.0025 | 33 |
| Cost per invoice, as billed (free tiers) | - | - | - | - | $0.0005 | $0.0004 to $0.0006 | 64 |
| Expected outcome (status and review reason) | - | - | - | - | 0.870 | 0.771 to 0.955 | 64 |
| Throughput (free-tier ceiling, not a load test) | ≥ 2,000 / h | missed | - | - | 388 / h | computed, no interval | 64 |

Extraction latency counts the calls that returned a reply (first pass, repair, fallback), each from its request to its answer, without the time spent waiting on a provider's rate limit: on free tiers those waits measure the provider plan, not the pipeline, so the rate-limit rows count them, and failed or timed-out calls, apart. End-to-end latency is measured from upload to final status under this run's own throttling and concurrency, not under normal load; throughput is the ceiling the pinned roles' free-tier per-minute limits allow at the measured calls and tokens per invoice, not a load test. The k6 load test measures both (README, Load test).

## Model use

| Model | Served as | Calls | Input tokens | Output tokens |
| --- | --- | --- | --- | --- |
| anthropic/claude-haiku-5-5 | claude-haiku-5-5 | 72 | 188,462 | 21,709 |
| groq/qwen/qwen3.8-27b | qwen/qwen3.8-27b | 9 | 24,818 | 3,433 |
| gemini/gemini-3.5-flash-lite | gemini-3.5-flash-lite | 3 | 24,322 | 1,140 |

## Failed calls

| Case | Provider | Model | Class | HTTP | Error |
| --- | --- | --- | --- | --- | --- |
| g2-067 | groq | qwen/qwen3.8-27b | 429 | 429 | groq HTTP 429 rate_limit_exceeded TPM |

## By kind and trait

Each row counts the cases of one kind, or with one trait (what makes a case hard); a case has one kind and any number of traits.

| By | Name | Cases | Header fields | Carrier | Invoices read right | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| kind | clean | 24 | 142/144 | 24/24 | 24/24 | 23/24 |
| kind | overcharge | 15 | 86/90 | 14/15 | 15/15 | 14/15 |
| kind | duplicate_invoice | 3 | 18/18 | 3/3 | 3/3 | 3/3 |
| kind | repeated_page | 6 | 34/36 | 6/6 | 6/6 | 5/6 |
| kind | multi_invoice | 3 | 36/48 | 6/8 | 2/3 | 5/8 |
| kind | packet | 2 | 12/12 | 2/2 | 2/2 | 1/2 |
| kind | partial_credit | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
| kind | credit_memo | 1 | 6/6 | 1/1 | 1/1 | 1/1 |
| kind | revised_invoice | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
| kind | tricky_number | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
| kind | handwritten | 1 | 6/6 | 1/1 | 1/1 | 0/1 |
| kind | upside_down | 1 | 4/6 | 1/1 | 1/1 | 0/1 |
| kind | missing_pro | 1 | 6/6 | 1/1 | 1/1 | 1/1 |
| kind | non_usd | 1 | 6/6 | 1/1 | 1/1 | 1/1 |
| trait | carrier_wording | 9 | 60/60 | 10/10 | 9/9 | 10/10 |
| trait | continued_page | 8 | 60/60 | 10/10 | 8/8 | 9/10 |
| trait | copy_label | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
| trait | early_pay_discount | 9 | 60/60 | 10/10 | 9/9 | 10/10 |
| trait | factoring_remit | 10 | 72/84 | 12/14 | 9/10 | 11/14 |
| trait | fax | 7 | 36/54 | 6/9 | 6/7 | 4/9 |
| trait | invoice_not_first | 1 | 6/6 | 1/1 | 1/1 | 0/1 |
| trait | landscape | 8 | 52/66 | 9/11 | 7/8 | 7/11 |
| trait | low_contrast | 6 | 36/36 | 6/6 | 6/6 | 6/6 |
| trait | low_res | 6 | 32/36 | 6/6 | 6/6 | 3/6 |
| trait | multi_column | 10 | 72/84 | 12/14 | 9/10 | 11/14 |
| trait | reference_numbers | 16 | 112/126 | 19/21 | 15/16 | 16/21 |
| trait | rotated_table | 3 | 16/30 | 3/5 | 2/3 | 1/5 |
| trait | skew | 7 | 42/42 | 7/7 | 7/7 | 6/7 |
| trait | stamp | 15 | 90/90 | 15/15 | 15/15 | 15/15 |
| trait | subtotal_tax | 8 | 60/60 | 10/10 | 8/8 | 9/10 |
| trait | title_line | 49 | 304/324 | 51/54 | 48/49 | 47/54 |

## Cases with any miss

| Case | Kind | Traits | Path | Header fields | Invoices read | Lines tp/fp/fn | Findings tp/fp/fn | Outcome | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| g2-024 | clean | landscape, low_res, reference_numbers, rotated_table, title_line | scanned | 4/6 | 1 of 1 | 5/0/0 | 0/0/0 | 0/1 | needs_review |
| g2-050 | overcharge | fax, title_line | scanned | 2/6 | 1 of 1 | 0/6/6 | 0/0/1 | 0/1 | needs_review |
| g2-066 | repeated_page | fax | scanned | 4/6 | 1 of 1 | 4/0/0 | 0/0/0 | 0/1 | needs_review |
| g2-074 | multi_invoice | factoring_remit, fax, landscape, multi_column, reference_numbers, rotated_table, title_line | scanned | 6/18 | 1 of 3 | 3/0/9 | 0/0/0 | 0/3 | needs_review |
| g2-078 | packet | invoice_not_first, low_res | scanned | 6/6 | 1 of 1 | 5/0/0 | 0/0/0 | 0/1 | needs_review |
| g2-092 | handwritten | continued_page, reference_numbers, skew, subtotal_tax, title_line | scanned | 6/6 | 1 of 1 | 2/2/2 | 0/0/0 | 0/1 | needs_review |
| g2-094 | upside_down | low_res, title_line | scanned | 4/6 | 1 of 1 | 3/0/0 | 0/0/0 | 0/1 | needs_review |

## Beside the official free run (none found)


## Claude against its caps

| Per | Largest in this run | Cap |
| --- | --- | --- |
| Output tokens per call | 560 | 560 |
| Input tokens per call | 6,373 | 7,100, estimated before sending |
| Claude tokens per invoice | 7,193 | 8,500, with the next call reserved |
