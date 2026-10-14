-- 0007 expand: what the reconcile job prices with, and approval only once every finding has a decision.
-- New columns are nullable, new checks NOT VALID and the bands a new table, so code that predates them keeps working.

-- Linehaul terms of a version: the minimum linehaul, and the fuel surcharge in basis points of the linehaul after the
-- minimum (2,350 is 23.5 %). Versions written before 0007 have neither until someone enters them.
ALTER TABLE rate_card_versions ADD COLUMN minimum_cents bigint;
ALTER TABLE rate_card_versions ADD COLUMN fuel_bp integer;
-- Every existing row is NULL, so NOT VALID skips a scan that could find nothing and still checks every write.
ALTER TABLE rate_card_versions ADD CONSTRAINT rate_card_versions_terms_check CHECK (minimum_cents >= 0 AND fuel_bp >= 0) NOT VALID;

-- Graduated per-mile bands of a version: each mile from from_mile up to the next band's from_mile pays cents_per_mile.
CREATE TABLE rate_card_bands (
  tenant_id uuid NOT NULL REFERENCES tenants,
  rate_card_version_id uuid NOT NULL REFERENCES rate_card_versions,
  from_mile integer NOT NULL CHECK (from_mile >= 0),
  cents_per_mile bigint NOT NULL CHECK (cents_per_mile >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rate_card_version_id, from_mile)
);
CREATE TRIGGER rate_card_bands_set_updated_at BEFORE UPDATE ON rate_card_bands FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Trip distance from the TMS, which the linehaul is priced by.
ALTER TABLE shipments ADD COLUMN miles integer;
ALTER TABLE shipments ADD CONSTRAINT shipments_miles_check CHECK (miles >= 0) NOT VALID;

-- Reconciled invoices now carry their findings as open discrepancies, so approval waits until each has a reviewer
-- decision. The status moves are those of 0006.
CREATE OR REPLACE FUNCTION check_invoice_transition() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NEW.status <> OLD.status AND NEW.status = 'approved'
    AND EXISTS (SELECT 1 FROM discrepancies WHERE invoice_id = NEW.id AND status = 'open') THEN
    RAISE EXCEPTION 'invoice % has open discrepancies', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
