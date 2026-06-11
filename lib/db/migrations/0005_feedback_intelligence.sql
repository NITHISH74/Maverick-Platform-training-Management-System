-- =============================================================
-- Maverick Execution Platform — Migration 0005
-- Feedback Intelligence Engine (Feature 3)
--
-- Adds the feedback_intelligence table. A separate, narrower
-- table is used (not the existing feedback_analysis from migration
-- 0001) because the project rule is "do not modify existing tables".
-- Both tables can coexist; the legacy /ai/feedback/analyze endpoint
-- continues to write to feedback_analysis, and the new
-- /feedback-intelligence/analyze endpoint writes here.
--
-- Idempotent — safe to run twice.
-- =============================================================

CREATE TABLE IF NOT EXISTS feedback_intelligence (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id            integer NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  feedback_ids        jsonb,
  themes              jsonb,
  overall_sentiment   text,
  sentiment_score     numeric(5, 2),
  recommended_actions jsonb,
  summary             text,
  raw_response        text,
  analyzed_at         timestamptz DEFAULT now(),
  UNIQUE(batch_id)
);

CREATE INDEX IF NOT EXISTS idx_feedback_intelligence_recent
  ON feedback_intelligence (analyzed_at DESC);
