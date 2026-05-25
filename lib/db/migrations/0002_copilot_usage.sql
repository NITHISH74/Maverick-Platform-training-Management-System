-- Coordinator Copilot — usage / cost ledger.
-- One row is appended per /copilot/query and /copilot/feedback call.
-- Apply with: psql "$DATABASE_URL" -f lib/db/migrations/0002_copilot_usage.sql
--             (or run via Supabase SQL editor)

CREATE TABLE IF NOT EXISTS copilot_usage (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid,
  query_text          text,
  generated_sql       text,
  row_count           integer,
  prompt_tokens       integer,
  completion_tokens   integer,
  total_tokens        integer,
  estimated_cost_inr  numeric(10, 4),
  helpful             boolean,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS copilot_usage_created_at_idx
  ON copilot_usage (created_at DESC);

CREATE INDEX IF NOT EXISTS copilot_usage_user_id_idx
  ON copilot_usage (user_id);
