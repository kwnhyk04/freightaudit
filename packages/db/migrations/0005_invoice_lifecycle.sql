-- 0005 expand: one invoice lifecycle for the database and the API contracts (state machine in docs/context.md).
-- ADD VALUE only changes the catalog. Existing values cannot move, so needs_review keeps sorting before reconciled.
-- Deploy code that reads the new values before any code writes them.
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'reconciling' AFTER 'extracted';
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'approved' AFTER 'reconciled';
