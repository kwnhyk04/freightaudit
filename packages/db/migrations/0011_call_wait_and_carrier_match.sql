-- 0011 expand: the time a model call waited on its role's rate limit before it was sent, and how the extracted carrier
-- name matched a known carrier (exact, normalized or contained). Nullable columns; rows before 0011 have none.
ALTER TABLE llm_calls ADD COLUMN wait_ms integer;
ALTER TABLE extractions ADD COLUMN carrier_match text;
