-- =============================================================
-- Maverick Execution Platform — Migration 0007
-- V6: Attendance settings, feedback windows, notification log columns.
--
-- This migration is the persistence side of five V6 features:
--   F1. attendance_settings — per-batch attendance due time + enabled flag
--   F2. (no schema change — uses existing monitoring_alerts + notifications_log)
--   F3. (no schema change — duplicate handling is in the API layer)
--   F4. notifications_log gets columns the new notification API requires
--   F5. feedback_windows — per-batch feedback request config (MS Forms URL,
--       due date/time, last sent_at)
--
-- Idempotent: all CREATE TABLE / ADD COLUMN use IF NOT EXISTS.
-- =============================================================

-- -------------------------------------------------------------
-- F1. attendance_settings
-- Per-batch override of the default cut-off time.
-- One row per batch (UNIQUE batch_id). Falls back to
-- batches.attendance_cutoff_time when no row exists.
-- -------------------------------------------------------------
create table if not exists attendance_settings (
  id           uuid primary key default gen_random_uuid(),
  batch_id     integer not null unique references batches(id) on delete cascade,
  due_time     time not null default '10:00:00',
  due_timezone text not null default 'Asia/Kolkata',
  enabled      boolean not null default true,
  updated_by   integer references users(id),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_attendance_settings_batch on attendance_settings(batch_id);

-- Seed from the existing batches.attendance_cutoff_time so per-batch
-- configuration the coordinator already set isn't lost.
-- Cast the source column to text first so this works whether
-- batches.attendance_cutoff_time is stored as `text` ('10:00') or as a
-- native `time` ('10:00:00') in the live DB. '10:00'::time and
-- '10:00:00'::time are both valid, so no manual ':00' suffix is needed.
insert into attendance_settings (batch_id, due_time, enabled)
select id,
       coalesce(nullif(attendance_cutoff_time::text, ''), '10:00')::time,
       true
from batches
where deleted_at is null
on conflict (batch_id) do nothing;

-- -------------------------------------------------------------
-- F4. notifications_log: add columns the new notification API
-- needs and that the original 2025 schema didn't have.
--
-- Existing columns we keep using:
--   recipient_id, recipient_email, notif_type (=> type),
--   subject, body, status (=> delivery_status), related_batch (=> batch_id),
--   related_candidate, sent_at, error_message
--
-- New columns:
--   recipient_name  — denormalised so the audit row is readable without a
--                     users join (recipient_id can be null for candidate emails).
--   body_preview    — first 200 chars of body, indexed for fast log search.
-- -------------------------------------------------------------
alter table notifications_log
  add column if not exists recipient_name text,
  add column if not exists body_preview   text;

-- Backfill body_preview for existing rows.
update notifications_log
   set body_preview = left(body, 200)
 where body_preview is null;

create index if not exists idx_notifications_log_type
  on notifications_log(notif_type);
create index if not exists idx_notifications_log_batch_type
  on notifications_log(related_batch, notif_type);

-- -------------------------------------------------------------
-- F5. feedback_windows
-- Coordinator-owned config for the "send feedback request" feature.
-- One row per batch (UNIQUE). Stores the MS Forms link and the
-- due date/time the candidates were told about.
-- -------------------------------------------------------------
create table if not exists feedback_windows (
  id             uuid primary key default gen_random_uuid(),
  batch_id       integer not null unique references batches(id) on delete cascade,
  ms_forms_link  text,
  due_date       date,
  due_time       time,
  subject        text,
  body_template  text,
  sent_at        timestamptz,
  sent_by        integer references users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_feedback_windows_batch on feedback_windows(batch_id);
