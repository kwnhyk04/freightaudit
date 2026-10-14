-- migrate:no-transaction
-- 0003b contract: indexes for versioned lookups. CREATE INDEX CONCURRENTLY does not block writes but cannot run in a transaction.
-- A failed concurrent build leaves an INVALID index behind, so each index is dropped first and the file is safe to re-run.

DROP INDEX CONCURRENTLY IF EXISTS invoice_lines_rate_card_version_id_idx;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY invoice_lines_rate_card_version_id_idx ON invoice_lines (rate_card_version_id);
--> statement-breakpoint

-- One rate per charge code within a version; replaces the flat key that 0004 drops.
DROP INDEX CONCURRENTLY IF EXISTS rate_cards_version_charge_code_key;
--> statement-breakpoint
CREATE UNIQUE INDEX CONCURRENTLY rate_cards_version_charge_code_key ON rate_cards (rate_card_version_id, charge_code);
