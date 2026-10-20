-- 0016 expand: approving a needs_review invoice as billed may hold it for a possible duplicate instead
-- (docs/migrations.md), so the trigger allows needs_review to reconciled. Otherwise the rules of 0015.
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
    ('needs_review', 'reconciled'),
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
