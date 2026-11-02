# Extraction eval: dev (2026-11-02)

Golden set v2, 34 of 34 cases (34 run now, the rest from the cache), prompt 4e59f1910cbe, models: anthropic/claude-sonnet-5-5 first at every step, then primary gemini/gemini-3.5-flash-lite, text groq/openai/gpt-oss-120b, fallback groq/qwen/qwen3.8-27b. Took 115 s.

Served: anthropic/claude-sonnet-5-5 97.4% of calls, gemini/gemini-3.5-flash-lite 2.6%.

34 cases give very wide intervals; this subset guards against regressions, it does not measure the targets.

| Metric | Design target | Target | Floor | Floor | Measured | 95% CI | n |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Header field accuracy (digital) | ≥ 0.980 | met | - | - | 1.000 | 1.000 to 1.000 | 17 |
| Header field accuracy (scanned) | ≥ 0.930 | met | - | - | 1.000 | 1.000 to 1.000 | 17 |
| Line-item F1 (digital) | ≥ 0.950 | met | - | - | 1.000 | 1.000 to 1.000 | 17 |
| Line-item F1 (scanned) | ≥ 0.880 | met | - | - | 1.000 | 1.000 to 1.000 | 17 |
| Arithmetic consistency (after repair) | ≥ 0.990 | met | - | - | 1.000 | 1.000 to 1.000 | 34 |
| Overcharge precision | ≥ 0.950 | met | - | - | 1.000 | 1.000 to 1.000 | 34 |
| Overcharge recall | ≥ 0.900 | met | - | - | 1.000 | 1.000 to 1.000 | 34 |
| Dollar recovery | ≥ 0.900 | met | - | - | 1.000 | 1.000 to 1.000 | 34 |
| False flag rate | ≤ 0.030 | met | - | - | 0.000 | 0.000 to 0.000 | 34 |
| Escalation rate | ≤ 0.100 | met | - | - | 0.000 | 0.000 to 0.000 | 34 |
| Extraction latency p50 (3 pages or fewer) | ≤ 5,000 ms | met | - | - | 2,977 ms | 2,817 ms to 3,295 ms | 33 |
| Extraction latency p95 (3 pages or fewer) | ≤ 12,000 ms | met | - | - | 7,166 ms | 4,276 ms to 8,522 ms | 33 |
| Rate-limit waits (calls that waited for their per-minute limit) | - | - | - | - | 8 | 4 to 13 | 34 |
| Rate-limit wait time (total, outside extraction latency) | - | - | - | - | 221,867 ms | 41,697 ms to 450,339 ms | 34 |
| Failed or timed-out calls (429s, timeouts, other errors) | - | - | - | - | 0 | 0 to 0 | 34 |
| End-to-end latency p95 (under eval throttling, not normal load) | ≤ 30,000 ms | missed | - | - | 54,300 ms | 8,111 ms to 74,670 ms | 34 |
| Input tokens per page (text path) | ≤ 4,000 | met | - | - | 1,351 | 1,118 to 1,659 | 17 |
| Output tokens per page (text path) | ≤ 1,200 | met | - | - | 210 | 160 to 274 | 17 |
| Tokens per invoice (digital, in + out) | - | - | - | - | 2,296 | 2,002 to 2,828 | 17 |
| Tokens per invoice (scanned, in + out) | - | - | - | - | 5,100 | 4,117 to 6,338 | 17 |
| Cost per invoice, paid-equivalent (digital) | ≤ $0.0200 | met | - | - | $0.0071 | $0.0060 to $0.0089 | 17 |
| Cost per invoice, paid-equivalent (scanned) | ≤ $0.0500 | met | - | - | $0.0121 | $0.0094 to $0.0155 | 17 |
| Cost per invoice, as billed (free tiers) | - | - | - | - | $0.0095 | $0.0078 to $0.0117 | 34 |
| Expected outcome (status and review reason) | - | - | - | - | 1.000 | 1.000 to 1.000 | 34 |
| Throughput (free-tier ceiling, not a load test) | ≥ 2,000 / h | missed | - | - | 418 / h | computed, no interval | 34 |

Extraction latency counts the calls that returned a reply (first pass, repair, fallback), each from its request to its answer, without the time spent waiting on a provider's rate limit: on free tiers those waits measure the provider plan, not the pipeline, so the rate-limit rows count them, and failed or timed-out calls, apart. End-to-end latency is measured from upload to final status under this run's own throttling and concurrency, not under normal load; throughput is the ceiling the pinned roles' free-tier per-minute limits allow at the measured calls and tokens per invoice, not a load test. The k6 load test measures both (README, Load test).

## Model use

| Model | Served as | Calls | Share of calls | Failed | Input tokens | Output tokens |
| --- | --- | --- | --- | --- | --- | --- |
| anthropic/claude-sonnet-5-5 | claude-sonnet-5-5 | 38 | 97.4% | 0 | 107,635 | 10,770 |
| gemini/gemini-3.5-flash-lite | gemini-3.5-flash-lite | 1 | 2.6% | 0 | 6,920 | 395 |

## Failed calls

None.

## By kind and trait

Each row counts the cases of one kind, or with one trait (what makes a case hard); a case has one kind and any number of traits.

| By | Name | Cases | Header fields | Carrier | Invoices read right | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| kind | clean | 8 | 48/48 | 8/8 | 8/8 | 8/8 |
| kind | overcharge | 5 | 30/30 | 5/5 | 5/5 | 5/5 |
| kind | duplicate_invoice | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
| kind | repeated_page | 6 | 36/36 | 6/6 | 6/6 | 6/6 |
| kind | multi_invoice | 2 | 24/24 | 4/4 | 2/2 | 4/4 |
| kind | packet | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
| kind | partial_credit | 1 | 6/6 | 1/1 | 1/1 | 1/1 |
| kind | credit_memo | 1 | 6/6 | 1/1 | 1/1 | 1/1 |
| kind | revised_invoice | 1 | 6/6 | 1/1 | 1/1 | 1/1 |
| kind | tricky_number | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
| kind | handwritten | 1 | 6/6 | 1/1 | 1/1 | 1/1 |
| kind | upside_down | 1 | 6/6 | 1/1 | 1/1 | 1/1 |
| kind | missing_pro | 1 | 6/6 | 1/1 | 1/1 | 1/1 |
| kind | non_usd | 1 | 6/6 | 1/1 | 1/1 | 1/1 |
| trait | carrier_wording | 7 | 48/48 | 8/8 | 7/7 | 8/8 |
| trait | continued_page | 6 | 36/36 | 6/6 | 6/6 | 6/6 |
| trait | copy_label | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
| trait | early_pay_discount | 7 | 48/48 | 8/8 | 7/7 | 8/8 |
| trait | factoring_remit | 6 | 36/36 | 6/6 | 6/6 | 6/6 |
| trait | fax | 3 | 18/18 | 3/3 | 3/3 | 3/3 |
| trait | invoice_not_first | 1 | 6/6 | 1/1 | 1/1 | 1/1 |
| trait | landscape | 8 | 54/54 | 9/9 | 8/8 | 9/9 |
| trait | low_contrast | 4 | 24/24 | 4/4 | 4/4 | 4/4 |
| trait | low_res | 4 | 30/30 | 5/5 | 4/4 | 5/5 |
| trait | multi_column | 6 | 36/36 | 6/6 | 6/6 | 6/6 |
| trait | reference_numbers | 14 | 90/90 | 15/15 | 14/14 | 15/15 |
| trait | rotated_table | 2 | 12/12 | 2/2 | 2/2 | 2/2 |
| trait | skew | 3 | 18/18 | 3/3 | 3/3 | 3/3 |
| trait | stamp | 7 | 48/48 | 8/8 | 7/7 | 8/8 |
| trait | subtotal_tax | 6 | 36/36 | 6/6 | 6/6 | 6/6 |
| trait | title_line | 29 | 186/186 | 31/31 | 29/29 | 31/31 |

## Cases with any miss

| Case | Kind | Traits | Path | Header fields | Invoices read | Lines tp/fp/fn | Findings tp/fp/fn | Outcome | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

## Beside the official free run (2026-10-27-v2.json)

On the 34 cases both runs read, measured from each report's per-case scores.

| Metric | Free models (official) | This run |
| --- | --- | --- |
| Header field accuracy (digital) | 1.000 | 1.000 |
| Header field accuracy (scanned) | 0.991 | 1.000 |
| Line-item F1 (digital) | 1.000 | 1.000 |
| Line-item F1 (scanned) | 1.000 | 1.000 |
| Arithmetic consistency (after repair) | 1.000 | 1.000 |
| Overcharge precision | 1.000 | 1.000 |
| Overcharge recall | 0.929 | 1.000 |
| Dollar recovery | 0.987 | 1.000 |
| False flag rate | 0.000 | 0.000 |
| Escalation rate | 0.000 | 0.000 |
| Extraction latency p50 (3 pages or fewer) | 1,935 ms | 2,977 ms |
| Extraction latency p95 (3 pages or fewer) | 4,455 ms | 7,166 ms |
| Rate-limit waits (calls that waited for their per-minute limit) | 10 | 8 |
| Rate-limit wait time (total, outside extraction latency) | 789,464 ms | 221,867 ms |
| Failed or timed-out calls (429s, timeouts, other errors) | 0 | 0 |
| End-to-end latency p95 (under eval throttling, not normal load) | 133,886 ms | 54,300 ms |
| Input tokens per page (text path) | 724 | 1,351 |
| Output tokens per page (text path) | 523 | 210 |
| Tokens per invoice (digital, in + out) | 1,835 | 2,296 |
| Tokens per invoice (scanned, in + out) | 2,866 | 5,100 |
| Cost per invoice, paid-equivalent (digital) | $0.0006 | $0.0071 |
| Cost per invoice, paid-equivalent (scanned) | $0.0017 | $0.0121 |
| Cost per invoice, as billed (free tiers) | $0.0000 | $0.0095 |
| Expected outcome (status and review reason) | 0.972 | 1.000 |

## Claude against its caps

| Per | Largest in this run | Cap |
| --- | --- | --- |
| Output tokens per call | 549 | 560 |
| Input tokens per call | 6,465 | 7,100, estimated before sending |
| Claude tokens per invoice attempt | 7,041 | 8,500, with the next call reserved |
