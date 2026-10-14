-- 0002 expand: versioned rate cards beside the flat ones. Additive only, so the running release keeps working.

-- GiST needs btree_gist to combine plain equality (carrier_id) with range overlap in one exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE rate_card_versions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  carrier_id uuid NOT NULL REFERENCES carriers,
  version integer NOT NULL CHECK (version > 0),
  effective tstzrange NOT NULL CHECK (NOT isempty(effective)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier_id, version),
  -- One version in force per carrier at any instant; ranges are half-open, so [a,b) and [b,c) may touch.
  CONSTRAINT rate_card_versions_no_overlap EXCLUDE USING gist (carrier_id WITH =, effective WITH &&)
);
CREATE TRIGGER rate_card_versions_set_updated_at BEFORE UPDATE ON rate_card_versions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A nullable column without a default changes only the catalog: no table rewrite, no scan.
-- NOT VALID foreign keys check new writes only; 0003a validates existing rows without blocking writes.
ALTER TABLE rate_cards ADD COLUMN rate_card_version_id uuid;
ALTER TABLE rate_cards ADD CONSTRAINT rate_cards_rate_card_version_id_fkey
  FOREIGN KEY (rate_card_version_id) REFERENCES rate_card_versions NOT VALID;
-- Version-aware writers stop setting carrier_id; 0004 drops it.
ALTER TABLE rate_cards ALTER COLUMN carrier_id DROP NOT NULL;

ALTER TABLE invoice_lines ADD COLUMN rate_card_version_id uuid;
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_rate_card_version_id_fkey
  FOREIGN KEY (rate_card_version_id) REFERENCES rate_card_versions NOT VALID;
