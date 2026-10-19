-- 0015 expand: a reviewer may reject a reconciled invoice, and its open findings close with it (docs/migrations.md).
-- In the file's transaction, as 0005, 0013 and 0014: nothing here uses the new value before the commit.
ALTER TYPE discrepancy_status ADD VALUE IF NOT EXISTS 'closed' AFTER 'dismissed';

-- A finding closed with its invoice is recorded beside the reviewer's decisions.
ALTER TABLE audit_events
  DROP CONSTRAINT audit_events_action_check,
  ADD CONSTRAINT audit_events_action_check CHECK (
    action IN ('status', 'approved', 'rejected', 'corrected', 'discrepancy_confirmed', 'discrepancy_dismissed', 'discrepancy_closed', 'replayed')
  );

-- A reviewer may reject a reconciled invoice too. Like approval, rejection waits until no finding is open: a finding
-- left open would stay in the review queue with nothing to decide it. Otherwise the rules of 0013.
CREATE OR REPLACE FUNCTION check_invoice_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> OLD.status AND (OLD.status::text, NEW.status::text) NOT IN (
    ('received', 'extracting'),
    ('extracting', 'extracted'),
    ('extracting', 'needs_review'),
    ('extracting', 'failed'),
    ('extracted', 'reconciling'),
    ('reconciling', 'reconciled'),
    ('reconciling', 'needs_review'),
    ('reconciling', 'failed'),
    ('reconciled', 'approved'),
    ('reconciled', 'rejected'),
    ('needs_review', 'approved'),
    ('needs_review', 'extracted'),
    ('needs_review', 'rejected'),
    ('failed', 'received'),
    ('failed', 'extracted')
  ) THEN
    RAISE EXCEPTION 'invoice % cannot move from % to %', OLD.id, OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NEW.status::text IN ('approved', 'rejected')
    AND EXISTS (SELECT 1 FROM discrepancies WHERE invoice_id = NEW.id AND status = 'open') THEN
    RAISE EXCEPTION 'invoice % has open discrepancies', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
