-- 0004 contract, a later release: no deployed code reads flat rates any more, and rollback past 0003 is no longer needed.
-- Dropping carrier_id also drops the flat key (tenant_id, carrier_id, charge_code) and its foreign key. Not reversible.
ALTER TABLE rate_cards DROP COLUMN carrier_id;
