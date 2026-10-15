-- 0009 expand: one row per model call, the step that produced each extraction, and extractions that end in needs_review.
-- A new table, nullable columns, NOT VALID checks and one more allowed status move; running code keeps working.

-- Every model call, failed ones included, with what it cost. A call that ended in an error has no tokens.
CREATE TABLE llm_calls (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES tenants,
  invoice_id uuid NOT NULL REFERENCES invoices,
  role text NOT NULL CHECK (role IN ('primary', 'text', 'fallback')),
  step text NOT NULL CHECK (step IN ('first_pass', 'repair', 'fallback')),
  provider text NOT NULL,
  model text NOT NULL,
  -- What the provider says it ran: Gemini answers some retired model ids with a newer model.
  served_model text,
  outcome text NOT NULL CHECK (outcome IN ('valid', 'invalid', 'rate_limited', 'error')),
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL CHECK (output_tokens >= 0),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  -- Integer micro-dollars (1,000,000 is $1), since a call costs a fraction of a cent; 0 on a free tier.
  cost_micro_usd bigint NOT NULL CHECK (cost_micro_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- The calls of one invoice, in order; the table is new and empty, so a plain build takes no time.
CREATE INDEX llm_calls_invoice_id_idx ON llm_calls (invoice_id, created_at);
CREATE TRIGGER llm_calls_set_updated_at BEFORE UPDATE ON llm_calls FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Which step produced the extraction (needs_review when none passed), and why the fallback model ran. Every existing
-- row is NULL, so NOT VALID skips a scan that could find nothing and still checks every write.
ALTER TABLE extractions ADD COLUMN step text;
ALTER TABLE extractions ADD COLUMN fallback_reason text;
ALTER TABLE extractions ADD CONSTRAINT extractions_step_check CHECK (step IN ('first_pass', 'repair', 'fallback', 'needs_review')) NOT VALID;
ALTER TABLE extractions ADD CONSTRAINT extractions_fallback_reason_check CHECK (fallback_reason IN ('rate_limited', 'invalid_output')) NOT VALID;

-- An extraction still invalid after its repair and the fallback ends in needs_review. Otherwise the rules of 0007.
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
