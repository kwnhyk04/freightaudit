-- 0012 expand: why a model call failed: its class (timeout, 429, 5xx, network, parse_or_schema, other), the HTTP
-- status the provider sent, and the first line of the error message, keys masked. Null for calls that returned a reply
-- and for rows before 0012.
ALTER TABLE llm_calls ADD COLUMN error_class text, ADD COLUMN http_status integer, ADD COLUMN error_message text;
