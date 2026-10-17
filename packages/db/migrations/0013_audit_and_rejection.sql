-- 0013 expand: a reviewer's way out of needs_review and an audit trail (docs/migrations.md).
-- One transaction, as 0005: the new enum value is compared as text only, never cast, so nothing here uses it before the
-- commit.
ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'rejected' AFTER 'approved';

-- Who did what to which invoice, and when. actor is null for the pipeline, a reviewer's name for review actions, or
-- api-key:<id> for a direct API call. changes holds [{field, from, to}].
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  invoice_id uuid REFERENCES invoices (id),
  discrepancy_id uuid REFERENCES discrepancies (id),
  dead_letter_id uuid REFERENCES dead_letters (id),
  actor text CONSTRAINT audit_events_actor_check CHECK (actor ~ '^[A-Za-z0-9 ._@:-]{1,64}$'),
  action text NOT NULL CONSTRAINT audit_events_action_check CHECK (
    action IN ('status', 'approved', 'rejected', 'corrected', 'discrepancy_confirmed', 'discrepancy_dismissed', 'replayed')
  ),
  changes jsonb NOT NULL DEFAULT '[]',
  reason text CONSTRAINT audit_events_reason_check CHECK (length(reason) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_invoice_idx ON audit_events (invoice_id, created_at, id);

-- An audit record is never changed or removed.
CREATE FUNCTION forbid_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only' USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_change();

-- Every status move the pipeline makes, review cycles included. A reviewer action sets app.actor for its transaction
-- (set_config with is_local) and records its own row with the reason and field changes, so it is skipped here. Inserts
-- fire nothing, so seeded rows stay reproducible.
CREATE FUNCTION record_invoice_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> OLD.status AND coalesce(current_setting('app.actor', true), '') = '' THEN
    INSERT INTO audit_events (tenant_id, invoice_id, action, changes)
    VALUES (NEW.tenant_id, NEW.id, 'status',
      jsonb_build_array(jsonb_build_object('field', 'status', 'from', OLD.status::text, 'to', NEW.status::text)));
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER invoices_record_status AFTER UPDATE OF status ON invoices
  FOR EACH ROW EXECUTE FUNCTION record_invoice_status();

-- A reviewer's correction sends a needs_review invoice back to matching, and a reviewer may reject one. Otherwise the
-- rules of 0009.
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
    ('needs_review', 'approved'),
    ('needs_review', 'extracted'),
    ('needs_review', 'rejected'),
    ('failed', 'received'),
    ('failed', 'extracted')
  ) THEN
    RAISE EXCEPTION 'invoice % cannot move from % to %', OLD.id, OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NEW.status = 'approved'
    AND EXISTS (SELECT 1 FROM discrepancies WHERE invoice_id = NEW.id AND status = 'open') THEN
    RAISE EXCEPTION 'invoice % has open discrepancies', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
