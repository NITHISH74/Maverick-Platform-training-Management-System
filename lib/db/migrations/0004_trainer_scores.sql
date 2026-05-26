-- =============================================================
-- Maverick Execution Platform — Migration 0004
-- AI Trainer Scoring Engine
--
-- Adds the trainer_scores table — one row per (trainer, batch)
-- pair holding the AI-generated effectiveness score plus a JSON
-- breakdown of strengths / improvements.
--
-- Idempotent — safe to run twice.
--
-- Deviation from the original feature spec:
--   * spec used uuid for trainer_id / batch_id; users.id and
--     batches.id are integer in our schema (since migration 0001),
--     so we use integer with explicit FKs. Other column types
--     and the UNIQUE(trainer_id, batch_id) constraint match the
--     spec verbatim.
--
-- Apply with: psql "$DATABASE_URL" -f lib/db/migrations/0004_trainer_scores.sql
-- =============================================================

CREATE TABLE IF NOT EXISTS trainer_scores (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id         integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  batch_id           integer NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  attendance_score   numeric(5, 2),
  assessment_score   numeric(5, 2),
  feedback_score     numeric(5, 2),
  composite_score    numeric(5, 2),
  score_reasoning    text,
  score_breakdown    jsonb,
  generated_at       timestamptz DEFAULT now(),
  UNIQUE(trainer_id, batch_id)
);

CREATE INDEX IF NOT EXISTS idx_trainer_scores_trainer  ON trainer_scores (trainer_id);
CREATE INDEX IF NOT EXISTS idx_trainer_scores_batch    ON trainer_scores (batch_id);
CREATE INDEX IF NOT EXISTS idx_trainer_scores_recent   ON trainer_scores (generated_at DESC);
