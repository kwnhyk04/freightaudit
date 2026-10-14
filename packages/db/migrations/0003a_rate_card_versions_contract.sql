-- migrate:no-transaction
-- 0003a contract: after the backfill, every rate and invoice line has a version. Runs after scripts/backfill-rate-card-versions.ts.
-- Each statement commits on its own and is safe to re-run. One transaction would hold the ACCESS EXCLUSIVE lock
-- taken by ADD CONSTRAINT through the whole VALIDATE scan, blocking reads and writes.
-- Steps: NOT VALID check (instant), VALIDATE (full scan under SHARE UPDATE EXCLUSIVE, so reads and writes continue),
-- SET NOT NULL (the valid check proves there are no nulls, so no second scan), then drop the now redundant check.

ALTER TABLE invoice_lines DROP CONSTRAINT IF EXISTS invoice_lines_rate_card_version_id_check;
--> statement-breakpoint
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_rate_card_version_id_check
  CHECK (rate_card_version_id IS NOT NULL) NOT VALID;
--> statement-breakpoint
ALTER TABLE invoice_lines VALIDATE CONSTRAINT invoice_lines_rate_card_version_id_check;
--> statement-breakpoint
ALTER TABLE invoice_lines ALTER COLUMN rate_card_version_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE invoice_lines DROP CONSTRAINT invoice_lines_rate_card_version_id_check;
--> statement-breakpoint
ALTER TABLE invoice_lines VALIDATE CONSTRAINT invoice_lines_rate_card_version_id_fkey;
--> statement-breakpoint

ALTER TABLE rate_cards DROP CONSTRAINT IF EXISTS rate_cards_rate_card_version_id_check;
--> statement-breakpoint
ALTER TABLE rate_cards ADD CONSTRAINT rate_cards_rate_card_version_id_check
  CHECK (rate_card_version_id IS NOT NULL) NOT VALID;
--> statement-breakpoint
ALTER TABLE rate_cards VALIDATE CONSTRAINT rate_cards_rate_card_version_id_check;
--> statement-breakpoint
ALTER TABLE rate_cards ALTER COLUMN rate_card_version_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE rate_cards DROP CONSTRAINT rate_cards_rate_card_version_id_check;
--> statement-breakpoint
ALTER TABLE rate_cards VALIDATE CONSTRAINT rate_cards_rate_card_version_id_fkey;
