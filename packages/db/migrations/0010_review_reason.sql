-- 0010 expand: why reconciliation sent an invoice to a reviewer, such as an unsupported currency or no matching
-- shipment. A nullable column; running code keeps working, and rows before 0010 have none.
ALTER TABLE extractions ADD COLUMN review_reason text;
