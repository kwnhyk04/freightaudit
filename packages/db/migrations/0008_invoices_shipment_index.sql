-- migrate:no-transaction
-- 0008: the reconcile job reads the lines other invoices billed for a shipment through invoices.shipment_id, which had
-- no index. CREATE INDEX CONCURRENTLY does not block writes but cannot run in a transaction; a failed build leaves an
-- INVALID index behind, so it is dropped first and the file is safe to re-run.

DROP INDEX CONCURRENTLY IF EXISTS invoices_shipment_id_idx;
--> statement-breakpoint
CREATE INDEX CONCURRENTLY invoices_shipment_id_idx ON invoices (shipment_id);
