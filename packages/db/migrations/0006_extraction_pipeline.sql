-- 0006 expand: extraction results, invoices split out of multi-invoice PDFs, and the invoice lifecycle enforced in the database.
-- A new table, a nullable column, a NOT VALID foreign key and a trigger; code that predates them keeps working.

-- One validated model extraction per invoice. The unique invoice_id keeps retried or recovered jobs from writing twice.
CREATE TABLE extractions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  invoice_id uuid NOT NULL UNIQUE REFERENCES invoices,
  model text NOT NULL,
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER extractions_set_updated_at BEFORE UPDATE ON extractions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- An invoice split out of a multi-invoice PDF points at the upload it came from. The column is new, so every existing
-- row is NULL; NOT VALID skips a scan that could find nothing and still checks every write.
ALTER TABLE invoices ADD COLUMN parent_invoice_id uuid;
ALTER TABLE invoices ADD CONSTRAINT invoices_parent_invoice_id_fkey FOREIGN KEY (parent_invoice_id) REFERENCES invoices NOT VALID;

-- The status moves listed in the lifecycle (docs/context.md); any other move fails, whichever code writes it.
CREATE FUNCTION check_invoice_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> OLD.status AND (OLD.status::text, NEW.status::text) NOT IN (
    ('received', 'extracting'),
    ('extracting', 'extracted'),
    ('extracting', 'failed'),
    ('extracted', 'reconciling'),
    ('reconciling', 'reconciled'),
    ('reconciling', 'needs_review'),
    ('reconciling', 'failed'),
    ('reconciled', 'approved'),
    ('needs_review', 'approved'),
    ('failed', 'received'),
    ('failed', 'extracted')
  ) THEN
    RAISE EXCEPTION 'invoice % cannot move from % to %', OLD.id, OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER invoices_check_transition BEFORE UPDATE OF status ON invoices FOR EACH ROW EXECUTE FUNCTION check_invoice_transition();
