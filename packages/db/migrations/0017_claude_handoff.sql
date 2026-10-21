-- 0017 expand: why the free models read an invoice while Claude reads first (docs/migrations.md): switched_off,
-- daily_budget, input_cap or extraction_cap when it was never sent, an account reason when Claude refused it, or a
-- failure class. Null when Claude read it or is not first, and on rows before 0017.
ALTER TABLE extractions ADD COLUMN claude_handoff text;
