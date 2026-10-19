-- 0014 expand: a possible duplicate invoice, found at reconcile when another invoice of the carrier has the same number
-- (docs/migrations.md). In the file's transaction, as 0005 and 0013: nothing here uses the new value before the commit.
ALTER TYPE discrepancy_type ADD VALUE IF NOT EXISTS 'duplicate_invoice' AFTER 'duplicate_charge';
