# Extraction eval: test (2026-10-27)

Golden set v2, 64 of 64 cases (0 run now, the rest from the cache), prompt 4e59f1910cbe, models: primary gemini/gemini-3.5-flash-lite, text groq/openai/gpt-oss-120b, fallback groq/qwen/qwen3.8-27b. Took 0 s.

64 cases give very wide intervals; this subset guards against regressions, it does not measure the targets.

| Metric | Design target | Target | Floor | Floor | Measured | 95% CI | n |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Header field accuracy (digital) | ≥ 0.980 | met | - | - | 1.000 | 1.000 to 1.000 | 31 |
| Header field accuracy (scanned) | ≥ 0.930 | missed | - | - | 0.900 | 0.788 to 0.985 | 33 |
| Line-item F1 (digital) | ≥ 0.950 | met | - | - | 1.000 | 1.000 to 1.000 | 31 |
| Line-item F1 (scanned) | ≥ 0.880 | met | - | - | 0.897 | 0.776 to 1.000 | 33 |
| Arithmetic consistency (after repair) | ≥ 0.990 | missed | - | - | 0.942 | 0.873 to 1.000 | 64 |
| Overcharge precision | ≥ 0.950 | met | - | - | 1.000 | 1.000 to 1.000 | 64 |
| Overcharge recall | ≥ 0.900 | met | - | - | 0.960 | 0.850 to 1.000 | 64 |
| Dollar recovery | ≥ 0.900 | met | - | - | 0.993 | 0.938 to 1.000 | 64 |
| False flag rate | ≤ 0.030 | met | - | - | 0.000 | 0.000 to 0.000 | 64 |
| Escalation rate | ≤ 0.100 | met | - | - | 0.094 | 0.031 to 0.172 | 64 |
| Extraction latency p50 (3 pages or fewer) | ≤ 5,000 ms | met | - | - | 2,271 ms | 2,151 ms to 2,409 ms | 61 |
| Extraction latency p95 (3 pages or fewer) | ≤ 12,000 ms | met | - | - | 5,980 ms | 3,701 ms to 8,420 ms | 61 |
| Rate-limit waits (calls that waited for their per-minute limit) | - | - | - | - | 29 | 20 to 39 | 64 |
| Rate-limit wait time (total, outside extraction latency) | - | - | - | - | 595,244 ms | 261,883 ms to 994,851 ms | 64 |
| Failed or timed-out calls (429s, timeouts, other errors) | - | - | - | - | 0 | 0 to 0 | 64 |
| End-to-end latency p95 (under eval throttling, not normal load) | ≤ 30,000 ms | missed | - | - | 61,587 ms | 18,290 ms to 111,808 ms | 64 |
| Input tokens per page (text path) | ≤ 4,000 | met | - | - | 1,749 | 1,404 to 2,150 | 31 |
| Output tokens per page (text path) | ≤ 1,200 | met | - | - | 319 | 221 to 438 | 31 |
| Tokens per invoice (digital, in + out) | - | - | - | - | 2,668 | 1,956 to 3,769 | 31 |
| Tokens per invoice (scanned, in + out) | - | - | - | - | 4,877 | 4,042 to 5,794 | 33 |
| Cost per invoice, paid-equivalent (digital) | ≤ $0.0200 | met | - | - | $0.0006 | $0.0003 to $0.0011 | 31 |
| Cost per invoice, paid-equivalent (scanned) | ≤ $0.0500 | met | - | - | $0.0012 | $0.0007 to $0.0019 | 33 |
| Cost per invoice, as billed (free tiers) | - | - | - | - | $0.0005 | $0.0004 to $0.0005 | 64 |
| Expected outcome (status and review reason) | - | - | - | - | 0.899 | 0.803 to 0.985 | 64 |
| Throughput (free-tier ceiling, not a load test) | ≥ 2,000 / h | missed | - | - | 371 / h | computed, no interval | 64 |

Extraction latency counts the calls that returned a reply (first pass, repair, fallback), each from its request to its answer, without the time spent waiting on a provider's rate limit: on free tiers those waits measure the provider plan, not the pipeline, so the rate-limit rows count them, and failed or timed-out calls, apart. End-to-end latency is measured from upload to final status under this run's own throttling and concurrency, not under normal load; throughput is the ceiling the pinned roles' free-tier per-minute limits allow at the measured calls and tokens per invoice, not a load test. The k6 load test measures both (README, Load test).

## Model use

| Model | Served as | Calls | Input tokens | Output tokens |
| --- | --- | --- | --- | --- |
| anthropic/claude-haiku-5-5 | claude-haiku-5-5 | 71 | 188,619 | 20,697 |
| groq/qwen/qwen3.8-27b | qwen/qwen3.8-27b | 6 | 15,776 | 2,882 |
| gemini/gemini-3.5-flash-lite | gemini-3.5-flash-lite | 2 | 14,946 | 746 |

## Failed calls

None.

## By kind and trait

Each row counts the cases of one kind, or with one trait (what makes a case hard); a case has one kind and any number of traits.

| By | Name | Cases | Header fields | Carrier | Invoices read right | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| kind | clean | 24 | 142/144 | 24/24 | 24/24 | 23/24 |
| kind | overcharge | 15 | 86/90 | 14/15 | 15/15 | 14/15 |
| kind | duplicate_invoice | 3 | 18/18 | 3/3 | 3/3 | 3/3 |
| kind | repeated_page | 6 | 35/36 | 6/6 | 6/6 | 6/6 |
| kind | multi_invoice | 3 | 36/48 | 6/8 | 2/3 | 5/8 |
| kind | packet | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
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
| trait | fax | 7 | 37/54 | 6/9 | 6/7 | 5/9 |
| trait | invoice_not_first | 1 | 6/6 | 1/1 | 1/1 | 1/1 |
| trait | landscape | 8 | 52/66 | 9/11 | 7/8 | 7/11 |
| trait | low_contrast | 6 | 36/36 | 6/6 | 6/6 | 6/6 |
| trait | low_res | 6 | 32/36 | 6/6 | 6/6 | 4/6 |
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
| g2-066 | repeated_page | fax | scanned | 5/6 | 1 of 1 | 4/0/0 | 0/0/0 | 1/1 | reconciled |
| g2-074 | multi_invoice | factoring_remit, fax, landscape, multi_column, reference_numbers, rotated_table, title_line | scanned | 6/18 | 1 of 3 | 3/0/9 | 0/0/0 | 0/3 | needs_review |
| g2-092 | handwritten | continued_page, reference_numbers, skew, subtotal_tax, title_line | scanned | 6/6 | 1 of 1 | 2/2/2 | 0/0/0 | 0/1 | needs_review |
| g2-094 | upside_down | low_res, title_line | scanned | 4/6 | 1 of 1 | 3/0/0 | 0/0/0 | 0/1 | needs_review |

## Beside the official free run (2026-10-27-v2.json)

On the 64 cases both runs read, measured from each report's per-case scores.

| Metric | Free models (official) | This run |
| --- | --- | --- |
| Header field accuracy (digital) | 0.990 | 1.000 |
| Header field accuracy (scanned) | 0.919 | 0.900 |
| Line-item F1 (digital) | 0.992 | 1.000 |
| Line-item F1 (scanned) | 0.922 | 0.897 |
| Arithmetic consistency (after repair) | 0.957 | 0.942 |
| Overcharge precision | 1.000 | 1.000 |
| Overcharge recall | 0.960 | 0.960 |
| Dollar recovery | 0.993 | 0.993 |
| False flag rate | 0.000 | 0.000 |
| Escalation rate | 0.031 | 0.094 |
| Extraction latency p50 (3 pages or fewer) | 2,751 ms | 2,271 ms |
| Extraction latency p95 (3 pages or fewer) | 13,677 ms | 5,980 ms |
| Rate-limit waits (calls that waited for their per-minute limit) | 27 | 29 |
| Rate-limit wait time (total, outside extraction latency) | 1,617,051 ms | 595,244 ms |
| Failed or timed-out calls (429s, timeouts, other errors) | 2 | 0 |
| End-to-end latency p95 (under eval throttling, not normal load) | 173,336 ms | 61,587 ms |
| Input tokens per page (text path) | 852 | 1,749 |
| Output tokens per page (text path) | 663 | 319 |
| Tokens per invoice (digital, in + out) | 1,955 | 2,668 |
| Tokens per invoice (scanned, in + out) | 3,121 | 4,877 |
| Cost per invoice, paid-equivalent (digital) | $0.0007 | $0.0006 |
| Cost per invoice, paid-equivalent (scanned) | $0.0021 | $0.0012 |
| Cost per invoice, as billed (free tiers) | $0.0000 | $0.0005 |
| Expected outcome (status and review reason) | 0.928 | 0.899 |

## Claude against its caps

| Per | Largest in this run | Cap |
| --- | --- | --- |
| Output tokens per call | 560 | 560 |
| Input tokens per call | 6,465 | 7,100, estimated before sending |
| Claude tokens per invoice | 7,378 | 8,500, with the next call reserved |
