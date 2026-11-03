-- 0018 expand: Claude's spend from before pnpm db:reset-demo emptied the database. The reset writes it back here, so the
-- spend cap counts it with the Claude calls in llm_calls: the total the worker seeds Redis from. A new table, so running
-- code keeps working.
CREATE TABLE claude_spend_carryover (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  -- Integer micro-dollars (1,000,000 is $1), as in llm_calls.
  cost_micro_usd bigint NOT NULL CHECK (cost_micro_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
