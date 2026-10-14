# Migrations

Schema changes are plain SQL files in `packages/db/migrations`, applied in name order by `packages/db/src/migrate.ts` (`pnpm db:migrate`). `packages/db/src/schema.ts` is the Drizzle mirror of the latest state, used for queries. The SQL owns every constraint and index, and `pnpm test:int` checks that the two agree on tables, columns, types and nullability.

## How the runner works

- Applied files are recorded by name in `schema_migrations`. Never edit an applied file; fix forward with a new one.
- A session advisory lock lets only one runner work at a time. A second deploy waits for the first.
- `lock_timeout` is `5s`. A DDL statement that waits behind a long transaction would queue every later query on the table behind itself; failing fast avoids that outage. On a timeout, run the migration again.
- Each file runs in one transaction, except files whose first line is `-- migrate:no-transaction`. Those run statement by statement (split on `--> statement-breakpoint`), and each statement commits on its own. A failure leaves the earlier statements committed, and the file is recorded only after its last statement, so every statement in such a file must be safe to run again.
- `--to=<prefix>` stops after the files whose names start with the prefix, for example `pnpm db:migrate --to=0002`.

## Rules

Expand, migrate, contract. Each migration must work with the code that is running when it is applied.

1. Expand: additive changes only, such as new tables, nullable columns and `NOT VALID` constraints.
2. Migrate: deploy code that writes the new shape, then backfill old rows in batches, outside the migrations.
3. Contract: enforce the new shape (`NOT NULL`, validated constraints, indexes), then, in a later release, drop what nothing reads any more.

## 0001 initial

- Tables: tenants, carriers, rate_cards, shipments, invoices, invoice_lines, discrepancies, idempotency_keys, dead_letters, tms_sync_state. Every table has `created_at` and `updated_at`; every table except `tenants` has `tenant_id` (a tenant's own `id` is its tenant id).
- `rate_cards` holds one flat rate per carrier and charge code, with no dates. This is deliberate: a rate change overwrites history, so re-auditing an older invoice uses the wrong rate. 0002 to 0004 fix this.
- Primary keys default to Postgres 18 `uuidv7()`. Time-ordered keys keep btree inserts local and break ties in keyset order.
- A `set_updated_at` trigger on every table keeps `updated_at` current, including for raw SQL such as the backfill.
- Money columns are `bigint` cents. `invoices` is unique on `(tenant_id, content_sha256)` and `shipments` on `(tenant_id, carrier_id, pro_number)`. The `invoice_status` enum starts as `received, extracting, extracted, needs_review, reconciled, failed`; 0005 adds the rest of the lifecycle.
- Keyset indexes `(tenant_id, created_at DESC, id DESC)` exist on the tables behind list endpoints: shipments, invoices, discrepancies and dead_letters. `discrepancies (invoice_id, created_at DESC, id DESC)` serves one invoice's discrepancies. Tables read by key or through their parent get no keyset index, because every index slows every write.
- `dead_letters` has a partial unique index on `(tenant_id, queue, job_id) WHERE replayed_at IS NULL`, so moving a failed job twice cannot create two open dead letters.

## Rate card versioning (0002 to 0004)

Target shape: `rate_card_versions (carrier_id, version, effective tstzrange)` with one version in force per carrier at any instant. `rate_cards` rows belong to a version (`rate_card_version_id`) and no longer carry `carrier_id`. Every invoice line records the version that priced it.

| Step | Release | What runs | Why it is its own step |
| --- | --- | --- | --- |
| 1 | N | `0002_rate_card_versions_expand` | Additive only, so release N keeps running unchanged |
| 2 | N+1 | Code that writes versions | New rows get a version before the column becomes required |
| 3 | N+1 | `scripts/backfill-rate-card-versions.ts` | A long data change in small batches while traffic continues |
| 4 | N+1 | `0003a_rate_card_versions_contract` | Enforces `NOT NULL` without a blocking table scan |
| 5 | N+1 | `0003b_rate_card_versions_indexes` | `CONCURRENTLY` cannot run in a transaction |
| 6 | N+2 | Code that reads versions only | Nothing reads `rate_cards.carrier_id` any more |
| 7 | N+2 or later | `0004_drop_flat_rate_columns` | Not reversible, so it waits until rollback to N+1 is ruled out |

By hand:

```bash
pnpm db:migrate --to=0002
pnpm --filter @freightaudit/db backfill:rate-card-versions   # exits 1 while any row has no version
pnpm db:migrate --to=0003
pnpm db:migrate                                               # 0004, in the later release
```

### 0002 expand

- `btree_gist` gives GiST an operator class for plain equality on `uuid`. That lets one exclusion constraint, `EXCLUDE USING gist (carrier_id WITH =, effective WITH &&)`, say "same carrier and overlapping dates". The database, not application code, then guarantees one version in force per instant. Ranges are half-open (`[from,to)`), so version 2 may start exactly where version 1 ends.
- `ADD COLUMN rate_card_version_id uuid` (nullable, no default) on `rate_cards` and `invoice_lines` changes only the catalog: no rewrite, no scan, and a lock held for milliseconds.
- The foreign keys are added `NOT VALID`. A validated foreign key would scan the whole table while holding a `SHARE ROW EXCLUSIVE` lock, which blocks writes. `NOT VALID` enforces the key for new rows at once and leaves the check of existing rows to 0003a.
- `rate_cards.carrier_id` drops `NOT NULL`, so version-aware writers can stop setting it before 0004 removes it. Release N still sets it.

### Step 2: code that writes versions (release N+1)

New invoice lines get the version in force for their carrier on the ship date, or stay null while no version exists yet; new rates are written under a version, without `carrier_id`. Rows still null are left to the backfill. Without this step, release N would keep adding null rows after the backfill and 0003a would fail.

### Backfill: `scripts/backfill-rate-card-versions.ts`

- It is a script, not a migration, because it is a long data change that runs while the application serves traffic. Migrations stay short DDL.
- It creates version 1 per carrier from the flat rates, in force for all time (`'(,)'`), and links each flat rate to it. It then fills `invoice_lines` in batches of 2,000 rows, walking the primary key (keyset), with the version in force on the shipment's ship date, or on the invoice date while the shipment is unmatched (UTC days).
- Each batch is its own transaction, so row locks last one short statement, write-ahead log comes in small bursts, and no long transaction holds back vacuum.
- `SET lock_timeout = '3s'` makes the script give way to application traffic. A statement that waits longer fails and is retried after 1 s, 2 s, then 4 s, before the script gives up.
- It is resumable because it only touches rows that are still null. After a crash, run it again and it continues. A rerun after success changes nothing.
- It logs one JSON line per batch with counts only. It exits with code 1 while any rate or line is left without a version (for example, a carrier with no flat rates), so 0003a is never run blind.

### 0003a contract (no-transaction)

`ALTER COLUMN ... SET NOT NULL` alone scans the whole table under an `ACCESS EXCLUSIVE` lock, blocking reads and writes for the length of the scan. The migration instead runs these steps for `invoice_lines` and `rate_cards`:

1. `ADD CONSTRAINT ... CHECK (rate_card_version_id IS NOT NULL) NOT VALID`: instant, and enforced for new writes.
2. `VALIDATE CONSTRAINT`: the full scan, under `SHARE UPDATE EXCLUSIVE`, so reads and writes continue.
3. `SET NOT NULL`: since Postgres 12, a valid check proves there are no nulls, so there is no second scan. Verified on 18.6, where the server logs at DEBUG1 "existing constraints on column ... are sufficient to prove that it does not contain nulls".
4. `DROP CONSTRAINT` on the now redundant check, then `VALIDATE CONSTRAINT` on the foreign keys added in 0002.

The file is marked no-transaction because a single transaction would hold the `ACCESS EXCLUSIVE` lock from step 1 until commit, through the scan in step 2, and the split would gain nothing. Each statement can be run again: the file starts with `DROP CONSTRAINT IF EXISTS`.

The helper check is named `*_check`. Postgres 18 records `NOT NULL` itself as a constraint named `<table>_<column>_not_null`, and a helper with that name would push the real one to `..._not_null1`. Postgres 18 also accepts `ADD CONSTRAINT ... NOT NULL col NOT VALID` followed by `VALIDATE CONSTRAINT` (verified on 18.6); the check form is used because it works from version 12.

### 0003b indexes (no-transaction)

- `CREATE INDEX CONCURRENTLY` builds without blocking writes, but it cannot run in a transaction block or in a multi-statement query, so it gets its own no-transaction migration.
- A failed concurrent build leaves an `INVALID` index that is never used but still slows writes. Each index is dropped with `DROP INDEX CONCURRENTLY IF EXISTS` first, so the file can run again. `CREATE INDEX ... IF NOT EXISTS` would keep the invalid index.
- Keeping it apart from 0003a means the constraint steps stay committed when an index build has to be retried, and a long build can be scheduled on its own.
- `invoice_lines_rate_card_version_id_idx` serves lookups by version and foreign key checks when a version is deleted. `rate_cards_version_charge_code_key` allows one rate per charge code within a version and replaces the flat key that 0004 drops.

### 0004 drop (separate release)

`ALTER TABLE rate_cards DROP COLUMN carrier_id` also drops the flat unique key `(tenant_id, carrier_id, charge_code)` and the foreign key to carriers. It is a catalog change with a brief lock and no rewrite. It ships in a later release because instances of the previous release may still read the column during a rolling deploy, and a rollback to that release needs it. The drop deletes data, so it waits until that rollback is ruled out.

## 0005 invoice lifecycle (expand)

`ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS` adds `reconciling` and `approved`, so the database and the API contracts share one lifecycle (state machine in `docs/context.md`). Adding an enum value changes only the catalog, with no table scan or rewrite, and runs inside the migration's transaction (Postgres 12 and later; a new value is usable once the transaction commits). Existing values cannot be reordered without recreating the type, which rewrites every table that uses it, so `needs_review` keeps sorting before `reconciled`; code must not order by status. As with any expand step, deploy code that can read the new values before code that writes them: an older reader that meets an unknown value fails, for example when serializing a GraphQL enum.

## 0006 extraction pipeline (expand)

- `extractions` holds one validated model extraction per invoice: model, token counts and the result as `jsonb`. `invoice_id` is unique, so a second save by a retried or recovered job is a no-op (`ON CONFLICT DO NOTHING`). For an upload split into several invoices, the row records each part's outcome instead.
- `invoices.parent_invoice_id` points a split-out invoice at the upload it came from. The nullable column is a catalog change; the foreign key is added `NOT VALID`, because every existing row is NULL and a validating scan could find nothing, while new writes are checked at once. A later contract step may `VALIDATE` it.
- The `check_invoice_transition` trigger (`BEFORE UPDATE OF status`) rejects any status move that the lifecycle in `docs/context.md` does not list, with SQLSTATE `23514`, whichever code writes it. An update to the same status passes, so a retried job may repeat its move. Inserts are not checked, so the seed may write any status.
- The flat-rate seed that the backfill test writes at 0002 inserts invoices with explicit columns: a Drizzle insert of the latest schema always names `parent_invoice_id`, which does not exist before 0006.

## Tests (`pnpm test:int`)

Each test runs in a throwaway database on the Postgres server in `DATABASE_URL`.

- Migrations apply from empty, a second run is a no-op, and the Drizzle schema matches the database, including enum labels.
- The exclusion constraint rejects overlapping versions for one carrier (SQLSTATE `23P01`), and allows touching ranges and the same dates for another carrier.
- The status trigger rejects moves the lifecycle does not list (SQLSTATE `23514`) and allows listed and repeated ones.
- Backfill on the small seed (flat-rate shape at 0002): a crash after the first batch, then a rerun that finishes; every line points at a version of its own invoice's carrier; another rerun changes nothing; then 0003a, 0003b and 0004 apply, leaving both columns `NOT NULL`, the foreign keys validated, both indexes valid and no `carrier_id`.
- The small seed loads on the final schema, every line bills the version in force on its ship date, and every invoice's lines and discrepancies fit its status in the lifecycle.

The flat-rate seed that the backfill test writes at 0002 uses only the statuses that existed then; seed modes that write a historical shape must keep to that shape's enum values.

## Adding a migration

Name it with the next number and a short description, for example `0006_add_invoice_due_date.sql`. Add the no-transaction marker only when a statement needs it, and keep such statements safe to run again. Update `src/schema.ts` in the same change, and document any expand/contract series here.
