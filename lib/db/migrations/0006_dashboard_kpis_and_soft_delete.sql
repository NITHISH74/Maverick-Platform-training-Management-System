-- =============================================================
-- Maverick Execution Platform — Migration 0006
-- Dashboard KPIs + admin soft-delete + auto-close
--
-- Adds two columns to the existing `batches` table (additive only —
-- no existing column is modified):
--
--   clearance_rate  numeric(5,2)   — coordinator-set passing-score
--                                    threshold per batch (default 70.00).
--                                    Powers Dashboard Tile D and the
--                                    batch-comparison report.
--
--   deleted_at      timestamptz    — soft-delete marker for admin batch
--                                    deletions. All batch queries should
--                                    filter `deleted_at IS NULL`.
--
-- The `batch_status` enum already includes 'closed' (see migration
-- 0001), so Feature 5 needs no enum change.
--
-- Idempotent: safe to run twice.
-- =============================================================

ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS clearance_rate numeric(5, 2) NOT NULL DEFAULT 70.00;

ALTER TABLE batches
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_batches_active
  ON batches (status)
  WHERE deleted_at IS NULL;
