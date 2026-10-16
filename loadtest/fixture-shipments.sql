-- Part 1 of the load test (README, Load test): the two shipments the recorded fixtures bill. packages/llm/fixtures
-- predates the current small seed, whose shipments carry other PRO numbers, so without these every fixture invoice
-- would stop at needs_review (no_shipment_match) instead of being priced. Ship dates fall in each carrier's 2025 rate
-- card version. Safe to rerun; pnpm db:reset removes them.
-- docker exec -i freightaudit-postgres-1 psql -U freightaudit -d freightaudit < loadtest/fixture-shipments.sql
INSERT INTO shipments (tenant_id, carrier_id, pro_number, reference, origin, destination, shipped_on, weight_lb, miles)
SELECT c.tenant_id, c.id, s.pro_number, s.reference, 'Load test origin', 'Load test destination', s.shipped_on::date, s.weight_lb, s.miles
FROM (
  VALUES
    ('Halcyon Ridge Freight', '2612347155', 'LOADTEST-DIGITAL', '2025-08-25', 5013, 420),
    ('Nimbus Road Lines', '0619993094', 'LOADTEST-SCANNED', '2025-06-16', 7399, 1180)
) AS s (carrier, pro_number, reference, shipped_on, weight_lb, miles)
JOIN carriers c ON c.name = s.carrier AND c.tenant_id = '5fb9220d-9b0f-4d32-a248-6492457c3890'
ON CONFLICT (tenant_id, carrier_id, pro_number) DO NOTHING;
