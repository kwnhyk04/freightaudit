-- 0001 initial schema. Rate cards are flat and unversioned on purpose; 0002 to 0004 add versioning by expand and contract.

CREATE TYPE invoice_status AS ENUM ('received', 'extracting', 'extracted', 'needs_review', 'reconciled', 'failed');
CREATE TYPE discrepancy_type AS ENUM ('rate_mismatch', 'uncontracted_charge', 'duplicate_charge', 'weight_mismatch', 'arithmetic_error');
CREATE TYPE discrepancy_status AS ENUM ('open', 'confirmed', 'dismissed');

-- Keeps updated_at current on every update, including raw SQL such as backfills.
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- The tenant root: its id is the tenant_id every other table carries.
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE carriers (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- One flat rate per carrier and charge code, overwritten in place when the carrier changes it.
CREATE TABLE rate_cards (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  carrier_id uuid NOT NULL REFERENCES carriers,
  charge_code text NOT NULL,
  rate_cents bigint NOT NULL CHECK (rate_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, carrier_id, charge_code)
);

-- Synced from the TMS; the carrier's PRO number identifies a shipment.
CREATE TABLE shipments (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  carrier_id uuid NOT NULL REFERENCES carriers,
  pro_number text NOT NULL,
  reference text NOT NULL,
  origin text NOT NULL,
  destination text NOT NULL,
  shipped_on date NOT NULL,
  weight_lb integer CHECK (weight_lb > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, carrier_id, pro_number)
);

-- Header fields stay null until extraction fills them; the content hash makes uploads idempotent.
CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  status invoice_status NOT NULL DEFAULT 'received',
  filename text NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  carrier_id uuid REFERENCES carriers,
  shipment_id uuid REFERENCES shipments,
  invoice_number text,
  pro_number text,
  invoice_date date,
  currency text CHECK (currency ~ '^[A-Z]{3}$'),
  total_cents bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, content_sha256)
);

CREATE TABLE invoice_lines (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  invoice_id uuid NOT NULL REFERENCES invoices,
  line_number integer NOT NULL CHECK (line_number > 0),
  description text NOT NULL,
  charge_code text,
  amount_cents bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, line_number)
);

CREATE TABLE discrepancies (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  invoice_id uuid NOT NULL REFERENCES invoices,
  invoice_line_id uuid REFERENCES invoice_lines,
  shipment_id uuid REFERENCES shipments,
  type discrepancy_type NOT NULL,
  status discrepancy_status NOT NULL DEFAULT 'open',
  expected_cents bigint NOT NULL,
  billed_cents bigint NOT NULL,
  evidence text NOT NULL,
  note text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A reviewer decision always carries its time.
  CHECK ((status = 'open') = (resolved_at IS NULL))
);

-- Idempotency-Key of single uploads: a retry with the same key returns the same invoice.
CREATE TABLE idempotency_keys (
  tenant_id uuid NOT NULL REFERENCES tenants,
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 255),
  invoice_id uuid NOT NULL REFERENCES invoices,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

-- Jobs that used up their retries; a replay requeues the job and sets replayed_at.
CREATE TABLE dead_letters (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  queue text NOT NULL,
  job_id text NOT NULL,
  payload jsonb NOT NULL,
  error text NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  replayed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Resume point of the TMS shipment sync, one row per tenant.
CREATE TABLE tms_sync_state (
  tenant_id uuid PRIMARY KEY REFERENCES tenants,
  cursor text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Keyset pagination for list endpoints: WHERE tenant_id = $1 AND (created_at, id) < ($2, $3) ORDER BY created_at DESC, id DESC.
CREATE INDEX shipments_keyset_idx ON shipments (tenant_id, created_at DESC, id DESC);
CREATE INDEX invoices_keyset_idx ON invoices (tenant_id, created_at DESC, id DESC);
CREATE INDEX discrepancies_keyset_idx ON discrepancies (tenant_id, created_at DESC, id DESC);
CREATE INDEX dead_letters_keyset_idx ON dead_letters (tenant_id, created_at DESC, id DESC);
-- The discrepancies of one invoice, newest first (GraphQL Invoice.discrepancies).
CREATE INDEX discrepancies_invoice_keyset_idx ON discrepancies (invoice_id, created_at DESC, id DESC);
-- At most one unreplayed dead letter per job, so a retried move to the dead-letter table stays idempotent.
CREATE UNIQUE INDEX dead_letters_open_job_key ON dead_letters (tenant_id, queue, job_id) WHERE replayed_at IS NULL;

CREATE TRIGGER tenants_set_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER carriers_set_updated_at BEFORE UPDATE ON carriers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER rate_cards_set_updated_at BEFORE UPDATE ON rate_cards FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER shipments_set_updated_at BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER invoices_set_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER invoice_lines_set_updated_at BEFORE UPDATE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER discrepancies_set_updated_at BEFORE UPDATE ON discrepancies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER idempotency_keys_set_updated_at BEFORE UPDATE ON idempotency_keys FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER dead_letters_set_updated_at BEFORE UPDATE ON dead_letters FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tms_sync_state_set_updated_at BEFORE UPDATE ON tms_sync_state FOR EACH ROW EXECUTE FUNCTION set_updated_at();
